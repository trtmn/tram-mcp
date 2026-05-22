# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an MCP (Model Context Protocol) server that wraps the `testrail_api_module` PyPI package, exposing TestRail API endpoints as MCP tools. Built with FastMCP.

**Key design principle:** Tools should be discovered dynamically from the `testrail_api_module` rather than hardcoded, to avoid overwhelming LLMs with too many tools and to automatically support new endpoints as the underlying package updates.

## Tech Stack

- Python 3.13, managed with `uv` (3.11+ supported at runtime; **Python 3.14 is not yet supported** — pinned in `pyproject.toml` as `>=3.11,<3.14`)
- FastMCP (`fastmcp>=2.12.4`) for MCP server framework
- `testrail_api_module` as the underlying TestRail API client

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

- **`main`** — production branch. Releases are cut and published from here. Never commit directly to main.
- **`dev`** — integration branch. All feature work merges here first via PR.
- **Feature branches** — branch from `dev`, do the work, open a PR back into `dev`.
- When `dev` is stable and ready for release, open a PR from `dev` → `main`.

## Releasing

- Merging a PR (or pushing) to `main` auto-tags and publishes to PyPI via GitHub Actions.
- **Always bump the version** (`uv version X.Y.Z`) before merging to main. If the version isn't bumped, the publish is skipped.
- A manual publish fallback exists via the "Publish Package (manual)" workflow in GitHub Actions.

## TestRail API Module Reference

The `testrail_api_module` package (`TestRailAPI` class) organizes endpoints into submodules accessed as attributes: `api.projects.get_projects()`, `api.cases.add_case(...)`, `api.results.add_result(...)`, etc. Key modules include: projects, cases, runs, results, attachments, bdd, configurations, labels, sections, users, statuses, plans, datasets, milestones, suites, priorities.

Docs: https://trtmn.github.io/testrail_api_module/
Source: https://github.com/trtmn/testrail_api_module
