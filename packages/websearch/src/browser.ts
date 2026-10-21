import { chromium } from 'playwright-core';
import type { Browser, LaunchOptions } from 'playwright-core';
import { WebSearchError } from '~/errors';

/** `auto` renders only pages whose static HTML has almost no text; `always` renders every page. */
export type RenderMode = 'auto' | 'always' | 'off';

export interface RenderConfig {
  mode: RenderMode;
  /** Chrome, Edge or Chromium executable; when unset, installed browsers are tried in order. */
  browserPath?: string;
  /** How long an unused browser stays open before it is closed to free memory. */
  idleMs: number;
}

export const DEFAULT_RENDER_CONFIG: RenderConfig = { mode: 'auto', idleMs: 60_000 };

const RENDER_MODES = new Set<string>(['auto', 'always', 'off']);

function isRenderMode(value: string): value is RenderMode {
  return RENDER_MODES.has(value);
}

export function readRenderConfig(env: NodeJS.ProcessEnv): RenderConfig {
  const mode = env.WEBSEARCH_RENDER?.trim().toLowerCase() ?? '';
  const browserPath = env.WEBSEARCH_BROWSER_PATH?.trim();
  return {
    ...DEFAULT_RENDER_CONFIG,
    mode: isRenderMode(mode) ? mode : DEFAULT_RENDER_CONFIG.mode,
    ...(browserPath ? { browserPath } : {}),
  };
}

/** Raised when no browser could be launched; callers fall back to the static fetch. */
export class BrowserUnavailableError extends WebSearchError {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserUnavailableError';
  }
}

export interface BrowserPool {
  /** Runs `task` with a shared headless browser, launching it on first use. */
  use<T>(task: (browser: Browser) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

interface Candidate {
  label: string;
  options: LaunchOptions;
}

/**
 * Chromium flags for a read-only page reader: no WebRTC traffic outside the proxy (it could reach
 * LAN addresses over UDP), and no speculative DNS lookups.
 */
const BROWSER_ARGS = [
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--dns-prefetch-disable',
];

/**
 * Launch order when no path is configured. Windows ships Edge, so it goes first there and nothing
 * has to be downloaded; the Playwright-bundled Chromium (`PLAYWRIGHT_BROWSERS_PATH`) comes first
 * elsewhere.
 */
export function launchCandidates(config: RenderConfig, platform: string): Candidate[] {
  if (config.browserPath !== undefined) {
    return [{ label: config.browserPath, options: { executablePath: config.browserPath } }];
  }
  const edge: Candidate = { label: 'Microsoft Edge', options: { channel: 'msedge' } };
  const chrome: Candidate = { label: 'Google Chrome', options: { channel: 'chrome' } };
  const bundled: Candidate = { label: 'Playwright Chromium', options: {} };
  return platform === 'win32' ? [edge, chrome, bundled] : [bundled, chrome, edge];
}

async function launchFirst(candidates: Candidate[], timeout: number): Promise<Browser> {
  const failures: string[] = [];
  for (const { label, options } of candidates) {
    try {
      const browser = await chromium.launch({
        ...options,
        headless: true,
        timeout,
        args: BROWSER_ARGS,
      });
      process.stderr.write(`websearch: rendering with ${label} ${browser.version()}\n`);
      return browser;
    } catch (error) {
      const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
      failures.push(`${label}: ${reason}`);
    }
  }
  process.stderr.write(`websearch: no browser for rendering (${failures.join('; ')})\n`);
  throw new BrowserUnavailableError('no Chrome, Edge or Chromium could be started');
}

/**
 * Keeps one headless browser for the life of the MCP server and closes it after `idleMs` without
 * use. A failed launch is remembered, so a machine without a browser pays for the attempt once.
 */
export function createBrowserPool(
  config: RenderConfig,
  launchTimeoutMs: number,
  platform: string = process.platform,
): BrowserPool {
  let browser: Promise<Browser> | undefined;
  let unavailable: BrowserUnavailableError | undefined;
  let active = 0;
  let idleTimer: NodeJS.Timeout | undefined;

  const shutdown = async (): Promise<void> => {
    const current = browser;
    browser = undefined;
    if (current === undefined) {
      return;
    }
    await current.then((b) => b.close()).catch(() => undefined);
  };

  const acquire = (): Promise<Browser> => {
    if (unavailable !== undefined) {
      return Promise.reject(unavailable);
    }
    if (browser === undefined) {
      const launching = launchFirst(launchCandidates(config, platform), launchTimeoutMs);
      browser = launching;
      launching.then(
        (b) =>
          b.on('disconnected', () => {
            if (browser === launching) {
              browser = undefined;
            }
          }),
        (error: BrowserUnavailableError) => {
          unavailable = error;
          browser = undefined;
        },
      );
    }
    return browser;
  };

  return {
    async use(task) {
      clearTimeout(idleTimer);
      active += 1;
      try {
        return await task(await acquire());
      } finally {
        active -= 1;
        if (active === 0) {
          idleTimer = setTimeout(() => void shutdown(), config.idleMs);
          idleTimer.unref();
        }
      }
    },
    async close() {
      clearTimeout(idleTimer);
      await shutdown();
    },
  };
}
