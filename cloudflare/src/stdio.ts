import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";

import type { Env } from "./env";
import { registerTools, SERVER_INSTRUCTIONS } from "./tools";
import { VERSION } from "./version";

/**
 * Local (non-Worker) transport adapter. The shared core — tools.ts / testrail.ts
 * / env.ts / the catalog — is transport-agnostic; this entry point wires it to a
 * stdio transport so the same code runs locally the way the Worker runs it
 * remotely. Credentials come from the environment (no OAuth grant), so it passes
 * `props: undefined` and lets env.ts resolve the TESTRAIL_* vars.
 */

/**
 * Build the subset of Env the tools actually read — only the TESTRAIL_*
 * credential fields — from process.env. The Cloudflare-only bindings
 * (MCP_OBJECT, OAUTH_KV, OAUTH_PROVIDER) are never touched on the local
 * credential path, so a partial object cast to Env is safe here.
 */
export function envFromProcess(processEnv: NodeJS.ProcessEnv = process.env): Env {
  return {
    TESTRAIL_URL: processEnv.TESTRAIL_URL,
    TESTRAIL_USERNAME: processEnv.TESTRAIL_USERNAME,
    TESTRAIL_API_KEY: processEnv.TESTRAIL_API_KEY,
    TESTRAIL_PASSWORD: processEnv.TESTRAIL_PASSWORD,
  } as Env;
}

/** Build a fully-wired McpServer for local stdio use. */
export function buildStdioServer(env: Env = envFromProcess()): McpServer {
  const server = new McpServer(
    { name: "TestRail MCP", version: VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );
  // No OAuth props locally — credentials resolve from env (process.env).
  registerTools(server, { env, props: undefined });
  return server;
}

export async function main(): Promise<void> {
  const server = buildStdioServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Run only when executed directly (node dist/stdio.js), not when imported by
// tests. import.meta.url is the module's own URL; argv[1] is the launched file.
const invokedDirectly =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
