# hyperframes

OpenAI Codex plugin for [HyperFrames](https://hyperframes.heygen.com), an open-source video rendering framework where HTML is the source of truth for video.

## What's included

This package mirrors the official HyperFrames Codex plugin metadata and skills from [`heygen-com/hyperframes`](https://github.com/heygen-com/hyperframes).

Included skills:

- embedded-captions
- faceless-explainer
- general-video
- graphic-overlays
- hyperframes
- hyperframes-animation
- hyperframes-cli
- hyperframes-core
- hyperframes-creative
- hyperframes-media
- hyperframes-registry
- motion-graphics
- pr-to-video
- product-launch-video
- remotion-to-hyperframes
- slideshow
- website-to-video

## Requirements

The skills invoke the `hyperframes` CLI via `npx hyperframes`, which needs:

- Node.js >= 22
- FFmpeg on `PATH`

See [hyperframes.heygen.com/quickstart](https://hyperframes.heygen.com/quickstart) for full setup.

## Source of truth

The skills are authored in [`heygen-com/hyperframes`](https://github.com/heygen-com/hyperframes) under the repository root `skills/` directory. The plugin manifest is mirrored from `.codex-plugin/plugin.json`.
