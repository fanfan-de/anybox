---
name: obsidian-tasks
description: Use when listing, creating, appending, updating, toggling, completing, or summarizing tasks and daily-note tasks in an Obsidian vault through the official Obsidian CLI.
---

# Obsidian Tasks CLI

Use this skill when the user asks about todos, tasks, checkboxes, daily note tasks, or task status changes in Obsidian.

## Daily Notes

```powershell
obsidian daily
obsidian daily:path
obsidian daily:read
obsidian daily:append content="- [ ] Follow up with Sam" open
obsidian daily:prepend content="## Plan"
```

Use `daily:path` before path-sensitive operations. Use `daily:append` for new tasks unless the user asks to place content elsewhere.

## List Tasks

```powershell
obsidian tasks
obsidian tasks todo
obsidian tasks done
obsidian tasks daily
obsidian tasks verbose format=json
obsidian tasks path="Projects/Roadmap.md" todo
```

Use `verbose` when the next step needs file paths and line numbers.

## Update Tasks

Task updates require a file and line number, or a `path:line` reference from verbose output.

```powershell
obsidian task ref="Projects/Roadmap.md:18" toggle
obsidian task ref="Projects/Roadmap.md:18" done
obsidian task path="Projects/Roadmap.md" line=18 todo
obsidian task daily line=3 done
```

Before changing task status, identify the task unambiguously. If multiple tasks match the user's wording, show the likely matches and ask which one to update.

## Status Characters

```powershell
obsidian tasks 'status=?'
obsidian task ref="Projects/Roadmap.md:18" 'status=-'
```

Quote custom status characters in PowerShell when they could be parsed as shell syntax.

## Safety

Completing or toggling a task is a write operation. Do it directly when the user's instruction is explicit. Ask for clarification when the target task is ambiguous.
