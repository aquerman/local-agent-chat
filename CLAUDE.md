# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# This fork: local-agent-chat

`aquerman/local-agent-chat` is a personal fork of LibreChat (`upstream` = `LibreChat-AI/LibreChat`,
`origin` = `aquerman/local-agent-chat`). It is the chat front end for the sister repo `../local-llm`
(`aquerman/local-llm`), which builds a self-hosted LLM server (llama.cpp `llama-server`, RTX 3060
12 GB) exposing an OpenAI-compatible API. This repo consumes that server; it does not run models.
Read `../local-llm/CLAUDE.md` for the server side: engine, validated models, how to start it.

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
  `AppData`, and junctions there cannot be traversed by cmd/PowerShell on this machine (Bitdefender),
  so they silently fail to switch. Do not reintroduce one without testing that first.
- Package manager is **npm** (`package-lock.json`, `"packageManager": "npm@11"`), not pnpm: the
  upstream scripts and Turborepo config assume npm workspaces, and pnpm's symlinked store under
  `AppData\Local\pnpm` would hit the same junction problem.
- `.env` and `librechat.yaml` are git-ignored, created from `.env.example` and
  `librechat.example.yaml`; `node_modules` comes from `npm ci` at the root. `librechat.yaml` wires
  local-llm as the custom endpoint `local-llm` (model alias `local`, from `--alias local` in
  `../local-llm/scripts/start-server.ps1`).
- `gh` default repo is set to `aquerman/local-agent-chat`. Still pass `--repo aquerman/local-agent-chat`
  to `gh pr create`; never open a pull request against `LibreChat-AI/LibreChat` unless asked.

## Starting a session

- MongoDB is a Windows service, so only two processes need starting: llama-server (local-llm) and
  the LibreChat backend (this repo). `scripts\start-all.bat` starts both in one Windows Terminal
  window, one tab each, and skips a tab whose port (8080 or 3080) already has a listener. The
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
