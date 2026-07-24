import { clearCredentials } from "./credstore";
import { configView } from "./env";
import { startHttpServer } from "./http";
import { main as runStdioServer, resolveLocalEnv } from "./stdio";
import { VERSION } from "./version";
import { runWizard } from "./wizard";

/**
 * CLI logic for the local package. With no subcommand it runs the stdio MCP
 * server (what the MCP client spawns); the subcommands manage credentials.
 *
 * This module is deliberately side-effect-free — it never runs the CLI on
 * import. The executable entry is bin.ts, which calls runCli() unconditionally.
 * Keeping the two separate avoids the fragile "am I the entry point?" path
 * comparison that used to silently no-op on Windows.
 */

const USAGE = `tram-mcp v${VERSION}
Usage:
  tram-mcp                     Run the TestRail MCP server over stdio (default; launched by your MCP client)
  tram-mcp serve [--port N]    Run a local HTTP MCP server on 127.0.0.1 (default port 8787)
  tram-mcp login               Open a browser to enter and save your TestRail credentials
  tram-mcp logout              Remove saved credentials
  tram-mcp status              Show the active (non-secret) configuration
  tram-mcp --help              Show this help

HTTP mode binds loopback only. Set TRAM_MCP_HTTP_TOKEN to require an
Authorization: Bearer <token> header on every request (recommended).`;

/** Parse `serve` flags: --port/-p N and --host H (also --port=N / --host=H). */
export function parseServeFlags(argv: string[]): { port?: number; host?: string } {
  const out: { port?: number; host?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port" || a === "-p") out.port = Number(argv[++i]);
    else if (a === "--host") out.host = argv[++i];
    else if (a.startsWith("--port=")) out.port = Number(a.slice("--port=".length));
    else if (a.startsWith("--host=")) out.host = a.slice("--host=".length);
  }
  return out;
}

/**
 * Handle a subcommand. Returns "server" when the caller should start the stdio
 * server (the no-subcommand case), otherwise a process exit code.
 */
export async function dispatch(argv: string[]): Promise<number | "server"> {
  const cmd = argv[0];
  switch (cmd) {
    case undefined:
      return "server";
    case "serve": {
      const { port, host } = parseServeFlags(argv.slice(1));
      const token = process.env.TRAM_MCP_HTTP_TOKEN;
      const { url } = await startHttpServer({ port: port ?? 8787, host, token });
      console.error(`TestRail MCP HTTP server listening on ${url}`);
      console.error(
        token
          ? "Auth: send `Authorization: Bearer <TRAM_MCP_HTTP_TOKEN>` on every request."
          : "Auth: none — set TRAM_MCP_HTTP_TOKEN to require a bearer token (recommended).",
      );
      console.error(`Add to Claude Code:  claude mcp add --transport http tram-mcp ${url}`);
      // Run until the process is killed; the HTTP server owns the event loop.
      await new Promise<never>(() => {});
      return 0; // unreachable
    }
    case "login":
      await runWizard();
      return 0;
    case "logout":
      clearCredentials();
      console.log("Removed saved TestRail credentials.");
      return 0;
    case "status": {
      const view = configView(resolveLocalEnv(), undefined);
      console.log(JSON.stringify(view, null, 2));
      return 0;
    }
    case "-h":
    case "--help":
      console.log(USAGE);
      return 0;
    default:
      console.error(`Unknown command: ${cmd}\n\n${USAGE}`);
      return 2;
  }
}

export async function runCli(argv: string[]): Promise<void> {
  const result = await dispatch(argv);
  if (result === "server") {
    await runStdioServer();
    return;
  }
  process.exitCode = result;
}
