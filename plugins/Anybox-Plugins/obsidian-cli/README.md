# Obsidian CLI Anybox Plugin

This is a skill-only Anybox plugin for the official `obsidian` command-line tool. It teaches the agent how to inspect and operate Obsidian vaults from shell commands without bundling an MCP server or storing credentials.

## What It Does

The bundled skills teach the agent to:

- Check whether the Obsidian CLI is installed and enabled.
- Target the active vault, a vault name, or a vault ID.
- Read, create, append, prepend, move, rename, and open Markdown notes.
- Search vault content, tags, links, backlinks, outlines, and properties.
- Work with daily notes and task lists.
- Use developer commands for plugin reloads, screenshots, console messages, and captured errors.

## Prerequisites

Install Obsidian using the 1.12 or newer installer, then enable the CLI:

1. Open Obsidian.
2. Go to Settings > General.
3. Enable Command line interface.
4. Follow the registration prompt.

Verify from PowerShell:

```powershell
obsidian version
obsidian vault
obsidian files total
```

Obsidian CLI commands require the Obsidian desktop app. If it is not already running, the first CLI command can launch it.

## Vault Targeting

If the shell working directory is inside a vault, Obsidian uses that vault by default. Otherwise it uses the active vault.

To target a specific vault, put the vault selector before the command:

```powershell
obsidian vault="Work Notes" search query="roadmap"
obsidian vault="Work Notes" read path="Projects/Roadmap.md"
```

## Smoke Test

Run the read-only smoke test:

```powershell
.\scripts\smoke-test.ps1
```

Run a write smoke test that creates or overwrites a test note:

```powershell
.\scripts\smoke-test.ps1 -WriteTest
```

The CLI itself manages Obsidian state. This plugin only provides skills that tell the agent how to use the CLI safely.
