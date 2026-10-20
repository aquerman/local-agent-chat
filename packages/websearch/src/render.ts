import type { Browser, BrowserContext, Page, Response, Route } from 'playwright-core';
import type { AddressFilter, Resolver } from '~/guard';
import type { BrowserPool } from '~/browser';
import type { Limits } from '~/limits';
import { assertPublicHttpUrl } from '~/guard';
import { startGuardedProxy } from '~/proxy';
import { WebSearchError } from '~/errors';

export interface RenderOptions {
  browsers: BrowserPool;
  resolve: Resolver;
  isBlocked: AddressFilter;
  limits: Limits;
}

export interface RenderedPage {
  url: URL;
  html: string;
  contentType: string;
}

/** Subresources that cannot add text to the DOM; skipping them saves bytes and time. */
const SKIPPED_RESOURCES = new Set(['image', 'media', 'font']);
/** After the DOM is ready, how long to wait for the network to go quiet (scripts loading data). */
const SETTLE_MS = 5000;

const PRIVATE_HOST = 'loopback, link-local and private hosts are blocked';

/** Records every URL the main frame navigates to, redirect hops included. */
function trackNavigations(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      urls.push(request.url());
    }
  });
  return urls;
}

function failure(reason: string): WebSearchError {
  return new WebSearchError(`Fetch failed: ${reason}`);
}

function formatBytes(bytes: number): string {
  return bytes >= 1_000_000 ? `${bytes / 1_000_000} MB` : `${bytes} bytes`;
}

async function skipNonText(route: Route): Promise<void> {
  if (SKIPPED_RESOURCES.has(route.request().resourceType())) {
    await route.abort('blockedbyclient');
    return;
  }
  await route.continue();
}

async function newReaderContext(
  options: RenderOptions,
  proxyServer: string,
  browser: Browser,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    proxy: { server: proxyServer },
    serviceWorkers: 'block',
    acceptDownloads: false,
    javaScriptEnabled: true,
  });
  context.setDefaultTimeout(options.limits.timeoutMs);
  await context.route('**/*', skipNonText);
  return context;
}

async function settle(page: Page, deadline: number): Promise<void> {
  const remaining = Math.min(deadline - Date.now(), SETTLE_MS);
  if (remaining <= 0) {
    return;
  }
  await page.waitForLoadState('networkidle', { timeout: remaining }).catch(() => undefined);
}

function navigationError(error: unknown, timeoutMs: number): WebSearchError {
  const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
  if (/timeout/i.test(reason)) {
    return failure(`timed out after ${timeoutMs} ms`);
  }
  return failure(reason.replace(/^page\.goto: /, ''));
}

/**
 * Loads `url` in a fresh, cookie-less browser context and returns the DOM after scripts ran.
 * Every connection the browser opens goes through a guarded proxy (see `proxy.ts`), so redirects,
 * subresources and script-initiated requests to loopback, link-local or private hosts are refused
 * and the whole render stops at `maxBytes` of downloads.
 */
export async function renderPage(rawUrl: string, options: RenderOptions): Promise<RenderedPage> {
  const { limits, resolve, isBlocked } = options;
  const url = await assertPublicHttpUrl(rawUrl, resolve, isBlocked);
  const deadline = Date.now() + limits.timeoutMs;
  const proxy = await startGuardedProxy({ resolve, isBlocked, maxBytes: limits.maxBytes });
  try {
    return await options.browsers.use(async (browser) => {
      const context = await newReaderContext(options, proxy.server, browser);
      try {
        const page = await context.newPage();
        const navigations = trackNavigations(page);
        let response: Response | null;
        try {
          response = await page.goto(url.href, {
            waitUntil: 'domcontentloaded',
            timeout: limits.timeoutMs,
          });
        } catch (error) {
          if (proxy.exceeded) {
            throw failure(`response larger than ${formatBytes(limits.maxBytes)}`);
          }
          const refusedHop = navigations.find((hop) =>
            proxy.refused.includes(new URL(hop).hostname),
          );
          if (refusedHop !== undefined) {
            throw new WebSearchError(`Refused to fetch ${refusedHop}: ${PRIVATE_HOST}`);
          }
          throw navigationError(error, limits.timeoutMs);
        }
        const finalUrl = await assertPublicHttpUrl(page.url(), resolve, isBlocked);
        if (response !== null && response.status() >= 400) {
          throw failure(`HTTP ${response.status()}`);
        }
        await settle(page, deadline);
        if (proxy.exceeded) {
          throw failure(`response larger than ${formatBytes(limits.maxBytes)}`);
        }
        const contentType = response?.headers()['content-type'] ?? 'text/html';
        return { url: finalUrl, html: await page.content(), contentType };
      } finally {
        await context.close().catch(() => undefined);
      }
    });
  } finally {
    await proxy.close();
  }
}
