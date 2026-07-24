# Changelog

## [0.8.4](https://github.com/trtmn/tram-mcp/compare/v0.8.3...v0.8.4) (2026-07-24)


### 🐛 Fixed

* bound pagination to keep tool calls from closing the stdio transport ([#96](https://github.com/trtmn/tram-mcp/issues/96)) ([64f7651](https://github.com/trtmn/tram-mcp/commit/64f7651c5e0491e12c0067ce5a472b17e313f842))
* point the missing-config hint at the testrail_login tool ([#92](https://github.com/trtmn/tram-mcp/issues/92)) ([dacbf47](https://github.com/trtmn/tram-mcp/commit/dacbf4708446e07284997e73670ac7d50ca01758))

## [0.8.3](https://github.com/trtmn/tram-mcp/compare/v0.8.2...v0.8.3) (2026-07-24)


### 🔄 Maintenance

* type-check with TypeScript 7 native preview (tsgo) ([#89](https://github.com/trtmn/tram-mcp/issues/89)) ([4904231](https://github.com/trtmn/tram-mcp/commit/49042314a8fc93f8569088953ce92f31feef7b69))

## [0.8.2](https://github.com/trtmn/tram-mcp/compare/v0.8.1...v0.8.2) (2026-07-24)


### 🔄 Maintenance

* merge dev-&gt;main sync PR directly instead of via auto-merge ([#86](https://github.com/trtmn/tram-mcp/issues/86)) ([a7db80a](https://github.com/trtmn/tram-mcp/commit/a7db80a5da1446d6d8864b5f434b64c37eeb7ba1))

## [0.8.1](https://github.com/trtmn/tram-mcp/compare/v0.8.0...v0.8.1) (2026-07-24)


### 🔄 Maintenance

* add Windows cmd /c instructions to Claude Code install section ([c531142](https://github.com/trtmn/tram-mcp/commit/c531142f45df7e6034b44d5b244a64194e9f47ff))
* document in-session testrail_login in README install info ([5b66cd1](https://github.com/trtmn/tram-mcp/commit/5b66cd122057f3fb5a02dea7418b55cf425b1805))
* update README install info (in-session login + Windows) ([ffcdbb5](https://github.com/trtmn/tram-mcp/commit/ffcdbb5eac785ce34c85626b9379d75cc1353d8e))

## [0.8.0](https://github.com/trtmn/tram-mcp/compare/v0.7.4...v0.8.0) (2026-07-24)


### ✨ Added

* add in-session testrail_login tool ([#81](https://github.com/trtmn/tram-mcp/issues/81)) ([f7f2453](https://github.com/trtmn/tram-mcp/commit/f7f24537fe97175e041b94c1785db4a2c2a8f46f))


### 🐛 Fixed

* start the stdio server reliably on Windows via a dedicated bin entry ([#78](https://github.com/trtmn/tram-mcp/issues/78)) ([1756147](https://github.com/trtmn/tram-mcp/commit/1756147cbeaf89c1b559644b17ec1b3f320ed5e2))

## [0.7.4](https://github.com/trtmn/tram-mcp/compare/v0.7.3...v0.7.4) (2026-07-21)


### 🐛 Fixed

* follow TestRail pagination and correct query/retry handling ([#75](https://github.com/trtmn/tram-mcp/issues/75)) ([e095b3f](https://github.com/trtmn/tram-mcp/commit/e095b3fa58992b84fa816984046f493561b8f61f))


### 🔄 Maintenance

* **deps:** bump the actions group with 2 updates ([#74](https://github.com/trtmn/tram-mcp/issues/74)) ([9f2b52e](https://github.com/trtmn/tram-mcp/commit/9f2b52ed8df8750af9f384cf137f730c36457882))

## [0.7.3](https://github.com/trtmn/tram-mcp/compare/v0.7.2...v0.7.3) (2026-07-18)


### 🔄 Maintenance

* author release-please PRs with a PAT to drop the CI approval gate ([#70](https://github.com/trtmn/tram-mcp/issues/70)) ([b7856aa](https://github.com/trtmn/tram-mcp/commit/b7856aa31f3bdb19e57144e2e57cf8b7f9c8ca54))

## [0.7.2](https://github.com/trtmn/tram-mcp/compare/v0.7.1...v0.7.2) (2026-07-18)


### 🐛 Fixed

* make the CLI build work on Windows (drive esbuild via its JS API) ([#66](https://github.com/trtmn/tram-mcp/issues/66)) ([e86d410](https://github.com/trtmn/tram-mcp/commit/e86d41017be6fa2e22457d90297ce66994bb0be9))
* report the real package version instead of hardcoded 0.1.0 ([#65](https://github.com/trtmn/tram-mcp/issues/65)) ([cf463dd](https://github.com/trtmn/tram-mcp/commit/cf463dd83333ca817a703c54de1f5b0ece36189d))


### 🔄 Maintenance

* run the test suite on Windows and macOS as well as Linux ([#68](https://github.com/trtmn/tram-mcp/issues/68)) ([f15b4a6](https://github.com/trtmn/tram-mcp/commit/f15b4a6ed106b8ed377377c2df9c0733cdbbe034))

## [0.7.1](https://github.com/trtmn/tram-mcp/compare/v0.7.0...v0.7.1) (2026-07-17)


### 🐛 Fixed

* run the CLI when invoked via a bin symlink ([#62](https://github.com/trtmn/tram-mcp/issues/62)) ([968b1e4](https://github.com/trtmn/tram-mcp/commit/968b1e465964571aa94674421303bf554e236b6c))

## [0.7.0](https://github.com/trtmn/tram-mcp/compare/v0.6.0...v0.7.0) (2026-07-17)


### ⚠ BREAKING CHANGES

* the remote Cloudflare Worker / OAuth deployment is removed; tram-mcp is local stdio only.
* the PyPI package `tram-mcp` is deprecated; install from npm (`npx tram-mcp`) or the Claude Desktop `.mcpb`.

### ✨ Added

* add Cloudflare Workers remote MCP server (TypeScript, OAuth 2.1) ([#50](https://github.com/trtmn/tram-mcp/issues/50)) ([cdbf6b4](https://github.com/trtmn/tram-mcp/commit/cdbf6b4765ab3fd41354aa9f8d672dab25a18943))
* add local browser-login credential wizard and tram-mcp CLI ([#52](https://github.com/trtmn/tram-mcp/issues/52)) ([0ecd625](https://github.com/trtmn/tram-mcp/commit/0ecd625a65d2f4036fa474cdab518e20c26bbc24))
* distribute as npm package (tram-mcp), drop the Python package ([#59](https://github.com/trtmn/tram-mcp/issues/59)) ([c1d3850](https://github.com/trtmn/tram-mcp/commit/c1d385044b72c3946492da50c619ac366978710d))


### 🔧 Changed

* remove the Cloudflare Worker and move the project to the repo root ([#60](https://github.com/trtmn/tram-mcp/issues/60)) ([ae46bfb](https://github.com/trtmn/tram-mcp/commit/ae46bfb7010dca5610c337db4a1a68b51de9c715))


### 🔄 Maintenance

* **deps:** bump fastmcp from 3.3.1 to 3.4.2 in the uv group ([d045a03](https://github.com/trtmn/tram-mcp/commit/d045a030e88183033a4e2e8db9b4d03c9c8cc20c))

## [0.6.0](https://github.com/trtmn/tram-mcp/compare/v0.5.6...v0.6.0) (2026-05-26)


### ✨ Added

* add check_testrail_auth tool ([d30c210](https://github.com/trtmn/tram-mcp/commit/d30c2102d68681a4c5059db0aa28c0108ba99396))
* add check_testrail_auth tool with structured diagnostics ([96a0574](https://github.com/trtmn/tram-mcp/commit/96a0574218031b9bb2b1cf96c8e1779498597d7d))
* defer fastmcp import past initialize via proxy launcher ([f27991f](https://github.com/trtmn/tram-mcp/commit/f27991ff83ef42252376d5a81b2380852ceaf77b))
* defer fastmcp import past initialize via proxy launcher ([bd20641](https://github.com/trtmn/tram-mcp/commit/bd206415a22dc8bf77915725032ee898326cb751))
* pre-bake tools/list response so catalog shows up instantly ([b244390](https://github.com/trtmn/tram-mcp/commit/b244390df512cf1eea58270c9af1c0195dac35a8))


### 🔄 Maintenance

* bump feat: to minor pre-1.0 instead of patch ([076fd46](https://github.com/trtmn/tram-mcp/commit/076fd46813acd72d672c972e1e2756fbca138c87))
* include tram_mcp/__main__.py in .mcpb staging ([7e3bbfa](https://github.com/trtmn/tram-mcp/commit/7e3bbfa62eef28d9784b3cbf537f4ca02a0f2b01))
* stage tram_mcp/tools_static.json into the .mcpb bundle ([e387380](https://github.com/trtmn/tram-mcp/commit/e38738045fcef89320e76e1fa0d0158729a2b0e4))

## [0.5.6](https://github.com/trtmn/tram-mcp/compare/v0.5.5...v0.5.6) (2026-05-23)


### 🔄 Maintenance

* **deps:** bump the actions group with 2 updates ([f2ddc4b](https://github.com/trtmn/tram-mcp/commit/f2ddc4b7b2f4da718ccd750c642cb313d399e1f5))
* **deps:** bump the actions group with 2 updates ([13aee03](https://github.com/trtmn/tram-mcp/commit/13aee0367bf18d140e2a0fa1f44e1aa28e3042e1))

## [0.5.5](https://github.com/trtmn/tram-mcp/compare/v0.5.4...v0.5.5) (2026-05-23)


### 🐛 Fixed

* bump testrail-api-module to 0.7.6 + add Dependabot config ([#33](https://github.com/trtmn/tram-mcp/issues/33)) ([9bc841d](https://github.com/trtmn/tram-mcp/commit/9bc841d391a9659cf6f37953e75cf6395b7f453c))


### 🔄 Maintenance

* set up release-please (mirror testrail_api_module) ([#31](https://github.com/trtmn/tram-mcp/issues/31)) ([867c581](https://github.com/trtmn/tram-mcp/commit/867c581cc197d14ae3d38a1e02fafc2536ba5c8c))
* trigger release-please workflow after enabling PR-create permission ([8235ea2](https://github.com/trtmn/tram-mcp/commit/8235ea2d6180d2cd6e39e89f2b58c51e1335410b))
