import type { TestRailCredentials } from "./env";

export type Json = unknown;
export type QueryParams = Record<string, unknown>;

export class TestRailError extends Error {
  constructor(
    message: string,
    public readonly status: number | null = null,
    public readonly responseText: string | null = null,
  ) {
    super(message);
    this.name = "TestRailError";
  }
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Serialize a query value the way the TestRail API expects (arrays comma-joined). */
function queryValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(",");
  return String(value);
}

export class TestRailClient {
  constructor(private readonly creds: TestRailCredentials) {}

  buildUrl(endpoint: string, params?: QueryParams): string {
    let url = `${this.creds.url}/index.php?/api/v2/${endpoint}`;
    if (params) {
      const parts: string[] = [];
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(queryValue(value))}`);
      }
      if (parts.length > 0) url += `&${parts.join("&")}`;
    }
    return url;
  }

  async request(
    method: "GET" | "POST",
    endpoint: string,
    options: { params?: QueryParams; body?: Json } = {},
  ): Promise<Json> {
    const url = this.buildUrl(endpoint, options.params);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Basic ${btoa(`${this.creds.username}:${this.creds.secret}`)}`,
    };

    let response: Response | null = null;
    let lastNetworkError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) await sleep(1000 * attempt);
      try {
        response = await fetch(url, {
          method,
          headers,
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        });
      } catch (err) {
        lastNetworkError = err instanceof Error ? err : new Error(String(err));
        response = null;
        continue;
      }
      if (!RETRYABLE_STATUSES.has(response.status)) break;
    }

    if (!response) {
      throw new TestRailError(
        `Request failed: ${lastNetworkError?.message ?? "network error"}`,
      );
    }
    return this.handleResponse(response);
  }

  private async handleResponse(response: Response): Promise<Json> {
    const text = (await response.text()).trim();

    if (response.status === 200) {
      if (!text) return {}; // empty body is valid for delete operations
      try {
        return JSON.parse(text);
      } catch (err) {
        throw new TestRailError(`Invalid JSON response: ${err}`, 200, text);
      }
    }

    if (response.status === 401) {
      throw new TestRailError(
        "Authentication failed. Please check your credentials.",
        401,
        text,
      );
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      throw new TestRailError(
        retryAfter
          ? `Rate limit exceeded. Retry after ${retryAfter} seconds.`
          : "Rate limit exceeded.",
        429,
        text,
      );
    }

    let message = `API request failed with status ${response.status}`;
    try {
      const data = JSON.parse(text) as { error?: string };
      if (data && typeof data.error === "string") message = data.error;
    } catch {
      if (text) message = text;
    }
    throw new TestRailError(message, response.status, text);
  }

  get(endpoint: string, params?: QueryParams): Promise<Json> {
    return this.request("GET", endpoint, { params });
  }

  post(endpoint: string, body?: Json, params?: QueryParams): Promise<Json> {
    return this.request("POST", endpoint, { body, params });
  }
}
