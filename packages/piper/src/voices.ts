import fs from 'node:fs/promises';
import path from 'node:path';

/** A Piper voice on disk, e.g. `nl_NL-mls-medium` with language `nl`. */
export interface Voice {
  id: string;
  /** ISO 639-1 code taken from the voice name (`nl_NL-...` -> `nl`). */
  language: string;
}

/** The voice name LibreChat sends to ask for language-based selection. */
export const AUTO_VOICE = 'auto';

const ONNX = '.onnx';

export function toVoice(id: string): Voice {
  const language = id.split(/[_-]/, 1)[0]?.toLowerCase() ?? '';
  return { id, language };
}

/** Voices are the `.onnx` files that have their `.onnx.json` config next to them. */
export async function listVoices(dir: string): Promise<Voice[]> {
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const present = new Set(names);
  return names
    .filter((name) => name.endsWith(ONNX) && present.has(`${name}.json`))
    .map((name) => toVoice(name.slice(0, -ONNX.length)))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Picks the voice for one request: an installed voice asked for by name wins; anything else
 * (`auto`, empty, or a name that is not installed) gets the first voice speaking the detected
 * language, then the default voice.
 */
export function pickVoice(
  voices: readonly Voice[],
  requested: string | undefined,
  language: string | null,
  defaultVoice: string,
): string | undefined {
  const exact = voices.find((voice) => voice.id === requested);
  if (exact) {
    return exact.id;
  }
  const byLanguage = language ? voices.find((voice) => voice.language === language) : undefined;
  if (byLanguage) {
    return byLanguage.id;
  }
  return voices.find((voice) => voice.id === defaultVoice)?.id ?? voices[0]?.id;
}

export function voicePath(dir: string, id: string): string {
  return path.join(dir, `${id}${ONNX}`);
}
