// The executable entry point for the `tram-mcp` bin.
//
// This is the ONLY module that runs on import — and it runs unconditionally.
// There is deliberately no "am I the entry point?" guard: the previous guard
// compared import.meta.url against a realpath'd process.argv[1], which differ on
// Windows (drive-letter casing / short paths / bin shims), so it wrongly
// reported "not main", never started the server, and the MCP client saw the
// stdio pipe close before the handshake ("MCP error -32000: Connection closed").
//
// cli.ts stays side-effect-free so tests (and any future importer) can pull in
// its functions without spawning a server. esbuild bundles this file into
// dist/cli.js (the path package.json's `bin` points at) with the node shebang
// added by the build banner.
import { runCli } from "./cli";

runCli(process.argv.slice(2)).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
