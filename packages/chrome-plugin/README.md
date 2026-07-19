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
  browser-host/            Plugin-owned policy, IPC Gateway, and Chrome bridge
  browser-native-host/     Rust Native Messaging Host project
  shared/                  Plugin-private Browser Contract and IPC protocol
  docs/                    Browser Contract and Runtime migration design
  runtime/                 Authored manifest, Native Host bootstrap, and Skill
  tools/                   Distribution synchronization and regression tests
  LICENSE
  README.md

plugins/Anybox-Plugins/chrome/
  .anybox-plugin/          Generated canonical manifest
  browser-extension/       Generated extension build
  extension-host/          Platform-specific Rust Native Messaging Host
  scripts/                 Generated Browser Client, Browser Host, and bootstrap
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

This command type-checks and bundles the Browser Client and Browser Host,
builds the Chrome extension and Rust Native Messaging Host, and
replaces the final plugin directory from a strict allowlist. The generated
`plugins/Anybox-Plugins/chrome/scripts/browser-client.mjs` and
`browser-host.mjs` are minified build artifacts and must not be edited directly.
The package excludes TypeScript
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

The plugin declares a requirement on Anybox's platform-owned persistent
`node-repl` connector; it no longer bundles a Chrome-specific MCP server. On
first use, the model imports the bundled `browser-client.mjs` through the
general-purpose `js` tool. The Browser Client starts or reuses the plugin-bundled
`browser-host.mjs` and installs `agent.browsers` for backend discovery, tab
access, inspection, interaction, and screenshots. The Browser Host owns the
versioned Browser Contract, policy, IPC Gateway, and Chrome bridge.
The runtime uses that Browser Contract for
capabilities, a machine-readable API manifest, and dynamic documentation.
Client-side checks provide early errors; the plugin-owned Browser Host is
authoritative for schema and advertised capability checks.
Extension 0.2.0 advertises its Browser Contract version and command set; the
Browser Host exposes only the safe intersection and fails closed on version mismatch.
The first slice explicitly advertises permission/ownership lifecycle features
as unavailable until their policy phases land. Raw page evaluation and full CDP
remain disabled. The plugin no longer registers per-action `browser_*` MCP tools.

Browser requests travel directly from Browser Client to the plugin-owned Browser
Host over authenticated local IPC. The generic Node REPL contains no Chrome
business logic, reverse host-service API, or `anybox.browser-runtime`
capability. The Rust Native Messaging Host connects to the plugin Browser Host
over a separate authenticated local IPC endpoint, then keeps Chrome's
required native stdio framing unchanged. Windows uses Named Pipes; macOS and
Linux use Unix Domain Sockets. Production has no automatic HTTP or WebSocket
browser-control fallback.
The persisted Native Host runtime config contains only non-secret IPC locators
and protocol metadata; a short-lived, one-time Native Host bootstrap proof is
rotated by Browser Host and removed after successful authentication.

The Windows Named Pipe path is covered by cross-process integration tests in
this repository. The Unix Domain Socket implementation shares the same framing
and authentication contract, but was not executed by the current Windows
validation run. The runtime does not yet verify peer PID/SID/uid; OS ACLs and
short-lived proofs reduce exposure but do not provide signed process provenance.

See [the Browser Client Runtime migration design](./docs/browser-client-runtime-migration.md)
for the complete ownership, locator, cancellation, and staged-delivery design.

## Native Host delivery

Like the Codex Chrome plugin, the downloadable Anybox plugin owns its Native
Messaging Host. The current platform binary is generated under
`extension-host/<platform>/<architecture>/`, and `scripts/installManifest.mjs`
registers a user-level Chrome Native Messaging manifest that points directly to
that plugin-owned binary. The Anybox desktop package does not carry a duplicate
host.
