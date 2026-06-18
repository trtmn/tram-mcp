# TestRail MCP on Cloudflare Workers

A TypeScript port of `tram-mcp` that runs as a remote MCP server on Cloudflare
Workers (Durable Objects via the `agents` SDK). It speaks streamable HTTP at
`/mcp` (recommended) and legacy SSE at `/sse`, and authenticates clients with
**OAuth 2.1** — the model Claude.ai requires for custom connectors, and which
Claude Code supports too.

Instead of importing `testrail_api_module`, the Worker dispatches from a static
catalog (`src/catalog.json`) generated from that module's source — same
categories, methods, parameters, and docs as the Python server.

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
npm test           # vitest (68 tests)
npm run dev        # wrangler dev → http://localhost:8787
```

The full OAuth flow works against `http://localhost:8787`. A local instance is
reachable by clients that can hit `localhost` (Claude Code, the MCP Inspector,
scripts) — but **not** by Claude.ai, which is a cloud service.

Regenerate the endpoint catalog after `testrail_api_module` changes:

```bash
npm run catalog    # python3 scripts/generate_catalog.py [path-to-module-src]
```

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
