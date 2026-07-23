import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../src/env";
import { registerTools, SERVER_INSTRUCTIONS } from "../src/tools";
import type { ToolContext } from "../src/tools";

async function connect(ctx: ToolContext): Promise<Client> {
  const server = new McpServer({ name: "TestRail MCP", version: "test" });
  registerTools(server, ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function textOf(result: unknown): unknown {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return JSON.parse(content[0].text);
}

afterEach(() => vi.unstubAllGlobals());

describe("testrail_login tool", () => {
  it("is NOT registered when the context has no startLogin capability", async () => {
    const client = await connect({ env: {} as Env });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain("testrail_login");
  });

  it("is registered when startLogin is provided", async () => {
    const client = await connect({
      env: {} as Env,
      startLogin: async () => ({ url: "http://127.0.0.1:9/" }),
    });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("testrail_login");
  });

  it("starts the login and returns the browser URL", async () => {
    let calls = 0;
    const client = await connect({
      env: {} as Env,
      startLogin: async () => {
        calls++;
        return { url: "http://127.0.0.1:54321/" };
      },
    });
    const result = await client.callTool({ name: "testrail_login", arguments: {} });
    const data = textOf(result) as { url: string };
    expect(calls).toBe(1);
    expect(data.url).toBe("http://127.0.0.1:54321/");
  });
});

describe("dynamic credential resolution", () => {
  it("re-resolves credentials per call via resolveEnv (login mid-session is seen)", async () => {
    // Simulate credentials appearing after a login: resolveEnv returns empty
    // first, then a complete set. The same server instance must pick up the
    // change without a restart.
    let current: Env = {} as Env;
    const client = await connect({ env: {} as Env, resolveEnv: () => current });

    const before = textOf(
      await client.callTool({ name: "check_testrail_auth", arguments: {} }),
    ) as { ok: boolean; error_class?: string };
    expect(before.ok).toBe(false);
    expect(before.error_class).toBe("ConfigurationError");

    // "Login" completes: creds are now resolvable, and TestRail validates.
    current = {
      TESTRAIL_URL: "https://corp.testrail.io",
      TESTRAIL_USERNAME: "bot@corp.com",
      TESTRAIL_API_KEY: "corp-key",
    } as Env;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([{ id: 1 }]), { status: 200 })),
    );

    const after = textOf(
      await client.callTool({ name: "check_testrail_auth", arguments: {} }),
    ) as { ok: boolean; config: { url: string } };
    expect(after.ok).toBe(true);
    expect(after.config.url).toBe("https://corp.testrail.io");
  });
});

describe("guidance points users at testrail_login", () => {
  it("server instructions mention the testrail_login tool", () => {
    expect(SERVER_INSTRUCTIONS).toContain("testrail_login");
  });

  it("check_testrail_auth missing-config hint mentions testrail_login", async () => {
    const client = await connect({
      env: {} as Env,
      startLogin: async () => ({ url: "http://127.0.0.1:9/" }),
    });
    const data = textOf(
      await client.callTool({ name: "check_testrail_auth", arguments: {} }),
    ) as { hint: string };
    expect(data.hint).toContain("testrail_login");
  });
});
