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
    let attempts = 0;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        // Honor the server's Retry-After (seconds) when present, otherwise
        // back off linearly. Capped so a hostile header can't stall the Worker.
        const retryAfter = response?.headers.get("Retry-After");
        const backoffMs = retryAfter
          ? Math.min(Number(retryAfter) * 1000 || attempt * 1000, 10_000)
          : attempt * 1000;
        await sleep(backoffMs);
      }
      attempts = attempt + 1;
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
      // status === null marks a network failure (vs an HTTP error with a
      // status), which callers use to distinguish connectivity from auth/API
      // problems without parsing the message.
      const suffix = attempts > 1 ? ` after ${attempts} attempts` : "";
      throw new TestRailError(
        `Request failed${suffix}: ${lastNetworkError?.message ?? "network error"}`,
      );
    }
    return this.handleResponse(response, attempts);
  }

  private async handleResponse(response: Response, attempts = 1): Promise<Json> {
    const text = (await response.text()).trim();
    // Note in error messages when the request was already retried, so the
    // caller knows the failure is sustained rather than a one-off.
    const retried = attempts > 1 ? ` after ${attempts} attempts` : "";

    if (response.ok) {
      // Any 2xx is success. TestRail v2 normally returns 200, but 201/204
      // (e.g. on writes) must not be mistaken for failures.
      if (!text) return {}; // empty body is valid for delete operations
      try {
        return JSON.parse(text);
      } catch (err) {
        const snippet = text.length > 200 ? `${text.slice(0, 200)}…` : text;
        throw new TestRailError(
          `Invalid JSON response from TestRail (HTTP ${response.status}): ${snippet}`,
          response.status,
          text,
        );
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
          ? `Rate limit exceeded${retried}. Retry after ${retryAfter} seconds.`
          : `Rate limit exceeded${retried}.`,
        429,
        text,
      );
    }

    let message = `API request failed with status ${response.status}${retried}`;
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
