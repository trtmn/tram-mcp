"""Tests for the get_method_info tool."""
from __future__ import annotations

from tram_mcp.server import get_method_info as _get_method_info_tool

get_method_info = _get_method_info_tool.fn


def test_valid_category_and_method():
    result = get_method_info("projects", "get_projects")
    assert "parameters" in result
    assert "docstring" in result
    assert "return_type" in result


def test_invalid_category():
    result = get_method_info("nonexistent", "get_projects")
    assert "error" in result
    assert "nonexistent" in result["error"]
    assert "available_categories" in result


def test_invalid_method_valid_category():
    result = get_method_info("projects", "nonexistent_method")
    assert "error" in result
    assert "nonexistent_method" in result["error"]
    assert "available_methods" in result


def test_case_sensitive():
    result = get_method_info("Projects", "get_projects")
    assert "error" in result
    assert "available_categories" in result


def test_available_categories_sorted():
    result = get_method_info("zzz_bad", "whatever")
    cats = result["available_categories"]
    assert cats == sorted(cats)


def test_available_methods_sorted():
    result = get_method_info("projects", "zzz_bad")
    methods = result["available_methods"]
    assert methods == sorted(methods)
