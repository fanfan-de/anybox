# Permissions & Approvals

The permission system decides whether a specific operation may run. It relates to availability switches on the Tools page, but it is not the same control: an enabled tool may enter an agent plan, yet individual calls can still require a decision.

## What This Page Is For

This page explains when a permission request appears, what to inspect, how decisions differ in scope, and how to continue safely after denying a request.

## Boundaries Applied to a Call

| Layer | Responsibility |
| --- | --- |
| Global tool selection | Decides whether a built-in may be available to later tasks |
| Agent tool policy | Reduces capabilities through allow, deny, or read-only rules |
| Session restriction | Excludes mutation from read-only contexts such as Side Chat |
| Call-level permission | Evaluates the current tool, parameters, paths, command, and risk |
| Tool guards | Validate the input schema, path boundary, and runtime conditions |

A denial or validation failure at any layer can prevent the call from running.

## When a Permission Request Appears

When the runtime cannot safely decide an operation automatically, the session displays a blocking permission request. A request may come from a shell or write tool, a browser or plugin action, or another capability that needs access to external data.

The request can provide:

- An action title and summary.
- The agent's rationale.
- A risk level.
- A working directory or target paths.
- The command that would run.
- Content that would be sent or changed.

Not every request contains every field. If information required for a decision is missing, deny it and ask the agent to retry with a smaller, more explicit action.

## Approval Steps

1. Confirm that the request belongs to the active session and goal.
2. Review the tool name, action summary, and agent rationale.
3. Inspect paths, the working directory, command, or external destination.
4. Determine whether the action deletes, overwrites, publishes, or sends data.
5. Choose the smallest authorization scope offered for this request.
6. Wait for the session to resume and inspect the actual tool result.
7. For a write operation, continue by reviewing file changes or project checks.

Do not approve only because the agent recommends a decision. Approval is your judgment about a concrete action and scope.

## Decision Scope

The interface shows only decisions supported by the current request. Common choices include:

- Deny: do not run the current operation.
- Allow once: approve only this request.
- Allow for session: reuse the authorization within the current session and matching scope.
- Allow: confirm the request supplied by the current integration; use the interface description to determine its scope.

Higher-risk requests or actions containing sensitive input may permit only a one-time decision. If Allow for session is absent, do not try to bypass the restriction through repetition.

## What Success Looks Like

- The permission card clearly shows a pending, allowed, denied, or failed state.
- After approval, the original task resumes from the blocked point instead of starting unrelated work.
- After denial, the rejected action does not run.
- The tool result explains what actually happened and matches the requested scope.
- When files or external data change, the corresponding execution record is available.

## Data and Permission Impact

Read-only describes the intended effect of a tool; it does not always mean data stays on the device. Read results may enter the current model context, and remote MCP servers or connectors may receive request arguments.

Allow for session is neither permanent authorization nor an operating-system permission. It applies only to the current session and matching scope recorded by the runtime. A new session, path, or action may prompt again.

Disabling a tool does not revoke an account authorization held by a third-party service. To remove external access, manage the credential in the corresponding connection or service as well.

## Common Questions

### The tool is enabled. Why am I still being asked?

Availability only controls whether the tool may be offered. Call-level permission still evaluates the actual parameters, paths, command, and risk.

### What happens after I deny a request?

The rejected operation does not run. The agent may explain why it cannot continue or propose a read-only or narrower alternative.

### A permission request remains pending

Confirm that it still belongs to the active session, the agent service is connected, and the previous decision did not fail to submit. Avoid clicking several decisions repeatedly.

### How can I reduce approval risk?

Inspect read-only first, split large actions into small steps, constrain paths and commands, and prefer Allow once.

## Next Steps

Read Tool System for global availability and runtime tool sources. Before using an external service, also review the permissions declared by its MCP server, connector, or plugin.
