import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";

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

export async function main(): Promise<void> {
  const server = buildStdioServer(resolveLocalEnv());
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
