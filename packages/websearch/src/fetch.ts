import * as cheerio from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import type { Limits } from '~/limits';
import type { Resolver } from '~/guard';
import { assertPublicHttpUrl, defaultResolver, WebSearchError } from '~/guard';

export type FetchFn = typeof globalThis.fetch;

export interface PageContent {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
  hint?: string;
}

export interface FetchOptions {
  fetch?: FetchFn;
  resolve?: Resolver;
  limits: Limits;
  maxChars?: number;
}

const MAX_REDIRECTS = 5;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) LibreChat-websearch/0.1';
const ACCEPT = 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1';
const TEXT_TYPES = /^(text\/|application\/(xhtml\+xml|xml))/;
const BOILERPLATE = 'script, style, nav, header, footer, aside, noscript, iframe, svg, template';
const BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li, tr, pre, blockquote, div, section, article, br';
const PARAGRAPHS = 'p, h1, h2, h3, h4, h5, h6, pre, blockquote';
const CELLS = 'td, th';
const JS_HINT = 'Page content appears to require JavaScript.';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function failure(reason: string): WebSearchError {
  return new WebSearchError(`Fetch failed: ${reason}`);
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (response.body === null) {
    return '';
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw failure('response larger than 2 MB');
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return chunks.join('');
}

interface Downloaded {
  url: URL;
  response: Response;
}

async function download(
  rawUrl: string,
  fetchFn: FetchFn,
  resolve: Resolver,
  limits: Limits,
): Promise<Downloaded> {
  let url = await assertPublicHttpUrl(rawUrl, resolve);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetchFn(url.href, {
      redirect: 'manual',
      signal: AbortSignal.timeout(limits.timeoutMs),
      headers: { 'user-agent': USER_AGENT, accept: ACCEPT },
    });
    const location = response.headers.get('location');
    if (!REDIRECT_STATUSES.has(response.status) || location === null) {
      return { url, response };
    }
    url = await assertPublicHttpUrl(new URL(location, url).href, resolve);
  }
  throw failure('too many redirects');
}

function collapse(text: string): string {
  return text
    .replace(/[^\S\n]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function contentRoot($: CheerioAPI): Cheerio<Element> {
  const main = $('main').first();
  if (main.length > 0) {
    return main;
  }
  const article = $('article').first();
  return article.length > 0 ? article : $('body');
}

function extractText($: CheerioAPI): string {
  $(BOILERPLATE).remove();
  const root = contentRoot($);
  root
    .find('*')
    .addBack()
    .contents()
    .each((_, node) => {
      if (node.type === 'text') {
        node.data = node.data.replace(/\s+/g, ' ');
      }
    });
  root.find(CELLS).each((_, el) => {
    $(el).append(' ');
  });
  root.find(BLOCKS).each((_, el) => {
    $(el).append('\n');
  });
  root.find(PARAGRAPHS).each((_, el) => {
    $(el).prepend('\n').append('\n');
  });
  return collapse(root.text());
}

function wrapError(error: unknown, timeoutMs: number): WebSearchError {
  if (error instanceof WebSearchError) {
    return error;
  }
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return failure(`timed out after ${timeoutMs} ms`);
  }
  const reason = error instanceof Error ? error.message : String(error);
  return failure(reason);
}

export async function fetchPage(rawUrl: string, options: FetchOptions): Promise<PageContent> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const resolve = options.resolve ?? defaultResolver;
  const { limits } = options;
  const maxChars = Math.min(options.maxChars ?? limits.maxChars, limits.maxCharsCap);
  try {
    const { url, response } = await download(rawUrl, fetchFn, resolve, limits);
    if (response.status >= 400) {
      throw failure(`HTTP ${response.status}`);
    }
    const contentType = response.headers.get('content-type') ?? 'text/html';
    if (!TEXT_TYPES.test(contentType)) {
      throw new WebSearchError(`Not a text page (${contentType})`);
    }
    const body = await readCapped(response, limits.maxBytes);
    const $ = cheerio.load(body);
    const title = collapse($('title').first().text());
    const full = extractText($);
    const truncated = full.length > maxChars;
    const text = truncated ? full.slice(0, maxChars) : full;
    const hint = full.length < limits.minUsefulChars ? JS_HINT : undefined;
    return { url: url.href, title, text, truncated, ...(hint !== undefined && { hint }) };
  } catch (error) {
    throw wrapError(error, limits.timeoutMs);
  }
}
