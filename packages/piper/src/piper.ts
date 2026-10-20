import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

export interface SynthesisRequest {
  text: string;
  voice: string;
  /** OpenAI's `speed` (1 = normal); Piper takes the inverse as `length_scale`. */
  speed?: number;
}

/** Returns the spoken text as a WAV file. */
export type Synthesizer = (request: SynthesisRequest) => Promise<Buffer>;

const SYNTHESIZE_TIMEOUT_MS = 120_000;

/** Client for Piper's own HTTP server (`python -m piper.http_server`, POST /synthesize). */
export function createPiperClient(baseUrl: string): Synthesizer {
  const url = new URL('/synthesize', baseUrl);
  return async ({ text, voice, speed }) => {
    const body = { text, voice, ...(speed ? { length_scale: 1 / speed } : {}) };
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SYNTHESIZE_TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`Piper answered ${response.status}: ${detail}`);
    }
    return Buffer.from(await response.arrayBuffer());
  };
}

export interface PiperProcessOptions {
  python: string;
  port: number;
  voicesDir: string;
  defaultVoice: string;
}

/** Starts Piper's HTTP server on 127.0.0.1 with the voices folder as its data directory. */
export function startPiperProcess(options: PiperProcessOptions): ChildProcess {
  const args = [
    '-m',
    'piper.http_server',
    '--host',
    '127.0.0.1',
    '--port',
    String(options.port),
    '--data-dir',
    options.voicesDir,
    '-m',
    options.defaultVoice,
  ];
  return spawn(options.python, args, {
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
  });
}

/** Polls Piper's /info until it answers, so the adapter only listens once voices are loaded. */
export async function waitForPiper(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const url = new URL('/info', baseUrl);
  while (Date.now() < deadline) {
    const ready = await fetch(url, { signal: AbortSignal.timeout(2_000) })
      .then((response) => response.ok)
      .catch(() => false);
    if (ready) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Piper did not answer at ${url.href} within ${timeoutMs / 1000}s`);
}
