import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_LIMITS } from '~/limits';
import { search, SEARCH_URL } from '~/search';
import type { FetchFn } from '~/fetch';

const limits = { ...DEFAULT_LIMITS, timeoutMs: 200 };

function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

function respondWith(body: string, status = 200): FetchFn {
  return () =>
    Promise.resolve(new Response(body, { status, headers: { 'content-type': 'text/html' } }));
}

describe('search', () => {
  it('parses titles, snippets and urls, skipping ads', async () => {
    const results = await search('q', { fetch: respondWith(fixture('ddg-results.html')), limits });
    expect(results).toEqual([
      {
        title: 'First & best result',
        url: 'https://example.com/first?a=1&b=2',
        snippet: 'A snippet about the first result.',
      },
      {
        title: 'Second result',
        url: 'https://second.example.org/page',
        snippet: 'Direct link, no redirect wrapper.',
      },
      { title: 'Third result', url: 'https://third.example.org/', snippet: '' },
    ]);
  });

  it('decodes redirect links and keeps direct ones', async () => {
    const results = await search('q', { fetch: respondWith(fixture('ddg-results.html')), limits });
    expect(results.map((r) => r.url)).toEqual([
      'https://example.com/first?a=1&b=2',
      'https://second.example.org/page',
      'https://third.example.org/',
    ]);
  });

  it('caps the number of results', async () => {
    const results = await search('q', {
      fetch: respondWith(fixture('ddg-results.html')),
      limits,
      maxResults: 2,
    });
    expect(results).toHaveLength(2);
  });

  it('returns an empty list for no results', async () => {
    await expect(
      search('zzz', { fetch: respondWith(fixture('ddg-empty.html')), limits }),
    ).resolves.toEqual([]);
  });

  it('form-encodes the query and posts to the html endpoint', async () => {
    const fetchFn = jest.fn(respondWith(fixture('ddg-empty.html')));
    await search('café & "bar"', { fetch: fetchFn, limits });
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toBe(SEARCH_URL);
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeInstanceOf(URLSearchParams);
    expect((init?.body as URLSearchParams).get('q')).toBe('café & "bar"');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('reports the bot-check page', async () => {
    await expect(
      search('q', { fetch: respondWith(fixture('ddg-blocked.html'), 202), limits }),
    ).rejects.toThrow('Search is temporarily blocked by DuckDuckGo; try again in a minute.');
  });

  it('does not report blocked when results are present alongside the phrase', async () => {
    const body = fixture('ddg-results.html').replace(
      'Direct link, no redirect wrapper.',
      'Unfortunately, bots use DuckDuckGo too.',
    );
    const results = await search('q', { fetch: respondWith(body), limits });
    expect(results).toHaveLength(3);
  });

  it('reports unknown markup instead of pretending there are no results', async () => {
    const body = '<html><body><div class="totally-new">hello</div></body></html>';
    await expect(search('q', { fetch: respondWith(body), limits })).rejects.toThrow(
      'Search failed: unexpected response from DuckDuckGo. Try again or rephrase.',
    );
  });

  it('reports HTTP errors', async () => {
    await expect(search('q', { fetch: respondWith('oops', 503), limits })).rejects.toThrow(
      'Search failed: HTTP 503. Try again or rephrase.',
    );
  });

  it('reports network errors and timeouts', async () => {
    const failing: FetchFn = () => Promise.reject(new TypeError('fetch failed'));
    await expect(search('q', { fetch: failing, limits })).rejects.toThrow(
      'Search failed: fetch failed. Try again or rephrase.',
    );
    const hanging: FetchFn = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    await expect(search('q', { fetch: hanging, limits })).rejects.toThrow(
      'Search failed: timed out after 200 ms. Try again or rephrase.',
    );
  });
});
