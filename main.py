#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Self-bootstrapping launcher for the tram-mcp Desktop Extension (.mcpb).

The MCPB bundle's `mcp_config` invokes this script via
`uv run --script ${__dirname}/main.py`. The script's only job is to
locate or install the real `tram-mcp` binary and exec into it, so the
bundle works whether or not the user has run `uv tool install tram-mcp`
beforehand.

Flow:
  1. If `tram-mcp` is on PATH, run it directly (fast path).
  2. Else, look in `uv tool dir`/tram-mcp/{bin,Scripts} — uv tool installs
     can land there before PATH is refreshed.
  3. Else, attempt `uv tool install --quiet tram-mcp` (with retries —
     Windows Defender / OneDrive can race the uv cache and surface a
     transient `Access is denied` on a different wheel each launch).
  4. After install, retry steps 1 and 2.
  5. If still missing, print a clear error to stderr and exit 1.

stderr is treated as the user-visible log channel; stdin/stdout are
reserved for MCP protocol once the real binary takes over.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path


LAUNCHER_VERSION = "0.6.0"  # x-release-please-version
INSTALL_RETRY_DELAYS = (0, 2, 4, 8)  # seconds; first attempt is immediate
INSTALL_TIMEOUT = 180  # seconds per attempt


def _log(message: str) -> None:
    print(f"[tram-mcp launcher v{LAUNCHER_VERSION}] {message}", file=sys.stderr, flush=True)


def _which_tram_mcp() -> str | None:
    """First check PATH, then uv tool's bin dir (which lags PATH on fresh installs)."""
    binary = shutil.which("tram-mcp")
    if binary:
        return binary

    uv = shutil.which("uv")
    if not uv:
        return None
    try:
        result = subprocess.run(
            [uv, "tool", "dir"],
            check=True,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        return None

    tools_dir = Path(result.stdout.strip())
    candidates = [
        tools_dir / "tram-mcp" / "bin" / "tram-mcp",
        tools_dir / "tram-mcp" / "Scripts" / "tram-mcp.exe",
        tools_dir / "tram-mcp" / "Scripts" / "tram-mcp",
    ]
    for path in candidates:
        if path.is_file() and os.access(path, os.X_OK):
            return str(path)
    return None


def _install_tram_mcp(uv: str) -> bool:
    """Best-effort `uv tool install tram-mcp` with retries for the Windows AV race."""
    for attempt, delay in enumerate(INSTALL_RETRY_DELAYS, start=1):
        if delay:
            time.sleep(delay)
        try:
            subprocess.run(
                [uv, "tool", "install", "--quiet", "tram-mcp"],
                check=True,
                stdin=subprocess.DEVNULL,
                stdout=sys.stderr,
                stderr=sys.stderr,
                timeout=INSTALL_TIMEOUT,
            )
            return True
        except subprocess.CalledProcessError as e:
            _log(
                f"`uv tool install tram-mcp` attempt {attempt} failed "
                f"(exit {e.returncode}); will retry."
            )
        except subprocess.TimeoutExpired:
            _log(
                f"`uv tool install tram-mcp` attempt {attempt} timed out "
                f"after {INSTALL_TIMEOUT}s; will retry."
            )
        except OSError as e:
            _log(f"could not spawn uv ({e}); aborting install.")
            return False
    return False


def _spawn_and_wait(*argv: str) -> int:
    """Run *argv* with stdio passed through; return its exit code.

    We use subprocess.run (not os.execvp) because on Windows execvp is
    implemented as spawn-then-exit, which can confuse the MCP client
    parent process — it may see the launcher die and try to restart.
    """
    result = subprocess.run(
        list(argv),
        stdin=sys.stdin,
        stdout=sys.stdout,
        stderr=sys.stderr,
    )
    return result.returncode


def main() -> int:
    binary = _which_tram_mcp()
    if binary:
        _log(f"using existing install at {binary}")
        return _spawn_and_wait(binary)

    uv = shutil.which("uv")
    if not uv:
        _log(
            "tram-mcp is not on PATH and `uv` is not available to install it.\n"
            "Install uv from https://docs.astral.sh/uv/ and try again, or run\n"
            "`uv tool install tram-mcp` manually."
        )
        return 1

    _log("tram-mcp not found; running `uv tool install tram-mcp` (one-time setup)...")
    if not _install_tram_mcp(uv):
        _log(
            "could not install tram-mcp. Run `uv tool install tram-mcp` "
            "manually for diagnostics."
        )
        return 1

    binary = _which_tram_mcp()
    if binary:
        _log(f"installed; using {binary}")
        return _spawn_and_wait(binary)

    _log("tram-mcp install reported success but binary is still missing; aborting.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
