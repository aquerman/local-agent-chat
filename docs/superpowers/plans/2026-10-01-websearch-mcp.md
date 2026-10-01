# Web search MCP server (`packages/websearch`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the local agent a keyless `search` + `fetch` tool pair, served by a new stdio MCP server workspace package that LibreChat launches from `librechat.yaml`.

**Architecture:** A new npm workspace `packages/websearch` builds one CommonJS executable (`dist/index.cjs`) with `tsdown`. It registers two tools on an `McpServer` from `@modelcontextprotocol/sdk` over `StdioServerTransport`. `search` POSTs to DuckDuckGo's HTML endpoint and parses results with `cheerio`; `fetch` downloads a page with Node's built-in `fetch` behind a URL guard and returns readable plain text. Every network module takes an injected `fetch` so tests use fake responses, never HTTP mocks. No LibreChat code changes.

**Tech Stack:** TypeScript 5.9, Node 24 (global `fetch`, `Response`, `AbortSignal.timeout`), `@modelcontextprotocol/sdk` 1.30, `cheerio` 1.2, `zod` 3.25, `tsdown` 0.22, Jest 30 with `babel-jest`.

**Spec:** `docs/superpowers/specs/2026-10-01-websearch-mcp-design.md`

## Global Constraints

- Package name `@librechat/websearch`, directory `packages/websearch`, entry `dist/index.cjs`.
- `search` input `{ query: string, maxResults?: number }`, `maxResults` 1–10, default 5.
- `fetch` input `{ url: string, maxChars?: number }`, default `WEBSEARCH_MAX_CHARS` = 8000, hard cap 20000.
- Timeout `WEBSEARCH_TIMEOUT_MS` = 10000 ms; body cap 2 MB; "requires JavaScript" hint below 200 extracted chars.
- `fetch` refuses non-`http(s)` schemes, loopback, link-local and private hosts, and unparseable URLs before any network call.
- A tool never throws out to the MCP layer: failures return `{ isError: true }` with the exact message strings in the spec's error table.
- Logging to **stderr only**; stdout is the MCP channel.
- Output is plain text, not markdown. Server is stateless.
- Repo rules: no `any`, `import type` standalone, import order per CLAUDE.md, single-word file names, early returns, `npx tsc --noEmit` before calling a task done. Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Package manager is npm; run `npm install` (not `npm ci`) once from the repo root to register the new workspace and update `package-lock.json`.

## Review Focus

1. **Redirects to private hosts** — a public URL that 302s to `http://127.0.0.1:27017` must be refused, not followed. Test in Task 3 (`follows redirects but re-checks each hop`).
2. **DuckDuckGo result links that are already absolute** (no `uddg=` wrapper) must come through unchanged; `//duckduckgo.com/l/?uddg=…` must decode. Test in Task 4 (`decodes redirect links and keeps direct ones`).
3. **Missing `Content-Type` header** — many small servers omit it; the page must still be read as HTML rather than refused. Test in Task 3 (`treats a missing content-type as HTML`).
4. **A fetch that hangs** — the timeout must surface as the spec's error text, not an unhandled rejection. Test in Task 3 (`reports a timeout as a tool failure`).
5. **Unicode and `&` in queries** — form encoding must not corrupt them. Test in Task 4 (`form-encodes the query`).

---

## File structure

```
packages/websearch/
  package.json              workspace manifest, scripts, deps
  tsconfig.json             noEmit typecheck config (tsdown reads it too)
  tsdown.config.mjs         single CJS entry, node platform, deps bundled
  jest.config.mjs           babel-jest transform, ESM deps allowlist
  src/
    index.ts                stdio entry: readLimits(process.env) → createServer → StdioServerTransport
    server.ts               createServer({ fetch, limits }) → McpServer with `search` and `fetch` tools; result formatting
    limits.ts               Limits type, defaults, readLimits(env)
    guard.ts                assertPublicHttpUrl(raw) → URL; WebSearchError
    fetch.ts                fetchPage(url, { fetch, limits, maxChars }) → PageContent
    search.ts               search(query, { fetch, limits, maxResults }) → SearchResult[]
    __tests__/
      limits.test.ts
      guard.test.ts
      fetch.test.ts
      search.test.ts
      server.test.ts
      fixtures/
        ddg-results.html    normal results incl. one ad
        ddg-empty.html      zero results
        ddg-blocked.html    bot-check page
```

`guard.ts` is split out of `fetch.ts` (the spec lists the guards under `fetch`) because `search.ts` reuses `WebSearchError` and the guard has its own test surface.

---

### Task 1: Package scaffold and `limits.ts`

**Files:**
- Create: `packages/websearch/package.json`
- Create: `packages/websearch/tsconfig.json`
- Create: `packages/websearch/tsdown.config.mjs`
- Create: `packages/websearch/jest.config.mjs`
- Create: `packages/websearch/src/limits.ts`
- Create: `packages/websearch/src/index.ts` (placeholder, replaced in Task 6)
- Test: `packages/websearch/src/__tests__/limits.test.ts`
- Modify: `package-lock.json` (by `npm install`)

**Interfaces:**
- Produces:
  ```ts
  export interface Limits {
    maxChars: number;      // default 8000, env WEBSEARCH_MAX_CHARS
    maxCharsCap: number;   // 20000
    timeoutMs: number;     // default 10000, env WEBSEARCH_TIMEOUT_MS
    maxBytes: number;      // 2_000_000
    maxResults: number;    // 5
    maxResultsCap: number; // 10
    minUsefulChars: number;// 200
  }
  export const DEFAULT_LIMITS: Limits;
  export function readLimits(env: NodeJS.ProcessEnv): Limits;
  ```

- [ ] **Step 1: Create the manifest**

`packages/websearch/package.json`:

```json
{
  "name": "@librechat/websearch",
  "version": "0.1.0",
  "private": true,
  "description": "Keyless web search and page fetch tools for LibreChat, served over stdio MCP",
  "type": "commonjs",
  "main": "dist/index.cjs",
  "bin": {
    "librechat-websearch": "dist/index.cjs"
  },
  "files": ["dist"],
  "scripts": {
    "clean": "rimraf dist",
    "build": "npm run clean && tsdown",
    "build:watch": "tsdown --watch",
    "test": "jest --watch",
    "test:ci": "jest --ci",
    "typecheck": "tsc --noEmit",
    "start": "node dist/index.cjs"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.30.0",
    "cheerio": "^1.2.0",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "@babel/core": "^7.29.5",
    "@babel/preset-env": "^7.29.5",
    "@babel/preset-typescript": "^7.21.0",
    "@types/jest": "^29.5.2",
    "@types/node": "^24.12.4",
    "babel-jest": "^30.2.0",
    "jest": "^30.2.0",
    "rimraf": "^6.1.3",
    "tsdown": "^0.22.2",
    "typescript": "^5.9.3"
  }
}
```

- [ ] **Step 2: Create the TypeScript and build configs**

`packages/websearch/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "types": ["node", "jest"],
    "noEmit": true,
    "strict": true,
    "noImplicitAny": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "sourceMap": true,
    "paths": {
      "~/*": ["./src/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

`"lib"` includes `DOM` so `fetch`, `Response`, `Headers` and `AbortSignal` type-check; Node 24 provides them at runtime.

`packages/websearch/tsdown.config.mjs`:

```js
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  platform: 'node',
  outDir: 'dist',
  sourcemap: true,
  dts: false,
  checks: { circularDependency: true },
  // Bundle every dependency: the executable runs as a child process and must not rely on
  // the caller's node_modules layout.
  deps: { onlyBundle: true },
});
```

`packages/websearch/jest.config.mjs`:

```js
import { maxWorkers } from '../../config/jest.workers.cjs';

const esModules = [
  'cheerio',
  'domelementtype',
  'domhandler',
  'dom-serializer',
  'domutils',
  'entities',
  'htmlparser2',
  'parse5',
  'parse5-htmlparser2-tree-adapter',
  'parse5-parser-stream',
].join('|');

export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/__tests__/fixtures/'],
  transform: {
    '\\.[jt]sx?$': [
      'babel-jest',
      {
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' } }],
          '@babel/preset-typescript',
        ],
      },
    ],
  },
  transformIgnorePatterns: [`/node_modules/(?!(${esModules})/).*/`],
  moduleNameMapper: {
    '^~/(.*)$': '<rootDir>/src/$1',
  },
  setupFiles: ['<rootDir>/../../config/jest.setup.logging.cjs'],
  maxWorkers,
  restoreMocks: true,
  testTimeout: 15000,
};
```

If Jest later fails with `SyntaxError: Unexpected token 'export'` naming a package not in `esModules`, add that package name to the list; that is the only tuning this config needs.

- [ ] **Step 3: Write the placeholder entry so the build has an entry file**

`packages/websearch/src/index.ts`:

```ts
process.stderr.write('websearch: not wired yet\n');
```

- [ ] **Step 4: Register the workspace**

Run from the repo root:

```bash
npm install
```

Expected: completes without error; `package-lock.json` gains a `packages/websearch` entry; `node_modules/@librechat/websearch` is a symlink to the package. If npm asks nothing and prints a peer warning about `zod`, ignore it (the SDK accepts zod 3 and 4).

- [ ] **Step 5: Write the failing test for `readLimits`**

`packages/websearch/src/__tests__/limits.test.ts`:

```ts
import { DEFAULT_LIMITS, readLimits } from '~/limits';

describe('readLimits', () => {
  it('returns the defaults when no env is set', () => {
    expect(readLimits({})).toEqual(DEFAULT_LIMITS);
  });

  it('applies WEBSEARCH_MAX_CHARS and WEBSEARCH_TIMEOUT_MS', () => {
    const limits = readLimits({ WEBSEARCH_MAX_CHARS: '4000', WEBSEARCH_TIMEOUT_MS: '2500' });
    expect(limits.maxChars).toBe(4000);
    expect(limits.timeoutMs).toBe(2500);
  });

  it('ignores values that are not positive integers', () => {
    const limits = readLimits({ WEBSEARCH_MAX_CHARS: 'lots', WEBSEARCH_TIMEOUT_MS: '-1' });
    expect(limits.maxChars).toBe(DEFAULT_LIMITS.maxChars);
    expect(limits.timeoutMs).toBe(DEFAULT_LIMITS.timeoutMs);
  });

  it('clamps WEBSEARCH_MAX_CHARS to the hard cap', () => {
    expect(readLimits({ WEBSEARCH_MAX_CHARS: '99999' }).maxChars).toBe(DEFAULT_LIMITS.maxCharsCap);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd packages/websearch && npx jest limits`
Expected: FAIL with `Cannot find module '~/limits'`.

- [ ] **Step 7: Implement `limits.ts`**

`packages/websearch/src/limits.ts`:

```ts
export interface Limits {
  maxChars: number;
  maxCharsCap: number;
  timeoutMs: number;
  maxBytes: number;
  maxResults: number;
  maxResultsCap: number;
  minUsefulChars: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxChars: 8000,
  maxCharsCap: 20000,
  timeoutMs: 10000,
  maxBytes: 2_000_000,
  maxResults: 5,
  maxResultsCap: 10,
  minUsefulChars: 200,
};

function positiveInt(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

export function readLimits(env: NodeJS.ProcessEnv): Limits {
  const maxChars = positiveInt(env.WEBSEARCH_MAX_CHARS);
  const timeoutMs = positiveInt(env.WEBSEARCH_TIMEOUT_MS);
  return {
    ...DEFAULT_LIMITS,
    maxChars: Math.min(maxChars ?? DEFAULT_LIMITS.maxChars, DEFAULT_LIMITS.maxCharsCap),
    timeoutMs: timeoutMs ?? DEFAULT_LIMITS.timeoutMs,
  };
}
```

- [ ] **Step 8: Run the test and the typecheck**

Run: `cd packages/websearch && npx jest limits && npx tsc --noEmit`
Expected: 4 tests PASS; `tsc` prints nothing.

- [ ] **Step 9: Verify the build works end to end**

Run: `cd packages/websearch && npm run build && node dist/index.cjs`
Expected: `dist/index.cjs` exists; running it prints `websearch: not wired yet` on stderr and exits 0.

- [ ] **Step 10: Commit**

```bash
git add packages/websearch package-lock.json
git commit -m "Scaffold @librechat/websearch workspace with configurable limits" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: URL guard (`guard.ts`)

**Files:**
- Create: `packages/websearch/src/guard.ts`
- Test: `packages/websearch/src/__tests__/guard.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export class WebSearchError extends Error {}            // message is the user-facing tool text
  export function assertPublicHttpUrl(raw: string): URL;   // throws WebSearchError
  ```
  The thrown message is always `Refused to fetch <raw>: <reason>` where `<reason>` is one of `invalid URL`, `only http and https are allowed`, `loopback, link-local and private hosts are blocked`.

- [ ] **Step 1: Write the failing tests**

`packages/websearch/src/__tests__/guard.test.ts`:

```ts
import { assertPublicHttpUrl, WebSearchError } from '~/guard';

describe('assertPublicHttpUrl', () => {
  it('returns a URL for a public https address', () => {
    expect(assertPublicHttpUrl('https://example.com/a?b=1').href).toBe('https://example.com/a?b=1');
  });

  it('rejects unparseable input', () => {
    expect(() => assertPublicHttpUrl('not a url')).toThrow(
      new WebSearchError('Refused to fetch not a url: invalid URL'),
    );
  });

  it.each(['ftp://example.com/x', 'file:///etc/passwd', 'javascript:alert(1)'])(
    'rejects non-http scheme %s',
    (raw) => {
      expect(() => assertPublicHttpUrl(raw)).toThrow(/only http and https are allowed/);
    },
  );

  it.each([
    'http://localhost:3080/',
    'http://api.localhost/',
    'http://127.0.0.1:27017/',
    'http://127.5.5.5/',
    'http://10.0.0.1/',
    'http://172.16.0.1/',
    'http://172.31.255.254/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data',
    'http://0.0.0.0/',
    'http://[::1]/',
    'http://[fe80::1]/',
    'http://[fd00::1]/',
    'http://[::ffff:127.0.0.1]/',
  ])('rejects private or loopback host %s', (raw) => {
    expect(() => assertPublicHttpUrl(raw)).toThrow(/loopback, link-local and private hosts are blocked/);
  });

  it.each(['http://172.32.0.1/', 'http://8.8.8.8/', 'http://[2606:4700::1111]/'])(
    'allows public literal %s',
    (raw) => {
      expect(() => assertPublicHttpUrl(raw)).not.toThrow();
    },
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/websearch && npx jest guard`
Expected: FAIL with `Cannot find module '~/guard'`.

- [ ] **Step 3: Implement `guard.ts`**

`packages/websearch/src/guard.ts`:

```ts
import { isIPv4, isIPv6 } from 'node:net';

export class WebSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebSearchError';
  }
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

function isPrivateIPv4(address: string): boolean {
  const [a, b] = address.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  return a === 192 && b === 168;
}

function isPrivateIPv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === '::1' || lower === '::') {
    return true;
  }
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    return isPrivateIPv4(mapped[1]);
  }
  return lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return true;
  }
  if (isIPv4(host)) {
    return isPrivateIPv4(host);
  }
  const bare = host.startsWith('[') ? host.slice(1, -1) : host;
  if (isIPv6(bare)) {
    return isPrivateIPv6(bare);
  }
  return false;
}

function refuse(raw: string, reason: string): never {
  throw new WebSearchError(`Refused to fetch ${raw}: ${reason}`);
}

export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return refuse(raw, 'invalid URL');
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return refuse(raw, 'only http and https are allowed');
  }
  if (isPrivateHost(url.hostname)) {
    return refuse(raw, 'loopback, link-local and private hosts are blocked');
  }
  return url;
}
```

Hostnames that *resolve* to private addresses (DNS rebinding) are out of scope; the guard checks literals and `localhost` names only, as the spec states.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `cd packages/websearch && npx jest guard && npx tsc --noEmit`
Expected: all PASS; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add packages/websearch/src/guard.ts packages/websearch/src/__tests__/guard.test.ts
git commit -m "Add public-URL guard for websearch fetch" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Page download and extraction (`fetch.ts`)

**Files:**
- Create: `packages/websearch/src/fetch.ts`
- Test: `packages/websearch/src/__tests__/fetch.test.ts`

**Interfaces:**
- Consumes: `assertPublicHttpUrl`, `WebSearchError` from `~/guard`; `Limits` from `~/limits`.
- Produces:
  ```ts
  export type FetchFn = typeof globalThis.fetch;
  export interface PageContent { url: string; title: string; text: string; truncated: boolean; hint?: string }
  export interface FetchOptions { fetch?: FetchFn; limits: Limits; maxChars?: number }
  export function fetchPage(rawUrl: string, options: FetchOptions): Promise<PageContent>;
  ```
  Throws `WebSearchError` with: `Refused to fetch …` (from the guard), `Not a text page (<content-type>)`, `Fetch failed: HTTP <status>`, `Fetch failed: response larger than 2 MB`, `Fetch failed: timed out after <ms> ms`, `Fetch failed: <reason>`, `Fetch failed: too many redirects`.
  `hint` is `Page content appears to require JavaScript.` when `text.length < limits.minUsefulChars`.

- [ ] **Step 1: Write the failing tests**

`packages/websearch/src/__tests__/fetch.test.ts`:

```ts
import { DEFAULT_LIMITS } from '~/limits';
import { fetchPage } from '~/fetch';
import type { FetchFn } from '~/fetch';

const limits = { ...DEFAULT_LIMITS, timeoutMs: 200 };

function html(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    ...init,
  });
}

function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): FetchFn {
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
    const result = await fetchPage('https://example.com/a', { fetch: fakeFetch(() => html(page)), limits });
    expect(result.url).toBe('https://example.com/a');
    expect(result.title).toBe('Hello & welcome');
    expect(result.text).toBe('Main heading\n\nFirst paragraph with spaces.\n\nSecond paragraph.\n\none\ntwo');
    expect(result.truncated).toBe(false);
    expect(result.text).not.toMatch(/Sidebar|Footer|Home About|var x|enable js/);
  });

  it('falls back to body when there is no main or article', async () => {
    const body = '<html><body><p>Only body text here, long enough.</p></body></html>';
    const result = await fetchPage('https://example.com/', { fetch: fakeFetch(() => html(body)), limits });
    expect(result.text).toBe('Only body text here, long enough.');
  });

  it('truncates at maxChars and flags it', async () => {
    const body = `<html><body><main><p>${'x'.repeat(500)}</p></main></body></html>`;
    const result = await fetchPage('https://example.com/', {
      fetch: fakeFetch(() => html(body)),
      limits,
      maxChars: 100,
    });
    expect(result.text).toHaveLength(100);
    expect(result.truncated).toBe(true);
  });

  it('adds a JavaScript hint when little text is extracted', async () => {
    const body = '<html><body><div id="root"></div><p>Loading…</p></body></html>';
    const result = await fetchPage('https://example.com/', { fetch: fakeFetch(() => html(body)), limits });
    expect(result.hint).toBe('Page content appears to require JavaScript.');
  });

  it('passes the URL and an abort signal to fetch, with redirects set to manual', async () => {
    const fetchFn = jest.fn(fakeFetch(() => html(page)));
    await fetchPage('https://example.com/a', { fetch: fetchFn, limits });
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toBe('https://example.com/a');
    expect(init?.redirect).toBe('manual');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses private hosts before calling fetch', async () => {
    const fetchFn = jest.fn(fakeFetch(() => html(page)));
    await expect(fetchPage('http://127.0.0.1:27017/', { fetch: fetchFn, limits })).rejects.toThrow(
      /Refused to fetch/,
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects non-text content types', async () => {
    const pdf = new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } });
    await expect(fetchPage('https://example.com/x.pdf', { fetch: fakeFetch(() => pdf), limits })).rejects.toThrow(
      'Not a text page (application/pdf)',
    );
  });

  it('treats a missing content-type as HTML', async () => {
    const bare = new Response('<html><body><p>No header but still a page of text.</p></body></html>', { status: 200 });
    const result = await fetchPage('https://example.com/', { fetch: fakeFetch(() => bare), limits });
    expect(result.text).toBe('No header but still a page of text.');
  });

  it('reports HTTP errors', async () => {
    await expect(
      fetchPage('https://example.com/missing', { fetch: fakeFetch(() => html('nope', { status: 404 })), limits }),
    ).rejects.toThrow('Fetch failed: HTTP 404');
  });

  it('aborts bodies larger than the byte cap', async () => {
    const big = `<html><body><main><p>${'y'.repeat(10_000)}</p></main></body></html>`;
    await expect(
      fetchPage('https://example.com/', { fetch: fakeFetch(() => html(big)), limits: { ...limits, maxBytes: 1000 } }),
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
    await expect(fetchPage('https://example.com/start', { fetch: fetchFn, limits })).rejects.toThrow(
      /Refused to fetch http:\/\/127\.0\.0\.1:27017\//,
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('follows a public redirect and reports the final URL', async () => {
    const fetchFn = fakeFetch((url) =>
      url === 'https://example.com/old'
        ? new Response(null, { status: 301, headers: { location: '/new' } })
        : html(page),
    );
    const result = await fetchPage('https://example.com/old', { fetch: fetchFn, limits });
    expect(result.url).toBe('https://example.com/new');
  });

  it('gives up after five redirects', async () => {
    const fetchFn = fakeFetch(() => new Response(null, { status: 302, headers: { location: '/again' } }));
    await expect(fetchPage('https://example.com/', { fetch: fetchFn, limits })).rejects.toThrow(
      'Fetch failed: too many redirects',
    );
  });

  it('reports a timeout as a tool failure', async () => {
    const hanging: FetchFn = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    await expect(fetchPage('https://example.com/', { fetch: hanging, limits })).rejects.toThrow(
      'Fetch failed: timed out after 200 ms',
    );
  });

  it('wraps network errors', async () => {
    const failing: FetchFn = () => Promise.reject(new TypeError('fetch failed'));
    await expect(fetchPage('https://example.com/', { fetch: failing, limits })).rejects.toThrow(
      'Fetch failed: fetch failed',
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/websearch && npx jest fetch.test`
Expected: FAIL with `Cannot find module '~/fetch'`.

- [ ] **Step 3: Implement `fetch.ts`**

`packages/websearch/src/fetch.ts`:

```ts
import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { Limits } from '~/limits';
import { assertPublicHttpUrl, WebSearchError } from '~/guard';

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
  limits: Limits;
  maxChars?: number;
}

const MAX_REDIRECTS = 5;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) LibreChat-websearch/0.1';
const TEXT_TYPES = /^(text\/|application\/(xhtml\+xml|xml))/;
const BOILERPLATE = 'script, style, nav, header, footer, aside, noscript, iframe, svg, template';
const BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li, tr, pre, blockquote, div, section, article, br';
const PARAGRAPHS = 'p, h1, h2, h3, h4, h5, h6, pre, blockquote';
const JS_HINT = 'Page content appears to require JavaScript.';

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

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

async function download(rawUrl: string, options: Required<Pick<FetchOptions, 'fetch' | 'limits'>>): Promise<{ url: URL; response: Response }> {
  let url = assertPublicHttpUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await options.fetch(url.href, {
      redirect: 'manual',
      signal: AbortSignal.timeout(options.limits.timeoutMs),
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1' },
    });
    const location = response.headers.get('location');
    if (!isRedirect(response.status) || location === null) {
      return { url, response };
    }
    url = assertPublicHttpUrl(new URL(location, url).href);
  }
  throw failure('too many redirects');
}

function collapse(text: string): string {
  return text
    .replace(/[ \t\r\f\v\u00a0]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractText($: CheerioAPI): string {
  $(BOILERPLATE).remove();
  const main = $('main').first();
  const article = $('article').first();
  const root = main.length > 0 ? main : article.length > 0 ? article : $('body');
  root
    .find('*')
    .addBack()
    .contents()
    .each((_, node) => {
      if (node.type === 'text') {
        node.data = node.data.replace(/\s+/g, ' ');
      }
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
  const { limits } = options;
  const maxChars = Math.min(options.maxChars ?? limits.maxChars, limits.maxCharsCap);
  try {
    const { url, response } = await download(rawUrl, { fetch: fetchFn, limits });
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
```

- [ ] **Step 4: Run the tests and fix extraction details until they pass**

Run: `cd packages/websearch && npx jest fetch.test`
Expected: all PASS. The first test's exact expected string is the contract; if `collapse`/`extractText` produce extra blank lines around `li` items, adjust the `BLOCKS` handling (list items get a single `\n`, headings and paragraphs get `\n` before and after), not the test.

- [ ] **Step 5: Typecheck**

Run: `cd packages/websearch && npx tsc --noEmit`
Expected: no output. If `DOMException` is unknown, add `"DOM"` to `lib` in `tsconfig.json` (Task 1 already did).

- [ ] **Step 6: Commit**

```bash
git add packages/websearch/src/fetch.ts packages/websearch/src/__tests__/fetch.test.ts
git commit -m "Add guarded page fetch with readable-text extraction" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: DuckDuckGo search (`search.ts`)

**Files:**
- Create: `packages/websearch/src/search.ts`
- Create: `packages/websearch/src/__tests__/fixtures/ddg-results.html`
- Create: `packages/websearch/src/__tests__/fixtures/ddg-empty.html`
- Create: `packages/websearch/src/__tests__/fixtures/ddg-blocked.html`
- Test: `packages/websearch/src/__tests__/search.test.ts`

**Interfaces:**
- Consumes: `WebSearchError` from `~/guard`; `Limits` from `~/limits`; `FetchFn` from `~/fetch`.
- Produces:
  ```ts
  export interface SearchResult { title: string; url: string; snippet: string }
  export interface SearchOptions { fetch?: FetchFn; limits: Limits; maxResults?: number }
  export function search(query: string, options: SearchOptions): Promise<SearchResult[]>;
  export const SEARCH_URL = 'https://html.duckduckgo.com/html/';
  ```
  Throws `WebSearchError` with `Search failed: <reason>. Try again or rephrase.` or `Search is temporarily blocked by DuckDuckGo; try again in a minute.` Zero results returns `[]`.

- [ ] **Step 1: Write the fixtures**

These mirror the markup DuckDuckGo's HTML endpoint serves as of 2026: each hit is a `div.result` with `a.result__a` (title, wrapped link) and `a.result__snippet`; ads carry `result--ad`; an empty search renders `div.no-results`. Keep the fixtures minimal; they are contracts for the parser, and a real markup change is a fixture refresh.

`packages/websearch/src/__tests__/fixtures/ddg-results.html`:

```html
<!DOCTYPE html>
<html><head><title>q at DuckDuckGo</title></head>
<body>
<div id="links" class="results">
  <div class="result results_links results_links_deep web-result">
    <div class="links_main links_deep result__body">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Ffirst%3Fa%3D1%26b%3D2&amp;rut=abc">First &amp; best result</a>
      </h2>
      <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Ffirst&amp;rut=abc">A <b>snippet</b> about the first
        result.</a>
    </div>
  </div>
  <div class="result results_links results_links_deep result--ad">
    <div class="links_main links_deep result__body">
      <h2 class="result__title"><a rel="nofollow" class="result__a" href="https://ads.example.net/buy">Buy things</a></h2>
      <a class="result__snippet" href="https://ads.example.net/buy">Sponsored.</a>
    </div>
  </div>
  <div class="result results_links results_links_deep web-result">
    <div class="links_main links_deep result__body">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="https://second.example.org/page">Second result</a>
      </h2>
      <a class="result__snippet" href="https://second.example.org/page">Direct link, no redirect wrapper.</a>
    </div>
  </div>
  <div class="result results_links results_links_deep web-result">
    <div class="links_main links_deep result__body">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fthird.example.org%2F&amp;rut=def">Third result</a>
      </h2>
    </div>
  </div>
</div>
</body></html>
```

`packages/websearch/src/__tests__/fixtures/ddg-empty.html`:

```html
<!DOCTYPE html>
<html><head><title>q at DuckDuckGo</title></head>
<body>
<div id="links" class="results">
  <div class="no-results">No results.</div>
</div>
</body></html>
```

`packages/websearch/src/__tests__/fixtures/ddg-blocked.html`:

```html
<!DOCTYPE html>
<html><head><title>DuckDuckGo</title></head>
<body>
<div class="anomaly-modal__title">Unfortunately, bots use DuckDuckGo too.</div>
<form id="challenge-form" action="/html/" method="post"><input type="hidden" name="q" value="q"></form>
</body></html>
```

- [ ] **Step 2: Write the failing tests**

`packages/websearch/src/__tests__/search.test.ts`:

```ts
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
  return () => Promise.resolve(new Response(body, { status, headers: { 'content-type': 'text/html' } }));
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
      { title: 'Second result', url: 'https://second.example.org/page', snippet: 'Direct link, no redirect wrapper.' },
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
    const results = await search('q', { fetch: respondWith(fixture('ddg-results.html')), limits, maxResults: 2 });
    expect(results).toHaveLength(2);
  });

  it('returns an empty list for no results', async () => {
    await expect(search('zzz', { fetch: respondWith(fixture('ddg-empty.html')), limits })).resolves.toEqual([]);
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
    await expect(search('q', { fetch: respondWith(fixture('ddg-blocked.html'), 202), limits })).rejects.toThrow(
      'Search is temporarily blocked by DuckDuckGo; try again in a minute.',
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd packages/websearch && npx jest search`
Expected: FAIL with `Cannot find module '~/search'`.

- [ ] **Step 4: Implement `search.ts`**

`packages/websearch/src/search.ts`:

```ts
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

function parseResults(body: string, maxResults: number): SearchResult[] {
  const $ = cheerio.load(body);
  const results: SearchResult[] = [];
  $('div.result').each((_, el) => {
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
    if (isBlocked(body)) {
      process.stderr.write(`websearch: DuckDuckGo bot check (HTTP ${response.status})\n`);
      throw new WebSearchError(BLOCKED);
    }
    if (response.status >= 400) {
      throw failure(`HTTP ${response.status}`);
    }
    return parseResults(body, maxResults);
  } catch (error) {
    throw wrapError(error, limits.timeoutMs);
  }
}
```

The `b: ''` form field matches what DuckDuckGo's own HTML form submits; the endpoint tolerates its absence, but sending it keeps the request shaped like a browser's.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `cd packages/websearch && npx jest search && npx tsc --noEmit`
Expected: all PASS; no `tsc` output. If `node_modules/cheerio` fails to load under Jest with an `export` syntax error naming a dependency, add that dependency's name to `esModules` in `jest.config.mjs`.

- [ ] **Step 6: Commit**

```bash
git add packages/websearch/src/search.ts packages/websearch/src/__tests__/search.test.ts packages/websearch/src/__tests__/fixtures
git commit -m "Add DuckDuckGo HTML search with fixture-backed parser" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: MCP server with both tools (`server.ts`)

**Files:**
- Create: `packages/websearch/src/server.ts`
- Test: `packages/websearch/src/__tests__/server.test.ts`

**Interfaces:**
- Consumes: `search`, `SearchResult` from `~/search`; `fetchPage`, `PageContent`, `FetchFn` from `~/fetch`; `WebSearchError` from `~/guard`; `Limits` from `~/limits`.
- Produces:
  ```ts
  export interface ServerOptions { fetch?: FetchFn; limits: Limits }
  export function createServer(options: ServerOptions): McpServer;
  export function formatSearch(query: string, results: SearchResult[]): string;
  export function formatPage(page: PageContent): string;
  ```
  Tool names: `search`, `fetch`. Result shape on success: `{ content: [{ type: 'text', text }] }`; on failure `{ content: [{ type: 'text', text: message }], isError: true }`.

- [ ] **Step 1: Write the failing tests**

`packages/websearch/src/__tests__/server.test.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DEFAULT_LIMITS } from '~/limits';
import { createServer, formatPage, formatSearch } from '~/server';
import type { FetchFn } from '~/fetch';

const limits = { ...DEFAULT_LIMITS, timeoutMs: 200 };

function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

const page = `<html><head><title>Example</title></head><body><main><p>${'Example page text. '.repeat(20)}</p></main></body></html>`;

const routed: FetchFn = (input) => {
  const url = String(input);
  if (url.startsWith('https://html.duckduckgo.com/')) {
    return Promise.resolve(new Response(fixture('ddg-results.html'), { headers: { 'content-type': 'text/html' } }));
  }
  if (url === 'https://example.com/first?a=1&b=2') {
    return Promise.resolve(new Response(page, { headers: { 'content-type': 'text/html' } }));
  }
  return Promise.resolve(new Response('nope', { status: 404 }));
};

interface TextResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

async function connect(fetchFn: FetchFn = routed): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({ fetch: fetchFn, limits });
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<TextResult> {
  return (await client.callTool({ name, arguments: args })) as TextResult;
}

describe('createServer', () => {
  it('lists search and fetch with descriptions', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['fetch', 'search']);
    for (const tool of tools) {
      expect(tool.description).toMatch(/\w+ \w+/);
    }
  });

  it('search returns a numbered list', async () => {
    const client = await connect();
    const result = await call(client, 'search', { query: 'q', maxResults: 2 });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe(
      [
        'Results for: q',
        '',
        '1. First & best result',
        '   https://example.com/first?a=1&b=2',
        '   A snippet about the first result.',
        '',
        '2. Second result',
        '   https://second.example.org/page',
        '   Direct link, no redirect wrapper.',
      ].join('\n'),
    );
  });

  it('search reports zero results as a normal result', async () => {
    const empty: FetchFn = () =>
      Promise.resolve(new Response(fixture('ddg-empty.html'), { headers: { 'content-type': 'text/html' } }));
    const client = await connect(empty);
    const result = await call(client, 'search', { query: 'zzz' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe('No results for: zzz');
  });

  it('fetch returns title, url and text', async () => {
    const client = await connect();
    const result = await call(client, 'fetch', { url: 'https://example.com/first?a=1&b=2', maxChars: 50 });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe(
      `Example\nhttps://example.com/first?a=1&b=2\n\n${'Example page text. '.repeat(20).trim().slice(0, 50)}\n\n[truncated at 50 chars]`,
    );
  });

  it('turns a WebSearchError into an isError text result', async () => {
    const client = await connect();
    const result = await call(client, 'fetch', { url: 'http://127.0.0.1:27017/' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'Refused to fetch http://127.0.0.1:27017/: loopback, link-local and private hosts are blocked',
    );
  });

  it('turns an HTTP failure into an isError text result', async () => {
    const client = await connect();
    const result = await call(client, 'fetch', { url: 'https://example.com/missing' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Fetch failed: HTTP 404');
  });

  it('rejects out-of-range arguments at the schema', async () => {
    const client = await connect();
    const result = await call(client, 'search', { query: 'q', maxResults: 50 });
    expect(result.isError).toBe(true);
  });
});

describe('formatters', () => {
  it('formatSearch handles an empty snippet', () => {
    expect(formatSearch('q', [{ title: 'T', url: 'https://t.example/', snippet: '' }])).toBe(
      'Results for: q\n\n1. T\n   https://t.example/',
    );
  });

  it('formatPage appends the JavaScript hint', () => {
    expect(
      formatPage({ url: 'https://x.example/', title: 'X', text: 'short', truncated: false, hint: 'Page content appears to require JavaScript.' }),
    ).toBe('X\nhttps://x.example/\n\nshort\n\nPage content appears to require JavaScript.');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/websearch && npx jest server`
Expected: FAIL with `Cannot find module '~/server'`.

- [ ] **Step 3: Implement `server.ts`**

`packages/websearch/src/server.ts`:

```ts
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { PageContent, FetchFn } from '~/fetch';
import type { SearchResult } from '~/search';
import type { Limits } from '~/limits';
import { WebSearchError } from '~/guard';
import { fetchPage } from '~/fetch';
import { search } from '~/search';

export interface ServerOptions {
  fetch?: FetchFn;
  limits: Limits;
}

const SEARCH_DESCRIPTION =
  'Search the web with DuckDuckGo. Returns a numbered list of results with title, URL and snippet. ' +
  'Use this first to find pages; then call fetch on the most relevant URL to read it before answering.';

const FETCH_DESCRIPTION =
  'Download a web page and return its readable text (title, URL, then the main content). ' +
  'Use it on a URL from search results before answering from that page. Only http and https URLs on public hosts are allowed.';

function text(value: string): CallToolResult {
  return { content: [{ type: 'text', text: value }] };
}

function error(value: string): CallToolResult {
  return { content: [{ type: 'text', text: value }], isError: true };
}

function toMessage(err: unknown, fallback: string): string {
  if (err instanceof WebSearchError) {
    return err.message;
  }
  const reason = err instanceof Error ? err.message : String(err);
  process.stderr.write(`websearch: unexpected error: ${reason}\n`);
  return `${fallback}: ${reason}`;
}

export function formatSearch(query: string, results: SearchResult[]): string {
  if (results.length === 0) {
    return `No results for: ${query}`;
  }
  const lines = results.map((result, index) => {
    const head = `${index + 1}. ${result.title}\n   ${result.url}`;
    return result.snippet === '' ? head : `${head}\n   ${result.snippet}`;
  });
  return [`Results for: ${query}`, ...lines].join('\n\n');
}

export function formatPage(page: PageContent): string {
  const parts = [`${page.title}\n${page.url}`, page.text];
  if (page.truncated) {
    parts.push(`[truncated at ${page.text.length} chars]`);
  }
  if (page.hint !== undefined) {
    parts.push(page.hint);
  }
  return parts.join('\n\n');
}

export function createServer(options: ServerOptions): McpServer {
  const { limits } = options;
  const fetchFn = options.fetch ?? globalThis.fetch;
  const server = new McpServer({ name: 'librechat-websearch', version: '0.1.0' });

  server.registerTool(
    'search',
    {
      title: 'Web search',
      description: SEARCH_DESCRIPTION,
      inputSchema: {
        query: z.string().min(1).describe('What to search for'),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(limits.maxResultsCap)
          .optional()
          .describe(`How many results to return (default ${limits.maxResults})`),
      },
    },
    async ({ query, maxResults }) => {
      try {
        const results = await search(query, { fetch: fetchFn, limits, maxResults });
        return text(formatSearch(query, results));
      } catch (err) {
        return error(toMessage(err, 'Search failed'));
      }
    },
  );

  server.registerTool(
    'fetch',
    {
      title: 'Fetch page',
      description: FETCH_DESCRIPTION,
      inputSchema: {
        url: z.string().min(1).describe('The http or https URL to read'),
        maxChars: z
          .number()
          .int()
          .min(1)
          .max(limits.maxCharsCap)
          .optional()
          .describe(`Maximum characters of page text to return (default ${limits.maxChars})`),
      },
    },
    async ({ url, maxChars }) => {
      try {
        const page = await fetchPage(url, { fetch: fetchFn, limits, maxChars });
        return text(formatPage(page));
      } catch (err) {
        return error(toMessage(err, 'Fetch failed'));
      }
    },
  );

  return server;
}
```

`formatSearch` joins the header and each multi-line entry with one blank line, which is exactly the string the Task 5 test expects.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `cd packages/websearch && npx jest server && npx tsc --noEmit`
Expected: all PASS; no `tsc` output. If the SDK import under Jest fails with an ESM error, add `@modelcontextprotocol` to `esModules` in `jest.config.mjs` — but the SDK ships CJS under `dist/cjs`, so this should not be needed.

- [ ] **Step 5: Run the whole suite**

Run: `cd packages/websearch && npx jest`
Expected: all five test files PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/websearch/src/server.ts packages/websearch/src/__tests__/server.test.ts
git commit -m "Register search and fetch tools on an MCP server" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Stdio entry point and built-artifact smoke test

**Files:**
- Modify: `packages/websearch/src/index.ts` (replace the placeholder)
- Test: manual, with the MCP Inspector and a stdio client script in the scratchpad

**Interfaces:**
- Consumes: `createServer` from `~/server`, `readLimits` from `~/limits`.
- Produces: `dist/index.cjs`, runnable as `node packages/websearch/dist/index.cjs` from the repo root.

- [ ] **Step 1: Write the entry point**

`packages/websearch/src/index.ts`:

```ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '~/server';
import { readLimits } from '~/limits';

async function main(): Promise<void> {
  const limits = readLimits(process.env);
  const server = createServer({ limits });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`websearch: ready (maxChars=${limits.maxChars}, timeoutMs=${limits.timeoutMs})\n`);
}

main().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  process.stderr.write(`websearch: fatal: ${reason}\n`);
  process.exit(1);
});
```

- [ ] **Step 2: Build and typecheck**

Run: `cd packages/websearch && npx tsc --noEmit && npm run build`
Expected: no `tsc` output; `dist/index.cjs` and `dist/index.cjs.map` exist. Confirm nothing writes to stdout at startup:

```bash
cd packages/websearch && node -e "const {spawnSync}=require('node:child_process');const r=spawnSync('node',['dist/index.cjs'],{input:'',timeout:2000});console.log(JSON.stringify({stdout:r.stdout.toString(),stderr:r.stderr.toString()}))"
```

Expected: `stdout` is `""`; `stderr` contains `websearch: ready`.

- [ ] **Step 3: Smoke-test the built artifact over real stdio**

Write `C:\Users\aquerman\AppData\Local\Temp\claude\C--Users-aquerman-Documents-GitHub-local-agent-chat\59d5b0c7-eb84-4d72-9e27-1933e6c6860f\scratchpad\smoke.cjs` (throwaway, not committed):

```js
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

(async () => {
  const transport = new StdioClientTransport({ command: 'node', args: ['packages/websearch/dist/index.cjs'] });
  const client = new Client({ name: 'smoke', version: '0.0.0' });
  await client.connect(transport);
  const { tools } = await client.listTools();
  console.log('tools:', tools.map((t) => t.name));
  const found = await client.callTool({ name: 'search', arguments: { query: 'llama.cpp jinja tool calling', maxResults: 3 } });
  console.log(found.content[0].text);
  const page = await client.callTool({ name: 'fetch', arguments: { url: 'https://example.com/', maxChars: 300 } });
  console.log(page.content[0].text);
  await client.close();
})();
```

Run from the repo root: `node "<scratchpad>/smoke.cjs"`
Expected: `tools: [ 'search', 'fetch' ]`, three numbered DuckDuckGo results, then `Example Domain` text. If DuckDuckGo returns the bot-check text instead, wait a minute and rerun; that path is expected to be rare for a single user.

- [ ] **Step 4: Try the MCP Inspector (optional but documented)**

Run from the repo root: `npx @modelcontextprotocol/inspector node packages/websearch/dist/index.cjs`
Expected: a browser tab opens listing both tools; calling `search` returns results. This is the command the docs will reference.

- [ ] **Step 5: Commit**

```bash
git add packages/websearch/src/index.ts
git commit -m "Serve websearch tools over stdio" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Wire into LibreChat, verify with Qwen, document

**Files:**
- Modify: `librechat.yaml` (git-ignored local config, repo root) — add `mcpServers`
- Modify: `CLAUDE.md` — fork section, new "Web search" subsection after "Starting a session"
- Modify: `../local-llm/CLAUDE.md:111` — the validated-models "Notes" cell
- Modify: `scripts/start-chat.bat` only if the build step below shows it needed (it should not: `npm run build` already builds every workspace)

- [ ] **Step 1: Add the server to `librechat.yaml`**

Append to the repo-root `librechat.yaml` (top level, same indentation as `endpoints:`):

```yaml
mcpServers:
  websearch:
    type: stdio
    command: node
    args: ['packages/websearch/dist/index.cjs']
    env:
      WEBSEARCH_MAX_CHARS: '8000'
      WEBSEARCH_TIMEOUT_MS: '10000'
```

The relative path resolves against the backend's working directory, which is the repo root for `npm run backend` and for `scripts\start-chat.bat`.

- [ ] **Step 2: Rebuild and restart the backend**

Run from the repo root: `npm run build` (Turborepo picks up the new workspace; confirm `@librechat/websearch:build` appears in its output), then restart LibreChat via `scripts\start-chat.bat` or `npm run backend`.
Expected: backend log shows the MCP server `websearch` initialized with 2 tools and no error. If it logs a spawn error, run `node packages/websearch/dist/index.cjs` from the repo root by hand to see the stderr.

- [ ] **Step 3: Verify in the chat UI**

Open `http://localhost:3080`, start a chat on the `local-llm` endpoint, open the MCP selector in the input's badge row and enable `websearch`.
Expected: `websearch` is listed and toggles on; the choice persists after reloading the conversation.

- [ ] **Step 4: The real gate — Qwen drives the tools**

With llama-server running (`scripts\start-server.bat`, which passes `--jinja`), ask: "What is the latest stable release of llama.cpp and when was it published? Search the web and read the release page before answering."
Expected: tool cards for `search` then `fetch` appear in the reply, and the answer cites facts from the fetched page. Record the outcome either way. If the model never emits a tool call, try once more with the explicit instruction "Call the search tool first"; if it still does not, the result is "Qwen2.5-7B Q4_K_M does not drive tools through llama-server's Jinja template" and goes into `../local-llm/CLAUDE.md` as the validated-models note.

- [ ] **Step 5: Error path**

Disconnect the network (or set `WEBSEARCH_TIMEOUT_MS: '1'` temporarily in the yaml and restart), ask the same question.
Expected: the `search` tool card shows `Search failed: … Try again or rephrase.` and the model replies that search is unavailable instead of looping. Restore the setting.

- [ ] **Step 6: Document in `CLAUDE.md`**

Insert after the "Starting a session" subsection of the fork section:

```markdown
## Web search

- `packages/websearch` is a stdio MCP server exposing `search` (DuckDuckGo HTML, no key) and
  `fetch` (page → readable text, public http(s) hosts only). Design:
  `docs/superpowers/specs/2026-10-01-websearch-mcp-design.md`.
- Wired in `librechat.yaml` under `mcpServers.websearch` with `command: node`,
  `args: ['packages/websearch/dist/index.cjs']`; limits come from the `env` block
  (`WEBSEARCH_MAX_CHARS`, `WEBSEARCH_TIMEOUT_MS`). `npm run build` builds it with the other
  workspaces; the backend must be restarted after a rebuild.
- Enable it per chat from the MCP selector in the input badge row. Debug the server alone with
  `npx @modelcontextprotocol/inspector node packages/websearch/dist/index.cjs`.
- Tests: `cd packages/websearch && npx jest`; typecheck with `npx tsc --noEmit` there.
- Verified <date>: <one line with the Task 7 Step 4 outcome>.
```

Replace `<date>` and the outcome line with what actually happened.

- [ ] **Step 7: Update the sister repo's model table**

In `../local-llm/CLAUDE.md`, the `Qwen2.5-7B-Instruct` row's Notes cell currently reads
`Phase 1 chat OK. Native tool-calling support per llama.cpp docs; untested yet.` Replace
`untested yet` with the Step 4 outcome, e.g. `verified 2026-10-01 via LibreChat websearch MCP tools (search → fetch → answer)` or the negative result. Commit that change in `../local-llm` on its own.

- [ ] **Step 8: Full checks and commit**

Run from the repo root:

```bash
cd packages/websearch && npx jest && npx tsc --noEmit
```

Expected: all PASS, no `tsc` output. Then:

```bash
git add CLAUDE.md
git commit -m "Document the websearch MCP server and its verification" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

`librechat.yaml` is git-ignored and stays local.

- [ ] **Step 9: Open the pull request**

```bash
git push -u origin task/websearch-mcp
gh pr create --repo aquerman/local-agent-chat --base main --title "Add keyless web search as a stdio MCP server" --body-file -
```

Body: what the agent can now do (search + fetch in any chat via the MCP selector), the package layout, the yaml snippet, the Qwen verification outcome, and the checks run (Jest file count, `tsc`), ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

## Self-review

**Spec coverage.** Decisions table → Tasks 1 (package), 4 (DuckDuckGo), 7 (per-chat selection). Architecture modules → Tasks 2–6 (guard split noted). Tool contracts → Tasks 4, 5 (schemas, formats, defaults, caps). Guards and limits → Tasks 2, 3, 1. Error table: DDG unreachable/timeout, bot-check, zero results (Task 4/5); bad scheme/private host/unparseable (Task 2); non-HTML, >2 MB, HTTP ≥ 400, JS hint (Task 3); bad arguments via zod (Task 5 test). Stderr-only logging (Tasks 4–6, verified in Task 6 Step 2). Env configuration (Task 1, Task 7 yaml). Testing section → Tasks 3–5 use fixtures and `InMemoryTransport`; manual steps 1–4 → Task 6 Steps 3–4, Task 7 Steps 2–5. Documentation → Task 7 Steps 6–7. Out of scope untouched.

**Placeholders.** None: every step carries code or an exact command; `<date>` and the outcome line in Task 7 are values the executor fills from observed results, not deferred work.

**Type consistency.** `FetchFn`, `PageContent`, `SearchResult`, `Limits`, `WebSearchError`, `createServer`, `formatSearch`, `formatPage`, `readLimits` are named identically across tasks. `fetchPage(rawUrl, { fetch, limits, maxChars })` and `search(query, { fetch, limits, maxResults })` match their callers in Task 5.

**Review Focus.** All five items have a named test in Tasks 3 and 4.
