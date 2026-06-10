import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ConnectionProps, Env } from "./env";
import { registerTools, SERVER_INSTRUCTIONS } from "./tools";

export const VERSION = "0.1.0";

interface State {
  /** Credentials saved via the setup_testrail_connection tool. */
  creds?: ConnectionProps;
}

export class TestRailMCP extends McpAgent<Env, State, ConnectionProps> {
  initialState: State = {};

  server = new McpServer(
    { name: "TestRail MCP", version: VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  async init(): Promise<void> {
    registerTools(this.server, {
      env: this.env,
      props: this.props,
      getStoredCreds: () => this.state?.creds,
      storeCreds: (creds) => {
        this.setState({ ...this.state, creds });
      },
    });
  }
}
