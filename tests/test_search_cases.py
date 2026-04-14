"""Tests for the search_cases tool (all use mocked client)."""
from __future__ import annotations

from tram_mcp.server import search_test_cases as _search_cases_tool

search_cases = _search_cases_tool.fn

SAMPLE_CASES_LIST = [
    {"id": 1, "title": "Login with valid credentials", "section_id": 10},
    {"id": 2, "title": "Login with invalid password", "section_id": 10},
    {"id": 3, "title": "Logout from dashboard", "section_id": 11},
    {"id": 4, "title": "Reset password via email", "section_id": 12},
    {"id": 5, "title": "Verify LOGIN page loads", "section_id": 10},
]

# Paginated dict format returned by the actual TestRail API
SAMPLE_CASES = {
    "offset": 0,
    "limit": 250,
    "size": 5,
    "_links": {"next": None, "prev": None},
    "cases": SAMPLE_CASES_LIST,
}


def test_basic_search(mock_client):
    mock_client.cases.get_cases.return_value = SAMPLE_CASES
    result = search_cases(project_id=1, query="login")
    assert result["count"] == 3
    assert all(k in c for c in result["cases"] for k in ("id", "title", "section_id"))
    matched_ids = {c["id"] for c in result["cases"]}
    assert matched_ids == {1, 2, 5}


def test_case_insensitive_match(mock_client):
    mock_client.cases.get_cases.return_value = SAMPLE_CASES
    result = search_cases(project_id=1, query="LOGIN")
    assert result["count"] == 3


def test_no_matches(mock_client):
    mock_client.cases.get_cases.return_value = SAMPLE_CASES
    result = search_cases(project_id=1, query="nonexistent")
    assert result["count"] == 0
    assert result["cases"] == []


def test_suite_id_passed_through(mock_client):
    mock_client.cases.get_cases.return_value = {"offset": 0, "limit": 250, "size": 0, "cases": []}
    search_cases(project_id=1, query="test", suite_id=42)
    mock_client.cases.get_cases.assert_called_once_with(project_id=1, suite_id=42)


def test_suite_id_omitted(mock_client):
    mock_client.cases.get_cases.return_value = {"offset": 0, "limit": 250, "size": 0, "cases": []}
    search_cases(project_id=1, query="test")
    mock_client.cases.get_cases.assert_called_once_with(project_id=1)


def test_compact_result_fields(mock_client):
    """Only id, title, and section_id should be returned per case."""
    mock_client.cases.get_cases.return_value = {"offset": 0, "limit": 250, "size": 1, "cases": [
        {"id": 1, "title": "Test case", "section_id": 5, "priority_id": 3, "type_id": 1},
    ]}
    result = search_cases(project_id=1, query="test")
    assert result["count"] == 1
    case = result["cases"][0]
    assert set(case.keys()) == {"id", "title", "section_id"}


def test_missing_title_field(mock_client):
    """Cases without a title field should not match."""
    mock_client.cases.get_cases.return_value = {"offset": 0, "limit": 250, "size": 1, "cases": [
        {"id": 1, "section_id": 5},
    ]}
    result = search_cases(project_id=1, query="anything")
    assert result["count"] == 0


def test_missing_section_id(mock_client):
    """Cases without section_id should return None for that field."""
    mock_client.cases.get_cases.return_value = {"offset": 0, "limit": 250, "size": 1, "cases": [
        {"id": 1, "title": "A test"},
    ]}
    result = search_cases(project_id=1, query="test")
    assert result["count"] == 1
    assert result["cases"][0]["section_id"] is None


def test_api_error_caught(mock_client):
    mock_client.cases.get_cases.side_effect = RuntimeError("API failure")
    result = search_cases(project_id=1, query="test")
    assert "error" in result
    assert "RuntimeError" in result["error"]


def test_plain_list_response(mock_client):
    """Handles the case where get_cases returns a plain list (backward compat)."""
    mock_client.cases.get_cases.return_value = SAMPLE_CASES_LIST
    result = search_cases(project_id=1, query="login")
    assert result["count"] == 3
    matched_ids = {c["id"] for c in result["cases"]}
    assert matched_ids == {1, 2, 5}


def test_missing_env_vars(monkeypatch):
    monkeypatch.delenv("TESTRAIL_URL", raising=False)
    monkeypatch.delenv("TESTRAIL_USERNAME", raising=False)
    monkeypatch.delenv("TESTRAIL_API_KEY", raising=False)
    monkeypatch.delenv("TESTRAIL_PASSWORD", raising=False)
    result = search_cases(project_id=1, query="test")
    assert "error" in result
    assert "Missing" in result["error"]
