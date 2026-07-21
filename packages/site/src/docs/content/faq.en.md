# FAQ

## What is Anybox?

Anybox is an open-source desktop AI agent workspace for local projects. It brings projects, persistent sessions, models, tools, terminals, permissions, Skills, MCP, and plugins into one workbench.

## Which platforms are supported?

The primary desktop targets are Windows x64, macOS Apple Silicon, and Linux x64, all in Early Access. Linux Releases usually provide an AppImage and some also include a Debian package; the assets attached to each GitHub Release are the source of truth.

## Can I download Android or iOS now?

The mobile clients are in development and early testing, with Android/iOS source and pairing features already in the repository. Check the latest GitHub Releases for public builds and supported system versions; development scripts are not proof of a production release.

## Where should I download an installer?

Choose a version and platform asset from the project's GitHub Releases page. Verify the operating system, CPU architecture, release notes, and available checksums first. Not every release necessarily contains every platform.

## Must I use a cloud model?

Anybox can connect to multiple cloud providers or point a custom provider at a team gateway or compatible service running locally. It does not currently bundle a local inference engine, so a local endpoint must be installed and maintained separately.

## How do I configure a model?

Open **Settings → Providers**, sign in or enter an API key, and run **Test connection**. After it succeeds, use **Settings → Models** to choose the primary and optional small model. A session can override the global model.

## Why is there no permanent list of every model?

Provider and model catalogs refresh dynamically. Names, capabilities, context limits, status, and pricing metadata can change, so use the current in-app catalog, provider notices, and actual account access.

## Will Anybox modify my project automatically?

Default mode classifies tools, commands, paths, and risk before allowing, asking, or denying an action, so it does not prompt for every write. For unfamiliar work, begin with a read-only prompt, Side Chat, or Planning mode and inspect the diff afterward.

## Does Full Access remove every restriction?

No. Full Access reduces routine prompts, but critical-risk actions, side effects outside the active project, and some operations on sensitive paths remain blocked. It is not a project-boundary bypass.

## How is Side Chat different from a normal session?

A normal session can execute tools under the permission policy. A Side Chat is a read-only companion for code questions, error explanations, or context organization and cannot run side-effecting tools.

## How do projects, sessions, and tasks relate?

A project maps to a directory, Git repository, or SSH workspace and can contain multiple sessions. Tasks are structured execution state inside a session, including owners, dependencies, current work, and blockers; they are not a separate project-management board.

## Are SSH workspaces and Git worktrees supported?

Yes. You can open remote folders over SSH, and Git projects can create isolated worktrees for parallel tasks. The available tools differ between remote and local workspaces.

## What is the difference between Skills, MCP, and plugins?

A Skill provides instructions and resources. MCP connects callable tools and data resources. A plugin can package Skills, MCP, connectors, and interface metadata. Their actions still follow project selection and permission policy.

## Why did a downloaded Skill not take effect?

Managed Skills are not loaded by the agent immediately after download. Enable **Allow agent to use** in Downloaded and check the current project's Skill selection. A plugin Skill also requires its plugin to be enabled and selected for the project.

## Where are credentials stored, and is an OS keychain used?

Provider credentials saved manually are kept in agent-managed application data on this computer, with file access restricted where supported. Do not assume OS-keychain storage or additional file encryption, and never place keys in a project, prompt, or Skill.

## What data can leave my computer?

Model calls send prompts, conversation context, and task-relevant file or tool content to the selected provider. MCP, connectors, Web Fetch, plugin or Skill marketplaces, catalog refreshes, and the mobile cloud relay can also contact external services.

## What is stored locally?

Projects, sessions, messages, tasks, archives, permission records, and most runtime state are stored in the local agent data directory. Use **Settings → Storage** to inspect database, trace, tool artifact, and path information.

## Does Optimize Storage delete chat history?

Storage maintenance primarily removes expired runtime traces, unreferenced tool artifacts, and reclaims SQLite space. It is not intended to delete normal messages or session history. Optimization can be unavailable while a session task is running.

## What should I do when a model test fails?

Check the API key or sign-in state, account credit, proxy and firewall, API base URL, model ID, regional limits, and rate limits. Refresh the provider catalog and make sure the session is not overriding the model with an older choice.

## What should I do when the agent is unreachable?

The default local agent is `http://127.0.0.1:4096`, with `/healthz` as its health endpoint. Check whether the managed agent is still starting, the port is occupied, a custom URL is wrong, or security software is blocking localhost.

## Why was an action denied without an approval button?

Common causes are a Side Chat, an unapproved plan, a path outside the active project, a sensitive file, or a critical-risk classification. Approval is for user-decidable actions and does not bypass operations prohibited by automatic safety policy.

## How do I submit a diagnostic report?

Use the in-app `/report` flow to review the file count, size, destination, and redaction notice before actively confirming upload. Redaction is best effort, so do not include keys, tokens, or private data in the description or session.

## What if documentation disagrees with the app?

Prefer the installed version's interface, its matching GitHub Release, and the repository source. Anybox evolves quickly, and platform status, model catalogs, or mobile capabilities can move ahead of or behind website copy.

## What should I read after my first session?

Read **Model Providers** to confirm connectivity and data boundaries, then use **Skills** for project rules. Configure MCP and plugins only when a task genuinely needs external tools or services.
