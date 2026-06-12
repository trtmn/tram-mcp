# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an MCP (Model Context Protocol) server that wraps the `testrail_api_module` PyPI package, exposing TestRail API endpoints as MCP tools. Built with FastMCP.

**Key design principle:** Tools should be discovered dynamically from the `testrail_api_module` rather than hardcoded, to avoid overwhelming LLMs with too many tools and to automatically support new endpoints as the underlying package updates.

## Tech Stack

- Python 3.13, managed with `uv` (3.11+ supported at runtime; **Python 3.14 is not yet supported** — pinned in `pyproject.toml` as `>=3.11,<3.14`)
- FastMCP (`fastmcp>=2.12.4`) for MCP server framework
- `testrail_api_module` as the underlying TestRail API client

## Cloudflare Workers Deployment (`cloudflare/`)

A parallel TypeScript implementation lives in `cloudflare/` — a remote MCP server on Cloudflare Workers (Durable Objects via the `agents` SDK, streamable HTTP at `/mcp`, SSE at `/sse`). It does not import `testrail_api_module`; instead, `cloudflare/scripts/generate_catalog.py` AST-parses that module's source (sibling checkout at `~/git/testrail_api_module`) into `cloudflare/src/catalog.json`, and the Worker dispatches generically (path params fill the endpoint template, the rest go to query string for GET / JSON body for POST). Regenerate the catalog with `npm run catalog` whenever the Python module changes.

**Auth: OAuth 2.1** via `@cloudflare/workers-oauth-provider` (`src/index.ts` wraps the agent in an `OAuthProvider`; `src/authorize.ts` is the default handler). Both Claude.ai *and* Claude Code authenticate through the standard OAuth flow — the `/authorize` page is a TestRail credential form (URL / username / API key or password), validated against TestRail before the grant is issued. Entered credentials become the grant `props` (→ `McpAgent.props`, consumed by `getCredentials`) and are stored in the `OAUTH_KV` namespace **encrypted with the access token** — no Worker secrets, and Cloudflare cannot read them. There is **no** header-based credential path or bearer-token gate: the old `setup_testrail_connection` tool, `X-TestRail-*` headers, `MCP_AUTH_TOKEN`, and `auth.ts` were all removed (9 tools remain).

**Local dev:** `npm run dev` (= `wrangler dev`) runs the whole stack in Miniflare — no Cloudflare account, login, or real KV namespace needed; the full OAuth flow works on `localhost` (reachable by Claude Code / MCP Inspector, not Claude.ai). **Self-host:** `wrangler kv namespace create OAUTH_KV`, put the new id in `wrangler.jsonc` (the shipped id won't resolve in another account), then `npm run deploy` — a free Cloudflare plan suffices and no secrets are needed. Commands (from `cloudflare/`): `npm run check` (tsc), `npm test` (vitest, 68 tests), `npm run dev`, `npm run deploy`, `npm run catalog`. See `cloudflare/README.md` for full setup and client-connection details.

## Common Commands

```bash
# Install dependencies
uv sync

# Add a new dependency
uv add <package>

# Run the MCP server
uv run tram-mcp

# Run all tests
uv run pytest

# Run a single test
uv run pytest tests/test_autoupdate.py::test_opt_out_skips -v

# Run tests with output
uv run pytest -s

# Install packages (not dependencies - dependencies use `uv add`)
uv pip install <package>
```

## Authentication & Secrets

- The server reads credentials from environment variables. For local development you can supply them via a `.env` file at the project root (loaded by `_load_env()` in `tram_mcp/server.py` using `python-dotenv`).
- `.env` can be a regular file *or* a FIFO/named pipe (some secret managers expose secrets that way). FIFOs only serve data once per `open()`, so the loader reads via a stream rather than letting `load_dotenv` re-open the path, and applies a short timeout to avoid blocking indefinitely.
- **Do NOT hardcode credentials** in `.mcp.json` — that `env` block goes stale. Set the env vars in your shell, your MCP client's `env` config, or a `.env` file.
- Supported env vars: `TESTRAIL_URL`, `TESTRAIL_USERNAME`, `TESTRAIL_API_KEY`, `TESTRAIL_PASSWORD`. Either `TESTRAIL_API_KEY` or `TESTRAIL_PASSWORD` must be set.
- If auth fails repeatedly, check for **account lockout** — TestRail locks accounts after too many failed attempts (~10 min cooldown).

## Architecture Goals

The MCP server should:
1. **Introspect `testrail_api_module`** at startup to discover available API modules (projects, cases, runs, results, etc.) and their methods
2. **Dynamically register MCP tools** based on discovered endpoints rather than manually defining each one
3. **Provide a category/discovery pattern** — e.g., a `list_categories` tool that returns available API modules, and a way to invoke specific endpoints — so the LLM can explore capabilities without being flooded with hundreds of tools upfront
4. **Pass through** to `TestRailAPI` client methods, handling authentication via environment variables or MCP configuration

## Distribution

- **PyPI**: published as `tram-mcp`. End users install with `uv tool install tram-mcp` (recommended) or `uvx tram-mcp` (zero-install, but re-resolves on each launch — see auto-update note).
- **.mcpb bundle**: `manifest.json` declares the Claude Desktop extension. The `.mcpb` itself is **built by CI** on every release (see `.github/workflows/tag-release.yml`'s `build-mcpb` job) and attached to the matching GitHub Release as a downloadable asset — **do not commit `testrail_mcp.mcpb` to the repo** (it's gitignored). To smoke-test a local build before opening a PR: `npx --yes @anthropic-ai/mcpb pack <staging-dir> testrail_mcp.mcpb`. The bundle's `mcp_config` invokes `uv run --script ${__dirname}/main.py`, which self-bootstraps tram-mcp (locates the installed binary on PATH or runs `uv tool install tram-mcp` on first launch). This avoids both the Windows Defender / OneDrive race on the uv cache **and** the "binary not on PATH" failure for Desktop Extension users who never ran `uv tool install`.
- **Auto-update on launch**: `tram_mcp/_autoupdate.py` spawns a detached `uv tool upgrade tram-mcp` in the background at startup, debounced to once per 24h via a marker file. Never blocks the MCP handshake, swallows all errors, and no-ops when not running from a `uv tool` install. Disable with `TRAM_MCP_NO_AUTO_UPDATE=1`.

## TestRail Instance Notes

- **URL:** Set via the `TESTRAIL_URL` env var (e.g. `https://yourinstance.testrail.io`).
- **Templates:** Template 1 = "Test Case (Text)" uses `custom_steps`/`custom_expected` fields. Template 2 = "Test Case (Steps)" uses `custom_steps_separated` (array of `{content, expected}`). To use separated steps, set `template_id: 2`.
- When updating cases from Text to Steps template, you must change `template_id` in the same call.

## Git Rules

- **Never** add `Co-Authored-By` lines to commit messages.

## Branching Strategy

- **`main`** — production mirror. Always reflects the latest published tag on PyPI. Never commit directly (protected by a repo ruleset: no force-push, no delete). The only commits that reach `main` are auto-merged sync PRs from `development` opened by the release workflow.
- **`development`** — integration branch. All feature work merges here first via PR. release-please watches this branch.
- **Feature branches** — branch from `development`, do the work, open a PR back into `development`.

## Commits

This repo uses **Conventional Commits** to drive release-please's automatic versioning and CHANGELOG generation. Use one of these prefixes in PR titles (which become squash-commit subjects):

- `feat: …` — new functionality (minor bump pre-1.0, becomes minor post-1.0)
- `fix: …` — bug fix (patch bump)
- `chore: …`, `docs: …`, `ci: …`, `build: …`, `refactor: …`, `perf: …`, `test: …`, `style: …`, `deps: …` — no version bump on their own
- Breaking change marker: add `!` after the type (`feat!: …`) or include a `BREAKING CHANGE:` line in the body — bumps the major (or minor pre-1.0).

PR titles must follow this format; the squash-merge commit on `development` is what release-please parses.

## Releasing (release-please)

Releases are fully automated by `googleapis/release-please-action@v4`. Config lives at `.github/release-please-config.json` and the current version at `.github/.release-please-manifest.json`.

Flow:

1. Open a PR into `development` with a conventional-commits title. Merge it (squash).
2. The `release-please` workflow on push-to-`development` opens (or updates) a **Release PR** that bumps the version in `.release-please-manifest.json`, `pyproject.toml` (via `release-type: python`), `manifest.json` (via `extra-files` jsonpath), and `main.py`'s `LAUNCHER_VERSION` line (marked with `# x-release-please-version`), plus regenerates `CHANGELOG.md`.
3. When the Release PR is merged, the workflow continues:
   - Creates the git tag (`vX.Y.Z`) and GitHub Release with release-please-generated notes.
   - Builds and publishes to PyPI.
   - Packs `testrail_mcp.mcpb` and attaches it to the GitHub Release.
   - Opens an auto-merging PR `development → main` so `main` mirrors the release.

Manual fallback: `.github/workflows/publish.yml` (`workflow_dispatch`) builds and publishes to PyPI on demand.

`v*` tags and `main` are protected by repo rulesets (no deletion, no force-push), so once a release is cut it's pinned to its SHA forever.

## TestRail API Module Reference

The `testrail_api_module` package (`TestRailAPI` class) organizes endpoints into submodules accessed as attributes: `api.projects.get_projects()`, `api.cases.add_case(...)`, `api.results.add_result(...)`, etc. Key modules include: projects, cases, runs, results, attachments, bdd, configurations, labels, sections, users, statuses, plans, datasets, milestones, suites, priorities.

Docs: https://trtmn.github.io/testrail_api_module/
Source: https://github.com/trtmn/testrail_api_module
