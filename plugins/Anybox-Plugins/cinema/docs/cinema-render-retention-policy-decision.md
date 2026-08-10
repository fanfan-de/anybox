# Cinema render retention policy decision

> Status: proposed for technical preview; product and security approval pending
>
> Updated: 2026-07-11

## Decision scope

This decision covers cleanup of rebuildable Render job inputs and temporary files. It does not authorize deletion of Render job metadata, events, Timeline snapshots, or registered output Assets.

## Proposed V1 policy

- No default retention period exists. An operator supplies a positive whole number of days for every preview.
- Cleanup is never scheduled automatically in V1.
- The UI always performs a dry-run first and shows eligible jobs, conservative estimated bytes, skipped jobs, and path-free errors.
- Dry-run inspection is cancelable. A confirmed execute operation is intentionally non-cancelable after submission so the UI cannot imply rollback of files already removed.
- Execute requires a fresh operation ID, the API confirmation constant, and the user-facing phrase `CLEAN` after a matching preview.
- Execute is available only when the Agent advertises a loopback base URL. Browser callers must use the Agent's own Origin or the explicitly configured `ANYBOX_CINEMA_WEB_DEV_URL` Origin.
- The threat model trusts processes running as the same local OS user, because they can already mutate the project files. Origin enforcement blocks arbitrary web pages and CSRF; it is not described as protection from local malware.
- Remote or non-loopback Agents cannot execute retention cleanup in V1.
- Operational logs contain only the project ID, safe operation ID, requested duration, mode, aggregate counts/bytes, outcome, and stable error name. They never contain filesystem paths, commands, environment values, stderr, or secrets.

## Technical-preview UX

1. Expand **Render storage** in Deliver settings.
2. Enter an explicit whole-number retention duration in days.
3. Select **Preview cleanup**. The UI shows an indeterminate scan state and allows cancellation.
4. Review the aggregate result and the first eight safe job IDs. Large result sets remain summarized.
5. On an authorized local Agent, type `CLEAN` and select the danger action. Execution rechecks eligibility and reports actual reclaimed bytes.

Deliver remains behind its existing development/capability gate. Implementing this technical preview does not approve public enablement.

## Approval record

The following fields must be completed before the public-release checklist item can be marked complete:

- Product owner: **pending**
- Security approver: **pending**
- Approved policy revision: **pending**
- Approval date with timezone: **pending**
- Evidence or decision reference: **pending**
- Effective release: **pending**

Approval must explicitly accept or replace the proposed duration model, authorization boundary, confirmation UX, telemetry, cancellation behavior, and no-schedule decision.

## Rejected shortcuts

- A fixed hidden duration or silently chosen default.
- Automatic cleanup merely because the API exists.
- Treating the confirmation phrase or operation ID as caller authentication.
- Sharing the Browser connector's trusted-command token with Cinema.
- Putting a reusable bearer token in the Cinema open-link query string.
- Claiming remote-Agent support without a unified authenticated Cinema session.
