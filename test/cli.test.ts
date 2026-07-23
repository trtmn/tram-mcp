import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpHome: string;
beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "tram-cli-"));
  vi.stubEnv("HOME", tmpHome);
  vi.stubEnv("USERPROFILE", tmpHome);
});
afterEach(() => vi.unstubAllEnvs());

async function fresh() {
  vi.resetModules();
  return import("../src/cli");
}

describe("dispatch", () => {
  it("returns 'server' for no subcommand", async () => {
    const { dispatch } = await fresh();
    expect(await dispatch([])).toBe("server");
  });

  it("logout clears creds and returns 0", async () => {
    const { dispatch } = await fresh();
    const { saveCredentials, loadCredentials } = await import("../src/credstore");
    saveCredentials({ url: "x", username: "y", auth_method: "api_key", secret: "z" });
    expect(await dispatch(["logout"])).toBe(0);
    expect(loadCredentials()).toBeNull();
  });

  it("status returns 0 and prints without the secret", async () => {
    const { dispatch } = await fresh();
    const { saveCredentials } = await import("../src/credstore");
    saveCredentials({
      url: "https://c.io",
      username: "u@c",
      auth_method: "api_key",
      secret: "SUPERSECRET",
    });
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((m) => void logs.push(String(m)));
    expect(await dispatch(["status"])).toBe(0);
    spy.mockRestore();
    const out = logs.join("\n");
    expect(out).toContain("u@c");
    expect(out).not.toContain("SUPERSECRET");
  });

  it("--help returns 0", async () => {
    const { dispatch } = await fresh();
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await dispatch(["--help"])).toBe(0);
    spy.mockRestore();
  });

  it("returns exit code 2 for an unknown subcommand", async () => {
    const { dispatch } = await fresh();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await dispatch(["frobnicate"])).toBe(2);
    spy.mockRestore();
  });
});
