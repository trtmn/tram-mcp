import { checkAuth } from "./auth";
import type { Env } from "./env";
import { propsFromHeaders } from "./env";
import { TestRailMCP, VERSION } from "./mcp";

export { TestRailMCP };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return Response.json({
        name: "TestRail MCP",
        version: VERSION,
        status: "ok",
        endpoints: { mcp: "/mcp", sse: "/sse" },
      });
    }

    const denied = await checkAuth(request, env);
    if (denied) return denied;

    // Per-connection TestRail credentials may arrive as headers; McpAgent
    // exposes them to tools via this.props.
    (ctx as ExecutionContext & { props: unknown }).props = propsFromHeaders(
      request.headers,
    );

    if (url.pathname === "/mcp") {
      return TestRailMCP.serve("/mcp").fetch(request, env, ctx);
    }
    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return TestRailMCP.serveSSE("/sse").fetch(request, env, ctx);
    }

    return Response.json(
      { error: "Not found. MCP endpoint is /mcp (streamable HTTP) or /sse." },
      { status: 404 },
    );
  },
} satisfies ExportedHandler<Env>;
