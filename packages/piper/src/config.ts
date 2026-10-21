import path from 'node:path';

/** Everything the adapter reads from the environment, resolved once at startup. */
export interface PiperConfig {
  /** Port this OpenAI-compatible server listens on (127.0.0.1 only). */
  port: number;
  /** Python interpreter that has `piper-tts[http]` installed. */
  python: string;
  /** Folder holding `<voice>.onnx` + `<voice>.onnx.json` pairs. */
  voicesDir: string;
  /** Voice Piper loads at startup; empty means the first voice found. */
  defaultVoice: string;
  /** Port of the Piper HTTP server this adapter starts as a child process. */
  piperPort: number;
  /** An already running Piper HTTP server; when set, no child process is started. */
  piperUrl: string;
  /** ffmpeg executable used to encode Piper's WAV into mp3/opus/aac/flac. */
  ffmpeg: string;
}

type Env = Readonly<Record<string, string | undefined>>;

const DEFAULT_PORT = 8083;
const DEFAULT_PIPER_PORT = 8084;

function readPort(value: string | undefined, fallback: number, name: string): number {
  if (value == null || value.trim() === '') {
    return fallback;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a port number (1-65535), got "${value}"`);
  }
  return port;
}

function readString(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

/** Defaults match the Windows layout in docs/voice.md (venv and voices under `bin\piper`). */
export function readConfig(env: Env, cwd: string, platform: NodeJS.Platform): PiperConfig {
  const venvPython =
    platform === 'win32'
      ? path.join(cwd, 'bin', 'piper', 'Scripts', 'python.exe')
      : path.join(cwd, 'bin', 'piper', 'bin', 'python');
  return {
    port: readPort(env.VOICE_TTS_PORT, DEFAULT_PORT, 'VOICE_TTS_PORT'),
    python: readString(env.PIPER_PYTHON, venvPython),
    voicesDir: path.resolve(
      cwd,
      readString(env.PIPER_VOICES_DIR, path.join('bin', 'piper', 'voices')),
    ),
    defaultVoice: readString(env.PIPER_DEFAULT_VOICE, ''),
    piperPort: readPort(env.PIPER_PORT, DEFAULT_PIPER_PORT, 'PIPER_PORT'),
    piperUrl: readString(env.PIPER_URL, ''),
    ffmpeg: readString(env.FFMPEG_PATH, 'ffmpeg'),
  };
}
