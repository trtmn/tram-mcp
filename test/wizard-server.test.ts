import { request } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import { startWizardServer } from "../src/wizard";

/** GET a URL with an explicit Host header (fetch forbids overriding Host). */
function getWithHost(url: string, host: string): Promise<number> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: u.hostname, port: u.port, path: "/", method: "GET", headers: { Host: host } },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

afterEach(() => vi.unstubAllGlobals());

/** Extract the CSRF token embedded in a served form. */
function tokenFrom(html: string): string {
  const m = html.match(/name="wizard_token" value="([^"]+)"/);
  if (!m) throw new Error("no wizard_token in form");
  return m[1];
}

describe("startWizardServer", () => {
  it("serves the form at GET / and saves creds on a valid POST /submit", async () => {
    // The test drives the loopback server with real fetch; only TestRail's API
    // (the server's validation call) is stubbed to succeed.
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const target = typeof input === "string" ? input : input.toString();
      if (target.includes("127.0.0.1")) return realFetch(input, init);
      return new Response(JSON.stringify([]), { status: 200 });
    });
    const saved: unknown[] = [];
    const { url, done, close } = await startWizardServer({ save: (c) => saved.push(c) });

    try {
      const form = await fetch(url);
      const html = await form.text();
      expect(html).toContain("Connect to TestRail");

      const body = new URLSearchParams({
        wizard_token: tokenFrom(html),
        instance_url: "https://c.testrail.io",
        username: "u@c.com",
        auth_method: "api_key",
        secret: "k",
      });
      const res = await fetch(`${url}submit`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      expect(await res.text()).toContain("Connected to TestRail");
      await done; // resolves after a successful submit
      expect(saved).toHaveLength(1);
    } finally {
      close();
    }
  });

  it("re-renders the form (not the success page) on invalid input", async () => {
    const saved: unknown[] = [];
    const { url, close } = await startWizardServer({ save: (c) => saved.push(c) });
    try {
      const token = tokenFrom(await (await fetch(url)).text());
      const res = await fetch(`${url}submit`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          wizard_token: token,
          instance_url: "",
          username: "",
          auth_method: "api_key",
          secret: "",
        }),
      });
      expect(res.status).toBe(400);
      expect(await res.text()).toContain("All fields are required");
      expect(saved).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("rejects a submit with a missing/forged CSRF token (403) and does not save", async () => {
    const saved: unknown[] = [];
    const { url, close } = await startWizardServer({ save: (c) => saved.push(c) });
    try {
      const res = await fetch(`${url}submit`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          wizard_token: "forged",
          instance_url: "https://evil.testrail.io",
          username: "attacker@evil.com",
          auth_method: "api_key",
          secret: "planted",
        }),
      });
      expect(res.status).toBe(403);
      expect(saved).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("rejects a request with a foreign Host header (DNS-rebinding defense)", async () => {
    const { url, close } = await startWizardServer();
    try {
      expect(await getWithHost(url, "evil.com")).toBe(403);
    } finally {
      close();
    }
  });
});
