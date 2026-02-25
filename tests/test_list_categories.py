"""Tests for the list_categories tool."""
from __future__ import annotations

from testrail_mcp.server import CATALOG, list_categories as _list_categories_tool

# FastMCP @mcp.tool wraps functions in FunctionTool; unwrap to call directly
list_categories = _list_categories_tool.fn


def test_returns_all_categories():
    result = list_categories()
    assert set(result.keys()) == set(CATALOG.keys())


def test_category_entry_shape():
    result = list_categories()
    for name, entry in result.items():
        assert isinstance(entry["description"], str), f"{name}: description not str"
        assert isinstance(entry["methods"], list), f"{name}: methods not list"


def test_methods_are_lists_not_dicts():
    result = list_categories()
    for name, entry in result.items():
        methods = entry["methods"]
        assert isinstance(methods, list), f"{name}: methods should be list"
        for m in methods:
            assert isinstance(m, str), f"{name}: method entry should be str, got {type(m)}"
