import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import type { Env } from "./env";
import { resolveLocalEnv } from "./stdio";
import { registerTools, SERVER_INSTRUCTIONS } from "./tools";
import { VERSION } from "./version";
import { beginLogin } from "./wizard";

/**
 * Local Streamable-HTTP transport adapter — an opt-in alternative to stdio for
 * clients (e.g. Claude Code) that connect to a URL instead of spawning a child
 * process. Plain HTTP is fine because it binds to loopback only; TLS is not
 * required for 127.0.0.1. The shared core (tools.ts / testrail.ts / env.ts /
 * catalog) is transport-agnostic, so this wires the exact same tools and
 * per-call credential resolution as the stdio adapter.
 *
 * Because any process on the machine can reach a loopback port, an optional
 * bearer token gates every request, and a Host allowlist defeats DNS-rebinding
 * (an attacker page that rebinds its domain to 127.0.0.1 still sends its own
 * hostname in the Host header).
 */

export interface HttpServerOptions {
  /** Port to bind (default 8787; 0 lets the OS choose — used by tests). */
  port?: number;
  /** Interface to bind (default 127.0.0.1 — loopback only). */
  host?: string;
  /** If set, every request must carry `Authorization: Bearer <token>`. */
  token?: string;
  /** Dynamic credential source; defaults to the local env/credstore resolver. */
  resolveEnv?: () => Env;
}

/** Build a fresh MCP server wired to the shared tools (one per HTTP session). */
function buildServer(resolveEnv: () => Env): McpServer {
  const server = new McpServer(
    { name: "TestRail MCP", version: VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );
  // Same wiring as stdio: credentials resolve per call, and the browser login
  // tool is available.
  registerTools(server, {
    env: resolveEnv(),
    resolveEnv,
    startLogin: () => beginLogin(),
  });
  return server;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

function endJsonError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }),
  );
}

/**
 * Start the loopback HTTP MCP server. Returns the URL to point a client at and
 * a `close()` that shuts the server and any live sessions down. Callers own the
 * lifecycle (unlike stdio, an HTTP server doesn't spawn on demand).
 */
export async function startHttpServer(
  opts: HttpServerOptions = {},
): Promise<{ url: string; port: number; close: () => Promise<void> }> {
  const host = opts.host ?? "127.0.0.1";
  const resolveEnv = opts.resolveEnv ?? (() => resolveLocalEnv());
  const token = opts.token;

  // One transport per MCP session, keyed by the session id the SDK assigns.
  const transports: Record<string, StreamableHTTPServerTransport> = {};
  // Populated after bind (needs the assigned port); every request's Host must match.
  let allowedHosts: string[] = [];

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? "/").split("?")[0];
    if (path !== "/mcp") {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
      return;
    }
    // DNS-rebinding defense: only accept our own loopback host:port.
    if (!allowedHosts.includes(req.headers.host ?? "")) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("Forbidden host");
      return;
    }
    // Bearer gate: a loopback port is reachable by any local process, and this
    // server can reach TestRail with the configured credentials.
    if (token && req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { "content-type": "text/plain" });
      res.end("Unauthorized");
      return;
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    // Existing session: hand straight to its transport (it reads the body).
    if (sessionId && transports[sessionId]) {
      await transports[sessionId].handleRequest(req, res);
      return;
    }

    // New session: only a POST carrying an `initialize` request may open one.
    if (req.method === "POST") {
      const body = await readJsonBody(req);
      if (!sessionId && isInitializeRequest(body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            transports[sid] = transport;
          },
        });
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) delete transports[sid];
        };
        await buildServer(resolveEnv).connect(transport);
        await transport.handleRequest(req, res, body);
        return;
      }
      endJsonError(res, 400, "Bad Request: no valid session id");
      return;
    }

    // GET (SSE) / DELETE without a known session.
    endJsonError(res, 400, "Bad Request: no valid session id");
  }

  const httpServer = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) endJsonError(res, 500, "Internal error");
      else res.end();
    });
  });

  await new Promise<void>((resolve) => httpServer.listen(opts.port ?? 8787, host, resolve));
  const addr = httpServer.address();
  if (!addr || typeof addr === "string") throw new Error("Could not bind HTTP server");
  const port = addr.port;
  allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  const url = `http://127.0.0.1:${port}/mcp`;

  const close = () =>
    new Promise<void>((resolve) => {
      for (const t of Object.values(transports)) void t.close();
      httpServer.close(() => resolve());
    });

  return { url, port, close };
}
