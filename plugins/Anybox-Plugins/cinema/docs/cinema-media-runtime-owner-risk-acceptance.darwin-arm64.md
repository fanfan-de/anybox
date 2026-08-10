# macOS media runtime project-owner approval

- Status: approved by the Anybox project owner for the initial macOS arm64 release candidate
- Prepared at: 2026-07-13T15:55:55-07:00
- Approved at: 2026-07-13T16:00:13-07:00
- Approver: Anybox project owner (GitHub: fanfan-de)
- Runtime ID: `ffmpeg-anybox-8ad6288553-darwin-arm64-lgpl-r1`
- Release scope: Apple Silicon macOS desktop clients distributed worldwide as a free, open-source project
- Expected usage: low volume; no reliable installation forecast
- Commercial scope: the desktop application is free; any future API service is outside this decision

## Owner Decision

The Anybox project owner approves `ffmpeg-anybox-8ad6288553-darwin-arm64-lgpl-r1` for the initial macOS arm64 release gate and accepts the FFmpeg, VideoToolbox H.264, LGPL, source-retention, notice, and rollback constraints recorded here.

This decision authorizes only the Anybox-controlled FFmpeg/FFprobe build described below. It uses the macOS VideoToolbox `h264_videotoolbox` encoder and the native FFmpeg `aac` encoder. GPL and nonfree components, including libx264, libx265, OpenH264, and FDK-AAC, are disabled.

Anybox must distribute the matching LGPL license and third-party notices, retain the exact corresponding FFmpeg source and build recipe, keep the source download available with the binary distribution, and preserve the locked hashes. This approval would not extend to a different FFmpeg revision, build recipe, runtime archive, platform, architecture, encoder, or commercial API service.

Public desktop release remains conditional on release-strict packaging, installation from the exact signed and notarized macOS release candidate, managed-Agent kill/restart/recovery/retry evidence, matching updater metadata and hashes, Gatekeeper/notarization verification, and successful GitHub/COS artifact verification. This document does not relax those release requirements.

## Immutable Evidence

- Candidate release: https://github.com/fanfan-de/anybox/releases/tag/media-runtime-ffmpeg-8ad6288553-darwin-arm64-r1
- Candidate commit: `e8ec57a4a033946062c32c37e9876d16b10b7599`
- Runtime archive SHA-256: `6270ee2960a0ad720377dd403525cd2e62b3a159cada3a7f9366550f830a3524`
- FFmpeg source archive SHA-256: `b1c34a3697e7459de7536dbb208c9e8de19431c5d4b14b09cdfcc30d266e0b7d`
- Build recipe SHA-256: `503dd205ceb1368d56399d3be1beafa5789652cd4dd61b5567e3a3350e3260c3`
- `ffmpeg` SHA-256: `fb85bf3524b5f39919a9a4d9f59cf3cd88015278298e9acfb1aeb51cd3cd703c`
- `ffprobe` SHA-256: `2155a636e8ec1182614658cac73958d3c02a2bfa313f0c3fae0e678740c28de1`
- H.264/AAC smoke SHA-256: `2a766ecd11201d9e7b6d1260aa2bf63747a5f73fd3fd4ac8e062b2d491f1fdca`
- libass subtitle smoke SHA-256: `91f935189147fc827da9a57dcd559b2fd3d3cfcb5df69e39beafb77cf3e7fce8`
- Subtitle smoke frame SHA-256: `937d21a4c9e796dbbcf5c0754a15be96505a2232123eed5a80e425ce88594c50`

The candidate release also retains the pinned libass, FreeType, FriBidi, and HarfBuzz source archives. The runtime archive contains `LICENSE.txt`, `THIRD-PARTY-NOTICES.txt`, `SOURCE.txt`, `BUILD-RECIPE.sh`, `configure.txt`, the reviewed Noto Sans CJK SC font and OFL text, and archive-bound render/subtitle smoke evidence.

## Rollback

If runtime integrity, license materials, platform support, or H.264 distribution assumptions become unacceptable, the approved initial-release rollback would be to disable the `timelineDelivery` capability and publish a corrected desktop version without enabling Deliver. A blocked, missing, or hash-mismatched runtime must fail closed and must not fall back to a developer-machine FFmpeg.
