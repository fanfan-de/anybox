# Linux media runtime project-owner review

- Status: **GPL/libx264 and H.264 distribution scope accepted by the project owner; immutable candidate hash binding remains pending**
- Prepared at: 2026-07-15T00:00:00+08:00
- GPL/libx264 decision accepted at: 2026-07-15T03:49:05+08:00
- Distribution scope and H.264 risk accepted at: 2026-07-15T03:52:27+08:00
- Approver: Anybox project owner (GitHub: `fanfan-de`)
- Runtime ID: `ffmpeg-anybox-8ad6288553-linux-x64-gpl-r1`
- Release scope: Linux x64 desktop clients distributed worldwide as a free, open-source project
- Expected usage: low volume; no reliable installation forecast
- Commercial scope: the desktop application is free; any future commercial API service is outside this decision

## Recorded owner decision

The project owner explicitly accepts distributing the Anybox-controlled FFmpeg/libx264 Linux runtime under GPL-3.0-or-later. This decision authorizes preparation and publication of an immutable Linux x64 media-runtime candidate with complete corresponding source, build recipe, license, notice, and hash evidence.

The project owner also accepts the residual H.264-use licensing risk of worldwide distribution for the free, open-source Linux x64 desktop client. This is a project-owner risk decision, not third-party legal advice or a representation that every jurisdiction is patent-clear. It does not extend to a future commercial API service, another platform or architecture, another FFmpeg or x264 revision, or a different build recipe.

This recorded decision does not by itself promote the Linux runtime lock to approved and does not authorize a public desktop release. Final approval still requires the immutable candidate evidence below and the installed-app evidence listed below.

The proposed build uses pinned FFmpeg revision `8ad6288553`, pinned x264 commit `b35605ace3ddf7c1a5d67a2eb553f034aef41d55`, native FFmpeg AAC, zlib 1.3.1, and the pinned subtitle stack. It must not contain OpenH264, x265, FDK-AAC, or any nonfree component. Packaged Anybox must use only the verified bundled FFmpeg/FFprobe pair and must never fall back to a system or developer-machine `PATH` runtime.

Approval, if granted, must be limited to the immutable candidate hashes below. Anybox must ship the GPL license and third-party notices, publish and retain matching FFmpeg/x264/zlib corresponding source plus the exact build recipe, preserve all locked hashes, and expose the source references with the binary distribution. This record is project-owner risk acceptance, not third-party legal advice.

## Immutable evidence to fill after candidate publication

- Candidate release: **pending**
- Candidate commit: **pending**
- Runtime archive SHA-256: **pending**
- FFmpeg source archive SHA-256: **pending**
- x264 source archive SHA-256: **pending**
- zlib source archive SHA-256: **pending**
- Build recipe SHA-256: **pending**
- `ffmpeg` SHA-256: **pending**
- `ffprobe` SHA-256: **pending**
- H.264/AAC smoke SHA-256: **pending**
- libass subtitle smoke SHA-256: **pending**
- Subtitle PNG frame SHA-256: **pending**

## Installed-app evidence required

- AppImage install/launch and managed-Agent kill/restart/recovery/retry record: **pending**
- Debian package install/launch smoke: **pending**
- Ubuntu 22.04 x64 baseline: **pending**
- Clean-machine proof that system FFmpeg/Python are not required: **pending**
- AppImage updater metadata and blockmap verification: **pending**

## Rollback

The proposed initial-release rollback is to disable the `timelineDelivery` capability and publish a corrected desktop version without Deliver if runtime integrity, source availability, GPL obligations, platform support, or H.264 distribution assumptions become unacceptable. A blocked, missing, or hash-mismatched runtime must fail closed.
