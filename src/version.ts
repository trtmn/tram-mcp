/** Server version, in a dependency-free module so any code (server, wizard,
 * unit tests) can import it without pulling in heavier modules.
 *
 * Kept in lockstep with package.json by release-please: the `generic`
 * extra-file entry in .github/release-please-config.json rewrites the
 * annotated line below on every release. test/version.test.ts fails CI if the
 * two ever drift. */
export const VERSION = "0.8.1"; // x-release-please-version
