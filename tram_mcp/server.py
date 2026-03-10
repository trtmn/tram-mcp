from __future__ import annotations

import inspect
import os
import re

import subprocess

def _load_env_from_cat():
    """Load env vars by running cat .env (triggers 1Password listener)."""
    try:
        result = subprocess.run(
            ["cat", ".env"],
            capture_output=True, text=True,
            cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        )
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, value = line.partition("=")
                    os.environ[key.strip()] = value.strip()
    except Exception:
        pass

_load_env_from_cat()

import sys  # noqa: E402
from typing import Any  # noqa: E402

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

mcp = FastMCP("TestRail MCP")


@mcp.tool
def list_categories() -> dict[str, Any]:
    """List all available TestRail API categories and their methods.

    Returns a dict mapping each category name to its description and list of
    available method names. Use get_method_info() to get details for a specific method,
    then execute() to call it.
    """
    return {
        name: {
            "description": info["description"],
            "methods": list(info["methods"].keys()),
        }
        for name, info in CATALOG.items()
    }


@mcp.tool
def get_method_info(category: str, method: str) -> dict[str, Any]:
    """Get detailed information about a specific TestRail API method.

    Args:
        category: The API category (e.g. "projects", "cases", "runs").
        method: The method name (e.g. "get_projects", "add_case").

    Returns a dict with parameter details (name, type, required, default),
    docstring, and return type. Use this to understand what parameters
    execute() needs.
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
def execute(category: str, method: str, params: dict[str, Any] | None = None) -> dict[str, Any] | list | str:
    """Execute a TestRail API method.

    Args:
        category: The API category (e.g. "projects", "cases", "runs").
        method: The method name (e.g. "get_projects", "add_case").
        params: Optional dict of parameters to pass to the method.

    Requires TESTRAIL_URL, TESTRAIL_USERNAME, and TESTRAIL_API_KEY environment
    variables to be set. Use list_categories() and get_method_info() first to
    discover available methods and their parameters.
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
        result = func(**(params or {}))
        return result if result is not None else {"status": "ok"}
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"}
