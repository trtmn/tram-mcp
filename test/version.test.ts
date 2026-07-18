import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { VERSION } from "../src/version";

// VERSION is reported to MCP clients (serverInfo.version), printed by the CLI
// `--help` banner, and shown in the login wizard footer. It is hardcoded in a
// dependency-free module and bumped by release-please's `generic` updater. This
// guards against it drifting from the real package version (it once sat at the
// scaffold value "0.1.0" while the package shipped 0.7.x).
describe("VERSION", () => {
  it("matches the package.json version", () => {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});
