/** The TestRail credential environment (from process.env or the credential store). */
export interface Env {
  TESTRAIL_URL?: string;
  TESTRAIL_USERNAME?: string;
  TESTRAIL_API_KEY?: string;
  TESTRAIL_PASSWORD?: string;
}

/**
 * Client-supplied TestRail credentials, resolved in preference to the `Env`.
 * The login wizard builds these from the submitted form to validate an entry
 * against TestRail before saving it (see wizard.ts).
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
  // All-or-nothing per source. If the client supplies ANY credential field, the
  // entire connection is resolved from those props with NO fallback to the
  // environment — and vice versa. Mixing sources (e.g. a client-supplied URL
  // paired with the environment's username + key) would send the environment's
  // credentials as Basic auth to a client-controlled host, leaking them.
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
  const hint =
    "Run `tram-mcp login` to enter your TestRail URL, username, and API key — " +
    "or set TESTRAIL_URL, TESTRAIL_USERNAME, and TESTRAIL_API_KEY (or " +
    "TESTRAIL_PASSWORD) in the environment.";
  return `Missing TestRail configuration: ${missing.join(", ")}. ${hint}`;
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
    credential_source: clientSupplied(props) ? "per-client" : "local (env or ~/.tram-mcp)",
  };
}
