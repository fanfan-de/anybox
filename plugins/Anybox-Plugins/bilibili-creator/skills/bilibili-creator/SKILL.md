---
name: bilibili-creator
description: Use an authorized Bilibili Open Platform account to inspect creator metrics, track follower snapshots, publish videos, and publish Bilibili-compatible articles with guarded destructive actions.
---

# Bilibili Creator

Use this skill when the user asks to inspect or manage the connected Bilibili creator account through the installed plugin.

Start with `bilibili_test_auth` when the connection is new, recently changed, or returning permission errors. The complete V1 workflow expects `USER_INFO`, `USER_DATA`, `ARC_BASE`, `ARC_DATA`, `ATC_BASE`, and `ATC_DATA`.

## Metrics workflow

- Use `bilibili_account_get` for the current profile, follower count, following count, approved video count, and granted scopes.
- Use `bilibili_dashboard_summary` for a current read-only summary. State the scan bound when the response reports `truncated=true`; do not describe a partial scan as an all-time total for the whole account.
- Use `bilibili_metrics_snapshot` only when the user wants follower-change tracking or a saved measurement. It writes a minimal numeric snapshot locally.
- Use `bilibili_metrics_history` to calculate change over time from saved snapshots.
- `bilibili_metrics_clear` permanently removes the local history file. Call it only after the user explicitly asks to clear history, and pass `confirm=true`.

## Video workflow

- Use `bilibili_video_categories` before publishing when a valid category ID is not already known.
- Use `bilibili_video_list`, `bilibili_video_get`, and `bilibili_video_stats` for read-only inspection.
- Before `bilibili_video_publish`, verify the absolute local file path, title, category, tags, copyright status, repost source when applicable, description, and optional cover.
- A publish call uploads the file and submits a new稿件 for Bilibili review. Report the returned `resource_id` and make clear that submission is not the same as public approval.
- Never infer permission to publish merely because the user asked for a draft, metadata review, or upload plan.

## Article workflow

- Use `bilibili_article_categories` to obtain a child category ID.
- Use `bilibili_article_upload_image` for images referenced in article HTML.
- `bilibili_article_publish` requires Bilibili-compatible HTML through exactly one of `content_html` or `content_path`. Do not silently convert Markdown when formatting fidelity is uncertain.
- Validate the selected template: template 3 needs at least three cover image URLs; template 4 needs a cover, banner, or top video; template 5 uses a generated default cover.
- Report the returned article ID and make clear that the article enters review.

## Destructive actions

`bilibili_video_delete` and `bilibili_article_delete` are irreversible. Before either call:

1. Read or list the target so its ID and title can be shown when practical.
2. Obtain explicit confirmation for that exact resource ID.
3. Pass `confirm=true` only after confirmation.

Do not reuse confirmation for a different resource, and do not batch inferred deletions.

If Bilibili returns a scope, review, rate-limit, or account-association error, explain the returned condition and stop retry loops. Open Platform approval and account association cannot be bypassed by the plugin.
