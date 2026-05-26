"""tram-mcp launcher.

The launcher's job is to keep Claude Desktop's MCP handshake fast even when
loading the underlying FastMCP server is slow (e.g. when corporate EDR tooling
rescans every .pyc file on each Python process spawn). It splits the work
into two phases:

  Phase 1 (parent / proxy):
    - Pre-bake the static parts of an MCP `initialize` response and ship it
      back to the client as soon as the request arrives. No heavy imports.
    - Spawn a child process (this same module, with `TRAM_MCP_CHILD=1`) which
      loads FastMCP and runs the real server.
    - Forward all subsequent stdio traffic between client and child.

  Phase 2 (child / real server):
    - `TRAM_MCP_CHILD=1` short-circuits the proxy path. The child imports
      FastMCP, builds the tool catalog, then runs `mcp.run()` as before.
    - The parent forwards the original `initialize` to the child first so
      FastMCP reaches its `initialized` state internally; the child's own
      initialize response is then drained and discarded (the parent already
      sent one to the client).

Pre-baked response correctness: the `capabilities`, `serverInfo`, and
`instructions` returned by Phase 1 must match what FastMCP would have
returned. They are kept in this file deliberately so a change to the real
server forces a touch here.

Set `TRAM_MCP_NO_LAUNCHER=1` to disable the proxy entirely and run the legacy
single-process path. Useful for debugging.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
from importlib.metadata import version as _pkg_version

try:
    __version__ = _pkg_version("tram-mcp")
except Exception:
    __version__ = "unknown"


_INSTRUCTIONS = (
    "Use this server when the user mentions TestRail, Test Rail, "
    "test cases, test runs, test results, test steps, test plans, "
    "test suites, test milestones, test configurations, QA, "
    "quality assurance, test management, or test reporting. "
    "Start with browse_testrail_api to discover available categories, "
    "then describe_testrail_method to learn how to call a specific method, "
    "then run_testrail_command to execute it. "
    "Use search_test_cases for quick title-based case lookups."
)

_PREBAKED_CAPABILITIES = {
    "experimental": {},
    "logging": {},
    "prompts": {"listChanged": False},
    "resources": {"subscribe": False, "listChanged": False},
    "tools": {"listChanged": True},
    "extensions": {"io.modelcontextprotocol/ui": {}},
}


def _log(msg: str) -> None:
    print(f"[tram-mcp launcher v{__version__}] {msg}", file=sys.stderr, flush=True)


def _run_real_server() -> int:
    """In-process FastMCP server. Used by the child (TRAM_MCP_CHILD=1) and
    by the no-launcher fallback path."""
    from tram_mcp._autoupdate import spawn_background_upgrade
    from tram_mcp.server import mcp

    print(f"[tram-mcp] starting v{__version__}", file=sys.stderr, flush=True)
    spawn_background_upgrade()
    mcp.run(log_level="WARNING")
    return 0


def _build_initialize_response(init_msg: dict) -> dict:
    requested_proto = init_msg.get("params", {}).get("protocolVersion", "2025-11-25")
    return {
        "jsonrpc": "2.0",
        "id": init_msg.get("id"),
        "result": {
            "protocolVersion": requested_proto,
            "capabilities": _PREBAKED_CAPABILITIES,
            "serverInfo": {"name": "TestRail MCP", "version": __version__},
            "instructions": _INSTRUCTIONS,
        },
    }


def _proxy(initial_msg: dict, initial_line: bytes) -> int:
    """Spawn the real server and forward stdio between client and child.

    `initial_msg` is the already-parsed `initialize` request; `initial_line`
    is the exact bytes we read from stdin (sent to the child verbatim so its
    own JSON parser stays happy).
    """
    env = os.environ.copy()
    env["TRAM_MCP_CHILD"] = "1"

    # Use the same Python interpreter so we stay inside the installed venv.
    child = subprocess.Popen(
        [sys.executable, "-m", "tram_mcp"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=None,  # inherit parent's stderr so child logs surface in Claude Desktop's log
        env=env,
        bufsize=0,
    )

    # Drive the child to its `initialized` state by replaying our original
    # `initialize` request to it. Discard its response — we've already sent
    # ours to the client.
    try:
        child.stdin.write(initial_line if initial_line.endswith(b"\n") else initial_line + b"\n")
        child.stdin.flush()
    except (BrokenPipeError, OSError) as e:
        _log(f"child died before init handoff: {e}")
        return 1

    # Drain child's initialize response. Read line by line until we see the
    # response for our init id (anything else printed before that is noise we
    # also want to swallow).
    init_id = initial_msg.get("id")
    while True:
        line = child.stdout.readline()
        if not line:
            _log("child closed stdout before sending initialize response")
            return child.wait()
        try:
            resp = json.loads(line)
        except json.JSONDecodeError:
            continue
        if resp.get("id") == init_id and "result" in resp:
            break

    # Now forward Client <-> Child in both directions.
    def client_to_child() -> None:
        try:
            while True:
                data = sys.stdin.buffer.readline()
                if not data:
                    break
                child.stdin.write(data)
                child.stdin.flush()
        except (BrokenPipeError, OSError):
            pass
        finally:
            try:
                child.stdin.close()
            except OSError:
                pass

    def child_to_client() -> None:
        try:
            while True:
                data = child.stdout.readline()
                if not data:
                    break
                sys.stdout.buffer.write(data)
                sys.stdout.buffer.flush()
        except (BrokenPipeError, OSError):
            pass

    t_in = threading.Thread(target=client_to_child, daemon=True)
    t_out = threading.Thread(target=child_to_client, daemon=True)
    t_in.start()
    t_out.start()

    return child.wait()


def main() -> int:
    # Escape hatches: the child (re-invoked via `python -m tram_mcp` with
    # TRAM_MCP_CHILD=1) and the explicit single-process opt-out both run the
    # real server in-process. Same for environments where stdio can't be
    # cleanly proxied (e.g. when stdin isn't a pipe).
    if os.environ.get("TRAM_MCP_CHILD") == "1" or os.environ.get("TRAM_MCP_NO_LAUNCHER") == "1":
        return _run_real_server()
    if not sys.stdin or sys.stdin.isatty():
        return _run_real_server()

    # Phase 1: read the first message. It MUST be an `initialize` request per
    # the MCP spec; if it isn't, we bail out rather than guess.
    initial_line = sys.stdin.buffer.readline()
    if not initial_line:
        return 0
    try:
        init_msg = json.loads(initial_line)
    except json.JSONDecodeError as e:
        _log(f"first message wasn't valid JSON ({e}); cannot proxy")
        return 1

    if init_msg.get("method") != "initialize":
        _log(f"first message method was {init_msg.get('method')!r}, not 'initialize'; falling back to in-process server")
        # Best-effort: hand the message to the real server. We can't put bytes
        # back on stdin, but we can stash them and let _run_real_server handle
        # them via a pre-fed input. Simplest fallback: write them and run.
        # (Not expected in practice with conforming clients.)
        os.environ["TRAM_MCP_CHILD"] = "1"
        return _run_real_server()

    # Phase 1 response: respond to initialize before loading FastMCP.
    response = _build_initialize_response(init_msg)
    sys.stdout.buffer.write((json.dumps(response) + "\n").encode("utf-8"))
    sys.stdout.buffer.flush()

    # Phase 2: spawn child + forward all further traffic.
    return _proxy(init_msg, initial_line)
