"""Tests for _get_client() env var handling."""
from __future__ import annotations

from unittest.mock import patch, MagicMock

import pytest

import tram_mcp.server as server


def test_all_env_vars_missing(monkeypatch):
    monkeypatch.delenv("TESTRAIL_URL", raising=False)
    monkeypatch.delenv("TESTRAIL_USERNAME", raising=False)
    monkeypatch.delenv("TESTRAIL_API_KEY", raising=False)
    monkeypatch.delenv("TESTRAIL_PASSWORD", raising=False)
    with pytest.raises(EnvironmentError, match="TESTRAIL_URL"):
        server._get_client()


def test_single_env_var_missing(monkeypatch):
    monkeypatch.setenv("TESTRAIL_URL", "https://example.testrail.io")
    monkeypatch.setenv("TESTRAIL_USERNAME", "user@example.com")
    monkeypatch.delenv("TESTRAIL_API_KEY", raising=False)
    monkeypatch.delenv("TESTRAIL_PASSWORD", raising=False)
    with pytest.raises(EnvironmentError, match="TESTRAIL_API_KEY") as exc_info:
        server._get_client()
    # Should NOT mention the ones that are set
    assert "TESTRAIL_URL" not in str(exc_info.value)
    assert "TESTRAIL_USERNAME" not in str(exc_info.value)


def test_empty_string_treated_as_missing(monkeypatch):
    monkeypatch.setenv("TESTRAIL_URL", "")
    monkeypatch.setenv("TESTRAIL_USERNAME", "user@example.com")
    monkeypatch.setenv("TESTRAIL_API_KEY", "key123")
    monkeypatch.delenv("TESTRAIL_PASSWORD", raising=False)
    with pytest.raises(EnvironmentError, match="TESTRAIL_URL"):
        server._get_client()


def test_singleton_returns_same_instance(monkeypatch):
    monkeypatch.setenv("TESTRAIL_URL", "https://example.testrail.io")
    monkeypatch.setenv("TESTRAIL_USERNAME", "user@example.com")
    monkeypatch.setenv("TESTRAIL_API_KEY", "key123")
    mock_api = MagicMock()
    with patch("testrail_api_module.TestRailAPI", return_value=mock_api):
        first = server._get_client()
        second = server._get_client()
    assert first is second


def test_client_created_with_correct_args(monkeypatch):
    monkeypatch.setenv("TESTRAIL_URL", "https://my.testrail.io")
    monkeypatch.setenv("TESTRAIL_USERNAME", "admin@test.com")
    monkeypatch.setenv("TESTRAIL_API_KEY", "secret123")
    monkeypatch.delenv("TESTRAIL_PASSWORD", raising=False)
    mock_api = MagicMock()
    with patch("testrail_api_module.TestRailAPI", return_value=mock_api) as mock_cls:
        client = server._get_client()
    mock_cls.assert_called_once_with(
        base_url="https://my.testrail.io",
        username="admin@test.com",
        api_key="secret123",
    )
    assert client is mock_api
