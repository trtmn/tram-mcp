import rawCatalog from "./catalog.json";
import type { Json, QueryParams, TestRailClient } from "./testrail";

export interface CatalogParam {
  name: string;
  required: boolean;
  type?: string;
  default?: string;
}

export interface CatalogHttp {
  verb: "GET" | "POST";
  endpoint: string;
  pathParams: string[];
}

/**
 * A method is EITHER directly dispatchable (`http`) OR explained-as-unsupported
 * (`unsupported`) — never both, never neither. The catalog generator guarantees
 * this XOR structurally; the discriminated union makes the illegal states
 * ("both"/"neither") unrepresentable for consumers. `assertCatalogInvariant`
 * verifies the loaded JSON actually conforms.
 */
export type CatalogMethod = { doc: string; params: CatalogParam[] } & (
  | { http: CatalogHttp; unsupported?: never }
  | { http?: never; unsupported: string }
);

export interface CatalogCategory {
  description: string;
  methods: Record<string, CatalogMethod>;
}

export const CATALOG = rawCatalog as unknown as Record<string, CatalogCategory>;

/**
 * Verify every loaded method has exactly one of `http` / `unsupported`. The
 * JSON is cast unvalidated at load (it's a build-time artifact), so this guards
 * against the generator and the TypeScript type drifting apart. Returns the
 * list of offending "category.method" keys (empty when the catalog is valid).
 */
export function catalogInvariantViolations(): string[] {
  const bad: string[] = [];
  for (const [catName, cat] of Object.entries(CATALOG)) {
    for (const [methodName, m] of Object.entries(cat.methods)) {
      const hasHttp = "http" in m && m.http !== undefined;
      const hasUnsupported = "unsupported" in m && m.unsupported !== undefined;
      if (hasHttp === hasUnsupported) bad.push(`${catName}.${methodName}`);
    }
  }
  return bad;
}

export interface LookupError {
  error: string;
  available_categories?: string[];
  available_methods?: string[];
}

export function lookupMethod(
  category: string,
  method: string,
): { entry: CatalogMethod } | LookupError {
  const cat = CATALOG[category];
  if (!cat) {
    return {
      error: `Unknown category '${category}'.`,
      available_categories: Object.keys(CATALOG).sort(),
    };
  }
  const entry = cat.methods[method];
  if (!entry) {
    return {
      error: `Unknown method '${method}' in category '${category}'.`,
      available_methods: Object.keys(cat.methods).sort(),
    };
  }
  return { entry };
}

export interface DispatchOptions {
  params?: Record<string, unknown>;
  /** Extra query-string parameters appended to the request URL (any verb). */
  extraParams?: Record<string, unknown>;
}

/**
 * Execute a catalog method against TestRail. Path params fill the endpoint
 * template; remaining params go to the query string (GET) or JSON body (POST).
 */
export async function dispatchMethod(
  client: TestRailClient,
  category: string,
  method: string,
  options: DispatchOptions = {},
): Promise<Json> {
  const looked = lookupMethod(category, method);
  if ("error" in looked) throw new Error(looked.error);
  const { entry } = looked;

  if (entry.unsupported !== undefined) {
    throw new Error(`'${category}.${method}' is not available: ${entry.unsupported}`);
  }
  // The discriminated union narrows `entry` to the `http` variant here.
  const http = entry.http;

  const params = { ...(options.params ?? {}) };
  let endpoint = http.endpoint;
  for (const name of http.pathParams) {
    const value = params[name];
    if (value === undefined || value === null) {
      throw new Error(
        `Missing required parameter '${name}' for ${category}.${method}. ` +
          `Endpoint template: ${http.endpoint}`,
      );
    }
    endpoint = endpoint.replace(`{${name}}`, encodeURIComponent(String(value)));
    delete params[name];
  }

  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) rest[key] = value;
  }

  const extra: QueryParams = {};
  for (const [key, value] of Object.entries(options.extraParams ?? {})) {
    if (value !== undefined && value !== null) extra[key] = value;
  }

  if (http.verb === "GET") {
    return client.get(endpoint, { ...rest, ...extra });
  }
  return client.post(
    endpoint,
    rest,
    Object.keys(extra).length > 0 ? extra : undefined,
  );
}
