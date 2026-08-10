# Windows media runtime project-owner approval

- Status: approved by the Anybox project owner for the initial Windows x64 release candidate
- Approved at: 2026-07-12T15:57:46+08:00
- Approver: Anybox project owner (GitHub: `fanfan-de`)
- Runtime ID: `ffmpeg-anybox-8ad6288553-win32-x64-lgpl-r2`
- Release scope: Windows x64 desktop clients distributed worldwide as a free, open-source project
- Expected usage: low volume; no reliable installation forecast
- Commercial scope: the desktop application is free; any future API service is outside this decision

## Owner decision

The project owner authorizes this locked Windows x64 runtime for use in an Anybox release candidate and accepts the residual H.264 licensing risk of worldwide distribution. This is a project-owner risk decision, not third-party legal advice or a representation that every jurisdiction is patent-clear.

The approved distribution is limited to the Anybox-controlled FFmpeg/FFprobe build described below. It uses the Windows Media Foundation `h264_mf` encoder and the native FFmpeg `aac` encoder. GPL and nonfree components, including libx264, libx265, OpenH264, and FDK-AAC, are disabled. Windows Server is excluded from the supported Deliver target because the required Media Foundation encoder is not treated as available there.

Anybox must distribute the matching LGPL license and third-party notices, retain the exact corresponding FFmpeg source and build recipe, keep the source download available with the binary distribution, and preserve the locked hashes. This approval does not extend to a different FFmpeg revision, build recipe, runtime archive, platform, architecture, encoder, or commercial API service.

As of 2026-07-12, the project owner has temporarily made Windows Authenticode optional under the zero-budget open-source release policy. Public desktop release remains conditional on release-strict packaging, installation from the exact published installer, managed-Agent kill/restart/recovery/retry evidence, matching updater metadata and hashes, an explicit unsigned/SmartScreen warning when applicable, and successful GitHub/COS artifact verification. This exception does not relax the media-runtime requirements recorded here.

## Immutable evidence

- Candidate release: https://github.com/fanfan-de/anybox/releases/tag/media-runtime-ffmpeg-8ad6288553-win32-x64-r2
- Candidate commit: `076b6323b031b21f3100dd24bd0f018c75325bbc`
- Runtime archive SHA-256: `b073f24a43f03ef2c180b64f7d223cf0b581be7122bc741669f959ceea431038`
- FFmpeg source archive SHA-256: `b1c34a3697e7459de7536dbb208c9e8de19431c5d4b14b09cdfcc30d266e0b7d`
- Build recipe SHA-256: `503dd205ceb1368d56399d3be1beafa5789652cd4dd61b5567e3a3350e3260c3`
- `ffmpeg.exe` SHA-256: `629ba84a0f28b619d117831ce04439f8a306243a326ac59499379235d1bc1470`
- `ffprobe.exe` SHA-256: `dd31110eadadea6afb0bc8df161b73e47c2d9660511513fc8241efd53c454722`
- H.264/AAC smoke SHA-256: `22b9401f90de3ea6f17b01ae608e9fdd2344f06c61921583ee4f58a75d2fc96e`
- libass subtitle smoke SHA-256: `617a8dde9aa3a01158a6dc7989243dcae2420331167669b4cf96c2668c9d98b7`

The candidate release also retains the pinned libass, FreeType, FriBidi, and HarfBuzz source archives. The runtime archive contains `LICENSE.txt`, `THIRD-PARTY-NOTICES.txt`, `SOURCE.txt`, `BUILD-RECIPE.sh`, `configure.txt`, the reviewed Noto Sans CJK SC font and OFL text, and archive-bound render/subtitle smoke evidence.

## Rollback

If runtime integrity, license materials, platform support, or H.264 distribution assumptions become unacceptable, the approved initial-release rollback is to disable the `timelineDelivery` capability and publish a corrected desktop version without enabling Deliver. A blocked, missing, or hash-mismatched runtime must fail closed and must not fall back to a developer-machine FFmpeg.
