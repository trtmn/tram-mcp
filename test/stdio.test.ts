import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("resolveLocalEnv", () => {
  let tmpHome: string;
  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "tram-stdio-"));
    vi.stubEnv("HOME", tmpHome);
    vi.stubEnv("USERPROFILE", tmpHome);
  });
  afterEach(() => vi.unstubAllEnvs());

  async function fresh() {
    vi.resetModules();
    return {
      stdio: await import("../src/stdio"),
      credstore: await import("../src/credstore"),
    };
  }

  it("prefers complete process.env credentials over the stored file", async () => {
    const { stdio, credstore } = await fresh();
    credstore.saveCredentials({
      url: "https://file.testrail.io",
      username: "file@c",
      auth_method: "api_key",
      secret: "fk",
    });
    const env = stdio.resolveLocalEnv({
      TESTRAIL_URL: "https://env.testrail.io",
      TESTRAIL_USERNAME: "env@c",
      TESTRAIL_API_KEY: "ek",
    } as NodeJS.ProcessEnv);
    expect(env.TESTRAIL_URL).toBe("https://env.testrail.io");
    expect(env.TESTRAIL_API_KEY).toBe("ek");
  });

  it("falls back to the stored file when process.env is incomplete", async () => {
    const { stdio, credstore } = await fresh();
    credstore.saveCredentials({
      url: "https://file.testrail.io",
      username: "file@c",
      auth_method: "password",
      secret: "fp",
    });
    const env = stdio.resolveLocalEnv({} as NodeJS.ProcessEnv);
    expect(env.TESTRAIL_URL).toBe("https://file.testrail.io");
    expect(env.TESTRAIL_PASSWORD).toBe("fp");
    expect(env.TESTRAIL_API_KEY).toBeUndefined();
  });

  it("yields empty credentials when neither source is present", async () => {
    const { stdio } = await fresh();
    const env = stdio.resolveLocalEnv({} as NodeJS.ProcessEnv);
    expect(env.TESTRAIL_URL).toBeUndefined();
  });
});
