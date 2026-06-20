---
name: obsidian-search
description: Use when searching or analyzing an Obsidian vault, including text search, search context, tags, links, backlinks, unresolved links, orphan notes, dead ends, outlines, recent files, folders, and file lists.
---

# Obsidian Search CLI

Use this skill for vault discovery, retrieval, and lightweight graph analysis through the `obsidian` CLI.

## Text Search

```powershell
obsidian search query="meeting notes"
obsidian search query="TODO" limit=20 format=json
obsidian search:context query="TODO" limit=20
obsidian search:open query="project roadmap"
```

Use `search:context` when the user needs matching lines. Use `format=json` when follow-up parsing matters.

Limit folder scope when possible:

```powershell
obsidian search query="contract" path="Projects/Client A" limit=50 format=json
```

## Files And Folders

```powershell
obsidian files total
obsidian files folder="Projects" ext=md
obsidian folders
obsidian folder path="Projects" info=files
obsidian recents
```

Use file and folder listings before destructive moves or broad write operations.

## Tags And Properties

```powershell
obsidian tags counts format=json
obsidian tag name="#project" verbose
obsidian properties counts format=json
obsidian aliases active
```

Use `active`, `file`, or `path` to narrow commands to a single note.

## Links And Graph Hygiene

```powershell
obsidian backlinks path="Projects/Roadmap.md" counts format=json
obsidian links path="Projects/Roadmap.md" total
obsidian unresolved counts verbose format=json
obsidian orphans total
obsidian deadends total
```

Use these commands to find broken wikilinks, orphan notes, and notes with no outgoing links.

## Outline

```powershell
obsidian outline path="Projects/Roadmap.md" format=json
obsidian outline path="Projects/Roadmap.md" format=md
```

Use outline before summarizing or editing long notes so changes can target the right section.
