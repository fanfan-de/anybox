# Cinema media runtime licensing review brief

> Status: technical recommendation; **not legal advice and not approval**
>
> Updated: 2026-07-11

## Scope

This brief evaluates the Anybox-controlled Windows x64 and macOS arm64 artifact-pending targets represented in `packages/desktop/media-runtime.lock.json`. It narrows the two production candidates that should be built and submitted for license review. It does not approve H.264 patent use, FFmpeg redistribution, VideoToolbox or Media Foundation use, a binary mirror, or public Deliver enablement.

## Authoritative evidence

1. [FFmpeg's official legal page](https://ffmpeg.org/legal.html) describes FFmpeg as LGPL 2.1-or-later unless GPL parts are enabled, calls for corresponding source/build information and notices, and warns that codec patent obligations vary by jurisdiction. It explicitly identifies `libx264` as a GPL library to avoid in an LGPL distribution.
2. [FFmpeg's official configure source](https://github.com/FFmpeg/FFmpeg/blob/master/configure) makes `libopenh264` an optional integration that is disabled by default, while Media Foundation encoding is independently auto-detected. Therefore a Windows FFmpeg build does not technically require OpenH264 in order to expose `h264_mf`.
3. Cisco publishes OpenH264 source under the [BSD license](https://github.com/cisco/openh264/blob/master/LICENSE), but its separate [Cisco-provided binary notice](https://github.com/cisco/openh264/blob/gh-pages/BINARY_LICENSE.txt) limits Cisco's AVC/H.264 patent-license coverage to a Cisco-provided binary that is downloaded separately, can be controlled by the end user, and carries prescribed notices.
4. The previously evaluated BtbN recipe's [OpenH264 build script](https://github.com/BtbN/FFmpeg-Builds/blob/autobuild-2026-07-09-14-21/scripts.d/50-openh264.sh) builds OpenH264 from source and enables `--enable-libopenh264`. That third-party preview target has been removed from the production lock; both current candidates require `--disable-libopenh264`. This remains an engineering record, not a legal conclusion.
5. Microsoft documents an inbox [Media Foundation H.264 encoder](https://learn.microsoft.com/en-us/windows/win32/medfound/h-264-video-encoder) for Windows desktop clients, including Baseline/Main/High profiles and the `Mfh264enc.dll` system component. Microsoft also states that no Windows Server version is supported. Runtime probing must therefore remain authoritative, and Anybox must not claim Windows Server support from this evidence.
6. The repository now uses its own pinned-source build recipe for both targets. A production artifact still needs an Anybox-controlled immutable mirror, exact source archive and recipe hashes, notices, configure output, binary hashes, and recorded approval.

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

This removes OpenH264 from the proposed Anybox distribution; it does not itself settle the commercial H.264-use or FFmpeg LGPL review.

## Required legal/release decisions

The approval reference placed in `media-runtime.lock.json` must answer all of the following:

1. Is use of the Windows-provided Media Foundation H.264 encoder acceptable for the intended Anybox editions, territories, and commercial model?
2. Do the retained source, build recipe, notices, About/EULA text, and download-site source link satisfy the selected FFmpeg redistribution approach?
3. Is Windows Server excluded from the supported Deliver matrix?
4. Is the initial-release rollback plan allowed to disable `timelineDelivery` and ship the prior desktop version if runtime or licensing evidence is withdrawn?

Until those answers, immutable mirroring, and the real packaged smoke are recorded, Windows remains `releaseReadiness.status: "blocked"` and `timelineDelivery` remains `false`.

## Approval record

- Legal/license reviewer: **pending**
- Release approver: **pending**
- Reviewed runtime ID: **pending production replacement**
- Decision date with timezone: **pending**
- Evidence reference: **pending**
- Supported Windows editions/versions: **pending**
- Effective desktop release: **pending**
