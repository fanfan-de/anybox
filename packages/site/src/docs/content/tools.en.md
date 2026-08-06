# Tool System

Tools determine what an agent can read, search, execute, or modify. The desktop Tools page manages global availability for built-ins only; agent, session, and call-level policy still govern execution.

> Visible tools vary by operating system, workspace type, MCP connections, and active agent policy.

## Manage Built-in Tools

Tools are grouped as Shell, Write, Delegation, Workflow, Interaction, Search, Read, and Other. Each entry exposes a stable ID, risk labels, concurrency metadata, and input schema.

- Select **Save changes** after toggling a tool.
- **Reset to default** clears explicit overrides and uses registry defaults; it does not remove tools or alter MCP.
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

The runtime combines three sources:

- **Built-ins:** ship with Anybox and are managed on the Tools page.
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
