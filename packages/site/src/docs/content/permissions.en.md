# Permissions & Approvals

An enabled tool is available to the agent; it is not automatically approved for every call. Each operation must pass these boundaries:

| Layer | Purpose |
| --- | --- |
| Global tool selection | Makes a built-in available or unavailable |
| Agent policy | Narrows capabilities through allow, deny, or read-only rules |
| Session policy | Can exclude mutation from the current session |
| Call-level permission | Evaluates the tool, parameters, paths, command, and risk |
| Tool guards | Validate input, workspace boundaries, and runtime conditions |

A denial or validation failure at any layer prevents execution.

## Review a Request

When a permission card appears:

1. Confirm that it belongs to the active session and goal.
2. Inspect the tool, rationale, risk, paths, command, and external destination.
3. Decide whether it deletes, overwrites, uploads, sends, or publishes.
4. Choose the smallest scope, preferring **Allow once**.
5. After execution, inspect the tool result, file changes, or external state.

If essential information is missing, deny the request and ask the agent to retry with smaller, explicit parameters.

## Decision Scope

- **Deny:** do not run this operation.
- **Allow once:** approve only the current request.
- **Allow for session:** reuse approval only in the current session and matching scope.
- **Allow:** use the current integration's interface to determine its exact scope.

High-risk requests may support one-time approval only. Allow for session is neither permanent authorization nor an operating-system permission; a new session, path, or action may ask again.

## Important Boundaries

- Read-only does not guarantee that data stays on the device; results may be sent to a model or remote service.
- Disabling a tool does not revoke third-party account access. Revoke external credentials in the corresponding connection or service.
- Denial prevents the operation. The agent may continue with a read-only or narrower alternative.
- If a request remains pending, check the active session and agent connection instead of submitting several decisions.
