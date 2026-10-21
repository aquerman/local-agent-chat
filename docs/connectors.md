# Connectors: Todoist, calendar, email

Roadmap item 4. BennyChat reaches your tasks, calendar and mailbox through MCP servers declared in
`bennychat.yaml` (`mcpServers.todoist`, `.calendar`, `.email`). They follow Claude Desktop's
connector model:

- **Off until you connect.** None of them starts with the backend (`startup: false`). Each user
  connects their own account from the MCP panel, and the credentials are stored per user,
  encrypted, in MongoDB. Nothing goes in `.env` or git.
- **Picked per chat or per agent.** On the plain `Benner` model, turn a connector on in the MCP
  selector under the message box. The default Benny agent lists its own servers, so add the
  connectors you want to Benny in the agent builder (Agents → Benny → Add MCP server tools). Add only the
  connectors you need: every tool's description costs prompt tokens on each turn, and Todoist
  alone has about 45 tools.
- **Reads run, writes ask.** Calendar and email are read-only by construction: their servers have
  no tool that writes or sends. Todoist can write; its write tools wait for your approval through
  `endpoints.agents.toolApproval` (roadmap 13, see "Approvals" below).

The model stays on your PC, but whatever a tool returns (task names, events, email text) has come
from that service's servers, and Todoist sees what the model asks it to do.

## Todoist (official remote server, OAuth)

- Server: Todoist's own MCP server at `https://ai.todoist.net/mcp` (streamable HTTP, OAuth, scope
  `data:read_write`). Source: <https://github.com/Doist/todoist-ai>.
- Connect: MCP panel → Todoist → Connect. A Todoist page opens in the browser; approve access.
  LibreChat registers itself with Todoist the first time (dynamic client registration) and Todoist
  sends you back to `<DOMAIN_SERVER>/api/mcp/todoist/oauth/callback`, so `DOMAIN_SERVER` in `.env`
  must be the address you open BennyChat on (`http://localhost:3080`).
- Disconnect: MCP panel → Todoist → Revoke.
- If Todoist shows `invalid_client`, revoke in the MCP panel and connect again; LibreChat then
  registers a fresh client.
- Read tools that run without asking: `find-*`, `get-*`, `fetch`, `fetch-object`, `search`,
  `list-workspaces`, `view-attachment`, `user-info`. Every other Todoist tool (`add-*`,
  `update-*`, `complete-tasks`, `reschedule-tasks`, `delete-object`, ...) asks first.

## Calendar (read-only ICS, `packages/calendar`)

A small stdio MCP server in this repo. It reads one or more iCalendar feeds (the "secret iCal
address" Google and Outlook both publish) and offers two tools:

- `list_events(start?, days?, maxResults?)`: events from today (or `start`) for `days` days
  (default 7), recurring events expanded, exceptions and cancellations applied, times shown in
  your time zone.
- `search_events(query, start?, days?)`: events whose title, location or notes contain all the
  words, from 30 days back to a year ahead by default.

Connect: MCP panel → Calendar → paste the address into "Calendar address (ICS)" → Save.

- Google Calendar: calendar.google.com → Settings → your calendar → "Integrate calendar" →
  "Secret address in iCal format".
- Outlook / Microsoft 365: Outlook on the web → Settings → Calendar → Shared calendars →
  "Publish a calendar" → choose the calendar and "Can view all details" → Publish → copy the ICS
  link. (A work account may have publishing switched off by its admin.)
- Several calendars: separate the addresses with `|`. A local `.ics` file path also works.

Settings in `bennychat.yaml` (`env`): `CALENDAR_TIMEZONE` (empty = Windows' zone),
`CALENDAR_CACHE_SECONDS` (default 300: a feed is downloaded at most every 5 minutes),
`CALENDAR_TIMEOUT_MS`, `CALENDAR_MAX_BYTES` (default 10 MB).

Why ICS and not the Google or Microsoft APIs: it needs no OAuth client of your own, no cloud
console project and no token refresh, runs fully locally, and is read-only by nature. The costs:
Google refreshes the secret feed only every few hours, so a just-added event may be missing;
free/busy-only feeds show no titles; and the address itself is the secret (anyone with it can
read the calendar, so reset it in Google/Outlook if it leaks). The server never logs the
address, only its host.

Adding Google or Outlook with write access later: run an established Google Calendar or
Microsoft Graph MCP server as another `mcpServers` entry (stdio via `npx`, or remote with
`requiresOAuth`), with your own OAuth client ID/secret kept in `.env` and referenced as
`${VAR}`. Its write tools (`create_event`, `update_event`, ...) are then gated by the same
approval policy. Keep the ICS connector or remove it; both can be on.

## Email (read-only IMAP, `packages/email`)

A small stdio MCP server in this repo over IMAP (`imapflow` + `mailparser`). Tools:

- `search_emails(query?, from?, subject?, since?, before?, unreadOnly?, folder?, maxResults?)`:
  newest matches first, envelope only (id, date, sender, subject).
- `read_email(id, folder?, maxChars?)`: headers, attachment names and the text body, cut at
  `EMAIL_MAX_CHARS` (default 4000).
- `list_folders()`.

Folders are opened read-only (IMAP `EXAMINE`), so reading never marks a message as read, and
there is no send, move, flag or delete tool. Sending mail is out of scope until it can go
through approval with a draft the user reviews.

Connect: MCP panel → Email → fill in "IMAP server", "User name", "App password" → Save.

- Gmail: turn on 2-Step Verification, then create an app password at
  myaccount.google.com/apppasswords; server `imap.gmail.com`, user = your address. Search folder
  `[Gmail]/All Mail` to include archived mail (`list_folders` shows the names).
- Fastmail, iCloud (`imap.mail.me.com`), most providers: an app password from their security
  settings, port 993.
- Outlook.com / Microsoft 365: Microsoft has switched off password (basic) IMAP login, so this
  server cannot log in there. Use a Microsoft Graph MCP server with OAuth instead (as for the
  calendar above).
- Other ports: `EMAIL_IMAP_PORT` and `EMAIL_IMAP_SECURE: 'false'` (STARTTLS/plain) in the
  `env` block.

## Approvals

Tool approval is configured once for all chats in `endpoints.agents.toolApproval` (roadmap 13,
see CLAUDE.md "Agents, Benny and approvals"). MCP tools are named `<tool>_mcp_<server>`, e.g.
`add-tasks_mcp_todoist`. The policy runs in `mode: default`: a tool matching an `allow` pattern
runs, anything else asks. The connectors rely on that:

- Calendar and email tool names start with `list`, `search` or `read`, which the read-verb
  `allow` patterns cover.
- Todoist's read tools match `find*`, `get*`, `fetch*`, `search*`, `list*`, `view*`, plus an
  explicit `user-info_mcp_todoist`. Its writes match none of them, so they ask (checked against the
  agents SDK's policy hook: 22 read tools allowed, 25 write or refresh tools ask, including
  `analyze-project-health` and the template import/export).
- "Always allow in this chat" on an approval remembers that one tool for the conversation.

## Checking a connector by hand

```bash
npm run build                                   # builds packages/calendar and packages/email too
npx @modelcontextprotocol/inspector node packages/calendar/dist/index.cjs
# set CALENDAR_ICS_URL in the inspector's environment panel, then call list_events
cd packages/calendar && npx jest                # fixture-based tests
cd packages/email && npx jest                   # IMAP tests run only with EMAIL_TEST_IMAP_PORT set
```
