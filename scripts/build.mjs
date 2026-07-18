// Build the single-file CLI bundle (dist/cli.js) via esbuild's JS API.
//
// This used to be an inline `esbuild ... --banner:js='#!/usr/bin/env node'`
// npm script. The banner value contains a space ("env node"), so it must be
// shell-quoted — and npm runs scripts through cmd.exe on Windows, which does
// not treat single quotes as quoting. There the argument split at the space
// and esbuild saw `node'` as a second input file, failing with "Must use
// outdir when there are multiple input files". Driving esbuild through its JS
// API sidesteps shell quoting entirely, so the build behaves identically on
// Windows, macOS, and Linux.
import { build } from "esbuild";

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "dist/cli.js",
  // Keep the shebang so the published bin is directly executable.
  banner: { js: "#!/usr/bin/env node" },
});
