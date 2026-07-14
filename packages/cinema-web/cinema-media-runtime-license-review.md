# Cinema media runtime licensing review brief

> Status: technical recommendation; **not legal advice and not approval**
>
> Updated: 2026-07-15

## Scope

This brief evaluates the Anybox-controlled Windows x64, macOS arm64, and Linux x64 targets represented in `packages/desktop/media-runtime.lock.json`. Windows and macOS use system H.264 encoders; the Linux candidate uses pinned static libx264 and is therefore a GPL distribution. This document does not approve H.264 patent use, FFmpeg redistribution, VideoToolbox, Media Foundation or libx264 use, a binary mirror, or public Deliver enablement.

The candidate policy pins libass 0.17.5, FreeType 2.14.3, FriBidi 1.0.16, HarfBuzz 14.2.1, zlib 1.3.1, and Noto Sans CJK SC Regular 2.004 by source URL and SHA-256. Linux additionally pins x264 commit `b35605ace3ddf7c1a5d67a2eb553f034aef41d55`. The font is distributed under OFL-1.1. Candidate metadata records source versions/digests, configure output, component licenses, font digest/license, and `ass` capability; H.264/AAC, probe, PNG, and Chinese/English burn-in evidence is mandatory. Subtitle delivery remains fail-closed until license, mirror, package, and installed-app evidence is approved.

## Authoritative evidence

1. [FFmpeg's official legal page](https://ffmpeg.org/legal.html) describes FFmpeg as LGPL 2.1-or-later unless GPL parts are enabled, calls for corresponding source/build information and notices, and warns that codec patent obligations vary by jurisdiction. It explicitly identifies `libx264` as a GPL library to avoid in an LGPL distribution.
2. [FFmpeg's official configure source](https://github.com/FFmpeg/FFmpeg/blob/master/configure) makes `libopenh264` an optional integration that is disabled by default, while Media Foundation encoding is independently auto-detected. Therefore a Windows FFmpeg build does not technically require OpenH264 in order to expose `h264_mf`.
3. Cisco publishes OpenH264 source under the [BSD license](https://github.com/cisco/openh264/blob/master/LICENSE), but its separate [Cisco-provided binary notice](https://github.com/cisco/openh264/blob/gh-pages/BINARY_LICENSE.txt) limits Cisco's AVC/H.264 patent-license coverage to a Cisco-provided binary that is downloaded separately, can be controlled by the end user, and carries prescribed notices.
4. The previously evaluated BtbN recipe's [OpenH264 build script](https://github.com/BtbN/FFmpeg-Builds/blob/autobuild-2026-07-09-14-21/scripts.d/50-openh264.sh) builds OpenH264 from source and enables `--enable-libopenh264`. That third-party preview target has been removed from the production lock; all current targets require `--disable-libopenh264`. This remains an engineering record, not a legal conclusion.
5. Microsoft documents an inbox [Media Foundation H.264 encoder](https://learn.microsoft.com/en-us/windows/win32/medfound/h-264-video-encoder) for Windows desktop clients, including Baseline/Main/High profiles and the `Mfh264enc.dll` system component. Microsoft also states that no Windows Server version is supported. Runtime probing must therefore remain authoritative, and Anybox must not claim Windows Server support from this evidence.
6. The repository uses its own pinned-source build recipe for all three targets. A production artifact needs an Anybox-controlled immutable mirror, exact source archive and recipe hashes, notices, configure output, binary hashes, and recorded approval. The Linux mirror must also retain the exact corresponding x264 and zlib source archives and license files.

## Technical recommendation

Do not reintroduce the previously evaluated BtbN/OpenH264 archive into the production lock. Promote only candidates produced by the Anybox-controlled recipe after immutable mirroring and qualified review.

For the Windows x64 production candidate:

- pin the exact FFmpeg revision and exact build-system commit;
- build in an Anybox-controlled workflow from retained source;
- require `--enable-mediafoundation`, `--disable-libopenh264`, `--disable-libx264`, `--disable-libx265`, `--disable-gpl`, and `--disable-nonfree`;
- require only `h264_mf` and `aac` for V1 output;
- keep the existing runtime capability probe and fail closed if `h264_mf` is unavailable;
- retain the exact source archive, build recipe/diff, binary archive, FFmpeg/FFprobe hashes, configure output, license text, and third-party notices under immutable references;
- run the approved candidate's real encode/ffprobe smoke on supported Windows client editions, including an install path containing spaces;
- do not add a software H.264 fallback unless its redistribution and patent basis receives separate written approval.

For the macOS arm64 production candidate:

- build the same pinned FFmpeg revision in an Anybox-controlled native Apple Silicon workflow;
- require `--enable-videotoolbox`, `--disable-libopenh264`, `--disable-libx264`, `--disable-libx265`, `--disable-gpl`, and `--disable-nonfree`;
- require only `h264_videotoolbox` and native `aac` for V1 output;
- retain the same source, build, configure, license, notice, archive and binary digest evidence as Windows;
- run real encode/ffprobe smoke on native arm64 and a signed/notarized installed application;
- do not treat an Intel build, Rosetta execution, Homebrew runtime or developer `PATH` as release evidence.

For the Linux x64 production candidate:

- build the same pinned FFmpeg revision on Ubuntu 22.04 x64 with the pinned x264 and zlib sources;
- require `--enable-gpl`, `--enable-version3`, `--enable-libx264`, `--enable-zlib`, `--disable-nonfree`, `--disable-libopenh264`, `--disable-libx265`, and `--disable-libfdk-aac`;
- require `libx264` and native `aac` for V1 output, plus `ass` and PNG support for subtitle evidence;
- distribute the combined runtime under GPL-3.0-or-later and retain FFmpeg, x264, zlib, subtitle-library, font, build-recipe, configure, binary-digest, and corresponding-source material under immutable references;
- expose the corresponding-source references from the public release/download surface for as long as required by the approved distribution approach;
- run encode/probe/subtitle/PNG smoke tests on Ubuntu 22.04 and an installed AppImage, and perform an installed Debian-package restart exercise;
- do not fall back to system FFmpeg, distro x264, or a developer `PATH` in a packaged build.

This removes OpenH264 from the proposed Anybox distribution; it does not itself settle commercial H.264 use, the Windows/macOS FFmpeg LGPL review, or the Linux FFmpeg/libx264 GPL review.

## Required legal/release decisions

The approval reference placed in `media-runtime.lock.json` must answer all of the following:

1. Is use of the Windows-provided Media Foundation H.264 encoder acceptable for the intended Anybox editions, territories, and commercial model?
2. Do the retained source, build recipe, notices, About/EULA text, and download-site source link satisfy the selected FFmpeg redistribution approach?
3. Is Windows Server excluded from the supported Deliver matrix?
4. Is the initial-release rollback plan allowed to disable `timelineDelivery` and ship the prior desktop version if runtime or licensing evidence is withdrawn?
5. Is distributing the Linux FFmpeg/libx264 combination under GPL-3.0-or-later acceptable for the desktop application's distribution model?
6. Are the retained and publicly linked FFmpeg, x264, zlib, build recipe, notices, and license materials sufficient for the approved Linux corresponding-source method?
7. Has H.264 use on Linux been reviewed for the intended editions, territories, and commercial model independently of the GPL decision?

Until the Linux answers, immutable mirror, and real packaged smoke are recorded, Linux remains `releaseReadiness.status: "blocked"` and production `timelineDelivery` remains `false` for the synchronized three-platform release.

## Approval record

- Legal/license reviewer: **pending**
- Release approver: **pending**
- Reviewed runtime IDs: **Windows/macOS recorded in the lock; Linux pending**
- Decision date with timezone: **pending**
- Evidence reference: **pending**
- Supported Windows editions/versions: **pending**
- Supported Linux distributions/versions: **pending; technical baseline Ubuntu 22.04 x64**
- Effective desktop release: **pending**
