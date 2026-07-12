# Skills

Skills turn repeatable working methods into reusable instructions. They are useful for project conventions, release workflows, testing rules, tool usage, and team preferences.

## What Belongs in a Skill

- Project build, test, and release workflows.
- Code style and architecture boundaries.
- Checklists for recurring tasks.
- Workflows that must follow a fixed order.
- Rules for a specific tool or service.

Do not put temporary chat history, secrets, private accounts, or one-off tasks into a Skill.

## Basic Structure

A Skill is normally described by a `SKILL.md` file with clear trigger conditions and executable steps.

```md
---
name: release-check
description: Check the build, tests, and artifacts before a release.
---

# Release Check

Use this before publishing a release.

1. Run type checking.
2. Run tests.
3. Build the artifacts.
4. Review the release notes and version number.
```

## Recommendations

Keep a Skill short and specific. A Skill that solves one class of problem is easier to maintain than a single oversized document containing every team rule.

## Managing Skills

You can maintain global Skills for personal workflows and project Skills for repository-specific conventions. Project Skills are the better place for build, test, and release rules tied closely to the current codebase.
