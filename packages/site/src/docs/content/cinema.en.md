# anybox for cinema

anybox for cinema manages an AI film project in a local folder. It organizes storyboards, assets, and generation workflows with four node types: `Text`, `Image`, `Video`, and `Audio`.

> The project folder is the source of truth. The plugin neither stores provider secrets nor acts as a video-generation service; Cinema Runtime uses model services configured separately in Anybox.

## Get Started

1. Install Cinema from Plugins and enable it for the current project.
2. Open a dedicated local workspace.
3. Ask the agent to initialize the project, stating its title, format, duration, and existing assets.

Initialization is idempotent: it restores missing structure without overwriting user files. Invalid JSON is reported instead of replaced with empty content.

Example:

> Initialize a 45-second city-at-night short with a three-shot storyboard using only Text and Image nodes. Do not start generation. List created files and items that need confirmation.

## Project Layout

| Path | Purpose |
| --- | --- |
| `.anybox-cinema/project.json` | Project metadata |
| `.anybox-cinema/providers.json` | Provider bindings without secrets |
| `.anybox-cinema/canvas.json` | Nodes, connections, and canvas state |
| `.anybox-cinema/tasks/`, `events.jsonl` | Task and event records |
| `prompts/`, `references/` | Scripts, prompts, and references |
| `assets/`, `generated/` | Source and work-in-progress generated assets |
| `renders/`, `exports/` | Rendered results and deliverables |

Update canvas references after moving assets. Never store keys or passwords in `.anybox-cinema`.

## Nodes and Tools

| Node | Content |
| --- | --- |
| `Text` | Story, shots, dialogue, prompts, and notes |
| `Image` | Concept art, storyboard frames, and visual references |
| `Video` | Shot clips and rendered results |
| `Audio` | Voice, music, ambience, and sound effects |

The local MCP server provides:

| Tool | Purpose |
| --- | --- |
| `cinema_get_project_summary` | Read project state and nodes |
| `cinema_apply_command` | Modify the canvas after confirmation |
| `cinema_create_storyboard` | Create or update a storyboard after confirmation |

Reading a summary does not authorize later writes. State separately whether writing is allowed, generation should begin, and the agent must stop before cost or external transmission.

## Data and Troubleshooting

Project material remains in the workspace by default. Generation sends required inputs to the selected provider. Credentials belong only in Anybox's credential system.

- **No Cinema structure:** confirm the plugin is enabled and initialize again.
- **Invalid JSON:** back it up and repair it, or explicitly authorize reconstruction from recoverable data.
- **Unknown node:** report references before converting it to one of the four supported types.
- **Storyboard but no video:** verify Cinema Runtime, provider account, credit, and model capability, then request generation explicitly.
