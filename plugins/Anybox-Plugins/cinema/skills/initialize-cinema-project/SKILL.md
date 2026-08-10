---
name: Initialize Cinema Project
description: Initialize or continue an anybox for cinema 1.0 project through the Cinema Web Runtime, then inspect it or seed a storyboard with the bundled Cinema MCP tools.
---

# Initialize Cinema Project

Use this skill when the user wants to create, open, inspect, or begin planning a local anybox for cinema project.

## Runtime ownership

- Treat the Cinema Web Runtime as the only owner of project initialization, repair, and migration.
- Do not create or rewrite `.anybox-cinema` files with shell commands or generic file-editing tools.
- Do not place provider credentials in the project. Configure them in the Cinema App; the Runtime stores supported secrets in the operating-system keychain or uses an explicit session-only fallback.
- Use only the canonical canvas node types: `text`, `image`, `video`, and `audio`.

## Workflow

1. Resolve the requested project folder to an absolute local path and confirm that it exists.
2. Ask the user to open **anybox for cinema** from the Anybox right sidebar.
3. In the Cinema project launcher, choose the folder and use the initialize/open action. The Runtime creates the current project structure and performs any required migration.
4. After initialization, call `cinema_get_project_summary` with the absolute `projectRoot` to verify the project and report its current canvas state.
5. If the user supplied a shot list, call `cinema_create_storyboard` with:
   - the absolute `projectRoot`;
   - a stable, task-specific `idempotencyKey`;
   - one `shots` item per shot, each with a title and optional text or image prompt;
   - `includeImageNodes: true` unless the user asks for text-only planning.
6. Leave provider generation, media editing, migration, and delivery to the Cinema App Runtime.

## Error handling

- `PROJECT_INITIALIZATION_REQUIRED`: initialize the selected folder from the Cinema project launcher, then retry the summary.
- `PROJECT_MIGRATION_REQUIRED`: complete the migration in the Cinema App; do not patch project metadata manually.
- `PROJECT_ID_CONFLICT`: use the Cinema App's migration/clone-ID flow.
- Canvas revision conflict: read the latest project state before retrying a write; do not reuse a command with a stale base revision.

## Completion

Report the project root, whether the Runtime opened or initialized it, the summary returned by Cinema, and any storyboard nodes created. Recommend the next action in the Create, Edit, or Deliver workspace without claiming that MCP tools performed provider generation or rendering.
