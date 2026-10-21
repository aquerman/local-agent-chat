import type { FetchFn } from '~/fetch';
import type { Resolver } from '~/guard';
import {
  BrowserUnavailableError,
  createBrowserPool,
  DEFAULT_RENDER_CONFIG,
  launchCandidates,
  readRenderConfig,
} from '~/browser';
import { DEFAULT_LIMITS } from '~/limits';
import { fetchPage } from '~/fetch';

describe('readRenderConfig', () => {
  it('defaults to auto with no browser path', () => {
    expect(readRenderConfig({})).toEqual(DEFAULT_RENDER_CONFIG);
  });

  it.each(['auto', 'always', 'off', ' ALWAYS '])('accepts mode %p', (value) => {
    expect(readRenderConfig({ WEBSEARCH_RENDER: value }).mode).toBe(value.trim().toLowerCase());
  });

  it('falls back to auto for an unknown mode', () => {
    expect(readRenderConfig({ WEBSEARCH_RENDER: 'sometimes' }).mode).toBe('auto');
  });

  it('reads a browser path and ignores a blank one', () => {
    expect(readRenderConfig({ WEBSEARCH_BROWSER_PATH: ' /opt/chrome ' }).browserPath).toBe(
      '/opt/chrome',
    );
    expect(readRenderConfig({ WEBSEARCH_BROWSER_PATH: '  ' })).not.toHaveProperty('browserPath');
  });
});

describe('launchCandidates', () => {
  const labels = (platform: string, browserPath?: string) =>
    launchCandidates({ ...DEFAULT_RENDER_CONFIG, browserPath }, platform).map((c) => c.label);

  it('tries installed Edge first on Windows, so nothing has to be downloaded', () => {
    expect(labels('win32')).toEqual(['Microsoft Edge', 'Google Chrome', 'Playwright Chromium']);
  });

  it('tries the Playwright Chromium first elsewhere', () => {
    expect(labels('linux')).toEqual(['Playwright Chromium', 'Google Chrome', 'Microsoft Edge']);
  });

  it('uses only the configured path when one is set', () => {
    expect(
      launchCandidates({ ...DEFAULT_RENDER_CONFIG, browserPath: '/x/chrome' }, 'win32'),
    ).toEqual([{ label: '/x/chrome', options: { executablePath: '/x/chrome' } }]);
  });
});

describe('without a usable browser', () => {
  const missing = { ...DEFAULT_RENDER_CONFIG, browserPath: '/nonexistent/chrome' };
  const resolve: Resolver = async () => ['93.184.216.34'];
  const limits = { ...DEFAULT_LIMITS, timeoutMs: 2000 };
  const jsOnly = '<html><head><title>App</title></head><body><div id="root"></div></body></html>';
  const fetchFn: FetchFn = async () =>
    new Response(jsOnly, { headers: { 'content-type': 'text/html' } });

  it('the pool reports the browser as unavailable, and remembers it', async () => {
    const pool = createBrowserPool(missing, 2000);
    const task = jest.fn(async () => 'ran');
    await expect(pool.use(task)).rejects.toBeInstanceOf(BrowserUnavailableError);
    await expect(pool.use(task)).rejects.toBeInstanceOf(BrowserUnavailableError);
    expect(task).not.toHaveBeenCalled();
    await pool.close();
  });

  it.each(['auto', 'always'] as const)(
    '%s mode falls back to the static page with a clear note',
    async (mode) => {
      const browsers = createBrowserPool(missing, 2000);
      const page = await fetchPage('https://example.com/app', {
        fetch: fetchFn,
        resolve,
        limits,
        render: { mode, browsers },
      });
      expect(page.title).toBe('App');
      expect(page.hint).toBe(
        'Page content appears to require JavaScript. No browser is available to render it, so this is the page without JavaScript.',
      );
      await browsers.close();
    },
  );
});
