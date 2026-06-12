/** Server version, in a dependency-free module so non-Worker code (e.g. the
 * OAuth authorize handler, unit tests) can import it without pulling in the
 * `agents`/`cloudflare:` runtime via mcp.ts. */
export const VERSION = "0.1.0";
