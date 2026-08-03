<div align="center">
  <img src="./packages/mobile-app/assets/icon.png" width="128" height="128" alt="Anybox logo" />

  <h1>Anybox</h1>

  <p><strong>Open-source desktop workspace for local AI agents.</strong></p>
  <p>Run agent sessions, review tool traces, manage MCP servers, and work with local projects from one inspectable desktop app.</p>

  <p>
    English |
    <a href="./README.zh-CN.md">简体中文</a> |
    <a href="https://anybox-ai.pages.dev/">Official Site</a> |
    <a href="https://github.com/fanfan-de/anybox/releases/latest">Download</a> |
    <a href="./packages/site/src/docs/content">Documents</a> |
    <a href="./docs/anybox-third-party-plugin-development.md">Development</a> |
    <a href="https://github.com/fanfan-de/anybox/issues">Feedback</a>
  </p>

  <p>
    <a href="https://github.com/fanfan-de/anybox/releases/latest"><img src="https://img.shields.io/github/v/release/fanfan-de/anybox?style=flat-square&logo=github&label=release" alt="Release" /></a>
    <a href="https://github.com/fanfan-de/anybox/actions"><img src="https://img.shields.io/github/actions/workflow/status/fanfan-de/anybox/desktop-dual-platform.yml?style=flat-square&logo=githubactions&label=desktop%20build" alt="Desktop build status" /></a>
    <a href="./LICENSE"><img src="https://img.shields.io/github/license/fanfan-de/anybox?style=flat-square" alt="License" /></a>
    <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-2563eb?style=flat-square" alt="Supported desktop platforms" />
    <img src="https://img.shields.io/badge/mobile-in%20development-f59e0b?style=flat-square" alt="Mobile app status" />
  </p>

  <p>
    <img src="./packages/site/public/product-preview.png" width="900" alt="Anybox product preview" />
  </p>

  <table>
    <tr>
      <td align="center"><a href="https://anybox-ai.pages.dev/"><strong>Official Site</strong></a><br /><sub>Product website and downloads</sub></td>
      <td align="center"><strong>Community</strong><br /><sub>Placeholder for Discord, Telegram, or WeChat</sub></td>
      <td align="center"><strong>Showcase</strong><br /><sub>Placeholder for media, awards, or launch cards</sub></td>
    </tr>
  </table>
</div>

## Overview

Anybox is an open-source AI Agent desktop workspace for local project collaboration.
It has the core capabilities expected from mainstream desktop agent products. If you are looking for an open-source Claude Code, an open-source Codex, or an open-source Workbuddy-style product, Anybox is built for that direction.

The core idea behind Anybox is to make building software enjoyable while following two principles: no black boxes, and user customization. Everything around the LLM layer should be inspectable, replaceable, and controllable by the user.

## Core Capabilities

- Local project development.
- Cloud server development through SSH.
- Daily office assistance, including document editing and data organization for Excel, PowerPoint, and Markdown.
- Mobile remote control.
- Multi-agent workflows.
- MCP, Skill, and CLI plugins.
- Plugin modules that let users build their own domain-specific plugins as developers.

## Download

Installers are published from GitHub Releases:

- [Latest release](https://github.com/fanfan-de/anybox/releases/latest)
- Current primary desktop targets: Windows x64, macOS Apple Silicon, and Linux x64.

## Platform Status

| Platform | Status | Notes |
| --- | --- | --- |
| Windows x64 | Early access | Primary desktop target |
| macOS Apple Silicon | Early access | Primary macOS target |
| Linux x64 | Early access | AppImage and Debian package; Cinema/Deliver included |
| Android | In development | Companion app package lives in `packages/mobile-app` |

## Quick Start

### Requirements

- Node.js 22+
- pnpm 10.28+
- Bun 1.3+

### Install

```bash
corepack enable
pnpm install
```

### Run The Desktop App

```bash
pnpm dev
```

The desktop app starts the local Anybox agent service automatically by default.

### Run The Agent Service Manually

Use this when you want to inspect or debug the backend independently:

```bash
cd packages/anyboxagent
bun run dev:server
```

The service listens on `http://127.0.0.1:4096` by default.

To make the desktop app connect to an already running service instead of starting its managed service:

```powershell
$env:ANYBOX_DISABLE_MANAGED_AGENT="1"
$env:ANYBOX_AGENT_BASE_URL="http://127.0.0.1:4096"
pnpm dev
```

## Common Commands

```bash
pnpm dev
pnpm build
pnpm dist
pnpm test
pnpm typecheck
pnpm verify:versions
```

Package-specific checks:

```bash
pnpm --filter anybox-desktop-agent typecheck
pnpm --filter anybox-desktop-agent test
pnpm --filter anyboxagent exec tsc --noEmit -p tsconfig.json
pnpm --filter @anybox/shared typecheck
pnpm --filter @anybox/shared test
pnpm --filter @anybox/platform typecheck
pnpm --filter @anybox/platform test
pnpm site:build
```

## Repository Layout

```text
.
|-- .github/                 GitHub Actions and contribution templates
|-- docs/                    Architecture, plugin, connector, and feature notes
|-- packages/
|   |-- desktop/             Electron desktop application
|   |-- anyboxagent/         Bun/Hono agent service and core runtime
|   |-- shared/              Shared API and IPC contracts
|   |-- platform/            Platform adapter utilities
|   |-- monitor/             Monitor web UI
|   |-- site/                Public website and docs
|   |-- mobile-app/          Companion mobile app
|   `-- chrome-plugin/       Complete Chrome integration source project
|-- plugins/                 Curated plugin sources and locally generated catalog
|   `-- Anybox-Plugins/
|       |-- <plugin-id>/     Expanded plugin source packages
|       `-- .catalog/        Versioned Registry, manifest, and ZIP packages
|-- scripts/                 Repository maintenance scripts
|-- package.json             Workspace entrypoint scripts
`-- pnpm-workspace.yaml      Workspace package configuration
```

## Documentation

- [Desktop package notes](./packages/desktop/README.md)
- [Third-party plugin development](./docs/anybox-third-party-plugin-development.md)
- [Plugin module implementation](./docs/plugin-module-implementation.md)
- [Connector development guide](./docs/connector-development-guide.md)
- [Local connector design](./docs/plugin-local-connectors-design.md)
- [Automation feature design](./docs/automation-feature-design.md)
- [Planner module design](./docs/planner-module-design.md)
- [Thread view frontend design](./docs/thread-view-frontend-design.md)
- [Mobile desktop control implementation](./docs/anybox-mobile-desktop-control-implementation.md)
- [Public website docs](./packages/site/src/docs/content)

## Roadmap

- Replace the remaining placeholder cards above with community and launch links.
- Publish richer screenshots for chat, cowork, code, MCP, and Git workflows.
- Continue polishing mobile companion workflows and desktop remote-control support.
- Expand public documentation for plugin authors and connector developers.

## Environment Variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `ANYBOX_AGENT_BASE_URL` | Agent service URL used by the desktop app | `http://127.0.0.1:4096` |
| `ANYBOX_AGENT_WORKDIR` | Default working directory for new sessions | Current process working directory |
| `ANYBOX_DISABLE_MANAGED_AGENT` | Set to `1` to prevent the desktop app from starting its managed agent | Unset |
| `ANYBOX_BUN_BINARY` | Bun executable path used by the managed agent | Auto-detected |
| `ANYBOX_SERVER_HOST` | Agent service host | `127.0.0.1` |
| `ANYBOX_SERVER_PORT` | Agent service port | `4096` |
| `ANYBOX_AGENT_DATA_DIR` | Agent config, cache, log, state, and database directory | App-managed |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development workflow and pull request expectations. Security reports should follow [SECURITY.md](./SECURITY.md).

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE) for details.
