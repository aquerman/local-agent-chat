import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Synthesizer } from '~/piper';
import type { Encoder } from '~/encode';
import type { Voice } from '~/voices';
import { CONTENT_TYPES, AUDIO_FORMATS, isAudioFormat } from '~/encode';
import { AUTO_VOICE, pickVoice } from '~/voices';
import { detectLanguage, toSpeakable } from '~/text';

export interface ServerDeps {
  listVoices: () => Promise<Voice[]>;
  synthesize: Synthesizer;
  encode: Encoder;
  defaultVoice: string;
  log: (line: string) => void;
}

/** The subset of OpenAI's speech request body this server reads. */
interface SpeechBody {
  input?: unknown;
  voice?: unknown;
  response_format?: unknown;
  speed?: unknown;
}

const MAX_BODY_BYTES = 1_000_000;
const MAX_INPUT_CHARS = 8_192;

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function sendJson(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, {
    error: { message, type: status < 500 ? 'invalid_request_error' : 'server_error' },
  });
}

async function readJson(req: IncomingMessage): Promise<SpeechBody> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, 'Request body too large');
    }
    chunks.push(buffer);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed as SpeechBody;
  } catch {
    throw new HttpError(400, 'Body must be a JSON object');
  }
}

function readSpeed(value: unknown): number | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== 'number' || !(value >= 0.25 && value <= 4)) {
    throw new HttpError(400, '`speed` must be a number between 0.25 and 4');
  }
  return value;
}

async function speech(req: IncomingMessage, res: ServerResponse, deps: ServerDeps): Promise<void> {
  const body = await readJson(req);
  if (typeof body.input !== 'string' || body.input.trim() === '') {
    throw new HttpError(400, '`input` must be a non-empty string');
  }
  if (body.input.length > MAX_INPUT_CHARS) {
    throw new HttpError(400, `\`input\` is longer than ${MAX_INPUT_CHARS} characters`);
  }
  const format = body.response_format ?? 'mp3';
  if (typeof format !== 'string' || !isAudioFormat(format)) {
    throw new HttpError(400, `\`response_format\` must be one of ${AUDIO_FORMATS.join(', ')}`);
  }
  const speed = readSpeed(body.speed);
  const text = toSpeakable(body.input);
  if (text === '') {
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[format], 'Content-Length': 0 });
    res.end();
    return;
  }

  const requested = typeof body.voice === 'string' ? body.voice : AUTO_VOICE;
  const voices = await deps.listVoices();
  const voice = pickVoice(voices, requested, detectLanguage(text), deps.defaultVoice);
  if (!voice) {
    throw new HttpError(503, 'No Piper voices are installed');
  }

  const started = Date.now();
  const wav = await deps.synthesize({ text, voice, speed });
  const audio = await deps.encode(wav, format);
  deps.log(
    `speech: ${text.length} chars, voice ${voice} (asked ${requested}), ${format}, ${Date.now() - started} ms`,
  );
  res.writeHead(200, { 'Content-Type': CONTENT_TYPES[format], 'Content-Length': audio.length });
  res.end(audio);
}

async function route(req: IncomingMessage, res: ServerResponse, deps: ServerDeps): Promise<void> {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (req.method === 'POST' && path === '/v1/audio/speech') {
    await speech(req, res, deps);
    return;
  }
  if (req.method === 'GET' && path === '/health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }
  if (req.method === 'GET' && path === '/v1/audio/voices') {
    const voices = await deps.listVoices();
    sendJson(res, 200, { voices: [AUTO_VOICE, ...voices.map((voice) => voice.id)] });
    return;
  }
  if (req.method === 'GET' && path === '/v1/models') {
    sendJson(res, 200, {
      object: 'list',
      data: [{ id: 'piper', object: 'model', owned_by: 'local' }],
    });
    return;
  }
  throw new HttpError(404, `No route for ${req.method} ${path}`);
}

/** An OpenAI-compatible speech server: POST /v1/audio/speech, plus voice and model listings. */
export function createServer(deps: ServerDeps): http.Server {
  return http.createServer((req, res) => {
    route(req, res, deps).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : String(error);
      if (status >= 500) {
        deps.log(`error: ${message}`);
      }
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendError(res, status, message);
    });
  });
}
