import { escapeHtml } from "./authorize";
import type { StoredCreds } from "./credstore";
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
  opts: { error?: string; values?: Record<string, string> } = {},
): string {
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
  const values = { instance_url: instanceUrl, username, auth_method: authMethod };

  if (!instanceUrl || !username || !secret) {
    return {
      ok: false,
      status: 400,
      page: loginFormPage({ error: "All fields are required.", values }),
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
