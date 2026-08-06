# FAQ

## What is Anybox?

Anybox is an open-source desktop AI agent workspace for software development and everyday work. It brings projects, sessions, models, tools, permissions, Skills, MCP, and plugins into one workbench.

## Which platforms are supported, and where do I download it?

The main desktop targets are Windows x64, macOS Apple Silicon, and Linux x64, currently in Early Access. Android and iOS remain in development and early testing. Use the actual assets in GitHub Releases as the source of truth for installers, system requirements, and platform status.

## Must I use a cloud model?

No. A custom provider can connect to a team gateway or compatible local endpoint. Anybox does not bundle a local inference engine, so you must install and maintain that service separately.

## How do I configure or switch models?

Sign in or enter an API key under **Settings → Providers** and test the connection, then choose the primary and optional small model under **Settings → Models**. The control at the top of a session can override the global choice. Catalogs are dynamic; use current app and account access as truth.

## Will Anybox modify my project automatically?

Default mode allows, asks, or denies based on the tool, parameters, path, and risk; it does not prompt for every write. For unfamiliar work, begin read-only or use Planning mode and inspect the diff afterward.

## Does Full Access remove every restriction?

No. Critical-risk actions, side effects outside the project, and some operations on sensitive paths remain blocked.

## How do projects, sessions, and tasks relate?

A project maps to a local directory, Git repository, or SSH workspace and can hold multiple sessions. A task is structured execution state inside a session, not a separate project-management board. Git projects can use worktrees to isolate parallel work.

## What is the difference between Skills, MCP, and plugins?

A Skill provides instructions and resources. MCP provides callable tools and data. A plugin can package Skills, MCP, connectors, and display metadata. A managed Skill must also be enabled and selected for the project after download.

## How are credentials and data handled?

Manually saved provider credentials live in local agent-managed data; do not assume operating-system keychain storage or additional encryption. Models, MCP, connectors, marketplaces, and cloud relays may receive task-relevant data. Never place keys in projects, prompts, or Skills.

## What is stored locally, and does Optimize Storage delete sessions?

Projects, sessions, messages, tasks, permission records, and most runtime state are stored in local agent data. Optimize Storage mainly removes expired traces and unreferenced tool artifacts and reclaims SQLite space; it is not intended to delete normal session history.

## What if a model test fails or the agent is unreachable?

For model failures, check credentials, credit, network, API base URL, model ID, and limits. The default agent address is `http://127.0.0.1:4096`, with `/healthz` for health checks; also inspect port conflicts, custom URLs, and security software.

## Why was an action denied without an approval button?

Common causes are read-only policy, an unapproved plan, a path outside the project, a sensitive file, or critical risk. Approval cannot bypass automatic safety policy.

## How do I report an issue?

Use the in-app `/report` flow and review file count, size, destination, and the redaction notice before upload. Redaction is best effort, so never include keys, tokens, or private data in the report text.

If documentation and the app disagree, prefer the installed interface, its matching GitHub Release, and repository source.
