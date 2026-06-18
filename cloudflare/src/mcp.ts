import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ConnectionProps, Env } from "./env";
import { registerTools, SERVER_INSTRUCTIONS } from "./tools";
import { VERSION } from "./version";

export { VERSION };

// No per-agent Durable Object state. TestRail credentials arrive as the OAuth
// grant props (this.props), set by the /authorize handler; the OAuth provider
// persists them in OAUTH_KV encrypted with the access token, so Cloudflare
// holds no decryption key.
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
