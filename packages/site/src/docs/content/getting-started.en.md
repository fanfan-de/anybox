# Quick Start

## Download and Install

The desktop app is currently in Early Access. GitHub Releases are the source of truth for installers:

| Platform | Release format |
| --- | --- |
| Windows x64 | Windows installer |
| macOS Apple Silicon | macOS installer |
| Linux x64 | AppImage; some releases include a Debian package |
| Android / iOS | Development and early testing; check each Release |

Download the asset that matches your operating system and architecture. Review the release notes, publisher, and available checksum. Not every release contains every platform.

## Complete Initial Setup

1. Install and launch Anybox, keeping the default local agent settings.
2. Select **Open folder** for a local directory or Git repository. Use **Open remote folder** and SSH for a server directory.
3. Open **Settings → Providers**, sign in or enter an API key, then run **Test connection**.
4. Open **Settings → Models** and choose a primary model.
5. Return to the project and create a session.

Provider and model catalogs update dynamically. If a new model is missing, refresh the provider catalog and check Models again.

## Run a First Task

Verify the read-only path first:

```text
Read this project's README and directory structure, then explain how to run it. Do not modify files yet.
```

Confirm the project, model, tool activity, and result before moving to a write task.

## Permissions and Data

- Default mode allows, asks, or denies based on the tool, parameters, path, and risk; it does not prompt for every write.
- Critical-risk actions, side effects outside the project, and some sensitive-path operations remain blocked in Full Access mode.
- Model requests send the prompt, session context, and task-relevant content to the selected provider. MCP, connectors, plugins, and marketplaces may also contact external services.

## Startup Problems

- **Agent unavailable:** check `http://127.0.0.1:4096/healthz`, port conflicts, and security software.
- **Provider test fails:** check credentials, credit, proxy settings, API base URL, and model status.
- **Project will not open:** confirm the directory exists, your account can access it, and you selected a folder.
- **Platform installer missing:** inspect other recent Releases; never install an asset for the wrong architecture.
