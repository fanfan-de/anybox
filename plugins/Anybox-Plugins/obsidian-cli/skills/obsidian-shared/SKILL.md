---
name: obsidian-shared
description: Use when setting up, verifying, or troubleshooting the official Obsidian CLI, selecting a vault, checking CLI availability, or handling Obsidian CLI command failures.
---

# Obsidian Shared CLI

Use this skill before more specific Obsidian skills when the request depends on the `obsidian` command being available, the target vault is ambiguous, or a command fails.

## Preconditions

- The user must have Obsidian installed from the 1.12 or newer installer.
- The user must enable Settings > General > Command line interface inside Obsidian.
- Obsidian CLI requires the desktop app. If the app is not running, the first command may launch it.

## First Checks

Run these from PowerShell when starting a task or diagnosing a failure:

```powershell
obsidian version
obsidian vault
obsidian vaults verbose
obsidian files total
```

If `obsidian` is not recognized, tell the user to enable the command line interface in Obsidian settings and complete the registration prompt.

## Vault Selection

If the current shell directory is inside a vault, Obsidian targets that vault. Otherwise it targets the currently active vault.

To force a vault, put `vault=<name-or-id>` before the command:

```powershell
obsidian vault="Work Notes" search query="roadmap"
obsidian vault="Work Notes" read path="Projects/Roadmap.md"
```

Use `vaults verbose` to discover vault names and paths before choosing a vault.

## Parameters

CLI parameters use `key=value`.

Use `file=<name>` for wikilink-style file resolution. Use `path=<vault-relative-path>` when the exact vault-relative path is known. Prefer `path` for automation because it is less ambiguous.

Use quoted values when a value contains spaces:

```powershell
obsidian create name="Meeting Notes" content="Hello"
```

For multiline content, use `\n` sequences unless a local script safely passes the argument as one string.

## Safety Rules

- Prefer read-only commands until the user clearly asks for a write.
- Confirm before `delete permanent`, bulk edits, history restore, sync restore, or overwrite operations that can replace user content.
- Avoid shell pipelines that transform Obsidian output before inspecting it when correctness matters. Prefer JSON output flags when supported.
- When a command fails, run `obsidian help <command>` before guessing syntax.

## Useful Diagnostics

```powershell
obsidian help
obsidian help read
obsidian commands filter=obsidian
obsidian dev:errors
obsidian dev:console limit=50
```
