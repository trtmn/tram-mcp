import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";

import { saveCredentials, type StoredCreds } from "./credstore";
import type { ConnectionProps, Env } from "./env";
import { getCredentials } from "./env";
import { TestRailClient, TestRailError } from "./testrail";
import { VERSION } from "./version";

/**
 * The local credential wizard. `tram-mcp login` opens a transient loopback web
 * server (added in the server section below) that serves this form, validates
 * the entry against TestRail, and saves it via the credential store. The form
 * HTML mirrors the Worker's OAuth `/authorize` page minus the OAuth envelope —
 * here the "login" is purely entering TestRail details.
 */

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

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

export function loginFormPage(
  opts: { error?: string; values?: Record<string, string>; token?: string } = {},
): string {
  const v = opts.values ?? {};
  const err = opts.error ? `<p class="err" role="alert">${escapeHtml(opts.error)}</p>` : "";
  const sel = (m: string) => (v.auth_method === m ? " selected" : "");
  // CSRF defense: the submit must echo this per-session token, which a
  // cross-origin attacker cannot read from the GET response (blocked by CORS).
  const tokenField = opts.token
    ? `<input type="hidden" name="wizard_token" value="${escapeHtml(opts.token)}">`
    : "";
  return `${htmlHead}<form class="card" method="POST" action="/submit">
  <h1>Connect to TestRail</h1>
  <p class="sub">Enter your TestRail details. They are stored only on this machine (~/.tram-mcp) and used to call TestRail directly.</p>
  ${tokenField}
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

/**
 * Validate a submitted credential form against TestRail. Returns the resolved
 * credentials on success, or a re-rendered form page (with the matching HTTP
 * status) describing what went wrong.
 */
export async function handleSubmit(fields: Record<string, string>): Promise<SubmitResult> {
  const instanceUrl = (fields.instance_url ?? "").trim();
  const username = (fields.username ?? "").trim();
  const authMethod: "api_key" | "password" =
    fields.auth_method === "password" ? "password" : "api_key";
  const secret = fields.secret ?? "";
  const token = fields.wizard_token;
  const values = { instance_url: instanceUrl, username, auth_method: authMethod };

  if (!instanceUrl || !username || !secret) {
    return {
      ok: false,
      status: 400,
      page: loginFormPage({ error: "All fields are required.", values, token }),
    };
  }

  const props: ConnectionProps = {
    testrailUrl: instanceUrl,
    testrailUsername: username,
    testrailApiKey: authMethod === "api_key" ? secret : undefined,
    testrailPassword: authMethod === "password" ? secret : undefined,
  };

  try {
    // The empty Env has no TESTRAIL_* vars, so getCredentials resolves purely
    // from the client-supplied props — validating exactly what was entered.
    await new TestRailClient(getCredentials({} as Env, props)).get("get_priorities");
  } catch (err) {
    const status = err instanceof TestRailError ? err.status : null;
    const detail =
      status === 401
        ? "TestRail rejected those credentials (HTTP 401). Check the username and API key/password."
        : status === 403
          ? "TestRail accepted the login but API access is denied (HTTP 403). Enable API access or check the account isn't locked."
          : `Couldn't reach TestRail with those details${status ? ` (HTTP ${status})` : ""}. Check the URL.`;
    return {
      ok: false,
      status: status ?? 400,
      page: loginFormPage({ error: detail, values, token }),
    };
  }

  const creds: StoredCreds = {
    url: instanceUrl.replace(/\/+$/, ""),
    username,
    auth_method: authMethod,
    secret,
  };
  return { ok: true, creds };
}

/** Best-effort open the platform browser; never throws. */
export function openBrowser(url: string): void {
  try {
    const child =
      process.platform === "win32"
        ? spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true })
        : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], {
            stdio: "ignore",
            detached: true,
          });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* fall back to the printed URL */
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Start a transient loopback server that serves the credential form and, on a
 * valid submission, persists the credentials and resolves `done`. The server
 * binds to an OS-assigned port on 127.0.0.1 only. Callers must `close()` it.
 */
export async function startWizardServer(
  opts: { save?: (c: StoredCreds) => void } = {},
): Promise<{ url: string; done: Promise<void>; close(): void }> {
  const save = opts.save ?? saveCredentials;
  // Per-session CSRF token embedded in the form and required on submit, plus a
  // Host allowlist (set after bind) so a cross-origin / DNS-rebinding page
  // cannot drive this server. Both are populated before the URL is handed out.
  const token = randomBytes(32).toString("hex");
  let allowedHosts: string[] = [];
  let resolveDone!: () => void;
  let rejectDone!: (e: Error) => void;
  const done = new Promise<void>((res, rej) => {
    resolveDone = res;
    rejectDone = rej;
  });

  const server = createServer((req, res) => {
    void (async () => {
      // Reject anything not addressed to our own loopback host:port. An
      // attacker page that rebinds its domain to 127.0.0.1 still sends its own
      // hostname in the Host header, so this defeats DNS rebinding.
      if (!allowedHosts.includes(req.headers.host ?? "")) {
        res.writeHead(403, { "content-type": "text/plain" });
        res.end("Forbidden");
        return;
      }
      const path = (req.url ?? "/").split("?")[0];
      if (req.method === "GET" && path === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(loginFormPage({ token }));
        return;
      }
      if (req.method === "POST" && path === "/submit") {
        const fields = Object.fromEntries(
          new URLSearchParams(await readBody(req)),
        ) as Record<string, string>;
        // CSRF gate: reject before any credential is saved. A cross-origin
        // attacker cannot read the token from the GET response (CORS), so
        // cannot forge a valid submit.
        if (fields.wizard_token !== token) {
          res.writeHead(403, { "content-type": "text/plain" });
          res.end("Invalid or missing session token. Reload the login page.");
          return;
        }
        const result = await handleSubmit(fields);
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
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("Internal error");
      }
      rejectDone(err instanceof Error ? err : new Error(String(err)));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Could not bind wizard server");
  allowedHosts = [`127.0.0.1:${addr.port}`, `localhost:${addr.port}`];
  const url = `http://127.0.0.1:${addr.port}/`;
  return { url, done, close: () => server.close() };
}

// A single in-flight non-blocking login session (see beginLogin). Tracked at
// module scope so a second beginLogin supersedes the first and so it can be
// cancelled (on shutdown, or in tests).
let activeLogin: { close(): void } | null = null;

/**
 * Close the active non-blocking login session, if any. Returns true when a
 * session was open (and is now closed), false when there was nothing to cancel.
 */
export function cancelPendingLogin(): boolean {
  if (!activeLogin) return false;
  activeLogin.close();
  return true;
}

/**
 * Start a login without blocking: spin up the loopback wizard, open the browser,
 * and return the URL immediately. Unlike runWizard (which the `tram-mcp login`
 * CLI uses and awaits), this is what the `testrail_login` MCP tool calls — it
 * can't block a tool call for minutes while the user fills the form. The wizard
 * stays up in the background until the user submits, the timeout elapses, or a
 * newer login supersedes it. Credentials save to the credential store, and the
 * server picks them up on the next tool call (see resolveEnv in stdio.ts).
 */
export async function beginLogin(
  opts: {
    open?: (url: string) => void;
    timeoutMs?: number;
    save?: (c: StoredCreds) => void;
  } = {},
): Promise<{ url: string }> {
  const open = opts.open ?? openBrowser;
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  // At most one active session: supersede any prior pending login.
  cancelPendingLogin();
  const server = await startWizardServer(opts.save ? { save: opts.save } : {});
  let timer: NodeJS.Timeout | undefined;
  const session = {
    close() {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (activeLogin === session) activeLogin = null;
      server.close();
    },
  };
  activeLogin = session;
  timer = setTimeout(() => session.close(), timeoutMs);
  // Don't let the timer alone keep the process alive.
  timer.unref?.();
  // Close on a successful submit (done resolves) or a server error (rejects).
  server.done.then(
    () => session.close(),
    () => session.close(),
  );
  open(server.url);
  return { url: server.url };
}

/**
 * Run the interactive login: open the browser to the credential form and wait
 * (up to `timeoutMs`) for a successful submission, then shut the server down.
 */
export async function runWizard(
  opts: { timeoutMs?: number; open?: (url: string) => void } = {},
): Promise<void> {
  const open = opts.open ?? openBrowser;
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const { url, done, close } = await startWizardServer();
  console.error(`Opening ${url} in your browser to connect TestRail…`);
  console.error("If it doesn't open, paste that URL into your browser.");
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
