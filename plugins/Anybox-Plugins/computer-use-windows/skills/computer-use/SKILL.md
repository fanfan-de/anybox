---
name: Computer Use Windows
description: Control Windows desktop apps through the guarded Computer Use Windows plugin.
---

# Computer Use Windows

Use this skill when a user asks you to control a Windows desktop application through the Computer Use Windows plugin.

## Rules

- Always select a target window from `list_windows` or `get_window` before acting.
- Always call `get_window_state` before coordinate-based actions.
- Use only `windowRef` and `snapshotRef` values returned by the plugin. Do not invent them.
- Coordinates are screenshot-relative pixels. `(0, 0)` is the top-left corner of the latest screenshot.
- Do not guess coordinates when the current snapshot is missing, stale, or from a different window.
- After any state-changing action, call `get_window_state` again to verify the result.
- Control one explicit target window at a time.
- Each action must include a short `purpose` and one `safety` value.
- Use `safety: "normal"` only for low-risk local UI operations.
- Use `safety: "submit_or_send"`, `"delete"`, `"upload"`, or `"install"` when the action could submit, delete, upload, or install anything.
- Never automate authentication dialogs, Windows security settings, payment flows, CAPTCHA, password managers, browser security warnings, lock screens, or terminal/shell windows.
- If a tool returns a safety or stale-snapshot error, stop and observe again instead of retrying blindly.
