import rawCatalog from "./catalog.json";
import type { Json, QueryParams, TestRailClient } from "./testrail";

export interface CatalogParam {
  name: string;
  required: boolean;
  type?: string;
  default?: string;
}

export interface CatalogMethod {
  doc: string;
  params: CatalogParam[];
  http?: {
    verb: "GET" | "POST";
    endpoint: string;
    pathParams: string[];
  };
  unsupported?: string;
}

export interface CatalogCategory {
  description: string;
  methods: Record<string, CatalogMethod>;
}

export const CATALOG = rawCatalog as unknown as Record<string, CatalogCategory>;

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

  if (entry.unsupported) {
    throw new Error(`'${category}.${method}' is not available: ${entry.unsupported}`);
  }
  if (!entry.http) {
    throw new Error(`'${category}.${method}' has no endpoint mapping.`);
  }

  const params = { ...(options.params ?? {}) };
  let endpoint = entry.http.endpoint;
  for (const name of entry.http.pathParams) {
    const value = params[name];
    if (value === undefined || value === null) {
      throw new Error(
        `Missing required parameter '${name}' for ${category}.${method}. ` +
          `Endpoint template: ${entry.http.endpoint}`,
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

  if (entry.http.verb === "GET") {
    return client.get(endpoint, { ...rest, ...extra });
  }
  return client.post(
    endpoint,
    rest,
    Object.keys(extra).length > 0 ? extra : undefined,
  );
}
