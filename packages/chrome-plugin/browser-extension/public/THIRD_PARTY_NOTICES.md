# Third-party notices

## Playwright injected locator engine

The bundled `locator-engine.js` contains a deliberately limited build of
Playwright's injected selector and actionability implementation.

- Project: Playwright
- Version: 1.61.1
- Upstream tag: `v1.61.1`
- Upstream commit: `39e3553a4f283a41134d75d7e404484bd9e6865a`
- Pinned entry: `packages/injected/src/injectedScript.ts`
- Entry SHA-256: `a5eb8259c5010c66358d08ab4d3e5ad7c0134aaf7918538cbf888dff8ee10ec3`
- Generated bundle SHA-256: `3ce6afda466d2c04fc8fb5befc699d164322af080f3678e9d6d12425ba2ce7df`
- License SHA-256: `7fab1461b41970ff376f1c9303a637076bfaaeb71cd12dd3a1c44aaf59a1a2b9`
- Notice SHA-256: `6d602191187b35b9b01d2cffa01c8469c2c8d9de8a96f1bf868e0f264f51c81d`
- License: Apache License 2.0

The corresponding license and upstream notice are included in
`licenses/playwright-LICENSE.txt` and `licenses/playwright-NOTICE.txt`.
The reproducible update procedure is
`scripts/sync-playwright-locator-engine.mjs`. Normal extension builds consume
the committed bundle and do not access the network.
