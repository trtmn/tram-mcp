import { describe, expect, it } from "vitest";

import type { Env } from "../src/env";
import { checkAuth } from "../src/auth";

function req(authHeader?: string): Request {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("Authorization", authHeader);
  return new Request("https://worker.example/mcp", { headers });
}

const OPEN_ENV = {} as unknown as Env;
const GATED_ENV = { MCP_AUTH_TOKEN: "s3cret-token" } as unknown as Env;

describe("checkAuth", () => {
  it("allows any request when MCP_AUTH_TOKEN is unset (open mode)", async () => {
    expect(await checkAuth(req(), OPEN_ENV)).toBeNull();
    expect(await checkAuth(req("Bearer anything"), OPEN_ENV)).toBeNull();
  });

  it("allows the correct bearer token", async () => {
    expect(await checkAuth(req("Bearer s3cret-token"), GATED_ENV)).toBeNull();
  });

  it("rejects a missing Authorization header with 401", async () => {
    const res = await checkAuth(req(), GATED_ENV);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it("rejects a wrong token with 401", async () => {
    const res = await checkAuth(req("Bearer wrong-token"), GATED_ENV);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it("rejects a non-Bearer scheme with 401", async () => {
    const res = await checkAuth(req("Basic s3cret-token"), GATED_ENV);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it("rejects a token that is a prefix of the real token (no length leak)", async () => {
    const res = await checkAuth(req("Bearer s3cret"), GATED_ENV);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });
});
