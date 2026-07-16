# Local TestRail MCP with a Browser Credential Wizard — Design

**Date:** 2026-07-15
**Status:** Approved (brainstorming complete)
**Branch:** `feat/local-stdio-adapter`

## Goal

Give coworkers a **robust, functional** TestRail MCP server they can run **from
their own machines** with **minimal setup**, where credentials are entered via a
**browser login form** rather than by hand-editing client config.

## Confirmed requirements

- **Clients:** Claude Code (CLI) and Claude Desktop. *Not* Claude.ai web.
- **Deployment:** each coworker runs it locally on their own machine (per-machine
  process, per-person TestRail credentials). No shared hosted infrastructure.
- **Credential entry:** a browser form (validate-before-connect, no plaintext in
  client config).
- **Ship alongside** the existing Python `tram-mcp` — do not remove Python yet.

## Chosen approach

**stdio transport + a one-time browser credential wizard.** (Approaches
considered and rejected are recorded at the end.)

The MCP server runs over **stdio** — the client (Claude Code / Desktop) spawns
the process, so there is no persistent daemon, no listening port, and the client
owns the lifecycle. Credentials are captured once by `tram-mcp login`, which
opens a transient loopback web server, serves the TestRail credential form,
validates the entry against TestRail, and stores it locally. The stdio server
then reads those stored credentials on every launch.

### Why not full OAuth-over-localhost (Approach 1)

OAuth over `http://localhost` genuinely works for Claude Code/Desktop (loopback
is a secure context), but it requires implementing a local OAuth 2.1
authorization server (DCR + PKCE + token) and running a persistent local HTTP
daemon (port conflicts, lifecycle, "is it running?"). It delivers the same
*user-visible* outcome — a browser form for credentials — at much higher
engineering cost and more failure modes. Rejected in favor of the wizard.

### Why HTTPS is not needed

The only client that would require public HTTPS is Claude.ai web, which is out of
scope. stdio needs no network transport at all; the wizard's form is served on
`127.0.0.1` for the duration of setup only.

## Architecture

One shared TypeScript core with thin transport adapters. This adds a **local
CLI + wizard** path beside the existing Cloudflare Worker adapter; the core is
untouched.

```
cloudflare/src/
  tools.ts        (reused) MCP tool registration — transport-agnostic
  testrail.ts     (reused) TestRail HTTP client (fetch/btoa/basic-auth)
  env.ts          (reused) credential resolution: props | env
  catalog.ts      (reused) endpoint catalog dispatch
  catalog.json    (reused) generated TestRail endpoint catalog
  version.ts      (reused)
  index.ts        (reused) Cloudflare Worker adapter (OAuth) — unchanged
  authorize.ts    (reused) Worker OAuth form — source of the ported form HTML

  credstore.ts    (NEW)     local credential persistence
  wizard.ts       (NEW)     transient browser credential form
  cli.ts          (NEW)     bin entry: default server + login/logout/status
  stdio.ts        (CHANGED) credential resolution: env → credstore → none
```

> **Note on location:** the TypeScript project currently lives in `cloudflare/`.
> This task keeps it there for a minimal diff even though it now also hosts a
> non-Cloudflare local server. Renaming `cloudflare/` → `typescript/` (or
> promoting to repo root) is a deliberate follow-up, out of scope here.

## Components

### `credstore.ts` (new)

Local credential persistence. Single-user, single-machine trust model.

- `credentialsPath(): string` → `~/.tram-mcp/credentials.json`.
- `loadCredentials(): StoredCreds | null` — returns `null` if the file is absent
  or unparsable/invalid (never throws on a corrupt file; log a warning to stderr).
- `saveCredentials(creds: StoredCreds): void` — creates the directory `0700` and
  writes the file `0600`.
- `clearCredentials(): void` — removes the file (idempotent).

```ts
interface StoredCreds {
  url: string;
  username: string;
  auth_method: "api_key" | "password";
  secret: string;
}
```

### `wizard.ts` (new)

The one-time browser credential form. Transient — exists only during setup.

- Starts `http.createServer` bound to `127.0.0.1:0` (OS-assigned free port).
- `GET /` → the ported `formPage()` HTML (from `authorize.ts`, with the OAuth
  `oauth_req` hidden field and OAuth-specific copy removed; `action="/submit"`).
- `POST /submit` → parse the form, build `ConnectionProps`, validate with
  `new TestRailClient(getCredentials(env, props)).get("get_priorities")`.
  - **Success:** `saveCredentials()`, serve a "Connected — you can close this
    tab" page, resolve the wizard promise, close the server.
  - **Failure:** re-render the form with the same 401 / 403 / network error
    mapping used in `authorize.ts` (HTTP status 401/403/other).
- Opens the browser via a small cross-platform `openBrowser(url)` helper
  (`open` on macOS, `start` on Windows, `xdg-open` on Linux). If launching the
  browser fails, print the URL to stdout so the user can open it manually.
- **Timeout** (5 minutes) with no successful submit → reject and exit non-zero.
- SIGINT-safe: always close the server on exit.
- Exports `runWizard(): Promise<void>` plus pure helpers (form render, submit
  handler) for unit testing.

### `stdio.ts` (changed)

Credential resolution precedence (first complete source wins):

1. **`process.env.TESTRAIL_*`** if complete — preserves the existing `.env` /
   `op run` / CI workflows and lets power users bypass the wizard.
2. **`credstore.loadCredentials()`** — the wizard-populated file.
3. **None** — the server still starts and completes the MCP handshake; tools
   return the `checkConfig` guidance message, updated to say
   *"No TestRail credentials found — run `tram-mcp login`."*

`envFromProcess()` is generalized to `resolveLocalEnv()` which merges the winning
source into the `Env` shape the tools read.

### `cli.ts` (new — the `bin`)

```
tram-mcp            # default: run the stdio MCP server (what the client spawns)
tram-mcp login      # run the browser credential wizard
tram-mcp logout     # clearCredentials()
tram-mcp status     # print non-secret configView (url / username / auth_method / source)
```

`package.json`: `bin: { "tram-mcp": "dist/cli.js" }`; add an esbuild bundle step
for `cli.ts` mirroring the existing `build:stdio` script.

## Credential flow (coworker experience)

**Claude Code**
```bash
npx tram-mcp login                      # browser form → URL / username / API key → "Connected"
claude mcp add tram-mcp -- npx -y tram-mcp
```

**Claude Desktop**
1. Install the `.mcpb` bundle (double-click).
2. Run `npx tram-mcp login` once (explicit setup step — chosen over server
   auto-open for determinism and to avoid client startup-timeout risk).
3. Use it.

No instance URL, no OAuth, no HTTPS, no editing a JSON config with secrets in it.

## Distribution

- **npm package `tram-mcp`** (npm registry, independent of the PyPI package of
  the same name). Run via `npx tram-mcp` or `npm i -g tram-mcp`. Requires Node ≥ 22.
- **Claude Desktop `.mcpb`** bundle: built JS + a `node`-runtime manifest
  (Claude Desktop provides the Node runtime, so coworkers need nothing
  pre-installed). This is a TypeScript sibling to the current Python `.mcpb`.
- Deferred: a standalone compiled binary for machines without Node.

## Security

- `~/.tram-mcp/credentials.json` is mode `0600`, directory `0700` — the same
  trust model as `.env`, `gh`, and `aws` on a single-user machine. The secret is
  stored in plaintext in that protected file.
- The wizard binds only to `127.0.0.1` on an ephemeral port, serves the form for
  the duration of setup, accepts one successful submission, then shuts down.
- **CSRF / DNS-rebinding defense:** each session embeds an unguessable token
  (`randomBytes(32)`) in the form that `/submit` requires (a cross-origin page
  cannot read it), and the request handler rejects any request whose `Host`
  header is not the server's own `127.0.0.1:<port>` / `localhost:<port>`.
- No secret is ever placed on argv, stdout, or in logs.
- **Deferred enhancement:** OS keychain storage (macOS `security`, Windows
  Credential Manager) by shelling out — explicitly avoiding native modules
  (e.g. `keytar`) to keep installation clean.

## Error handling

- **Wizard validation:** TestRail errors mapped exactly as in `authorize.ts` —
  401 → "TestRail rejected those credentials", 403 → "API access denied / account
  locked", other/network → "Couldn't reach TestRail — check the URL". Re-render
  the form with the message; never crash.
- **Browser launch failure:** print the loopback URL to stdout as a fallback.
- **Unconfigured server:** tools return the actionable "run `tram-mcp login`"
  message; the server does not crash or hang.
- **Corrupt credentials file:** treated as "no credentials" (warn to stderr).

## Testing

- `credstore`: temp `HOME`, file/dir permission bits, save→load round-trip,
  corrupt-file handling, `clear` idempotency.
- `wizard`: form renders; POST success path saves creds (TestRail `fetch`
  stubbed, per the existing suite); POST failure mapping for 401/403/network;
  timeout path.
- `stdio`: resolution precedence (complete env → env; no env + file → file;
  neither → guidance).
- `cli`: subcommand dispatch.
- All existing tests (68) remain green.

## Out of scope (deliberate deferrals)

- Removing the Python `tram-mcp` package or adding a PyPI deprecation notice.
- Full local OAuth 2.1 server (Approach 1).
- Renaming `cloudflare/` → `typescript/` or promoting it to the repo root.
- Standalone compiled binary.
- OS keychain credential storage.

## Approaches considered

1. **Local OAuth HTTP server (Node-native).** Literal "OAuth from a local
   server"; client's Authenticate button opens the form. Rejected: requires a
   local OAuth 2.1 AS and a persistent daemon; same UX at much higher cost/risk.
2. **stdio + browser wizard.** *Chosen.* Same UX, far less code, fewest failure
   modes, reuses the existing stdio adapter.
3. **Shared remote Cloudflare Worker (already built).** Zero coworker install,
   real OAuth form, works in every client. Rejected: conflicts with the
   confirmed per-machine-local requirement (kept as a fallback if that changes).
