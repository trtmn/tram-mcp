import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Local, per-machine TestRail credential persistence for the stdio adapter.
 * Populated by the `tram-mcp login` wizard and read at server start. Single
 * user, single machine: the secret lives in a 0600 file, the same trust model
 * as `.env` / `gh` / `aws`.
 */

export interface StoredCreds {
  url: string;
  username: string;
  auth_method: "api_key" | "password";
  secret: string;
}

const DIR_NAME = ".tram-mcp";
const FILE_NAME = "credentials.json";

export function credentialsPath(): string {
  return join(homedir(), DIR_NAME, FILE_NAME);
}

function isStoredCreds(v: unknown): v is StoredCreds {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.url === "string" &&
    typeof c.username === "string" &&
    (c.auth_method === "api_key" || c.auth_method === "password") &&
    typeof c.secret === "string"
  );
}

export function loadCredentials(): StoredCreds | null {
  const path = credentialsPath();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return isStoredCreds(parsed) ? parsed : null;
  } catch (err) {
    console.error(
      `tram-mcp: ignoring unreadable credentials file at ${path}: ${String(err)}`,
    );
    return null;
  }
}

export function saveCredentials(creds: StoredCreds): void {
  const path = credentialsPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
}

export function clearCredentials(): void {
  rmSync(credentialsPath(), { force: true });
}
