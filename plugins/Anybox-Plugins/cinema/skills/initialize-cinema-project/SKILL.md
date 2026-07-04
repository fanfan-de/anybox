---
name: Initialize Cinema Project
description: Initialize, inspect, repair, or migrate an anybox for cinema local film project using only generic shell and file editing tools. Use when the user asks to create, prepare, open, initialize, repair, convert, or migrate a local folder into an anybox for cinema project. Do not use cinema-specific runtime APIs or custom project tools.
---

# Initialize Cinema Project

This skill turns an ordinary local folder into an `anybox for cinema` project. The project folder is the source of truth. AnyBox remains the controller; external browser or canvas UIs are only presentation and interaction surfaces over this local project.

## Hard Rules

- Use only generic shell commands and normal file creation/editing tools.
- Do not call any custom `cinema_*`, `video_workspace_*`, or provider-specific project initialization tools.
- Do not require model deployment. This product assumes users bring their own provider API keys later.
- Do not store API keys inside the project folder during initialization.
- Do not overwrite existing user files. If a file already exists, inspect it and repair only clearly missing Cinema metadata when it is safe.
- Keep the process idempotent: running this skill again should not duplicate folders, duplicate manifest sections, or destroy project data.

## Project Root

Use the user-specified folder as the project root. If no folder is specified, use the current working directory.

Before writing anything, run generic inspection commands:

```bash
pwd
ls -la
test -e .anybox-cinema/project.json && echo "cinema-project: exists" || echo "cinema-project: missing"
```

If the current folder is obviously the wrong location, stop and ask the user for the intended project folder. Otherwise continue.

## Target Structure

Create this structure for a new project, leaving placeholders where product details are not final:

```text
<project-root>/
  .anybox-cinema/
    project.json
    providers.json
    canvas.json
    tasks/
    events.jsonl
    README.md
  scripts/
    README.md
  assets/
    README.md
  references/
    README.md
  prompts/
    README.md
  generated/
    README.md
  renders/
    README.md
  exports/
    README.md
```

Directory intent:

- `.anybox-cinema/`: project metadata owned by anybox for cinema.
- `.anybox-cinema/providers.json`: non-secret provider preferences only; credentials live in AnyBox, not the project.
- `.anybox-cinema/tasks/`: current generation task snapshots, created lazily by the AnyBox Agent Cinema Provider Runtime.
- `assets/`: user-owned source media such as images, clips, audio, and fonts.
- `references/`: mood boards, reference shots, style frames, and research notes.
- `prompts/`: reusable prompt drafts and prompt experiments.
- `generated/`: raw AI generation outputs before editorial selection.
- `renders/`: assembled previews, cuts, and intermediate renders.
- `exports/`: final deliverables.
- `scripts/`: optional local helper scripts. Leave empty unless the user asks for automation.

## New Project Workflow

1. Confirm the project root with `pwd` and inspect existing files with `ls -la`.
2. If `.anybox-cinema/project.json` exists, treat the folder as an existing Cinema project and follow the repair workflow.
3. Create the target directories with `mkdir -p`.
4. Create missing metadata files using normal file creation/editing tools. If only shell is available, use shell heredocs carefully and only for files that do not already exist.
5. Add exactly one initialization event to `.anybox-cinema/events.jsonl` when creating a new project.
6. Report the created files and the next useful action.

Recommended generic shell setup:

```bash
mkdir -p .anybox-cinema/tasks scripts assets references prompts generated renders exports
PROJECT_ID="$(uuidgen 2>/dev/null | tr '[:upper:]' '[:lower:]' || date -u +cinema-%Y%m%d%H%M%S)"
NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
PROJECT_NAME="$(basename "$PWD")"
```

## Metadata Templates

Use these templates for missing files. Replace placeholder values such as `<project-id>`, `<project-name>`, and `<iso-time>` with real values.

### `.anybox-cinema/project.json`

```json
{
  "schemaVersion": 1,
  "projectType": "anybox-for-cinema",
  "id": "<project-id>",
  "name": "<project-name>",
  "createdAt": "<iso-time>",
  "updatedAt": "<iso-time>",
  "status": "draft",
  "description": "",
  "language": "",
  "format": {
    "aspectRatio": "16:9",
    "durationSeconds": null,
    "fps": 24,
    "resolution": ""
  },
  "paths": {
    "assets": "assets",
    "references": "references",
    "prompts": "prompts",
    "generated": "generated",
    "renders": "renders",
    "exports": "exports"
  },
  "ui": {
    "preferredSurface": "external-browser",
    "canvasStyle": "node-canvas",
    "controller": "anybox"
  },
  "placeholders": {
    "story": "",
    "visualStyle": "",
    "targetProviders": []
  }
}
```

### `.anybox-cinema/providers.json`

This file records provider slots only. Do not write secrets here.

```json
{
  "schemaVersion": 1,
  "policy": "bring-your-own-key",
  "secretStorage": "anybox-managed",
  "providers": [],
  "notes": [
    "Provider credentials are configured in the AnyBox credential store, not in this project file.",
    "Cinema v1 uses the cinema-fal credential provider id for fal.ai.",
    "This file may later store non-secret routing preferences, model labels, or project-level provider presets."
  ]
}
```

### `.anybox-cinema/canvas.json`

The canvas is node-first and should be compatible with an Updream-like workspace: dark infinite canvas, draggable cards, connection lines, context menu, minimap, and floating toolbar.

```json
{
  "schemaVersion": 1,
  "canvasType": "node-canvas",
  "viewport": {
    "x": 0,
    "y": 0,
    "zoom": 1
  },
  "nodes": [
    {
      "id": "node-story-brief",
      "type": "text",
      "title": "Story Brief",
      "position": {
        "x": 80,
        "y": 80
      },
      "size": {
        "width": 360,
        "height": 220
      },
      "data": {
        "text": "",
        "placeholder": "Write the film idea, theme, references, and constraints here."
      }
    },
    {
      "id": "node-agent-director",
      "type": "agent",
      "title": "Director Agent",
      "position": {
        "x": 520,
        "y": 120
      },
      "size": {
        "width": 360,
        "height": 220
      },
      "data": {
        "role": "director",
        "placeholder": "Use AnyBox Agent to plan shots, prompts, and generation tasks."
      }
    }
  ],
  "edges": [],
  "nodeTypes": [
    "text",
    "image",
    "video",
    "audio",
    "shot",
    "agent",
    "generation-task",
    "output"
  ]
}
```

### `.anybox-cinema/events.jsonl`

For a new project, create the file and append one JSON line:

```json
{"time":"<iso-time>","type":"project.initialized","actor":"anybox","message":"Initialized anybox for cinema project."}
```

For an existing project, append repair events only when a repair actually changed files.

### README Files

Each directory may contain a short `README.md` explaining its purpose. Keep these files minimal and do not add marketing copy.

Suggested `.anybox-cinema/README.md`:

```markdown
# anybox for cinema

This folder stores local metadata for an anybox for cinema project.

AnyBox is the controller. Browser or canvas interfaces should treat this folder as project state and should not store provider secrets here.
```

Suggested media directory README pattern:

```markdown
# <Directory Name>

Placeholder for project files. This directory is managed by the user and AnyBox.
```

## Existing Project Repair Workflow

If `.anybox-cinema/project.json` exists:

1. Read `.anybox-cinema/project.json`, `.anybox-cinema/providers.json`, and `.anybox-cinema/canvas.json` if present.
2. Validate JSON with a generic parser if one is available, for example:

   ```bash
   node -e "JSON.parse(require('fs').readFileSync('.anybox-cinema/project.json', 'utf8')); console.log('project.json: ok')"
   ```

3. If JSON is invalid, do not overwrite it automatically. Report the invalid file and ask before replacing or rewriting it.
4. If metadata files are missing, recreate only the missing files.
5. If directories are missing, recreate them with `mkdir -p`.
6. Append a `project.repaired` event only when files or directories changed.

## Completion Response

After initialization or repair, tell the user:

- The project root.
- Whether it was newly initialized or repaired.
- The important files created or changed.
- The next recommended step, usually one of:
  - write a project brief in `.anybox-cinema/project.json` or the Story Brief canvas node;
  - add reference materials to `references/`;
  - add source media to `assets/`;
  - open the Cinema Web Canvas through AnyBox;
  - configure the `cinema-fal` API key in AnyBox when real fal.ai generation is needed;
  - create a Generation Task node and test the Mock provider first.
