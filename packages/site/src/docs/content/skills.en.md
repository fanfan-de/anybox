# Skills

A Skill is a reusable set of instructions and supporting resources for an agent. It is useful for project conventions, release workflows, test rules, checklists, and guidance for specific tools. It helps the agent load the right method when needed, but it does not bypass tool permissions.

## Open the Skills Workspace

Open **Skills** from the desktop sidebar. The workspace has three main areas:

- **Local**: view and edit user or project Skills; plugin-provided Skills appear read-only.
- **Discover**: search external sources and inspect descriptions, files, versions, and security signals.
- **Downloaded**: manage enablement, updates, installed versions, rollback, and local forks for managed Skills.

## Four Sources

Anybox combines several Skill sources for the current project:

| Source | Typical location or condition | Best use |
| --- | --- | --- |
| Project | `<project>/.anybox/skills/<name>/SKILL.md` | Repository build, test, and architecture rules |
| User | `~/.anybox/skills/<name>/SKILL.md` | Personal methods reused across projects |
| Plugin | An installed, enabled plugin selected for the project | Instructions and resources shipped with a plugin |
| Managed download | Installed from Discover or a URL and shown in Downloaded | Versioned Skills distributed by a registry or third party |

Repository-specific commands belong in a project Skill. Avoid putting an absolute path that only works in one repository into a user-wide Skill.

## Create a Local Skill

1. Open **Skills → Local**.
2. Add a Skill and choose either the user scope or current project.
3. Enter a clear name, trigger description, and ordered instructions.
4. Save it, then verify that the list and `SKILL.md` preview are correct.
5. Start a new session with a matching request and check whether the agent loads the Skill before acting.

You can also use **Import from local file** for an existing `SKILL.md`, or open its file location to maintain supporting resources in an editor.

## Recommended Structure

```md
---
name: release-check
description: Check build, tests, version, and artifacts before release.
---

# Release Check

Use this when preparing an official release.

1. Read the repository release instructions.
2. Run type checking and tests.
3. Build and inspect the artifacts.
4. Report the version, risks, and incomplete work before publishing.
```

The name and description should help the agent decide when the Skill applies. The body should define order, success conditions, stop conditions, and relevant resources. A focused Skill is easier to maintain than one oversized file containing every team rule.

## Download and Enable a Managed Skill

1. Search in **Discover**, or use **Install from URL**. Search and download access external services.
2. Review Overview, README, Files, Versions, and Security before downloading.
3. After download, open **Downloaded**. Managed content is isolated and is not loaded by the agent by default.
4. Turn on **Allow agent to use**, then confirm that the target project's Skill selection includes it.
5. Verify its trigger and instructions with a read-only request.

Downloaded does not mean enabled, and enabled does not mean executed. The agent first receives a discoverable summary and loads full content only when the task requires it.

## Security Boundaries

- A Skill is instructions and resources, not independently executable code. Effects still occur through tools or MCP under project-boundary and permission checks.
- Never store API keys, tokens, private accounts, or customer data in `SKILL.md`, examples, script arguments, or bundled resources.
- External sources can contain misleading instructions, outdated commands, or unsafe resources. Review the contents and publisher before installation.
- Anybox checks download URLs, package size, paths, symlinks, integrity, and available upstream scanning signals.
- A clean scan means no known issue was detected, not that the package is absolutely safe. Blocked versions cannot be downloaded or updated.
- Plugin Skills are managed by their plugin and appear read-only. Create a local Skill when you need an editable variant.

## Update, Roll Back, or Fork

- Select **Check for updates** in Downloaded and review the version and file-change preview first.
- Updates are downloaded and scanned again; a version blocked by security policy is not activated.
- If installed versions remain available, select one from Versions to roll back. Invalid project selections may be cleaned up.
- **Fork to local** creates an editable copy that no longer tracks the managed upstream version automatically.
- Disabling or deleting a managed Skill removes it from agent discovery and cleans project selections that reference it.

## Data and Network Effects

Local Skills live in the user or project directory. A project Skill committed to Git is shared with that repository. Discovering, downloading, reading upstream details, and checking updates contact the relevant registry or hosting service.

When an agent loads a Skill, its instructions and any resources it reads enter the current session context. If the session uses a cloud model, relevant context is then sent to the selected model provider.

## Troubleshooting

- A local Skill is missing: confirm that its directory contains a file named `SKILL.md`, then reopen the project or refresh the workspace.
- A downloaded Skill is ignored: enable it in Downloaded and check the current project's Skill selection.
- A plugin Skill is missing: verify that the plugin is installed, enabled, and selected for this project.
- An update is blocked: read the Security reasons instead of copying the blocked package to evade the check.
- A Skill triggers too often: narrow its description and state both applicable and excluded scenarios.
- The agent skips a step: make success criteria, required commands, and mandatory confirmation points more explicit.

## Next Steps

Create one read-only inspection Skill for the current project and verify discovery and resource loading. Add test, build, or release workflows gradually. Configure a permission-controlled MCP server or plugin separately when a workflow must reach an external system.
