# Changelog

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
