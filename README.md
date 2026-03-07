# TestRail MCP Server

[![PyPI - Version](https://img.shields.io/pypi/v/tram-mcp?label=Latest%20Version)](https://pypi.org/project/tram-mcp/) [![PyPI - Downloads](https://img.shields.io/pypi/dm/tram-mcp?color=purple)](https://pypi.org/project/tram-mcp/) [![GitHub Source](https://img.shields.io/badge/github-source-blue?logo=github)](https://github.com/trtmn/tram-mcp/) [![PyPI Stats](https://img.shields.io/badge/%20%F0%9F%94%97-blue?label=📈%20Stats)](https://pypistats.org/packages/tram-mcp) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An MCP (Model Context Protocol) server that exposes [TestRail](https://www.testrail.com/) API endpoints as tools for LLMs, built on top of [`testrail_api_module`](https://github.com/trtmn/testrail_api_module).

## Features

- **Dynamic tool discovery** — endpoints are introspected from `testrail_api_module` at startup, so new API coverage is picked up automatically
- **LLM-friendly** — instead of registering hundreds of tools, provides a category-based discovery pattern so models can explore available operations without being overwhelmed

## Requirements

- Python 3.13+
- [uv](https://docs.astral.sh/uv/)

## Installation

### Claude Desktop

Add to your Claude Desktop configuration file (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "testrail": {
      "command": "uvx",
      "args": ["tram-mcp"],
      "env": {
        "TESTRAIL_URL": "https://example.testrail.io",
        "TESTRAIL_USERNAME": "your-email@example.com",
        "TESTRAIL_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add testrail -- uvx tram-mcp
```

Then set the required environment variables in your shell before launching Claude Code:

```bash
export TESTRAIL_URL="https://example.testrail.io"
export TESTRAIL_USERNAME="your-email@example.com"
export TESTRAIL_API_KEY="your-api-key"
```

### Cursor

Add to your Cursor MCP configuration file (`.cursor/mcp.json` in your project or `~/.cursor/mcp.json` globally):

```json
{
  "mcpServers": {
    "testrail": {
      "command": "uvx",
      "args": ["tram-mcp"],
      "env": {
        "TESTRAIL_URL": "https://example.testrail.io",
        "TESTRAIL_USERNAME": "your-email@example.com",
        "TESTRAIL_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Configuration

The server requires TestRail credentials, provided via environment variables:

| Variable | Description |
|---|---|
| `TESTRAIL_URL` | Your TestRail instance URL (e.g. `https://example.testrail.io`) |
| `TESTRAIL_USERNAME` | TestRail username or email |
| `TESTRAIL_API_KEY` | TestRail API key |

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

## License

MIT
