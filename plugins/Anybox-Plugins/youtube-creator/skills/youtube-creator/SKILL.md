---
name: youtube-creator
description: Use an authorized YouTube channel to inspect channel and video performance, query YouTube Analytics, and perform guarded video uploads, updates, or deletion.
---

# YouTube Creator

Use this skill when the user asks to inspect or manage the YouTube channel connected through this plugin.

Start with `youtube_test_auth` when the connection is new, has changed, or returns permission errors. Identify the exact channel before any write operation. The initial connector requests video-management, Analytics, and monetary-report scopes; Google app verification and YouTube compliance review remain external prerequisites.

## Channel and video inspection

- Use `youtube_channel_get` for the current channel identity and lifetime statistics.
- Use `youtube_video_list` for recent uploads. Its pagination is based on the channel uploads playlist; do not imply that one page is the complete channel history.
- Use `youtube_video_get` before changing or deleting an existing video so the exact ID, title, and current privacy status can be shown.
- Use `youtube_video_categories` before uploading when a valid category ID is not already known.

## Analytics workflow

- Use `youtube_dashboard_summary` for a concise channel, recent-video, and date-bounded Analytics view.
- Use `youtube_analytics_summary` for views, watch time, average view duration, engagement, and subscriber gains or losses.
- Request `include_revenue=true` only when the user asks for revenue or monetization data. Explain that monetary rows can be unavailable for channels or OAuth projects without access.
- Use `youtube_traffic_sources` for referrer-type analysis and `youtube_audience_demographics` for available age/gender percentages.
- Always report the actual start and end dates returned by the tool. YouTube Analytics can lag and privacy thresholds can omit rows; an empty report is not proof of zero activity.

## Upload and update workflow

Before `youtube_video_upload`:

1. Verify the exact connected channel.
2. Verify the absolute local file path, title, description, category, tags, privacy status, audience setting, optional schedule, and subscriber-notification choice.
3. Default to `private` unless the user explicitly chooses another status.
4. Obtain explicit confirmation for that complete upload payload, then pass `confirm=true`.

The tool uses a resumable upload session and bounded chunks. Report the returned video ID and privacy status. For unverified API projects, explain that YouTube can force API uploads to private even when public or unlisted was requested.

Before `youtube_video_update`, read the current video, show the exact changes, obtain confirmation, and pass `confirm=true`. The server performs a read/merge update so required snippet fields are not accidentally cleared.

## Destructive action

`youtube_video_delete` permanently deletes a video. Before calling it:

1. Read the target when practical and show its ID and title.
2. Obtain explicit confirmation for that exact video ID.
3. Pass `confirm=true` only after confirmation.

Never reuse confirmation for a different video and never infer deletion permission from a request to hide, unlist, replace, or revise content.

If Google returns a quota, OAuth verification, channel eligibility, privacy, copyright, or compliance error, explain the returned condition and stop blind retries. The plugin cannot bypass Google or YouTube review.
