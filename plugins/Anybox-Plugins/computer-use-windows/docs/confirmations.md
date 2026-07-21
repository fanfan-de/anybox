# Confirmations and approvals

The plugin uses Anybox's generic permission continuation API, but owns all
Computer Use approval logic and presentation data.

Routine Computer Use does not show plugin approval prompts. This includes
listing apps/windows, observing screenshots and bounded accessibility state,
launching or activating a pre-existing app, and actions explicitly classified
as `normal` such as navigation, clicking, scrolling, dragging, local typing,
and changing ordinary controls.

One-time approval is required immediately before actions classified as:

- `submit_or_send`
- `delete`
- `upload`
- `install`

`auth_or_secret`, `finance`, and `security_settings` are rejected before a
prompt. The Agent must set the matching `safety` value whenever an action can
cross one of these boundaries; content observed inside an app is never itself
authorization. Typed text and assigned values appear only as character counts
in approval details. Denial or timeout resumes the same JavaScript promise with
an error and never authorizes an automatic retry.

The native blue overlay is independent of approval. Waiting for an approval
does not start the Helper or show the overlay; after approval, the Helper must
show and validate the overlay before the requested desktop operation begins.
Denial does not start the Helper for an otherwise unopened session. The overlay
is only a safety notice and never grants permission or weakens a hard denial.
