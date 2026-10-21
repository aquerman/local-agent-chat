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
- **Document side panel.** Clicking a PDF, image, Word (`.docx`) or PowerPoint (`.pptx`) file, attached
  by you or made by the model, opens it in the right-hand panel. Word and PowerPoint files are drawn
  in the browser, offline, with nothing to install; the panel keeps a download button. For files the
  model read as text, a button shows the extracted text.
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
- **Folder access.** The reference filesystem MCP server, scoped to folders you list in `.env`
  (`BENNY_FOLDERS`). The model can list, search and read files there freely; writing, editing,
  creating folders and moving files ask you first. Benny has it built in; plain model chats switch
  it on with "Folders" in the MCP menu of the input bar (see below).
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
- **Offline artifacts.** HTML, SVG, Markdown and React previews, Mermaid diagrams and the code view
  work without the internet: BennyChat serves the preview bundler, Tailwind, the code editor and the
  libraries React artifacts use (React, lucide icons, recharts, three.js, shadcn/ui components) itself.
  Set `SANDPACK_STATIC_BUNDLER_URL=http://preview.localhost:3080` in `.env` to switch it on.
- **Memory.** After each message, the local model notes lasting facts you mention: who you are, your
  preferences, your current projects and any standing instructions. It keeps them in a short memory
  (1.5k tokens) that every new chat sees. You can view, edit or delete entries, or switch memory off,
  under Customize > Memories.
- **Routines.** LibreChat's scheduled chats are switched on: an agent runs a prompt on a schedule
  and files the result as a chat. See [Routines](#routines-scheduled-chats).
- **Voice.** Dictate with the mic button and have replies read aloud, in Dutch or English, through
  two local servers on the CPU (whisper.cpp and Piper), so the GPU stays with the model. Optional:
  see [docs/voice.md](docs/voice.md) for the install; `scripts\start-all.bat` starts them when present.
- **Benny, the default agent.** New chats open on "Benny", an agent on the local model with web
  search and ask-the-user, run through LibreChat's Agents endpoint (deferred tool loading, context
  summarization, step limits sized for a 9B model). The thinking pill works there too. Create it once
  with `npm run seed-benny`; the plain local-llm endpoint stays in the model selector.
- **Approvals and questions.** Like Claude Desktop, read-only tools run on their own and anything
  that writes, sends or deletes asks first: Approve (once), "Always allow in this chat", Reject or
  Edit. The model can also stop and ask you a multiple-choice question.
- **Word, PDF and PowerPoint files.** Another built-in MCP server (`packages/documents`) lets the
  model create `.docx`, `.pdf` and `.pptx` files from Markdown or a slide outline, in one clean
  house style, and add to them section by section for long documents. The file arrives in the chat
  as an attachment to download; click it to preview Word and PowerPoint files in the side panel. PDFs are
  printed with the Microsoft Edge that Windows already has; nothing extra to install. Markdown
  (`.md`) files work too.
- **Project instructions and knowledge.** Like Claude Projects: open a project (Projects in the
  sidebar), set instructions ("always answer in British English", "I'm planning a house move") and
  add files. Every chat in the project follows the instructions and can read the files. Small
  knowledge is read in full (up to `projects.knowledgeInlineTokens`, 6000 tokens by default); past
  that, chats get as much as fits and are told which files were left out.
- **Deep research.** Pick "Researcher" in the model selector, like Claude's Research mode: it shows
  a plan of 3-6 sub-questions, searches and reads 1-3 web pages for each, writes a short cited note
  per sub-question in the chat, then writes the report section by section into a PDF (or Word or
  Markdown, if you ask) with numbered citations and a source list. Benny can do a short version
  with the `deep-research` skill. Created together with Benny by `npm run seed-benny`.
- **Project coordinator and threads.** The first chat in a project is its coordinator. Ask it for
  something that takes research or several steps and it starts a background *thread*: a separate
  chat in the project that works on the task after the reply, one at a time behind your live chat.
  Threads show a status (Working, Needs you, Done, Failed) in the project page and the chat list;
  when one finishes, it hands the coordinator a short summary, so you can just ask "what did it
  find?". Open a thread to read it in full or to approve something it is waiting on.

## Running it (Windows)

What you need: Node 24, MongoDB running locally on `127.0.0.1:27017`, and
[local-llm](https://github.com/aquerman/local-llm) cloned next to this repo.

```bash
npm ci
cp .env.example .env
cp bennychat.yaml librechat.yaml          # BennyChat's config, already wired to local-llm
npm run build
```

Start BennyChat once, register your account, then run `npm run seed-benny` (safe to repeat) to
create the default Benny agent and the Researcher agent. After pulling a change to either, run
`npm run seed-benny -- --reset` (or `--reset=researcher` to keep your own edits to Benny).

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

### Folder access (optional)

1. In `.env`, list the folders the model may use, separated by `;`, for example
   `BENNY_FOLDERS=%USERPROFILE%\Documents\Assistant;%USERPROFILE%\Documents\Notes`.
   Without it, BennyChat uses `Documents\Assistant` in your user folder and creates it.
2. Restart BennyChat. Benny, the default assistant, has the folder tools already (if Benny was
   created before this feature, run `npm run seed-benny -- --reset` once). In a plain model chat,
   open the MCP menu in the input bar and tick **Folders**.
3. Ask, for example, "What files are in my Assistant folder?" or "Summarise notes.md". Files
   outside the listed folders are refused. When the model wants to write, edit, create a folder or
   move a file, the chat shows an Approve / Reject prompt first.

The server ships with BennyChat (`npm ci` installs it), so nothing is downloaded when it starts.
Small models do best with targeted requests: name the file, or ask for the first or last lines
of a long one.

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

## Routines (scheduled chats)

BennyChat switches on LibreChat's scheduled chats: an agent runs a short prompt on a schedule
(daily, weekdays, weekly, hourly or a cron expression) and each run lands as a new chat you can open
later. Find them under **Customize → Scheduled chats**; each card has an on/off switch and a "…"
menu with **Run now**.

1. Add `SCHEDULES_SINGLE_PROCESS=true` to `.env` (BennyChat runs as one process without Redis) and
   restart. Without it schedules cannot be created.
2. Create an agent on the `local-llm` model in Agent Builder (or use the default Benny agent). For
   routines, set its reasoning effort to Off or leave it unset (runs as Low), and keep the prompt short.
3. Scheduled chats → New schedule: pick the agent, the prompt and the time. Runs must be at least
   60 minutes apart, scheduled runs go one at a time, and five failures in a row pause a schedule.

Routines share the GPU with your chats: while one runs, a chat waits for it (and the other way
round) unless local-llm starts llama-server with a second slot (`--parallel 2`).

### Morning brief

A ready-made routine: every morning a chat with today's events, the Todoist tasks due today or
overdue, three headlines and your top three priorities, in under 250 words.

1. Connect what you want in it (MCP panel, see `docs/connectors.md`): **Calendar** (paste your
   calendar's secret iCal address) and **Todoist** (Connect, approve in the browser). Both are
   optional; headlines need nothing.
2. With BennyChat stopped or running, from the repo folder:

   ```powershell
   npm run seed-benny -- --brief --schedule --time 07:00 --tz Europe/Amsterdam
   ```

   `--time` defaults to 07:00 and `--tz` to the PC's own time zone, so `--brief --schedule` is
   enough for most people. It creates the **Morning brief** agent and one daily scheduled chat, and
   prints which sources it found. Add your email as the first argument if more than one account
   exists.
3. Customize → Scheduled chats → Morning brief → "…" → **Run now** to try it.

A source you have not connected is left out of the brief and named on its last line ("Not
connected: Calendar, Todoist") instead of stopping it. After connecting one later, run the same command again: it adds that source
to the agent and leaves the schedule as it is (or moves it, if you pass a new time). If Todoist's
sign-in expires, the schedule pauses itself and its card says which connector needs reconnecting;
reconnect it in the MCP panel and switch the schedule back on.

### Keeping the PC awake for routines

A routine only runs if the PC is awake and BennyChat and llama-server are running at that time. A
run that is more than 15 minutes late (the PC was asleep) is skipped, not caught up. Pick one:

- **Awake hours (simplest).** Don't let the PC sleep while routines are due: Settings → System →
  Power → "Make my device sleep after" → Never (when plugged in), or keep it awake only for a time
  window with PowerToys Awake.
- **Wake timer.** Let Windows sleep and wake it a few minutes before the routine:
  1. Allow wake timers: Control Panel → Power Options → Change plan settings → Change advanced power
     settings → Sleep → Allow wake timers → Enable.
  2. Task Scheduler → Create Task: trigger daily, about 5 minutes before the routine; action
     `cmd.exe /c exit`; Conditions tab → tick **Wake the computer to run this task**.
  3. Check it with `powercfg /waketimers` (lists the pending timer) and, the next morning,
     `powercfg /lastwake`.

  A timer-woken PC with no keyboard or mouse input falls back to sleep after a few minutes (Windows'
  "System unattended sleep timeout", hidden in Power Options by default), which may cut a slow run
  short. If that happens, use awake hours instead. Wake timers do not start a PC that is shut down,
  and on laptops with Modern Standby they may be ignored on battery.

## For contributors

`CLAUDE.md` holds the fork's notes (environment, attachments, thinking mode, web search, layout,
branching) followed by upstream LibreChat's coding guidelines, which still apply. Branch from `main`
and open pull requests against `main` on this repo. Tasks are tracked with beads (`bd ready`).

## Credits

BennyChat is built on [LibreChat](https://github.com/LibreChat-AI/LibreChat) by Danny Avila and
contributors, under the MIT [license](LICENSE). See LibreChat's [docs](https://www.librechat.ai/docs)
for everything this fork leaves unchanged.
