# Web search for the local agent: `packages/websearch` MCP server

Date: 2026-10-01 (updated 2026-10-03)
Status: merged to `main` via aquerman/local-agent-chat#2; this document
describes the code as shipped

## Goal

Let the local agent (LibreChat → `local-llm` endpoint, Qwen2.5-7B-Instruct on llama-server) search
the web and read result pages during a chat, on this Windows machine, with nothing to sign up for,
pay for, or put a key into. The user owns the component rather than depending on a hosted service.

## Decisions already made

| Question | Decision | Why |
|---|---|---|
| Native `webSearch` vs MCP | **MCP server** | The native tool requires a scraper (Firecrawl: Docker-only and key-required even self-hosted; Keenable: external service). A stdio MCP server needs no scraper service, no port, no SSRF exemption, and no LibreChat code changes. |
| Who runs the search engine | **Keyless public search (DuckDuckGo HTML), own page fetcher** | SearXNG is Linux/Docker-first and unsupported on Windows; this box has no Docker or WSL2. The fetcher is the part that handles arbitrary page content, so it is ours. The search backend sits behind one function and can be swapped for SearXNG later. |
| Where the code lives | **New workspace package `packages/websearch`** (`@librechat/websearch`) | Gets the repo's TypeScript/Jest/ESLint setup, installs with `npm ci`, builds with `npm run build` through Turborepo. New directory, so upstream syncs do not conflict. |
| First search engine | **DuckDuckGo HTML endpoint** (`html.duckduckgo.com/html/`) | Server-rendered, no JavaScript, simplest markup, widely scraped so breakage is noticed quickly. |
| How tools reach a chat | **Per-chat selection** via the MCP selector in the badge row | Tool schemas enter the prompt only when selected (matters at 16k context on a 7B model), and the user can observe whether Qwen drives tools before making them ubiquitous. An always-on model spec is a possible follow-up. |

## Architecture

```
Chat UI ──► LibreChat backend (ephemeral agent + MCP client) ◄──► llama-server (Qwen2.5-7B, --jinja)
                      │ stdio JSON-RPC
                      ▼
            packages/websearch (child process, MCP server)
                 ├─ search ──► html.duckduckgo.com
                 └─ fetch  ──► any web page
```

LibreChat launches the package as a stdio MCP server from this `librechat.yaml` entry:

```yaml
mcpServers:
  websearch:
    type: stdio
    command: node
    args: ['packages/websearch/dist/index.cjs']
    env:
      WEBSEARCH_MAX_CHARS: '8000'
      WEBSEARCH_TIMEOUT_MS: '10000'
      WEBSEARCH_MAX_BYTES: '5000000'
```

Stdio servers skip LibreChat's MCP SSRF guard entirely (`packages/api/src/auth/domain.ts`,
`isMCPDomainAllowed`), so no `mcpSettings.allowedAddresses` entry is needed.

### Modules

Eight modules, each with one job and a plain-object interface:

| File | Responsibility |
|---|---|
| `search.ts` | `search(query, opts) → SearchResult[]`. POSTs to DuckDuckGo HTML, parses with `cheerio`, returns `{ title, url, snippet }`. Decodes DDG's redirect links (`/l/?uddg=…`) to the real URL and drops ad results. |
| `fetch.ts` | `fetchPage(url, opts) → PageContent`. Calls `assertPublicHttpUrl`, downloads with Node's built-in `fetch`, applies the content guards below, extracts readable text, returns `{ url, title, text, truncated }`. |
| `guard.ts` | `assertPublicHttpUrl(raw, resolve) → URL`. Top-down: parse and check the scheme, refuse `localhost` names (a trailing dot is stripped first, so `localhost.` is caught), resolve the host (IP literals are not resolved) and refuse if any address is private. Every refusal is a `WebSearchError` prefixed `Refused to fetch <raw>:`. Takes an injected `Resolver` (default: `dns.lookup` with `all: true`). |
| `addresses.ts` | Pure IP classification: `isPrivateAddress(address)` and `literalAddress(hostname)`. IPv4 ranges are a table (`0/8`, `10/8`, `127/8`, `100.64/10` CGNAT, `169.254/16`, `172.16/12`, `192.168/16`); IPv6 is split into loopback, IPv4-mapped and IPv4-compatible (dotted or hex form), link-local (`fe80::/10`) and unique-local (`fc00::/7`) checks. No I/O. |
| `errors.ts` | `WebSearchError`, the one error type the server turns into an `isError` text result. |
| `server.ts` | Builds the `McpServer` from `@modelcontextprotocol/sdk`, registers the two tools with zod input schemas, formats results as text for the model. |
| `index.ts` | Connects `server` to `StdioServerTransport`. Nothing else. |
| `limits.ts` | One constants object for timeouts, byte cap and char caps; env overrides are read here. |

Both network modules take an injected `fetch` function (default: global `fetch`), and `guard.ts`
takes an injected `Resolver`. Those are the only seams the tests use.

Dependencies: `@modelcontextprotocol/sdk` and `cheerio` (both already in the monorepo tree), `zod`,
`domhandler` (types only). Build: `tsdown` to a single `dist/index.cjs` with every dependency
bundled (about 2.8 MB), so the child process does not depend on the caller's `node_modules` layout.

### Security boundary

The model chooses every URL `fetch` reads, and a fetched page can carry instructions (prompt
injection) that steer the next call. `assertPublicHttpUrl` is therefore the security boundary: it
runs before the first request and again on every redirect hop (redirects are followed manually,
`redirect: 'manual'`, at most 5). A name such as `127.0.0.1.nip.io` or `localhost.` is refused
because the check runs on the resolved addresses, not the hostname string. The check is
resolve-time, not connect-time: a host that changes its DNS answer between the lookup and the
connection (DNS rebinding) is not covered. Closing that needs the check inside the connect-time
`lookup` of an undici `Agent` passed as the fetch `dispatcher`.

## Tool contracts

### `search`

- Input: `{ query: string, maxResults?: number }`; `maxResults` 1–10, default 5.
- Request: POST `https://html.duckduckgo.com/html/`, form body `q=<query>`, realistic
  `User-Agent`, timeout `WEBSEARCH_TIMEOUT_MS` (default 10 s).
- Output: one numbered text block so the model can pick a URL for `fetch`:

  ```
  1. Title
     https://example.com/page
     Snippet text…
  ```

- Zero results is a normal result (`No results for: <query>`), not an error. It is reported only
  when the page carries DDG's `.no-results` marker; a page with neither results nor that marker is
  unrecognized markup and becomes an error (see below), so a DDG layout change is never mistaken
  for an empty search.

### `fetch`

- Input: `{ url: string, maxChars?: number }`; `maxChars` default `WEBSEARCH_MAX_CHARS` (8000,
  roughly 2k tokens), hard cap 20000.
- Guards, before any network call: `http`/`https` only; no loopback, link-local or private hosts
  (the process runs on the user's machine and the model must not be able to point it at
  `127.0.0.1:27017`); unparseable URLs rejected.
- Download: timeout as above; abort if `Content-Type` is not HTML/text (a missing header is read as
  HTML) or the body exceeds `WEBSEARCH_MAX_BYTES` (default 5 MB, counted while streaming so the
  read stops at the cap); HTTP ≥ 400 reported as an error.
- Extraction: parse with cheerio; drop `script`, `style`, `nav`, `header`, `footer`, `aside`,
  `noscript`, `iframe`, `svg`, `template`; prefer `<main>` / `<article>` when present; collapse
  whitespace; keep headings and paragraphs separated by blank lines, list items and table rows on
  their own lines, and table cells separated by a space. Plain text, not markdown.
- Output: `Title`, `URL`, blank line, text, then `[truncated at N chars]` when cut.

### Flow per turn

Model calls `search` → reads the list → calls `fetch` on one or two URLs → answers. The server is
stateless and writes nothing. Tool descriptions are written for the model explicitly ("Use `search`
to find pages; use `fetch` to read one before answering from it") because Qwen 7B follows explicit
descriptions better than implicit ones.

### Persistence (upstream behavior, unchanged)

LibreChat stores each tool call's arguments and output text in the message's content parts
(`messages` collection) and in a TTL-expiring `toolcalls` record
(`packages/data-schemas/src/schema/toolCall.ts`). The message copy is re-sent as history on later
turns, which is why the 8000-char default matters on a 16k-context model. Changing that is a
LibreChat-wide behavior change and out of scope.

## Error handling

A tool never throws out to the MCP layer. Every failure becomes a short text result with
`isError: true`, because a thrown error reaches Qwen as an opaque stack and it tends to loop or
hallucinate a page.

| Situation | Behavior |
|---|---|
| DDG unreachable / timeout | `Search failed: <reason>. Try again or rephrase.` |
| DDG bot-check page | No `div.result` parsed and the challenge form present → `Search is temporarily blocked by DuckDuckGo; try again in a minute.` Response status logged to stderr. A results page that merely contains the bot-check wording is still parsed as results. |
| Unrecognized DDG markup | No `div.result` and no `.no-results` marker → `Search failed: unexpected response from DuckDuckGo. Try again or rephrase.` Status logged to stderr. |
| Zero results | Normal result: `No results for: <query>`. |
| `fetch` with bad scheme, loopback/private host (literal or resolved), unresolvable host, or unparseable URL | Rejected before any network call: `Refused to fetch <url>: <reason>`. A redirect to such a URL is refused the same way. |
| Non-HTML content type (PDF, image) | `Not a text page (<content-type>)`. PDFs are out of scope for v1. |
| Body over the byte cap | Abort the stream: `Fetch failed: response larger than <cap>`, where `<cap>` is the configured value (`5 MB` by default, or `<n> bytes` below 1 MB). |
| HTTP ≥ 400 | `Fetch failed: HTTP <status>`. |
| Timeout | `Fetch failed: timed out after <ms> ms` / `Search failed: timed out after <ms> ms. Try again or rephrase.` |
| More than 5 redirects | `Fetch failed: too many redirects`. |
| Page parses to under ~200 chars (JS-only app) | Return what there is plus `Page content appears to require JavaScript.` |
| Bad arguments from the model | Zod schema rejects at the MCP layer; LibreChat renders that. |

Logging goes to **stderr only**: stdout is the MCP channel and one stray `console.log` corrupts the
protocol. The `mcpServers.websearch.stderr` option stays at its default (inherits the backend's
console).

Configuration: the limits are env vars read at startup (`WEBSEARCH_MAX_CHARS`,
`WEBSEARCH_TIMEOUT_MS`, `WEBSEARCH_MAX_BYTES`; non-positive or non-integer values fall back to the
default, and `WEBSEARCH_MAX_CHARS` is clamped to 20000) passed through the `env` block in `mcpServers`, with the constants in
`limits.ts` as defaults. CLAUDE.md's "new levers ship configurable" rule targets LibreChat's own
`configSchema`; this package is a standalone process, so the yaml `env` block is its configuration
surface. The startup line on stderr reports the effective values:
`websearch: ready (maxChars=8000, timeoutMs=10000, maxBytes=5000000)`.

## Testing

Unit tests with Jest in `packages/websearch` (`cd packages/websearch && npx jest`). The injected
`fetch` and `Resolver` are the only seams; no HTTP or DNS mocking library.

- `search.test.ts`: saved DDG HTML fixtures (normal results, ads-mixed, zero results, bot-check)
  under `__tests__/fixtures/` → assert titles, decoded URLs, ad exclusion, each error string. A
  DDG markup change becomes a fixture refresh.
- `guard.test.ts`: scheme, `localhost` names, every blocked IPv4 and IPv6 range as a literal,
  public literals that must pass, resolved-name refusals and lookup failures via a fake `Resolver`.
- `fetch.test.ts`: content-type rejection and missing header, byte-cap abort and its message,
  boilerplate stripping, `<main>` preference, table cells, truncation marker, JavaScript hint,
  redirects (public, to a loopback literal, to a loopback name, more than five), timeout, network
  error, a public name resolving to a private address.
- `server.test.ts`: construct the `McpServer`, connect it to an in-memory client via the SDK's
  `InMemoryTransport`, call `tools/list` and both tools end to end with the fake fetch. Real SDK
  exports, no stubbed internals.

Typecheck: `npx tsc --noEmit` in the package; tsdown does not check types. As shipped: 76 tests in
5 suites, typecheck and ESLint clean. The package is not yet in the root `test:packages:*` scripts,
so CI does not run it.

Manual verification, in order:

1. `npm run build`, then `npx @modelcontextprotocol/inspector node packages/websearch/dist/index.cjs`
   → call `search` and `fetch` against the live internet.
2. Add the `mcpServers` block to `librechat.yaml`, restart the backend, confirm `websearch` appears
   in the MCP selector.
3. The real gate: Qwen2.5-7B with `--jinja`. Ask a question that needs current information; verify
   it calls `search`, then `fetch`, then answers from the fetched facts. If it will not drive tools,
   that is a `local-llm` model/template question, recorded there, not a bug here.
4. Error path: disconnect the network → confirm the error text shows in the tool card and the model
   recovers instead of looping.

Results (2026-10-01):

- Steps 1–2 passed: over real stdio, live DDG search returned results and `fetch` read
  `https://example.com/`; the backend logged `[MCP][websearch] Tools: search, fetch`.
- Step 3 passed in part: asked for today's news, Qwen called `search` with a sensible query and
  answered from the results, but did not chain to `fetch` on its own.
- Step 4 verified at the tool layer only (with `WEBSEARCH_TIMEOUT_MS=1` both tools return their
  `isError` text); the model's recovery inside a chat was not tested.
- SSRF smoke against the built server: `http://localhost.:8080/`, `http://127.0.0.1.nip.io:8080/`
  and `http://127.0.0.1:8080/` are all refused.

## Documentation

- Fork section of `CLAUDE.md`: a short "Web search" entry (package, yaml snippet, Inspector
  command, Qwen outcome from step 3).
- `../local-llm/CLAUDE.md` validated-models table: replace "untested yet" for tool calling with the
  outcome.

## Known gaps

Found in review and deferred; none blocks use:

- Non-UTF-8 pages are decoded as UTF-8 (`charset=` in Content-Type is ignored).
- The `Content-Type` check is case-sensitive (`Text/HTML` is refused).
- Each redirect hop gets a fresh timeout, so one fetch can take up to 6 × 10 s, which equals
  LibreChat's MCP call timeout.
- Bodies of redirect, error and non-text responses are not cancelled.
- Whitespace inside `<pre>` is collapsed, so code samples lose their line breaks.
- `uddg` is unwrapped from any link, not only `duckduckgo.com` ones.
- `<title>` can come from an inline SVG when `<head>` has none.
- DNS rebinding (see Security boundary).

## Out of scope

PDF extraction, result caching, markdown output, an always-on model spec, SearXNG backend, native
`webSearch` badge/citation UI, and changing how LibreChat persists tool output.
