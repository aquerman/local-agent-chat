import os from 'node:os';
import path from 'node:path';

export type PageSize = 'A4' | 'Letter';

export interface BrowserOptions {
  /** A Chrome/Edge/Chromium executable; wins over `channel`. */
  executablePath?: string;
  /** A Playwright channel such as `msedge` or `chrome` (the installed browser, nothing is downloaded). */
  channel?: string;
}

export interface Config {
  /** Where drafts and rendered files are kept between calls. */
  outputDir: string;
  pageSize: PageSize;
  browser: BrowserOptions;
  /** Rendered files above this size are refused instead of being sent to the chat. */
  maxBytes: number;
  /** Most sections (or slides) one document may hold. */
  maxParts: number;
}

export const DEFAULT_MAX_BYTES = 20_000_000;
export const DEFAULT_MAX_PARTS = 200;

function positiveInt(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/**
 * Picks the browser used for PDF printing. Windows always ships Edge, so it is the default there;
 * elsewhere Playwright's own Chromium is used unless a path or channel is configured.
 */
export function readBrowser(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): BrowserOptions {
  const executablePath = nonEmpty(env.DOCUMENTS_BROWSER_PATH);
  if (executablePath !== undefined) {
    return { executablePath };
  }
  const channel = nonEmpty(env.DOCUMENTS_BROWSER_CHANNEL);
  if (channel !== undefined) {
    return { channel };
  }
  return platform === 'win32' ? { channel: 'msedge' } : {};
}

export function readConfig(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): Config {
  const pageSize = env.DOCUMENTS_PAGE_SIZE?.trim().toLowerCase() === 'letter' ? 'Letter' : 'A4';
  return {
    outputDir: nonEmpty(env.DOCUMENTS_DIR) ?? path.join(os.tmpdir(), 'bennychat-documents'),
    pageSize,
    browser: readBrowser(env, platform),
    maxBytes: positiveInt(env.DOCUMENTS_MAX_BYTES) ?? DEFAULT_MAX_BYTES,
    maxParts: positiveInt(env.DOCUMENTS_MAX_SECTIONS) ?? DEFAULT_MAX_PARTS,
  };
}
