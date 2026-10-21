import { spawnSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { SynthesisRequest } from '~/piper';
import { createFfmpegEncoder } from '~/encode';
import { createServer } from '~/server';
import { toVoice } from '~/voices';

/** 0.1 s of 22.05 kHz mono 16-bit silence, the shape Piper returns. */
function silentWav(): Buffer {
  const samples = 2205;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + samples * 2, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(22050, 24);
  header.writeUInt32LE(44100, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(samples * 2, 40);
  return Buffer.concat([header, Buffer.alloc(samples * 2)]);
}

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

describe('speech server', () => {
  let server: Server;
  let base: string;
  const requests: SynthesisRequest[] = [];

  beforeAll(async () => {
    server = createServer({
      listVoices: async () => ['en_US-lessac-medium', 'nl_NL-mls-medium'].map(toVoice),
      synthesize: async (request) => {
        requests.push(request);
        return silentWav();
      },
      encode: createFfmpegEncoder('ffmpeg'),
      defaultVoice: 'en_US-lessac-medium',
      log: () => undefined,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    requests.length = 0;
  });

  const speak = (body: object): Promise<Response> =>
    fetch(`${base}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('returns WAV and picks the Dutch voice for Dutch text', async () => {
    const response = await speak({
      input: 'Dit is een **test** van de stem.',
      voice: 'auto',
      response_format: 'wav',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/wav');
    expect(
      Buffer.from(await response.arrayBuffer())
        .subarray(0, 4)
        .toString(),
    ).toBe('RIFF');
    expect(requests).toEqual([
      { text: 'Dit is een test van de stem.', voice: 'nl_NL-mls-medium', speed: undefined },
    ]);
  });

  it('defaults to mp3 without an ID3 header, as LibreChat expects', async () => {
    if (!hasFfmpeg) {
      return;
    }
    const response = await speak({
      input: 'Hello there, this is the voice.',
      model: 'tts-1',
      voice: 'alloy',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    const audio = Buffer.from(await response.arrayBuffer());
    expect(audio.length).toBeGreaterThan(0);
    expect(audio.subarray(0, 3).toString()).not.toBe('ID3');
    expect(audio[0]).toBe(0xff);
    expect(requests[0]?.voice).toBe('en_US-lessac-medium');
  });

  it('passes speed through and rejects bad requests', async () => {
    await speak({
      input: 'The voice is fast.',
      voice: 'en_US-lessac-medium',
      speed: 2,
      response_format: 'wav',
    });
    expect(requests[0]?.speed).toBe(2);
    expect((await speak({ input: '' })).status).toBe(400);
    expect((await speak({ input: 'x', response_format: 'ogg' })).status).toBe(400);
    expect((await speak({ input: 'x', speed: 9 })).status).toBe(400);
    const notJson = await fetch(`${base}/v1/audio/speech`, { method: 'POST', body: 'nope' });
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toEqual({
      error: { message: 'Body must be a JSON object', type: 'invalid_request_error' },
    });
  });

  it('lists voices with auto first', async () => {
    const response = await fetch(`${base}/v1/audio/voices`);
    expect(await response.json()).toEqual({
      voices: ['auto', 'en_US-lessac-medium', 'nl_NL-mls-medium'],
    });
  });

  it('reports a failing synthesizer as a 500', async () => {
    const failing = createServer({
      listVoices: async () => [toVoice('en_US-lessac-medium')],
      synthesize: async () => {
        throw new Error('Piper answered 500: boom');
      },
      encode: async (wav) => wav,
      defaultVoice: 'en_US-lessac-medium',
      log: () => undefined,
    });
    await new Promise<void>((resolve) => failing.listen(0, '127.0.0.1', resolve));
    const port = (failing.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/v1/audio/speech`, {
      method: 'POST',
      body: JSON.stringify({ input: 'Hello there, the voice is broken.' }),
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { message: 'Piper answered 500: boom', type: 'server_error' },
    });
    await new Promise((resolve) => failing.close(resolve));
  });
});
