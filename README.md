# TestRail MCP Server

[![CI](https://github.com/trtmn/tram-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/trtmn/tram-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/tram-mcp?label=npm)](https://www.npmjs.com/package/tram-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Connect Claude to [TestRail](https://www.testrail.com/) — browse the API, search
test cases, and manage runs and results through natural language. Built on the
[Model Context Protocol](https://modelcontextprotocol.io/).

`tram-mcp` runs **locally over stdio** — your MCP client spawns it as a child
process. It's distributed as the npm package
[`tram-mcp`](https://www.npmjs.com/package/tram-mcp) and as a Claude Desktop
`.mcpb` bundle.

> **Migrating from the old Python package?** `tram-mcp` is now a Node/npm package,
> not a PyPI package. Use the install steps below; `uv tool install tram-mcp` /
> `uvx tram-mcp` no longer apply.

## Requirements

- **Claude Code / the `npx` path:** Node.js ≥ 18.
- **Claude Desktop `.mcpb`:** nothing — Desktop bundles its own Node runtime.

## Add to Claude Code

Register the server (a coworker — or Claude Code itself — can run this verbatim):

```bash
claude mcp add tram-mcp -- npx -y tram-mcp
```

That's it — Claude Code spawns `npx -y tram-mcp` over stdio. Start a session and run
`/mcp`; you should see **tram-mcp** with its tools.

> **Windows:** the client spawns the command without a shell, and Windows can't execute
> `npx` (really `npx.cmd`) that way — the server fails to start (`MCP error -32000`). Wrap
> it in `cmd /c`:
>
> ```bash
> claude mcp add tram-mcp -- cmd /c npx -y tram-mcp
> ```

**Logging in — no terminal needed.** The first time you ask Claude to do anything in
TestRail without credentials configured, it calls the **`testrail_login`** tool, which
opens a browser form. Enter your TestRail **URL**, **username**, and **API key** (My
Settings → API Keys in TestRail), submit, and retry your request — the server picks up the
new credentials on the next call, no restart required. They're validated against TestRail
and saved to `~/.tram-mcp/credentials.json` (readable only by you). You can trigger it
anytime by asking Claude to *"log in to TestRail."*

**Prefer the terminal?** Run `npx tram-mcp login` for the same browser form before starting
Claude (see [Configuration](#configuration) for the env-var alternative).

**Prefer to hand it to Claude Code as a prompt?** Paste this:

> Add the TestRail MCP server: run `claude mcp add tram-mcp -- npx -y tram-mcp`, then use
> the `testrail_login` tool so I can enter my TestRail credentials in the browser.

**Prefer environment variables** (CI, or to skip the browser form)? Set `TESTRAIL_URL`,
`TESTRAIL_USERNAME`, and `TESTRAIL_API_KEY` (or `TESTRAIL_PASSWORD`) — they take precedence
over the saved file. You can pass them inline when adding the server:

```bash
claude mcp add tram-mcp \
  -e TESTRAIL_URL=https://yourinstance.testrail.io \
  -e TESTRAIL_USERNAME=you@example.com \
  -e TESTRAIL_API_KEY=your-api-key \
  -- npx -y tram-mcp
```

Manage saved credentials anytime with `npx tram-mcp status` and `npx tram-mcp logout`.

## Add to Claude Desktop

1. Download **`tram-mcp.mcpb`** from the [latest release](https://github.com/trtmn/tram-mcp/releases/latest).
2. Open it (or **Settings → Extensions → Install from file**) and confirm the install.
3. Fill in your TestRail **URL**, **username**, and **API key** in the form. The API key is
   stored in your OS keychain. Done — no terminal, no config editing.

## Other clients (Cursor, VS Code, …)

Any MCP client that runs a stdio command works. Use `npx -y tram-mcp` as the command and
supply credentials via the `TESTRAIL_*` env vars, e.g. `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "tram-mcp": {
      "command": "npx",
      "args": ["-y", "tram-mcp"],
      "env": {
        "TESTRAIL_URL": "https://yourinstance.testrail.io",
        "TESTRAIL_USERNAME": "you@example.com",
        "TESTRAIL_API_KEY": "your-api-key"
      }
    }
  }
}
```

> **Windows:** many MCP clients spawn the command without a shell, and Windows
> can't execute `npx` (really `npx.cmd`) that way — the server fails to start.
> Wrap it in `cmd /c`:
>
> ```json
> {
>   "mcpServers": {
>     "tram-mcp": {
>       "command": "cmd",
>       "args": ["/c", "npx", "-y", "tram-mcp"]
>     }
>   }
> }
> ```

## Configuration

Credentials come from the in-session `testrail_login` tool or `npx tram-mcp login` (both
save to `~/.tram-mcp/`), the Desktop install form, or these environment variables (which
take precedence):

| Variable | Required | Description |
|---|---|---|
| `TESTRAIL_URL` | Yes | Your TestRail instance URL (e.g. `https://example.testrail.io`) |
| `TESTRAIL_USERNAME` | Yes | TestRail username or email |
| `TESTRAIL_API_KEY` | Yes* | TestRail API key (recommended) |
| `TESTRAIL_PASSWORD` | Yes* | TestRail password (alternative to API key) |

*Either `TESTRAIL_API_KEY` or `TESTRAIL_PASSWORD` must be set.

## Development

TypeScript; source in [`src/`](src/), tests in [`test/`](test/).

```bash
npm install
npm run check       # tsc --noEmit
npm test            # vitest
npm run build:cli   # bundle the CLI -> dist/cli.js
```

## Releasing

Automated by release-please. Merge a PR into `development` with a
[Conventional Commit](https://www.conventionalcommits.org/) title; release-please opens a
Release PR that bumps the version. Merging that Release PR tags the release, publishes to
npm, and attaches the `tram-mcp.mcpb` to the GitHub Release. See `CLAUDE.md` for details.

## License

MIT
