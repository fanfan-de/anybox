# Confirmations and approvals

The plugin uses Anybox's generic permission continuation API, but owns all
Computer Use approval logic and presentation data.

There are two independent boundaries:

1. The first `get_window_state` observation for an application in each Agent
   turn asks before exposing its screenshot and bounded accessibility state.
2. Every launch or input operation asks for a separate one-time decision.

Listing app/window identifiers does not capture pixels or UIA document content
and may run automatically. Observation approval never authorizes an action.
Full-access mode does not bypass plugin-action prompts.

`auth_or_secret`, `finance`, and `security_settings` are rejected before a
prompt. Typed text and assigned values appear only as character counts in the
approval details. Denial or timeout resumes the same JavaScript promise with an
error and never authorizes an automatic retry.
