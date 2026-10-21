import path from 'node:path';
import type { createConnection } from '@playwright/mcp';
import { parseOrigins, readEnvValue } from '~/origins';

/** Playwright MCP's `Config` (its `config.d.ts` is not in the package's exports map). */
export type PlaywrightConfig = NonNullable<Parameters<typeof createConnection>[0]>;

export interface BrowserSettings {
  /** Sites the browser may open, from BROWSER_ALLOWED_ORIGINS. Empty means none. */
  allowedOrigins: string[];
  /** The dedicated browser profile (cookies, logins), never the user's own profile. */
  profileDir: string;
  /** Playwright channel of an installed browser, `msedge` on Windows by default. */
  channel?: string;
  /** A browser executable; overrides `channel`. */
  executablePath?: string;
  headless: boolean;
  /** Chromium's sandbox. Only a root Linux container needs it off. */
  sandbox: boolean;
  /** Cap on the text of one tool result, in characters (about 4 per token). */
  maxChars: number;
}

export const DEFAULT_MAX_CHARS = 12_000;
export const DEFAULT_PROFILE_DIR = path.join('data', 'browser-profile');

/**
 * Network allow-list used when the user allowed no site: Playwright treats an empty list as
 * "allow everything", so a single unreachable origin stands in for "allow nothing".
 */
export const NOTHING_ALLOWED = 'https://allow-list-is-empty.invalid';

function readFlag(value: string | undefined, fallback: boolean): boolean {
  const flag = readEnvValue(value)?.toLowerCase();
  if (flag === 'true' || flag === '1' || flag === 'yes') {
    return true;
  }
  if (flag === 'false' || flag === '0' || flag === 'no') {
    return false;
  }
  return fallback;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(readEnvValue(value) ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Reads the BROWSER_* variables. On Windows the default is the installed, signed Microsoft Edge
 * in a visible window, so the user sees what the model does and can sign in to a site once in
 * the dedicated profile; elsewhere it is a headless Chromium.
 */
export function readSettings(
  env: NodeJS.ProcessEnv,
  platform: string = process.platform,
  cwd: string = process.cwd(),
): BrowserSettings {
  const isWindows = platform === 'win32';
  const executablePath = readEnvValue(env.BROWSER_EXECUTABLE_PATH);
  const channel = readEnvValue(env.BROWSER_CHANNEL) ?? (isWindows ? 'msedge' : undefined);
  return {
    allowedOrigins: parseOrigins(env.BROWSER_ALLOWED_ORIGINS),
    profileDir: path.resolve(cwd, readEnvValue(env.BROWSER_PROFILE_DIR) ?? DEFAULT_PROFILE_DIR),
    ...(executablePath !== undefined ? { executablePath } : {}),
    ...(executablePath === undefined && channel !== undefined ? { channel } : {}),
    headless: readFlag(env.BROWSER_HEADLESS, !isWindows),
    sandbox: !readFlag(env.BROWSER_NO_SANDBOX, false),
    maxChars: readPositiveInt(env.BROWSER_MAX_CHARS, DEFAULT_MAX_CHARS),
  };
}

type BrowserConfig = NonNullable<PlaywrightConfig['browser']>;

/** Options for `chromium.launchPersistentContext`: Playwright's launch and context options. */
export type LaunchOptions = NonNullable<BrowserConfig['launchOptions']> &
  NonNullable<BrowserConfig['contextOptions']>;

/** How the dedicated profile is opened; this process launches it (see `~/upstream`). */
export function toLaunchOptions(settings: BrowserSettings): LaunchOptions {
  const { channel, executablePath, headless, sandbox } = settings;
  return {
    headless,
    chromiumSandbox: sandbox,
    ...(executablePath !== undefined ? { executablePath } : {}),
    ...(channel !== undefined ? { channel } : {}),
    viewport: { width: 1280, height: 800 },
    serviceWorkers: 'block',
  };
}

/**
 * Playwright MCP configuration. Snapshots are accessibility trees in text and are returned only
 * when the model asks (`snapshot.mode: none` keeps them out of every click and keystroke
 * result); images, generated code and page-registered WebMCP tools are all off.
 */
export function toPlaywrightConfig(settings: BrowserSettings): PlaywrightConfig {
  const { allowedOrigins, profileDir } = settings;
  return {
    browser: { browserName: 'chromium', isolated: false },
    capabilities: ['core'],
    network: { allowedOrigins: allowedOrigins.length > 0 ? allowedOrigins : [NOTHING_ALLOWED] },
    snapshot: { mode: 'none' },
    imageResponses: 'omit',
    codegen: 'none',
    webmcp: false,
    outputDir: path.join(profileDir, '..', 'browser-output'),
    timeouts: { action: 5_000, navigation: 30_000 },
  };
}
