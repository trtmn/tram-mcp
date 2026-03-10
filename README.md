# TestRail MCP Server

[![Tests](https://github.com/trtmn/tram-mcp/actions/workflows/tests.yml/badge.svg)](https://github.com/trtmn/tram-mcp/actions/workflows/tests.yml) [![Python 3.11 | 3.12 | 3.13](https://img.shields.io/badge/python-3.11%20|%203.12%20|%203.13-blue?logo=python&logoColor=white)](https://pypi.org/project/tram-mcp/) [![PyPI - Version](https://img.shields.io/pypi/v/tram-mcp?label=Latest%20Version)](https://pypi.org/project/tram-mcp/) [![PyPI - Downloads](https://img.shields.io/pypi/dm/tram-mcp?color=purple)](https://pypi.org/project/tram-mcp/) [![GitHub Source](https://img.shields.io/badge/github-source-blue?logo=github)](https://github.com/trtmn/tram-mcp/) [![PyPI Stats](https://img.shields.io/badge/%20%F0%9F%94%97-blue?label=📈%20Stats)](https://pypistats.org/packages/tram-mcp) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An MCP (Model Context Protocol) server that exposes [TestRail](https://www.testrail.com/) API endpoints as tools for LLMs, built on top of [`testrail_api_module`](https://github.com/trtmn/testrail_api_module).

## Features

- **Dynamic tool discovery** — endpoints are introspected from `testrail_api_module` at startup, so new API coverage is picked up automatically
- **LLM-friendly** — instead of registering hundreds of tools, provides a category-based discovery pattern so models can explore available operations without being overwhelmed

## Requirements

- Python 3.11+
- [uv](https://docs.astral.sh/uv/)

## Quick Install

Click a button to install in your preferred tool:

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0078d7?style=flat-square&logo=visual-studio-code)](vscode:mcp/install?%7B%22name%22%3A%22testrail%22%2C%22type%22%3A%22stdio%22%2C%22command%22%3A%22uvx%22%2C%22args%22%3A%5B%22tram-mcp%22%5D%2C%22env%22%3A%7B%22TESTRAIL_URL%22%3A%22%22%2C%22TESTRAIL_USERNAME%22%3A%22%22%2C%22TESTRAIL_API_KEY%22%3A%22%22%7D%7D) [![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_Server-24bfa5?style=flat-square&logo=visual-studio-code)](vscode-insiders:mcp/install?%7B%22name%22%3A%22testrail%22%2C%22type%22%3A%22stdio%22%2C%22command%22%3A%22uvx%22%2C%22args%22%3A%5B%22tram-mcp%22%5D%2C%22env%22%3A%7B%22TESTRAIL_URL%22%3A%22%22%2C%22TESTRAIL_USERNAME%22%3A%22%22%2C%22TESTRAIL_API_KEY%22%3A%22%22%7D%7D) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install_Server-purple?style=flat-square&logo=cursor)](cursor://anysphere.cursor-deeplink/mcp/install?name=testrail&config=eyJjb21tYW5kIjoidXZ4IiwiYXJncyI6WyJ0cmFtLW1jcCJdLCJlbnYiOnsiVEVTVFJBSUxfVVJMIjoiIiwiVEVTVFJBSUxfVVNFUk5BTUUiOiIiLCJURVNUUkFJTF9BUElfS0VZIjoiIn19)

After installing, you will be prompted to fill in your TestRail credentials. See [Configuration](#configuration) below.

## Manual Installation

### Claude Desktop

Add to your Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "testrail": {
      "command": "uvx",
      "args": ["tram-mcp"],
      "env": {
        "TESTRAIL_URL": "https://yourinstance.testrail.io",
        "TESTRAIL_USERNAME": "your-email@example.com",
        "TESTRAIL_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add testrail \
  -e TESTRAIL_URL=https://yourinstance.testrail.io \
  -e TESTRAIL_USERNAME=your-email@example.com \
  -e TESTRAIL_API_KEY=your-api-key \
  -- uvx tram-mcp
```

### VS Code / VS Code Insiders

Create `.vscode/mcp.json` in your project (or add to your User Settings):

```json
{
  "servers": {
    "testrail": {
      "type": "stdio",
      "command": "uvx",
      "args": ["tram-mcp"],
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

### Cursor

Create `.cursor/mcp.json` in your project (or `~/.cursor/mcp.json` globally):

```json
{
  "mcpServers": {
    "testrail": {
      "command": "uvx",
      "args": ["tram-mcp"],
      "env": {
        "TESTRAIL_URL": "https://yourinstance.testrail.io",
        "TESTRAIL_USERNAME": "your-email@example.com",
        "TESTRAIL_API_KEY": "your-api-key"
      }
    }
  }
}
```

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

## License

MIT
