# Confirmations and approvals

Computer Use has two independent approval boundaries:

1. Application access authorizes observation/control of a specific app once, for the session, or persistently.
2. Every state-changing action requires a separate one-time host decision. Full-access mode and persistent app approval do not bypass it.

Read-only discovery may run automatically according to the configured MCP policy, but the selected application remains broker-gated. Actions labeled as authentication/secret entry, finance, or security-setting changes are rejected. Send, submit, delete, upload, install, publish, and purchase intent is shown as elevated risk.

Approval details redact `text` and `value` payloads. Denial or timeout resumes the same JavaScript promise with an error; it does not authorize a retry.
