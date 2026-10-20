import type { BrowserPool, RenderMode } from '~/browser';
import type { TestSite } from './helpers/site';
import { createBrowserPool, DEFAULT_RENDER_CONFIG } from '~/browser';
import { fetchViaLoopback, isBlocked, LONG_TEXT, resolve, startSite } from './helpers/site';
import { testBrowserPath } from './helpers/browser';
import { DEFAULT_LIMITS } from '~/limits';
import { fetchPage } from '~/fetch';

const describeWithBrowser = testBrowserPath === undefined ? describe.skip : describe;
const limits = { ...DEFAULT_LIMITS, timeoutMs: 8000 };

describeWithBrowser('fetchPage with a headless browser', () => {
  let site: TestSite;
  let browsers: BrowserPool;

  beforeAll(async () => {
    site = await startSite();
    browsers = createBrowserPool({ ...DEFAULT_RENDER_CONFIG, browserPath: testBrowserPath }, 20000);
  });

  afterAll(async () => {
    await browsers.close();
    await site.close();
  });

  beforeEach(() => {
    site.hits.length = 0;
  });

  const read = (path: string, mode: RenderMode, overrides = {}) =>
    fetchPage(`${site.origin}${path}`, {
      fetch: fetchViaLoopback,
      resolve,
      isBlocked,
      limits: { ...limits, ...overrides },
      render: { mode, browsers },
    });

  it('auto: renders a page whose static HTML has no text, with the same extraction', async () => {
    const page = await read('/js', 'auto');
    expect(page.title).toBe('JS app');
    expect(page.text).toBe(`Loaded heading\n\n${LONG_TEXT}`);
    expect(page.hint).toBeUndefined();
    expect(page.url).toBe(`${site.origin}/js`);
  });

  it('auto: leaves a page with enough static text alone', async () => {
    const usePool = jest.spyOn(browsers, 'use');
    const page = await read('/static', 'auto');
    expect(page.text).toBe(LONG_TEXT);
    expect(usePool).not.toHaveBeenCalled();
  });

  it('off: returns the static text and the JavaScript hint', async () => {
    const page = await read('/js', 'off');
    expect(page.text).toBe('');
    expect(page.hint).toBe('Page content appears to require JavaScript.');
  });

  it('always: renders even a static page', async () => {
    const usePool = jest.spyOn(browsers, 'use');
    const page = await read('/static', 'always');
    expect(page.text).toBe(LONG_TEXT);
    expect(usePool).toHaveBeenCalledTimes(1);
  });

  it('blocks script, iframe and literal requests to private hosts but still renders the page', async () => {
    const page = await read('/leaky', 'always');
    expect(page.text).toBe(LONG_TEXT);
    expect(site.hits.some((hit) => hit.includes('/secret'))).toBe(false);
  });

  it('refuses a redirect to a private host', async () => {
    await expect(read('/to-internal', 'always')).rejects.toThrow(
      /Refused to fetch .*internal\.test/,
    );
    expect(site.hits.some((hit) => hit.includes('/secret'))).toBe(false);
  });

  it('refuses a private start URL before launching anything', async () => {
    await expect(
      fetchPage(`http://internal.test:${site.port}/secret`, {
        resolve,
        isBlocked,
        limits,
        render: { mode: 'always', browsers },
      }),
    ).rejects.toThrow(/Refused to fetch/);
    expect(site.hits).toEqual([]);
  });

  it('caps the bytes a render may download', async () => {
    await expect(read('/heavy', 'always', { maxBytes: 20_000 })).rejects.toThrow(
      'Fetch failed: response larger than 20000 bytes',
    );
  });

  it('auto: keeps the static result and says why when the render fails', async () => {
    const page = await read('/heavy', 'auto', { maxBytes: 20_000 });
    expect(page.text).toBe('');
    expect(page.hint).toMatch(
      /Rendering it failed \(Fetch failed: response larger than 20000 bytes\)/,
    );
  });

  it('times out a page that never answers', async () => {
    await expect(read('/hang', 'always', { timeoutMs: 1500 })).rejects.toThrow(
      'Fetch failed: timed out after 1500 ms',
    );
  });
});
