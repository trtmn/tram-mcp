# In-session TestRail login tool (stdio) — Design

**Date:** 2026-07-23
**Status:** Approved (pending spec review)

## Problem

Coworkers running `tram-mcp` as a local stdio MCP server must currently authenticate
out-of-band: they run `tram-mcp login` in a separate terminal (or set `TESTRAIL_*` env
vars) before the server is useful. There is no way to start authentication from inside
the MCP client (Claude Code) itself. We want an experience close to the "Authenticate"
flow that remote OAuth MCP servers get on claude.ai — triggered without leaving the
client.

## Constraint that shapes everything

The native `/mcp` "Authenticate" button is a feature of the **HTTP/SSE MCP transport**:
the client discovers the server's OAuth endpoints and opens a browser. `tram-mcp` is a
**local stdio** server (spawned as a subprocess), and stdio servers do **not** participate
in that flow. So we cannot get the literal `/mcp` button. Instead we mimic the flow with a
dedicated MCP **tool** the model calls when it detects missing/invalid credentials.

## Decisions (from brainstorming)

1. **Keep stdio; mimic the flow.** No new hosted HTTP transport.
2. **Dedicated login tool.** A `testrail_login` MCP tool triggers the browser login (not
   auto-launch, not MCP elicitation).
3. **Return the URL immediately (non-blocking).** The tool opens the browser, returns the
   login URL + instructions, and keeps the loopback wizard alive in the background. Because
   credentials are re-resolved per call, the next TestRail tool call works once the user
   submits — avoiding any MCP tool-call timeout while the form is being filled.

## Architecture

`tools.ts` is intentionally transport-agnostic (no Node-only imports such as `http` /
`child_process`). The wizard is Node-specific. We bridge via **capability injection** rather
than importing the wizard into the shared core:

`ToolContext` gains two optional fields:

- `resolveEnv?: () => Env` — dynamic credential resolution.
- `startLogin?: () => Promise<{ url: string }>` — starts the browser login.

The stdio adapter supplies both. `tools.ts` registers `testrail_login` **only when
`startLogin` is present**. This keeps the shared core free of Node-only dependencies and
leaves the door open for a future hosted transport that would use real OAuth instead of this
shim (it simply would not provide `startLogin`).

## Components

### 1. Dynamic credential resolution

Today `buildStdioServer` calls `resolveLocalEnv()` once at startup and captures the result in
`ctx.env`. A login that saves credentials mid-session is therefore invisible to the running
server until it restarts.

Change:

- Add optional `resolveEnv?: () => Env` to `ToolContext`.
- Add a helper `currentEnv(ctx: ToolContext): Env` returning `ctx.resolveEnv?.() ?? ctx.env`.
- Replace every read of `ctx.env` inside `tools.ts` (in `getClient`, and in
  `check_testrail_auth`'s `configView` / `checkConfig` calls) with `currentEnv(ctx)`.
- `buildStdioServer` passes `resolveEnv: () => resolveLocalEnv()`.

Static / env-var callers that pass only `env` are unaffected (the helper falls back to
`ctx.env`). Re-reading the credential store per call is negligible cost for local stdio.

### 2. `testrail_login` MCP tool

Registered only when `ctx.startLogin` is defined. Behavior:

- Calls `ctx.startLogin()`.
- Returns a text (and structured) result containing the login URL, an instruction to finish
  in the browser and then retry the original request, and a note that credentials are saved
  locally to `~/.tram-mcp`.
- Non-blocking; no waiting on form submission.

Tool metadata: title "Log in to TestRail"; description explains it opens a browser form to
enter TestRail URL / username / API key (or password) and that the user should complete it
and then retry. Annotations: `readOnlyHint: false`, `openWorldHint: true` (it opens a
browser / binds a loopback port).

### 3. Non-blocking wizard wrapper — `beginLogin()` in `wizard.ts`

Wraps the existing `startWizardServer()`:

- Closes any prior in-flight login session first (single active login at a time).
- Starts the loopback server (127.0.0.1, OS-assigned port; existing CSRF + Host checks).
- Best-effort opens the platform browser (existing `openBrowser`, never throws).
- Sets a ~5-minute auto-close timeout; closes on successful submit (`done`).
- Returns `{ url }` immediately.

The existing blocking `runWizard()` (used by the `tram-mcp login` CLI) is unchanged.
Module-level state tracks the single active session so a second `beginLogin()` supersedes the
first.

### 4. Instruction & hint updates

- `SERVER_INSTRUCTIONS`: change the missing-credentials guidance from "run `tram-mcp login`"
  to "call the `testrail_login` tool," keeping the CLI / `TESTRAIL_*` env path as a secondary
  mention.
- `check_testrail_auth` missing-config `hint`: same change — recommend calling
  `testrail_login` first, CLI/env vars as fallback.

### 5. Unchanged

`tram-mcp login` / `logout` / `status` CLI, the credential store format and location,
env-var precedence in `resolveLocalEnv`, and the Basic-auth `TestRailClient`.

## Data flow

1. Model calls a TestRail tool → `check_testrail_auth` (or a 401) reveals missing/invalid
   creds.
2. Per updated instructions, model calls `testrail_login`.
3. Tool → `startLogin()` → `beginLogin()` starts loopback wizard, opens browser, returns URL.
4. Tool returns the URL + "finish in browser, then retry."
5. User submits the form; `handleSubmit` validates against TestRail (`get_priorities`) and
   `saveCredentials` writes `~/.tram-mcp/credentials.json` (0600). Wizard server closes.
6. Model retries the original tool → `currentEnv(ctx)` re-runs `resolveLocalEnv()`, which now
   loads the freshly-saved creds → the call succeeds.

## Error handling

- Browser can't open: `openBrowser` is best-effort; the URL is still returned for manual
  paste.
- Login not completed before the ~5-min timeout: the loopback server closes; the stale URL
  then refuses connection. The model can call `testrail_login` again for a fresh session.
- Second `testrail_login` while one is pending: the prior session is closed and replaced
  (fresh CSRF token).
- Invalid credentials at submit: handled by existing `handleSubmit` (re-renders the form with
  an error); no change.

## Testing (vitest)

- `beginLogin`: returns a reachable URL; uses an injectable browser-open (no real browser in
  tests); auto-closes on timeout; a second call closes/replaces the first.
- Dynamic resolution: a `ToolContext` with `resolveEnv` reflecting an updated credential
  store causes `getClient` / auth check to use the new creds on the next call.
- `testrail_login` tool: registered only when `startLogin` is provided; absent otherwise;
  returns the URL in its result.
- Updated `check_testrail_auth` hint text references `testrail_login`.
- Existing tests (static `env` path, stdio, credstore, cli) continue to pass.

## Files touched

- `src/tools.ts` — `ToolContext` (`resolveEnv?`, `startLogin?`); `currentEnv` helper;
  `testrail_login` registration; instruction/hint updates.
- `src/wizard.ts` — `beginLogin()` non-blocking wrapper + single-session state.
- `src/stdio.ts` — `buildStdioServer` wires `resolveEnv` and `startLogin`.
- Tests — `wizard`, `tools`/`stdio`, as above.

No changes to `env.ts`, `credstore.ts`, `testrail.ts`, `cli.ts`, or the catalog.

## Out of scope

- Native `/mcp` OAuth button (requires an HTTP transport).
- A hosted HTTP tram-mcp / real OAuth authorization server.
- A `logout` MCP tool (the `tram-mcp logout` CLI remains the path).
