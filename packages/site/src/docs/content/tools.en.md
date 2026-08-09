# Tool System

Tools determine what an agent can read, search, execute, or modify. The desktop Tools page manages global availability for built-ins only; agent, session, and call-level policy still govern execution.

> Visible tools vary by operating system, workspace type, MCP connections, and active agent policy.

## Understand the Design First

Think of the agent as a worker: a Tool is one concrete instrument, a Tool Module is the toolbox that groups related instruments, a Provider says where that toolbox came from, and Permission is the lock checked for each use.

Anybox does not send every tool to the model at once. Core capabilities such as files and Shell remain in the always-on catalog, while domain capabilities such as Planner load on demand. This keeps unrelated schemas out of context and reduces the chance that the model selects the wrong tool.

A tool call moves through these stages:

```text
Tool sources and module catalog
  → decide what this turn should expose
  → apply global selection, Agent policy, and read-only limits
  → let the model select a concrete tool
  → evaluate this call's arguments, paths, and risk for approval
  → execute and return a structured result to the model and UI
```

A loaded module therefore means only that the agent can now see its tools. An enabled tool does not mean that every call is automatically approved. Capability discovery and execution authorization remain separate decisions.

## Tool Module Overview

The Tools page organizes tools by capability module. Always-on modules remain in the runtime catalog and can be enabled or disabled globally. On-demand modules load only when the current task needs them.

| Module | Loading | Tool count | Primary purpose |
| --- | --- | ---: | --- |
| Human Interaction | Always on | 1 | Ask a structured question and wait for the user |
| Tasks | Always on | 4 | Track plans, dependencies, and progress in the current Agent run |
| File Read and Write | Always on | 4 | Read, edit, patch, and inspect workspace files |
| Shell | Always on | 5 in a local Windows workspace | Run commands in explicit managed shells and operate background processes |
| Multi-agent | Always on | 4 | Spawn, inspect, wait for, and cancel child Agents |
| Progressive Disclosure | Always on | 7 | Discover tools, Skills, MCP resources, and workspace dependencies as needed |
| Programmatic Orchestration | Always on | 2 | Combine calls with JavaScript or safe parallel execution |
| Python Runtime | Always-on module; tool disabled by default in local workspaces | 1 | Run code in a persistent IPython environment for the current session |
| Metacognition | Always on | 2 | Inspect and return to earlier session checkpoints |
| File Search | Always on | 3 | List directories and search paths or file contents |
| Visual Generation | Always on | 1 | Generate images with the configured image model |
| Network | Always on | 1 | Fetch public web pages or JSON resources |
| LSP Tools | Always on | 4 | Understand code symbols through language servers |
| Planner | On demand | 12 | Manage persistent todos, schedules, proposals, and Agent runs |

The Tasks module breaks down work inside the current Agent session. Planner stores todos and schedules that persist across sessions; the two modules do not share task data.

Here, **always on** means that the module belongs to the runtime catalog; it does not guarantee that its tools are visible to the model. IPython, for example, is disabled by default and enters the candidate set only after the user explicitly enables it.

## Always-on Tool Modules

### Human Interaction

`interaction.human` lets the Agent pause and confirm a missing requirement with the user.

| Tool | Purpose |
| --- | --- |
| Ask User Question (`ask_user_question`) | Ask a structured clarifying question and wait for the reply before continuing. |

### Tasks

`workflow.tasks` breaks down and tracks the current Agent run. It does not create Planner todos.

| Tool | Purpose |
| --- | --- |
| Create Tasks (`task_create`) | Create one or more session tasks with initial statuses, owners, and dependencies. |
| Get Task (`task_get`) | Read one task and its derived blocker information by ID. |
| List Tasks (`task_list`) | View session tasks, progress, blockers, and teammate activity. |
| Update Task (`task_update`) | Update a task's status, owner, details, or dependencies. |

### File Read and Write

`workspace.file-io` reads or changes workspace files directly.

| Tool | Purpose |
| --- | --- |
| Read File (`read_file`) | Read all of a text file or a selected line range. |
| Replace Text (`replace_text`) | Make a precise replacement in one file or create a new text file. |
| Apply Patch (`apply_patch`) | Apply a structured, reviewable set of related file changes. |
| View Image (`view_image`) | Load a local image so the Agent can inspect its visual content. |

### Shell

`workspace.shell` runs commands in explicit managed shells and interacts with continuing background processes. It does not connect to the user terminal in the desktop app. A local Windows workspace normally exposes the following five tools.

| Tool | Purpose |
| --- | --- |
| Write Stdin (`write_stdin`) | Poll, send input to, or interrupt an existing managed Shell session. |
| Git Bash (`git_bash_command`) | Run a Git Bash/MSYS Bash command inside the project boundary. |
| PowerShell (`powershell_command`) | Run PowerShell 7 commands inside the project boundary. |
| Command Prompt (`cmd_command`) | Run a Windows Command Prompt command inside the project boundary. |
| WSL Bash (`wsl_bash_command`) | Run a WSL Linux Bash command inside the project boundary. |

PowerShell 7 is an optional local dependency. Anybox does not bundle or install it, and Windows PowerShell 5.1 is not supported. If PowerShell 7 is missing, Anybox and other shells such as Command Prompt, Git Bash, and WSL continue to work.

A local macOS workspace uses `macos_shell_command` for its platform Shell, while an SSH workspace uses `ssh_shell_command`. The Shell count can therefore vary by environment.

The desktop Terminal is an interactive surface controlled directly by the user and is not exposed as an Agent tool. The Agent cannot read its output buffer or send commands or raw input to it.

### Multi-agent

`agent.multiagent` delegates a clearly bounded subtask to an independent child Agent.

| Tool | Purpose |
| --- | --- |
| Spawn Subagent (`spawn_subagent`) | Create a child Agent session for delegated work. |
| Read Subagent (`read_subagent`) | Read the child Agent's latest status and result summary. |
| Wait for Subagent (`wait_subagent`) | Wait for completion, or return current status when the wait times out. |
| Cancel Subagent (`cancel_subagent`) | Cancel a child Agent that is still running. |

### Progressive Disclosure

`runtime.progressive-disclosure` reads extra capabilities only when needed, keeping unrelated definitions out of context.

| Tool | Purpose |
| --- | --- |
| Tool Search (`tool_search`, model-facing name `anybox_tool_search`) | Search and load an optional module or deferred tool for the current user turn. |
| Load Skill (`load_skill`) | Load a Skill's `SKILL.md` instructions for the current turn. |
| Read Skill Resource (`read_skill_resource`) | Read a supporting file referenced by a loaded Skill. |
| List MCP Resources (`list_mcp_resources`) | List resources exposed by enabled MCP servers in the project. |
| List MCP Resource Templates (`list_mcp_resource_templates`) | List parameterized resource entry points exposed by MCP servers. |
| Read MCP Resource (`read_mcp_resource`) | Read one resource URI from a specified MCP server. |
| Load Workspace Dependencies (`load_workspace_dependencies`) | Return bundled runtime and dependency paths for local document, PDF, and image work. |

### Programmatic Orchestration

`runtime.programmatic-orchestration` combines independent calls to reduce serial waiting.

| Tool | Purpose |
| --- | --- |
| JavaScript Exec (`exec`) | Use isolated JavaScript to orchestrate supported read-only workspace tools. |
| Parallel Tool Use (`multi_tool_use_parallel`) | Run independent, concurrency-safe read or search calls in parallel. |

### Python Runtime

`runtime.python` provides a session-scoped persistent Python environment in local workspaces.

| Tool | Purpose |
| --- | --- |
| IPython (`ipython`) | Execute Python or IPython code; variables, imports, and functions remain available while the current session kernel is alive. |

IPython is disabled by default, does not support SSH workspaces, and is not a security sandbox. Code runs with the current operating-system user's permissions, so each call is treated as a high-risk execution request and still goes through call-level permission evaluation.

### Metacognition

`agent.metacognition` helps the Agent inspect earlier state and establish a corrective path after a mistake.

| Tool | Purpose |
| --- | --- |
| List Rollback Checkpoints (`list_rollback_checkpoints`) | Show earlier messages and file snapshots available for rollback. |
| Rollback to Checkpoint (`rollback_to_checkpoint`) | Create a corrective branch from an earlier message and optionally restore files. |

### File Search

`workspace.file-search` locates directories, files, or matching content before further reading or editing.

| Tool | Purpose |
| --- | --- |
| List Directory (`list_directory`) | List files and folders in the current project. |
| Glob (`glob`) | Match file and directory paths with a glob pattern. |
| Grep (`grep`) | Search file contents with a regular expression or literal string. |

### Visual Generation

`media.visual-generation` provides image creation.

| Tool | Purpose |
| --- | --- |
| Generate Image (`generate_image`) | Generate images with the globally configured image model. |

### Network

`network.web` reads public network content.

| Tool | Purpose |
| --- | --- |
| Web Fetch (`web_fetch`) | Fetch a public web page or JSON endpoint and return normalized content. |

### LSP Tools

`workspace.lsp` uses the active language server to provide more precise code semantics than text search.

| Tool | Purpose |
| --- | --- |
| LSP Definition (`lsp_definition`) | Resolve the definition of the symbol at a file position. |
| LSP References (`lsp_references`) | Find all references to the symbol at a file position. |
| LSP Hover (`lsp_hover`) | Read type, signature, or documentation details for a symbol. |
| LSP Workspace Symbols (`lsp_workspace_symbols`) | Search workspace symbols by name through the language server. |

## On-demand Tool Modules

### Planner

`planner.core` manages persistent Anybox todos and schedules. Browsing it on the Tools page does not load it. Tool Search, `@计划`, `/计划`, `/planner`, or Planner delegation can enable it for the current user turn.

| Tool | Purpose |
| --- | --- |
| List Planner Todos (`planner_list_todos`) | List todos and filter by status, schedule, deadline, project, or text. |
| Get Planner Todo (`planner_get_todo`) | Read one todo by ID. |
| Create Planner Todo (`planner_create_todo`) | Create a todo with optional properties and execution times. |
| Update Planner Todo (`planner_update_todo`) | Update todo fields; dedicated tools handle completion and scheduling. |
| Complete Planner Todo (`planner_complete_todo`) | Mark a todo complete or restore it to incomplete. |
| Schedule Planner Todo (`planner_schedule_todo`) | Set, move, or clear execution time without changing the deadline. |
| Find Planner Free Time (`planner_find_free_time`) | Find candidate slots in a range using scheduled todos and local calendar events. |
| Create Planner Proposal (`planner_create_proposal`) | Create a reviewable set of todo changes without applying it. |
| Accept Planner Proposal (`planner_accept_proposal`) | Apply every change in a proposal atomically after confirmation. |
| Dismiss Planner Proposal (`planner_dismiss_proposal`) | Close a pending proposal without changing any todos. |
| Run Planner Todo with Agent (`planner_run_todo`) | Start a separate Agent run for an explicitly delegated todo without completing it. |
| Link Planner Todo to Automation (`planner_link_automation`) | Link or unlink an existing Automation without creating or activating it. |

## Manage Tools

Always-on modules can be adjusted one tool at a time or as a group. The on-demand catalog is read-only on this page and cannot be made permanently active here. Each tool exposes a stable ID, risk labels, concurrency metadata, and input schema.

- Select **Save changes** after changing a tool or module toggle.
- **Reset all tools** clears explicit overrides and uses registry defaults; it does not remove tools or alter MCP connections.
- `Concurrency: safe` permits parallel scheduling but does not bypass permissions.
- The input schema is the source of truth for parameter names and types.

## Availability and Permission

| Layer | Purpose |
| --- | --- |
| Global tool selection | Offers or withholds a built-in from the agent |
| Agent policy | Narrows the set through allow, deny, or read-only rules |
| Session policy | Excludes non-read-only tools from the current session |
| Call-level permission | Evaluates the tool, parameters, paths, command, and risk |
| Tool guards | Validate the schema, workspace boundary, and runtime conditions |

Enabled does not mean approval-free. A denial or validation failure at any layer prevents execution.

## Sources and Progressive Discovery

The runtime combines four sources:

- **Built-ins:** ship with Anybox and are managed on the Tools page.
- **Native on-demand modules:** ship with Anybox and load for the current turn only after search or an explicit request.
- **MCP tools:** come from project, plugin, or current-task connections.
- **Runtime custom tools:** are registered by the host process.

The Tools page does not currently manage MCP; its authentication, diagnostics, and policy remain in Connections.

To keep large MCP catalogs out of the prompt, Anybox defers some definitions. The model calls `anybox_tool_search` to search by name, capability, source, or schema; matches become visible on the next model call. The internal switch is `tool_search`. If it is disabled, denied, or has no deferred candidates, the runtime falls back to direct visibility for available tools.

## JavaScript Exec

`JavaScript Exec` (`exec`) orchestrates several read-only discovery actions in one JavaScript call. It is useful for parallel reads, filtering, and aggregation.

- Code runs in a fresh, restricted QuickJS runtime.
- Only `tools.read_file`, `tools.list_directory`, `tools.glob`, and `tools.grep` are exposed.
- Top-level `await`, `Promise.all`, loops, conditions, and `try/catch` are supported; the return value must be JSON-serializable.
- Node.js, network access, imports, DOM, host filesystem APIs, `process`, and timers are unavailable.
- Every tool Promise must be awaited or returned. A child call requiring user approval is rejected inside `exec`.

| Limit | Current value |
| --- | ---: |
| JavaScript source | 32,000 characters |
| Wall-clock time | 30 seconds |
| CPU execution slice | 250 milliseconds |
| Memory / stack | 32 MiB / 512 KiB |
| Child calls | 64 |
| Arguments / result per call | 50,000 characters each |
| Cumulative child results / final output | 500,000 / 50,000 characters |

## Troubleshooting

- Enabled tool missing: confirm the change was saved, then check agent policy, read-only session policy, and the platform registry.
- MCP tool missing: check its connection source or search with `anybox_tool_search`.
- `exec` child unavailable: confirm policy did not disable it. Write, shell, and MCP tools cannot run inside `exec`.
- Unconsumed-call error: ensure every `tools.*` Promise is awaited, returned, or included in an awaited `Promise.all`.
