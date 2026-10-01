import { DEFAULT_LIMITS } from '~/limits';
import { fetchPage } from '~/fetch';
import type { FetchFn } from '~/fetch';
import type { Resolver } from '~/guard';

const limits = { ...DEFAULT_LIMITS, timeoutMs: 200 };
const resolve: Resolver = async () => ['93.184.216.34'];
const base = { limits, resolve };

function html(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    ...init,
  });
}

function fakeFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): FetchFn {
  return (input, init) => Promise.resolve(handler(String(input), init));
}

const page = `<!doctype html><html><head><title>Hello &amp; welcome</title>
<script>var x = 1;</script><style>p{}</style></head>
<body><nav>Home About</nav><header>Site header</header>
<main><h1>Main heading</h1><p>First   paragraph
with   spaces.</p><p>Second paragraph.</p><ul><li>one</li><li>two</li></ul></main>
<aside>Sidebar</aside><footer>Footer text</footer><noscript>enable js</noscript></body></html>`;

describe('fetchPage', () => {
  it('extracts title and readable text from main, dropping boilerplate', async () => {
    const result = await fetchPage('https://example.com/a', {
      fetch: fakeFetch(() => html(page)),
      ...base,
    });
    expect(result.url).toBe('https://example.com/a');
    expect(result.title).toBe('Hello & welcome');
    expect(result.text).toBe(
      'Main heading\n\nFirst paragraph with spaces.\n\nSecond paragraph.\n\none\ntwo',
    );
    expect(result.truncated).toBe(false);
    expect(result.text).not.toMatch(/Sidebar|Footer|Home About|var x|enable js/);
  });

  it('falls back to body when there is no main or article', async () => {
    const body = '<html><body><p>Only body text here, long enough.</p></body></html>';
    const result = await fetchPage('https://example.com/', {
      fetch: fakeFetch(() => html(body)),
      ...base,
    });
    expect(result.text).toBe('Only body text here, long enough.');
  });

  it('truncates at maxChars and flags it', async () => {
    const body = `<html><body><main><p>${'x'.repeat(500)}</p></main></body></html>`;
    const result = await fetchPage('https://example.com/', {
      fetch: fakeFetch(() => html(body)),
      ...base,
      maxChars: 100,
    });
    expect(result.text).toHaveLength(100);
    expect(result.truncated).toBe(true);
  });

  it('adds a JavaScript hint when little text is extracted', async () => {
    const body = '<html><body><div id="root"></div><p>Loading…</p></body></html>';
    const result = await fetchPage('https://example.com/', {
      fetch: fakeFetch(() => html(body)),
      ...base,
    });
    expect(result.hint).toBe('Page content appears to require JavaScript.');
  });

  it('passes the URL and an abort signal to fetch, with redirects set to manual', async () => {
    const fetchFn = jest.fn(fakeFetch(() => html(page)));
    await fetchPage('https://example.com/a', { fetch: fetchFn, ...base });
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toBe('https://example.com/a');
    expect(init?.redirect).toBe('manual');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses private hosts before calling fetch', async () => {
    const fetchFn = jest.fn(fakeFetch(() => html(page)));
    await expect(fetchPage('http://127.0.0.1:27017/', { fetch: fetchFn, ...base })).rejects.toThrow(
      /Refused to fetch/,
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects non-text content types', async () => {
    const pdf = new Response('%PDF', {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    });
    await expect(
      fetchPage('https://example.com/x.pdf', { fetch: fakeFetch(() => pdf), ...base }),
    ).rejects.toThrow('Not a text page (application/pdf)');
  });

  it('treats a missing content-type as HTML', async () => {
    const bare = new Response(
      '<html><body><p>No header but still a page of text.</p></body></html>',
      { status: 200 },
    );
    bare.headers.delete('content-type');
    const result = await fetchPage('https://example.com/', {
      fetch: fakeFetch(() => bare),
      ...base,
    });
    expect(result.text).toBe('No header but still a page of text.');
  });

  it('reports HTTP errors', async () => {
    await expect(
      fetchPage('https://example.com/missing', {
        fetch: fakeFetch(() => html('nope', { status: 404 })),
        ...base,
      }),
    ).rejects.toThrow('Fetch failed: HTTP 404');
  });

  it('aborts bodies larger than the byte cap', async () => {
    const big = `<html><body><main><p>${'y'.repeat(10_000)}</p></main></body></html>`;
    await expect(
      fetchPage('https://example.com/', {
        fetch: fakeFetch(() => html(big)),
        ...base,
        limits: { ...limits, maxBytes: 1000 },
      }),
    ).rejects.toThrow('Fetch failed: response larger than 2 MB');
  });

  it('follows redirects but re-checks each hop', async () => {
    const fetchFn = jest.fn(
      fakeFetch((url) =>
        url === 'https://example.com/start'
          ? new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:27017/' } })
          : html(page),
      ),
    );
    await expect(
      fetchPage('https://example.com/start', { fetch: fetchFn, ...base }),
    ).rejects.toThrow(/Refused to fetch http:\/\/127\.0\.0\.1:27017\//);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('follows a public redirect and reports the final URL', async () => {
    const fetchFn = fakeFetch((url) =>
      url === 'https://example.com/old'
        ? new Response(null, { status: 301, headers: { location: '/new' } })
        : html(page),
    );
    const result = await fetchPage('https://example.com/old', { fetch: fetchFn, ...base });
    expect(result.url).toBe('https://example.com/new');
  });

  it('gives up after five redirects', async () => {
    const fetchFn = fakeFetch(
      () => new Response(null, { status: 302, headers: { location: '/again' } }),
    );
    await expect(fetchPage('https://example.com/', { fetch: fetchFn, ...base })).rejects.toThrow(
      'Fetch failed: too many redirects',
    );
  });

  it('reports a timeout as a tool failure', async () => {
    const hanging: FetchFn = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    await expect(fetchPage('https://example.com/', { fetch: hanging, ...base })).rejects.toThrow(
      'Fetch failed: timed out after 200 ms',
    );
  });

  it('wraps network errors', async () => {
    const failing: FetchFn = () => Promise.reject(new TypeError('fetch failed'));
    await expect(fetchPage('https://example.com/', { fetch: failing, ...base })).rejects.toThrow(
      'Fetch failed: fetch failed',
    );
  });

  it('refuses a redirect to a loopback name', async () => {
    const fetchFn = jest.fn(
      fakeFetch((url) =>
        url === 'https://example.com/start'
          ? new Response(null, { status: 302, headers: { location: 'http://localhost.:27017/' } })
          : html(page),
      ),
    );
    await expect(
      fetchPage('https://example.com/start', { fetch: fetchFn, ...base }),
    ).rejects.toThrow(/Refused to fetch http:\/\/localhost\.:27017\//);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('refuses a public name that resolves to a private address', async () => {
    const fetchFn = jest.fn(fakeFetch(() => html(page)));
    const toPrivate: Resolver = async () => ['192.168.1.1'];
    await expect(
      fetchPage('https://router.example/', { fetch: fetchFn, limits, resolve: toPrivate }),
    ).rejects.toThrow(/loopback, link-local and private hosts are blocked/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('separates table cells', async () => {
    const body =
      '<html><body><main><table><tr><th>City</th><th>Population</th></tr>' +
      '<tr><td>Paris</td><td>2,100,000</td></tr></table></main></body></html>';
    const result = await fetchPage('https://example.com/', {
      fetch: fakeFetch(() => html(body)),
      ...base,
    });
    expect(result.text).toBe('City Population\nParis 2,100,000');
  });
});
