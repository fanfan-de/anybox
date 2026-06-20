---
name: obsidian-dev
description: Use when developing, testing, reloading, debugging, inspecting, screenshotting, or diagnosing Obsidian community plugins, themes, commands, hotkeys, DOM, CSS, console output, or captured JavaScript errors through Obsidian CLI developer commands.
---

# Obsidian Developer CLI

Use this skill for Obsidian plugin and theme development workflows through the `obsidian` CLI.

## Plugin Commands

```powershell
obsidian plugins filter=community versions format=json
obsidian plugins:enabled filter=community versions format=json
obsidian plugin id=my-plugin
obsidian plugin:enable id=my-plugin filter=community
obsidian plugin:disable id=my-plugin filter=community
obsidian plugin:reload id=my-plugin
```

Use `plugin:reload` after building a community plugin during development. Use enable and disable only when the user explicitly asks.

## Command Palette And Hotkeys

```powershell
obsidian commands
obsidian commands filter=my-plugin
obsidian command id=my-plugin:run-action
obsidian hotkeys verbose format=json
obsidian hotkey id=my-plugin:run-action verbose
```

Only run arbitrary commands when the command ID and intended effect are understood.

## Developer Diagnostics

```powershell
obsidian devtools
obsidian dev:errors
obsidian dev:errors clear
obsidian dev:console limit=100
obsidian dev:console level=error
obsidian dev:screenshot path="obsidian-screenshot.png"
```

After reloading a plugin, check `dev:errors` and `dev:console level=error`.

## DOM, CSS, And CDP

```powershell
obsidian dev:dom selector=".workspace-leaf.mod-active"
obsidian dev:css selector=".markdown-preview-view" prop=color
obsidian dev:cdp method="Runtime.evaluate" params="{\"expression\":\"app.vault.getFiles().length\"}"
```

Use `dev:cdp` only for targeted diagnostics. Keep expressions read-only unless the user explicitly asks for an in-app mutation.

## Eval

```powershell
obsidian eval code="app.vault.getFiles().length"
```

Use `eval` sparingly. Prefer built-in CLI commands for normal vault operations because they are safer and easier to audit.
