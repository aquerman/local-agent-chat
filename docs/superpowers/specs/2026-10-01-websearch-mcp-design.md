# Web search for the local agent: `packages/websearch` MCP server

Date: 2026-10-01
Status: approved design, awaiting implementation plan

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
```

Stdio servers skip LibreChat's MCP SSRF guard entirely (`packages/api/src/auth/domain.ts`,
`isMCPDomainAllowed`), so no `mcpSettings.allowedAddresses` entry is needed.

### Modules

Four modules, each with one job and a plain-object interface:

| File | Responsibility |
|---|---|
| `search.ts` | `search(query, opts) → SearchResult[]`. POSTs to DuckDuckGo HTML, parses with `cheerio`, returns `{ title, url, snippet }`. Decodes DDG's redirect links (`/l/?uddg=…`) to the real URL and drops ad results. |
| `fetch.ts` | `fetchPage(url, opts) → PageContent`. Downloads with Node's built-in `fetch`, applies the guards below, extracts readable text, returns `{ url, title, text, truncated }`. |
| `server.ts` | Builds the `McpServer` from `@modelcontextprotocol/sdk`, registers the two tools with zod input schemas, formats results as text for the model. |
| `index.ts` | Connects `server` to `StdioServerTransport`. Nothing else. |
| `limits.ts` | One constants object for timeouts, byte cap and char caps; env overrides are read here. |

Both network modules take an injected `fetch` function (default: global `fetch`). That is the
only seam the tests use.

Dependencies: `@modelcontextprotocol/sdk` and `cheerio` (both already in the monorepo tree), `zod`.
Build: `tsdown` to `dist/index.cjs`, matching the other packages.

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

- Zero results is a normal result (`No results for: <query>`), not an error.

### `fetch`

- Input: `{ url: string, maxChars?: number }`; `maxChars` default `WEBSEARCH_MAX_CHARS` (8000,
  roughly 2k tokens), hard cap 20000.
- Guards, before any network call: `http`/`https` only; no loopback, link-local or private hosts
  (the process runs on the user's machine and the model must not be able to point it at
  `127.0.0.1:27017`); unparseable URLs rejected.
- Download: timeout as above; abort if `Content-Type` is not HTML/text or the body exceeds 2 MB;
  HTTP ≥ 400 reported as an error.
- Extraction: parse with cheerio; drop `script`, `style`, `nav`, `header`, `footer`, `aside`,
  `noscript`; prefer `<main>` / `<article>` when present; collapse whitespace; keep headings and
  paragraphs separated by blank lines. Plain text, not markdown.
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
| DDG bot-check page or unparseable markup | Detect no `.result` plus the challenge form → `Search is temporarily blocked by DuckDuckGo; try again in a minute.` Response status logged to stderr. |
| Zero results | Normal result: `No results for: <query>`. |
| `fetch` with bad scheme, loopback/private host, or unparseable URL | Rejected before any network call: `Refused to fetch <url>: <reason>`. |
| Non-HTML content type (PDF, image) | `Not a text page (<content-type>)`. PDFs are out of scope for v1. |
| Body over 2 MB or HTTP ≥ 400 | Abort the stream / report the status. |
| Page parses to under ~200 chars (JS-only app) | Return what there is plus `Page content appears to require JavaScript.` |
| Bad arguments from the model | Zod schema rejects at the MCP layer; LibreChat renders that. |

Logging goes to **stderr only**: stdout is the MCP channel and one stray `console.log` corrupts the
protocol. The `mcpServers.websearch.stderr` option stays at its default (inherits the backend's
console).

Configuration: the limits are env vars read at startup (`WEBSEARCH_MAX_CHARS`,
`WEBSEARCH_TIMEOUT_MS`) passed through the `env` block in `mcpServers`, with the constants in
`limits.ts` as defaults. CLAUDE.md's "new levers ship configurable" rule targets LibreChat's own
`configSchema`; this package is a standalone process, so the yaml `env` block is its configuration
surface.

## Testing

Unit tests with Jest in `packages/websearch` (`cd packages/websearch && npx jest`). The injected
`fetch` is the only seam; no HTTP mocking library.

- `search.test.ts`: saved DDG HTML fixtures (normal results, ads-mixed, zero results, bot-check)
  under `__tests__/fixtures/` → assert titles, decoded URLs, ad exclusion, each error string. A
  DDG markup change becomes a fixture refresh.
- `fetch.test.ts`: URL guards (scheme, loopback, private ranges), content-type rejection, byte-cap
  abort, boilerplate stripping, `<main>` preference, truncation marker, JavaScript hint.
- `server.test.ts`: construct the `McpServer`, connect it to an in-memory client via the SDK's
  `InMemoryTransport`, call `tools/list` and both tools end to end with the fake fetch. Real SDK
  exports, no stubbed internals.

Typecheck: `npx tsc --noEmit` in the package; tsdown does not check types.

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

## Documentation

- Fork section of `CLAUDE.md`: a short "Web search" entry (package, yaml snippet, Inspector
  command, Qwen outcome from step 3).
- `../local-llm/CLAUDE.md` validated-models table: replace "untested yet" for tool calling with the
  outcome.

## Out of scope

PDF extraction, result caching, markdown output, an always-on model spec, SearXNG backend, native
`webSearch` badge/citation UI, and changing how LibreChat persists tool output.
