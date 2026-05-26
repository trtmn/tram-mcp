from __future__ import annotations

import inspect
import logging
import os
import re
import sys
from pathlib import Path
from typing import Any


def _load_env():
    """Load env vars from .env if present.

    Supports both regular .env files and FIFO named pipes (used by some
    secret managers). FIFO pipes only serve data once per open(), so we
    read via a stream rather than letting load_dotenv re-open the path
    internally. For FIFOs, we use a timeout to avoid blocking
    indefinitely (e.g. in tests).
    """
    import stat

    try:
        from dotenv import load_dotenv

        env_path = Path(".env")
        if not env_path.exists():
            return

        if stat.S_ISFIFO(env_path.stat().st_mode):
            import signal

            def _timeout_handler(signum, frame):
                raise TimeoutError

            old_handler = signal.signal(signal.SIGALRM, _timeout_handler)
            signal.alarm(2)
            try:
                with open(env_path) as f:
                    load_dotenv(stream=f)
            except TimeoutError:
                pass
            finally:
                signal.alarm(0)
                signal.signal(signal.SIGALRM, old_handler)
        else:
            with open(env_path) as f:
                load_dotenv(stream=f)
    except Exception:
        pass

_load_env()

logging.getLogger("fastmcp").setLevel(logging.WARNING)
from fastmcp import FastMCP  # noqa: E402


def _check_env() -> str | None:
    """Check for required env vars. Returns error message or None if OK."""
    missing = []
    if not os.environ.get("TESTRAIL_URL"):
        missing.append("TESTRAIL_URL")
    if not os.environ.get("TESTRAIL_USERNAME"):
        missing.append("TESTRAIL_USERNAME")
    if not os.environ.get("TESTRAIL_API_KEY") and not os.environ.get("TESTRAIL_PASSWORD"):
        missing.append("TESTRAIL_API_KEY or TESTRAIL_PASSWORD")
    if missing:
        return (
            f"Missing required environment variables: {', '.join(missing)}. "
            "Set these to connect to your TestRail instance."
        )
    return None


_ENV_ERROR = _check_env()
if _ENV_ERROR:
    print(f"[tram-mcp] ERROR: {_ENV_ERROR}", file=sys.stderr)

# ---------------------------------------------------------------------------
# Catalog builder – runs at import time, no credentials needed
# ---------------------------------------------------------------------------

def _build_catalog() -> dict[str, dict[str, Any]]:
    """Introspect testrail_api_module to build a catalog of categories and methods."""
    from testrail_api_module import TestRailAPI

    source = inspect.getsource(TestRailAPI.__init__)

    # Match lines like: self.projects = projects.ProjectsAPI(self)
    pattern = re.compile(
        r"self\.(\w+)\s*=\s*(\w+)\.(\w+)\(self\)"
    )

    catalog: dict[str, dict[str, Any]] = {}

    for match in pattern.finditer(source):
        attr_name = match.group(1)       # e.g. "projects"
        module_name = match.group(2)      # e.g. "projects"
        class_name = match.group(3)       # e.g. "ProjectsAPI"

        # Import the submodule and get the class
        mod = __import__(f"testrail_api_module.{module_name}", fromlist=[class_name])
        cls = getattr(mod, class_name)

        # Get the docstring for the attribute from __init__ source
        # Look for the docstring comment right after the assignment
        attr_doc_pattern = re.compile(
            rf'self\.{re.escape(attr_name)}\s*=\s*[^\n]+\n\s+"""([^"]+)"""'
        )
        attr_doc_match = attr_doc_pattern.search(source)
        description = attr_doc_match.group(1).strip() if attr_doc_match else f"TestRail {attr_name} API"

        methods: dict[str, dict[str, Any]] = {}
        for name, method in inspect.getmembers(cls, predicate=inspect.isfunction):
            if name.startswith("_"):
                continue

            sig = inspect.signature(method)
            params: dict[str, dict[str, Any]] = {}
            for pname, param in sig.parameters.items():
                if pname == "self":
                    continue
                info: dict[str, Any] = {}
                if param.annotation is not inspect.Parameter.empty:
                    info["type"] = str(param.annotation)
                if param.default is not inspect.Parameter.empty:
                    info["default"] = repr(param.default)
                    info["required"] = False
                elif pname == "kwargs":
                    info["required"] = False
                    info["type"] = "**kwargs"
                else:
                    info["required"] = True
                params[pname] = info

            methods[name] = {
                "parameters": params,
                "docstring": inspect.getdoc(method) or "",
                "return_type": str(sig.return_annotation) if sig.return_annotation is not inspect.Parameter.empty else None,
            }

        catalog[attr_name] = {
            "description": description,
            "methods": methods,
        }

    return catalog


CATALOG = _build_catalog()

# ---------------------------------------------------------------------------
# Lazy TestRail client
# ---------------------------------------------------------------------------

_client = None


def _get_client():
    global _client
    if _client is not None:
        return _client

    env_error = _check_env()
    if env_error:
        raise EnvironmentError(env_error)

    from testrail_api_module import TestRailAPI
    url = os.environ["TESTRAIL_URL"]
    username = os.environ["TESTRAIL_USERNAME"]
    api_key = os.environ.get("TESTRAIL_API_KEY")
    password = os.environ.get("TESTRAIL_PASSWORD")

    kwargs = {"base_url": url, "username": username}
    if api_key:
        kwargs["api_key"] = api_key
    if password:
        kwargs["password"] = password
    _client = TestRailAPI(**kwargs)
    return _client


# ---------------------------------------------------------------------------
# MCP Server & Tools
# ---------------------------------------------------------------------------

mcp = FastMCP(
    "TestRail MCP",
    instructions=(
        "Use this server when the user mentions TestRail, Test Rail, "
        "test cases, test runs, test results, test steps, test plans, "
        "test suites, test milestones, test configurations, QA, "
        "quality assurance, test management, or test reporting. "
        "If a TestRail API call fails or you suspect credentials are wrong, "
        "call check_testrail_auth first — it returns a structured diagnosis. "
        "Start with browse_testrail_api to discover available categories, "
        "then describe_testrail_method to learn how to call a specific method, "
        "then run_testrail_command to execute it. "
        "Use search_test_cases for quick title-based case lookups."
    ),
)


@mcp.tool
def check_testrail_auth() -> dict[str, Any]:
    """Verify the configured TestRail credentials and report a structured diagnosis.

    Calls a lightweight TestRail endpoint (``get_priorities``, which every
    authenticated user can reach) and translates the outcome into an
    actionable result the LLM can act on. Use this when:

    - A user reports the server isn't working
    - Another tool returns a 401/403/auth error and the cause is unclear
    - Confirming setup is correct before kicking off a longer workflow

    Returns a dict with at least:
      - ``ok``: bool — True if the credential check succeeded
      - ``config``: which URL / username / auth method the server is using
        (never includes the secret itself)

    On success, also includes the priorities count and the username TestRail
    associates with the credentials. On failure, includes ``error_class``,
    ``error``, ``status_code`` (when extractable), and a human-readable
    ``hint`` explaining the most likely cause and remediation.
    """
    config_view: dict[str, Any] = {
        "url": os.environ.get("TESTRAIL_URL"),
        "username": os.environ.get("TESTRAIL_USERNAME"),
        "auth_method": _configured_auth_method(),
    }

    env_error = _check_env()
    if env_error:
        return {
            "ok": False,
            "error": env_error,
            "error_class": "EnvironmentError",
            "hint": (
                "Set the required TESTRAIL_* environment variables and "
                "restart the MCP server. Either TESTRAIL_API_KEY or "
                "TESTRAIL_PASSWORD must be present."
            ),
            "config": config_view,
        }

    try:
        client = _get_client()
        priorities = client.priorities.get_priorities()
    except Exception as exc:  # noqa: BLE001 — we catch broadly to translate to MCP-friendly dict
        return _diagnose_auth_failure(exc, config_view)

    return {
        "ok": True,
        "config": config_view,
        "priorities_count": (
            len(priorities) if isinstance(priorities, list) else None
        ),
        "hint": (
            "Credentials work and the TestRail API is reachable. "
            "Other tools should function normally."
        ),
    }


def _configured_auth_method() -> str:
    if os.environ.get("TESTRAIL_API_KEY"):
        return "api_key"
    if os.environ.get("TESTRAIL_PASSWORD"):
        return "password"
    return "none"


def _diagnose_auth_failure(exc: Exception, config_view: dict[str, Any]) -> dict[str, Any]:
    """Translate a testrail_api_module exception into a structured response.

    The library raises distinct types for different failures, but the most
    actionable signal — the HTTP status code — is only embedded in the
    message string for the generic TestRailAPIException case. We pull it
    out so the LLM can branch on 401 vs 403 vs 5xx without parsing prose.
    """
    import re

    err_class = type(exc).__name__
    msg = str(exc)

    status: int | None = None
    m = re.search(r"\b([4-5]\d\d)\b", msg)
    if m:
        status = int(m.group(1))

    hint = _hint_for(err_class, status)

    return {
        "ok": False,
        "error_class": err_class,
        "error": msg,
        "status_code": status,
        "hint": hint,
        "config": config_view,
    }


def _hint_for(err_class: str, status: int | None) -> str:
    """Pick a hint based on the exception class and HTTP status."""
    if err_class == "TestRailAuthenticationError" or status == 401:
        return (
            "TestRail rejected the credentials (HTTP 401). The username, "
            "password, or API key is wrong. Verify the values match what "
            "you can log in with via the TestRail web UI."
        )
    if status == 403:
        return (
            "TestRail accepted the credentials but the user isn't allowed "
            "to use the API (HTTP 403). Common causes: API access is "
            "disabled on the TestRail user's profile; the account is "
            "locked after too many failed login attempts (~10 min cooldown); "
            "or the user lacks permission for this endpoint."
        )
    if err_class == "TestRailRateLimitError" or status == 429:
        return (
            "TestRail is rate-limiting the server (HTTP 429). Slow the "
            "request rate or wait before retrying."
        )
    if status is not None and status >= 500:
        return (
            f"TestRail returned a server error (HTTP {status}). The "
            "TestRail instance is unhealthy; retry shortly."
        )
    if "Connection" in err_class or "Timeout" in err_class:
        return (
            "Network error reaching TestRail. Check the TESTRAIL_URL is "
            "correct and reachable from this host."
        )
    return (
        "Unrecognized failure. Surface the error message to the user so "
        "they can decide what to do."
    )


@mcp.tool
def browse_testrail_api() -> dict[str, Any]:
    """Browse all available TestRail API categories and their methods.

    Returns a dict mapping each category name to its description and list of
    available method names. Use describe_testrail_method() to get details for a
    specific method, then run_testrail_command() to call it.
    """
    return {
        name: {
            "description": info["description"],
            "methods": list(info["methods"].keys()),
        }
        for name, info in CATALOG.items()
    }


@mcp.tool
def describe_testrail_method(category: str, method: str) -> dict[str, Any]:
    """Describe a specific TestRail API method — its parameters, types, and docs.

    Args:
        category: The API category (e.g. "projects", "cases", "runs").
        method: The method name (e.g. "get_projects", "add_case").

    Returns a dict with parameter details (name, type, required, default),
    docstring, and return type. Use this to understand what parameters
    run_testrail_command() needs.
    """
    if category not in CATALOG:
        return {
            "error": f"Unknown category '{category}'.",
            "available_categories": sorted(CATALOG.keys()),
        }

    cat = CATALOG[category]
    if method not in cat["methods"]:
        return {
            "error": f"Unknown method '{method}' in category '{category}'.",
            "available_methods": sorted(cat["methods"].keys()),
        }

    return cat["methods"][method]


@mcp.tool
def search_test_cases(
    project_id: int,
    query: str,
    suite_id: int | None = None,
) -> dict[str, Any]:
    """Search for test cases by title (case-insensitive substring match).

    Args:
        project_id: The ID of the project to search in.
        query: The search string to match against case titles.
        suite_id: Optional suite ID to narrow the search.

    Returns a dict with 'count' (total matches) and 'cases' (list of
    matching cases with id, title, and section_id).
    """
    try:
        client = _get_client()
    except EnvironmentError as e:
        return {"error": str(e)}

    try:
        kwargs: dict[str, Any] = {"project_id": project_id}
        if suite_id is not None:
            kwargs["suite_id"] = suite_id
        response = client.cases.get_cases(**kwargs)
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"}

    # The API returns a paginated dict with a "cases" key; unwrap it.
    if isinstance(response, dict):
        all_cases = response.get("cases", [])
    else:
        all_cases = response

    query_lower = query.lower()
    matches = [
        {"id": c["id"], "title": c["title"], "section_id": c.get("section_id")}
        for c in all_cases
        if query_lower in c.get("title", "").lower()
    ]

    return {"count": len(matches), "cases": matches}


@mcp.tool
def run_testrail_command(
    category: str,
    method: str,
    params: dict[str, Any] | None = None,
    extra_params: dict[str, Any] | None = None,
    fields: list[str] | None = None,
    max_results: int | None = None,
) -> dict[str, Any] | list | str:
    """Execute a TestRail API method.

    Args:
        category: The API category (e.g. "projects", "cases", "runs").
        method: The method name (e.g. "get_projects", "add_case").
        params: Optional dict of parameters to pass to the method.
        extra_params: Optional dict of additional query parameters that are
            appended to the API request URL. Use this for filters not directly
            supported by the method signature, such as custom field filters
            (e.g. ``{"custom_automation_type": "1"}``).  These are merged into
            the URL query string alongside the method's own parameters.
        fields: Optional list of field names to include in each result item.
            When provided and the response is a list of dicts, each dict is
            filtered to only contain the specified keys. Useful for reducing
            response size (e.g. ``fields=["id", "title"]``).
        max_results: Optional maximum number of items to return. When provided
            and the response is a list longer than this value, the list is
            truncated and the return value becomes a dict with ``results``
            (the truncated list), ``truncated`` (True), ``total_count``
            (original length), and a human-readable ``message``.

    Requires TESTRAIL_URL, TESTRAIL_USERNAME, and TESTRAIL_API_KEY environment
    variables to be set. Use browse_testrail_api() and describe_testrail_method()
    first to discover available methods and their parameters.
    """
    # Validate against catalog
    if category not in CATALOG:
        return {
            "error": f"Unknown category '{category}'.",
            "available_categories": sorted(CATALOG.keys()),
        }

    cat = CATALOG[category]
    if method not in cat["methods"]:
        return {
            "error": f"Unknown method '{method}' in category '{category}'.",
            "available_methods": sorted(cat["methods"].keys()),
        }

    # Get client (may raise on missing env vars)
    try:
        client = _get_client()
    except EnvironmentError as e:
        return {"error": str(e)}

    # Dispatch
    try:
        submodule = getattr(client, category)
        func = getattr(submodule, method)

        if extra_params:
            result = _call_with_extra_params(submodule, func, params or {}, extra_params)
        else:
            result = func(**(params or {}))

        if result is None:
            return {"status": "ok"}

        # Post-process list responses
        if isinstance(result, list):
            # Field filtering
            if fields is not None:
                result = [
                    {k: v for k, v in item.items() if k in fields}
                    if isinstance(item, dict)
                    else item
                    for item in result
                ]

            # Truncation
            if max_results is not None and len(result) > max_results:
                total_count = len(result)
                return {
                    "results": result[:max_results],
                    "truncated": True,
                    "total_count": total_count,
                    "message": (
                        f"Results truncated: showing {max_results} of "
                        f"{total_count} items. Use max_results or refine "
                        f"your query to retrieve more."
                    ),
                }

        return result
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"}


def _call_with_extra_params(
    submodule: Any,
    func: Any,
    params: dict[str, Any],
    extra_params: dict[str, Any],
) -> Any:
    """Call *func* while injecting *extra_params* into the HTTP query string.

    The testrail_api_module methods build their query string inside
    ``BaseAPI._build_url``.  We temporarily wrap that method so that the
    extra parameters are appended to every URL built during the call.
    """
    from urllib.parse import urlencode

    original_build_url = submodule._build_url

    def _patched_build_url(endpoint, params=None):
        url = original_build_url(endpoint, params)
        filtered = {k: str(v) for k, v in extra_params.items() if v is not None}
        if filtered:
            separator = "&" if "?" in url else "?"
            url += f"{separator}{urlencode(filtered)}"
        return url

    submodule._build_url = _patched_build_url
    try:
        return func(**params)
    finally:
        submodule._build_url = original_build_url
