# Projects, Workspaces & Sessions

Anybox starts agent work from a project directory and uses sessions to preserve each continuing collaboration. Understanding these relationships reduces context confusion and makes file access and permission decisions easier to inspect.

## What This Page Is For

This page explains how to choose a project, organize sessions, identify what the active agent is working on, and keep clear boundaries when switching tasks.

## Three Concepts

### Project

A project represents a related set of files and tasks. For local work, it normally corresponds to a directory that you explicitly open. The project name helps identify it, while the directory path determines where tools begin reading and executing.

### Workspace

A workspace is the desktop working environment built around a project. The project tree, session list, execution view, and related panels remain associated here. Different workspace types can expose different tools; for example, local directories and SSH workspaces do not use the same shell capabilities.

### Session

A session preserves one agent collaboration, including user messages, responses, tool traces, errors, permission requests, and task-related change information. A project can contain multiple sessions for separate goals.

## Open a Project

1. Choose the action for opening a folder in Anybox.
2. Select the directory containing the task material, code, or documents.
3. Confirm that the sidebar shows the expected project name and path.
4. Before authorizing writes, ask the agent to describe the directory structure read-only.
5. If the path is wrong, stop the task and switch to the correct project.

Selecting an unnecessarily broad parent directory increases the searchable scope and adds noise. Prefer the smallest reasonable directory that still contains the complete task.

## Create and Organize Sessions

1. Create a session under the intended project.
2. Use the first message to state the goal, allowed scope, and completion criteria.
3. Create separate sessions for unrelated goals.
4. Before continuing old work, review the most recent messages and unfinished items.
5. If the model or tool configuration changes, state how the change affects the task.

Keep one session centered on a stable goal such as “fix the sign-in error” or “prepare release notes” instead of accumulating unrelated tasks in one history.

## Inspect Execution in a Session

ThreadView is an execution record, not only a chat window. It keeps the final response prominent and can also show reasoning summaries, tool calls, sources, approvals, file changes, workflow state, and errors.

Completed tool and reasoning details may be visually de-emphasized or collapsed. Expand the relevant item when verifying work instead of inferring file changes from the final response alone.

## What Success Looks Like

- The active project name and directory match the task material.
- A new session appears under the intended project.
- The agent can locate expected files from the current directory.
- Tool traces and the final response belong to the same task.
- Existing history is available after switching away from and back to the session.
- Results and remaining work are easy to locate when the task ends.

## Data and Permission Impact

Project files remain subject to operating-system access and Anybox tool boundaries. Opening a directory establishes working context; it does not let the agent run every command or modify every file automatically.

Session history is stored by the Anybox agent so it can be reloaded and continued. Long sessions may use context compaction when building later model requests, but this does not delete original project files.

With a cloud model, messages and selected file content entering the model context may be sent to the provider. SSH workspaces and external connections are also governed by the remote host and service permissions.

## Common Questions

### The agent cannot find a file

Confirm the active project directory first, then check whether the file is inside it, whether the required tool is enabled, and whether you accidentally continued in another session.

### Should I continue this session or create a new one?

Continue when the goal, source scope, and completion criteria remain substantially the same. Create a new session when the goal changes clearly or requires different permission boundaries.

### Does switching sessions stop a running task?

Do not treat navigation as a stop action. If a task is still running, use the explicit stop control provided by the current interface and wait for its state to update.

### Is a longer session always better?

No. Long sessions preserve decisions, but unrelated history adds noise. Keep one stable goal and create a new session when the stage of work changes substantially.

## Next Steps

After organizing projects and sessions, read Permissions & Approvals to understand how a tool call is allowed or denied. For long-running work, continue with the context compaction material in Core Concepts.
