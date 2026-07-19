# Anybox Chrome Plugin Project

[简体中文](./README.zh-CN.md)

This directory is the single source project for the Anybox Chrome integration.
The installable plugin directory is generated separately at
`plugins/Anybox-Plugins/chrome`.

## Project layout

```text
packages/chrome-plugin/
  browser-extension/       Vite/TypeScript Chrome extension project
  browser-runtime/         TypeScript browser SDK bundled to browser-client.mjs
  browser-native-host/     Rust Native Messaging Host project
  runtime/                 Authored manifest, Node REPL MCP script, and Skill
  tools/                   Distribution synchronization and regression tests
  LICENSE
  README.md

plugins/Anybox-Plugins/chrome/
  .anybox-plugin/          Generated canonical manifest
  browser-extension/       Generated extension build
  extension-host/          Platform-specific Rust Native Messaging Host
  scripts/                 Generated Node REPL and browser client runtime
  skills/                  Generated Chrome Skill
  LICENSE
```

Developers edit only `packages/chrome-plugin`. The generated plugin directory
is committed because Anybox installs it by downloading the complete GitHub Tree
directory. It is not a ZIP distribution.

## Build and synchronize

From the repository root:

```powershell
corepack pnpm chrome-plugin:package
```

This command type-checks and bundles `browser-runtime/src/browser-client.ts`
with esbuild, builds the Chrome extension and Rust Native Messaging Host, and
replaces the final plugin directory from a strict allowlist. The generated
`plugins/Anybox-Plugins/chrome/scripts/browser-client.mjs` is a minified build
artifact and must not be edited directly. The package excludes TypeScript
source, Rust source, tests, configuration, source maps, dependencies, caches,
and documentation.

Run the packaging regression tests:

```powershell
corepack pnpm chrome-plugin:package:test
```

Verify that the committed plugin directory is current without modifying it:

```powershell
corepack pnpm chrome-plugin:package:check
```

Commit source changes and the regenerated `plugins/Anybox-Plugins/chrome`
directory together.

## Browser control architecture

The plugin registers one persistent `node-repl` MCP server. The model uses its
`js` tool and the preloaded `agent.browsers` API for tab discovery, inspection,
interaction, and screenshots. Raw page evaluation, selector adapters, and CDP
are disabled until command-level capability and permission policy is available.
The plugin no longer registers per-action `browser_*` MCP tools.

The isolated browser gateway Worker connects to the Anybox Agent Browser Policy
Gateway over authenticated local IPC. The Rust Native Messaging Host uses a
separate authenticated IPC endpoint, then keeps Chrome's required native stdio
framing unchanged. Windows uses Named Pipes; macOS and Linux use Unix Domain
Sockets. Production has no automatic HTTP or WebSocket browser-control fallback.
The persisted Native Host runtime config contains only non-secret IPC locators
and protocol metadata; a short-lived, one-time bootstrap proof is rotated by the
Agent and removed after successful authentication.

The Windows Named Pipe path is covered by cross-process integration tests in
this repository. The Unix Domain Socket implementation shares the same framing
and authentication contract, but was not executed by the current Windows
validation run. The runtime does not yet verify peer PID/SID/uid; OS ACLs and
short-lived proofs reduce exposure but do not provide signed process provenance.

## Native Host delivery

Like the Codex Chrome plugin, the downloadable Anybox plugin owns its Native
Messaging Host. The current platform binary is generated under
`extension-host/<platform>/<architecture>/`, and `scripts/installManifest.mjs`
registers a user-level Chrome Native Messaging manifest that points directly to
that plugin-owned binary. The Anybox desktop package does not carry a duplicate
host.
