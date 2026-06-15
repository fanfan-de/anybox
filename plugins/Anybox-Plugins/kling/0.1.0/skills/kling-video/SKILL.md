---
name: Kling Video Generation
description: Use when the user wants to generate, inspect, or wait for AI video generation tasks through the Kling API.
---

# Kling Video Generation

Use the Kling MCP tools when the user asks to generate AI videos with Kling, turn an image into a video, or check a Kling video generation task.

## Workflow

1. For a pure prompt, call `kling_create_text_to_video`.
2. For an image prompt, call `kling_create_image_to_video`.
3. Return the `task_id` immediately if the user only asked to start generation.
4. If the user expects the final video, call `kling_wait_for_video` with the same endpoint and task ID.
5. When the task succeeds, show the returned video URL(s) from `task.urls`.

## Defaults

Use these defaults unless the user asks otherwise:

- `model_name`: `kling-v3`
- `mode`: `pro`
- `duration`: `5`
- `aspect_ratio`: `16:9`

Only set `sound`, `cfg_scale`, or model-specific controls when the user asks for them or when they are clearly needed. Some Kling models do not support every parameter.

## Images

For image-to-video, `image` and `image_tail` must be public URLs or bare base64 image content. Do not pass a `data:image/...;base64,` prefix.

## Results

Kling generation URLs expire after the provider's retention window. If the user needs a durable artifact, download or transfer the returned video URL using available file or storage tools after the task succeeds.
