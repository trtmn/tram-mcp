import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadCredentials } from "./credstore";
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

/** Build the Env the tools read (the TESTRAIL_* credential fields) from process.env. */
export function envFromProcess(processEnv: NodeJS.ProcessEnv = process.env): Env {
  return {
    TESTRAIL_URL: processEnv.TESTRAIL_URL,
    TESTRAIL_USERNAME: processEnv.TESTRAIL_USERNAME,
    TESTRAIL_API_KEY: processEnv.TESTRAIL_API_KEY,
    TESTRAIL_PASSWORD: processEnv.TESTRAIL_PASSWORD,
  } as Env;
}

/** True when process.env supplies a complete TestRail credential set. */
function envIsComplete(e: NodeJS.ProcessEnv): boolean {
  return !!(
    e.TESTRAIL_URL &&
    e.TESTRAIL_USERNAME &&
    (e.TESTRAIL_API_KEY || e.TESTRAIL_PASSWORD)
  );
}

/**
 * Resolve local credentials with precedence: a complete process.env set wins
 * (preserving .env / op run / CI); otherwise the wizard-populated credential
 * store; otherwise an empty Env (tools return a "run `tram-mcp login`" message
 * at call time).
 */
export function resolveLocalEnv(processEnv: NodeJS.ProcessEnv = process.env): Env {
  if (envIsComplete(processEnv)) return envFromProcess(processEnv);
  const stored = loadCredentials();
  if (stored) {
    return {
      TESTRAIL_URL: stored.url,
      TESTRAIL_USERNAME: stored.username,
      TESTRAIL_API_KEY: stored.auth_method === "api_key" ? stored.secret : undefined,
      TESTRAIL_PASSWORD: stored.auth_method === "password" ? stored.secret : undefined,
    } as Env;
  }
  return envFromProcess(processEnv);
}

/** Build a fully-wired McpServer for local stdio use. */
export function buildStdioServer(env: Env = resolveLocalEnv()): McpServer {
  const server = new McpServer(
    { name: "TestRail MCP", version: VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );
  // No OAuth props locally — credentials resolve from env (process.env).
  registerTools(server, { env, props: undefined });
  return server;
}

// `main` is invoked by the CLI entry (cli.ts -> runStdioServer). This module has
// NO self-invoke guard on purpose: cli.ts is the sole executable entry, and both
// bundle into dist/cli.js. Two `import.meta.url === argv[1]` guards in one bundle
// would both fire and start two servers on the same stdio, so only cli.ts keeps one.
export async function main(): Promise<void> {
  const server = buildStdioServer(resolveLocalEnv());
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
