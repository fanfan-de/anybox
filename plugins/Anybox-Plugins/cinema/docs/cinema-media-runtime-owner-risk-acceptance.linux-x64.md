# Linux media runtime project-owner review

- Status: **approved by the Anybox project owner for the initial Linux x64 media-runtime candidate**
- Prepared at: 2026-07-15T00:00:00+08:00
- GPL/libx264 decision accepted at: 2026-07-15T03:49:05+08:00
- Distribution scope and H.264 risk accepted at: 2026-07-15T03:52:27+08:00
- Immutable candidate approved at: 2026-07-15T04:10:24+08:00
- Approver: Anybox project owner (GitHub: `fanfan-de`)
- Runtime ID: `ffmpeg-anybox-8ad6288553-linux-x64-gpl-r1`
- Release scope: Linux x64 desktop clients distributed worldwide as a free, open-source project
- Expected usage: low volume; no reliable installation forecast
- Commercial scope: the desktop application is free; any future commercial API service is outside this decision

## Recorded owner decision

The project owner explicitly accepts distributing the Anybox-controlled FFmpeg/libx264 Linux runtime under GPL-3.0-or-later. This decision authorizes preparation and publication of an immutable Linux x64 media-runtime candidate with complete corresponding source, build recipe, license, notice, and hash evidence.

The project owner also accepts the residual H.264-use licensing risk of worldwide distribution for the free, open-source Linux x64 desktop client. This is a project-owner risk decision, not third-party legal advice or a representation that every jurisdiction is patent-clear. It does not extend to a future commercial API service, another platform or architecture, another FFmpeg or x264 revision, or a different build recipe.

This approval authorizes the exact immutable media-runtime candidate and hashes recorded below. It does not by itself authorize a public desktop release. Public release still requires the installed-app evidence listed below and the synchronized desktop release gates.

The proposed build uses pinned FFmpeg revision `8ad6288553`, pinned x264 commit `b35605ace3ddf7c1a5d67a2eb553f034aef41d55`, native FFmpeg AAC, zlib 1.3.1, and the pinned subtitle stack. It must not contain OpenH264, x265, FDK-AAC, or any nonfree component. Packaged Anybox must use only the verified bundled FFmpeg/FFprobe pair and must never fall back to a system or developer-machine `PATH` runtime.

Approval is limited to the immutable candidate hashes below. Anybox must ship the GPL license and third-party notices, publish and retain matching FFmpeg/x264/zlib corresponding source plus the exact build recipe, preserve all locked hashes, and expose the source references with the binary distribution. This record is project-owner risk acceptance, not third-party legal advice.

## Immutable evidence

- Candidate release: https://github.com/fanfan-de/anybox/releases/tag/media-runtime-ffmpeg-8ad6288553-linux-x64-r1
- Candidate commit: `773eb83b08e31b10dd2b15ad50cd48d4c415ab0a`
- Build environment: Ubuntu 24.04.4 LTS x64 local builder; GitHub-hosted runners were unavailable because of an account billing lock
- Runtime archive SHA-256: `3a9d46852a6caa2a03d1607d96542e78f9ca6cac5cba7728d7f18c90a01a2111`
- FFmpeg source archive SHA-256: `b1c34a3697e7459de7536dbb208c9e8de19431c5d4b14b09cdfcc30d266e0b7d`
- x264 source archive SHA-256: `4f1c35d11c7b09ca1a88affb914e1fc3daee888732786a66e51af4f786962c44`
- zlib source archive SHA-256: `9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23`
- Build recipe SHA-256: `c426a8abdf0e1f681b2e03ae4a61c45988baf3ffe91a3514f474f68ea574b787`
- `ffmpeg` SHA-256: `28e07743481886ef328560013cc65feff4a033d7716b6c41769ccdd5422ed766`
- `ffprobe` SHA-256: `b5951a625a717255e1d4baf943fc49dbf2fa78af43c38fb5b17b116a34e92c3e`
- H.264/AAC smoke SHA-256: `f6f7b1ce3d89b9b0f45a4532d5987cbbf08b0b8458b43d6b0c42020e1c38e5a3`
- libass subtitle smoke SHA-256: `d1ffead343f3caa9f587a27b613bda439fc3e1864b80136392c315dfc11cba24`
- Subtitle PNG frame SHA-256: `de9873a9bccdf9f11fff2ef1fae755192d56174914a23fc381a6d2c6ee86da1d`

## Installed-app evidence required

- AppImage install/launch and managed-Agent kill/restart/recovery/retry record: **pending**
- Debian package install/launch smoke: **pending**
- Ubuntu 22.04 x64 baseline: **pending**
- Clean-machine proof that system FFmpeg/Python are not required: **pending**
- AppImage updater metadata and blockmap verification: **pending**

## Rollback

The proposed initial-release rollback is to disable the `timelineDelivery` capability and publish a corrected desktop version without Deliver if runtime integrity, source availability, GPL obligations, platform support, or H.264 distribution assumptions become unacceptable. A blocked, missing, or hash-mismatched runtime must fail closed.
