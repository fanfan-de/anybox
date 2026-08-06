# Projects, Workspaces & Sessions

Anybox uses a project to bound files, a workspace to host the interface, and a session to preserve ongoing collaboration.

| Concept | Meaning |
| --- | --- |
| Project | Related files and tasks, usually the directory you opened |
| Workspace | The desktop environment containing the project tree, sessions, execution records, and tool panels |
| Session | Messages, tool calls, approvals, errors, and change records |

Local folders and SSH workspaces may expose different shell and runtime tools.

## Organize Work

1. Open the smallest directory that fully contains the task and verify its path.
2. Create a session under the intended project.
3. State the goal, read/write scope, and completion criteria in the first message.
4. Use separate sessions for unrelated goals; review recent state and unfinished work before resuming an old one.

An overly broad directory adds noise and expands exposure. Create a new session when the goal or permission boundary changes substantially.

## Inspect Execution

ThreadView is more than chat history: it can show tool calls, sources, approvals, file changes, workflow state, and errors. Completed details may be collapsed, so expand the relevant record and inspect the actual diff or test result.

Switching sessions does not stop a running task. Use the explicit stop action and wait for its state to update.

## Data and Boundaries

Opening a project establishes context; it does not authorize arbitrary commands or writes. Filesystem permissions, tool policy, and call-level approval still apply.

Session history is stored in local agent data. Long sessions may compact older context without deleting project files. Cloud models and SSH workspaces are also governed by provider and remote-host data policies.
