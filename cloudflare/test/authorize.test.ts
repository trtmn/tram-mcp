import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultHandler } from "../src/authorize";
import type { Env } from "../src/env";

const AUTH_REQ = {
  responseType: "code",
  clientId: "c1",
  redirectUri: "https://claude.ai/cb",
  scope: ["mcp"],
  state: "xyz",
};

function encodeReq(r: unknown): string {
  return btoa(JSON.stringify(r)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeEnv() {
  const calls = { complete: [] as { props: Record<string, unknown>; userId: string }[] };
  const env = {
    OAUTH_PROVIDER: {
      parseAuthRequest: async () => AUTH_REQ,
      lookupClient: async () => ({ clientName: "Claude" }),
      completeAuthorization: async (opts: { props: Record<string, unknown>; userId: string }) => {
        calls.complete.push(opts);
        return { redirectTo: "https://claude.ai/cb?code=abc&state=xyz" };
      },
    },
  } as unknown as Env;
  return { env, calls };
}

function postForm(fields: Record<string, string>): Request {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return new Request("https://w/authorize", { method: "POST", body });
}

afterEach(() => vi.unstubAllGlobals());

describe("authorize handler", () => {
  it("serves health JSON at /health", async () => {
    const { env } = makeEnv();
    const res = await defaultHandler.fetch(new Request("https://w/health"), env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { auth: string }).auth).toBe("oauth");
  });

  it("renders the credential form with a masked secret field at GET /authorize", async () => {
    const { env } = makeEnv();
    const res = await defaultHandler.fetch(
      new Request("https://w/authorize?response_type=code&client_id=c1"),
      env,
    );
    const html = await res.text();
    expect(html).toContain("Connect to TestRail");
    expect(html).toContain('name="secret"');
    expect(html).toContain('type="password"'); // real masking (unlike MCP elicitation)
    expect(html).toContain('name="oauth_req"');
  });

  it("validates credentials then completes authorization on POST", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{ id: 1 }]), { status: 200 })));
    const { env, calls } = makeEnv();
    const res = await defaultHandler.fetch(
      postForm({
        oauth_req: encodeReq(AUTH_REQ),
        instance_url: "https://mine.testrail.io",
        username: "me@me.com",
        auth_method: "api_key",
        secret: "key123",
      }),
      env,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("code=abc");
    expect(calls.complete).toHaveLength(1);
    expect(calls.complete[0].props).toMatchObject({
      testrailUrl: "https://mine.testrail.io",
      testrailUsername: "me@me.com",
      testrailApiKey: "key123",
    });
    // userId is a colon-free SHA-256 hex (raw "url|user" would corrupt the code).
    expect(calls.complete[0].userId).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects bad TestRail credentials without completing authorization", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    const { env, calls } = makeEnv();
    const res = await defaultHandler.fetch(
      postForm({
        oauth_req: encodeReq(AUTH_REQ),
        instance_url: "https://mine.testrail.io",
        username: "me@me.com",
        auth_method: "api_key",
        secret: "wrong",
      }),
      env,
    );
    expect(res.status).toBe(401);
    expect(await res.text()).toMatch(/rejected/i);
    expect(calls.complete).toHaveLength(0);
  });

  it("requires all fields", async () => {
    const { env, calls } = makeEnv();
    const res = await defaultHandler.fetch(
      postForm({ oauth_req: encodeReq(AUTH_REQ), instance_url: "", username: "", auth_method: "api_key", secret: "" }),
      env,
    );
    expect(res.status).toBe(400);
    expect(calls.complete).toHaveLength(0);
  });

  it("returns a 400 error page (not a 500) for an invalid/unregistered authorize request", async () => {
    const env = {
      OAUTH_PROVIDER: {
        parseAuthRequest: async () => {
          throw new Error("unknown client");
        },
        lookupClient: async () => null,
        completeAuthorization: async () => ({ redirectTo: "x" }),
      },
    } as unknown as Env;
    const res = await defaultHandler.fetch(new Request("https://w/authorize?client_id=bogus"), env);
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/invalid or expired|re-register/i);
  });
});
