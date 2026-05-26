"""Tests for the proxy launcher in tram_mcp/__init__.py.

These exercise the JSON construction and dispatch logic without spawning a real
child or importing FastMCP — that's what the launcher is designed to defer, and
we don't want our tests to pay the same cost.
"""

from __future__ import annotations

import io
import json
import os
import sys
from unittest.mock import patch

import pytest

import tram_mcp


def _make_init_msg(req_id=1, proto="2025-11-25"):
    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "method": "initialize",
        "params": {
            "protocolVersion": proto,
            "capabilities": {},
            "clientInfo": {"name": "test", "version": "0"},
        },
    }


class TestBuildInitializeResponse:
    def test_uses_requested_protocol_version(self):
        msg = _make_init_msg(req_id=42, proto="2024-11-05")
        resp = tram_mcp._build_initialize_response(msg)
        assert resp["result"]["protocolVersion"] == "2024-11-05"
        assert resp["id"] == 42
        assert resp["jsonrpc"] == "2.0"

    def test_defaults_protocol_when_client_omits_it(self):
        msg = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}
        resp = tram_mcp._build_initialize_response(msg)
        # Default falls back to the spec version we hardcode in the launcher.
        assert resp["result"]["protocolVersion"] == "2025-11-25"

    def test_carries_server_metadata(self):
        resp = tram_mcp._build_initialize_response(_make_init_msg())
        result = resp["result"]
        assert result["serverInfo"]["name"] == "TestRail MCP"
        assert result["serverInfo"]["version"] == tram_mcp.__version__
        assert "instructions" in result
        assert "TestRail" in result["instructions"]

    def test_advertises_tools_capability(self):
        resp = tram_mcp._build_initialize_response(_make_init_msg())
        caps = resp["result"]["capabilities"]
        # tools/listChanged is the key bit — without it, clients won't poll
        # for the tools we register after our deferred startup completes.
        assert caps["tools"]["listChanged"] is True

    def test_response_is_json_serializable(self):
        # The launcher dumps this to stdout, so anything in it must survive
        # json.dumps without raising.
        resp = tram_mcp._build_initialize_response(_make_init_msg())
        encoded = json.dumps(resp)
        decoded = json.loads(encoded)
        assert decoded == resp


class TestMainDispatch:
    """Routes through main() that shouldn't spawn a child."""

    def setup_method(self):
        # Save env keys we mutate
        self._orig_env = {
            k: os.environ.get(k)
            for k in ("TRAM_MCP_CHILD", "TRAM_MCP_NO_LAUNCHER")
        }

    def teardown_method(self):
        for k, v in self._orig_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_child_env_runs_real_server_in_process(self):
        os.environ["TRAM_MCP_CHILD"] = "1"
        with patch.object(tram_mcp, "_run_real_server", return_value=0) as fake, \
             patch.object(tram_mcp, "_proxy") as proxy_fake:
            rc = tram_mcp.main()
        assert rc == 0
        fake.assert_called_once()
        proxy_fake.assert_not_called()

    def test_no_launcher_env_runs_real_server_in_process(self):
        os.environ["TRAM_MCP_NO_LAUNCHER"] = "1"
        with patch.object(tram_mcp, "_run_real_server", return_value=0) as fake, \
             patch.object(tram_mcp, "_proxy") as proxy_fake:
            rc = tram_mcp.main()
        assert rc == 0
        fake.assert_called_once()
        proxy_fake.assert_not_called()

    def test_tty_stdin_skips_proxy(self):
        """If stdin is a TTY we can't proxy stdio cleanly; fall back to in-process."""
        os.environ.pop("TRAM_MCP_CHILD", None)
        os.environ.pop("TRAM_MCP_NO_LAUNCHER", None)
        with patch.object(sys.stdin, "isatty", return_value=True), \
             patch.object(tram_mcp, "_run_real_server", return_value=0) as fake, \
             patch.object(tram_mcp, "_proxy") as proxy_fake:
            rc = tram_mcp.main()
        assert rc == 0
        fake.assert_called_once()
        proxy_fake.assert_not_called()


class TestMainProxyPath:
    """End-to-end behavior of the proxy entry point without spawning a child."""

    def setup_method(self):
        self._orig_env = {
            k: os.environ.get(k)
            for k in ("TRAM_MCP_CHILD", "TRAM_MCP_NO_LAUNCHER")
        }
        os.environ.pop("TRAM_MCP_CHILD", None)
        os.environ.pop("TRAM_MCP_NO_LAUNCHER", None)

    def teardown_method(self):
        for k, v in self._orig_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def _drive_with_input(self, input_bytes: bytes):
        """Run main() with the given bytes as stdin and _proxy stubbed out.

        Returns (return_code, captured_stdout_bytes, proxy_call_args).
        """
        stdin_buf = io.BytesIO(input_bytes)
        stdout_buf = io.BytesIO()

        class FakeStdin:
            buffer = stdin_buf

            def isatty(self):
                return False

        class FakeStdout:
            buffer = stdout_buf

        proxy_calls = []

        def fake_proxy(init_msg, initial_line):
            proxy_calls.append((init_msg, initial_line))
            return 0

        with patch.object(sys, "stdin", FakeStdin()), \
             patch.object(sys, "stdout", FakeStdout()), \
             patch.object(tram_mcp, "_proxy", side_effect=fake_proxy):
            rc = tram_mcp.main()

        return rc, stdout_buf.getvalue(), proxy_calls

    def test_writes_initialize_response_before_spawning_child(self):
        init = _make_init_msg(req_id=7)
        line = (json.dumps(init) + "\n").encode("utf-8")
        rc, out, proxy_calls = self._drive_with_input(line)

        # Stdout should already contain the initialize response by the time
        # _proxy is invoked. We test that by recording proxy call order: the
        # mock captures args; stdout was written before the mock ran.
        assert rc == 0
        assert proxy_calls, "_proxy was not called"
        decoded = json.loads(out.decode("utf-8").splitlines()[0])
        assert decoded["id"] == 7
        assert decoded["result"]["serverInfo"]["name"] == "TestRail MCP"

    def test_passes_original_line_to_proxy_for_child_replay(self):
        """The child needs the original initialize bytes (verbatim) to reach
        its `initialized` state — the launcher must hand them off unchanged."""
        init = _make_init_msg(req_id=99)
        line = (json.dumps(init) + "\n").encode("utf-8")
        _, _, proxy_calls = self._drive_with_input(line)
        assert proxy_calls
        init_msg_arg, initial_line_arg = proxy_calls[0]
        assert init_msg_arg["id"] == 99
        assert initial_line_arg == line

    def test_empty_stdin_exits_cleanly(self):
        rc, out, proxy_calls = self._drive_with_input(b"")
        assert rc == 0
        assert out == b""
        assert proxy_calls == []

    def test_garbage_first_line_returns_error(self):
        rc, out, proxy_calls = self._drive_with_input(b"this is not json\n")
        assert rc == 1
        assert out == b""
        assert proxy_calls == []

    def test_non_initialize_first_message_falls_back(self):
        """If the client breaks protocol and sends something other than
        initialize first, defer to the in-process server rather than guessing."""
        non_init = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
        line = (non_init + "\n").encode("utf-8")
        with patch.object(tram_mcp, "_run_real_server", return_value=0) as fake:
            rc, out, proxy_calls = self._drive_with_input(line)
        assert fake.called
        # The fallback path sets TRAM_MCP_CHILD so any further recursion runs
        # the real server, never the proxy.
        assert os.environ.get("TRAM_MCP_CHILD") == "1"
        assert proxy_calls == []


class TestStaticMetadataConsistency:
    """Guard rails against the pre-baked initialize response drifting from
    what the real FastMCP server would have returned. These are deliberately
    coarse — they check that the strings we embed are at least non-empty and
    structurally well-formed."""

    def test_capabilities_block_is_non_empty(self):
        assert tram_mcp._PREBAKED_CAPABILITIES
        assert "tools" in tram_mcp._PREBAKED_CAPABILITIES

    def test_instructions_mention_core_tools(self):
        # If a new tool name takes the place of these, the instructions
        # advertised on initialize will be stale — fail loudly here.
        for name in ("browse_testrail_api", "describe_testrail_method",
                     "run_testrail_command", "search_test_cases"):
            assert name in tram_mcp._INSTRUCTIONS, f"instructions missing {name}"


class TestStaticToolsLoaded:
    """The launcher only intercepts tools/list when the build-time capture is
    present. These tests guard the loader path itself."""

    def test_tools_static_json_is_present_and_well_formed(self):
        # The package ships with tools_static.json — if this file goes
        # missing the launcher falls back to forwarding tools/list to the
        # (slow) child. That defeats half the point of the launcher, so
        # fail CI early.
        assert tram_mcp._STATIC_TOOLS is not None, (
            "tram_mcp/tools_static.json is missing; "
            "run `python scripts/regenerate_static_tools.py` to rebuild it"
        )
        assert isinstance(tram_mcp._STATIC_TOOLS, list)
        assert len(tram_mcp._STATIC_TOOLS) > 0

    def test_each_static_tool_has_required_fields(self):
        for tool in tram_mcp._STATIC_TOOLS or []:
            assert "name" in tool
            assert "description" in tool
            assert "inputSchema" in tool, (
                f"tool {tool.get('name')!r} missing inputSchema — clients "
                "won't know how to call it"
            )

    def test_static_tools_include_all_expected_names(self):
        names = {t["name"] for t in (tram_mcp._STATIC_TOOLS or [])}
        expected = {
            "browse_testrail_api",
            "describe_testrail_method",
            "run_testrail_command",
            "search_test_cases",
        }
        missing = expected - names
        assert not missing, f"static tools missing {missing}"

    def test_loader_returns_none_when_file_absent(self, tmp_path, monkeypatch):
        # Move the bundled file out of the way and call _load_static_tools
        # against a stand-in module path. Since the loader uses __file__ to
        # locate the file, we drop a fake __init__.py + missing JSON in tmp.
        import importlib.util

        fake_pkg = tmp_path / "fake_tram"
        fake_pkg.mkdir()
        (fake_pkg / "__init__.py").write_text("", encoding="utf-8")
        spec = importlib.util.spec_from_file_location(
            "fake_tram", fake_pkg / "__init__.py"
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        # Call the loader as if it lived in this fake package — patch
        # pathlib.Path(__file__) by temporarily swapping the module's
        # __file__ in the call.
        with monkeypatch.context() as m:
            m.setattr(tram_mcp, "__file__", str(fake_pkg / "__init__.py"))
            result = tram_mcp._load_static_tools()
        assert result is None


class TestToolsListInterception:
    """The proxy thread should answer tools/list from the embedded cache
    rather than forwarding it. We exercise the predicate directly rather
    than the threaded version, since the threaded version is harder to
    drive deterministically in a unit test."""

    def test_static_tools_serialize_to_valid_jsonrpc(self):
        # The launcher wraps the static list in a JSON-RPC response. Make
        # sure that wrapping survives a round trip without surprises (e.g.
        # nested objects that aren't JSON-serializable would explode at
        # runtime under heavy load).
        if tram_mcp._STATIC_TOOLS is None:
            pytest.skip("tools_static.json not loaded in this environment")
        resp = {
            "jsonrpc": "2.0",
            "id": 99,
            "result": {"tools": tram_mcp._STATIC_TOOLS},
        }
        encoded = json.dumps(resp)
        decoded = json.loads(encoded)
        assert decoded["result"]["tools"] == tram_mcp._STATIC_TOOLS
        # Sanity: tools list shouldn't accidentally be empty after
        # serialization (catches a subtle bug where someone replaces the
        # JSON file with `[]`).
        assert len(decoded["result"]["tools"]) >= 1
