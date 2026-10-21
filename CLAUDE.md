# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# This fork: local-agent-chat

`aquerman/local-agent-chat` is a personal fork of LibreChat (`upstream` = `LibreChat-AI/LibreChat`,
`origin` = `aquerman/local-agent-chat`). It is the chat front end for the sister repo `../local-llm`
(`aquerman/local-llm`), which builds a self-hosted LLM server (llama.cpp `llama-server`, RTX 3060
12 GB) exposing an OpenAI-compatible API. This repo consumes that server; it does not run models.
Read `../local-llm/CLAUDE.md` for the server side: engine, validated models, how to start it.

Vault note: [[Local LLM]]

Everything below the "LibreChat" heading is upstream's guidance and still applies to code in this
repo, except where this section overrides it. Keep fork-specific notes in this section so upstream
syncs conflict only here.

## How the fork consumes local-llm

- The contract between the two repos is only the OpenAI-compatible HTTP API, by default
  `http://127.0.0.1:8080/v1` (`LLM_BASE_URL` in `../local-llm/.env.example`, `-Port` in
  `../local-llm/scripts/start-server.ps1`). No code is shared between the repos.
- Prefer wiring it as a **custom endpoint** in `librechat.yaml` (`endpoints.custom`, see
  `librechat.example.yaml`) over code changes. Loopback and private addresses are blocked by
  LibreChat's SSRF guard unless listed in `endpoints.allowedAddresses` as `host:port`
  (e.g. `'127.0.0.1:8080'`).
- `llama-server` ignores the API key, but the custom endpoint still needs a non-empty `apiKey`.
- Tool calling needs `llama-server --jinja` and a model whose chat template supports tools; check the
  validated-models table in `../local-llm/CLAUDE.md` before assuming a model can drive agents.

## Local environment (verified 2026-09-26)

- Windows 11 native. **No Docker and no WSL2**, so the `docker-compose*.yml` / `deploy-compose*.yml`
  paths do not run here, and `host.docker.internal` does not apply: everything talks over `127.0.0.1`.
- **MongoDB Community Server 8.3** runs as the Windows service `MongoDB` (automatic start) on
  `127.0.0.1:27017`, matching the default `MONGO_URI`; `mongosh` 2.12 is installed. Unit tests use
  `mongodb-memory-server` and do not need it.
- **Node 24.19 LTS is the single system Node** (winget `OpenJS.NodeJS.LTS`), close to the `.nvmrc`
  pin of 24.16.0. No version manager: fnm and nvm-windows rely on directory junctions under
  `AppData`, and junctions there cannot be traversed by cmd/PowerShell on this machine (antivirus),
  so they silently fail to switch. Do not reintroduce one without testing that first.
- Package manager is **npm** (`package-lock.json`, `"packageManager": "npm@11"`), not pnpm: the
  upstream scripts and Turborepo config assume npm workspaces, and pnpm's symlinked store under
  `AppData\Local\pnpm` would hit the same junction problem.
- `.env` and `librechat.yaml` are git-ignored, created from `.env.example` and
  `librechat.example.yaml`; `node_modules` comes from `npm ci` at the root. `librechat.yaml` wires
  local-llm as a custom endpoint whose `name` is `Benner` and whose `modelDisplayLabel` is
  `local-llm` (model alias `local`, from `--alias local` in `../local-llm/scripts/start-server.ps1`).
  Per-endpoint keys elsewhere in the YAML (`fileConfig.endpoints`) match the `name`, or the
  generic `custom` key, never the display label.
- `bennychat.yaml` (tracked) is the fork's full LibreChat config, one commented section per roadmap
  feature. Use it with `CONFIG_PATH=bennychat.yaml` in `.env`, or copy it over `librechat.yaml`.
  New features are switched on there, not in upstream's `librechat.example.yaml`.
- `gh` default repo is set to `aquerman/local-agent-chat`. Still pass `--repo aquerman/local-agent-chat`
  to `gh pr create`; never open a pull request against `LibreChat-AI/LibreChat` unless asked.

## Starting a session

- MongoDB is a Windows service, so only two processes need starting: llama-server (local-llm) and
  the LibreChat backend (this repo). `scripts\start-all.bat` starts both in one Windows Terminal
  window, one tab each, and skips a tab whose port (8080 or 3080) already has a listener. With chat
  search on it adds a Meilisearch tab (port 7700, see "Chat search"); with retrieval set up,
  "Embeddings" and "RAG API" tabs (see "Knowledge and RAG"); with voice installed, "Whisper" and
  "Piper" tabs (ports 8082/8083, see "Voice"). The
  Desktop `Start All`, `Start Chat` and `Start Server` entries are shortcuts (`.lnk`) to the repo
  files, so editing a script here is enough.
- `scripts\start-chat.bat` starts only LibreChat (`npm run backend`, which serves the built client).
  Rebuild the client with `npm run build` after pulling frontend changes; the launcher does not.
- Open `http://localhost:3080`. The model server's own UI is at `http://127.0.0.1:8080`.
- Verified 2026-09-27 against Qwen2.5-7B-Instruct Q4_K_M: streaming, stop button, auto-titles,
  several conversations, history surviving a backend restart, and a clean error when llama-server
  is down. `.env` keeps upstream's `LIMIT_CONCURRENT_MESSAGES=true` / `CONCURRENT_MESSAGE_MAX=2`,
  so a third chat streaming at once is refused with "Only 2 messages can run at once"; llama-server
  serves one request at a time anyway unless started with `--parallel`.

## Attachments

- Each upload gets an LLM delivery path (`packages/data-provider/src/resolve-llm-delivery-path.ts`):
  `provider` (bytes encoded into the model request), `text` (parsed on upload, text injected into
  the prompt as `fileContext`) or `none` (stored for tools only). The system default puts images,
  audio, video and PDF on `provider` and everything else on `text`. For a custom endpoint the real
  provider is unknown at upload time, so there is no capability downgrade: a PDF is sent as an
  OpenAI `file` content part, which llama-server rejects with `400 unsupported content[].type`.
- `librechat.yaml` therefore sets `fileConfig.endpoints.custom.defaultLLMDeliveryPath.overrides`
  with `application/pdf: text`. Keep it an override, not a `fallback`, or images leave the provider
  path too. Images still go to the model natively (useful only with a vision model).
- Text extraction is the built-in parser in `packages/api/src/files/documents/crud.ts` (PDF.js for
  PDF, mammoth for docx, xlsx for sheets), 15 MB cap, text layer only: scanned PDFs fail with
  "requires an OCR service" because no `ocr` or `RAG_API_URL` is configured. Injected text is cut
  at `fileTokenLimit` (100k tokens by default) before the model's own `--ctx-size` applies.
- PDFs uploaded before this override have no stored text and must be re-uploaded.
- Clicking a PDF or image chip in a sent message opens the original file in the right-hand side panel
  (`client/src/components/Chat/FilePanel`), the same slot artifacts use; opening one replaces the other.
  For files the model read as text, a header button shows the extracted text. Other types and shared
  links keep the upstream text dialog.

## Thinking mode

- The input-bar pill (Off/Low/Medium/High) writes the conversation's `reasoning_effort`. For endpoints with
  `customParams.reasoningFormat: llama_cpp_budget` the backend sends llama-server's
  `chat_template_kwargs.enable_thinking` and `thinking_budget_tokens` instead (budgets in
  `customParams.thinkingBudgets`); Qwen3.5 ignores `reasoning_effort`. Titles always go out with thinking off.
  See `docs/adr/0001-thinking-mode-translated-in-librechat.md`.
- Reasoning text never streams on screen: the row shows "Thinking...", then "Thought for Ns" (click to read).
  Durations are measured in the browser and not stored, so reloaded chats show "Thoughts".

## Web search

- `packages/websearch` is a stdio MCP server exposing `search` (DuckDuckGo HTML, no key) and
  `fetch` (page → readable text, public http(s) hosts only). Design:
  `docs/superpowers/specs/2026-10-01-websearch-mcp-design.md`.
- Wired in `librechat.yaml` under `mcpServers.websearch` with `command: node`,
  `args: ['packages/websearch/dist/index.cjs']`; limits come from the `env` block
  (`WEBSEARCH_MAX_CHARS`, `WEBSEARCH_TIMEOUT_MS`, `WEBSEARCH_MAX_BYTES` — raw download cap,
  default 5 MB; the error text reports the configured cap). `npm run build` builds it with the other
  workspaces; the backend must be restarted after a rebuild.
- `alwaysOn: true` on the server (a fork-added MCP option, `packages/data-provider/src/mcp.ts`) attaches
  it to every chat, like thinking, and drops it from the MCP picker; with no other chat-selectable
  server the picker disappears. The backend adds it in `resolveChatMCPServers`
  (`packages/api/src/mcp/utils.ts`). Agents still list their own servers. Without the flag it is
  enabled per chat from the MCP selector in the input badge row. Debug the server alone with
  `npx @modelcontextprotocol/inspector node packages/websearch/dist/index.cjs`.
- JS rendering (roadmap 2.1): with `WEBSEARCH_RENDER=auto` (default) a static page under ~200 chars
  of text is re-read in headless Chromium via `playwright-core` (a runtime dependency kept out of the
  bundle); `always` renders every page, `off` never does. No `render` tool argument, like Claude's
  single web_fetch. Browser: `WEBSEARCH_BROWSER_PATH`, else Edge (`msedge` channel), Chrome, then
  Playwright's Chromium; none → static text plus a note. All browser traffic goes through a
  per-render guarded proxy (`src/proxy.ts`) that dials only checked public addresses and enforces
  `WEBSEARCH_MAX_BYTES`. Render tests use `PLAYWRIGHT_BROWSERS_PATH`/`WEBSEARCH_BROWSER_PATH` and
  skip without a Chromium.
- Tests: `cd packages/websearch && npx jest`; typecheck with `npx tsc --noEmit` there.
- Verified 2026-10-01 with Qwen2.5-7B-Instruct Q4_K_M (`--jinja`): asked for today's news, the
  model called `search` with a sensible query and answered from the results. It did not chain to
  `fetch` unprompted in that exchange; `fetch` itself is verified over stdio. With a 1 ms timeout
  both tools return their `isError` text instead of throwing.

## Chat search

- Upstream's conversation search (sidebar search box, `/search` results page; Claude Desktop's sidebar
  chat search) backed by Meilisearch, switched on in `.env` only: `SEARCH=true`,
  `MEILI_HOST=http://127.0.0.1:7700` (not upstream's `0.0.0.0`, which a Windows client cannot dial),
  `MEILI_MASTER_KEY=<64 hex chars>`. Generate the key with
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`; it never goes in git.
- Binary: Meilisearch **v1.35.1** (the version upstream's `docker-compose.yml` pins), release asset
  `meilisearch-windows-amd64.exe`, saved as `bin\meilisearch.exe` (`/bin/` is git-ignored):
  `mkdir bin`, then `gh release download v1.35.1 --repo meilisearch/meilisearch -p meilisearch-windows-amd64.exe -O bin\meilisearch.exe`.
- `scripts\start-meili.bat` runs it on `127.0.0.1:7700` with data in `meili_data\` (git-ignored),
  reading the key from `.env` so it never appears on a command line. `start-all.bat` opens it as a
  "Meilisearch" tab before LibreChat, only when `.env` has `SEARCH=true` and the exe exists, and
  skips it when 7700 already listens. Without the exe it prints a note and starts the rest as before.
- On first start with search on, the backend indexes all existing conversations and messages
  (`indexSync` in `packages/data-schemas/src/models/plugins/mongoMeili.ts`); new messages are
  indexed as they are saved. Deleting `meili_data\` and restarting rebuilds the index from MongoDB.
- Verified 2026-10-20 in a Linux rig with the `getmeili/meilisearch:v1.35.1` image (not the
  Windows exe): pre-existing chats were indexed at startup, the sidebar search returned them by a
  word from a reply, and a newly sent message was found too.

## Knowledge and RAG

- Upstream's retrieval path, run natively: LibreChat's RAG API (`danny-avila/rag_api`, Python/FastAPI)
  with PostgreSQL 16 + pgvector, embeddings from a second llama-server (`--embedding`, local-llm's
  `scripts\start-embeddings.ps1`, nomic-embed-text-v1.5 Q8_0 on 127.0.0.1:8081, ~0.3 GB VRAM).
  pgvector is the only store rag_api offers besides Atlas; MongoDB Community's vector search
  (mongot) has no Windows build. conda-forge is the only prebuilt pgvector for Windows, so one
  conda env holds Python 3.12, PostgreSQL and pgvector: no admin rights, no compiler, no Docker.
- User installs: Miniforge (`winget install CondaForge.Miniforge3`) and git. Then
  `scripts\setup-rag.ps1` clones rag_api into `..\rag_api` (pinned commit `c4e5cbf`), creates
  `..\rag_api\env`, pip-installs `requirements.lite.txt`, and creates the database in
  `%LOCALAPPDATA%\bennychat\rag\pgdata` (127.0.0.1:5433, password auth). Re-running skips done steps.
- `.env` keys: the commented "BennyChat, fully local" block under RAG in `.env.example`
  (`RAG_API_URL`, `RAG_PORT`, `EMBEDDINGS_PORT`, `RAG_OPENAI_BASEURL`, `DB_PORT`, `POSTGRES_*`,
  `RAG_CHECK_EMBEDDING_CTX_LENGTH=False` so text, not tiktoken ids, reaches llama-server).
  `scripts\start-rag.ps1` loads the whole `.env` into rag_api, like upstream's compose `env_file`,
  so both sides share `JWT_SECRET` and rag_api scopes chunks to the uploading user.
- `start-all.bat` adds an "Embeddings" tab when `EMBEDDINGS_PORT` is set (skipped with a note if
  local-llm's exe or script is missing) and a "RAG API" tab when `RAG_API_URL` is set and
  `..\rag_api\env` exists; each is skipped when its port listens. `start-rag.ps1` starts
  PostgreSQL in the background and stops it on Ctrl+C.
- Using it in chat: `fileConfig.endpoints.custom.legacyFileUploadUX: true` (commented out in
  `bennychat.yaml`) brings back the attach chooser; turn on File Search in the tools menu, then
  "Upload for File Search". Each turn LibreChat queries `/query` with the user's message (k=4,
  `packages/api/src/files/rag/context.ts`) and injects those chunks; the model can also call
  `file_search`. Keep `RAG_USE_FULL_CONTEXT` unset, or whole files come back. In the chooser,
  "Upload to Provider" sends PDFs as bytes (llama-server 400): use it for images only. Agents with
  File Search (Agent Builder) embed their files the same way without the chooser.
- Follow-up idea: route big text uploads to file_search automatically in unified mode (Claude
  Projects switches to retrieval when knowledge outgrows the context) instead of the chooser.
- Verified 2026-10-20 in the Linux rig (pgvector:pg16 image, rag_api at the pinned commit in a
  Python 3.12 venv, llama-server `--embedding` with the F16 nomic file, Qwen3-1.7B): a 22 KB text
  file uploaded for File Search was embedded (65 chunks for an 84 KB one), the chat answer quoted the
  one matching chunk, rag_api logged `/embed` then `/query`, and the request was ~1.9k tokens where
  the whole file is ~6k. Not verified: the Windows scripts (no PowerShell or Windows here), the
  conda-forge packages, agent knowledge files, and Qwen3.5-9B.

## Voice

- Upstream speech (mic in the composer, speaker under messages) pointed at two CPU-only local servers;
  config in `bennychat.yaml` ("Roadmap 11, voice"), setup in `docs/voice.md`. Both URLs are listed in
  `speech.stt/tts.allowedAddresses`: the speech SSRF guard blocks loopback otherwise.
- STT: whisper.cpp `bin\whisper\whisper-server.exe` (CPU zip) on `VOICE_STT_PORT` (8082) with
  `--inference-path /v1/audio/transcriptions -l auto --convert`, so the stock `openai` provider works.
  `--convert` shells out to ffmpeg (on `PATH`) for the browser's webm/ogg/mp4 recordings.
- TTS: `packages/piper`, a small TS server on `VOICE_TTS_PORT` (8083) that spawns Piper's own
  `python -m piper.http_server` (venv `bin\piper`, voices `bin\piper\voices`, `PIPER_PORT` 8084) and
  answers OpenAI `POST /v1/audio/speech`: strips Markdown, picks the voice (`auto` = installed `nl_*`
  voice for Dutch text, `en_*` for English), encodes mp3 via ffmpeg without ID3/Xing headers, because
  LibreChat concatenates per-sentence mp3 replies into one `MediaSource` stream. It reads `.env` itself.
  Tests: `cd packages/piper && npx jest`; typecheck `npx tsc --noEmit` there.
- `speechTab` defaults mirror Claude: engines `external`, dictation stops on a second mic click and
  fills the composer (no silence auto-stop, no auto-send), language auto-detected, automatic
  read-aloud off. Browser-saved settings override them.
- `scripts\start-all.bat` adds "Whisper" (`scripts\start-stt.bat`) and "Piper" (`scripts\start-tts.bat`)
  tabs only when `bin\whisper\whisper-server.exe` / the `bin\piper` venv exist, and skips a listening
  port. Changing a port means editing `.env` and `bennychat.yaml` both.
- Verified 2026-10-20 in the Linux rig (whisper-server built from source, `ggml-base.bin`, Piper 1.8
  with an English voice from PyPI): `/api/files/speech/stt` transcribed webm, ogg and m4a uploads,
  `/tts/manual` returned mp3, and in Chromium with a fake microphone the mic button put the
  transcript in the composer and "Read aloud" played. Not verified: the Windows binaries and
  `--convert` on Windows, Dutch voices (HuggingFace is blocked in the rig) and Dutch transcription.

## Skills

- Upstream Skills (`SKILL.md` with `name` + `description` frontmatter, optional bundled files). Starter
  skills ship in `skill/` (upstream's deployment directory, `DEPLOYMENT_SKILLS_DIR` overrides it, path
  relative to the backend's cwd): `morning-brief`, `weekly-review`, `meeting-notes`, `house-style`.
  They load at startup (log: `[deploymentSkills] Loaded 4`), are read-only and active for every user;
  edit the file and restart the backend to change one. Users add their own in the Skills panel
  (Customize menu) or by uploading a `SKILL.md`; those live in MongoDB.
- Switched on per chat from the tools menu ("Skills" badge; new chats remember the last setting) or by
  typing `$` in the composer to pick one (that primes its body directly, no tool call needed: the
  reliable path for a small model). F3's model spec can set `skills: true` to make them always on.
- Progressive disclosure: with the badge on, the prompt gets a system block `## Available Skills`
  (name + description only, ~40 tokens each) and a `skill` tool; the body enters the context only as
  the result of a `skill` call or a `$` pick. Catalog capped by `endpoints.agents.skills.maxCatalogSkills`
  (12 in `bennychat.yaml`). The badge also adds `read_file`, plus `create_file`/`edit_file` while the
  user may create skills (`interface.skills.create`): about 1.6k tokens of tool schemas in total.
  Keep descriptions one sentence, "what + Use when ...", so a 9B model can match them.
- `always-apply: true` in a skill's frontmatter primes its body into every turn; none of the starters
  use it (prompt budget). Names must be kebab-case and cannot start with `claude-`/`anthropic-`.
- Verified 2026-10-20 in the cloud rig (logging proxy in front of llama-server): catalog without
  bodies, the `$` pick priming the body, and a `skill` tool call returning the body (mock model).
  Qwen3-1.7B never called `skill`, even when told to: it reached for `create_file` both times. Check
  Qwen3.5-9B; if it does the same, rely on `$` or turn off `interface.skills.create` (which also hides
  "Create skill" in the UI).

## Artifacts offline

- Artifacts are switched on per chat (Tools menu → Artifacts; the agents capability `artifacts` is on
  by default), so `bennychat.yaml` has nothing to enable. Mermaid renders in the app (mermaid npm)
  and needs no network.
- The Code tab's Monaco is served from `/monaco/vs` (copied from `monaco-editor` at build time,
  `client/src/utils/monaco.ts`) instead of jsDelivr. The Vite dev server has no copy and keeps the CDN.
- HTML, SVG, Markdown, code and office previews use Sandpack's `static` template. Upstream it loads
  its relay from `*.sandpack-static-server.codesandbox.io`, Tailwind from `cdn.tailwindcss.com` and
  marked from jsDelivr. With `SANDPACK_STATIC_BUNDLER_URL=http://preview.localhost:3080` in `.env`
  (port = `PORT`), LibreChat serves the relay itself: `packages/api/src/artifacts/bundler.ts`
  answers hosts `<hex id>-preview.localhost` and is mounted before the security headers, because
  the app frames it. Those previews then load Tailwind and marked from `/__csb_vendor/`. The
  `/__csb` prefix makes the preview's service worker pass the request to the server.
  `copyArtifactRuntime` in `client/vite.config.ts` copies relay, Tailwind and marked into
  `client/dist/artifacts-preview/` at build time.
- `*.localhost` resolves to loopback without DNS in Chromium browsers (Edge, Chrome). A page opened
  from another host (a phone over Tailscale) ignores a `.localhost` bundler and uses codesandbox's
  bundler. With `CSP_ENABLED`, add `CSP_FRAME_SRC_EXTRA=http://*.localhost:3080` (untested).
- Self-hosted previews get Tailwind v4 (`@tailwindcss/browser`, the official browser build), not
  the v3 Play CDN. Most utility classes are the same, but a `tailwind.config = {...}` script is ignored.
- React artifacts render offline too, on the same switch (page on this machine only). `ArtifactPreview`
  swaps the `react-ts` template for `static` (`client/src/sandbox/preview.ts`): one `index.html` with
  the artifact's files as embedded JSON and `/__csb_vendor/react/runtime.js`. That runtime
  (`client/src/sandbox/runtime.ts`) strips TS/JSX with sucrase, links the files CommonJS-style and
  renders `App`'s default export into `#root`. Packages come from chunks a second Vite build in
  `copyArtifactRuntime` makes from npm, one lazy chunk per entry of `SANDBOX_MODULES`
  (`client/src/sandbox/modules.ts`: React, lucide-react, recharts, three, date-fns, radix, ...), ~3 MB
  on disk, only imported chunks load. A package not in that list shows an error in the preview
  instead of loading from npm; add it there (and to client devDependencies) to vendor it. A test keeps
  the list in sync with the online template's dependencies. lucide-react is the app's 0.528, not the
  0.394 the prompt names. Keep `SANDPACK_BUNDLER_URL` unset.
- Verified 2026-10-20/21 in the cloud test rig (Chromium; every non-localhost request aborted and
  unresolvable): HTML with Tailwind and inline JS, Markdown, Mermaid, the Code tab, and React
  artifacts (useState + Tailwind + lucide icon + recharts chart; shadcn Card/Tabs/Badge + three +
  date-fns) rendered with zero external requests. Without the env var React still uses codesandbox.

## Memory

- Upstream memory, switched on in the `memory:` section of `bennychat.yaml` (roadmap 7). After each
  user turn a memory agent (an ephemeral agent on provider `Benner`, model `local`) reads the last
  `messageWindowSize` messages and calls `set_memory` / `delete_memory`. Keys are limited to
  `about_user`, `preferences`, `projects`, `instructions`, 1500 tokens in total. Each key holds one value
  and `set_memory` overwrites it, so the agent's `instructions` tell it to merge the new fact into what
  the key already holds.
- Thinking is off for it: `model_parameters.reasoning_effort: 'none'` becomes
  `chat_template_kwargs.enable_thinking: false` through the llama_cpp_budget translation (see
  "Thinking mode").
- Timing: upstream starts the memory request at the same time as the reply
  (`runMemory` in `api/server/controllers/agents/client.js`). There is no setting to run it after the
  reply. At the end of the turn it waits at most 3 s for the "memory updated" chip, and a slower
  write is still saved. llama-server's default `--parallel` (auto) gives 4 slots sharing one KV cache,
  so the memory request runs beside the reply, not in front of it. Do not start llama-server with
  `-np 1`. Each turn costs one extra non-streaming request: about 700 prompt tokens, under 50 output tokens.
- Every chat's system prompt starts with "Persistent memory…" followed by the saved entries. When a
  memory changes, the next turn of an open chat has a different prompt prefix and gets processed
  again from the start.
- Users see and edit memories under Customize > Memories (filter, add, edit, delete, usage %, "Use
  memory" toggle). To switch extraction off but keep memories readable and editable, set
  `memory.agent.enabled: false`. `memory.disabled: true` turns the whole feature off.
- Verified 2026-10-20 in the cloud rig against Qwen3-1.7B: the request reaches llama-server with
  `enable_thinking: false`, `max_tokens: 400` and only the two memory tools. A stated preference was saved
  and shown in the panel. A new chat had it in its system prompt. Manual add and delete through
  `/api/memories` also worked. The 1.7B has limits: it put a preference under `about_user` in the first
  person, and once a key already held a value it described the new fact in text instead of calling
  `set_memory` (4 of 4 tries). Merging into an existing key still needs to be checked on Qwen3.5-9B.

## Routines (scheduled chats)

- Upstream's experimental scheduled chats (`packages/api/src/schedules`, README there) are switched on
  by `interface.schedules` in `bennychat.yaml`. A schedule sends a fixed prompt to an **agent** on a
  cadence (hourly/daily/weekdays/weekly or cron, own timezone) and files each run as a new chat with
  that agent. UI: "Scheduled chats" (minimal layout: Customize menu), with Run now, pause and last run.
- `.env` needs `SCHEDULES_SINGLE_PROCESS=true` (no Redis). Without it the engine does not arm: the log
  says "scheduler NOT started" and every schedule write answers 503. `SCHEDULES_DISABLED=true` is
  upstream's emergency stop for automatic and manual runs.
- How a run fires: the engine ticks every ~30 s, claims due rows with a Mongo lease, then POSTs the
  prompt to the agents chat route as the owner over loopback. `POST /api/schedules/:id/run` (the Run
  now button) fires immediately. An occurrence more than 15 min overdue (backend down, PC asleep) is
  skipped, not replayed. 5 consecutive failures auto-disable a schedule.
- Fork choices: upstream defaults (`minIntervalMinutes: 60`, the schema allows 1, used only in rig
  tests) except `fireConcurrency: 1` for the one GPU; a second due run waits for the slot (Run now
  answers "skipped (capacity)"). Labels stay "Scheduled chats": renaming to "Routines" means editing
  upstream's English locale keys, which conflicts on every sync, and there is no config override.
- Thinking: an agent with no reasoning effort set already runs at Low (`applyLlamaCppThinking`,
  512-token budget). Set the agent's thinking to Off for routines that do not need it, and keep the
  prompt short; it runs without chat history.
- One GPU: routines and live chat share llama-server. Unless local-llm starts it with `--parallel 2`
  (local-llm's launcher, roadmap F1), a routine run blocks chat until it finishes, and vice versa.
- The PC must be awake at run time: README "Routines" covers awake hours and wake timers.
- `SCHEDULES_SINGLE_PROCESS` is a promise that one backend uses this MongoDB. Two backends on the
  same database each run an engine and mark the other's live runs `interrupted` (seen in the rig).
- Verified 2026-10-20 in the cloud rig: engine armed; schedule created over the API and shown in the
  panel; with the interval lowered to 1 min in a scratch config, a `*/2` cron fired 5 runs in a row
  (mock model), each a new agents chat with the reply and `lastRun: success`; Run now against the
  CPU Qwen3-1.7B answered and filed a chat. The agent's thinking Off reached llama-server as
  `enable_thinking: false`. Run now while a run held the only slot answered "skipped (capacity)".
- Morning brief (roadmap 3): `npm run seed-benny -- [email] --brief [--schedule] [--time HH:MM]
  [--tz Area/City]` (`config/seed-brief.js`) seeds `agent_morning_brief` (thinking Off, artifacts off)
  with `list_events_mcp_calendar`, `find-tasks-by-date_mcp_todoist` and `search_mcp_websearch`, and
  with `--schedule` one daily schedule (default 07:00, the machine's zone; re-running retimes it).
  Only connectors the owner has connected are attached (calendar: a `mcp_calendar` PluginAuth row;
  Todoist: an `mcp:todoist` OAuth token), because the schedule's MCP preflight
  (`packages/api/src/schedules/mcp.ts`) disables a schedule whose agent has an unconnected server
  (`mcp_configuration_missing` / `mcp_reauth_required`) instead of running without it. Missing
  sources get no section in the format and are named on its last line ("Not connected: ..."). Re-run after
  connecting; refreshes rewrite tools and instructions, `--reset` also name/description/model.
  An expired Todoist grant still pauses the schedule (upstream behaviour, card names the server).
  Instructions use `{{current_date}}` and follow `skill/morning-brief`'s format. Tests:
  `npx jest --config config/jest.config.js seed-brief`.
  Verified 2026-10-21 in the rig (CPU Qwen3-1.7B, fixture ICS, a stdio stand-in for Todoist's
  `find-tasks-by-date`): seeding, idempotent re-seed, Run now filing a chat with the real events and
  tasks; with nothing connected the run still succeeds. DuckDuckGo is unreachable from the rig, and
  the 1.7B then invents headlines (and, with no sources at all, events) despite the instructions:
  check Qwen3.5-9B.

## Documents (Word, PDF, PowerPoint)

- `packages/documents` is a stdio MCP server (roadmap 5a) with two tools: `create_document(format, title,
  content | slides)` and `append_section(document_id, content | slides)`. The model writes Markdown
  (docx/pdf) or a slide outline (pptx: `slides` array of `{title, bullets?, left?, right?, notes?}`, or a
  Markdown outline in `content`), never OOXML; the server renders with `docx`, `pptxgenjs` and headless
  Chromium print-to-PDF (`playwright-core`) in one built-in house style (`src/theme.ts`). Long documents
  are written section by section: each `append_section` re-renders the whole file from the stored source.
- Drafts and the last rendered file live in `DOCUMENTS_DIR/<document_id>/` (default `%TEMP%\bennychat-documents`).
  Other env: `DOCUMENTS_PAGE_SIZE` (`A4`/`Letter`), `DOCUMENTS_BROWSER_PATH` / `DOCUMENTS_BROWSER_CHANNEL`
  (PDF browser; on Windows the installed Edge via channel `msedge`, nothing is downloaded),
  `DOCUMENTS_MAX_BYTES`, `DOCUMENTS_MAX_SECTIONS`.
- Each result returns the file as an embedded `resource` with a base64 `blob`. Upstream only turns MCP
  *images* into attachments and summarizes other blobs, so the fork adds the MCP server option
  `fileOutputs: true` (`packages/data-provider/src/mcp.ts`, YAML-only): `formatToolContent`
  (`packages/api/src/mcp/parsers.ts`) moves such blobs into an `mcp_files` artifact and tells the model
  "File attached to the chat", and `createToolEndCallback` (`api/server/controllers/agents/callbacks.js`)
  stores them through `processCodeOutput` with a prepared buffer, the same pipeline as code-interpreter
  outputs. That gives a download chip, per-conversation filename reuse (an append updates the same file)
  and the upstream office HTML preview card. Files over the endpoint upload limit are dropped with a warning.
- The preview card renders the office HTML through the artifacts bundler, so offline it needs
  `SANDPACK_STATIC_BUNDLER_URL` (see "Artifacts offline"); the download chip works regardless.
- Benny (`config/seed-benny.js`) lists the server; an existing Benny gets it with
  `npm run seed-benny -- --reset` or in the Agent Builder. `endpoints.agents.toolApproval.allow` has
  `*_mcp_documents`: making a file in the chat does not ask for approval, as in Claude Desktop.
- Wired in `bennychat.yaml` under `mcpServers.documents` (`alwaysOn`, `fileOutputs`). Tests:
  `cd packages/documents && npx jest` (PDF tests need a browser: Edge on Windows, else set
  `DOCUMENTS_BROWSER_PATH`); typecheck with `npx tsc --noEmit` there.

## Agents, Benny and approvals (roadmap F3, 13)

- Chats run through the Agents endpoint. `bennychat.yaml` sets `endpoints.agents` (no
  `execute_code`/`web_search`/`ocr` capabilities: no Code API, search keys or OCR here;
  `recursionLimit: 20`), top-level `summarization` (self-summarizes on the agent's own model past the
  32k default budget for model `local`) and a default model spec `benny` → `agent_id: agent_benny`.
- Agents are DB records, so `npm run seed-benny -- [email] [--reset | --reset=researcher]` (`config/seed-benny.js`) creates
  `agent_benny` (provider `Benner`, model `local`, websearch MCP + `ask_user_question`, artifacts off
  to save ~2.5k prompt tokens), owned by the given or oldest user and public-viewable. Idempotent;
  `--reset` restores the defaults. `alwaysOn` MCP servers do not attach to saved agents: Benny lists
  `websearch` itself.
- Thinking pill on agents: the pill follows the agent's provider (`ThinkingModeMenu`), the agents
  compact schema keeps `reasoning_effort`, and `selectRequestModelParameters`
  (`packages/api/src/agents/thinking.ts`) forwards it only to agents on a `llama_cpp_budget` endpoint.
- `ask_user_question` string caps are 1000: llama-server refuses tool grammars with a repetition of
  2000+ ("failed to parse grammar"), which broke every request carrying the tool.
- `toolApproval` (`mode: default`): `allow` lists read-only names/patterns (`search*_mcp_*`,
  `get*_mcp_*`, `list*_mcp_*`...); every other tool asks. MCP tool names are `<tool>_mcp_<server>`.
  "Always allow in this chat" sends `scope: 'session'`; the resume route stores the paused tool's
  name on the conversation (`approvedTools`, `select: false`, data-schemas `toolApprovals.ts`) and
  `createRun` appends it to `allow` (`resolveToolApprovalPolicy` `session` layer). `ask`/`deny`
  patterns still win over it, so do not put write tools in `ask` if they should be rememberable.

## Deep research (roadmap 16)

- Claude's Research UX on the local stack: plan first, sources cited inline, report as a document.
  The workflow is one skill, `skill/deep-research/SKILL.md`: plan 3-6 sub-questions (shown in the
  reply, no approval wait) → per sub-question one `search`, 1-3 `fetch` calls with `maxChars: 6000`,
  then a ≤150-word note in the chat with numbered sources → report via `create_document` (Summary,
  default `pdf`; `docx`/`md` on request), one `append_section` per sub-question, then `## Sources`.
  Notes stay in the chat, so the report step needs no re-fetch.
- **Researcher agent** (`agent_researcher`, model spec `researcher`, seeded with Benny by
  `npm run seed-benny`): its instructions are the skill body read at seed time (re-seed with
  `--reset=researcher` after editing the skill), so the 9B model follows it from the first token
  with no `skill` call (the rig's small model never called `skill` on its own). Tools: websearch +
  documents only (4 tools, ~2.7k chars of system prompt). `recursion_limit: 100` (one tool round
  is ~3 graph steps; a 6×3 run plus report needs ~30 rounds), hence `maxRecursionLimit: 100` in
  `bennychat.yaml`; `model_parameters.maxContextTokens: 96000` so a long run is not summarized
  away at the 32k default (needs llama-server at ~120k ctx).
- **Benny** now has `skills_enabled: true` (scope all) in the seed, so the skill catalog and `$`
  picks work there; this adds the `skill`/`read_file` and, while `interface.skills.create` is on,
  `create_file`/`edit_file` tools (~1.6k tokens). With Benny's limit of 20 steps the skill's
  "Short runs" rule applies: 3 sub-questions, 1 source each, one `create_document` call.
- **No subagents.** The `subagents` capability (parallel sub-question workers in isolated contexts)
  is not used: on one GPU the workers share the same slots, so parallelism buys little, the tool's
  own description is ~350 tokens, and a 9B must write a self-contained brief per worker. A whole
  run stays ~20-30k tokens with the 6000-char fetch cap, well inside 120k, so isolation is not needed.
- `packages/documents` gained `format: 'md'` (`text/markdown`, title as `#` heading). The client
  shows a file updated in place by several tool calls (same `file_id`, e.g. each `append_section`)
  as one chip, its latest version (`latestFileVersions` in `Parts/Attachment.tsx`).
- Verified 2026-10-21 in the rig with a scripted stand-in model (test-only, not committed) and the
  real websearch server wrapped with an injected fetch that maps fake public hosts onto 4 local
  HTML pages (the committed SSRF guard untouched; a direct loopback fetch was still refused):
  plan, 3 notes with numbered sources, and a cited PDF attached to the chat in 13 tool rounds;
  prompts grew from ~1.9k to ~5k tokens. Benny, loading the skill through the `skill` tool, did
  the short run in 8 tool rounds within its 20-step limit (a "3 rounds left" notice arrives at round
  7) and attached a `.md` report. The rig's Qwen3-1.7B made the plan and searched, but wrote notes
  from snippets without fetching and never made the document. Not verified: Qwen3.5-9B, live websites.

## Connectors (Todoist, calendar, email)

- Roadmap 4; full setup in `docs/connectors.md`. Three `mcpServers` entries in `bennychat.yaml`, all
  `startup: false`: each user connects from the MCP panel, credentials stay per user, encrypted in
  MongoDB (never `.env`/git). Enable per chat in the MCP selector, or add to an agent.
- `todoist`: Todoist's official remote server `https://ai.todoist.net/mcp`, `requiresOAuth`; LibreChat
  does dynamic client registration and the callback is `<DOMAIN_SERVER>/api/mcp/todoist/oauth/callback`.
  ~45 tools, so add it only where needed. Writes ask via `endpoints.agents.toolApproval` (roadmap 13).
- `calendar` (`packages/calendar`, ical.js): read-only `list_events` / `search_events` over the secret
  ICS address (Google or Outlook publish one), set as the per-user var `CALENDAR_ICS_URL` (several:
  `|`-separated). Feeds cached 5 min. Google/Outlook API servers with writes can be added later.
- `email` (`packages/email`, imapflow + mailparser): read-only `search_emails` / `read_email` /
  `list_folders` over IMAP with an app password (Gmail, Fastmail, iCloud; not Outlook.com, which has
  no password IMAP). Folders opened with EXAMINE, so reading never marks mail read; no send tool.
- Unfilled per-user vars reach the servers as literal `{{VAR}}`; both servers treat that as "not
  connected" and answer with setup instructions instead of failing.
- Tests: `cd packages/calendar && npx jest` (fixture ICS: recurrence, EXDATE, moved occurrence, DST,
  IANA TZID without VTIMEZONE, floating, all-day); `cd packages/email && npx jest`, with
  `EMAIL_TEST_IMAP_PORT=3143` against a GreenMail container for the live IMAP suite.
- Small models invent dates: the calendar tools default to today and their descriptions say to leave
  `start` out; the result always begins with "Now: <date>".

## Folder access

- Roadmap 8. `mcpServers.filesystem` in `bennychat.yaml` runs the reference
  `@modelcontextprotocol/server-filesystem` through `packages/folders` (`node
  packages/folders/src/index.mjs`), which pins it as a dependency (no `npx` download per launch) and
  passes it the folders from `BENNY_FOLDERS` in `.env`: `;`-separated on Windows, `%VAR%`/`~`
  expanded, e.g. `%USERPROFILE%\Documents\Assistant;%USERPROFILE%\Documents\Notes`. Unset, it
  uses `<home>\Documents\Assistant` and creates it. LibreChat's MCP client has no Roots support, so
  the command line is the whole allow-list; paths outside it are refused by the server.
- Pinned at `2026.8.31` (deprecated date tag, but it shares LibreChat's `@modelcontextprotocol/sdk`
  1.30): `1.0.0`/`2.0.0` need SDK >= 1.31 and would bump LibreChat's own SDK in the lock. Move up
  after an upstream sync brings the SDK forward. This version's `edit_file` saves CRLF files as LF.
- Approval rides on roadmap 13's `toolApproval` (`mode: default`): reads match its `read*`/`list*`/
  `search*`/`get*_mcp_*` allow patterns, `directory_tree_mcp_filesystem` is added explicitly, and
  `write_file`, `edit_file`, `create_directory`, `move_file` match nothing, so they ask (Claude
  Desktop's Filesystem extension: reads free, writes ask). Do not put them in `ask`, or "Always
  allow in this chat" stops working for them.
- Benny (`config/seed-benny.js`) carries 9 of the 14 tools (~5.4k chars of schemas, ~1.4k tokens):
  no `read_file` alias, `read_media_file`, `read_multiple_files`, `list_directory_with_sizes` or
  `directory_tree`. Like Claude Desktop, where an enabled extension is in every chat. An existing
  Benny needs `npm run seed-benny -- --reset`. The server is not `alwaysOn`: non-agent chats pick
  "Folders" (all 14 tools, ~8k chars) from the MCP selector.
- Output size: the server has no content grep (`search_files` matches names by glob).
  `serverInstructions` steers the model to `search_files`/`list_directory` and `read_text_file`
  `head`/`tail`; for a hard cap set `maxToolResultChars` on the endpoint.
- Tests: `cd packages/folders && npm test` (node:test, folder parsing).
- Verified 2026-10-20 in the Linux rig (Qwen3-1.7B, CPU): the server connected at startup with 14
  tools; in a chat with Folders picked, the model listed and read a file in the allowed temp folder,
  a read outside it came back "Access denied - path outside allowed directories", and `write_file`
  showed the Approve/Reject card and wrote the file only after Approve. Re-run on the agents build
  with a seeded Benny: read and approved write both worked through Benny's folder tools.

## Projects

- Upstream chat projects (name, description, chat grouping; `packages/api/src/projects`,
  `client/src/components/Projects`) plus Claude Projects-style **instructions** and **knowledge
  files** (roadmap P1a). Both live on the `ChatProject` record (`instructions`, 8000 chars;
  `knowledgeFileIds`, max 50, `packages/data-schemas/src/methods/chatProject.ts`) and are edited in
  the project page's right column (`ProjectKnowledge.tsx`; stacked above the chat list on a phone).
- Knowledge files are ordinary uploads made with `tool_resource=context`, so their text is
  extracted once on upload (same parsers as "Attachments"). Removing one detaches it; the file
  itself stays in the user's files. Routes: `GET/POST /api/projects/:id/knowledge`,
  `DELETE /api/projects/:id/knowledge/:fileId`.
- Injection seam: `loadProjectRunContext` (`packages/api/src/projects/context.ts`), called from
  `api/server/services/Endpoints/agents/initialize.js` beside the other startup reads. Every chat
  goes through that agents path (custom endpoints run as ephemeral agents), so plain Benner chats
  and agent runs share it. The project is the saved conversation's `chatProjectId`, or the
  request's for a new chat. The block (`<project_instructions>`, `<project_knowledge>` with one
  `<document>` per file) is appended to the primary agent's stable `instructions` inside
  `initializeAgent` (`projectInstructions`), after the agent's own text and after special-variable
  resolution, so it stays byte-identical across turns and llama-server reuses the cached prefix.
  Subagents and title requests do not get it.
- Knowledge budget: `projects.knowledgeInlineTokens` in `bennychat.yaml` (default 6000, estimated
  at 4 chars/token, no tokenizer per turn). Under it every file is read in full; over it files are
  read in order until the budget runs out, the overflowing one cut (`truncated="true"`), the rest
  named as left out. `planProjectKnowledge` already models a retrieval mode (all files to
  `file_search` past the budget, `applyProjectSearchFiles`), but the wiring passes
  `retrievalAvailable: false` until knowledge files are embedded on add.
- Verified 2026-10-20 in the cloud rig (Qwen3-1.7B, logging proxy): the system message reached
  llama-server with instructions and file text; the reply followed the instructions and quoted the
  file; a follow-up turn in the saved chat got the same block; a chat outside the project got none;
  the configured budget truncated as described. UI: instructions dialog, upload and phone width
  (removing a file is covered by the component test only).

## Project threads and coordinator (roadmap P1b/P1c)

- Like a Claude project with a coordinator and task threads. `projects.threads` in
  `bennychat.yaml` (`configSchema`, default off). The first non-thread chat to run a turn in a
  project becomes its coordinator (`ChatProject.coordinatorConversationId`, set-if-empty; handed
  on when that chat is deleted). Only the coordinator gets the four tools `start_thread`,
  `list_threads`, `read_summary`, `post_to_thread` (`packages/api/src/projects/threads/tools.ts`),
  as in-process `graphTools` via a fork field `hostGraphTools` on the run agent
  (`packages/api/src/agents/run.ts`), set in `initialize.js` by `resolveCoordinatorTools`. They
  are on the `toolApproval.allow` list (they only touch chats inside the project).
- A thread is a `ProjectThread` record (`packages/data-schemas/src/methods/projectThread.ts`) plus
  an ordinary chat in the project (`chatProjectId` set, so it gets instructions and knowledge;
  never the tools or the index). Status working / needs_you / done / failed lives on the record and
  is mirrored to `conversation.threadStatus` for the list badges (`ThreadStatusChip`). Route:
  `GET /api/projects/:id/threads`; the project page shows a Threads card and a Coordinator button.
- Runner: `createProjectThreadService` (`packages/api/src/projects/threads/service.ts`), wired in
  `api/server/services/Projects/threads.js` and started after the schedule engine. Runs go through
  the durable agent trigger queue (`enqueueAgentTrigger`, `fire` for the first run with the
  thread's own `newConversationId`, `continue` for `post_to_thread`), source type
  `project_thread` (`isProjectThreadFireRequest`; `request.js` honors `newConversationId` and skips
  auto-titles for it). One at a time (`concurrency`, default 1) and only when no other generation
  is running, so a thread starts after the coordinator's reply and waits behind live chat.
  `GenerationJobManager.onGenerationSettled` finishes a run; a 15 s sweep catches approval pauses
  (`requires_action` -> needs_you), missed settles and lost runs (failed after 30 min).
- Finish: a summary step (`summary.ts`) calls the agent's custom endpoint `/chat/completions`
  directly with thinking off (`chat_template_kwargs.enable_thinking: false`), ≤`summaryMaxTokens`
  (300), from the brief plus the thread's final reply; on failure it keeps the reply's start.
  The coordinator's project block ends with its role line plus `<project_threads>` (finished
  threads only, newest `indexLimit`, title/status/summary), so it changes only when a thread
  finishes and the prefix cache holds. Notifications: `onStatusChange` in the wiring is the hook
  point for the N15 Notifier.
- Single backend per database (the runner is in-process, like schedules). Verified 2026-10-21 in
  the rig with a scripted stand-in model and with Qwen3-1.7B on CPU: coordinator called
  `start_thread`, the thread ran after the reply, finished with a summary, showed done, and the
  coordinator's next turn had the summary in its system prompt.

## Keyboard shortcuts

- New chat is **Ctrl+N** (⌘N on macOS), changed from upstream's Ctrl+Shift+O in
  `client/src/hooks/useKeyboardShortcuts.ts`. It also fires while typing in the composer
  (`EDITING_ALLOWED_SHORTCUTS`).
- Chrome, Edge and Firefox reserve Ctrl+N in a normal tab: it opens a new window before the page sees
  the keypress, and `preventDefault` cannot stop it. It reaches the app only in an installed app
  window (Edge/Chrome: "Install this site as an app" on `http://localhost:3080`; the client ships a
  `standalone` manifest). In a tab, rebind it in the Keyboard Shortcuts dialog (Ctrl+Shift+/).

## Minimal layout

- `interface.layout: minimal` in `librechat.yaml` (default `classic`) gives a Claude Desktop-style
  screen: the desktop sidebar shows text rows (New chat, Chats, Agents, a Customize menu for the other
  panels, the account row) instead of the icon rail; the model selector sits next to Send; header
  actions live in the "…" menu at every width; the welcome-screen disclaimer is hidden; reply actions
  appear on hover, the latest reply included. Conversation rows drop their endpoint icon. On
  desktop (≥768px) the root font size is 112.5% (18px), set in `client/src/style.css` via
  `html[data-layout="minimal"]`, which `routes/Root.tsx` sets.
- Read it in the client with `useMinimalLayout()`. On a phone the drawer keeps its stock structure but its
  text is one size larger (`MINIMAL_DRAWER_TEXT` in `client/src/components/UnifiedSidebar/constants.ts`).

## Fork workflow (overrides upstream "Branching and Pull Requests")

- `origin` has only `main`. Upstream's `dev`/`canary` rules describe LibreChat's own repo, not this
  fork: here, branch from `main` and target `main` on `origin`.
- Upstream sync is by merging `upstream/main` into `main`; do it only when asked.
- Tasks live on the dotpm board named in `.claude/dotpm.json` ("Local LLM", shared with
  `../local-llm`). The global `/pickup` skill takes a task from its "Claude" column, works it on a
  `task/<slug>` branch and moves it to "In Review"; only the owner sets "Done". Because the board is
  shared, a task may belong to the other repo: check that it concerns this one before claiming it.
- `/.claude/` is git-ignored upstream; files under it that should be versioned (like `dotpm.json`
  and `settings.json`) are added with `git add -f` once and tracked from then on.

# LibreChat

## Project Overview

LibreChat is a monorepo with the following key workspaces:

| Workspace | Language | Side | Dependency | Purpose |
|---|---|---|---|---|
| `/api` | JS (legacy) | Backend | `packages/api`, `packages/data-schemas`, `packages/data-provider`, `@librechat/agents` | Express server — minimize changes here |
| `/packages/api` | **TypeScript** | Backend | `packages/data-schemas`, `packages/data-provider` | New backend code lives here (TS only, consumed by `/api`) |
| `/packages/data-schemas` | TypeScript | Backend | `packages/data-provider` | Database models/schemas, shareable across backend projects |
| `/packages/data-provider` | TypeScript | Shared | — | Shared API types, endpoints, data-service — used by both frontend and backend |
| `/client` | TypeScript/React | Frontend | `packages/data-provider`, `packages/client` | Frontend SPA |
| `/packages/client` | TypeScript | Frontend | `packages/data-provider` | Shared frontend utilities |

The source code for `@librechat/agents` (major backend dependency, same team) lives at
<https://github.com/LibreChat-AI/agents>.

---

## Workspace Boundaries

- **All new backend code must be TypeScript** in `/packages/api`.
- **`/api` holds wiring, not behavior.** When a change would add logic to a CJS file under `/api` —
  a branch, a helper, a validation step, a new service call — that logic goes in `/packages/api`,
  and the JS file keeps only what wires it up: requires, route registration, request plumbing, and
  the call into the TS module. `api/server/services/MCPRequestContext.js` is the shape, at thirteen
  lines of re-export. "Minimum" describes how much behavior `/api` gains, not how small the diff is:
  lifting a function into `/packages/api` and calling it is the larger diff and the correct one.
  Editing an existing CJS file is the common case and the rule applies there, not only to new files.
- Database-specific shared logic goes in `/packages/data-schemas`.
- Frontend/backend shared API logic (endpoints, types, data-service) goes in `/packages/data-provider`.
- Build data-provider from project root: `npm run build:data-provider`.
- **Database contracts stay inside `/packages/data-schemas`.** A Mongoose type in an exported
  signature — `FilterQuery`, `Types.ObjectId`, `Document`, `HydratedDocument` — makes the storage
  engine part of that module's public API, and every consumer then depends on Mongo instead of on
  the data it needs. Take and return plain typed objects, and express the query behind a
  data-schemas method. The boundary already leaks across dozens of files in `/packages/api`, so the
  rule is to stop widening it rather than to rewrite what exists; `/client` carries none of it and
  must stay that way.
- **New levers ship configurable.** A limit, timeout, toggle or capability introduced in code earns
  a field on `configSchema` (`packages/data-provider/src/config.ts`) so an operator can set it in
  `librechat.yaml`, with a default that reproduces today's behavior. Hard-coded constants and
  env-only switches need a reason. The schema is also what keeps one definition of the value instead
  of a constant, a fallback and a doc line that drift apart.
- **A backend module takes its dependencies, it does not reach for them.** Code in `/packages/api`
  should receive its config, database methods and clients from the caller the way
  `createModels(mongoose)` receives the app's connection, rather than importing app singletons or
  reading global state. A module the caller constructs can be tested without a running app and moved
  to another workspace without a rewrite; one that calls `getInstance()` can do neither. This is the
  backend half of "Client State Ownership" — pass it in, do not reach for it. The static singletons
  under `packages/api/src/mcp` are the shape to stop extending, not a pattern to copy.
- **Integrations arrive through an interface the caller supplies.** A provider SDK, storage backend,
  vector store or OAuth server is injected, so a second implementation is a new argument instead of
  a new branch in shared code, and a test can exercise the real logic against a substitute at the
  boundary rather than mocking the module that holds it.

---

## Branching and Pull Requests

- **Normally branch off `dev` and target `dev`.** This is the default for work ready to follow the
  regular release path. A maintainer-directed canary exception is described below.
- **`main` is the released branch.** It is kept as a fast-forward of `dev` and synced as-is, so it
  is always an ancestor of `dev` — equal to it right after a sync, behind it otherwise. It never
  carries a commit that `dev` does not have.
- **Never open a backport pull request to `main`.** Anything merged to `dev` reaches `main` at the
  next sync; a second pull request for the same change is redundant.
- **The repository's default branch is `main`**, so `gh pr create` and the GitHub UI target it
  unless told otherwise — pass `--base dev` for normal work or `--base canary` for an explicitly
  maintainer-directed canary PR.
- Pull requests opened against `main` are retargeted to `dev` automatically by
  `.github/workflows/pr-retarget-dev.yml`. The `target: main` label exempts one, as do release-bound
  upstream branches (`dev`, `release/*`, `hotfix/*`). PRs deliberately based on `canary` are not
  retargeted, including manual sweeps; the script skips them explicitly. Backport branches are
  deliberately not exempt — a backport merged straight to `main` breaks the fast-forward invariant.
- **Canary is an explicit, maintainer-selected integration target, not a path that automatically
  flows to `dev` or `main`.** Experimental changes and PRs that are ready to merge following review
  but must not enter the next `main` sync can go to `canary`. The maintainer may decide this when
  assigning the work or while reviewing an older/stale PR. For a new canary PR, branch from the
  current `origin/canary` and set `--base canary`. Never infer that a canary-targeted PR should move
  to `dev` just because `dev` is the default; do not copy canary features into `dev` without an
  explicit maintainer decision. If a stale PR is reassigned to canary, check the PR's base, diff and
  exact reviewed head against current canary before changing its base or proposing a new canary
  branch/PR; if a rebase changes the head, verify and review that new head before merging.
- **Link related issues in the PR even when they will not auto-close.** Reference each relevant
  issue in the description (for example, `Related to #N`) so reviewers can find the context and
  track the work. GitHub honors `Fixes #N` and other closing keywords only when a pull request
  merges into the default branch (`main`). Merging to `dev` or `canary` does not close an issue,
  and the later fast-forward of `main` is not a merge event either — close resolved issues by hand
  after merging.
- **Git worktrees share one stash stack.** `refs/stash` lives in the common `.git` directory, so a
  bare `git stash pop` in one worktree can take work stashed in another. Prefer a throwaway WIP
  commit; if you must stash, `git stash push -m <tag>` and `apply` that specific entry.
- **Write the description for a reader who has not followed the branch.** Say what breaks, what
  triggers it, and how it behaves after the change, then show the mechanism with whichever one or
  two views make it reviewable — a focused diff, a call tree, a shallow file tree, or a Mermaid
  sequence — keeping only the calls, files and state the change actually carries. Describe the code
  as it stands: do not narrate what earlier commits tried or what a review round changed. Naming the
  merged pull request that caused the bug is different — that is history the reader needs.
  `.github/pull_request_template.md` carries the formats and examples.

---

## Review and Completion

### AI review cycles

The reviewer, its trigger phrase and its cadence all change; this subsection is the fluid one, so
rewrite it when they do. What survives a change of tool: a review counts only for the exact commit
it ran on, its findings are judged against the code rather than accepted or dismissed wholesale, and
findings that keep arriving mean the subsystem needs a sweep, not another patch.

- **Inline review threads are the source of truth.** A summary comment, a check name or a
  notification list omits findings — read the threads on the pull request itself.
- Audit every finding against the current code. Fix the valid ones; reject the obsolete or wrong
  ones in a reply that says why.
- After each round of fixes, run the focused tests and `npx tsc --noEmit` for every workspace you
  changed, push, read the pull request's remote head (`gh pr view <n> --json headRefOid`), and
  request the next review naming that exact SHA. **A clean review of an earlier head says nothing
  about what you just pushed.** Do not wait for CI before asking — review and CI run on their own
  clocks.
- Reply on each thread you resolved with the commit that resolved it and the coverage that proves
  it.
- **After two actionable rounds** — or sooner, when each fix uncovers an adjacent defect — stop
  answering threads one at a time and read the subsystem by invariant: identity, ownership,
  authorization, persistence, retry, replay, abort, cleanup, expiry, rollout. Follow producers,
  consumers, adapters, alternate write paths, and the final consumer of every limit; check
  mixed-version behavior in both directions; read the whole base-to-head diff with the callers and
  tests around it; then add transition or failure-injection coverage at the deepest boundary that
  owns the behavior.
- The cycle ends when the exact pushed head draws no major findings, or only repeats ones already
  resolved. A clean review is one completion signal, not the definition of done.

### Definition of done

- **Ship the observable experience, not the reported path.** Where they apply, cover loading, empty,
  success, failure, cancellation, retry and restored-session behavior.
- **A backend capability with no frontend entry point is unfinished**, and so is a control with no
  validation, persistence, error handling or authorization behind it.
- Localize every visible string through `useLocalize()`, keep semantic HTML, keyboard behavior and
  ARIA intact, and compose shared primitives and semantic theme roles before adding local styling
  (see "Frontend Rules"). Custom styling that proves unavoidable still supports light/dark and
  reduced motion.
- Preserve existing defaults, configuration compatibility, stored data, and mixed-version behavior,
  and expose any new lever through `configSchema` rather than a constant (see "Workspace
  Boundaries").
- Make the fix the smallest one consistent with the patterns already in the file, and test the
  behavior that was missed rather than the line a reviewer pointed at.
- **Report what you actually ran**: the pushed head, the local checks from "Testing" and
  "Typechecking", CI state, the review result at that head, and any finding you rejected with the
  reasoning. Name the checks you could not run instead of implying coverage.

---

## Code Style

### Naming and File Organization

- **Single-word file names** whenever possible (e.g., `permissions.ts`, `capabilities.ts`, `service.ts`).
- When multiple words are needed, prefer grouping related modules under a **single-word directory** rather than using multi-word file names (e.g., `admin/capabilities.ts` not `adminCapabilities.ts`).
- The directory already provides context — `app/service.ts` not `app/appConfigService.ts`.

### Structure and Clarity

- **Never-nesting**: early returns, flat code, minimal indentation. Break complex operations into well-named helpers.
- **Functional first**: pure functions, immutable data, `map`/`filter`/`reduce` over imperative loops. Only reach for OOP when it clearly improves domain modeling or state encapsulation.
- **No dynamic imports** unless absolutely necessary.

### DRY

- Extract repeated logic into utility functions.
- Reusable hooks / higher-order components for UI patterns.
- Parameterized helpers instead of near-duplicate functions.
- Constants for repeated values; configuration objects over duplicated init code.
- Shared validators, centralized error handling, single source of truth for business rules.
- Shared typing system with interfaces/types extending common base definitions.
- Abstraction layers for external API interactions.

### Iteration and Performance

- **Minimize looping** — especially over shared data structures like message arrays, which are iterated frequently throughout the codebase. Every additional pass adds up at scale.
- Consolidate sequential O(n) operations into a single pass whenever possible; never loop over the same collection twice if the work can be combined.
- Choose data structures that reduce the need to iterate (e.g., `Map`/`Set` for lookups instead of `Array.find`/`Array.includes`).
- Avoid unnecessary object creation; consider space-time tradeoffs.
- Prevent memory leaks: careful with closures, dispose resources/event listeners, no circular references.

### Backend Database Performance

- On request startup and first page load paths, watch for serial database reads.
  Multiple round trips to MongoDB can add significant latency when the database
  is far from the app server.
- Prefer passing already-loaded request/user/config data through helper
  functions instead of re-reading the same user, role, tenant, or principal data.
- When two reads are independent, start them in parallel and gate the response
  on the authorization or validation result before returning data.
- Keep authorization, permission, and tenant checks semantically identical when
  parallelizing reads. Speculative reads must remain scoped to the authenticated
  user or tenant and must not write to the response before validation succeeds.

### Type Safety

- **Never use `any`**. Explicit types for all parameters, return values, and variables.
- **Limit `unknown`** — avoid `unknown`, `Record<string, unknown>`, and `as unknown as T` assertions. A `Record<string, unknown>` almost always signals a missing explicit type definition.
- **Don't duplicate types** — before defining a new type, check whether it already exists in the project (especially `packages/data-provider`). Reuse and extend existing types rather than creating redundant definitions.
- Use union types, generics, and interfaces appropriately.
- All TypeScript and ESLint warnings/errors must be addressed — do not leave unresolved diagnostics.

### Comments and Documentation

- Write self-documenting code; no inline comments narrating what code does.
- JSDoc only for complex/non-obvious logic or intellisense on public APIs.
- Single-line JSDoc for brief docs, multi-line for complex cases.
- Avoid standalone `//` comments unless absolutely necessary.

### Import Order

Imports are organized into three sections:

1. **Package imports** — sorted shortest to longest line length (`react` always first).
2. **`import type` imports** — sorted longest to shortest (package types first, then local types; length resets between sub-groups).
3. **Local/project imports** — sorted longest to shortest.

Multi-line imports count total character length across all lines. Consolidate value imports from the same module. Always use standalone `import type { ... }` — never inline `type` inside value imports.

### JS/TS Loop Preferences

- **Limit looping as much as possible.** Prefer single-pass transformations and avoid re-iterating the same data.
- `for (let i = 0; ...)` for performance-critical or index-dependent operations.
- `for...of` for simple array iteration.
- `for...in` only for object property enumeration.

---

## Frontend Rules (`client/src/**/*`)

### Localization

- All user-facing text must use `useLocalize()`.
- Only update English keys in `client/src/locales/en/translation.json` (other languages are automated externally).
- Semantic key prefixes: `com_ui_`, `com_assistants_`, etc.

### Components

- TypeScript for all React components with proper type imports.
- Semantic HTML with ARIA labels (`role`, `aria-label`) for accessibility.
- Group related components in feature directories (e.g., `SidePanel/Memories/`).
- Use index files for clean exports.

### Theming and styling

- **Compose before styling.** Search `@librechat/client` for an existing primitive, semantic
  variant, or composition before adding feature-local classes or CSS.
- **Use semantic roles.** Colors and shared appearance values must come from the semantic
  Tailwind/theme roles. Do not add raw palette utilities, hard-coded hex/RGB/HSL colors, or
  light/dark-specific values in feature components.
- **Deepen the system when the need is reusable.** Add a focused variant to a shared primitive or
  extend the canonical, versioned theme-token registry when multiple screens should share the
  same design decision. Do not create shallow local wrappers that merely relocate class strings.
- **Themes are data, not arbitrary CSS.** Theme definitions may select semantic colors and shared
  appearance roles. They must not contain selectors, arbitrary CSS, application behavior, or
  alternate feature layouts. Preserve existing environment and stored-theme compatibility when
  changing the theme engine.
- **Keep layout and behavior local.** Feature structure, responsive layout, state-driven
  transitions, and specialized visualization may remain feature-owned. Expose a theme role only
  when it represents a stable, reusable appearance decision; do not turn every measurement into a
  global token.
- **Treat custom CSS as an exception.** Use it only when shared primitives and semantic utilities
  cannot express the requirement. Keep it narrowly scoped, consume theme variables where
  applicable, support light/dark and reduced motion, and add a brief code or PR explanation of why
  the exception is necessary.
- **Preserve defaults and prove variability.** New theme-aware variants must reproduce the current
  default appearance unless a redesign is explicitly requested. Test semantic-token use and, when
  extending theme capabilities, include a deliberately different reference theme to prove that
  components adapt without feature-specific overrides.

### Data Management

- Feature hooks: `client/src/data-provider/[Feature]/queries.ts` → `[Feature]/index.ts` → `client/src/data-provider/index.ts`.
- React Query (`@tanstack/react-query`) for all API interactions; proper query invalidation on mutations.
- QueryKeys and MutationKeys in `packages/data-provider/src/keys.ts`.

### Client State Ownership

The client is migrating from Recoil to Jotai. **New state is always Jotai**, including inside a file
that already imports Recoil. For existing state, the unit of conversion is one atom together with
every file that reads or writes it: the two libraries hold different atom objects, so an atom cannot
be half converted, and many files already import both — mixed imports are not a signal that either
choice is fine here. Convert the areas you touch rather than migrating wholesale, and split the work
by who owns the state:

- **Feature-owned state** — atoms a single feature both writes and reads. Convert these to
  Jotai as you touch them, with all of their consumers, and keep them inside the feature.
  `client/src/store/jotai-utils.ts` carries the equivalents for persisted atoms
  (`createStorageAtom`, `createStorageAtomWithEffect`, `createTabIsolatedAtom`), so a Recoil atom
  with a localStorage effect has a direct port.
- **App-global state** — preferences and shell state a feature merely consumes
  (`maximizeChatSpace`, `showScrollButton`, `enterToSend`, artifact visibility). A feature
  that could plausibly be extracted must not reach into `~/store` for these; accept them
  through props or a small context the host supplies. When a consumer sits outside the feature you
  are changing, leave the atom on Recoil and pass it in — do not convert the shell to make one
  feature tidy.

Passing app-global state in — rather than reaching for it — is what lets a feature move to
its own workspace later without a rewrite, and it keeps the Jotai conversion scoped to the
state a feature actually owns instead of dragging the global migration forward early.

### Data-Provider Integration

- Endpoints: `packages/data-provider/src/api-endpoints.ts`
- Data service: `packages/data-provider/src/data-service.ts`
- Types: `packages/data-provider/src/types/queries.ts`
- Use `encodeURIComponent` for dynamic URL parameters.

### Performance

- Prioritize memory and speed efficiency at scale.
- Cursor pagination for large datasets.
- Proper dependency arrays to avoid unnecessary re-renders.
- Leverage React Query caching and background refetching.

---

## Backend Rules (`api/**`, `packages/api/**`)

### Auth cache invalidation

When adding or changing code that mutates user documents, invalidate the auth user document cache
for the affected users. This covers single-user updates as well as bulk role and user mutations.
Without it, OpenID JWT request burst caching can serve a stale `req.user` until its TTL expires.

---

## Development Commands

| Command | Purpose |
|---|---|
| `npm run smart-reinstall` | Install deps (if lockfile changed) + build via Turborepo |
| `npm run reinstall` | Clean install — wipe `node_modules` and reinstall from scratch |
| `npm run backend` | Start the backend server |
| `npm run backend:dev` | Start backend with file watching (development) |
| `npm run build` | Build all compiled code via Turborepo (parallel, cached) |
| `npm run frontend` | Build all compiled code sequentially (legacy fallback) |
| `npm run frontend:dev` | Start frontend dev server with HMR (port 3090, requires backend running) |
| `npm run build:data-provider` | Rebuild `packages/data-provider` after changes |

- Node.js: v24.16.0
- Database: MongoDB
- Backend runs on `http://localhost:3080/`; frontend dev server on `http://localhost:3090/`

---

## Testing

- Framework: **Jest**, run per-workspace.
- Run tests from their workspace directory: `cd api && npx jest <pattern>`, `cd packages/api && npx jest <pattern>`, etc.
- Frontend tests: `__tests__` directories alongside components; use `test/layout-test-utils` for rendering.
- Cover loading, success, and error states for UI/data flows.

### Typechecking

- **A green build is not a typecheck.** `packages/api`, `packages/client` and `packages/data-schemas`
  build with `tsdown` alone, which emits without checking types. Only `packages/data-provider` runs
  `tsc` as part of its build.
- Run `npx tsc --noEmit` in the workspace you changed before calling it done. `client` also exposes
  it as `npm run typecheck`.
- `packages/client/tsconfig.json` excludes `*.spec.ts(x)` and `*.test.ts(x)`, so test files there are
  never typechecked — a type error in a spec surfaces only when the test runs.
- `npm run static-checks` runs the Static Checks CI job locally against your staged files;
  `npm run static-checks -- --against origin/dev` reproduces what CI sees for a pull request, and
  `npm run static-checks:full` adds the slow gates (TypeScript, config migration tests, unused i18n
  keys, unused npm packages).

### Philosophy

- **Real logic over mocks.** Exercise actual code paths with real dependencies. Mocking is a last resort.
- **Spies over mocks.** Assert that real functions are called with expected arguments and frequency without replacing underlying logic.
- **MongoDB**: use `mongodb-memory-server` for a real in-memory MongoDB instance. Test actual queries and schema validation, not mocked DB calls.
- **MCP**: use real `@modelcontextprotocol/sdk` exports for servers, transports, and tool definitions. Mirror real scenarios, don't stub SDK internals.
- Only mock what you cannot control: external HTTP APIs, rate-limited services, non-deterministic system calls.
- Heavy mocking is a code smell, not a testing strategy.

---

## Formatting

Fix all formatting lint errors (trailing spaces, tabs, newlines, indentation) using auto-fix when available. All TypeScript/ESLint warnings and errors **must** be resolved.

`npm run sort-imports` with no arguments rewrites every file under `api/`, `client/src` and the four
`packages/*/src` roots — far beyond what you touched. Always pass explicit paths:
`npm run sort-imports -- path/to/file.ts`.


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:1105d646 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->
