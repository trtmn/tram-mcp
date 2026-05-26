"""Regenerate tram_mcp/tools_static.json from FastMCP's live tools/list output.

Run this whenever a tool's name, description, or argument schema changes (or
when fastmcp's own representation of any of those changes). The launcher
serves tools_static.json verbatim during the window where the FastMCP child
process is still importing, so it must agree with what the real server would
have returned — otherwise tool *calls* will succeed but the displayed schema
will be wrong.

The companion check in tests/test_launcher.py compares the captured response
against this file and fails CI if they have drifted.

Usage::

    uv run python scripts/regenerate_static_tools.py
"""

from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys


def _capture_tools() -> list[dict]:
    """Speak MCP stdio to an in-process tram-mcp child, return its tools/list."""
    # Run via the project venv's Python module entry, NOT the installed
    # tram-mcp shim — that way we capture whatever's in the working tree, not
    # whatever happens to be on PATH.
    cmd = [sys.executable, "-m", "tram_mcp"]
    env = os.environ.copy()
    env.update({
        # Bypass the proxy launcher; we want to talk to the real server directly.
        "TRAM_MCP_NO_LAUNCHER": "1",
        # Suppress the background auto-upgrade subprocess.
        "TRAM_MCP_NO_AUTO_UPDATE": "1",
        # Dummy creds so the server starts up without complaining about env.
        "TESTRAIL_URL": "https://example.testrail.io",
        "TESTRAIL_USERNAME": "regenerate@example.com",
        "TESTRAIL_PASSWORD": "regenerate-dummy",
    })

    p = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        env=env,
        bufsize=0,
    )
    try:
        init = {
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {
                "protocolVersion": "2025-11-25",
                "capabilities": {},
                "clientInfo": {"name": "regenerate-static-tools", "version": "0"},
            },
        }
        p.stdin.write((json.dumps(init) + "\n").encode("utf-8"))
        p.stdin.flush()
        _ = p.stdout.readline()  # discard initialize response

        p.stdin.write((json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n").encode("utf-8"))
        p.stdin.write((json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}) + "\n").encode("utf-8"))
        p.stdin.flush()

        line = p.stdout.readline()
        if not line:
            raise RuntimeError("tram-mcp closed stdout before answering tools/list")
        resp = json.loads(line)
        return resp["result"]["tools"]
    finally:
        try:
            p.stdin.close()
        except OSError:
            pass
        try:
            p.wait(timeout=5)
        except subprocess.TimeoutExpired:
            p.terminate()


def main() -> int:
    repo_root = pathlib.Path(__file__).resolve().parent.parent
    target = repo_root / "tram_mcp" / "tools_static.json"

    tools = _capture_tools()
    new_content = json.dumps(tools, indent=2) + "\n"

    if target.exists() and target.read_text(encoding="utf-8") == new_content:
        print(f"{target.relative_to(repo_root)} is already up to date ({len(tools)} tools)")
        return 0

    target.write_text(new_content, encoding="utf-8")
    print(f"Wrote {target.relative_to(repo_root)} ({len(tools)} tools)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
