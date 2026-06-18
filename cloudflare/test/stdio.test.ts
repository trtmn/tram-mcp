import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { buildStdioServer, envFromProcess } from "../src/stdio";

const EXPECTED_TOOLS = [
  "add_result_for_case",
  "browse_testrail_api",
  "check_testrail_auth",
  "create_test_run",
  "describe_testrail_method",
  "get_run_summary",
  "list_testrail_projects",
  "run_testrail_command",
  "search_test_cases",
].sort();

describe("envFromProcess", () => {
  it("maps the TESTRAIL_* fields from a process env", () => {
    const env = envFromProcess({
      TESTRAIL_URL: "https://corp.testrail.io",
      TESTRAIL_USERNAME: "bot@corp.com",
      TESTRAIL_API_KEY: "corp-key",
      PATH: "/usr/bin",
    } as NodeJS.ProcessEnv);
    expect(env.TESTRAIL_URL).toBe("https://corp.testrail.io");
    expect(env.TESTRAIL_USERNAME).toBe("bot@corp.com");
    expect(env.TESTRAIL_API_KEY).toBe("corp-key");
    expect(env.TESTRAIL_PASSWORD).toBeUndefined();
  });

  it("leaves credential fields undefined when absent", () => {
    const env = envFromProcess({} as NodeJS.ProcessEnv);
    expect(env.TESTRAIL_URL).toBeUndefined();
    expect(env.TESTRAIL_USERNAME).toBeUndefined();
    expect(env.TESTRAIL_API_KEY).toBeUndefined();
    expect(env.TESTRAIL_PASSWORD).toBeUndefined();
  });
});

describe("buildStdioServer", () => {
  async function connect(server = buildStdioServer(envFromProcess({
    TESTRAIL_URL: "https://corp.testrail.io",
    TESTRAIL_USERNAME: "bot@corp.com",
    TESTRAIL_API_KEY: "corp-key",
  } as NodeJS.ProcessEnv))) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    return client;
  }

  it("exposes the same tool set as the Worker", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(EXPECTED_TOOLS);
  });

  it("builds even with no credentials (auth is checked at call time)", async () => {
    const client = await connect(buildStdioServer(envFromProcess({} as NodeJS.ProcessEnv)));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(EXPECTED_TOOLS);
  });
});
