import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  MCP_OBJECT: DurableObjectNamespace;
  /** KV namespace required by workers-oauth-provider for token/grant storage. */
  OAUTH_KV: KVNamespace;
  /** OAuth helper API injected by the OAuthProvider wrapper into handler env. */
  OAUTH_PROVIDER: OAuthHelpers;
  TESTRAIL_URL?: string;
  TESTRAIL_USERNAME?: string;
  TESTRAIL_API_KEY?: string;
  TESTRAIL_PASSWORD?: string;
}

/**
 * Per-connection TestRail credentials. Under the OAuth flow these are the grant
 * `props` (set by the /authorize handler and surfaced as `McpAgent.props`);
 * resolution falls back to the Worker env vars only when a grant supplies none.
 */
export interface ConnectionProps {
  testrailUrl?: string;
  testrailUsername?: string;
  testrailApiKey?: string;
  testrailPassword?: string;
  [key: string]: unknown;
}

export interface TestRailCredentials {
  url: string;
  username: string;
  secret: string;
}

interface ResolvedSource {
  url?: string;
  username?: string;
  apiKey?: string;
  password?: string;
}

/** True when the client supplied any TestRail credential field via props. */
function clientSupplied(props?: ConnectionProps): boolean {
  return (
    !!props &&
    !!(
      props.testrailUrl ||
      props.testrailUsername ||
      props.testrailApiKey ||
      props.testrailPassword
    )
  );
}

function resolveSource(env: Env, props?: ConnectionProps): ResolvedSource {
  // All-or-nothing per source. If the client supplies ANY credential field,
  // the entire connection is resolved from the client props with NO fallback
  // to the Worker secrets — and vice versa. Mixing sources (e.g. a
  // client-supplied URL paired with the Worker's own username + key) would
  // transmit the Worker's credentials as Basic auth to a client-controlled
  // host, leaking them. The two identities are therefore never combined.
  if (clientSupplied(props)) {
    return {
      url: props!.testrailUrl,
      username: props!.testrailUsername,
      apiKey: props!.testrailApiKey,
      password: props!.testrailPassword,
    };
  }
  return {
    url: env.TESTRAIL_URL,
    username: env.TESTRAIL_USERNAME,
    apiKey: env.TESTRAIL_API_KEY,
    password: env.TESTRAIL_PASSWORD,
  };
}

/** Returns an error message listing missing config, or null when complete. */
export function checkConfig(env: Env, props?: ConnectionProps): string | null {
  const src = resolveSource(env, props);
  const missing: string[] = [];
  if (!src.url) missing.push("TESTRAIL_URL");
  if (!src.username) missing.push("TESTRAIL_USERNAME");
  if (!src.apiKey && !src.password) {
    missing.push("TESTRAIL_API_KEY or TESTRAIL_PASSWORD");
  }
  if (missing.length === 0) return null;
  return (
    `Missing TestRail configuration: ${missing.join(", ")}. ` +
    "Reconnect the MCP server and complete the TestRail login form during the " +
    "OAuth authorization step to provide your instance URL, username, and API " +
    "key or password."
  );
}

export function getCredentials(env: Env, props?: ConnectionProps): TestRailCredentials {
  const error = checkConfig(env, props);
  if (error) throw new Error(error);
  const src = resolveSource(env, props);
  return {
    url: src.url!.replace(/\/+$/, ""),
    username: src.username!,
    secret: (src.apiKey ?? src.password)!,
  };
}

/** Non-secret view of the active configuration, for diagnostics. */
export function configView(env: Env, props?: ConnectionProps): Record<string, unknown> {
  const src = resolveSource(env, props);
  return {
    url: src.url ?? null,
    username: src.username ?? null,
    auth_method: src.apiKey ? "api_key" : src.password ? "password" : "none",
    credential_source: clientSupplied(props) ? "per-client" : "worker secrets",
  };
}
