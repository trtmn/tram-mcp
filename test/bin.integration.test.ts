import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * End-to-end guard for the executable entry. Earlier Windows breakage (MCP
 * error -32000: Connection closed) came from an entry-point guard in cli.ts
 * that compared import.meta.url against a realpath'd process.argv[1]; on Windows
 * those differed (drive-letter casing / short paths), the guard returned false,
 * runCli was never called, and the process exited before the MCP handshake. The
 * old unit tests injected a fake resolver and so never executed the real bundle.
 *
 * This test builds dist/cli.js and RUNS it as a real subprocess — the only thing
 * that exercises the actual entry-point path on the actual platform. It would
 * fail on Windows under the old guard and passes now that the bin runs
 * unconditionally.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = join(root, "dist", "cli.js");

beforeAll(() => {
  // Build the single-file bundle the published `bin` points at.
  execFileSync(process.execPath, [join(root, "scripts", "build.mjs")], {
    cwd: root,
    stdio: "inherit",
  });
}, 60_000);

describe("built bin (dist/cli.js) runs as a subprocess", () => {
  it("emits the bundle", () => {
    expect(existsSync(bundle)).toBe(true);
  });

  it("--help prints usage and exits 0 on this platform", () => {
    // execFileSync throws on a non-zero exit; reaching the assertion means the
    // process actually started, ran runCli, and exited cleanly.
    const out = execFileSync(process.execPath, [bundle, "--help"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(out).toContain("Usage:");
    expect(out).toContain("tram-mcp");
  });
});
