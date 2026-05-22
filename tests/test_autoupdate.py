from __future__ import annotations

import time
from unittest.mock import patch

from tram_mcp import _autoupdate


def test_opt_out_skips(monkeypatch, tmp_path):
    monkeypatch.setenv("TRAM_MCP_NO_AUTO_UPDATE", "1")
    monkeypatch.setattr(_autoupdate, "_marker_path", lambda: tmp_path / "marker")
    with patch.object(_autoupdate.subprocess, "Popen") as popen:
        _autoupdate.spawn_background_upgrade()
    popen.assert_not_called()


def test_skip_when_not_uv_tool_install(monkeypatch, tmp_path):
    monkeypatch.delenv("TRAM_MCP_NO_AUTO_UPDATE", raising=False)
    monkeypatch.setattr(_autoupdate, "_looks_like_uv_tool_install", lambda: False)
    monkeypatch.setattr(_autoupdate, "_marker_path", lambda: tmp_path / "marker")
    with patch.object(_autoupdate.subprocess, "Popen") as popen:
        _autoupdate.spawn_background_upgrade()
    popen.assert_not_called()


def test_recently_checked_skips(monkeypatch, tmp_path):
    monkeypatch.delenv("TRAM_MCP_NO_AUTO_UPDATE", raising=False)
    monkeypatch.setattr(_autoupdate, "_looks_like_uv_tool_install", lambda: True)
    marker = tmp_path / "marker"
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.touch()
    monkeypatch.setattr(_autoupdate, "_marker_path", lambda: marker)
    with patch.object(_autoupdate.subprocess, "Popen") as popen:
        _autoupdate.spawn_background_upgrade()
    popen.assert_not_called()


def test_spawns_when_stale(monkeypatch, tmp_path):
    monkeypatch.delenv("TRAM_MCP_NO_AUTO_UPDATE", raising=False)
    monkeypatch.setattr(_autoupdate, "_looks_like_uv_tool_install", lambda: True)
    marker = tmp_path / "marker"
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.touch()
    stale = time.time() - (_autoupdate.CHECK_INTERVAL_SECONDS + 60)
    import os
    os.utime(marker, (stale, stale))
    monkeypatch.setattr(_autoupdate, "_marker_path", lambda: marker)
    with patch.object(_autoupdate.subprocess, "Popen") as popen:
        _autoupdate.spawn_background_upgrade()
    popen.assert_called_once()
    args, _ = popen.call_args
    assert args[0][:3] == ["uv", "tool", "upgrade"]


def test_popen_oserror_swallowed(monkeypatch, tmp_path):
    monkeypatch.delenv("TRAM_MCP_NO_AUTO_UPDATE", raising=False)
    monkeypatch.setattr(_autoupdate, "_looks_like_uv_tool_install", lambda: True)
    monkeypatch.setattr(_autoupdate, "_marker_path", lambda: tmp_path / "marker")

    def _raise(*a, **kw):
        raise OSError("no uv on PATH")

    with patch.object(_autoupdate.subprocess, "Popen", side_effect=_raise):
        _autoupdate.spawn_background_upgrade()
