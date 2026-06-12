import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ConnectionProps, Env } from "./env";
import { registerTools, SERVER_INSTRUCTIONS } from "./tools";
import { VERSION } from "./version";

export { VERSION };

// Header-only model: credentials come solely from per-request X-TestRail-*
// headers (or Worker env). Nothing is persisted — no Durable Object state, no
// KV — so Cloudflare stores no credentials at rest.
type State = Record<string, never>;

export class TestRailMCP extends McpAgent<Env, State, ConnectionProps> {
  initialState: State = {};

  server = new McpServer(
    { name: "TestRail MCP", version: VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  async init(): Promise<void> {
    registerTools(this.server, { env: this.env, props: this.props });
  }
}
