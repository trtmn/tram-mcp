# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an MCP (Model Context Protocol) server for TestRail, written in **TypeScript**.
It runs locally over **stdio** — the default for coworkers. Run via `npx tram-mcp` (or the
Claude Desktop `.mcpb`). Credentials come from a one-time browser login (`tram-mcp login`,
saved to `~/.tram-mcp/credentials.json`) or `TESTRAIL_*` env vars.

**Key design principle:** the server doesn't import a TestRail SDK at runtime. Instead
`scripts/generate_catalog.py` AST-parses the `testrail_api_module` source
(sibling checkout at `~/git/testrail_api_module`) into `src/catalog.json`, and
dispatch is generic (path params fill the endpoint template; the rest go to query string
for GET / JSON body for POST). Regenerate with `npm run catalog` when the Python module
changes. This is the one build-time Python dependency; there is no Python at runtime.

> **History:** this was formerly a Python/PyPI package (FastMCP + `testrail_api_module`),
> then briefly also a Cloudflare Worker. Both are removed; `tram-mcp` is now solely an npm
> package running local stdio.

## Repository layout

The TypeScript project lives at the **repo root**. Key files in `src/`:

- `tools.ts` — MCP tool registration (transport-agnostic)
- `testrail.ts` — TestRail HTTP client (fetch + Basic auth)
- `env.ts` — credential resolution (`getCredentials`: client-supplied props, else `TESTRAIL_*`)
- `catalog.ts` / `catalog.json` — generated endpoint catalog + generic dispatch
- `stdio.ts` — stdio adapter; `resolveLocalEnv()` does env → credstore → none
- `credstore.ts` — `~/.tram-mcp/credentials.json` (0600) read/write
- `wizard.ts` — the `tram-mcp login` browser credential form (loopback, CSRF + Host-checked)
- `cli.ts` — the `tram-mcp` bin: default = stdio server; `login` / `logout` / `status`

## Tech Stack

- **TypeScript, Node ≥ 18** (core relies on Node globals: `fetch`, `btoa`, `crypto`)
- `@modelcontextprotocol/sdk` (stdio transport), `zod`
- Build: `esbuild` (bundles `dist/cli.js`, inlining the catalog); tests: `vitest`

## Common Commands

Run from the repo root:

```bash
npm install          # install deps
npm run check        # tsc --noEmit
npm test             # vitest (run all)
npx vitest run stdio # run one test file
npm run build:cli    # bundle the CLI -> dist/cli.js
npm run catalog      # regenerate catalog.json from ~/git/testrail_api_module
```

## Authentication & Secrets

- Credentials resolve in this order (local stdio): a complete `TESTRAIL_*` env set →
  the wizard-saved `~/.tram-mcp/credentials.json` → none (tools return a "run
  `tram-mcp login`" message).
- Supported env vars: `TESTRAIL_URL`, `TESTRAIL_USERNAME`, `TESTRAIL_API_KEY`,
  `TESTRAIL_PASSWORD`. Either the API key or password must be set (both map to the Basic
  auth secret; API key recommended).
- `tram-mcp login` opens a loopback browser form, validates against TestRail
  (`get_priorities`), and saves to `~/.tram-mcp/` (0600). The form is CSRF-token + Host
  gated (see `wizard.ts`).
- **Do NOT hardcode credentials** in committed config. The repo `.mcp.json` is gitignored.
- If auth fails repeatedly, check for **account lockout** — TestRail locks accounts after
  too many failed attempts (~10 min cooldown).

## Distribution

- **npm**: published as [`tram-mcp`](https://www.npmjs.com/package/tram-mcp). Coworkers run
  `npx tram-mcp` (default = stdio server) after `npx tram-mcp login`. `bin` → `dist/cli.js`;
  `prepublishOnly` runs `build:cli`; `files: ["dist/cli.js"]` ships only the bundle.
- **`.mcpb` (node)**: `manifest.json` declares the Claude Desktop extension. The bundle is
  **built by CI** on release (see `release-please.yml`'s `build-mcpb` job) and attached to
  the GitHub Release — **do not commit `.mcpb` files** (gitignored). It uses `user_config`
  so Desktop prompts for URL/username/API key at install (no terminal).
- Client setup for coworkers lives in the root `README.md` (Claude Code + Desktop).

## TestRail Instance Notes

- **URL:** set via `TESTRAIL_URL` (e.g. `https://yourinstance.testrail.io`).
- **Templates:** Template 1 = "Test Case (Text)" uses `custom_steps`/`custom_expected`.
  Template 2 = "Test Case (Steps)" uses `custom_steps_separated` (array of
  `{content, expected}`). To use separated steps, set `template_id: 2`. When updating a
  case from Text to Steps, change `template_id` in the same call. Template 1 requires
  `custom_steps` — can't be null.

## Git Rules

- **Never** add `Co-Authored-By` lines to commit messages.

## Branching Strategy

- **`main`** — production mirror; always reflects the latest published npm version. Never
  commit directly (ruleset: no force-push, no delete). Only auto-merged sync PRs from
  `development` (opened by the release workflow) reach it.
- **`development`** — integration branch. All feature work merges here first via PR.
  release-please watches this branch.
- **Feature branches** — branch from `development`, open a PR back into `development`.

## Commits

Uses **Conventional Commits** to drive release-please's versioning and CHANGELOG. PR titles
(which become squash-commit subjects) must use a type prefix:

- `feat:` — new functionality (minor bump pre-1.0)
- `fix:` — bug fix (patch)
- `chore:`/`docs:`/`ci:`/`build:`/`refactor:`/`perf:`/`test:`/`style:`/`deps:` — no bump alone
- Breaking: add `!` (`feat!:`) or a `BREAKING CHANGE:` body line.

## Releasing (release-please)

Automated by `googleapis/release-please-action`. Config: `.github/release-please-config.json`
(`release-type: node`, package path `.`), version at
`.github/.release-please-manifest.json`.

1. Merge a conventional-commit PR into `development`.
2. release-please opens/updates a **Release PR** bumping `package.json`,
   `manifest.json` (via `extra-files`), and `CHANGELOG.md`.
3. Merging the Release PR: tags `vX.Y.Z` + GitHub Release, **publishes to npm** (needs the
   `NPM_TOKEN` repo secret), packs the node `tram-mcp.mcpb` and attaches it to the Release,
   then opens an auto-merging `development → main` sync PR.

`v*` tags and `main` are protected by repo rulesets.

## TestRail API Module Reference

The catalog is generated from the `testrail_api_module` package
(https://github.com/trtmn/testrail_api_module). Endpoints are organized into submodules:
projects, cases, runs, results, attachments, bdd, configurations, labels, sections, users,
statuses, plans, datasets, milestones, suites, priorities. Docs:
https://trtmn.github.io/testrail_api_module/
