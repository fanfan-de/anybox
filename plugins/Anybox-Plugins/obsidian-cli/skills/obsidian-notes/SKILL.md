---
name: obsidian-notes
description: Use when reading, creating, opening, appending, prepending, moving, renaming, deleting, templating, or editing Markdown notes in an Obsidian vault through the official Obsidian CLI.
---

# Obsidian Notes CLI

Use this skill when the user wants to operate Markdown files or daily notes in an Obsidian vault through the `obsidian` CLI.

## Read And Inspect

Prefer exact vault-relative paths when known:

```powershell
obsidian read path="Projects/Roadmap.md"
obsidian file path="Projects/Roadmap.md"
obsidian outline path="Projects/Roadmap.md" format=json
obsidian wordcount path="Projects/Roadmap.md"
```

Use `file=<name>` only when a wikilink-style file name is likely unique:

```powershell
obsidian read file=Roadmap
```

## Create Or Open Notes

```powershell
obsidian create path="Inbox/New idea.md" content="# New idea\n\nDraft notes" open
obsidian create name="Untitled note" content="Scratch text"
obsidian open path="Inbox/New idea.md"
obsidian open path="Inbox/New idea.md" newtab
```

Use `overwrite` only when the user explicitly asks to replace the existing note or has confirmed replacement.

## Append Or Prepend

```powershell
obsidian append path="Projects/Roadmap.md" content="- Follow up with design"
obsidian prepend path="Projects/Roadmap.md" content="status: draft"
```

`prepend` inserts after frontmatter. Use it for summary text or front-of-note content. Use `append` for logs, tasks, and journal entries.

## Templates

```powershell
obsidian templates
obsidian template:read name="Meeting" resolve title="Project Sync"
obsidian create path="Meetings/Project Sync.md" template="Meeting" open
```

If a template name is uncertain, list templates before creating the note.

## Move, Rename, Delete

These are write operations. Use them only when the user clearly requested the operation.

```powershell
obsidian move path="Inbox/Idea.md" to="Projects/Idea.md"
obsidian rename path="Projects/Idea.md" name="Project idea"
obsidian delete path="Projects/Old.md"
```

Do not use `permanent` unless the user explicitly asks for permanent deletion after understanding it skips trash.

## Properties

```powershell
obsidian property:read path="Projects/Roadmap.md" name=status
obsidian property:set path="Projects/Roadmap.md" name=status value=active type=text
obsidian property:remove path="Projects/Roadmap.md" name=status
```

Use `properties path=... format=json` to inspect existing properties before changing them.
