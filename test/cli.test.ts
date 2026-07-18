import { mkdtempSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isEntrypoint } from "../src/cli";

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

describe("isEntrypoint", () => {
  // Build a platform-valid absolute file URL. Windows file URLs require a drive
  // letter, so a hardcoded POSIX "file:///abs/..." string can't be parsed by
  // fileURLToPath there — derive both the URL and its path form from a real
  // absolute path so they round-trip on every platform.
  const seed =
    process.platform === "win32" ? "C:\\abs\\pkg\\dist\\cli.js" : "/abs/pkg/dist/cli.js";
  const meta = pathToFileURL(seed).href;
  const real = fileURLToPath(meta); // e.g. /abs/pkg/dist/cli.js or C:\abs\pkg\dist\cli.js

  it("true when run directly (argv1 is the real path)", () => {
    expect(isEntrypoint(real, meta, (p) => p)).toBe(true);
  });

  it("true when run via a bin symlink (regression: npx tram-mcp)", () => {
    // node_modules/.bin/tram-mcp is a symlink resolving to the real dist/cli.js
    expect(isEntrypoint("/proj/node_modules/.bin/tram-mcp", meta, () => real)).toBe(true);
  });

  it("false when argv1 resolves elsewhere (imported, not the entry)", () => {
    expect(isEntrypoint("/proj/other.js", meta, (p) => p)).toBe(false);
  });

  it("false when argv1 is missing", () => {
    expect(isEntrypoint(undefined, meta)).toBe(false);
  });

  it("false (no throw) when the path can't be resolved", () => {
    expect(
      isEntrypoint("/missing", meta, () => {
        throw new Error("ENOENT");
      }),
    ).toBe(false);
  });
});

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
