<p align="center">
  <img src="client/public/assets/logo.svg" height="160" alt="BennyChat cat logo">
  <h1 align="center">BennyChat</h1>
</p>

<p align="center">
  A private chat app for a model running on my own GPU.
</p>

BennyChat is a personal fork of [LibreChat](https://github.com/LibreChat-AI/LibreChat). It is the
front end for [local-llm](https://github.com/aquerman/local-llm), which serves an open-weight model
with llama.cpp `llama-server` on an RTX 3060 (12 GB). BennyChat does not run models itself: it talks
to that server over its OpenAI-compatible API, by default at `http://127.0.0.1:8080/v1`.

Everything stays on the machine. There is no cloud provider in the loop, and the app can be reached
from a phone over Tailscale.

## What's different from LibreChat

- **BennyChat name and cat logo.** Tab title, installable app (PWA) name, favicons and login screen.
- **Minimal layout.** `interface.layout: minimal` in `librechat.yaml` gives a Claude Desktop-style
  screen: a text sidebar (New chat, Chats, Agents, a Customize menu, the account row), the model
  selector next to Send, header actions in one "…" menu, reply actions on hover, and larger text on
  desktop.
- **Phone menu.** On a phone the drawer keeps LibreChat's structure with its text one size larger.
- **Document side panel.** Clicking a PDF or image you attached opens the original file in the
  right-hand panel. For files the model read as text, a button shows the extracted text.
- **PDFs as text.** llama-server cannot take PDF bytes, so PDFs are parsed on upload and their text
  goes into the prompt instead.
- **Thinking mode.** An Off/Low/Medium/High pill in the input bar sets llama-server's thinking budget
  for models that reason (for example Qwen3.5). Reasoning shows as "Thinking..." and then
  "Thought for Ns", which you can click to read.
- **Web search.** A small built-in MCP server (`packages/websearch`) gives the model `search`
  (DuckDuckGo, no API key) and `fetch` (a web page as readable text). With `alwaysOn: true` on the
  server in `librechat.yaml` it is attached to every chat, so there is nothing to switch on.
  Pages that only fill in with JavaScript are read again in a headless copy of the Microsoft Edge
  already installed on Windows (no browser download); `WEBSEARCH_RENDER` (`auto`, `always`, `off`)
  and `WEBSEARCH_BROWSER_PATH` in the server's `env` block change that.
- **Phone notifications.** When a routine (scheduled chat) finishes, fails or waits for your
  approval, BennyChat pushes a notification through [ntfy](https://ntfy.sh): the routine's name,
  the first line of its reply, and a tap that opens the chat (optional, see below).
- **Search past chats.** LibreChat's sidebar search, backed by a local Meilisearch that
  `scripts\start-all.bat` starts from `bin\meilisearch.exe` (optional, see below).
- **Retrieval for big files (optional).** LibreChat's RAG API with local embeddings: a file
  uploaded for File Search is split into chunks and each question pulls in only the matching
  ones, instead of the whole file filling the context. No Docker: one conda environment holds
  Python, PostgreSQL and pgvector (see below).
- **Starter skills.** Four generic skills in `skill/` (morning brief, weekly review, meeting notes,
  document house style), in Claude's `SKILL.md` format. Turn on "Skills" in the tools menu and the
  model sees only their names and one-line descriptions, loading a skill's full instructions when it
  needs one; or type `$` to pick one yourself. Add your own from the Skills panel.
- **Offline artifacts.** HTML, SVG and Markdown previews, Mermaid diagrams and the code view work
  without the internet: BennyChat serves the preview bundler, Tailwind and the code editor itself.
  Set `SANDPACK_STATIC_BUNDLER_URL=http://preview.localhost:3080` in `.env` to switch it on. React
  previews still load their bundler from codesandbox.io.

## Running it (Windows)

What you need: Node 24, MongoDB running locally on `127.0.0.1:27017`, and
[local-llm](https://github.com/aquerman/local-llm) cloned next to this repo.

```bash
npm ci
cp .env.example .env
cp bennychat.yaml librechat.yaml          # BennyChat's config, already wired to local-llm
npm run build
```

Then start everything with `scripts\start-all.bat`. It opens one Windows Terminal window with a tab
for llama-server and a tab for BennyChat, and skips whichever is already running.
`scripts\start-chat.bat` starts only BennyChat.

Open <http://localhost:3080>. After pulling frontend changes, run `npm run build` again and restart.

### Searching past chats (optional)

1. Download Meilisearch v1.35.1 for Windows (release asset `meilisearch-windows-amd64.exe`) into
   `bin\meilisearch.exe`:
   `mkdir bin`, then `gh release download v1.35.1 --repo meilisearch/meilisearch -p meilisearch-windows-amd64.exe -O bin\meilisearch.exe`
2. Make a key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. In `.env` set `SEARCH=true`, `MEILI_HOST=http://127.0.0.1:7700` and `MEILI_MASTER_KEY=<the key>`.
4. Run `scripts\start-all.bat`. It adds a Meilisearch tab (data in `meili_data\`), and BennyChat
   indexes your existing chats on start. Type in the sidebar search box to find them.

Without the exe, or with `SEARCH=false`, the launcher skips Meilisearch and search stays off.

### Retrieval over big files (optional)

What you install: [Miniforge](https://conda-forge.org/download/) (`winget install CondaForge.Miniforge3`)
and git. Everything else lands in `..\rag_api` and `%LOCALAPPDATA%\bennychat\rag`, without admin rights.

1. Pull [local-llm](https://github.com/aquerman/local-llm): it has `scripts\start-embeddings.ps1`,
   which downloads a small embedding model (nomic-embed-text v1.5, ~150 MB) on first start.
2. In `.env`, uncomment the "BennyChat, fully local" block in the RAG section (copy it from
   `.env.example` if your `.env` is older). Make sure `JWT_SECRET` is set.
3. Run `powershell -ExecutionPolicy Bypass -File scripts\setup-rag.ps1` once. It downloads the
   RAG API, creates a conda environment with Python 3.12, PostgreSQL 16 and pgvector, installs the
   Python packages and creates the database. Running it again only redoes missing steps.
4. In `librechat.yaml` (or `bennychat.yaml`), uncomment `legacyFileUploadUX: true` under
   `fileConfig.endpoints.custom`.
5. Run `scripts\start-all.bat`. It adds an "Embeddings" tab and a "RAG API" tab.

In a chat, turn on **File Search** in the tools menu, then attach with **Upload for File Search**.
Use **Upload as Text** for files the model should read in full, and **Upload to Provider** only for
images (llama-server cannot read PDF bytes). Agents with File Search use the same setup for their
knowledge files.

### Phone notifications (optional)

Like Claude's task notifications: title = routine name, body = first line of the result, tap opens
the conversation.

1. Install the **ntfy** app on the phone (App Store / Play Store).
2. Make a hard-to-guess topic name, for example
   `node -e "console.log('bc-' + require('crypto').randomBytes(12).toString('hex'))"`.
   On the public ntfy.sh server anyone who knows the name can read the topic, so treat it like a
   password.
3. In the app, tap **+** and subscribe to that topic (server `ntfy.sh`, or your own ntfy server).
4. In `.env` set `NTFY_TOPIC=<the topic>`. Optional: `NTFY_SERVER=<your ntfy server>`,
   `NTFY_TOKEN=<access token>` for a protected topic, and `BENNYCHAT_PUBLIC_URL=<the address the
   phone uses for BennyChat>` (for example the machine's Tailscale address on port 3080) so a tap
   opens the chat.
5. Restart BennyChat. Run a routine with **Run now** to test.

The `notifications` block in `bennychat.yaml` reads those variables; without `NTFY_TOPIC` nothing is
sent. Set `includeReply: false` there to keep reply text off the ntfy server (the body then just says
the routine finished). An iOS ntfy app gets instant delivery from ntfy.sh; a self-hosted server
needs `upstream-base-url: https://ntfy.sh` for iOS push.

### Wiring up the model

`bennychat.yaml` already contains this. To wire a stock `librechat.yaml` by hand, add local-llm as a custom endpoint and allow the loopback address, which
LibreChat blocks by default:

```yaml
endpoints:
  allowedAddresses:
    - '127.0.0.1:8080'
  custom:
    - name: 'Benner'
      apiKey: 'local'            # llama-server ignores it, but it must not be empty
      baseURL: 'http://127.0.0.1:8080/v1'
      models:
        default: ['local']
      modelDisplayLabel: 'local-llm'
```

Tool calling (web search, agents) needs `llama-server --jinja` and a model whose chat template
supports tools. The validated models are listed in local-llm's `CLAUDE.md`.

## For contributors

`CLAUDE.md` holds the fork's notes (environment, attachments, thinking mode, web search, layout,
branching) followed by upstream LibreChat's coding guidelines, which still apply. Branch from `main`
and open pull requests against `main` on this repo. Tasks are tracked with beads (`bd ready`).

## Credits

BennyChat is built on [LibreChat](https://github.com/LibreChat-AI/LibreChat) by Danny Avila and
contributors, under the MIT [license](LICENSE). See LibreChat's [docs](https://www.librechat.ai/docs)
for everything this fork leaves unchanged.
