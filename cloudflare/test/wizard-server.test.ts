import { afterEach, describe, expect, it, vi } from "vitest";

import { startWizardServer } from "../src/wizard";

afterEach(() => vi.unstubAllGlobals());

describe("startWizardServer", () => {
  it("serves the form at GET / and saves creds on a valid POST /submit", async () => {
    // The test drives the loopback server with real fetch; only TestRail's API
    // (the server's validation call) is stubbed to succeed.
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = typeof input === "string" ? input : input.toString();
      if (target.includes("127.0.0.1")) return realFetch(input, init);
      return new Response(JSON.stringify([]), { status: 200 });
    });
    const saved: unknown[] = [];
    const { url, done, close } = await startWizardServer({ save: (c) => saved.push(c) });

    try {
      const form = await fetch(url);
      expect(await form.text()).toContain("Connect to TestRail");

      const body = new URLSearchParams({
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
      const res = await fetch(`${url}submit`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ instance_url: "", username: "", auth_method: "api_key", secret: "" }),
      });
      expect(res.status).toBe(400);
      expect(await res.text()).toContain("All fields are required");
      expect(saved).toHaveLength(0);
    } finally {
      close();
    }
  });
});
