# Tool System

Tools define what Anybox agents can use to read a project, discover context, execute actions, and advance a workflow. The Tools page is both a global availability control and a catalog for understanding each capability, its risk metadata, and its input shape.

> This page documents the current desktop and agent-runtime design. The visible catalog can vary by operating system, workspace type, connected MCP services, and the active agent policy.

## How the page is organized

Open Tools from the desktop's left navigation. The page has a category navigator and a tool detail area:

1. The navigator shows only non-empty categories, with total and enabled counts for each category.
2. The detail area summarizes the selected category and global enabled state before listing its tools.
3. Each row keeps the title, stable ID, capability label, risk label, and availability toggle visible. Expand a row to inspect its full description, aliases, concurrency policy, and input schema.

This structure keeps routine availability changes compact while placing integration and debugging details in an on-demand layer.

### Categories and intent

Tools use the following category order. Empty categories do not occupy navigation space.

| Category | Primary purpose | Typical capability boundary |
| --- | --- | --- |
| Shell | Operating-system commands, terminal processes, and remote shells | Usually requires shell access |
| Write | Mutating files or workspace content | May create irreversible changes |
| Delegation | Creating, reading, waiting for, or stopping subagents | May hand work to another runtime |
| Workflow | Task control, rollback, dependency loading, and orchestration | Changes how a task proceeds |
| Interaction | Asking the user a question or requesting confirmation | Pauses the flow for input |
| Search | Discovering context by name, path, content, or definition | Read-only by default |
| Read | Reading files, directories, images, resources, or runtime state | Read-only by default |
| Other | Built-ins that do not yet fit another category | Depends on tool metadata |

A category describes intent; it is not an authorization result. For example, `JavaScript Exec` belongs to Workflow because it orchestrates read-only tools and does not expose a host shell.

### Tool rows and expanded details

The row content comes from the runtime registry rather than a static frontend catalog:

- The title is for recognition; the tool ID is the stable name used by the model and runtime.
- The capability label shows the category. Risk labels are derived from metadata such as `readOnly`, `destructive`, and `needsShell`.
- An alias count highlights compatibility names. The server normalizes known aliases to the canonical ID when saving.
- `Concurrency: safe` means the scheduler may run the tool alongside other safe tools. It does not bypass permission checks.
- The input schema is the complete argument shape and is useful for troubleshooting, custom-agent development, and inspecting model calls.

### Changing, saving, and resetting

Toggling a tool first updates the local draft and enabled counts. The selection is written to global configuration only after you choose Save changes.

Reset to default immediately clears explicit overrides. An empty selection means "use registry defaults," so built-in tools are enabled by default in the current design. Resetting does not remove tools or change MCP server configuration.

The page also represents these states explicitly:

- Loading the registry and saved selection.
- Agent-service or save failures.
- An empty catalog for the current platform and workspace.
- A save or reset in progress, with affected actions temporarily disabled.

## Availability and permission are different controls

The global switch only decides whether a built-in may enter subsequent tool plans. A call must still pass additional restrictions before it can execute.

| Layer | Responsibility | Outcome |
| --- | --- | --- |
| Global tool selection | Whether the user disabled a built-in on the Tools page | Disabled tools are not offered to the current agent |
| Agent tool policy | Agent allowlists, denylists, and read-only policy | Can further reduce the available set |
| Session restriction | Whether a read-only session such as Side Chat may use mutating tools | Non-read-only tools are excluded |
| Call-level permission | Evaluation of the tool kind, path, command, parameters, and risk | Allow, deny, or ask the user |
| Tool guards | Input schema, workspace boundaries, validation, and authorization | Invalid calls do not execute |

Enabled therefore does not mean approval-free, and a global switch is not an operating-system permission. Every execution still passes through the same permission evaluation, approval, and runtime validation path.

The global selection is persisted by tool ID. An explicit `false` disables a tool; no entry means "use the default." The server accepts only IDs or aliases present in the current built-in registry so stale or arbitrary names cannot enter runtime configuration.

## From registry to desktop page

The tool module uses one runtime definition as the source of truth. The UI, model tool plan, and executor do not maintain separate names or schemas.

```text
Tool.define
  ├─ ID / aliases / capabilities
  └─ title / description / parameters / execute
            │
            ▼
Built-in registry + MCP tools + runtime custom tools
            │
            ├─ GET /api/tools/builtins ──> Electron IPC ──> Tools page
            │
            └─ resolveToolPlan ──> permission evaluation ──> execute ──> normalized result

Tools page ── PUT /api/tools/builtins/selection ──> global configuration
```

`Tool.define` wraps parameter validation, pre-execution guards, and result normalization when a tool is initialized. The execution layer also handles permission decisions, cancellation, persistence of oversized results, and conversion to model-facing output.

The desktop reads built-in summaries through a read-only endpoint and saves the selection through a separate update endpoint. The update validates names and stores only normalized values; the frontend never writes the configuration file directly.

### Platform and workspace differences

The built-in registry composes tools for the current environment:

- Windows can provide PowerShell, CMD, Git Bash, and WSL Bash. macOS uses its platform shell.
- SSH workspaces use an SSH shell and avoid mixing in terminal and language-service tools that apply only to local workspaces.
- Tool totals and category counts can therefore differ between machines and projects. This is expected.

## Built-ins, MCP, and progressive discovery

The runtime registry ultimately combines three sources:

- Built-in tools ship with Anybox and are managed by the global switches on this page.
- MCP tools come from project connections, plugins, or a connection attached to the current task.
- Runtime custom tools are extension capabilities registered by the host process.

The Tools page currently manages built-ins only. MCP connection, authentication, diagnostics, and per-tool policy remain in Connections.

### Why progressive tool search exists

Sending every full MCP tool definition to the model at once can add substantial context when many services are available. Anybox uses progressive discovery to control that cost:

1. Built-ins, persistently configured project MCP servers, and MCP servers explicitly selected for the current task are directly visible.
2. Other eligible MCP tools remain registered as deferred tools.
3. The model calls `anybox_tool_search` to search candidates by capability, source, name, or schema field.
4. Full definitions for matching tools are activated for the current user turn and become visible on the next model call.

Search covers deferred MCP tools only and does not duplicate directly visible tools. The index combines tool IDs, model names, titles, descriptions, MCP source metadata, and input schemas, with tokenization for English and CJK text.

If the internal `tool_search` switch is disabled, denied by the active agent, or has no deferred candidates, the runtime falls back to direct visibility so an available tool cannot become impossible to discover. `anybox_tool_search` is its model-facing alias, chosen to avoid provider-reserved name collisions.

## JavaScript Exec orchestration

`exec` lets the model organize multiple read-only discovery actions with JavaScript inside one tool call. It is useful for parallel reads, conditional filtering, aggregation, and reducing round trips between the model and individual tools.

The current implementation intentionally exposes a narrow capability:

- Code runs in a fresh, resource-limited QuickJS runtime.
- Only `tools.read_file`, `tools.list_directory`, `tools.glob`, and `tools.grep` are exposed.
- The code is an async function body, so top-level `await`, loops, conditions, `try/catch`, and `Promise.all` are supported.
- The `return` value must be JSON-serializable. No return value becomes `null`.
- There is no Node.js, Bun, DOM, module import, network, host filesystem API, `process`, `console`, or timers.
- Detached tool calls are rejected. Every Promise must be awaited, returned, or have its failure handled explicitly.

For example, one call can count TypeScript files and TODO lines in parallel:

```json
{
  "code": "const [files, todos] = await Promise.all([\n  tools.glob({ pattern: \"src/**/*.ts\", maxResults: 200 }),\n  tools.grep({ pattern: \"TODO\", path: \"src\", literal: true, maxResults: 100 })\n]);\nreturn {\n  typescriptFiles: files.matches.length,\n  todoLines: todos.hits.length,\n  truncated: files.truncated || todos.truncated\n};"
}
```

The result includes the final JSON value, status and duration for every child call, and total execution time. Child calls re-check global selection, agent policy, session restrictions, and call-level permissions. Any child call that would require user approval is rejected inside `exec`.

### Resource and security boundaries

| Limit | Current value |
| --- | ---: |
| JavaScript source | 32,000 characters |
| Wall-clock time | 30 seconds |
| CPU execution slice | 250 milliseconds |
| Runtime memory | 32 MiB |
| Stack memory | 512 KiB |
| Child tool calls | Up to 64 |
| Arguments / result per call | 50,000 characters each |
| Cumulative child results | 500,000 characters |
| Final output | 50,000 characters |

These limits control runaway loops, memory use, and context growth. QuickJS performs computation and Promise scheduling only; project reads return to the regular Anybox tool execution layer. `exec` receives no host capabilities beyond the tools explicitly exposed to it.

## Recommendations and troubleshooting

- To block a capability, turn it off and save. To return to registry defaults, choose Reset to default.
- If an enabled tool is still absent from the model, check the agent tool policy, read-only session restrictions, and whether the current platform registered it.
- If an MCP tool is not immediately visible, check whether its server is a persistent project connection, attached to the current task, or discoverable through `anybox_tool_search`.
- If `exec` reports that a child tool is unavailable, check whether global or agent policy disabled it. Write, shell, and MCP tools cannot currently run inside `exec`.
- If `exec` reports an unconsumed call, make sure every `tools.*` Promise is awaited, returned, or included in an awaited `Promise.all`.
- Treat the input schema as the final source for parameter names and types. Titles and descriptions aid reading but do not replace stable IDs.
