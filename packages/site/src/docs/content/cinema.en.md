# anybox for cinema

anybox for cinema organizes an AI film project as a local folder. It limits the creative canvas to four node types—`Text`, `Image`, `Video`, and `Audio`—so the agent can initialize a project, arrange storyboards, maintain the canvas, and keep source assets and project records in the workspace you chose.

> The project folder is the source of truth, Anybox is the controller, and the canvas is a presentation of those files. The plugin does not store provider secrets or act as a video-generation service. Generation runs through the Anybox Agent Cinema Runtime using provider capabilities that you configure separately.

## When to use Cinema

Cinema is suitable for:

- Starting an editable film project from a synopsis, script, or creative brief.
- Organizing shot notes, reference images, candidate videos, and audio as connected nodes.
- Creating an initial storyboard and continuing to refine shots, prompts, and assets in the same project.
- Reading an existing project's nodes, assets, and event history to recover context.
- Keeping creative assets local while using a provider of your choice for image, video, or audio generation.

If you only need to edit an existing video, play media, or operate a desktop editing application, use that application's own interface or Computer Use Windows. Cinema focuses on project structure and agent workflows; it is not a replacement for a full nonlinear editor.

## Install and enable it for a project

1. Open **Plugins** from the Anybox navigation.
2. Search for `cinema` or `anybox for cinema`, review its local file and canvas-write permissions, and select **Install**.
3. Enable Cinema from the current project's top-menu plugin selector.
4. Open or create a dedicated local workspace for the film project.
5. Start a task and ask the agent to “initialize a Cinema project,” including the title, format, duration, and assets you already have.

Initialization is idempotent: missing managed directories and baseline files are restored without overwriting user files. If an important JSON file is invalid, the agent reports the file and lets you resolve it instead of replacing it with empty content.

## A good first request

Start with a bounded request such as:

> Initialize a Cinema project in this workspace for a 45-second city-at-night short. Create a three-shot storyboard using only Text and Image nodes. Do not start image or video generation. When finished, list the files you created and anything that needs my confirmation.

Then work in stages:

1. Put the brief, script, and references in `prompts/`, `references/`, or `assets/`.
2. Use Text nodes to settle the story, shots, and prompts before adding Image nodes for composition references.
3. Review storyboard order, node connections, and asset paths.
4. When generation is needed, configure the provider in Anybox; keep credentials out of the project.
5. Ask the agent to generate or update assets in small batches, checking the canvas and event history after each batch.
6. Place final output in `renders/` or `exports/` while preserving the traceable project structure.

## Project layout

An initialized project normally includes:

| Path | Purpose |
| --- | --- |
| `.anybox-cinema/project.json` | Project metadata and the Cinema project identity |
| `.anybox-cinema/providers.json` | Provider bindings; it must not contain secrets |
| `.anybox-cinema/canvas.json` | Nodes, connections, and canvas state |
| `.anybox-cinema/tasks/` | Cinema task records |
| `.anybox-cinema/events.jsonl` | Append-only project event history |
| `prompts/`, `references/` | Prompts, scripts, and reference material |
| `assets/`, `generated/` | User-provided and generated work-in-progress assets |
| `renders/`, `exports/` | Rendered results and deliverables |
| `scripts/` | Project-specific helper scripts |

`.anybox-cinema` contains project control data. Never place provider tokens, account passwords, or other secrets there. After moving an asset, ask the agent to check canvas references so nodes do not keep stale paths.

## The four node types

Cinema accepts only these node types:

| Node | Best used for |
| --- | --- |
| `Text` | Story, shot directions, dialogue, prompts, and production notes |
| `Image` | Concept art, storyboard frames, character references, and location references |
| `Video` | Shot clips, animation candidates, and rendered results |
| `Audio` | Voice, music, ambience, and sound effects |

The four types can be connected to express dependencies and creative order. The plugin rejects unknown node types instead of silently writing data that the canvas cannot understand.

## Local MCP tools

Cinema includes a local MCP server with three project-facing tools:

| Tool | Purpose | Default approval |
| --- | --- | --- |
| `cinema_get_project_summary` | Read the project summary, nodes, and current state | Automatic |
| `cinema_apply_command` | Apply an explicit canvas mutation | Ask before writing |
| `cinema_create_storyboard` | Create or update storyboard structure | Ask before writing |

Reading a summary does not authorize a later write. On a write approval, verify the workspace, affected nodes, and asset paths before continuing.

## Write a clear request

- “Read the current Cinema project summary and report missing assets and disconnected nodes. Do not modify files.”
- “Create a six-shot storyboard from `prompts/brief.md`. Show the plan first and ask before writing the canvas.”
- “Add these three references as Image nodes and connect them to the corresponding Text shot notes. Do not start generation.”
- “Check that `.anybox-cinema/canvas.json` contains only Text, Image, Video, and Audio nodes. Report any issue first.”
- “Prepare generation tasks for these two approved shots. Stop before selecting a provider or incurring a charge.”

State whether the agent may write, whether it should generate immediately, and whether it must stop before cost or external transmission. This keeps project orchestration distinct from generation.

## Permissions, credentials, and data boundaries

- Project summaries are read-only; canvas mutations and storyboard creation are local writes with a separate approval.
- Assets, prompts, canvas data, and event history remain in the project folder by default. Inputs needed for a generation request are sent to the provider you selected.
- Provider credentials belong in Anybox's credential store, never in `providers.json`, prompts, or event logs.
- Cinema does not purchase credits, create provider accounts, or bypass a provider's content policy.
- Before generation, asset replacement, bulk canvas changes, or export, review the project and impact scope shown in the approval.

## Troubleshooting

### The workspace has no Cinema structure

Confirm that the plugin is enabled for this project, then ask the agent to initialize or repair the Cinema project. Initialization can be rerun safely and only restores missing managed files and directories.

### A JSON file is invalid

The agent will not overwrite invalid JSON automatically. Back up the file, repair its syntax or explicitly authorize reconstruction from recoverable information, then read the project summary again.

### The canvas contains an unsupported node

Convert it to `Text`, `Image`, `Video`, or `Audio`. Ask the agent to report unknown types and their references before removing any node that may contain user work.

### The storyboard exists but no video was generated

This is an expected boundary. Cinema manages the project and canvas; generation needs an available Cinema Runtime and a configured provider in Anybox. Confirm the account, credits, and model capability, then explicitly request generation.

### An asset cannot be found after it was moved

Ask the agent to reload the project and inspect relative paths in the affected nodes. Keep dependencies inside the project when practical instead of relying on temporary download locations.

## Use it with other plugins

- Use **Build Web Apps** for a project showcase, asset-review surface, or delivery page.
- Use **Chrome** to verify web previews, provider dashboards, or signed-in publishing pages.
- Use **Computer Use Windows** only when the task must operate a native creative application.

## Next steps

Read **Build Web Apps** to create a frontend around a film project, and **Permissions & Approvals** to understand reviews before canvas writes, external generation, and file operations.
