import type { Env } from "./env";
import { propsFromHeaders } from "./env";
import { TestRailMCP, VERSION } from "./mcp";

export { TestRailMCP };

function unauthorized(message: string): Response {
  return Response.json({ error: message }, { status: 401 });
}

/**
 * When MCP_AUTH_TOKEN is set, clients must send it as a bearer token.
 * Without it the Worker is open — fine for testing, not recommended for
 * production since the Worker holds TestRail credentials.
 */
function checkAuth(request: Request, env: Env): Response | null {
  if (!env.MCP_AUTH_TOKEN) return null;
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token !== env.MCP_AUTH_TOKEN) {
    return unauthorized(
      "Missing or invalid bearer token. Send 'Authorization: Bearer <MCP_AUTH_TOKEN>'.",
    );
  }
  return null;
}

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

    const denied = checkAuth(request, env);
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
