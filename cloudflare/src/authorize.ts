import type { AuthRequest } from "@cloudflare/workers-oauth-provider";

import type { ConnectionProps, Env } from "./env";
import { getCredentials } from "./env";
import { TestRailClient, TestRailError } from "./testrail";
import { VERSION } from "./version";

/**
 * Default (non-API) handler for the OAuth-wrapped Worker. Serves:
 *  - `/` and `/health`: a public status JSON.
 *  - `/authorize`: the TestRail credential form (GET) and its submission (POST).
 *    The "login" the user performs IS entering their TestRail URL/username/key;
 *    OAuth is only the envelope Claude.ai/Claude Code require. On submit we
 *    validate the credentials against TestRail, then hand them to the provider
 *    as the grant `props` — they reach the MCP agent as `this.props`.
 */

function healthResponse(): Response {
  return Response.json({
    name: "TestRail MCP",
    version: VERSION,
    status: "ok",
    auth: "oauth",
    endpoints: { mcp: "/mcp", sse: "/sse", authorize: "/authorize" },
  });
}

const htmlHeaders = { "Content-Type": "text/html; charset=utf-8" };

// The parsed auth request is round-tripped through the form as an opaque
// base64url field so the POST can complete the exact grant the GET started.
function encodeReq(req: AuthRequest): string {
  return btoa(JSON.stringify(req)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodeReq(s: string): AuthRequest {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(b64)) as AuthRequest;
}

// A stable, delimiter-safe grant identity. The OAuth provider's codes/tokens
// are colon-delimited, so userId must contain no colons — a raw "url|user"
// (with "https://") would corrupt the code. A SHA-256 hex digest is safe and
// still groups grants per instance+user (for revokeExistingGrants).
async function grantUserId(instanceUrl: string, username: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${instanceUrl}|${username}`),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

function formPage(
  reqToken: string,
  clientName: string,
  opts: { error?: string; values?: Record<string, string> } = {},
): string {
  const v = opts.values ?? {};
  const err = opts.error
    ? `<p class="err" role="alert">${escapeHtml(opts.error)}</p>`
    : "";
  const sel = (m: string) => (v.auth_method === m ? " selected" : "");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect TestRail</title>
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
</style></head>
<body><form class="card" method="POST" action="/authorize">
  <h1>Connect to TestRail</h1>
  <p class="sub">${escapeHtml(clientName)} wants to access TestRail on your behalf. Your credentials are used to call TestRail and are never readable by the server operator.</p>
  ${err}
  <input type="hidden" name="oauth_req" value="${escapeHtml(reqToken)}">
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

function errorPage(message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Authorization error</title>
<style>body{font:15px/1.5 -apple-system,system-ui,sans-serif;margin:0;display:grid;min-height:100vh;place-items:center;background:#0d1117;color:#e6edf3}.card{width:min(420px,92vw);background:#161b22;border:1px solid #30363d;border-radius:12px;padding:28px}h1{font-size:18px;margin:0 0 10px}p{color:#8b949e}</style></head>
<body><div class="card"><h1>Authorization error</h1><p>${escapeHtml(message)}</p></div></body></html>`;
}

export const defaultHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") return healthResponse();

    if (url.pathname === "/authorize") {
      if (request.method === "GET") {
        try {
          const authReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
          const client = await env.OAUTH_PROVIDER.lookupClient(authReq.clientId);
          const name = client?.clientName || "An MCP client";
          return new Response(formPage(encodeReq(authReq), name), { headers: htmlHeaders });
        } catch {
          // Unregistered/expired client or malformed request — don't 500. We
          // can't safely redirect (the redirect_uri is untrusted here), so show
          // an error page telling the user to reconnect (which re-runs DCR).
          return new Response(
            errorPage(
              "This authorization request is invalid or expired — the MCP client may need to " +
                "re-register. Remove and re-add the connector to start a fresh login.",
            ),
            { status: 400, headers: htmlHeaders },
          );
        }
      }

      if (request.method === "POST") {
        const form = await request.formData();
        let authReq: AuthRequest;
        try {
          authReq = decodeReq(String(form.get("oauth_req") ?? ""));
        } catch {
          return new Response("Invalid authorization session. Restart the connection.", {
            status: 400,
          });
        }

        const instanceUrl = String(form.get("instance_url") ?? "").trim();
        const username = String(form.get("username") ?? "").trim();
        const authMethod = String(form.get("auth_method") ?? "api_key");
        const secret = String(form.get("secret") ?? "");
        const values = { instance_url: instanceUrl, username, auth_method: authMethod };

        if (!instanceUrl || !username || !secret) {
          return new Response(
            formPage(encodeReq(authReq), "An MCP client", {
              error: "All fields are required.",
              values,
            }),
            { status: 400, headers: htmlHeaders },
          );
        }

        const props: ConnectionProps = {
          testrailUrl: instanceUrl,
          testrailUsername: username,
          testrailApiKey: authMethod === "api_key" ? secret : undefined,
          testrailPassword: authMethod === "password" ? secret : undefined,
        };

        // Validate against TestRail before issuing a grant, so bad credentials
        // are rejected here rather than on the first tool call.
        try {
          await new TestRailClient(getCredentials(env, props)).get("get_priorities");
        } catch (err) {
          const status = err instanceof TestRailError ? err.status : null;
          const detail =
            status === 401
              ? "TestRail rejected those credentials (HTTP 401). Check the username and API key/password."
              : status === 403
                ? "TestRail accepted the login but API access is denied (HTTP 403). Enable API access or check the account isn't locked."
                : `Couldn't reach TestRail with those details${status ? ` (HTTP ${status})` : ""}. Check the URL.`;
          return new Response(formPage(encodeReq(authReq), "An MCP client", { error: detail, values }), {
            status: 401,
            headers: htmlHeaders,
          });
        }

        let redirectTo: string;
        try {
          ({ redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
            request: authReq,
            userId: await grantUserId(instanceUrl, username),
            metadata: { testrailUrl: instanceUrl, username },
            scope: authReq.scope,
            props,
          }));
        } catch {
          return new Response(
            errorPage(
              "Could not complete authorization (the request may have expired). " +
                "Reconnect from your MCP client and try again.",
            ),
            { status: 400, headers: htmlHeaders },
          );
        }
        return Response.redirect(redirectTo, 302);
      }
    }

    return new Response("Not found", { status: 404 });
  },
};
