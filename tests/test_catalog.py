"""Tests for _build_catalog() correctness."""
from __future__ import annotations

from testrail_mcp.server import CATALOG


EXPECTED_CATEGORIES = {
    "attachments",
    "bdd",
    "cases",
    "configurations",
    "datasets",
    "labels",
    "milestones",
    "plans",
    "priorities",
    "projects",
    "reports",
    "result_fields",
    "results",
    "roles",
    "runs",
    "sections",
    "shared_steps",
    "statuses",
    "suites",
    "templates",
    "tests",
    "users",
    "variables",
    "groups",
}


def test_catalog_has_all_24_categories():
    assert set(CATALOG.keys()) == EXPECTED_CATEGORIES
    assert len(CATALOG) == 24


def test_catalog_categories_have_description():
    for name, info in CATALOG.items():
        assert isinstance(info["description"], str), f"{name} description not a string"
        assert len(info["description"]) > 0, f"{name} has empty description"


def test_catalog_categories_have_methods():
    for name, info in CATALOG.items():
        assert isinstance(info["methods"], dict), f"{name} methods not a dict"
        assert len(info["methods"]) > 0, f"{name} has no methods"


def test_method_has_required_keys():
    for cat_name, cat_info in CATALOG.items():
        for meth_name, meth_info in cat_info["methods"].items():
            for key in ("parameters", "docstring", "return_type"):
                assert key in meth_info, (
                    f"{cat_name}.{meth_name} missing '{key}'"
                )


def test_required_params_marked_correctly():
    method = CATALOG["projects"]["methods"]["get_project"]
    assert "project_id" in method["parameters"]
    assert method["parameters"]["project_id"]["required"] is True


def test_optional_params_have_defaults():
    # Find any method with an optional param that has a default
    found = False
    for cat_info in CATALOG.values():
        for meth_info in cat_info["methods"].values():
            for pinfo in meth_info["parameters"].values():
                if pinfo.get("required") is False and "default" in pinfo:
                    found = True
                    break
            if found:
                break
        if found:
            break
    assert found, "No optional parameter with a default value found in the entire catalog"


def test_kwargs_methods_handled():
    # Many update methods accept **kwargs
    found = False
    for cat_info in CATALOG.values():
        for meth_info in cat_info["methods"].values():
            for pname, pinfo in meth_info["parameters"].items():
                if pinfo.get("type") == "**kwargs":
                    assert pinfo["required"] is False
                    found = True
                    break
            if found:
                break
        if found:
            break
    assert found, "No **kwargs parameter found in the entire catalog"


def test_private_methods_excluded():
    for cat_info in CATALOG.values():
        for meth_name in cat_info["methods"]:
            assert not meth_name.startswith("_"), (
                f"Private method '{meth_name}' should be excluded"
            )


def test_self_param_excluded():
    for cat_info in CATALOG.values():
        for meth_name, meth_info in cat_info["methods"].items():
            assert "self" not in meth_info["parameters"], (
                f"'self' should not appear in parameters of {meth_name}"
            )
