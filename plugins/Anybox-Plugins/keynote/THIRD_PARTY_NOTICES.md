# Third-party notices

## ByAxe/keynote-mcp

- Source: https://github.com/ByAxe/keynote-mcp
- Upstream commit: `aca972f8739c024f821ae8d99b293f55b9479ba7`
- Upstream version: `1.0.1`
- License: MIT
- Copyright: `Copyright (c) 2024 Keynote-MCP`

The following directories are redistributed from that commit:

- `runtime/keynote-mcp/src/keynote_mcp/`
- `skills/keynote-presentation/`

The Anybox package adds its own manifest, launcher, lock file, icon, documentation, tests, conservative tool policies,
and macOS/runtime checks. The vendored `pyproject.toml` omits upstream-only development, documentation, and publishing
extras so the runtime lock contains only production dependencies. The upstream MIT license is preserved at
`runtime/keynote-mcp/LICENSE`.

The vendored runtime also moves the optional Unsplash initialization warning from stdout to ASCII-safe stderr. This
keeps MCP JSON-RPC stdout clean and prevents startup failures on hosts whose console encoding cannot represent emoji.
It constrains the upstream `mcp>=1.0.0` dependency to `mcp>=1.0.0,<2.0.0`, because MCP Python SDK 2.x removes the
handler decorator API used by this upstream revision.
