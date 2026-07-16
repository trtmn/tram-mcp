# TestRail MCP on Cloudflare Workers

A TypeScript port of `tram-mcp` that runs as a remote MCP server on Cloudflare
Workers (Durable Objects via the `agents` SDK). It speaks streamable HTTP at
`/mcp` (recommended) and legacy SSE at `/sse`, and authenticates clients with
**OAuth 2.1** — the model Claude.ai requires for custom connectors, and which
Claude Code supports too.

Instead of importing `testrail_api_module`, the Worker dispatches from a static
catalog (`src/catalog.json`) generated from that module's source — same
categories, methods, parameters, and docs as the Python server.

The same shared core also runs **locally over stdio** for Claude Code and Claude
Desktop — no Cloudflare account, no HTTPS, no OAuth (see below).

## Run locally (stdio + browser login)

Run the server on your own machine and enter your TestRail credentials through a
browser form — nothing sensitive goes into your client config.

### 1. Save your TestRail credentials (once)

```bash
npx tram-mcp login
```

A browser tab opens. Enter your TestRail URL, username, and an **API key**
(My Settings → API Keys in TestRail). The details are validated against TestRail
and saved to `~/.tram-mcp/credentials.json`, readable only by you. Re-run any
time to update them; `npx tram-mcp logout` removes them.

### 2. Connect your client

**Claude Code**

```bash
claude mcp add tram-mcp -- npx -y tram-mcp
```

**Claude Desktop** — install the `.mcpb` bundle from the latest release, then run
`npx tram-mcp login` once (step 1 above).

### 3. Verify

```bash
npx tram-mcp status
```

Prints the active URL / username / auth method — never the secret. Power users
can skip the wizard by setting `TESTRAIL_URL`, `TESTRAIL_USERNAME`, and
`TESTRAIL_API_KEY` (or `TESTRAIL_PASSWORD`) in the environment; those take
precedence over the saved file.

Requires Node ≥ 22 for the `npx` path. (Claude Desktop's `.mcpb` bundles its own
Node runtime.)

## Tools (9)

Ported from the Python server:

| Tool | Purpose |
| --- | --- |
| `check_testrail_auth` | Verify credentials with a structured diagnosis |
| `browse_testrail_api` | List all API categories and methods |
| `describe_testrail_method` | Parameter/endpoint details for one method |
| `run_testrail_command` | Execute any catalog method (122 methods, 24 categories) |
| `search_test_cases` | Title-substring case search |

Added in this deployment:

| Tool | Purpose |
| --- | --- |
| `list_testrail_projects` | Resolve project names to IDs |
| `get_run_summary` | Run status counts, pass rate, and failed-test list |
| `add_result_for_case` | Record pass/fail/blocked/retest with comment & defects |
| `create_test_run` | Start a run for all or selected cases |

## Authentication (OAuth 2.1)

The Worker is wrapped in `@cloudflare/workers-oauth-provider`, so clients
authenticate with the standard OAuth flow (dynamic client registration →
authorize → token). There are **no API keys or bearer tokens to put in client
config**, and the endpoint is not open: every `/mcp` and `/sse` request requires
a valid access token.

The OAuth "login" page at `/authorize` is simply a **TestRail credential form**
— the user enters their TestRail URL, username, and an API key (recommended) or
password. The Worker validates those against TestRail before issuing the grant,
and uses them for TestRail Basic auth on every subsequent request. There is no
separate "OAuth account"; the TestRail login *is* the login.

**Where credentials live:** the OAuth provider stores them in the `OAUTH_KV`
namespace **encrypted with the access token as the key** — Cloudflare holds no
decryption key and cannot read them; only the client's token can. **No Worker
secrets are required**, and no TestRail credentials are stored in plaintext or
in the Worker config. (Like any hosted proxy, the Worker handles plaintext
credentials in memory while servicing a request — that is inherent and
unavoidable — but nothing readable is persisted.)

## Run locally

`wrangler dev` runs the whole stack — Worker, Durable Object, and KV — in
Cloudflare's local runtime (Miniflare). **No Cloudflare account, login, or real
KV namespace is needed for local development**; storage is simulated on disk.

```bash
npm install
npm run check      # tsc --noEmit
npm test           # vitest (71 tests)
npm run dev        # wrangler dev → http://localhost:8787
```

The full OAuth flow works against `http://localhost:8787`. A local instance is
reachable by clients that can hit `localhost` (Claude Code, the MCP Inspector,
scripts) — but **not** by Claude.ai, which is a cloud service.

Regenerate the endpoint catalog after `testrail_api_module` changes:

```bash
npm run catalog    # python3 scripts/generate_catalog.py [path-to-module-src]
```

## Run locally over stdio (no Cloudflare)

The same shared core (tools, dispatch, catalog) also runs as a local **stdio**
MCP server — the transport an MCP client spawns as a child process and talks to
over stdin/stdout. This is the drop-in for a local/desktop setup.

```bash
npm install
npm run build:stdio    # esbuild → dist/stdio.js (the `tram-mcp` bin)
```

**Authentication is by environment variables, not OAuth.** OAuth 2.1 is the
*remote* model — it needs HTTP endpoints and a browser redirect, which a stdio
process doesn't have. A local stdio server authenticates the standard way: the
client passes `TESTRAIL_*` env vars when it launches the process. Both paths
resolve through the same `getCredentials()` in `src/env.ts` — OAuth fills the
grant `props` on the Worker; stdio leaves `props` undefined and falls back to
the environment.

Example Claude Desktop / Claude Code config:

```json
{
  "mcpServers": {
    "testrail": {
      "command": "node",
      "args": ["/abs/path/to/dist/stdio.js"],
      "env": {
        "TESTRAIL_URL": "https://yourinstance.testrail.io",
        "TESTRAIL_USERNAME": "you@corp.com",
        "TESTRAIL_API_KEY": "your-api-key"
      }
    }
  }
}
```

Either `TESTRAIL_API_KEY` (recommended) or `TESTRAIL_PASSWORD` must be set. If
you want the OAuth flow on your own machine instead, use the HTTP transport via
`npm run dev` (above) rather than the stdio bin.

## Deploy / self-host

A **free Cloudflare account is sufficient** (SQLite-backed Durable Objects are
on the free tier) and **no secrets are required**.

```bash
npm install
wrangler kv namespace create OAUTH_KV   # then put the new id in wrangler.jsonc
npx wrangler login                      # once
npm run deploy
```

`wrangler.jsonc` references an `OAUTH_KV` namespace id — **replace it with the
one you create above** (the shipped id belongs to another account and won't
resolve in yours). `OAUTH_KV` stores OAuth grants/tokens, with grant props
encrypted as described under Authentication.

Or via CI: the `deploy-cloudflare` GitHub Actions workflow
(`.github/workflows/deploy-cloudflare.yml`) deploys on manual dispatch using a
`CLOUDFLARE_API_TOKEN` repo secret (Workers Scripts:Edit permission).

## Connect a client

Both clients drive the same OAuth flow — you authenticate by filling the
TestRail form in your browser. Prefer a TestRail **API key** (revocable) over
your password.

**Claude.ai:** Settings → Connectors → **Add custom connector** → URL
`https://tram-mcp.<your-subdomain>.workers.dev/mcp`. Claude.ai registers
automatically and opens the credential form.

**Claude Code:**

```bash
claude mcp add --transport http testrail https://tram-mcp.<your-subdomain>.workers.dev/mcp
# then in the REPL, authenticate:
/mcp        # select the server → Authenticate (opens the browser form)
```

No headers or tokens go in the client config — authentication is handled by the
OAuth flow.

## Notes

- File-upload endpoints (multipart attachments) are not supported; the catalog
  marks them and `run_testrail_command` returns an actionable error.
- Composite helper methods from the Python module that make multiple API calls
  (e.g. `cases.get_required_case_fields`) are marked unsupported — call the
  underlying endpoints individually.
