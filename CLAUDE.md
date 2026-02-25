# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an MCP (Model Context Protocol) server that wraps the `testrail_api_module` PyPI package, exposing TestRail API endpoints as MCP tools. Built with FastMCP.

**Key design principle:** Tools should be discovered dynamically from the `testrail_api_module` rather than hardcoded, to avoid overwhelming LLMs with too many tools and to automatically support new endpoints as the underlying package updates.

## Tech Stack

- Python 3.13, managed with `uv`
- FastMCP (`fastmcp>=2.12.4`) for MCP server framework
- `testrail_api_module` as the underlying TestRail API client (needs to be added as dependency)

## Common Commands

```bash
# Install dependencies
uv sync

# Add a new dependency
uv add <package>

# Run the MCP server
uv run python main.py

# Run all tests
uv run pytest

# Run a single test
uv run pytest test_testing/test_browse.py::test_apple_page_title -v

# Run tests with output
uv run pytest -s

# Install packages (not dependencies - dependencies use `uv add`)
uv pip install <package>
```

## Architecture Goals

The MCP server should:
1. **Introspect `testrail_api_module`** at startup to discover available API modules (projects, cases, runs, results, etc.) and their methods
2. **Dynamically register MCP tools** based on discovered endpoints rather than manually defining each one
3. **Provide a category/discovery pattern** — e.g., a `list_categories` tool that returns available API modules, and a way to invoke specific endpoints — so the LLM can explore capabilities without being flooded with hundreds of tools upfront
4. **Pass through** to `TestRailAPI` client methods, handling authentication via environment variables or MCP configuration

## TestRail API Module Reference

The `testrail_api_module` package (`TestRailAPI` class) organizes endpoints into submodules accessed as attributes: `api.projects.get_projects()`, `api.cases.add_case(...)`, `api.results.add_result(...)`, etc. Key modules include: projects, cases, runs, results, attachments, bdd, configurations, labels, sections, users, statuses, plans, datasets, milestones, suites, priorities.

Docs: https://trtmn.github.io/testrail_api_module/
Source: https://github.com/trtmn/testrail_api_module
