import { spawn } from 'node:child_process';

/** The `response_format` values of OpenAI's /v1/audio/speech. */
export type AudioFormat = 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';

export const AUDIO_FORMATS: readonly AudioFormat[] = ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'];

export const CONTENT_TYPES: Readonly<Record<AudioFormat, string>> = {
  mp3: 'audio/mpeg',
  opus: 'audio/ogg',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  pcm: 'audio/pcm',
};

/**
 * ffmpeg output options per format. mp3 is written without ID3/Xing headers because LibreChat
 * appends one response per sentence into a single MediaSource stream, and a header in the middle
 * of that stream is heard as a click or stops playback. pcm matches OpenAI: 24 kHz s16le mono.
 */
const FFMPEG_OUTPUT: Readonly<Record<Exclude<AudioFormat, 'wav'>, readonly string[]>> = {
  mp3: [
    '-f',
    'mp3',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '64k',
    '-id3v2_version',
    '0',
    '-write_xing',
    '0',
  ],
  opus: ['-f', 'ogg', '-c:a', 'libopus', '-b:a', '32k'],
  aac: ['-f', 'adts', '-c:a', 'aac', '-b:a', '64k'],
  flac: ['-f', 'flac'],
  pcm: ['-f', 's16le', '-ar', '24000', '-ac', '1'],
};

export function isAudioFormat(value: string): value is AudioFormat {
  return (AUDIO_FORMATS as readonly string[]).includes(value);
}

export type Encoder = (wav: Buffer, format: AudioFormat) => Promise<Buffer>;

/** Encodes Piper's WAV with ffmpeg over stdin/stdout; WAV itself passes through untouched. */
export function createFfmpegEncoder(ffmpeg: string): Encoder {
  return (wav, format) => {
    if (format === 'wav') {
      return Promise.resolve(wav);
    }
    const args = ['-hide_banner', '-loglevel', 'error', '-f', 'wav', '-i', 'pipe:0'];
    return run(ffmpeg, [...args, ...FFMPEG_OUTPUT[format], 'pipe:1'], wav);
  };
}

function run(command: string, args: readonly string[], input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', (error) =>
      reject(
        new Error(`cannot run ${command} (${error.message}); install ffmpeg or set FFMPEG_PATH`),
      ),
    );
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(out));
        return;
      }
      const detail = Buffer.concat(err).toString('utf8').trim().slice(0, 300);
      reject(new Error(`${command} exited with code ${code}: ${detail}`));
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}
