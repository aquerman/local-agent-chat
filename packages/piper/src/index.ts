import fs from 'node:fs';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { createPiperClient, startPiperProcess, waitForPiper } from '~/piper';
import { listVoices } from '~/voices';
import { createFfmpegEncoder } from '~/encode';
import { createServer } from '~/server';
import { readConfig } from '~/config';

const PIPER_STARTUP_TIMEOUT_MS = 120_000;

function log(line: string): void {
  process.stderr.write(`piper-openai: ${line}\n`);
}

/** Reads the repo's .env (the launcher runs from the repo root) without overriding real env vars. */
function loadDotEnv(cwd: string): void {
  const file = path.join(cwd, '.env');
  if (fs.existsSync(file)) {
    process.loadEnvFile(file);
  }
}

function stopOnExit(child: ChildProcess): void {
  const stop = (): void => {
    child.kill();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('exit', (code) => {
    log(`Piper exited with code ${code}`);
    process.exit(1);
  });
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  loadDotEnv(cwd);
  const config = readConfig(process.env, cwd, process.platform);
  const voices = await listVoices(config.voicesDir);
  const defaultVoice = voices.some((voice) => voice.id === config.defaultVoice)
    ? config.defaultVoice
    : voices[0]?.id;
  if (!defaultVoice) {
    throw new Error(
      `no voices in ${config.voicesDir}: download some with "python -m piper.download_voices --data-dir <that folder> <voice>" (see docs/voice.md)`,
    );
  }

  let piperUrl = config.piperUrl;
  if (!piperUrl) {
    piperUrl = `http://127.0.0.1:${config.piperPort}`;
    log(`starting Piper (${config.python}) on ${piperUrl} with default voice ${defaultVoice}`);
    const child = startPiperProcess({
      python: config.python,
      port: config.piperPort,
      voicesDir: config.voicesDir,
      defaultVoice,
    });
    child.on('error', (error) => {
      log(`cannot start ${config.python}: ${error.message}; set PIPER_PYTHON (see docs/voice.md)`);
      process.exit(1);
    });
    stopOnExit(child);
  }
  await waitForPiper(piperUrl, PIPER_STARTUP_TIMEOUT_MS);

  const server = createServer({
    listVoices: () => listVoices(config.voicesDir),
    synthesize: createPiperClient(piperUrl),
    encode: createFfmpegEncoder(config.ffmpeg),
    defaultVoice,
    log,
  });
  server.listen(config.port, '127.0.0.1', () => {
    const ids = voices.map((voice) => voice.id).join(', ');
    log(`ready on http://127.0.0.1:${config.port}/v1/audio/speech (voices: ${ids})`);
  });
}

main().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  log(`fatal: ${reason}`);
  process.exit(1);
});
