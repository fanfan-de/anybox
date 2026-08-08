---
name: tiktok-creator
description: Use an authorized TikTok account to inspect profile and public-video data, upload inbox drafts, and run guarded Direct Post workflows with current creator checks and explicit consent.
---

# TikTok Creator

Use this skill when the user asks to inspect or publish through the TikTok account connected to this plugin.

Start with `tiktok_test_auth` when the connection is new, changed, or returning scope errors. The complete initial workflow expects `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list`, `video.upload`, and `video.publish`.

## Profile and public videos

- Use `tiktok_profile_get` for the connected identity and available follower, following, likes, and video counts.
- Use `tiktok_video_list` for paginated public videos and `tiktok_video_query` for up to 20 exact IDs.
- Use `tiktok_dashboard_summary` for bounded totals across scanned public videos. State the scan bound when `truncated=true`; these Display API counts are not equivalent to a full TikTok analytics product.
- Do not claim access to private videos, watch time, traffic sources, audience demographics, or revenue through this plugin version.

## Draft upload

Before `tiktok_video_upload_draft`:

1. Verify the connected profile and absolute local video path.
2. Explain that the call sends the file to TikTok but does not publish it.
3. Obtain explicit confirmation for that exact file, then pass `confirm=true`.

After upload, report the `publish_id` and tell the user to open the TikTok inbox notification to review, edit, and complete the post. Use `tiktok_publish_status` when status feedback is requested.

## Direct Post

Direct Post has a mandatory confirmation sequence:

1. Call `tiktok_creator_info` immediately before preparing the post.
2. Show `creator_username`, `creator_nickname`, available privacy levels, disabled interactions, and `max_video_post_duration_sec`.
3. Let the user edit the caption, hashtags, mentions, privacy level, interaction switches, cover timestamp, and commercial-content declarations. Do not silently lock preset text.
4. Verify the measured video duration and absolute file path.
5. Obtain explicit consent to upload and post that exact payload.
6. Pass the exact `creator_username` as `expected_creator_username` and set `confirm=true`.

The server fetches creator info again and stops if the connected username, privacy choices, or duration limit no longer match. TikTok account-level disabled interaction settings are enforced even when the requested switch was false.

After initialization and media transfer, poll `tiktok_publish_status` at a reasonable interval until completion or failure. Explain that moderation may delay the publicly available post ID. Do not report an initialized or uploaded task as published.

Unaudited clients can be restricted to private accounts and `SELF_ONLY` visibility. TikTok also applies user, creator, pending-share, and daily-post caps. These conditions cannot be bypassed by retries.

## Cancellation and unsupported actions

`tiktok_publish_cancel` is destructive because it terminates an in-flight posting effort. Call it only after the user confirms the exact `publish_id`, then pass `confirm=true`. A task near completion or already final may no longer be cancellable.

The Display API and Content Posting API used here do not provide editing or deletion of already-published TikTok videos. Never translate an edit or delete request into a new upload, cancellation, or unrelated action.

Publish only content the user owns or is authorized to publish. TikTok's Content Posting review expects authentic creator workflows and can reject apps intended only to copy arbitrary content from other platforms or serve a private internal uploader.
