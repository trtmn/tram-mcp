# TestRail MCP Server

An MCP (Model Context Protocol) server that exposes [TestRail](https://www.testrail.com/) API endpoints as tools for LLMs, built on top of [`testrail_api_module`](https://github.com/trtmn/testrail_api_module).

## Features

- **Dynamic tool discovery** — endpoints are introspected from `testrail_api_module` at startup, so new API coverage is picked up automatically
- **LLM-friendly** — instead of registering hundreds of tools, provides a category-based discovery pattern so models can explore available operations without being overwhelmed

## Requirements

- Python 3.13+
- [uv](https://docs.astral.sh/uv/)

## Setup

```bash
# Run directly via uvx (no install needed)
uvx testrail_mcp

# Or install and run locally for development
uv sync
uv run testrail_mcp
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
# Run tests
uv run pytest

# Run a single test
uv run pytest path/to/test.py::test_name -v
```

## License

MIT
