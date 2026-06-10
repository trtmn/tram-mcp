export interface Env {
  MCP_OBJECT: DurableObjectNamespace;
  TESTRAIL_URL?: string;
  TESTRAIL_USERNAME?: string;
  TESTRAIL_API_KEY?: string;
  TESTRAIL_PASSWORD?: string;
  /** Optional bearer token clients must present in the Authorization header. */
  MCP_AUTH_TOKEN?: string;
}

/**
 * Per-connection credentials extracted from HTTP headers on the MCP request.
 * Lets each client bring its own TestRail instance/login instead of (or in
 * addition to) the Worker-level secrets.
 */
export interface ConnectionProps {
  testrailUrl?: string;
  testrailUsername?: string;
  testrailApiKey?: string;
  testrailPassword?: string;
  [key: string]: unknown;
}

export function propsFromHeaders(headers: Headers): ConnectionProps {
  return {
    testrailUrl: headers.get("X-TestRail-URL") ?? undefined,
    testrailUsername: headers.get("X-TestRail-Username") ?? undefined,
    testrailApiKey: headers.get("X-TestRail-API-Key") ?? undefined,
    testrailPassword: headers.get("X-TestRail-Password") ?? undefined,
  };
}

export interface TestRailCredentials {
  url: string;
  username: string;
  secret: string;
  authMethod: "api_key" | "password";
}

interface ResolvedSource {
  url?: string;
  username?: string;
  apiKey?: string;
  password?: string;
}

function resolveSource(env: Env, props?: ConnectionProps): ResolvedSource {
  return {
    url: props?.testrailUrl || env.TESTRAIL_URL,
    username: props?.testrailUsername || env.TESTRAIL_USERNAME,
    // A client that supplies its own username uses only its own secret —
    // never mix one identity's login with another's key.
    apiKey: props?.testrailUsername ? props?.testrailApiKey : props?.testrailApiKey || env.TESTRAIL_API_KEY,
    password: props?.testrailUsername
      ? props?.testrailPassword
      : props?.testrailPassword || env.TESTRAIL_PASSWORD,
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
    "Provide these as Worker secrets (wrangler secret put <NAME>) or as " +
    "per-client HTTP headers (X-TestRail-URL, X-TestRail-Username, " +
    "X-TestRail-API-Key or X-TestRail-Password) in the MCP client config."
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
    authMethod: src.apiKey ? "api_key" : "password",
  };
}

/** Non-secret view of the active configuration, for diagnostics. */
export function configView(env: Env, props?: ConnectionProps): Record<string, unknown> {
  const src = resolveSource(env, props);
  return {
    url: src.url ?? null,
    username: src.username ?? null,
    auth_method: src.apiKey ? "api_key" : src.password ? "password" : "none",
    credential_source: props?.testrailUsername || props?.testrailUrl ? "per-client headers" : "worker secrets",
  };
}
