# Skills

A Skill is reusable guidance and supporting resources that an agent loads when relevant. Use Skills for project conventions, test workflows, release steps, and checklists. A Skill does not bypass tool permissions.

## Open the Skills Workspace

- **Local:** edit user or project Skills; plugin Skills are read-only.
- **Discover:** search external sources and inspect files, versions, and security information.
- **Downloaded:** enable, update, roll back, or fork managed Skills.

| Source | Location or condition | Best use |
| --- | --- | --- |
| Project | `<project>/.anybox/skills/<name>/SKILL.md` | Current repository rules |
| User | `~/.anybox/skills/<name>/SKILL.md` | Personal cross-project workflows |
| Plugin | Installed, enabled, and selected for the project | Instructions shipped with a plugin |
| Managed download | Installed through Discover or a URL | Versioned third-party Skills |

## Create a Local Skill

In **Skills → Local**, create a user or project Skill with a clear name, trigger, and ordered steps. For example:

```md
---
name: release-check
description: Check build, tests, version, and artifacts before release.
---

# Release Check

1. Read the repository release instructions.
2. Run type checking and tests.
3. Build and inspect the artifacts.
4. Report the version, risks, and incomplete work before publishing.
```

Keep one Skill focused on one workflow, including order, success criteria, and stop conditions. After saving, verify its trigger with a matching task in a new session.

## Download and Enable

1. Search in **Discover** or install from a URL. Review the publisher, files, versions, and Security information first.
2. Open **Downloaded** and turn on **Allow agent to use**.
3. Confirm that the current project selects the Skill, then verify it with a read-only task.

Downloaded does not mean enabled, and enabled Skills load only when a task matches. Review file changes before updating. **Fork to local** creates an editable copy that no longer follows upstream automatically.

## Security and Troubleshooting

- Never store keys or private data in `SKILL.md`, examples, or resources.
- External Skills may contain outdated or unsafe instructions; a clean scan is not an absolute safety guarantee.
- If a local Skill is missing, confirm that its directory directly contains `SKILL.md`, then refresh the project.
- If a download does not trigger, check enablement, project selection, and the precision of its description.
- If a plugin Skill is missing, confirm that the plugin is installed, enabled, and selected for the project.
