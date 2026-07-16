# Local TestRail MCP Browser Credential Wizard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let coworkers run the TestRail MCP locally over stdio, entering credentials once through a browser form (`tram-mcp login`) instead of editing client config.

**Architecture:** Add a local CLI + credential-wizard path to the existing shared TypeScript core (in `cloudflare/`), beside the Cloudflare Worker adapter. stdio is the transport; a transient loopback web server captures and validates credentials, storing them in `~/.tram-mcp/credentials.json`. The tools/testrail/env core is reused unchanged.

**Tech Stack:** TypeScript, Node ≥ 22, `@modelcontextprotocol/sdk` (stdio transport + in-memory transport for tests), node `http`, vitest, esbuild.

## Global Constraints

- Node ≥ 22 (core relies on global `fetch`, `btoa`, `crypto.subtle`).
- All new files live in `cloudflare/src/`; tests in `cloudflare/test/`.
- Credentials file: `~/.tram-mcp/credentials.json`, directory mode `0700`, file mode `0600`.
- Secrets never on argv, stdout, or in logs.
- TestRail validation call is `get_priorities` (matches `authorize.ts`).
- Do not modify the Worker adapter (`index.ts`, `mcp.ts`, `authorize.ts`) except to export reusable helpers.
- Existing 68 tests must stay green.
- Commit messages: no `Co-Authored-By` lines (repo rule).
- Run all commands from `cloudflare/`.

---

### Task 1: Credential store (`credstore.ts`)

**Files:**
- Create: `cloudflare/src/credstore.ts`
- Test: `cloudflare/test/credstore.test.ts`

**Interfaces:**
- Produces:
  - `interface StoredCreds { url: string; username: string; auth_method: "api_key" | "password"; secret: string }`
  - `credentialsPath(): string`
  - `loadCredentials(): StoredCreds | null`
  - `saveCredentials(creds: StoredCreds): void`
  - `clearCredentials(): void`

- [ ] **Step 1: Write the failing tests**

```ts
// cloudflare/test/credstore.test.ts
import { mkdtempSync, readFileSync, statSync } from "node:fs";
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
    const creds = { url: "https://c.testrail.io", username: "u@c.com", auth_method: "api_key" as const, secret: "k" };
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
    require("node:fs").writeFileSync(credentialsPath(), "{ not json");
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- credstore`
Expected: FAIL (cannot resolve `../src/credstore`).

- [ ] **Step 3: Implement `credstore.ts`**

```ts
// cloudflare/src/credstore.ts
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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
    console.error(`tram-mcp: ignoring unreadable credentials file at ${path}: ${String(err)}`);
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- credstore`
Expected: PASS (5 tests). Note: the 0600 assertion is POSIX-only; it holds on macOS/Linux (the dev + CI platforms).

- [ ] **Step 5: Commit**

```bash
git add src/credstore.ts test/credstore.test.ts
git commit -m "feat: add local credential store for stdio adapter"
```

---

### Task 2: Wizard form + submit logic (`wizard.ts` pure core)

**Files:**
- Create: `cloudflare/src/wizard.ts`
- Modify: `cloudflare/src/authorize.ts` (export `escapeHtml`)
- Test: `cloudflare/test/wizard.test.ts`

**Interfaces:**
- Consumes: `StoredCreds` from `credstore`; `TestRailClient`, `TestRailError` from `testrail`; `getCredentials`, `ConnectionProps`, `Env` from `env`; `escapeHtml` from `authorize`.
- Produces:
  - `loginFormPage(opts?: { error?: string; values?: Record<string, string> }): string`
  - `successPage(): string`
  - `interface SubmitResult { ok: true; creds: StoredCreds } | { ok: false; page: string; status: number }`
  - `handleSubmit(fields: Record<string, string>): Promise<SubmitResult>`

- [ ] **Step 1: Export `escapeHtml` from `authorize.ts`**

In `cloudflare/src/authorize.ts`, change `function escapeHtml` to `export function escapeHtml` (line ~52). No other change.

- [ ] **Step 2: Write the failing tests**

```ts
// cloudflare/test/wizard.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleSubmit, loginFormPage } from "../src/wizard";

afterEach(() => vi.unstubAllGlobals());

function okFetch() {
  return vi.fn(async () => new Response(JSON.stringify([{ id: 1 }]), { status: 200 }));
}

describe("loginFormPage", () => {
  it("renders the TestRail form with a masked secret field and no OAuth field", () => {
    const html = loginFormPage();
    expect(html).toContain("Connect to TestRail");
    expect(html).toContain('name="secret"');
    expect(html).toContain('type="password"');
    expect(html).toContain('action="/submit"');
    expect(html).not.toContain("oauth_req");
  });

  it("shows an error banner and preserves entered values", () => {
    const html = loginFormPage({ error: "Bad creds", values: { username: "u@c.com" } });
    expect(html).toContain("Bad creds");
    expect(html).toContain("u@c.com");
  });
});

describe("handleSubmit", () => {
  it("saves and returns creds when TestRail validates", async () => {
    vi.stubGlobal("fetch", okFetch());
    const res = await handleSubmit({
      instance_url: "https://c.testrail.io/",
      username: "u@c.com",
      auth_method: "api_key",
      secret: "k",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.creds).toEqual({
        url: "https://c.testrail.io",
        username: "u@c.com",
        auth_method: "api_key",
        secret: "k",
      });
    }
  });

  it("rejects missing fields with a 400 form page", async () => {
    const res = await handleSubmit({ instance_url: "", username: "", auth_method: "api_key", secret: "" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(400);
      expect(res.page).toContain("All fields are required");
    }
  });

  it("maps a TestRail 401 to a credential error page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    const res = await handleSubmit({
      instance_url: "https://c.testrail.io",
      username: "u@c.com",
      auth_method: "api_key",
      secret: "bad",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(401);
      expect(res.page).toContain("rejected those credentials");
    }
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- wizard`
Expected: FAIL (cannot resolve `../src/wizard`).

- [ ] **Step 4: Implement `wizard.ts` pure core**

```ts
// cloudflare/src/wizard.ts  (pure core — HTTP server added in Task 3)
import type { StoredCreds } from "./credstore";
import type { ConnectionProps, Env } from "./env";
import { getCredentials } from "./env";
import { escapeHtml } from "./authorize";
import { TestRailClient, TestRailError } from "./testrail";
import { VERSION } from "./version";

const htmlHead = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect TestRail</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 -apple-system, system-ui, sans-serif; margin: 0; display: grid; min-height: 100vh; place-items: center; background: #0d1117; color: #e6edf3; }
  .card { width: min(420px, 92vw); background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 28px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .sub { color: #8b949e; font-size: 13px; margin: 0 0 20px; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 14px 0 4px; }
  input, select { width: 100%; box-sizing: border-box; padding: 9px 10px; border-radius: 7px; border: 1px solid #30363d; background: #0d1117; color: #e6edf3; font-size: 14px; }
  .hint { color: #8b949e; font-size: 12px; margin: 4px 0 0; }
  button { width: 100%; margin-top: 20px; padding: 10px; border: 0; border-radius: 7px; background: #238636; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; }
  button:hover { background: #2ea043; }
  .err { background: #3d1418; border: 1px solid #8b2a32; color: #ffb4ba; padding: 9px 11px; border-radius: 7px; font-size: 13px; margin: 0 0 12px; }
  .foot { color: #8b949e; font-size: 12px; margin-top: 16px; text-align: center; }
</style></head><body>`;

export function loginFormPage(opts: { error?: string; values?: Record<string, string> } = {}): string {
  const v = opts.values ?? {};
  const err = opts.error ? `<p class="err" role="alert">${escapeHtml(opts.error)}</p>` : "";
  const sel = (m: string) => (v.auth_method === m ? " selected" : "");
  return `${htmlHead}<form class="card" method="POST" action="/submit">
  <h1>Connect to TestRail</h1>
  <p class="sub">Enter your TestRail details. They are stored only on this machine (~/.tram-mcp) and used to call TestRail directly.</p>
  ${err}
  <label for="instance_url">TestRail URL</label>
  <input id="instance_url" name="instance_url" type="url" required placeholder="https://yourcompany.testrail.io" value="${escapeHtml(v.instance_url ?? "")}">
  <label for="username">Username / email</label>
  <input id="username" name="username" type="text" required autocomplete="username" value="${escapeHtml(v.username ?? "")}">
  <label for="auth_method">Authentication</label>
  <select id="auth_method" name="auth_method">
    <option value="api_key"${sel("api_key")}>API key (recommended)</option>
    <option value="password"${sel("password")}>Password</option>
  </select>
  <p class="hint">Generate an API key under My Settings &gt; API Keys in TestRail.</p>
  <label for="secret">API key or password</label>
  <input id="secret" name="secret" type="password" required autocomplete="current-password">
  <button type="submit">Connect</button>
  <p class="foot">TestRail MCP v${escapeHtml(VERSION)}</p>
</form></body></html>`;
}

export function successPage(): string {
  return `${htmlHead}<div class="card"><h1>Connected to TestRail</h1>
  <p class="sub">Credentials saved to ~/.tram-mcp. You can close this tab and return to your MCP client.</p>
  </div></body></html>`;
}

export type SubmitResult =
  | { ok: true; creds: StoredCreds }
  | { ok: false; page: string; status: number };

/** Validate a submitted form against TestRail; return creds or a re-render. */
export async function handleSubmit(fields: Record<string, string>): Promise<SubmitResult> {
  const instanceUrl = (fields.instance_url ?? "").trim();
  const username = (fields.username ?? "").trim();
  const authMethod = fields.auth_method === "password" ? "password" : "api_key";
  const secret = fields.secret ?? "";
  const values = { instance_url: instanceUrl, username, auth_method: authMethod };

  if (!instanceUrl || !username || !secret) {
    return { ok: false, status: 400, page: loginFormPage({ error: "All fields are required.", values }) };
  }

  const props: ConnectionProps = {
    testrailUrl: instanceUrl,
    testrailUsername: username,
    testrailApiKey: authMethod === "api_key" ? secret : undefined,
    testrailPassword: authMethod === "password" ? secret : undefined,
  };

  try {
    // env has no TESTRAIL_* here, so getCredentials resolves purely from props.
    await new TestRailClient(getCredentials({} as Env, props)).get("get_priorities");
  } catch (err) {
    const status = err instanceof TestRailError ? err.status : null;
    const detail =
      status === 401
        ? "TestRail rejected those credentials (HTTP 401). Check the username and API key/password."
        : status === 403
          ? "TestRail accepted the login but API access is denied (HTTP 403). Enable API access or check the account isn't locked."
          : `Couldn't reach TestRail with those details${status ? ` (HTTP ${status})` : ""}. Check the URL.`;
    return { ok: false, status: status ?? 400, page: loginFormPage({ error: detail, values }) };
  }

  const creds: StoredCreds = {
    url: instanceUrl.replace(/\/+$/, ""),
    username,
    auth_method: authMethod,
    secret,
  };
  return { ok: true, creds };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- wizard`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/wizard.ts src/authorize.ts test/wizard.test.ts
git commit -m "feat: add credential form + submit validation for local login"
```

---

### Task 3: Wizard HTTP server + browser launch (`runWizard`)

**Files:**
- Modify: `cloudflare/src/wizard.ts` (append server + browser helpers)
- Test: `cloudflare/test/wizard-server.test.ts`

**Interfaces:**
- Consumes: `handleSubmit`, `loginFormPage`, `successPage` from Task 2; `saveCredentials` from `credstore`.
- Produces:
  - `openBrowser(url: string): void`
  - `startWizardServer(opts?: { save?: (c: StoredCreds) => void }): Promise<{ url: string; done: Promise<void>; close(): void }>`
  - `runWizard(opts?: { timeoutMs?: number; open?: (url: string) => void }): Promise<void>`

- [ ] **Step 1: Write the failing test (drive the server over real loopback HTTP)**

```ts
// cloudflare/test/wizard-server.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { startWizardServer } from "../src/wizard";

afterEach(() => vi.unstubAllGlobals());

describe("startWizardServer", () => {
  it("serves the form at GET / and saves creds on a valid POST /submit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })));
    const saved: unknown[] = [];
    const { url, done, close } = await startWizardServer({ save: (c) => saved.push(c) });

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
    close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- wizard-server`
Expected: FAIL (`startWizardServer` not exported).

- [ ] **Step 3: Append server + browser helpers to `wizard.ts`**

```ts
// cloudflare/src/wizard.ts  (append)
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { saveCredentials, type StoredCreds } from "./credstore";

/** Best-effort open the platform browser; never throws. */
export function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    const child =
      process.platform === "win32"
        ? spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true })
        : spawn(cmd, [url], { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* fall back to the printed URL */
  }
}

async function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function startWizardServer(
  opts: { save?: (c: StoredCreds) => void } = {},
): Promise<{ url: string; done: Promise<void>; close(): void }> {
  const save = opts.save ?? saveCredentials;
  let resolveDone!: () => void;
  let rejectDone!: (e: Error) => void;
  const done = new Promise<void>((res, rej) => {
    resolveDone = res;
    rejectDone = rej;
  });

  const server = createServer((req, res) => {
    (async () => {
      const path = (req.url ?? "/").split("?")[0];
      if (req.method === "GET" && path === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(loginFormPage());
        return;
      }
      if (req.method === "POST" && path === "/submit") {
        const fields = Object.fromEntries(new URLSearchParams(await readBody(req)));
        const result = await handleSubmit(fields as Record<string, string>);
        if (result.ok) {
          save(result.creds);
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(successPage());
          resolveDone();
          return;
        }
        res.writeHead(result.status, { "content-type": "text/html; charset=utf-8" });
        res.end(result.page);
        return;
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
    })().catch((err) => {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("Internal error");
      rejectDone(err instanceof Error ? err : new Error(String(err)));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Could not bind wizard server");
  const url = `http://127.0.0.1:${addr.port}/`;
  return { url, done, close: () => server.close() };
}

export async function runWizard(
  opts: { timeoutMs?: number; open?: (url: string) => void } = {},
): Promise<void> {
  const open = opts.open ?? openBrowser;
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const { url, done, close } = await startWizardServer();
  console.error(`Opening ${url} in your browser to connect TestRail…`);
  console.error(`If it doesn't open, paste that URL into your browser.`);
  open(url);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error("Login timed out after 5 minutes.")), timeoutMs);
  });
  try {
    await Promise.race([done, timeout]);
    console.error("TestRail credentials saved. You're all set.");
  } finally {
    if (timer) clearTimeout(timer);
    close();
  }
}
```

Note: move the three `import` lines added above to the top of the file with the other imports (esbuild/tsc require top-level imports); they are shown here for locality.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- wizard-server`
Expected: PASS (1 test). Also run `npm test -- wizard` — still PASS.

- [ ] **Step 5: Commit**

```bash
git add src/wizard.ts test/wizard-server.test.ts
git commit -m "feat: add loopback wizard server and browser launch for local login"
```

---

### Task 4: stdio credential resolution (env → credstore → none)

**Files:**
- Modify: `cloudflare/src/stdio.ts`
- Modify: `cloudflare/src/env.ts` (transport-aware missing-config hint)
- Test: `cloudflare/test/stdio.test.ts` (extend)

**Interfaces:**
- Consumes: `loadCredentials`, `StoredCreds` from `credstore`.
- Produces: `resolveLocalEnv(processEnv?: NodeJS.ProcessEnv): Env` (replaces the internal use of `envFromProcess`; keep `envFromProcess` exported for the existing tests).

- [ ] **Step 1: Make the missing-config hint transport-aware in `env.ts`**

Replace the return in `checkConfig` (lines ~86-92) so a local run (no `OAUTH_PROVIDER` binding) points at `tram-mcp login`:

```ts
  if (missing.length === 0) return null;
  const hint = env.OAUTH_PROVIDER
    ? "Reconnect the MCP server and complete the TestRail login form during the OAuth authorization step to provide your instance URL, username, and API key or password."
    : "Run `tram-mcp login` to enter your TestRail URL, username, and API key — or set TESTRAIL_URL, TESTRAIL_USERNAME, and TESTRAIL_API_KEY (or TESTRAIL_PASSWORD) in the environment.";
  return `Missing TestRail configuration: ${missing.join(", ")}. ${hint}`;
```

- [ ] **Step 2: Write the failing tests (extend `stdio.test.ts`)**

```ts
// append to cloudflare/test/stdio.test.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach as afterEachR, beforeEach as beforeEachR, vi } from "vitest";

describe("resolveLocalEnv", () => {
  let tmpHome: string;
  beforeEachR(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "tram-stdio-"));
    vi.stubEnv("HOME", tmpHome);
    vi.stubEnv("USERPROFILE", tmpHome);
  });
  afterEachR(() => vi.unstubAllEnvs());

  async function fresh() {
    vi.resetModules();
    return {
      stdio: await import("../src/stdio"),
      credstore: await import("../src/credstore"),
    };
  }

  it("prefers complete process.env credentials over the stored file", async () => {
    const { stdio, credstore } = await fresh();
    credstore.saveCredentials({ url: "https://file.testrail.io", username: "file@c", auth_method: "api_key", secret: "fk" });
    const env = stdio.resolveLocalEnv({
      TESTRAIL_URL: "https://env.testrail.io",
      TESTRAIL_USERNAME: "env@c",
      TESTRAIL_API_KEY: "ek",
    } as NodeJS.ProcessEnv);
    expect(env.TESTRAIL_URL).toBe("https://env.testrail.io");
    expect(env.TESTRAIL_API_KEY).toBe("ek");
  });

  it("falls back to the stored file when process.env is incomplete", async () => {
    const { stdio, credstore } = await fresh();
    credstore.saveCredentials({ url: "https://file.testrail.io", username: "file@c", auth_method: "password", secret: "fp" });
    const env = stdio.resolveLocalEnv({} as NodeJS.ProcessEnv);
    expect(env.TESTRAIL_URL).toBe("https://file.testrail.io");
    expect(env.TESTRAIL_PASSWORD).toBe("fp");
    expect(env.TESTRAIL_API_KEY).toBeUndefined();
  });

  it("yields empty credentials when neither source is present", async () => {
    const { stdio } = await fresh();
    const env = stdio.resolveLocalEnv({} as NodeJS.ProcessEnv);
    expect(env.TESTRAIL_URL).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- stdio`
Expected: FAIL (`resolveLocalEnv` not exported).

- [ ] **Step 4: Implement `resolveLocalEnv` in `stdio.ts`**

Add imports at top: `import { loadCredentials } from "./credstore";`

Add the function and switch `main()`/`buildStdioServer` default to it:

```ts
/** True when process.env supplies a complete TestRail credential set. */
function envIsComplete(e: NodeJS.ProcessEnv): boolean {
  return !!(e.TESTRAIL_URL && e.TESTRAIL_USERNAME && (e.TESTRAIL_API_KEY || e.TESTRAIL_PASSWORD));
}

/**
 * Resolve local credentials with precedence: a complete process.env set wins
 * (preserves .env / op run / CI); otherwise the wizard-populated credstore
 * file; otherwise an empty Env (tools return a "run tram-mcp login" message).
 */
export function resolveLocalEnv(processEnv: NodeJS.ProcessEnv = process.env): Env {
  if (envIsComplete(processEnv)) return envFromProcess(processEnv);
  const stored = loadCredentials();
  if (stored) {
    return {
      TESTRAIL_URL: stored.url,
      TESTRAIL_USERNAME: stored.username,
      TESTRAIL_API_KEY: stored.auth_method === "api_key" ? stored.secret : undefined,
      TESTRAIL_PASSWORD: stored.auth_method === "password" ? stored.secret : undefined,
    } as Env;
  }
  return envFromProcess(processEnv);
}
```

Change `buildStdioServer(env: Env = envFromProcess())` to `buildStdioServer(env: Env = resolveLocalEnv())`, and `main()` to `const server = buildStdioServer(resolveLocalEnv());`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- stdio`
Expected: PASS (existing + 3 new). Then `npm test` (all) — 68 + new all green. Then `npm run check` — tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/stdio.ts src/env.ts test/stdio.test.ts
git commit -m "feat: resolve stdio credentials from env then local store"
```

---

### Task 5: CLI entry (`cli.ts`) + packaging

**Files:**
- Create: `cloudflare/src/cli.ts`
- Modify: `cloudflare/package.json` (bin + build:cli script)
- Test: `cloudflare/test/cli.test.ts`

**Interfaces:**
- Consumes: `runWizard` from `wizard`; `clearCredentials`, `loadCredentials` from `credstore`; `resolveLocalEnv` + `main` (stdio) from `stdio`; `configView` from `env`.
- Produces: `dispatch(argv: string[]): Promise<number | "server">` — returns `"server"` for the no-subcommand case (caller starts the stdio server), else a process exit code. `runCli(argv): Promise<void>` wires it to real process start/exit.

- [ ] **Step 1: Write the failing tests**

```ts
// cloudflare/test/cli.test.ts
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
    saveCredentials({ url: "https://c.io", username: "u@c", auth_method: "api_key", secret: "SUPERSECRET" });
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((m) => void logs.push(String(m)));
    expect(await dispatch(["status"])).toBe(0);
    spy.mockRestore();
    const out = logs.join("\n");
    expect(out).toContain("u@c");
    expect(out).not.toContain("SUPERSECRET");
  });

  it("returns exit code 2 for an unknown subcommand", async () => {
    const { dispatch } = await fresh();
    expect(await dispatch(["frobnicate"])).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- cli`
Expected: FAIL (cannot resolve `../src/cli`).

- [ ] **Step 3: Implement `cli.ts`**

```ts
// cloudflare/src/cli.ts
import { pathToFileURL } from "node:url";

import { clearCredentials } from "./credstore";
import { configView } from "./env";
import { main as runStdioServer } from "./stdio";
import { resolveLocalEnv } from "./stdio";
import { runWizard } from "./wizard";
import { VERSION } from "./version";

const USAGE = `tram-mcp v${VERSION}
Usage:
  tram-mcp            Run the TestRail MCP server over stdio (default; launched by your MCP client)
  tram-mcp login      Open a browser to enter and save your TestRail credentials
  tram-mcp logout     Remove saved credentials
  tram-mcp status     Show the active (non-secret) configuration
  tram-mcp --help     Show this help`;

/** Returns "server" when the caller should start the stdio server, else an exit code. */
export async function dispatch(argv: string[]): Promise<number | "server"> {
  const cmd = argv[0];
  switch (cmd) {
    case undefined:
      return "server";
    case "login":
      await runWizard();
      return 0;
    case "logout":
      clearCredentials();
      console.log("Removed saved TestRail credentials.");
      return 0;
    case "status": {
      const view = configView(resolveLocalEnv(), undefined);
      console.log(JSON.stringify(view, null, 2));
      return 0;
    }
    case "-h":
    case "--help":
      console.log(USAGE);
      return 0;
    default:
      console.error(`Unknown command: ${cmd}\n\n${USAGE}`);
      return 2;
  }
}

export async function runCli(argv: string[]): Promise<void> {
  const result = await dispatch(argv);
  if (result === "server") {
    await runStdioServer();
    return;
  }
  process.exitCode = result;
}

const invokedDirectly =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  runCli(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- cli`
Expected: PASS (4 tests).

- [ ] **Step 5: Point the bin at the CLI and add its build step**

In `cloudflare/package.json`:
- change `"bin": { "tram-mcp": "dist/stdio.js" }` → `"bin": { "tram-mcp": "dist/cli.js" }`
- add script: `"build:cli": "esbuild src/cli.ts --bundle --platform=node --format=esm --target=node22 --outfile=dist/cli.js --banner:js='#!/usr/bin/env node'"`

- [ ] **Step 6: Build and smoke-test the bin**

Run:
```bash
npm run build:cli
node dist/cli.js --help
node dist/cli.js status
```
Expected: `--help` prints usage; `status` prints JSON with `credential_source` and no secret.

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts test/cli.test.ts package.json
git commit -m "feat: add tram-mcp CLI with login/logout/status subcommands"
```

---

### Task 6: Coworker setup docs

**Files:**
- Modify: `cloudflare/README.md` (add a "Run locally (stdio + browser login)" section)

**Interfaces:** none (docs only).

- [ ] **Step 1: Add the local-run section to `cloudflare/README.md`**

Insert after the existing intro/TOC a section covering both clients:

````markdown
## Run locally (stdio + browser login)

Run the server on your own machine — no Cloudflare account, no HTTPS, no OAuth.

### 1. Save your TestRail credentials (once)

```bash
npx tram-mcp login
```

A browser tab opens. Enter your TestRail URL, username, and an **API key**
(My Settings → API Keys in TestRail). They are validated against TestRail and
saved to `~/.tram-mcp/credentials.json` (readable only by you). Re-run any time
to update them; `npx tram-mcp logout` removes them.

### 2. Connect your client

**Claude Code**

```bash
claude mcp add tram-mcp -- npx -y tram-mcp
```

**Claude Desktop** — install the `.mcpb` bundle from the latest release, then run
`npx tram-mcp login` once (step 1 above).

### 3. Verify

```bash
npx tram-mcp status
```

Shows the active URL / username / auth method (never the secret). Power users can
skip the wizard entirely by setting `TESTRAIL_URL`, `TESTRAIL_USERNAME`, and
`TESTRAIL_API_KEY` (or `TESTRAIL_PASSWORD`) in the environment — those take
precedence over the saved file.
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document local stdio + browser-login setup for coworkers"
```

---

## Self-Review

**Spec coverage:**
- credstore → Task 1. ✓
- wizard form + validation → Task 2. ✓
- wizard server + browser open + timeout → Task 3. ✓
- stdio precedence (env → file → none) + transport-aware hint → Task 4. ✓
- CLI (`login`/`logout`/`status`/default server) + bin/build → Task 5. ✓
- Coworker docs (both clients, env override note, security note) → Task 6. ✓
- Distribution `.mcpb`: README references it (Task 6); building/attaching the TS `.mcpb` is noted as deferred packaging work below.
- Out-of-scope items (Python removal, local OAuth, rename, binary, keychain) — not tasked, per spec. ✓

**Placeholder scan:** No TBD/TODO; every code step has full code. ✓

**Type consistency:** `StoredCreds` shape identical across Tasks 1/2/3/4/5. `resolveLocalEnv`, `handleSubmit`, `SubmitResult`, `startWizardServer`, `runWizard`, `dispatch` names consistent between definition and use. ✓

**Deferred packaging note:** producing and attaching a TypeScript `.mcpb` in CI (sibling to the Python one) is not yet tasked — the README points coworkers at it. If a TS `.mcpb` doesn't exist at ship time, Desktop coworkers use `npx tram-mcp` via a manual stdio server entry instead. Flag for follow-up.
