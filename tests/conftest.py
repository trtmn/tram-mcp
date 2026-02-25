from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

import testrail_mcp.server as server


@pytest.fixture(autouse=True)
def _reset_client():
    """Reset the global _client before and after every test."""
    server._client = None
    yield
    server._client = None


@pytest.fixture
def mock_client():
    """Provide a MagicMock wired into server._client with chained attr access."""
    client = MagicMock()
    server._client = client
    return client
