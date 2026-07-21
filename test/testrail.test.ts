import { afterEach, describe, expect, it, vi } from "vitest";

import { TestRailClient, TestRailError } from "../src/testrail";

const CREDS = {
  url: "https://example.testrail.io",
  username: "user@example.com",
  secret: "key123",
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

  it("serializes booleans as 1/0 (TestRail filter convention), not true/false", () => {
    const url = client().buildUrl("get_runs/1", {
      is_completed: true,
      draft: false,
    });
    expect(url).toContain("is_completed=1");
    expect(url).toContain("draft=0");
    expect(url).not.toContain("true");
    expect(url).not.toContain("false");
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

  it("treats a 201 Created body as success, not failure", async () => {
    mockFetchOnce(201, JSON.stringify({ id: 50 }));
    expect(await client().post("add_run/1", { name: "X" })).toEqual({ id: 50 });
  });

  it("includes a body snippet when a 200 returns non-JSON (WAF/proxy page)", async () => {
    mockFetchOnce(200, "<html>Access Denied</html>");
    const err = (await client().get("get_run/1").catch((e: unknown) => e)) as TestRailError;
    expect(err).toBeInstanceOf(TestRailError);
    expect(err.message).toMatch(/Invalid JSON/);
    expect(err.message).toContain("Access Denied");
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

  it("honors Retry-After (seconds) for backoff on a retried 429", async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return calls === 1
          ? new Response("", { status: 429, headers: { "Retry-After": "2" } })
          : new Response(JSON.stringify({ id: 1 }), { status: 200 });
      }),
    );
    const promise = client().get("get_run/1");
    // Not resolved after 1s; the Retry-After asked for 2s.
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await promise).toEqual({ id: 1 });
  });

  it("notes retry exhaustion in the thrown error message", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    const promise = client().get("get_priorities").catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const err = (await promise) as TestRailError;
    expect(err.message).toMatch(/after 4 attempts/);
  });

  it("marks network failures with a null status", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const promise = client().get("get_priorities").catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const err = (await promise) as TestRailError;
    expect(err).toBeInstanceOf(TestRailError);
    expect(err.status).toBeNull();
    expect(err.message).toMatch(/Request failed/);
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

  it("does NOT retry a POST on 5xx (avoids duplicating an applied write)", async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fn);
    const promise = client()
      .post("add_result_for_case/1/2", { status_id: 1 })
      .catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const err = (await promise) as TestRailError;
    expect(fn).toHaveBeenCalledTimes(1); // no retries
    expect(err.status).toBe(503);
  });

  it("still retries a POST on 429 (request was rejected, not applied)", async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return calls === 1
          ? new Response("", { status: 429 })
          : new Response(JSON.stringify({ id: 7 }), { status: 200 });
      }),
    );
    const promise = client().post("add_run/1", { name: "R" });
    await vi.runAllTimersAsync();
    expect(await promise).toEqual({ id: 7 });
    expect(calls).toBe(2);
  });
});

describe("getPaginated", () => {
  // Build one page of TestRail's bulk-list envelope shape.
  function page(items: unknown[], next: string | null, key = "cases") {
    return JSON.stringify({
      offset: 0,
      limit: 250,
      size: items.length,
      _links: { next, prev: null },
      [key]: items,
    });
  }

  it("follows _links.next and flattens every page into one array", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.includes("offset=250")) {
          return new Response(page([{ id: 3 }], null));
        }
        return new Response(
          page([{ id: 1 }, { id: 2 }], "/api/v2/get_cases/1&limit=250&offset=250"),
        );
      }),
    );
    const result = await client().getPaginated("get_cases/1");
    expect(result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    // Second request targets the instance-relative next link, /api/v2/ stripped.
    expect(calls[1]).toBe(
      "https://example.testrail.io/index.php?/api/v2/get_cases/1&limit=250&offset=250",
    );
  });

  it("returns a bare array response unchanged (older TestRail / no envelope)", async () => {
    mockFetchOnce(200, JSON.stringify([{ id: 1 }, { id: 2 }]));
    expect(await client().getPaginated("get_priorities")).toEqual([
      { id: 1 },
      { id: 2 },
    ]);
  });

  it("passes a single-entity response through untouched", async () => {
    mockFetchOnce(200, JSON.stringify({ id: 5, name: "Run", url: "u" }));
    expect(await client().getPaginated("get_run/5")).toEqual({
      id: 5,
      name: "Run",
      url: "u",
    });
  });

  it("stops at a single page when _links.next is null", async () => {
    const fn = vi.fn(async () => new Response(page([{ id: 1 }], null)));
    vi.stubGlobal("fetch", fn);
    expect(await client().getPaginated("get_cases/1")).toEqual([{ id: 1 }]);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
