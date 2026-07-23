import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { CATALOG, dispatchMethod, lookupMethod } from "./catalog";
import type { ConnectionProps, Env } from "./env";
import { checkConfig, configView, getCredentials } from "./env";
import { TestRailClient, TestRailError } from "./testrail";

export const SERVER_INSTRUCTIONS =
  "Use this server when the user mentions TestRail, Test Rail, " +
  "test cases, test runs, test results, test steps, test plans, " +
  "test suites, test milestones, test configurations, QA, " +
  "quality assurance, test management, or test reporting. " +
  "If a TestRail API call fails or you suspect credentials are wrong, " +
  "call check_testrail_auth first — it returns a structured diagnosis. " +
  "If it reports missing configuration, the connection is not authenticated — " +
  "call the `testrail_login` tool to have the user enter TestRail credentials " +
  "in a browser (or, outside a session, run `tram-mcp login` / set the " +
  "TESTRAIL_* environment variables), then retry. " +
  "Start with browse_testrail_api to discover available categories, " +
  "then describe_testrail_method to learn how to call a specific method, " +
  "then run_testrail_command to execute it. " +
  "Use search_test_cases for quick title-based case lookups, " +
  "list_testrail_projects to resolve project names to IDs, " +
  "get_run_summary for run status overviews, add_result_for_case to " +
  "record a test outcome, and create_test_run to start a new run.";

/** Default TestRail status IDs. Instances can add custom statuses beyond these. */
const STATUS_IDS: Record<string, number> = {
  passed: 1,
  blocked: 2,
  untested: 3,
  retest: 4,
  failed: 5,
};

export interface ToolContext {
  env: Env;
  /** Client-supplied credentials (e.g. from the login wizard), if any. */
  props?: ConnectionProps;
  /**
   * Optional dynamic credential source. When present it is consulted on every
   * tool call, so credentials saved mid-session (e.g. by the login tool) are
   * picked up without restarting the server. Falls back to the static `env`.
   */
  resolveEnv?: () => Env;
  /**
   * Optional login capability. When present, the `testrail_login` tool is
   * registered; calling it starts a browser login and returns the URL. Only
   * transports that can drive a local browser (stdio) supply this.
   */
  startLogin?: () => Promise<{ url: string }>;
}

/** The credentials env for this call: the dynamic resolver if set, else static. */
function currentEnv(ctx: ToolContext): Env {
  return ctx.resolveEnv ? ctx.resolveEnv() : ctx.env;
}

/** Effective per-connection credentials: client props if supplied, else the env. */
function effectiveProps(ctx: ToolContext): ConnectionProps | undefined {
  return ctx.props;
}

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function jsonResult(data: unknown): ToolResult {
  const result: ToolResult = {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    result.structuredContent = data as Record<string, unknown>;
  }
  return result;
}

function errorResult(message: string): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }, null, 2) }],
    structuredContent: { error: message },
    isError: true,
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof TestRailError) {
    return err.status ? `TestRailError (HTTP ${err.status}): ${err.message}` : `TestRailError: ${err.message}`;
  }
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

function getClient(ctx: ToolContext): TestRailClient {
  return new TestRailClient(getCredentials(currentEnv(ctx), effectiveProps(ctx)));
}

function hintFor(status: number | null, message: string): string {
  if (status === 401) {
    return (
      "TestRail rejected the credentials (HTTP 401). The username, " +
      "password, or API key is wrong. Verify the values match what " +
      "you can log in with via the TestRail web UI."
    );
  }
  if (status === 403) {
    return (
      "TestRail accepted the credentials but the user isn't allowed " +
      "to use the API (HTTP 403). Common causes: API access is " +
      "disabled on the TestRail user's profile; the account is " +
      "locked after too many failed login attempts (~10 min cooldown); " +
      "or the user lacks permission for this endpoint."
    );
  }
  if (status === 429) {
    return (
      "TestRail is rate-limiting the server (HTTP 429). Slow the " +
      "request rate or wait before retrying."
    );
  }
  if (status !== null && status >= 500) {
    return (
      `TestRail returned a server error (HTTP ${status}). The ` +
      "TestRail instance is unhealthy; retry shortly."
    );
  }
  if (/request failed|network|fetch/i.test(message)) {
    return (
      "Network error reaching TestRail. Check the TestRail URL is " +
      "correct and reachable from this machine's network."
    );
  }
  return (
    "Unrecognized failure. Surface the error message to the user so " +
    "they can decide what to do."
  );
}

export function registerTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "check_testrail_auth",
    {
      title: "Check TestRail Authentication",
      description:
        "Verify the configured TestRail credentials and report a structured " +
        "diagnosis. Calls a lightweight TestRail endpoint (get_priorities, " +
        "which every authenticated user can reach). Use this when a user " +
        "reports the server isn't working, when another tool returns a " +
        "401/403/auth error, or to confirm setup before a longer workflow. " +
        "Returns { ok, config, hint } plus error details on failure. The " +
        "config view never includes the secret itself.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      const props = effectiveProps(ctx);
      const config = configView(currentEnv(ctx), props);
      const configError = checkConfig(currentEnv(ctx), props);
      if (configError) {
        return jsonResult({
          ok: false,
          error: configError,
          error_class: "ConfigurationError",
          hint:
            "Call the `testrail_login` tool to enter your TestRail URL, username, " +
            "and API key (or password) in a browser — or run `tram-mcp login` / " +
            "set the TESTRAIL_* environment variables.",
          config,
        });
      }
      try {
        const priorities = await getClient(ctx).get("get_priorities");
        return jsonResult({
          ok: true,
          config,
          priorities_count: Array.isArray(priorities) ? priorities.length : null,
          hint:
            "Credentials work and the TestRail API is reachable. " +
            "Other tools should function normally.",
        });
      } catch (err) {
        const status = err instanceof TestRailError ? err.status : null;
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({
          ok: false,
          error_class: err instanceof Error ? err.name : "Error",
          error: message,
          status_code: status,
          hint: hintFor(status, message),
          config,
        });
      }
    },
  );

  if (ctx.startLogin) {
    server.registerTool(
      "testrail_login",
      {
        title: "Log in to TestRail",
        description:
          "Open a browser window to enter and save TestRail credentials (URL, " +
          "username, and API key or password). Use this when credentials are " +
          "missing or rejected — e.g. check_testrail_auth reports missing " +
          "configuration, or a call returns 401/403. Returns immediately with a " +
          "login URL; the browser form opens automatically (open the URL manually " +
          "if it doesn't). Tell the user to complete the form, then retry their " +
          "original request — credentials are saved locally to ~/.tram-mcp and " +
          "picked up on the next call.",
        inputSchema: {},
        annotations: { readOnlyHint: false, openWorldHint: true },
      },
      async () => {
        try {
          const { url } = await ctx.startLogin!();
          return jsonResult({
            status: "login_started",
            url,
            message:
              "A browser window should have opened to the TestRail login form. " +
              `If not, open this URL manually: ${url} . Enter your TestRail URL, ` +
              "username, and API key (or password), submit, then retry your " +
              "original request. Credentials are saved locally to ~/.tram-mcp.",
          });
        } catch (err) {
          return errorResult(errorMessage(err));
        }
      },
    );
  }

  server.registerTool(
    "browse_testrail_api",
    {
      title: "Browse TestRail API",
      description:
        "Browse all available TestRail API categories and their methods. " +
        "Returns a map of category name to description and method names. " +
        "Use describe_testrail_method to get details for a specific method, " +
        "then run_testrail_command to call it.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const out: Record<string, { description: string; methods: string[] }> = {};
      for (const [name, cat] of Object.entries(CATALOG)) {
        out[name] = {
          description: cat.description,
          methods: Object.keys(cat.methods),
        };
      }
      return jsonResult(out);
    },
  );

  server.registerTool(
    "describe_testrail_method",
    {
      title: "Describe TestRail Method",
      description:
        "Describe a specific TestRail API method — its parameters, types, " +
        "documentation, and HTTP endpoint. Use this to understand what " +
        "parameters run_testrail_command needs.",
      inputSchema: {
        category: z
          .string()
          .describe('The API category (e.g. "projects", "cases", "runs").'),
        method: z
          .string()
          .describe('The method name (e.g. "get_projects", "add_case").'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ category, method }) => {
      const looked = lookupMethod(category, method);
      if ("error" in looked) return jsonResult(looked);
      return jsonResult({
        category,
        method,
        docstring: looked.entry.doc,
        parameters: looked.entry.params,
        ...(looked.entry.http ? { http: looked.entry.http } : {}),
        ...(looked.entry.unsupported ? { unsupported: looked.entry.unsupported } : {}),
      });
    },
  );

  server.registerTool(
    "run_testrail_command",
    {
      title: "Run TestRail Command",
      description:
        "Execute a TestRail API method. Use browse_testrail_api and " +
        "describe_testrail_method first to discover methods and their " +
        "parameters. Pass method arguments in `params` (path parameters are " +
        "filled into the URL; the rest go to the query string for GET or " +
        "the JSON body for POST). Use `extra_params` for additional URL " +
        "query filters not in the method signature, such as custom field " +
        'filters (e.g. {"custom_automation_type": "1"}). Use `fields` to ' +
        "trim each item of a list response to the named keys, and " +
        "`max_results` to truncate long lists.",
      inputSchema: {
        category: z
          .string()
          .describe('The API category (e.g. "projects", "cases", "runs").'),
        method: z
          .string()
          .describe('The method name (e.g. "get_projects", "add_case").'),
        params: z
          .record(z.unknown())
          .optional()
          .describe("Parameters to pass to the method."),
        extra_params: z
          .record(z.unknown())
          .optional()
          .describe("Additional query parameters appended to the request URL."),
        fields: z
          .array(z.string())
          .optional()
          .describe("Field names to keep in each result item (list responses only)."),
        max_results: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum number of items to return for list responses."),
      },
      annotations: { openWorldHint: true },
    },
    async ({ category, method, params, extra_params, fields, max_results }) => {
      const looked = lookupMethod(category, method);
      if ("error" in looked) return jsonResult(looked);
      try {
        let result = await dispatchMethod(getClient(ctx), category, method, {
          params,
          extraParams: extra_params,
        });

        if (result === null || result === undefined) {
          return jsonResult({ status: "ok" });
        }

        if (Array.isArray(result)) {
          if (fields) {
            result = result.map((item) =>
              item !== null && typeof item === "object" && !Array.isArray(item)
                ? Object.fromEntries(
                    Object.entries(item as Record<string, unknown>).filter(([k]) =>
                      fields.includes(k),
                    ),
                  )
                : item,
            );
          }
          const list = result as unknown[];
          if (max_results !== undefined && list.length > max_results) {
            return jsonResult({
              results: list.slice(0, max_results),
              truncated: true,
              total_count: list.length,
              message:
                `Results truncated: showing ${max_results} of ${list.length} ` +
                "items. Use max_results or refine your query to retrieve more.",
            });
          }
        }

        return jsonResult(result);
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  );

  server.registerTool(
    "search_test_cases",
    {
      title: "Search Test Cases",
      description:
        "Search for test cases by title (case-insensitive substring match). " +
        "Returns { count, cases } where each case has id, title, and " +
        "section_id.",
      inputSchema: {
        project_id: z.number().int().describe("The ID of the project to search in."),
        query: z.string().describe("The search string to match against case titles."),
        suite_id: z
          .number()
          .int()
          .optional()
          .describe("Optional suite ID to narrow the search."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ project_id, query, suite_id }) => {
      try {
        const response = await getClient(ctx).getPaginated(
          `get_cases/${project_id}`,
          { suite_id },
        );
        const allCases: unknown[] = Array.isArray(response)
          ? response
          : ((response as Record<string, unknown>)?.cases as unknown[]) ?? [];
        const q = query.toLowerCase();
        const cases = allCases
          .filter(
            (c): c is Record<string, unknown> => c !== null && typeof c === "object",
          )
          .filter((c) => String(c.title ?? "").toLowerCase().includes(q))
          .map((c) => ({ id: c.id, title: c.title, section_id: c.section_id ?? null }));
        return jsonResult({ count: cases.length, cases });
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  );

  server.registerTool(
    "list_testrail_projects",
    {
      title: "List TestRail Projects",
      description:
        "List TestRail projects, optionally filtered by a case-insensitive " +
        "name substring. The fastest way to resolve a project name to its " +
        "ID before using other tools. Returns { count, projects } with id, " +
        "name, is_completed, and suite_mode for each project.",
      inputSchema: {
        name: z
          .string()
          .optional()
          .describe("Optional case-insensitive substring to filter project names."),
        include_completed: z
          .boolean()
          .default(true)
          .describe("Whether to include completed projects (default true)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ name, include_completed }) => {
      try {
        const response = await getClient(ctx).getPaginated("get_projects");
        const all: unknown[] = Array.isArray(response)
          ? response
          : ((response as Record<string, unknown>)?.projects as unknown[]) ?? [];
        const q = name?.toLowerCase();
        const projects = all
          .filter(
            (p): p is Record<string, unknown> => p !== null && typeof p === "object",
          )
          .filter((p) => include_completed || !p.is_completed)
          .filter((p) => !q || String(p.name ?? "").toLowerCase().includes(q))
          .map((p) => ({
            id: p.id,
            name: p.name,
            is_completed: p.is_completed ?? false,
            suite_mode: p.suite_mode ?? null,
          }));
        return jsonResult({ count: projects.length, projects });
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  );

  server.registerTool(
    "get_run_summary",
    {
      title: "Get Test Run Summary",
      description:
        "Get a status summary for a test run: name, completion state, and " +
        "counts of passed/failed/blocked/retest/untested tests, plus the " +
        "pass rate. Optionally includes the list of currently failed tests " +
        "(id, case_id, title) so failures can be investigated immediately.",
      inputSchema: {
        run_id: z.number().int().describe("The ID of the test run."),
        include_failed_tests: z
          .boolean()
          .default(true)
          .describe("Also list the failed tests in the run (default true, capped at 50)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ run_id, include_failed_tests }) => {
      try {
        const client = getClient(ctx);
        const run = (await client.get(`get_run/${run_id}`)) as Record<string, unknown>;
        const counts = {
          passed: Number(run.passed_count ?? 0),
          failed: Number(run.failed_count ?? 0),
          blocked: Number(run.blocked_count ?? 0),
          retest: Number(run.retest_count ?? 0),
          untested: Number(run.untested_count ?? 0),
        };
        const total =
          counts.passed + counts.failed + counts.blocked + counts.retest + counts.untested;
        const executed = total - counts.untested;
        const summary: Record<string, unknown> = {
          run_id,
          name: run.name,
          url: run.url,
          is_completed: run.is_completed ?? false,
          project_id: run.project_id,
          suite_id: run.suite_id ?? null,
          milestone_id: run.milestone_id ?? null,
          counts,
          total_tests: total,
          pass_rate_pct: executed > 0 ? Math.round((counts.passed / executed) * 1000) / 10 : null,
        };
        if (include_failed_tests && counts.failed > 0) {
          // Enriching with the failed-test list is optional: if this second
          // call fails, keep the valid summary and report the enrichment error
          // alongside it rather than discarding the run data the caller wanted.
          try {
            const response = await client.getPaginated(`get_tests/${run_id}`, {
              status_id: STATUS_IDS.failed,
            });
            const tests: unknown[] = Array.isArray(response)
              ? response
              : ((response as Record<string, unknown>)?.tests as unknown[]) ?? [];
            summary.failed_tests = tests
              .filter(
                (t): t is Record<string, unknown> => t !== null && typeof t === "object",
              )
              .slice(0, 50)
              .map((t) => ({ id: t.id, case_id: t.case_id, title: t.title }));
          } catch (err) {
            summary.failed_tests_error = errorMessage(err);
          }
        }
        return jsonResult(summary);
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  );

  server.registerTool(
    "add_result_for_case",
    {
      title: "Add Result for Case",
      description:
        "Record a test result for a case in a run — the most common QA " +
        "write operation. Accepts a status name (passed, blocked, retest, " +
        "failed) or a numeric status_id for custom statuses. Note: " +
        "'untested' is not a recordable result — it is the absence of one — " +
        "so TestRail rejects it here. Optionally attach a comment, defect " +
        "references, version, and elapsed time.",
      inputSchema: {
        run_id: z.number().int().describe("The ID of the test run."),
        case_id: z.number().int().describe("The ID of the test case."),
        status: z
          .union([
            z.enum(["passed", "blocked", "retest", "failed"]),
            z.number().int(),
          ])
          .describe(
            "Result status: a standard status name (passed, blocked, retest, " +
              "failed) or a numeric status_id for custom statuses. 'untested' " +
              "cannot be recorded.",
          ),
        comment: z.string().optional().describe("Comment describing the result."),
        defects: z
          .string()
          .optional()
          .describe('Comma-separated defect references (e.g. "JIRA-123,JIRA-456").'),
        version: z.string().optional().describe("Version or build tested."),
        elapsed: z
          .string()
          .optional()
          .describe('Time spent testing (e.g. "30s", "1m 45s").'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ run_id, case_id, status, comment, defects, version, elapsed }) => {
      const statusId = typeof status === "number" ? status : STATUS_IDS[status];
      try {
        const body: Record<string, unknown> = { status_id: statusId };
        if (comment !== undefined) body.comment = comment;
        if (defects !== undefined) body.defects = defects;
        if (version !== undefined) body.version = version;
        if (elapsed !== undefined) body.elapsed = elapsed;
        const result = await getClient(ctx).post(
          `add_result_for_case/${run_id}/${case_id}`,
          body,
        );
        return jsonResult(result);
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  );

  server.registerTool(
    "create_test_run",
    {
      title: "Create Test Run",
      description:
        "Create a new test run in a project. When case_ids is provided the " +
        "run includes only those cases; otherwise it includes all cases of " +
        "the suite. For multi-suite projects, suite_id is required. Returns " +
        "the created run (including its id and url).",
      inputSchema: {
        project_id: z.number().int().describe("The ID of the project."),
        name: z.string().describe("Name for the new test run."),
        suite_id: z
          .number()
          .int()
          .optional()
          .describe("Suite ID (required for multi-suite projects)."),
        description: z.string().optional().describe("Description of the run."),
        milestone_id: z
          .number()
          .int()
          .optional()
          .describe("Milestone to link the run to."),
        assignedto_id: z
          .number()
          .int()
          .optional()
          .describe("User ID to assign the run to."),
        case_ids: z
          .array(z.number().int())
          .optional()
          .describe(
            "Specific case IDs to include. Omit to include all cases of the suite.",
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ project_id, name, suite_id, description, milestone_id, assignedto_id, case_ids }) => {
      try {
        const body: Record<string, unknown> = {
          name,
          include_all: case_ids === undefined,
        };
        if (suite_id !== undefined) body.suite_id = suite_id;
        if (description !== undefined) body.description = description;
        if (milestone_id !== undefined) body.milestone_id = milestone_id;
        if (assignedto_id !== undefined) body.assignedto_id = assignedto_id;
        if (case_ids !== undefined) body.case_ids = case_ids;
        const result = await getClient(ctx).post(`add_run/${project_id}`, body);
        return jsonResult(result);
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  );
}
