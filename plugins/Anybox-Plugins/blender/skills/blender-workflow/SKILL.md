---
name: blender-workflow
description: Inspect, navigate, render, or modify Blender through the official Blender MCP server. Use when the user asks to work with an open Blender scene, Blender objects, collections, materials, rendering, or the Blender Python API.
license: GPL-3.0-or-later
metadata:
  author: Anybox + Blender Lab
  version: 0.1.0
  mcp-server: plugin.blender.official
  category: design
  tags: [blender, 3d, rendering, python, mcp]
---

# Blender MCP Workflow

Use the installed MCP server `plugin.blender.official`. It talks to the official Blender extension on
`localhost:9876` by default.

## Preflight

1. Confirm Blender 5.1 or newer is open.
2. Confirm the official Blender MCP extension is installed, enabled, and running.
3. Confirm its port matches the Anybox plugin setting.
4. If MCP startup reports that `uv` was not found, stop and direct the user to the plugin installation instructions.
5. If the MCP server starts but a Blender-connected tool reports connection refused, do not reinstall Python packages;
   check the Blender extension, host, port, and auto-start state instead.

## Default workflow

1. Use `get_blendfile_summary_path_info`, `get_blendfile_summary_datablocks`, and `get_objects_summary` to understand
   the open file before proposing changes.
2. Use `search_api_docs`, `search_manual_docs`, or `get_python_api_docs` before guessing Blender API names.
3. Prefer a narrowly scoped purpose-built tool over `execute_blender_code` whenever one exists.
4. Before any mutation, describe the intended objects, data blocks, output paths, and likely side effects.
5. After an approved mutation, inspect the affected objects again and report exactly what changed.
6. For visual work, request a Blender screenshot only when visual evidence will materially improve the result.

For a `*_for_cli` tool, use only a blend-file path explicitly supplied or approved by the user. These tools can start
background Blender and may create then remove a synchronized copy beside a dirty open file. Never probe unrelated
directories or infer sensitive blend-file paths.

## Arbitrary Python safety

`execute_blender_code` runs with Blender's full local process privileges. Before using it:

- make the code as small and deterministic as possible;
- do not access unrelated files, environment variables, credentials, or network endpoints;
- do not save the blend file unless the user explicitly requested persistence;
- avoid destructive operators and deletion unless explicitly requested;
- prefer creating a new output file over overwriting an existing one;
- explain any filesystem or network effect before requesting approval.

Tool approval is not an operating-system sandbox. For untrusted files or sensitive workstations, recommend Blender's
official isolation guidance rather than claiming the plugin can contain arbitrary Python.

## Rendering

- Confirm the output path and whether overwriting is acceptable before rendering.
- Use `render_thumbnail_to_path` for a quick, low-quality preview.
- Use `render_viewport_to_path` only after inspecting the active render engine and relevant scene settings.
- After rendering, report the exact output path and whether current settings were used or temporarily overridden.

## Troubleshooting

| Symptom | Action |
|---|---|
| `uv` executable not found | Configure the absolute `uv` path in the plugin settings and restart the MCP server. |
| MCP initializes but Blender tools fail | Start Blender, enable the official extension, and verify the matching port. |
| Port already in use | Choose another local port in both Blender and the Anybox plugin settings. |
| Documentation tools work but scene tools do not | The stdio server is healthy; diagnose the Blender extension/socket connection. |
| A new upstream tool is missing | Keep using the pinned stable Bundle until the plugin's tool policies are reviewed and upgraded. |
