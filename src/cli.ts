import { clearCredentials } from "./credstore";
import { configView } from "./env";
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
  tram-mcp            Run the TestRail MCP server over stdio (default; launched by your MCP client)
  tram-mcp login      Open a browser to enter and save your TestRail credentials
  tram-mcp logout     Remove saved credentials
  tram-mcp status     Show the active (non-secret) configuration
  tram-mcp --help     Show this help`;

/**
 * Handle a subcommand. Returns "server" when the caller should start the stdio
 * server (the no-subcommand case), otherwise a process exit code.
 */
export async function dispatch(argv: string[]): Promise<number | "server"> {
  const cmd = argv[0];
  switch (cmd) {
    case undefined:
      return "server";
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
