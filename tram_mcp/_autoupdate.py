"""Best-effort background self-upgrade via `uv tool upgrade`.

Runs as a detached subprocess at server startup so it never blocks the MCP
handshake. Debounced via a marker file. Silently no-ops when not installed
via `uv tool`, when `uv` isn't on PATH, or when the user opts out with
`TRAM_MCP_NO_AUTO_UPDATE=1`.
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path


CHECK_INTERVAL_SECONDS = 24 * 60 * 60


def _looks_like_uv_tool_install() -> bool:
    prefix = Path(sys.prefix).resolve()
    parts = [p.lower() for p in prefix.parts]
    if "uv" not in parts or "tools" not in parts:
        return False
    return parts.index("uv") < parts.index("tools")


def _marker_path() -> Path:
    base = os.environ.get("XDG_CACHE_HOME")
    if base:
        return Path(base) / "tram-mcp" / "last-upgrade-check"
    if sys.platform == "win32":
        local = os.environ.get("LOCALAPPDATA")
        if local:
            return Path(local) / "tram-mcp" / "last-upgrade-check"
    return Path.home() / ".cache" / "tram-mcp" / "last-upgrade-check"


def _recently_checked(marker: Path) -> bool:
    try:
        age = time.time() - marker.stat().st_mtime
    except OSError:
        return False
    return age < CHECK_INTERVAL_SECONDS


def _touch(marker: Path) -> None:
    try:
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.touch()
    except OSError:
        pass


def spawn_background_upgrade() -> None:
    """Fire and forget. Returns immediately, never raises."""
    if os.environ.get("TRAM_MCP_NO_AUTO_UPDATE") == "1":
        return
    if not _looks_like_uv_tool_install():
        return

    marker = _marker_path()
    if _recently_checked(marker):
        return
    _touch(marker)

    popen_kwargs: dict = {
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
    }
    if sys.platform == "win32":
        DETACHED_PROCESS = 0x00000008
        CREATE_NO_WINDOW = 0x08000000
        popen_kwargs["creationflags"] = DETACHED_PROCESS | CREATE_NO_WINDOW
    else:
        popen_kwargs["start_new_session"] = True

    try:
        subprocess.Popen(
            ["uv", "tool", "upgrade", "tram-mcp", "--quiet"],
            **popen_kwargs,
        )
    except (OSError, ValueError):
        pass
