import type { Env } from "./env";

function unauthorized(message: string): Response {
  return Response.json({ error: message }, { status: 401 });
}

/** Constant-time string comparison to avoid leaking the token via timing. */
export async function tokensMatch(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  // Hashing both sides yields fixed-length digests, so the byte compare below
  // runs in time independent of where the inputs first differ (and of their
  // lengths). crypto.subtle is available in the Workers runtime and Node 18+.
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(da);
  const vb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

/**
 * When MCP_AUTH_TOKEN is set, clients must send it as a bearer token.
 * Without it the Worker is open — fine for testing, not recommended for
 * production since the Worker holds TestRail credentials.
 *
 * Returns a 401 Response to send back, or null when the request may proceed.
 */
export async function checkAuth(request: Request, env: Env): Promise<Response | null> {
  if (!env.MCP_AUTH_TOKEN) return null;
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !(await tokensMatch(token, env.MCP_AUTH_TOKEN))) {
    return unauthorized(
      "Missing or invalid bearer token. Send 'Authorization: Bearer <MCP_AUTH_TOKEN>'.",
    );
  }
  return null;
}
