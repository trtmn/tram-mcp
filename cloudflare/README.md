# TestRail MCP on Cloudflare Workers

A TypeScript port of `tram-mcp` that runs as a remote MCP server on Cloudflare
Workers (Durable Objects via the `agents` SDK). It speaks streamable HTTP at
`/mcp` (recommended) and legacy SSE at `/sse`.

Instead of importing `testrail_api_module`, the Worker dispatches from a static
catalog (`src/catalog.json`) generated from that module's source — same
categories, methods, parameters, and docs as the Python server.

## Tools

Ported from the Python server:

| Tool | Purpose |
| --- | --- |
| `check_testrail_auth` | Verify credentials with a structured diagnosis |
| `browse_testrail_api` | List all API categories and methods |
| `describe_testrail_method` | Parameter/endpoint details for one method |
| `run_testrail_command` | Execute any catalog method (110 methods, 24 categories) |
| `search_test_cases` | Title-substring case search |

New in this deployment:

| Tool | Purpose |
| --- | --- |
| `setup_testrail_connection` | Configure instance URL, username, and auth method (API key **or** password — enum dropdown) for the current session |
| `list_testrail_projects` | Resolve project names to IDs |
| `get_run_summary` | Run status counts, pass rate, and failed-test list |
| `add_result_for_case` | Record pass/fail/blocked/retest with comment & defects |
| `create_test_run` | Start a run for all or selected cases |

## Configuration

TestRail credentials resolve in priority order:

1. **`setup_testrail_connection` tool** — the user supplies instance URL,
   username, auth method (`api_key`/`password`), and secret in-conversation;
   saved in the session's Durable Object state.
2. **Per-client HTTP headers** — set in the MCP client config:
   `X-TestRail-URL`, `X-TestRail-Username`, and `X-TestRail-API-Key` or
   `X-TestRail-Password`.
3. **Worker secrets** — shared server-wide defaults.

A client that supplies its own username must also supply its own secret —
header/tool identities are never paired with the Worker-level key.

### Worker secrets

```bash
wrangler secret put TESTRAIL_URL        # https://yourinstance.testrail.io
wrangler secret put TESTRAIL_USERNAME
wrangler secret put TESTRAIL_API_KEY    # or TESTRAIL_PASSWORD
wrangler secret put MCP_AUTH_TOKEN      # optional but recommended: bearer token clients must send
```

When `MCP_AUTH_TOKEN` is set, clients must send
`Authorization: Bearer <token>`. Without it the endpoint is public — don't
store TestRail credentials in an unauthenticated Worker.

## Develop

```bash
npm install
npm run check      # tsc --noEmit
npm test           # vitest (43 tests)
npm run dev        # wrangler dev (put creds in .dev.vars)
```

Regenerate the endpoint catalog after `testrail_api_module` changes:

```bash
npm run catalog    # python3 scripts/generate_catalog.py [path-to-module-src]
```

## Deploy

```bash
npx wrangler login   # once
npm run deploy
```

Or via CI: the `deploy-cloudflare` GitHub Actions workflow
(`.github/workflows/deploy-cloudflare.yml`) deploys on manual dispatch using a
`CLOUDFLARE_API_TOKEN` repo secret (Workers Scripts:Edit permission).

## Client config

Claude Code:

```bash
claude mcp add --transport http testrail https://tram-mcp.<your-subdomain>.workers.dev/mcp \
  --header "Authorization: Bearer <MCP_AUTH_TOKEN>"
```

Claude Desktop / other JSON-config clients:

```json
{
  "mcpServers": {
    "testrail": {
      "type": "http",
      "url": "https://tram-mcp.<your-subdomain>.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_AUTH_TOKEN>",
        "X-TestRail-URL": "https://yourinstance.testrail.io",
        "X-TestRail-Username": "you@company.com",
        "X-TestRail-API-Key": "<your-key>"
      }
    }
  }
}
```

The `X-TestRail-*` headers are optional when Worker secrets are set, or when
users configure their login via the `setup_testrail_connection` tool instead.

## Notes

- File-upload endpoints (multipart attachments) are not supported; the catalog
  marks them and `run_testrail_command` returns an actionable error.
- Composite helper methods from the Python module that make multiple API calls
  (e.g. `cases.get_required_case_fields`) are marked unsupported — call the
  underlying endpoints individually.
