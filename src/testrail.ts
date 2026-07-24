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

// 5xx are retried only for idempotent GETs. For POST a 5xx may arrive AFTER
// TestRail already applied the write (e.g. a proxy 502/503 on the response leg),
// so retrying would duplicate results/comments/runs — retry POST on 429 only,
// where TestRail rejected the request before applying it.
const GET_RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const POST_RETRYABLE_STATUSES = new Set([429]);
const MAX_RETRIES = 3;

// Safety cap on pagination follow-through: 200 pages * 250 items = 50,000 items.
// Well beyond any realistic single query; prevents a runaway loop.
const MAX_PAGES = 200;

/**
 * Bounds on a `getPaginated` follow-through. Any of these ends paging early so a
 * single tool call can't produce a multi-megabyte payload or run long enough to
 * trip the MCP client's request timeout (which surfaces to the caller as a
 * -32000 "connection closed"). All are optional; omitting them preserves the
 * original "fetch every page up to MAX_PAGES" behavior.
 */
export interface PaginateOptions {
  /** Stop once this many items are collected; the result is sliced to exactly this length. */
  maxItems?: number;
  /** Override the default page-count safety cap. */
  maxPages?: number;
  /** Stop following pages after this much wall-clock time has elapsed. */
  timeBudgetMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Serialize a query value the way the TestRail API expects. */
function queryValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(queryValue).join(",");
  // TestRail's boolean filters (e.g. is_completed) expect 1/0, not "true"/"false";
  // sending the words silently disables the filter.
  if (typeof value === "boolean") return value ? "1" : "0";
  return String(value);
}

/**
 * The list field of a TestRail bulk-response envelope (the sole array-valued
 * key besides `_links`), or null when there isn't one.
 */
function listKeyOf(obj: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(obj)) {
    if (k === "_links") continue;
    if (Array.isArray(v)) return k;
  }
  return null;
}

/**
 * A TestRail bulk-list pagination envelope: `{ offset, limit, size, _links, <list> }`.
 * TestRail caps each page at 250 items and links the next page via `_links.next`.
 * Single-entity GETs (get_run/{id}) lack this shape, so they pass through untouched.
 */
function isPaginationEnvelope(value: Json): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return (
    "offset" in obj &&
    typeof obj._links === "object" &&
    obj._links !== null &&
    listKeyOf(obj) !== null
  );
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

    const retryable =
      method === "GET" ? GET_RETRYABLE_STATUSES : POST_RETRYABLE_STATUSES;
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
      if (!retryable.has(response.status)) break;
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

  /**
   * GET an endpoint, transparently following TestRail's pagination.
   *
   * TestRail caps bulk-list responses at 250 items and returns an envelope
   * (`{ offset, limit, size, _links, <list> }`) rather than a bare array;
   * fetching only the first page silently drops every item past #250. This
   * follows `_links.next` until exhausted and returns the FULL list as a single
   * flat array. Non-paginated responses (bare arrays, single entities) are
   * returned unchanged, so this is a safe drop-in for `get` on any endpoint.
   *
   * `opts` bounds the follow-through (item count, page count, or a time budget)
   * so a single call can't return a payload large enough — or run long enough —
   * to break the MCP stdio transport. When a bound stops paging early the
   * result is a prefix of the full list; callers that need to detect this can
   * request `maxItems` one greater than they intend to keep and check the
   * returned length.
   */
  async getPaginated(
    endpoint: string,
    params?: QueryParams,
    opts: PaginateOptions = {},
  ): Promise<Json> {
    const first = await this.get(endpoint, params);
    if (!isPaginationEnvelope(first)) return first;

    const maxPages = opts.maxPages ?? MAX_PAGES;
    const deadline =
      opts.timeBudgetMs !== undefined ? Date.now() + opts.timeBudgetMs : null;
    const key = listKeyOf(first) as string;
    const items: unknown[] = [...(first[key] as unknown[])];
    let next = (first._links as { next?: string | null }).next ?? null;
    let pages = 1;
    while (next && pages < maxPages) {
      if (opts.maxItems !== undefined && items.length >= opts.maxItems) break;
      if (deadline !== null && Date.now() >= deadline) break;
      // `_links.next` is instance-relative (".../api/v2/get_cases/1&limit=250&
      // offset=250") and already carries its own query string, so strip the
      // leading "/api/v2/" and pass no extra params.
      const nextEndpoint = next.replace(/^\/api\/v2\//, "");
      const page = await this.get(nextEndpoint);
      if (!isPaginationEnvelope(page)) break;
      const pageKey = listKeyOf(page) ?? key;
      items.push(...((page[pageKey] as unknown[]) ?? []));
      next = (page._links as { next?: string | null }).next ?? null;
      pages++;
    }
    return opts.maxItems !== undefined && items.length > opts.maxItems
      ? items.slice(0, opts.maxItems)
      : items;
  }

  post(endpoint: string, body?: Json, params?: QueryParams): Promise<Json> {
    return this.request("POST", endpoint, { body, params });
  }
}
