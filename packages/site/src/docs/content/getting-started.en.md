# Quick Start

Anybox is a desktop AI agent workspace for local projects. Open a folder or Git repository, then use persistent sessions to ask an agent to inspect code, propose a plan, call tools, and track its results.

## Before You Install

The desktop application is currently Early Access. Its primary targets are:

| Platform | Current status | Release format |
| --- | --- | --- |
| Windows x64 | Early Access | Windows installer |
| macOS Apple Silicon | Early Access | macOS installer |
| Linux x64 | Early Access | AppImage; some releases also include a Debian package |
| Android | Development and early testing | Installable builds, if any, are listed in GitHub Releases |

The iOS and Android clients remain under active development. Treat each Release description and its attached assets as the source of truth for public availability and supported system versions.

If your operating system shows a security warning, verify the publisher, version, and available checksums, and make sure the installer came from the project's GitHub Releases page.

## Install the Desktop App

1. Open the Anybox GitHub Releases page.
2. Select the latest release and check that it includes your platform and architecture.
3. Download the matching asset; do not assume a package for another architecture is compatible.
4. Follow the operating-system prompts, then launch Anybox.
5. Keep the default local agent settings for the first launch and perform a minimal connection check first.

Installation is successful when the workbench, project sidebar, and new-session entry are visible instead of an installer or blank window.

## Open Your First Project

1. Choose **Open folder** from the project sidebar.
2. Select a local directory or Git repository that your account can read and write.
3. Wait for the project to appear in the sidebar and verify its displayed path.
4. For a directory on a server, use **Open remote folder** and configure SSH instead of entering the remote path as a local folder.

When the project loads, its session area becomes available. Git projects can also create isolated worktrees later.

## Connect a Model

1. Open **Settings → Providers**.
2. Select a provider and sign in or enter an API key as directed by the interface.
3. Select **Test connection** and wait for a successful status.
4. Open **Settings → Models** and choose a primary model; configure a small model only if needed.
5. Return to the project and create a session.

Provider and model catalogs are dynamic. If a newly configured model is missing, refresh the provider catalog and check the Models page again.

## Complete a First Session

Start with a read-only request, for example:

```text
Read this project's README and directory structure, then explain how to run it. Do not modify files yet.
```

You should see the agent response, tool activity, and final conclusion. After confirming the project and model are correct, move on to tasks that edit, refactor, or generate files.

## Permissions and Data Effects

- Default mode classifies each tool, command, path, and risk before allowing, asking, or denying it; it does not prompt for every write.
- Critical-risk actions, side effects outside the active project, and some operations on sensitive paths are blocked even in Full Access mode.
- Side Chats are read-only. Planning mode blocks side-effecting tools until a submitted plan is approved.
- Projects, sessions, tasks, approval records, and most runtime state are stored in the local agent data directory.
- Model requests send the prompt, conversation context, and task-relevant file or tool content to the selected provider.
- MCP, connectors, Web Fetch, plugin or Skill marketplaces, and the mobile cloud relay can also make external network requests.

## Common Startup Problems

- The window opens but the agent is unavailable: the default local service is `http://127.0.0.1:4096`, with `/healthz` as its health endpoint. Check port conflicts and security software.
- Only sample content appears or real sessions cannot start: wait for the managed agent to launch, or verify a custom agent URL.
- Provider testing fails: check credentials, account credit, proxy settings, the API base URL, and current model availability.
- A project will not open: verify that the directory exists, your account has access, and you selected a folder rather than a file.
- A platform asset is missing: that release may not include it. Check other recent Releases instead of assuming every release contains every platform.

## Next Steps

After the model connects, read **Model Providers** for dynamic catalogs and custom endpoints, then use **Skills** to turn project conventions and repeated workflows into reusable instructions.
