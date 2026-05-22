# TestRail MCP Server

[![Tests](https://github.com/trtmn/tram-mcp/actions/workflows/tests.yml/badge.svg)](https://github.com/trtmn/tram-mcp/actions/workflows/tests.yml)
[![Python 3.11 | 3.12 | 3.13](https://img.shields.io/badge/python-3.11%20|%203.12%20|%203.13-blue?logo=python&logoColor=white)](https://pypi.org/project/tram-mcp/)
[![PyPI - Version](https://img.shields.io/pypi/v/tram-mcp?label=Latest%20Version)](https://pypi.org/project/tram-mcp/)
[![PyPI - Downloads](https://img.shields.io/pypi/dm/tram-mcp?color=purple)](https://pypi.org/project/tram-mcp/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Connect your AI coding assistant to [TestRail](https://www.testrail.com/) — manage test cases, runs, results, and more directly from VS Code, Cursor, Claude Desktop, or Claude Code. Built on the [Model Context Protocol](https://modelcontextprotocol.io/) and powered by [`testrail_api_module`](https://github.com/trtmn/testrail_api_module).

## Features

- **Dynamic tool discovery** — endpoints are introspected from `testrail_api_module` at startup, so new API coverage is picked up automatically
- **LLM-friendly** — instead of registering hundreds of tools, provides a category-based discovery pattern so models can explore available operations without being overwhelmed

## Requirements

- Python 3.11+
- [uv](https://docs.astral.sh/uv/)

## Installation

### Step 1 — Install `tram-mcp` once

```bash
uv tool install tram-mcp
```

This puts a `tram-mcp` binary on your `PATH` (typically `~/.local/bin/tram-mcp`
on macOS/Linux, `%APPDATA%\Python\Scripts\tram-mcp.exe` on Windows).

`tram-mcp` then auto-updates itself: on launch (at most once per day) it
spawns a detached `uv tool upgrade tram-mcp` in the background. The current
process keeps running on the existing binary; the upgrade lands on the next
launch. Set `TRAM_MCP_NO_AUTO_UPDATE=1` to disable, or run
`uv tool upgrade tram-mcp` manually anytime.

> **Why this and not `uvx tram-mcp`?** `uvx` re-resolves and re-extracts
> wheels on every launch. On Windows this races with Defender / OneDrive
> scanning the uv cache and intermittently fails with
> `Access is denied. (os error -2147024891)` — the server starts, then
> exits before it can respond. Even on a healthy machine, a cold uvx cache
> costs ~4 s+ and can exceed an MCP client's startup timeout. Installing
> once removes both problems.

### Step 2 — Configure your MCP client

#### Claude Desktop

Add to your Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "testrail": {
      "command": "tram-mcp",
      "env": {
        "TESTRAIL_URL": "https://yourinstance.testrail.io",
        "TESTRAIL_USERNAME": "your-email@example.com",
        "TESTRAIL_API_KEY": "your-api-key"
      }
    }
  }
}
```

#### Claude Code

```bash
claude mcp add testrail \
  -e TESTRAIL_URL=https://yourinstance.testrail.io \
  -e TESTRAIL_USERNAME=your-email@example.com \
  -e TESTRAIL_API_KEY=your-api-key \
  -- tram-mcp
```

#### VS Code / VS Code Insiders

Create `.vscode/mcp.json` in your project (or add to your User Settings):

```json
{
  "servers": {
    "testrail": {
      "type": "stdio",
      "command": "tram-mcp",
      "env": {
        "TESTRAIL_URL": "",
        "TESTRAIL_USERNAME": "",
        "TESTRAIL_API_KEY": ""
      }
    }
  }
}
```

VS Code supports `${input:variableName}` placeholders to prompt for values at startup.

#### Cursor

Create `.cursor/mcp.json` in your project (or `~/.cursor/mcp.json` globally):

```json
{
  "mcpServers": {
    "testrail": {
      "command": "tram-mcp",
      "env": {
        "TESTRAIL_URL": "https://yourinstance.testrail.io",
        "TESTRAIL_USERNAME": "your-email@example.com",
        "TESTRAIL_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Alternative — no-install via `uvx`

If you prefer not to maintain a separate install, you can use `uvx tram-mcp`
as the `command` (with `"args": ["tram-mcp"]`) — Cursor / VS Code / etc. style.
This always pulls the latest version on each launch but pays a noticeable
cold-cache cost (~4 s) that can intermittently exceed MCP client startup
timeouts on slower networks. The installed approach above is recommended.

## Configuration

The server requires TestRail credentials via environment variables:

| Variable | Required | Description |
|---|---|---|
| `TESTRAIL_URL` | Yes | Your TestRail instance URL (e.g. `https://example.testrail.io`) |
| `TESTRAIL_USERNAME` | Yes | TestRail username or email |
| `TESTRAIL_API_KEY` | Yes* | TestRail API key |
| `TESTRAIL_PASSWORD` | Yes* | TestRail password (alternative to API key) |

*Either `TESTRAIL_API_KEY` or `TESTRAIL_PASSWORD` must be set. API key is recommended.

## Development

```bash
# Install dependencies
uv sync

# Run the server locally
uv run tram_mcp

# Run tests
uv run pytest

# Run a single test
uv run pytest path/to/test.py::test_name -v
```

### Releasing

Merging a PR to `main` automatically tags the version and publishes to PyPI. **You must bump the version before merging:**

```bash
uv version 0.2.0  # update version in pyproject.toml
```

If you forget to bump, the publish will be skipped (the existing version tag already exists on PyPI).

## License

MIT
