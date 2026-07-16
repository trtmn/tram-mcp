import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpHome: string;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "tram-cred-"));
  vi.stubEnv("HOME", tmpHome);
  vi.stubEnv("USERPROFILE", tmpHome); // Windows homedir source
});
afterEach(() => vi.unstubAllEnvs());

async function fresh() {
  vi.resetModules();
  return import("../src/credstore");
}

describe("credstore", () => {
  it("round-trips credentials", async () => {
    const { saveCredentials, loadCredentials } = await fresh();
    const creds = {
      url: "https://c.testrail.io",
      username: "u@c.com",
      auth_method: "api_key" as const,
      secret: "k",
    };
    saveCredentials(creds);
    expect(loadCredentials()).toEqual(creds);
  });

  it("returns null when no file exists", async () => {
    const { loadCredentials } = await fresh();
    expect(loadCredentials()).toBeNull();
  });

  it("returns null (does not throw) on a corrupt file", async () => {
    const { saveCredentials, credentialsPath, loadCredentials } = await fresh();
    saveCredentials({ url: "x", username: "y", auth_method: "api_key", secret: "z" });
    writeFileSync(credentialsPath(), "{ not json");
    expect(loadCredentials()).toBeNull();
  });

  it("writes the file with 0600 permissions", async () => {
    const { saveCredentials, credentialsPath } = await fresh();
    saveCredentials({ url: "x", username: "y", auth_method: "password", secret: "z" });
    const mode = statSync(credentialsPath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("clearCredentials removes the file and is idempotent", async () => {
    const { saveCredentials, clearCredentials, loadCredentials } = await fresh();
    saveCredentials({ url: "x", username: "y", auth_method: "api_key", secret: "z" });
    clearCredentials();
    expect(loadCredentials()).toBeNull();
    expect(() => clearCredentials()).not.toThrow();
  });
});
