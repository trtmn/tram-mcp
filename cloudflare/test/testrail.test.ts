import { afterEach, describe, expect, it, vi } from "vitest";

import { TestRailClient, TestRailError } from "../src/testrail";

const CREDS = {
  url: "https://example.testrail.io",
  username: "user@example.com",
  secret: "key123",
  authMethod: "api_key" as const,
};

function client(): TestRailClient {
  return new TestRailClient(CREDS);
}

function mockFetchOnce(status: number, body: string, headers: Record<string, string> = {}) {
  const fn = vi.fn(async () => new Response(body, { status, headers }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("buildUrl", () => {
  it("builds the index.php API URL", () => {
    expect(client().buildUrl("get_priorities")).toBe(
      "https://example.testrail.io/index.php?/api/v2/get_priorities",
    );
  });

  it("appends query params with & and skips null/undefined", () => {
    const url = client().buildUrl("get_cases/1", {
      suite_id: 2,
      section_id: null,
      limit: undefined,
    });
    expect(url).toBe(
      "https://example.testrail.io/index.php?/api/v2/get_cases/1&suite_id=2",
    );
  });

  it("comma-joins array values", () => {
    const url = client().buildUrl("get_cases/1", { priority_id: [1, 2, 3] });
    expect(url).toContain("priority_id=1%2C2%2C3");
  });
});

describe("request handling", () => {
  it("parses JSON on 200 and sends basic auth", async () => {
    const fn = mockFetchOnce(200, JSON.stringify([{ id: 1 }]));
    const result = await client().get("get_priorities");
    expect(result).toEqual([{ id: 1 }]);
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${btoa("user@example.com:key123")}`);
  });

  it("returns {} for an empty 200 body (delete operations)", async () => {
    mockFetchOnce(200, "");
    expect(await client().post("delete_case/5")).toEqual({});
  });

  it("raises TestRailError with status 401 on auth failure", async () => {
    mockFetchOnce(401, "");
    const err = (await client().get("get_priorities").catch((e: unknown) => e)) as TestRailError;
    expect(err).toBeInstanceOf(TestRailError);
    expect(err.status).toBe(401);
    expect(err.message).toMatch(/Authentication failed/);
  });

  it("extracts the TestRail error message from 400 responses", async () => {
    mockFetchOnce(400, JSON.stringify({ error: "Field :title is a required field." }));
    const err = (await client().post("add_case/1", {}).catch((e: unknown) => e)) as TestRailError;
    expect(err).toBeInstanceOf(TestRailError);
    expect(err.status).toBe(400);
    expect(err.message).toBe("Field :title is a required field.");
  });

  it("retries retryable statuses before failing", async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fn);
    const promise = client().get("get_priorities").catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const err = (await promise) as TestRailError;
    expect(fn).toHaveBeenCalledTimes(4); // initial + 3 retries
    expect(err).toBeInstanceOf(TestRailError);
    expect(err.status).toBe(503);
  });

  it("recovers when a retry succeeds", async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return calls === 1
          ? new Response("", { status: 429 })
          : new Response(JSON.stringify({ id: 9 }), { status: 200 });
      }),
    );
    const promise = client().get("get_run/9");
    await vi.runAllTimersAsync();
    expect(await promise).toEqual({ id: 9 });
  });

  it("sends a JSON body on POST", async () => {
    const fn = mockFetchOnce(200, "{}");
    await client().post("add_run/1", { name: "Run" });
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ name: "Run" });
  });
});
