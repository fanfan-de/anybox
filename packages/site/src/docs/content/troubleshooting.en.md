# Troubleshooting

Preserve the original error, then identify whether the failure belongs to the project, session, agent, model, tool, permission, or external connection. Change one setting at a time.

## Basic Steps

1. Record the operating system, Anybox version, project path, session, model, and original error.
2. Confirm the active project, session, provider, and model.
3. Determine whether failure occurs before sending, during the model request, or inside a tool call.
4. Check for a pending permission request.
5. Reproduce with the smallest read-only task; restart the relevant service only if it still fails.

Never include keys, tokens, passwords, or private file content in screenshots, logs, or reports.

## Common Problems

| Symptom | Check |
| --- | --- |
| Project or session missing | Directory exists and is accessible; correct project group; do not clear data first |
| Message receives no response | Session, provider, model, and connection errors; do not duplicate a running task |
| Model unavailable | Credentials, credit, network, model ID, region, and rate limits |
| Agent cannot find a file | Active project, relative path, rename status, and read-tool availability |
| Tool missing | Saved switch, agent policy, read-only restriction, and platform registry |
| MCP tool missing | Authentication, diagnostics, project scope, and progressive tool search |
| Permission stays pending | Active session, agent connection, and previous submission error; deny and narrow if needed |
| File changes are wrong | Stop writes, inspect the change view or version control, and preserve important work |
| Long session drifts | Restate the goal and remaining work, move unrelated work to a new session; compaction cannot repair false facts |

## Report an Issue

Include version, operating system, minimal reproduction steps, expected result, actual result, and a redacted error. Prefer a minimal example project.

Do not begin by clearing data, deleting configuration, or reinstalling. These actions may remove sessions and local settings; understand the impact and back up first.
