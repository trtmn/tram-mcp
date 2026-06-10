import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConnectionProps, Env } from "../src/env";
import { registerTools } from "../src/tools";

const ENV = {
  TESTRAIL_URL: "https://corp.testrail.io",
  TESTRAIL_USERNAME: "bot@corp.com",
  TESTRAIL_API_KEY: "corp-key",
} as unknown as Env;

interface Harness {
  client: Client;
  stored: { creds?: ConnectionProps };
}

async function startServer(env: Env = ENV): Promise<Harness> {
  const stored: { creds?: ConnectionProps } = {};
  const server = new McpServer({ name: "TestRail MCP", version: "test" });
  registerTools(server, {
    env,
    getStoredCreds: () => stored.creds,
    storeCreds: (creds) => {
      stored.creds = creds;
    },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, stored };
}

function textOf(result: unknown): unknown {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return JSON.parse(content[0].text);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MCP server", () => {
  it("exposes the full tool set", async () => {
    const { client } = await startServer();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "add_result_for_case",
        "browse_testrail_api",
        "check_testrail_auth",
        "create_test_run",
        "describe_testrail_method",
        "get_run_summary",
        "list_testrail_projects",
        "run_testrail_command",
        "search_test_cases",
        "setup_testrail_connection",
      ].sort(),
    );
  });

  it("renders auth_method as an enum (dropdown) in setup_testrail_connection", async () => {
    const { client } = await startServer();
    const { tools } = await client.listTools();
    const setup = tools.find((t) => t.name === "setup_testrail_connection")!;
    const schema = setup.inputSchema as {
      properties: Record<string, { enum?: string[] }>;
    };
    expect(schema.properties.auth_method.enum).toEqual(["api_key", "password"]);
  });

  it("browse_testrail_api returns categories with methods", async () => {
    const { client } = await startServer();
    const result = await client.callTool({ name: "browse_testrail_api", arguments: {} });
    const data = textOf(result) as Record<string, { methods: string[] }>;
    expect(data.projects.methods).toContain("get_projects");
    expect(data.cases.methods).toContain("add_case");
  });

  it("describe_testrail_method returns parameter and endpoint details", async () => {
    const { client } = await startServer();
    const result = await client.callTool({
      name: "describe_testrail_method",
      arguments: { category: "cases", method: "get_case" },
    });
    const data = textOf(result) as {
      parameters: { name: string; required: boolean }[];
      http: { verb: string; endpoint: string };
    };
    expect(data.parameters).toEqual([{ name: "case_id", required: true, type: "int" }]);
    expect(data.http).toMatchObject({ verb: "GET", endpoint: "get_case/{case_id}" });
  });

  it("run_testrail_command executes against TestRail with field filtering", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(String(url)).toBe(
          "https://corp.testrail.io/index.php?/api/v2/get_priorities",
        );
        return new Response(
          JSON.stringify([
            { id: 1, name: "Low", short_name: "L" },
            { id: 2, name: "High", short_name: "H" },
          ]),
          { status: 200 },
        );
      }),
    );
    const { client } = await startServer();
    const result = await client.callTool({
      name: "run_testrail_command",
      arguments: {
        category: "priorities",
        method: "get_priorities",
        fields: ["id", "name"],
        max_results: 1,
      },
    });
    expect(textOf(result)).toEqual({
      results: [{ id: 1, name: "Low" }],
      truncated: true,
      total_count: 2,
      message:
        "Results truncated: showing 1 of 2 items. Use max_results or refine " +
        "your query to retrieve more.",
    });
  });

  it("run_testrail_command surfaces unknown methods without calling TestRail", async () => {
    const { client } = await startServer();
    const result = await client.callTool({
      name: "run_testrail_command",
      arguments: { category: "projects", method: "explode" },
    });
    const data = textOf(result) as { error: string; available_methods: string[] };
    expect(data.error).toContain("Unknown method");
    expect(data.available_methods).toContain("get_projects");
  });

  it("search_test_cases filters by title substring", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            cases: [
              { id: 1, title: "Login works", section_id: 5 },
              { id: 2, title: "Logout works", section_id: 5 },
              { id: 3, title: "LOGIN fails gracefully", section_id: 6 },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const { client } = await startServer();
    const result = await client.callTool({
      name: "search_test_cases",
      arguments: { project_id: 1, query: "login" },
    });
    expect(textOf(result)).toEqual({
      count: 2,
      cases: [
        { id: 1, title: "Login works", section_id: 5 },
        { id: 3, title: "LOGIN fails gracefully", section_id: 6 },
      ],
    });
  });

  it("check_testrail_auth diagnoses missing configuration", async () => {
    const { client } = await startServer({} as unknown as Env);
    const result = await client.callTool({ name: "check_testrail_auth", arguments: {} });
    const data = textOf(result) as { ok: boolean; error_class: string };
    expect(data.ok).toBe(false);
    expect(data.error_class).toBe("ConfigurationError");
  });

  it("check_testrail_auth reports ok with working credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([{ id: 1 }]), { status: 200 })),
    );
    const { client } = await startServer();
    const result = await client.callTool({ name: "check_testrail_auth", arguments: {} });
    const data = textOf(result) as { ok: boolean; priorities_count: number };
    expect(data.ok).toBe(true);
    expect(data.priorities_count).toBe(1);
  });

  it("check_testrail_auth translates a 401 into a hint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    const { client } = await startServer();
    const result = await client.callTool({ name: "check_testrail_auth", arguments: {} });
    const data = textOf(result) as { ok: boolean; status_code: number; hint: string };
    expect(data.ok).toBe(false);
    expect(data.status_code).toBe(401);
    expect(data.hint).toMatch(/rejected the credentials/);
  });

  it("setup_testrail_connection stores credentials used by later calls", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify([]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { client, stored } = await startServer();

    await client.callTool({
      name: "setup_testrail_connection",
      arguments: {
        instance_url: "https://mine.testrail.io",
        username: "me@me.com",
        auth_method: "password",
        secret: "hunter2",
      },
    });
    expect(stored.creds).toEqual({
      testrailUrl: "https://mine.testrail.io",
      testrailUsername: "me@me.com",
      testrailApiKey: undefined,
      testrailPassword: "hunter2",
    });

    const result = await client.callTool({ name: "check_testrail_auth", arguments: {} });
    const data = textOf(result) as { ok: boolean; config: Record<string, unknown> };
    expect(data.ok).toBe(true);
    expect(data.config.url).toBe("https://mine.testrail.io");
    expect(data.config.username).toBe("me@me.com");
    expect(data.config.auth_method).toBe("password");
    // The actual request authenticated with the stored password.
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("https://mine.testrail.io");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${btoa("me@me.com:hunter2")}`);
  });

  it("add_result_for_case maps status names to status ids", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ id: 99, status_id: 5 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { client } = await startServer();
    await client.callTool({
      name: "add_result_for_case",
      arguments: { run_id: 10, case_id: 20, status: "failed", comment: "boom" },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("add_result_for_case/10/20");
    expect(JSON.parse(init.body as string)).toEqual({ status_id: 5, comment: "boom" });
  });

  it("get_run_summary aggregates counts and lists failed tests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("get_run/")) {
          return new Response(
            JSON.stringify({
              id: 5,
              name: "Nightly",
              is_completed: false,
              project_id: 1,
              passed_count: 8,
              failed_count: 1,
              blocked_count: 0,
              retest_count: 0,
              untested_count: 1,
            }),
            { status: 200 },
          );
        }
        expect(String(url)).toContain("get_tests/5&status_id=5");
        return new Response(
          JSON.stringify({ tests: [{ id: 100, case_id: 42, title: "Broken thing" }] }),
          { status: 200 },
        );
      }),
    );
    const { client } = await startServer();
    const result = await client.callTool({
      name: "get_run_summary",
      arguments: { run_id: 5 },
    });
    const data = textOf(result) as Record<string, unknown>;
    expect(data.counts).toEqual({
      passed: 8,
      failed: 1,
      blocked: 0,
      retest: 0,
      untested: 1,
    });
    expect(data.total_tests).toBe(10);
    expect(data.pass_rate_pct).toBe(88.9);
    expect(data.failed_tests).toEqual([
      { id: 100, case_id: 42, title: "Broken thing" },
    ]);
  });

  it("create_test_run includes only the given cases", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ id: 77 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { client } = await startServer();
    await client.callTool({
      name: "create_test_run",
      arguments: {
        project_id: 3,
        name: "Regression",
        suite_id: 9,
        case_ids: [1, 2, 3],
      },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("add_run/3");
    expect(JSON.parse(init.body as string)).toEqual({
      name: "Regression",
      include_all: false,
      suite_id: 9,
      case_ids: [1, 2, 3],
    });
  });
});
