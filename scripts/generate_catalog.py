"""Generate the static TestRail endpoint catalog consumed by the Cloudflare Worker.

Parses the testrail_api_module source with `ast` (no imports, no credentials)
and emits cloudflare/src/catalog.json describing every category/method:
parameter signatures, docstrings, HTTP verb, and endpoint template.

The TypeScript server dispatches generically from this file: path params fill
the endpoint template, remaining params go to the query string (GET) or JSON
body (POST) — the only two patterns testrail_api_module uses.

Usage:
    python scripts/generate_catalog.py [path-to-testrail_api_module-src]

Default source path: the sibling checkout at ~/git/testrail_api_module, falling
back to the installed package location.
"""

from __future__ import annotations

import ast
import json
import sys
from pathlib import Path
from typing import Any

OUTPUT = Path(__file__).resolve().parent.parent / "src" / "catalog.json"


def find_module_src(argv: list[str]) -> Path:
    if len(argv) > 1:
        p = Path(argv[1])
        if (p / "__init__.py").exists():
            return p
        raise SystemExit(f"{p} does not contain __init__.py")
    sibling = Path.home() / "git" / "testrail_api_module" / "src" / "testrail_api_module"
    if (sibling / "__init__.py").exists():
        return sibling
    import importlib.util

    spec = importlib.util.find_spec("testrail_api_module")
    if spec and spec.origin:
        return Path(spec.origin).parent
    raise SystemExit("Cannot locate testrail_api_module source")


def parse_init_mapping(src_dir: Path) -> dict[str, tuple[str, str, str]]:
    """Map attribute name -> (module_name, class_name, description) from TestRailAPI.__init__."""
    tree = ast.parse((src_dir / "__init__.py").read_text())
    mapping: dict[str, tuple[str, str, str]] = {}
    for node in ast.walk(tree):
        if not (isinstance(node, ast.ClassDef) and node.name == "TestRailAPI"):
            continue
        for item in node.body:
            if not (isinstance(item, ast.FunctionDef) and item.name == "__init__"):
                continue
            stmts = item.body
            for i, stmt in enumerate(stmts):
                if not isinstance(stmt, ast.Assign):
                    continue
                target = stmt.targets[0]
                if not (
                    isinstance(target, ast.Attribute)
                    and isinstance(target.value, ast.Name)
                    and target.value.id == "self"
                ):
                    continue
                call = stmt.value
                if not (
                    isinstance(call, ast.Call)
                    and isinstance(call.func, ast.Attribute)
                    and isinstance(call.func.value, ast.Name)
                    and len(call.args) == 1
                    and isinstance(call.args[0], ast.Name)
                    and call.args[0].id == "self"
                ):
                    continue
                attr = target.attr
                module_name = call.func.value.id
                class_name = call.func.attr
                # Attribute docstring: bare string expression right after the assign
                description = f"TestRail {attr} API"
                if i + 1 < len(stmts):
                    nxt = stmts[i + 1]
                    if (
                        isinstance(nxt, ast.Expr)
                        and isinstance(nxt.value, ast.Constant)
                        and isinstance(nxt.value.value, str)
                    ):
                        description = nxt.value.value.strip()
                mapping[attr] = (module_name, class_name, description)
    return mapping


def endpoint_template(node: ast.expr) -> tuple[str, list[str]] | None:
    """Convert the endpoint argument into a template string + path param names.

    'get_priorities'            -> ("get_priorities", [])
    f"get_case/{case_id}"       -> ("get_case/{case_id}", ["case_id"])
    Anything more complex (computed expressions) -> None.
    """
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value, []
    if isinstance(node, ast.JoinedStr):
        parts: list[str] = []
        names: list[str] = []
        for value in node.values:
            if isinstance(value, ast.Constant):
                parts.append(str(value.value))
            elif isinstance(value, ast.FormattedValue) and isinstance(value.value, ast.Name):
                parts.append("{" + value.value.id + "}")
                names.append(value.value.id)
            else:
                return None
        return "".join(parts), names
    return None


def resolve_name_endpoint(
    func: ast.FunctionDef, var_name: str
) -> tuple[str, list[str], list[str]] | None:
    """Resolve a variable used as an endpoint into (template, required, optional).

    Handles the "optional trailing path param" idiom introduced in
    testrail_api_module 0.8.0::

        endpoint = "get_users"
        if project_id is not None:
            endpoint = f"get_users/{project_id}"
        return self._get(endpoint)

    Every assignment to ``var_name`` must resolve to a static template (a bare
    string or an f-string). The richest template (most path params) becomes the
    canonical endpoint; a param missing from any branch is optional, and every
    branch must equal the canonical template with its missing optional
    ``/{name}`` segments stripped. Anything that doesn't fit this shape returns
    None so the method stays "unsupported" rather than dispatching incorrectly.
    """
    candidates: list[tuple[str, list[str]]] = []
    for node in ast.walk(func):
        if not isinstance(node, ast.Assign):
            continue
        if not any(isinstance(t, ast.Name) and t.id == var_name for t in node.targets):
            continue
        tpl = endpoint_template(node.value)
        if tpl is None:
            return None  # a non-static assignment — can't dispatch safely
        candidates.append(tpl)
    if not candidates:
        return None

    canonical_tpl, canonical_names = max(candidates, key=lambda c: (len(c[1]), len(c[0])))
    required = [n for n in canonical_names if all(n in names for _, names in candidates)]
    optional = [n for n in canonical_names if n not in required]

    for tpl_str, names in candidates:
        expected = canonical_tpl
        for opt in optional:
            if opt not in names:
                expected = expected.replace(f"/{{{opt}}}", "")
        if expected != tpl_str:
            return None  # not a clean trailing-optional family
    return canonical_tpl, required, optional


def extract_http_calls(func: ast.FunctionDef) -> list[dict[str, Any]]:
    """Find self._get / self._post / self._api_request calls in a method body."""
    calls: list[dict[str, Any]] = []
    for node in ast.walk(func):
        if not isinstance(node, ast.Call):
            continue
        f = node.func
        if not (
            isinstance(f, ast.Attribute)
            and isinstance(f.value, ast.Name)
            and f.value.id == "self"
            and f.attr in ("_get", "_post", "_api_request")
        ):
            continue
        if f.attr == "_api_request":
            if not node.args:
                continue
            verb_node = node.args[0]
            verb = verb_node.value if isinstance(verb_node, ast.Constant) else None
            endpoint_node = node.args[1] if len(node.args) > 1 else None
        else:
            verb = "GET" if f.attr == "_get" else "POST"
            endpoint_node = node.args[0] if node.args else None
        uses_files = any(kw.arg == "files" for kw in node.keywords if kw.arg)
        template: str | None = None
        path_params: list[str] = []
        optional_params: list[str] = []
        if endpoint_node is not None:
            tpl = endpoint_template(endpoint_node)
            if tpl is not None:
                template, path_params = tpl
            elif isinstance(endpoint_node, ast.Name):
                # The endpoint is a local variable — resolve the conditional
                # "optional trailing path param" idiom from its assignments.
                resolved = resolve_name_endpoint(func, endpoint_node.id)
                if resolved is not None:
                    template, path_params, optional_params = resolved
        calls.append(
            {
                "verb": verb,
                "template": template,
                "path_params": path_params,
                "optional_path_params": optional_params,
                "uses_files": uses_files,
            }
        )
    return calls


def param_info(func: ast.FunctionDef) -> list[dict[str, Any]]:
    params: list[dict[str, Any]] = []
    args = func.args
    positional = args.posonlyargs + args.args
    defaults: list[ast.expr | None] = [None] * (len(positional) - len(args.defaults)) + list(
        args.defaults
    )
    for arg, default in zip(positional, defaults):
        if arg.arg == "self":
            continue
        entry: dict[str, Any] = {"name": arg.arg, "required": default is None}
        if arg.annotation is not None:
            entry["type"] = ast.unparse(arg.annotation)
        if default is not None:
            entry["default"] = ast.unparse(default)
        params.append(entry)
    for kwarg, default in zip(args.kwonlyargs, args.kw_defaults):
        entry = {"name": kwarg.arg, "required": default is None}
        if kwarg.annotation is not None:
            entry["type"] = ast.unparse(kwarg.annotation)
        if default is not None:
            entry["default"] = ast.unparse(default)
        params.append(entry)
    if args.kwarg is not None:
        params.append({"name": args.kwarg.arg, "required": False, "type": "**kwargs"})
    return params


def build_catalog(src_dir: Path) -> dict[str, Any]:
    mapping = parse_init_mapping(src_dir)
    catalog: dict[str, Any] = {}
    for attr, (module_name, class_name, description) in sorted(mapping.items()):
        module_path = src_dir / f"{module_name}.py"
        tree = ast.parse(module_path.read_text())
        cls = next(
            (
                n
                for n in ast.walk(tree)
                if isinstance(n, ast.ClassDef) and n.name == class_name
            ),
            None,
        )
        if cls is None:
            continue
        methods: dict[str, Any] = {}
        for item in cls.body:
            if not isinstance(item, ast.FunctionDef) or item.name.startswith("_"):
                continue
            calls = extract_http_calls(item)
            entry: dict[str, Any] = {
                "doc": ast.get_docstring(item) or "",
                "params": param_info(item),
            }
            usable = [c for c in calls if c["template"] and c["verb"] in ("GET", "POST")]
            if any(c["uses_files"] for c in calls):
                entry["unsupported"] = (
                    "File upload endpoints (multipart) are not supported by the "
                    "Cloudflare Worker deployment."
                )
            elif len(usable) == 1 and len(calls) == 1:
                http: dict[str, Any] = {
                    "verb": usable[0]["verb"],
                    "endpoint": usable[0]["template"],
                    "pathParams": usable[0]["path_params"],
                }
                if usable[0].get("optional_path_params"):
                    http["optionalPathParams"] = usable[0]["optional_path_params"]
                entry["http"] = http
            elif not calls:
                entry["unsupported"] = (
                    "Composite helper with no direct API call; use the underlying "
                    "endpoints instead."
                )
            else:
                # Multiple or computed calls: dispatch the method generically is unsafe.
                entry["unsupported"] = (
                    "Composite method making multiple/dynamic API calls; call the "
                    "underlying endpoints individually."
                )
            methods[item.name] = entry
        catalog[attr] = {"description": description, "methods": methods}
    return catalog


def main() -> None:
    src_dir = find_module_src(sys.argv)
    catalog = build_catalog(src_dir)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(catalog, indent=2, sort_keys=True) + "\n")
    n_methods = sum(len(c["methods"]) for c in catalog.values())
    n_dispatch = sum(
        1 for c in catalog.values() for m in c["methods"].values() if "http" in m
    )
    print(
        f"Wrote {OUTPUT} — {len(catalog)} categories, {n_methods} methods "
        f"({n_dispatch} directly dispatchable)"
    )


if __name__ == "__main__":
    main()
