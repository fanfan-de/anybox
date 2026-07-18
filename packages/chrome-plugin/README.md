# Anybox Chrome Plugin Project

[简体中文](./README.zh-CN.md)

This directory is the single source project for the Anybox Chrome integration.
The installable plugin directory is generated separately at
`plugins/Anybox-Plugins/chrome`.

## Project layout

```text
packages/chrome-plugin/
  browser-extension/       Vite/TypeScript Chrome extension project
  browser-native-host/     Bun/TypeScript Native Messaging Host project
  runtime/                 Authored plugin manifest, MCP scripts, and Skill
  tools/                   Distribution synchronization and regression tests
  LICENSE
  README.md

plugins/Anybox-Plugins/chrome/
  .anybox-plugin/          Generated canonical manifest
  browser-extension/       Generated extension build
  scripts/                 Generated MCP and Node REPL runtime
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

This command builds the Chrome extension and replaces the final plugin
directory from a strict allowlist. It excludes TypeScript source, tests,
configuration, source maps, dependencies, caches, documentation, and the Native
Host project.

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

## Native Host delivery

The Native Messaging Host source belongs to this project, but its executable is
platform-specific and is delivered by the Anybox desktop packaging pipeline.
The downloadable plugin directory therefore contains the built Chrome
extension and plugin runtime, but not a duplicate Native Host executable.
