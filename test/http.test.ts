import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";

import type { Env } from "../src/env";
import { startHttpServer } from "../src/http";

/**
 * Exercises the local Streamable-HTTP transport end to end: a real SDK client
 * connects to the loopback server over plain HTTP, initializes, and lists tools
 * — the same round trip a client like Claude Code performs. No TestRail calls
 * are made (listing tools doesn't hit the API), so credentials can be stubbed.
 */

const ENV = {
  TESTRAIL_URL: "https://corp.testrail.io",
  TESTRAIL_USERNAME: "bot@corp.com",
  TESTRAIL_API_KEY: "corp-key",
} as unknown as Env;

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function start(opts: Partial<Parameters<typeof startHttpServer>[0]> = {}) {
  const s = await startHttpServer({ port: 0, resolveEnv: () => ENV, ...opts });
  cleanups.push(s.close);
  return s;
}

function connect(url: string, headers?: Record<string, string>) {
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(url),
    headers ? { requestInit: { headers } } : undefined,
  );
  return { client, transport };
}

describe("local HTTP transport", () => {
  it("binds to loopback and serves MCP at /mcp", async () => {
    const { url } = await start();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  });

  it("initializes and lists the tool set over HTTP", async () => {
    const { url } = await start();
    const { client, transport } = connect(url);
    await client.connect(transport);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("check_testrail_auth");
    expect(names).toContain("run_testrail_command");
    await client.close();
  });

  it("rejects a connection with no bearer token when a token is configured", async () => {
    const { url } = await start({ token: "s3cret" });
    const { client, transport } = connect(url);
    await expect(client.connect(transport)).rejects.toThrow();
  });

  it("accepts a connection carrying the correct bearer token", async () => {
    const { url } = await start({ token: "s3cret" });
    const { client, transport } = connect(url, { Authorization: "Bearer s3cret" });
    await client.connect(transport);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("check_testrail_auth");
    await client.close();
  });
});
