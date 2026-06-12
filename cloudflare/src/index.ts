import OAuthProvider from "@cloudflare/workers-oauth-provider";

import { defaultHandler } from "./authorize";
import { TestRailMCP } from "./mcp";

export { TestRailMCP };

/**
 * The Worker is wrapped in an OAuth 2.1 provider so it authenticates the way
 * remote MCP clients expect — Claude.ai supports *only* OAuth for custom
 * connectors (no custom headers), and Claude Code drives the same flow. The
 * `/authorize` page (see ./authorize) collects TestRail credentials; the
 * provider stores them encrypted-by-token (no key on Cloudflare) and injects
 * them as `ctx.props` → `TestRailMCP.props` on each authenticated request.
 */
export default new OAuthProvider({
  apiHandlers: {
    "/mcp": TestRailMCP.serve("/mcp"),
    "/sse": TestRailMCP.serveSSE("/sse"),
  },
  defaultHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
