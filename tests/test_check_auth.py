"""Tests for the check_testrail_auth MCP tool.

We test the tool's dispatch + diagnostic logic, not the HTTP layer. The
client is mocked via the ``mock_client`` fixture in conftest.py.
"""

from __future__ import annotations

import os
from unittest.mock import MagicMock

import pytest

from tram_mcp.server import (
    _configured_auth_method,
    _diagnose_auth_failure,
    _hint_for,
    check_testrail_auth,
)


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

class TestConfiguredAuthMethod:
    def test_reports_api_key_when_set(self, monkeypatch):
        monkeypatch.setenv("TESTRAIL_API_KEY", "x")
        monkeypatch.delenv("TESTRAIL_PASSWORD", raising=False)
        assert _configured_auth_method() == "api_key"

    def test_reports_password_when_only_password_set(self, monkeypatch):
        monkeypatch.delenv("TESTRAIL_API_KEY", raising=False)
        monkeypatch.setenv("TESTRAIL_PASSWORD", "x")
        assert _configured_auth_method() == "password"

    def test_prefers_api_key_when_both_set(self, monkeypatch):
        # The TestRail client itself prefers api_key over password — we should
        # surface the same preference so the user knows what's actually used.
        monkeypatch.setenv("TESTRAIL_API_KEY", "x")
        monkeypatch.setenv("TESTRAIL_PASSWORD", "y")
        assert _configured_auth_method() == "api_key"

    def test_reports_none_when_neither_set(self, monkeypatch):
        monkeypatch.delenv("TESTRAIL_API_KEY", raising=False)
        monkeypatch.delenv("TESTRAIL_PASSWORD", raising=False)
        assert _configured_auth_method() == "none"


class TestHintFor:
    """The hint text is what guides the LLM toward the right remediation —
    these guard the mapping from (error_class, status) to hint phrasing.
    Substring checks rather than full equality so the prose can evolve."""

    def test_401_includes_credentials_advice(self):
        hint = _hint_for("TestRailAuthenticationError", 401)
        assert "401" in hint
        assert "credentials" in hint.lower()

    def test_401_class_alone_still_diagnoses_creds(self):
        # The library sometimes raises TestRailAuthenticationError without
        # a status code in the message — the hint should still work.
        hint = _hint_for("TestRailAuthenticationError", None)
        assert "401" in hint or "credentials" in hint.lower()

    def test_403_calls_out_api_access_and_lockout(self):
        hint = _hint_for("TestRailAPIException", 403)
        assert "403" in hint
        assert "API access" in hint
        # Lockout is mentioned in CLAUDE.md and is a very common cause we saw
        # personally — make sure the LLM hears about it.
        assert "locked" in hint.lower() or "lockout" in hint.lower()

    def test_429_recognizes_rate_limit(self):
        hint = _hint_for("TestRailRateLimitError", 429)
        assert "rate" in hint.lower() or "429" in hint

    def test_5xx_calls_it_a_server_problem(self):
        hint = _hint_for("TestRailAPIException", 503)
        assert "503" in hint
        assert "server" in hint.lower()

    def test_network_error_calls_out_url(self):
        hint = _hint_for("ConnectionError", None)
        assert "TESTRAIL_URL" in hint or "network" in hint.lower()

    def test_unknown_class_returns_safe_fallback(self):
        # Unrecognized failures should not be empty / silently misleading.
        hint = _hint_for("SomeNeverSeenError", None)
        assert hint
        assert "user" in hint.lower() or "error" in hint.lower()


# ---------------------------------------------------------------------------
# _diagnose_auth_failure — turns exceptions into the structured response
# ---------------------------------------------------------------------------

# Stand-ins for the testrail_api_module exception classes — defining real
# subclasses so the type names round-trip through `type(exc).__name__`.
class _FakeTestRailAPIException(Exception): pass
class _FakeTestRailAuthenticationError(Exception): pass
_FakeTestRailAPIException.__name__ = "TestRailAPIException"
_FakeTestRailAuthenticationError.__name__ = "TestRailAuthenticationError"


class TestDiagnoseAuthFailure:
    CONFIG_VIEW = {"url": "https://x", "username": "u", "auth_method": "password"}

    def test_extracts_status_code_from_message(self):
        exc = _FakeTestRailAPIException("403 - Forbidden | Access denied")
        result = _diagnose_auth_failure(exc, self.CONFIG_VIEW)
        assert result["status_code"] == 403
        assert result["ok"] is False
        assert "403" in result["hint"]

    def test_records_error_class_name(self):
        exc = _FakeTestRailAuthenticationError("Authentication failed")
        result = _diagnose_auth_failure(exc, self.CONFIG_VIEW)
        assert result["error_class"] == "TestRailAuthenticationError"

    def test_carries_config_view_through(self):
        # The LLM should always see what URL/username were configured, even
        # on failure, so it can tell the user whether the right account is
        # being used.
        result = _diagnose_auth_failure(Exception("boom"), self.CONFIG_VIEW)
        assert result["config"] == self.CONFIG_VIEW

    def test_no_status_code_when_message_has_none(self):
        result = _diagnose_auth_failure(
            Exception("no status here"), self.CONFIG_VIEW
        )
        assert result["status_code"] is None

    def test_does_not_extract_two_digit_or_three_digit_unrelated_numbers(self):
        # An error like "timeout after 60 seconds" should NOT be reported as
        # status 60. Status extraction is anchored on 4xx/5xx only.
        result = _diagnose_auth_failure(
            Exception("timeout after 60 seconds"), self.CONFIG_VIEW
        )
        assert result["status_code"] is None

    def test_picks_first_4xx_or_5xx_match(self):
        # If both a real status and a noisy number show up, the status should win.
        exc = Exception("upstream returned 503; backoff was 60 seconds")
        result = _diagnose_auth_failure(exc, self.CONFIG_VIEW)
        assert result["status_code"] == 503


# ---------------------------------------------------------------------------
# End-to-end through check_testrail_auth — env, client mock, hint composition
# ---------------------------------------------------------------------------

@pytest.fixture
def _env(monkeypatch):
    """Set the minimum env vars _check_env() needs so check_testrail_auth
    proceeds to the actual client call."""
    monkeypatch.setenv("TESTRAIL_URL", "https://example.testrail.io")
    monkeypatch.setenv("TESTRAIL_USERNAME", "user@example.com")
    monkeypatch.setenv("TESTRAIL_PASSWORD", "secret")
    monkeypatch.delenv("TESTRAIL_API_KEY", raising=False)


class TestCheckTestrailAuthEnd2End:
    def test_missing_env_returns_structured_error(self, monkeypatch):
        monkeypatch.delenv("TESTRAIL_URL", raising=False)
        monkeypatch.delenv("TESTRAIL_USERNAME", raising=False)
        monkeypatch.delenv("TESTRAIL_PASSWORD", raising=False)
        monkeypatch.delenv("TESTRAIL_API_KEY", raising=False)

        result = check_testrail_auth()

        assert result["ok"] is False
        assert result["error_class"] == "EnvironmentError"
        assert "TESTRAIL_" in result["hint"]
        # The config view should still report what (if anything) was set,
        # not just be missing.
        assert "config" in result

    def test_success_includes_priorities_count_and_config(self, _env, mock_client):
        mock_client.priorities.get_priorities.return_value = [
            {"id": 1, "name": "Low"},
            {"id": 2, "name": "High"},
        ]

        result = check_testrail_auth()

        assert result["ok"] is True
        assert result["priorities_count"] == 2
        assert result["config"]["url"] == "https://example.testrail.io"
        assert result["config"]["username"] == "user@example.com"
        assert result["config"]["auth_method"] == "password"

    def test_403_failure_returns_actionable_hint(self, _env, mock_client):
        # The library wraps the HTTP error in TestRailAPIException with the
        # status code stringified into the message. Simulate that.
        from testrail_api_module import TestRailAPIException
        mock_client.priorities.get_priorities.side_effect = TestRailAPIException(
            "403 - Forbidden | Access to this page is forbidden."
        )

        result = check_testrail_auth()

        assert result["ok"] is False
        assert result["status_code"] == 403
        # The hint must mention the two leading causes we hit in real life
        # so the LLM doesn't waste turns guessing.
        assert "API access" in result["hint"]
        assert "lock" in result["hint"].lower()

    def test_401_failure_returns_credentials_hint(self, _env, mock_client):
        from testrail_api_module import TestRailAuthenticationError
        mock_client.priorities.get_priorities.side_effect = (
            TestRailAuthenticationError("Authentication failed. Please check your credentials.")
        )

        result = check_testrail_auth()

        assert result["ok"] is False
        assert result["error_class"] == "TestRailAuthenticationError"
        assert "credentials" in result["hint"].lower()

    def test_response_never_includes_the_password(self, _env, mock_client):
        # Defense in depth: even if a future refactor accidentally widens
        # the config view, the password value must not leak into the
        # response — only the *method* name should be present.
        mock_client.priorities.get_priorities.return_value = []
        result = check_testrail_auth()
        # The literal secret should appear nowhere in the response.
        import json as _json
        encoded = _json.dumps(result)
        assert "secret" not in encoded.lower() or "secret" not in os.environ.get(
            "TESTRAIL_PASSWORD", ""
        )
        # And the auth_method field should be a method name, not the value.
        assert result["config"]["auth_method"] in {"api_key", "password", "none"}
