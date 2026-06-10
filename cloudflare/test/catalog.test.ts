import { describe, expect, it } from "vitest";

import { CATALOG, dispatchMethod, lookupMethod } from "../src/catalog";
import type { TestRailClient } from "../src/testrail";

function fakeClient() {
  const calls: { verb: string; endpoint: string; query?: unknown; body?: unknown }[] = [];
  const client = {
    get: async (endpoint: string, query?: unknown) => {
      calls.push({ verb: "GET", endpoint, query });
      return { ok: true };
    },
    post: async (endpoint: string, body?: unknown, query?: unknown) => {
      calls.push({ verb: "POST", endpoint, body, query });
      return { ok: true };
    },
  };
  return { calls, client: client as unknown as TestRailClient };
}

describe("catalog", () => {
  it("contains the core categories", () => {
    for (const expected of [
      "projects",
      "cases",
      "runs",
      "results",
      "plans",
      "suites",
      "sections",
      "milestones",
      "users",
      "statuses",
      "priorities",
    ]) {
      expect(CATALOG[expected], `missing category ${expected}`).toBeDefined();
    }
  });

  it("has a substantial method count with http mappings", () => {
    const methods = Object.values(CATALOG).flatMap((c) => Object.values(c.methods));
    expect(methods.length).toBeGreaterThan(100);
    const dispatchable = methods.filter((m) => m.http);
    expect(dispatchable.length).toBeGreaterThan(100);
    for (const m of dispatchable) {
      expect(["GET", "POST"]).toContain(m.http!.verb);
      expect(m.http!.endpoint).toBeTruthy();
    }
  });

  it("lookupMethod reports unknown categories and methods", () => {
    const noCat = lookupMethod("nope", "get_things");
    expect(noCat).toHaveProperty("error");
    expect((noCat as { available_categories: string[] }).available_categories).toContain(
      "projects",
    );

    const noMethod = lookupMethod("projects", "nope");
    expect(noMethod).toHaveProperty("error");
    expect((noMethod as { available_methods: string[] }).available_methods).toContain(
      "get_projects",
    );
  });
});

describe("dispatchMethod", () => {
  it("fills path params on GET", async () => {
    const { calls, client } = fakeClient();
    await dispatchMethod(client, "cases", "get_case", { params: { case_id: 42 } });
    expect(calls).toEqual([{ verb: "GET", endpoint: "get_case/42", query: {} }]);
  });

  it("sends non-path params as query on GET", async () => {
    const { calls, client } = fakeClient();
    await dispatchMethod(client, "cases", "get_cases", {
      params: { project_id: 1, suite_id: 2, limit: 10 },
    });
    expect(calls[0].endpoint).toBe("get_cases/1");
    expect(calls[0].query).toEqual({ suite_id: 2, limit: 10 });
  });

  it("sends non-path params as body on POST", async () => {
    const { calls, client } = fakeClient();
    await dispatchMethod(client, "runs", "add_run", {
      params: { project_id: 7, name: "Smoke", include_all: false },
    });
    expect(calls[0]).toMatchObject({
      verb: "POST",
      endpoint: "add_run/7",
      body: { name: "Smoke", include_all: false },
    });
  });

  it("appends extra_params to the query string for both verbs", async () => {
    const { calls, client } = fakeClient();
    await dispatchMethod(client, "cases", "get_cases", {
      params: { project_id: 1 },
      extraParams: { custom_automation_type: "1" },
    });
    expect(calls[0].query).toEqual({ custom_automation_type: "1" });

    await dispatchMethod(client, "runs", "add_run", {
      params: { project_id: 7, name: "X" },
      extraParams: { foo: "bar" },
    });
    expect(calls[1].query).toEqual({ foo: "bar" });
  });

  it("rejects missing path params with an actionable error", async () => {
    const { client } = fakeClient();
    await expect(
      dispatchMethod(client, "cases", "get_case", { params: {} }),
    ).rejects.toThrow(/Missing required parameter 'case_id'/);
  });

  it("rejects unsupported composite helpers", async () => {
    const { client } = fakeClient();
    await expect(
      dispatchMethod(client, "cases", "get_required_case_fields", { params: {} }),
    ).rejects.toThrow(/not available/);
  });

  it("drops null and undefined values from params", async () => {
    const { calls, client } = fakeClient();
    await dispatchMethod(client, "cases", "get_cases", {
      params: { project_id: 1, suite_id: null, section_id: undefined },
    });
    expect(calls[0].query).toEqual({});
  });
});
