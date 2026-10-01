import * as cheerio from 'cheerio';
import type { Limits } from '~/limits';
import type { FetchFn } from '~/fetch';
import { WebSearchError } from '~/guard';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchOptions {
  fetch?: FetchFn;
  limits: Limits;
  maxResults?: number;
}

export const SEARCH_URL = 'https://html.duckduckgo.com/html/';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) LibreChat-websearch/0.1';
const BLOCKED = 'Search is temporarily blocked by DuckDuckGo; try again in a minute.';

function failure(reason: string): WebSearchError {
  return new WebSearchError(`Search failed: ${reason}. Try again or rephrase.`);
}

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function resolveLink(href: string): string {
  const absolute = href.startsWith('//') ? `https:${href}` : href;
  const url = new URL(absolute, SEARCH_URL);
  const wrapped = url.searchParams.get('uddg');
  return wrapped ?? url.href;
}

function parseResults(body: string, maxResults: number): SearchResult[] | undefined {
  const $ = cheerio.load(body);
  const hits = $('div.result');
  if (hits.length === 0) {
    return $('.no-results').length > 0 ? [] : undefined;
  }
  const results: SearchResult[] = [];
  hits.each((_, el) => {
    if (results.length >= maxResults) {
      return false;
    }
    const node = $(el);
    if (node.hasClass('result--ad')) {
      return;
    }
    const link = node.find('a.result__a').first();
    const href = link.attr('href');
    if (href === undefined) {
      return;
    }
    results.push({
      title: squash(link.text()),
      url: resolveLink(href),
      snippet: squash(node.find('a.result__snippet').first().text()),
    });
  });
  return results;
}

function isBlocked(body: string): boolean {
  return body.includes('challenge-form') || body.includes('bots use DuckDuckGo too');
}

function wrapError(error: unknown, timeoutMs: number): WebSearchError {
  if (error instanceof WebSearchError) {
    return error;
  }
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return failure(`timed out after ${timeoutMs} ms`);
  }
  return failure(error instanceof Error ? error.message : String(error));
}

export async function search(query: string, options: SearchOptions): Promise<SearchResult[]> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const { limits } = options;
  const maxResults = Math.min(options.maxResults ?? limits.maxResults, limits.maxResultsCap);
  try {
    const response = await fetchFn(SEARCH_URL, {
      method: 'POST',
      body: new URLSearchParams({ q: query, b: '' }),
      signal: AbortSignal.timeout(limits.timeoutMs),
      headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
    });
    const body = await response.text();
    const results = parseResults(body, maxResults);
    if (results !== undefined) {
      return results;
    }
    if (isBlocked(body)) {
      process.stderr.write(`websearch: DuckDuckGo bot check (HTTP ${response.status})\n`);
      throw new WebSearchError(BLOCKED);
    }
    if (response.status >= 400) {
      throw failure(`HTTP ${response.status}`);
    }
    process.stderr.write(`websearch: unrecognized DuckDuckGo markup (HTTP ${response.status})\n`);
    throw failure('unexpected response from DuckDuckGo');
  } catch (error) {
    throw wrapError(error, limits.timeoutMs);
  }
}
