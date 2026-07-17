import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Exercises the full local-login chain (runWizard -> loopback server ->
// handleSubmit -> TestRail validation -> credstore) against a stubbed TestRail,
// without opening a real browser.

let tmpHome: string;
let realFetch: typeof globalThis.fetch;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "tram-login-"));
  vi.stubEnv("HOME", tmpHome);
  vi.stubEnv("USERPROFILE", tmpHome);
  realFetch = globalThis.fetch;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Stub fetch: pass loopback calls through, answer TestRail with `status`. */
function stubTestRail(status: number) {
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const target = typeof input === "string" ? input : input.toString();
    if (target.includes("127.0.0.1")) return realFetch(input, init);
    return new Response(JSON.stringify(status === 200 ? [{ id: 1 }] : "no"), { status });
  });
}

async function fresh() {
  vi.resetModules();
  return { wizard: await import("../src/wizard"), credstore: await import("../src/credstore") };
}

describe("runWizard", () => {
  it("saves credentials after a successful browser submission", async () => {
    stubTestRail(200);
    const { wizard, credstore } = await fresh();

    await wizard.runWizard({
      // The injected opener plays the role of the browser: GET the form (to
      // read the CSRF token), then POST the credentials with that token.
      open: (url) => {
        void (async () => {
          const html = await (await fetch(url)).text();
          const token = html.match(/name="wizard_token" value="([^"]+)"/)?.[1] ?? "";
          await fetch(`${url}submit`, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              wizard_token: token,
              instance_url: "https://c.testrail.io",
              username: "u@c.com",
              auth_method: "api_key",
              secret: "k",
            }),
          });
        })();
      },
    });

    expect(credstore.loadCredentials()).toEqual({
      url: "https://c.testrail.io",
      username: "u@c.com",
      auth_method: "api_key",
      secret: "k",
    });
  });

  it("rejects with a timeout when no submission arrives", async () => {
    const { wizard } = await fresh();
    await expect(wizard.runWizard({ open: () => {}, timeoutMs: 150 })).rejects.toThrow(/timed out/i);
  });
});

describe("startWizardServer failure handling", () => {
  it("re-renders a credential error (HTTP 401) and does not save", async () => {
    stubTestRail(401);
    const { wizard, credstore } = await fresh();
    const saved: unknown[] = [];
    const { url, close } = await wizard.startWizardServer({ save: (c) => saved.push(c) });
    try {
      const token =
        (await (await fetch(url)).text()).match(/name="wizard_token" value="([^"]+)"/)?.[1] ?? "";
      const res = await fetch(`${url}submit`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          wizard_token: token,
          instance_url: "https://c.testrail.io",
          username: "u@c.com",
          auth_method: "api_key",
          secret: "wrong",
        }),
      });
      expect(res.status).toBe(401);
      expect(await res.text()).toContain("rejected those credentials");
      expect(saved).toHaveLength(0);
      expect(credstore.loadCredentials()).toBeNull();
    } finally {
      close();
    }
  });
});
