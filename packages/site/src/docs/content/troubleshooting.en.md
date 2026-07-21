# Troubleshooting

Troubleshooting is not about changing many settings at once. First identify the failing layer: project, session, agent service, model provider, tool, permission, or external connection.

## What This Page Is For

This page provides a path that starts with low-risk checks. Preserve the error and current context before narrowing the problem one step at a time.

## Record Before You Begin

Before retrying or restarting, note:

- The operating system, Anybox version, active project, and directory.
- The active session, selected model, and original error from the failed operation.
- The most recent successful action and any recent Provider, tool, permission, MCP, or plugin configuration change.

Do not expose API keys, access tokens, passwords, private file content, or complete authentication requests in screenshots, logs, or issue reports.

## Recommended Troubleshooting Steps

1. Confirm that the project, session, provider, and model are correct.
2. Identify whether failure occurs before sending, during the model request, or inside a tool call.
3. Check whether a permission request is still waiting for a decision.
4. Reproduce the problem with the smallest read-only task.
5. Change only one relevant setting at a time and verify again.
6. If the problem remains, restart the desktop app or relevant external service.

## Common Symptoms

### A project or session is missing

- Confirm that the directory is accessible and has not moved or been deleted.
- Check whether another project group is selected.
- After the agent service reconnects, allow lists to reload; do not clear application data first.

### A message cannot be sent or receives no response

- Confirm that a session, provider, and model are selected, then review connection errors.
- Test the basic path with a short read-only request such as “state the active project name.”
- If a task is running, wait or use the explicit stop action instead of sending duplicates.

### The model is unavailable

- Check the API key, provider credit, and current network.
- Confirm that the provider still offers the selected model ID.
- For an external agent service, verify its address and authentication, then test a short request.

### The agent cannot find an expected file

- Verify the active project directory, file location, and whether it was renamed.
- Check whether read and search tools are available.
- Provide a clear path relative to the project root instead of opening a broad parent directory.

### A tool is enabled but absent from the agent

- Confirm that changes on the Tools page were saved.
- Check agent policy, read-only session restrictions, and the current platform.
- Registration varies between local and SSH workspaces; use the runtime registry and input schema as truth.

### An MCP tool does not appear immediately

- Review service authentication and diagnostics on the connection page.
- Confirm that the service belongs to the project, task, or a source eligible for progressive discovery.
- Deferred tools may require tool search; re-check names after a service changes.

### A permission request stays pending or fails

- Confirm that the request belongs to the active session and the agent service remains connected.
- Read the failure before retrying; do not select several decisions in succession.
- When necessary, deny it and ask the agent to retry with smaller, explicit parameters.

### File changes do not match the request

- Stop further writes and inspect the active project and recent tool records.
- Identify affected files in the changes view or version control.
- Preserve work that matters before using the project's normal recovery method.

### A long session drifts from its goal

- Restate the goal, confirmed decisions, and unfinished steps; move unrelated work to a new session.
- When the main session is idle with enough history, use compaction for older context.
- Compaction cannot repair wrong facts; the latest explicit instruction wins when content conflicts.

## What Success Looks Like

- A minimal read-only request completes consistently.
- The project, session, provider, and model match the intended context.
- The tool or connection lists its actual available capabilities.
- Permission decisions affect only their requests, and the original steps work consistently after the fix.

## Data and Permission Impact

Logs, error details, and tool inputs may contain paths, commands, service addresses, or project excerpts. Remove secrets, tokens, personal information, and unnecessary business content before sharing.

Do not make clearing data, deleting configuration, or reinstalling the first step. These actions may remove session state or local configuration; understand the impact and preserve backups first.

## Common Questions

### Should I reinstall first?

Usually not. First determine whether the problem belongs to configuration, connection, permission, or one project. Reinstalling does not repair invalid credentials or provider network failures.

### What should an issue report include?

Include the version, operating system, reproduction steps, expected result, actual result, and a redacted error. Use a minimal project instead of a real business repository when possible.

## Next Steps

For model problems, read Model Providers. For tools and MCP, read Tool System. For blocked execution, use Permissions & Approvals. If the issue remains, take a redacted minimal reproduction to the project issue tracker.
