"""Tests for the execute tool (all use mocked client)."""
from __future__ import annotations

from tram_mcp.server import execute as _execute_tool

execute = _execute_tool.fn


def test_invalid_category(mock_client):
    result = execute("nonexistent", "get_projects")
    assert "error" in result
    assert "available_categories" in result
    mock_client.assert_not_called()


def test_invalid_method(mock_client):
    result = execute("projects", "nonexistent_method")
    assert "error" in result
    assert "available_methods" in result


def test_missing_env_vars(monkeypatch):
    monkeypatch.delenv("TESTRAIL_URL", raising=False)
    monkeypatch.delenv("TESTRAIL_USERNAME", raising=False)
    monkeypatch.delenv("TESTRAIL_API_KEY", raising=False)
    monkeypatch.delenv("TESTRAIL_PASSWORD", raising=False)
    # _client is None (reset by autouse fixture), so execute will try _get_client()
    result = execute("projects", "get_projects")
    assert "error" in result
    assert "Missing" in result["error"]


def test_successful_dict_return(mock_client):
    mock_client.projects.get_projects.return_value = {"id": 1}
    result = execute("projects", "get_projects")
    assert result == {"id": 1}


def test_successful_list_return(mock_client):
    mock_client.projects.get_projects.return_value = [{"id": 1}]
    result = execute("projects", "get_projects")
    assert result == [{"id": 1}]


def test_none_return_becomes_status_ok(mock_client):
    mock_client.projects.get_projects.return_value = None
    result = execute("projects", "get_projects")
    assert result == {"status": "ok"}


def test_empty_list_returned_as_is(mock_client):
    mock_client.projects.get_projects.return_value = []
    result = execute("projects", "get_projects")
    assert result == []


def test_params_passed_as_kwargs(mock_client):
    mock_client.projects.get_project.return_value = {"id": 1}
    execute("projects", "get_project", params={"project_id": 42})
    mock_client.projects.get_project.assert_called_once_with(project_id=42)


def test_params_none_treated_as_empty(mock_client):
    mock_client.projects.get_projects.return_value = []
    execute("projects", "get_projects", params=None)
    mock_client.projects.get_projects.assert_called_once_with()


def test_api_exception_caught(mock_client):
    mock_client.projects.get_projects.side_effect = RuntimeError("fail")
    result = execute("projects", "get_projects")
    assert "error" in result
    assert "RuntimeError" in result["error"]
    assert "fail" in result["error"]


def test_type_error_caught(mock_client):
    mock_client.projects.get_projects.side_effect = TypeError("unexpected keyword")
    result = execute("projects", "get_projects")
    assert "error" in result
    assert "TypeError" in result["error"]


# ---------------------------------------------------------------------------
# extra_params tests
# ---------------------------------------------------------------------------


def test_extra_params_patches_build_url(mock_client):
    """extra_params should temporarily patch _build_url on the submodule."""
    mock_client.cases.get_cases.return_value = [{"id": 1}]
    # Give the mock submodule a _build_url so the patch can wrap it
    mock_client.cases._build_url = lambda endpoint, params=None: (
        f"https://example.testrail.io/index.php?/api/v2/{endpoint}"
    )
    # Track what _build_url returns during the call
    captured_urls = []
    original = mock_client.cases._build_url

    def spy_build_url(endpoint, params=None):
        url = original(endpoint, params)
        captured_urls.append(url)
        return url

    mock_client.cases._build_url = spy_build_url

    result = execute(
        "cases", "get_cases",
        params={"project_id": 1},
        extra_params={"custom_automation_type": "1"},
    )
    assert result == [{"id": 1}]
    mock_client.cases.get_cases.assert_called_once_with(project_id=1)


def test_extra_params_appended_to_url(mock_client):
    """_call_with_extra_params should append extra params to the URL."""
    from tram_mcp.server import _call_with_extra_params

    calls = []

    def fake_build_url(endpoint, params=None):
        return f"https://example.testrail.io/index.php?/api/v2/{endpoint}"

    mock_client.cases._build_url = fake_build_url

    # Wrap _build_url and capture the patched output
    def capturing_func(**kwargs):
        # Call the (now-patched) _build_url to see what URL it produces
        url = mock_client.cases._build_url("get_cases/1")
        calls.append(url)
        return [{"id": 1}]

    mock_client.cases.get_cases = capturing_func

    _call_with_extra_params(
        mock_client.cases,
        mock_client.cases.get_cases,
        {"project_id": 1},
        {"custom_automation_type": "1"},
    )
    assert len(calls) == 1
    assert "custom_automation_type=1" in calls[0]


def test_extra_params_build_url_restored_after_call(mock_client):
    """_build_url should be restored even if the method raises."""
    def original_build_url(ep, p=None):
        return "https://example.com"

    mock_client.cases._build_url = original_build_url
    mock_client.cases.get_cases.side_effect = RuntimeError("boom")

    result = execute(
        "cases", "get_cases",
        params={"project_id": 1},
        extra_params={"custom_automation_type": "1"},
    )
    # _build_url should be restored to the original
    assert mock_client.cases._build_url is original_build_url
    assert "error" in result
    assert "RuntimeError" in result["error"]


def test_extra_params_none_values_filtered(mock_client):
    """None values in extra_params should be filtered out."""
    from tram_mcp.server import _call_with_extra_params

    urls = []

    def fake_build_url(endpoint, params=None):
        return "https://example.com/api/v2/get_cases/1"

    mock_client.cases._build_url = fake_build_url

    def capturing_func(**kwargs):
        url = mock_client.cases._build_url("get_cases/1")
        urls.append(url)
        return []

    mock_client.cases.get_cases = capturing_func

    _call_with_extra_params(
        mock_client.cases,
        mock_client.cases.get_cases,
        {"project_id": 1},
        {"custom_automation_type": "1", "custom_empty": None},
    )
    assert len(urls) == 1
    assert "custom_automation_type=1" in urls[0]
    assert "custom_empty" not in urls[0]


def test_extra_params_empty_dict_no_patch(mock_client):
    """An empty extra_params dict should not trigger patching."""
    mock_client.projects.get_projects.return_value = [{"id": 1}]
    result = execute("projects", "get_projects", extra_params={})
    assert result == [{"id": 1}]
    mock_client.projects.get_projects.assert_called_once_with()


def test_extra_params_with_no_regular_params(mock_client):
    """extra_params should work even when params is None."""
    mock_client.cases.get_cases.return_value = [{"id": 1}]
    def original_build_url(ep, p=None):
        return "https://example.com/api/v2/get_cases/1"

    mock_client.cases._build_url = original_build_url

    result = execute(
        "cases", "get_cases",
        params=None,
        extra_params={"custom_automation_type": "1"},
    )
    assert result == [{"id": 1}]
    mock_client.cases.get_cases.assert_called_once_with()
