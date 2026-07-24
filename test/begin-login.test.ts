import { afterEach, describe, expect, it } from "vitest";

import { beginLogin, cancelPendingLogin } from "../src/wizard";

/**
 * beginLogin is the non-blocking entry the `testrail_login` MCP tool calls: it
 * starts the loopback wizard, opens the browser, and returns the URL right away
 * (the tool can't block on a browser form). These tests drive it with a no-op
 * `open` and short timeouts so nothing real launches.
 */

afterEach(() => {
  cancelPendingLogin();
});

describe("beginLogin", () => {
  it("opens the browser and returns a reachable login URL", async () => {
    const opened: string[] = [];
    const { url } = await beginLogin({ open: (u) => opened.push(u), save: () => {} });
    expect(opened).toEqual([url]);
    const html = await (await fetch(url)).text();
    expect(html).toContain("Connect to TestRail");
  });

  it("supersedes a prior pending login (only one active session)", async () => {
    const first = await beginLogin({ open: () => {}, save: () => {} });
    const second = await beginLogin({ open: () => {}, save: () => {} });
    expect(second.url).not.toBe(first.url);
    // The superseded server is closed: its URL no longer accepts connections.
    await expect(fetch(first.url)).rejects.toThrow();
    // The current one is still up.
    expect((await fetch(second.url)).status).toBe(200);
  });

  it("auto-closes the loopback server after the timeout", async () => {
    const { url } = await beginLogin({ open: () => {}, save: () => {}, timeoutMs: 30 });
    expect((await fetch(url)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 80));
    await expect(fetch(url)).rejects.toThrow();
  });

  it("cancelPendingLogin closes the active session and reports whether one was open", async () => {
    const { url } = await beginLogin({ open: () => {}, save: () => {} });
    expect(cancelPendingLogin()).toBe(true);
    await expect(fetch(url)).rejects.toThrow();
    expect(cancelPendingLogin()).toBe(false); // nothing left to cancel
  });
});
