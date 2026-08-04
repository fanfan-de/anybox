# Cinema Deliver V1 operations, migration, and support

> Status: Linux x64 release preparation, 2026-07-15. Deliver opens as Beta by default (`VITE_CINEMA_DELIVER_BETA=0` is the emergency UI kill switch). Windows x64, Apple Silicon macOS, and Linux x64 Beta installers bundle a native, smoke-tested FFmpeg runtime. Formal release approval remains separate from Beta availability.

## 1. Scope and sources of truth

Deliver creates a persistent render job for one saved Timeline revision, snapshots that Timeline and its media inputs, renders into a job-local temporary MP4, verifies the result with ffprobe, and only then registers the output as a project Asset with `source: "render"`.

The sources of truth are:

- `@anybox/shared/cinema-render` for settings, preflight, job, event, and runtime response contracts;
- `.anybox-cinema/render-jobs/job_<jobID>/job.json` for current job state;
- the job's `timeline.json`, `inputs/`, and `events.jsonl` for reproducibility and audit;
- the project Asset Library for a successfully registered output.

Browser state is not authoritative. Refreshing Deliver must reconstruct history and the selected output from the Agent APIs.

## 2. V1 support matrix

| Timeline content | V1 behavior |
| --- | --- |
| Ordered V1 video Clips | Supported: source trim, source range, gaps, fit, opacity, playback rate, Clip volume, and Track mute |
| A1 audio Clips | Supported: trim, volume, fade in/out, playback rate, and Track mute |
| O1 image Clips | Supported: contain/cover, opacity, and Timeline range |
| O1 video Clips | Blocked by preflight with `clip-unsupported` |
| O1 text Clips | Blocked by preflight with `clip-unsupported` |
| Hidden Tracks | Excluded from output |
| Muted Tracks | Audio excluded; visual inclusion still follows `hidden` |
| Timeline gaps | Filled with the Timeline background and silence |
| Transition, LUT, and keyframe features | Not persisted by the current Timeline contract and not inferred by Deliver |

Deliver must never silently omit unsupported visible content. A preflight error keeps **Start render** disabled.

## 3. Project migration and rollback

No Timeline document migration is required for Deliver V1. Existing `schemaVersion: 1` Timelines remain readable, and Deliver does not add render state to a Timeline.

On first use, the Agent creates new render storage underneath `.anybox-cinema/`. Existing Canvas, Timeline, and Asset Library records are not rewritten merely by opening Deliver. A successful render adds a normal project Asset under `产出/视频`; failed, canceled, or interrupted jobs do not add an output Asset. The Asset Library does not expose a separate exports system folder.

Migration rules:

1. Back up the project before enabling a preview build on irreplaceable media.
2. Do not rename or manually merge `job_<jobID>` directories. Job IDs, operation IDs, and snapshots are audit identities.
3. Unknown render schema versions must fail closed rather than be guessed.
4. Rolling the application back means disabling Deliver and opening the project normally. Existing render directories and registered output Assets remain data; older builds may ignore the render-job directories.
5. Never delete a registered render Asset solely because its originating job is old. Asset lifecycle and job-sandbox cleanup are separate operations.

## 4. Retention and cleanup

### Current implementation

The current D5 implementation is conservative:

- job state, Timeline snapshots, and event logs are retained;
- verified output Assets follow the normal Asset Library lifecycle;
- temporary render output is removed after cancellation/failure and during interrupted-job recovery;
- abandoned staging files are cleaned by the relevant storage workflow;
- an opt-in retention core can remove only `inputs/`, `.inputs.<id>.tmp/`, and `output.tmp.mp4` from terminal jobs older than a caller-supplied duration;
- `POST /api/cinema/projects/:projectID/render-retention/cleanup` exposes that core as an explicit project-level API;
- requests must supply a positive integer `retentionDurationMs` and a safe, unique `operationID`; the API supplies no retention-duration default;
- omitted `dryRun` defaults to `true`. A preview returns candidate job IDs, allowlisted targets, and conservative estimated reclaimable bytes without deleting render data;
- execution requires both `dryRun: false` and `confirm: "DELETE_REBUILDABLE_RENDER_FILES"`;
- operation journals are persisted in the project. Reusing a completed operation ID is rejected with `409 CINEMA_RENDER_RETENTION_OPERATION_REPLAYED`; using it with a different payload is rejected as a conflict. Use distinct IDs for preview and execution;
- retention rejects linked/traversing candidates. After restart, a new operation ID may safely rescan, while an incomplete old ID remains blocked for inspection;
- Deliver's collapsed **Advanced · Project storage** technical-preview surface requires an explicit positive whole-day duration, performs a cancelable dry-run, summarizes path-free results, and displays at most eight safe job IDs;
- execute requires a matching preview, a fresh operation ID, the user-entered phrase `CLEAN`, and the fixed API confirmation. It is intentionally non-cancelable after submission;
- execute is rejected unless the Agent base URL is loopback. Browser execution must originate from the Agent itself or the explicitly configured `ANYBOX_CINEMA_WEB_DEV_URL`; arbitrary web origins are rejected. Processes running as the same local OS user remain inside the stated trust boundary;
- start/completion/failure telemetry records only safe operation identity, duration, mode, aggregate counts/bytes, outcome, and stable error name;
- there is no product retention default, user-facing schedule, or automatic cleanup.

This means render-job storage can grow with the number and size of renders. Users and support staff must not manually delete individual files inside an active job directory.

### Public-release requirement

The technical-preview implementation proposes an operator-chosen duration for every run, with no default and no schedule. Its authorization boundary, confirmation flow, cancellation behavior, and telemetry are recorded in the [retention policy decision](./cinema-render-retention-policy-decision.md). Product and security owners must approve or replace that proposal before public enablement. Cleanup may remove only rebuildable job inputs and temporary files after the supplied retention period. It preserves:

- `job.json` and the stable job ID;
- `events.jsonl`;
- enough redacted snapshot metadata to explain which Timeline revision was rendered;
- registered output Assets and their catalog records.

The core and API already skip active/recent jobs, use path/symlink protections, serialize cleanup against render creation/retry, report estimated and actual reclaimed bytes without absolute paths, and have focused automated coverage. The technical-preview UI, cancelable indeterminate dry-run state, loopback/Origin guard, explicit confirmation, and aggregate telemetry are implemented. Formal product/security approval remains the release blocker; scheduling remains intentionally absent.

## 5. Diagnostics safe to collect

For a support case, collect:

- application version, OS, architecture, and whether the app is packaged;
- project ID, Timeline ID/revision, job ID, job status, and timestamps;
- render settings excluding any user-entered secrets (the current contract has none);
- stable preflight issue codes and the job's stable error code/message;
- failed jobs' and newly recovered interrupted jobs' optional `diagnosticSummary`: the pre-terminal phase plus the same path-free runtime identity, version, platform, and encoders;
- the redacted job event sequence;
- `/api/cinema/render-runtime` fields: availability, FFmpeg version, platform, ffprobe availability, and reported encoders;
- whether retry created a distinct job with `retryOfJobID`.

Each newly created job records a redacted `executionRuntime` before it enters the queue. The binding contains only `runtimeID`, `ffmpegVersion`, `platform`, `videoEncoder`, and `audioEncoder`; the `job-created`, `runtime-bound`, and `render-started` events carry the same path-free identity. Retry probes the current runtime and writes a new binding on the new job. It never mutates the original job's binding.

At execution time the queue probes the runtime again and requires the locked runtime ID, version, platform, and encoders to remain available. It then passes those exact locked encoders to the render graph. Identity drift or encoder loss fails with `render-runtime-unavailable`; the queue must not silently select a replacement encoder. Older schema-version-1 jobs without `executionRuntime` remain readable and bind once on their first execution, persisting a `runtime-bound` event before rendering. Existing terminal jobs are not retroactively rewritten.

Do not copy raw stderr, absolute project paths, environment variables, full FFmpeg commands/filter graphs, access tokens, or raw process environments into tickets. API responses and UI diagnostics must remain path-redacted. Legacy schema-version-1 interrupted jobs can lack an error summary; newly recovered jobs use `render-interrupted` and persist the same summary on the job and interruption event.

Common job errors:

| Code | Meaning | Operator action |
| --- | --- | --- |
| `snapshot-failed` | Timeline or media inputs could not be frozen | Check media availability, permissions, free space, then retry |
| `probe-failed` | A snapshotted input could not be read by ffprobe | Replace/repair the source asset and create a new render, or retry if the failure was transient |
| `render-runtime-unavailable` | The runtime identity/version changed or a locked encoder is no longer available | Repair/restore the expected runtime, or retry into a new job that records a fresh binding; never edit the old job |
| `render-failed` | FFmpeg exited unsuccessfully or output verification failed | Preserve the old job, inspect redacted events/runtime capability, then retry into a new job |
| `output-registration-failed` | Rendered media could not be committed to the Asset Library | Check project write access/free space; retry must not create a false succeeded Asset |
| `canceled` | User cancellation completed | Start a new render when wanted |
| `render-interrupted` | Agent stopped while the job was active | Confirm temporary output cleanup, inspect the recorded phase/runtime facts, then retry into a new job |

## 6. Preflight support procedure

Preflight errors are actionable product states, not generic network failures:

- `asset-missing`, internal `asset-trashed`, `asset-not-ready`, `asset-kind-mismatch`, and `asset-revision-stale`: repair or replace the referenced Clip asset in Edit; the UI presents `asset-trashed` as deleted and never links to an application Trash;
- `asset-source-range-invalid`: adjust the Clip source range;
- `clip-unsupported`: remove/replace unsupported visible content for V1;
- `timeline-empty`, `main-video-missing`, `custom-range-empty`, and `render-settings-invalid`: fix Timeline content or output range;
- `render-runtime-unavailable`, `video-encoder-unavailable`, and `audio-encoder-unavailable`: repair the packaged media runtime; do not use browser-side simulated success;
- `working-space-insufficient`: free project-volume space or choose a project location with enough capacity.

Warnings such as `personal-asset-copy-required` do not block rendering but explain additional snapshot cost.

## 7. Fault and regression matrix

Public enablement requires reproducible automated evidence for all of the following:

| Fault or regression | Required result |
| --- | --- |
| FFmpeg exits non-zero | Old job becomes retryable `failed`; no output Asset; retry creates a new job and can succeed |
| Agent restarts during an active job | Job becomes `interrupted`; temporary output is removed; retry is explicit |
| Insufficient disk space | Preflight blocks with `working-space-insufficient` |
| Project/input/output permission failure | Stable failed state, no fake output Asset, safe retry path |
| Queued cancellation | Prompt terminal `canceled`, queue entry removed, no FFmpeg process |
| Running cancellation | FFmpeg exits within the cancellation timeout, temporary output removed, no output Asset |
| Output registration failure | Job never claims `succeeded`, no orphan catalog record |
| Duplicate operation ID | Same create request resolves to the same job |
| Timeline changes after create | Existing job keeps its original revision and immutable snapshot |
| Runtime or encoder changes while queued | Existing job fails with its original `executionRuntime`; it does not switch runtime or encoder silently |
| 1,000-job history | API and first usable UI stay below the release threshold; DOM rows are virtualized |

## 8. Runtime and release boundary

Development may resolve FFmpeg/ffprobe from explicit environment variables or `PATH`. A packaged production build must use a verified, platform-specific bundled runtime with pinned artifact/source provenance, binary hashes, license materials, encoder policy, and a real encode/ffprobe smoke test.

Deliver Beta is a separate non-publishing local path for Windows x64, macOS arm64, and Linux x64. On each native host, build the pinned FFmpeg revision with `build-media-runtime.sh`, exercise the target H.264/AAC encoder, and run `dist:deliver-beta` with that exact FFmpeg/FFprobe pair plus license, notices, configure output, source metadata, and build recipe. Linux additionally binds the exact x264 and zlib sources and license files. The packaged Agent remains strict about using its bundled pair, the manifest binds the binary hashes into a Beta runtime ID, and the UI labels the capability **Deliver Beta**. Beta output never marks the runtime release-approved and is never published to an update channel.

The Cinema shell does not hide the Beta tab merely because the formal project capability is false. This keeps local development and Beta builds usable on all three release targets; opening Deliver still performs the real runtime query and preflight, so a missing or incompatible FFmpeg runtime blocks **Start render** with an actionable issue instead of creating a fake output. Set `VITE_CINEMA_DELIVER_BETA=0` only when an emergency build must hide the Beta entry entirely.

Windows x64 and macOS arm64 have approved Anybox-controlled runtime locks. Linux x64 is an explicit artifact-pending Anybox-controlled target; its lock contains no invented future digest. The repository contains local pinned-source candidate build scripts, a candidate digest generator, a lock-promotion command, a locked-archive preparer, and a three-platform release evidence matrix. GitHub Actions release-candidate and synchronized-release workflows have been removed: candidate construction, signing/notarization, gate verification, installed-app evidence validation, GitHub Release upload, and COS synchronization all run from locally controlled machines. GitHub is only the immutable Release artifact host, not a build or approval environment. Windows requires `h264_mf + aac`; macOS arm64 requires `h264_videotoolbox + aac`; Linux x64 requires the pinned static `libx264 + aac` GPL runtime with corresponding FFmpeg, x264, zlib, build recipe, license, and notice material. Nonfree components, x265, FDK-AAC, and OpenH264 remain forbidden. Linux cannot package a production runtime until its real candidate is built, immutably mirrored, reviewed, and promoted. macOS x64 and Windows arm64 remain unsupported. Production `timelineDelivery` remains false until all three approved manifests and all three installed-restart records exist.

Changing status strings alone cannot approve a media target. A target with `releaseReadiness.status: "approved"` must also have an approved license review and a complete machine-readable `approvalEvidence` object:

```json
{
  "approver": "<stable approver identity>",
  "approvedAt": "<ISO-8601 timestamp with timezone>",
  "references": ["<license/release evidence reference>"],
  "immutableMirror": {
    "reference": "<immutable artifact/source manifest reference>",
    "sha256": "<the locked distribution SHA-256>"
  },
  "rollbackPlan": {
    "strategy": "disable-deliver",
    "capability": "timelineDelivery",
    "reference": "<approved initial-release rollback runbook/reference>"
  }
}
```

The first approved runtime uses `releaseKind: "initial"` and must carry the approved `disable-deliver` rollback shown above, because no previous approved runtime can exist yet. A later runtime uses `releaseKind: "successor"`, declares `previousRuntimeID` in `releaseReadiness`, and replaces `rollbackPlan` with `{ "strategy": "previous-approved-runtime", "runtimeID": "<the same previousRuntimeID>", "reference": "<rollback evidence/reference>" }`. The verifier rejects missing/partial evidence, a mirror digest that differs from the locked distribution, an initial release without an approved capability-disable plan, or a successor whose rollback runtime does not match its declared predecessor. Blocked targets may omit `approvalEvidence`; the current lock intentionally does so and remains blocked. Placeholder values in this documentation are a template only, never approval evidence.

## 9. Human acceptance handoff

The remaining checks are deliberately left for a real installed-app session instead of more fixture simulation:

Use `pnpm --filter anybox-desktop-agent run dist:deliver-preview --dir --win` (or `--mac` / `--linux`) for an unpacked local rehearsal. Omitting `--dir` can create a clearly named, non-publishing preview installer when a human installed-path exercise is needed. The wrapper enables `VITE_CINEMA_DELIVER_DEV=1`, runs the non-strict technical verifier, places electron-builder artifacts under `packages/desktop/dist/deliver-preview`, forces `--publish never`, and rejects other publish policies. It never replaces release-strict `dist`, `dist:dir`, or `dist:publish`, and its output is not production approval evidence.

For a usable installer with a bundled native runtime, install the pinned build dependencies on the native Windows, Apple Silicon, or Linux machine, run and smoke `build-media-runtime.sh`, then set `ANYBOX_FFMPEG_BINARY`, `ANYBOX_FFPROBE_BINARY`, and `ANYBOX_MEDIA_RUNTIME_MATERIALS_DIR` to its staged output before invoking `dist:deliver-beta`. A missing binary, license/source/build material, reviewed subtitle font, or OFL license fails the package. Linux also fails closed if libx264, zlib/PNG, or their corresponding source/license material is absent. Beta artifacts remain local manual-test files and are not eligible for `dist:publish`.

Copy [cinema-deliver-installed-restart-evidence.template.json](./cinema-deliver-installed-restart-evidence.template.json) for the kill/restart run. Record only the build/runtime/job/process facts requested by the template; do not add absolute install/project paths, environment values, commands, raw stderr, or secrets. A preview run may rehearse the procedure, but the public-enable gate still requires a real approved release candidate and human result.

After filling the copy, validate it without rerunning the scenario:

```powershell
pnpm --filter anybox-desktop-agent verify:deliver-restart-evidence -- ../cinema-web/<evidence-file>.json
```

Technical-preview evidence is accepted only as rehearsal evidence and is reported that way. The eventual public-enable record must also pass `--release-strict`; that mode rejects the development gate, preview artifacts, failed runtime verification, missing/contradictory timestamps, a retry that does not point to the interrupted job, unsafe output leftovers, and incomplete redaction assertions. The validator reads the evidence file only and never kills a process, starts a render, or edits the record.

1. Install a packaged Windows build into a path containing spaces, open a real project, and confirm runtime discovery does not use a custom `PATH` FFmpeg.
2. Exercise Full and Custom range, the Timeline-native/common frame-rate choices, and Target bitrate. Confirm Custom initially spans the full Timeline and invalid values block Start render with a useful preflight issue.
3. Create a job, then change the Timeline revision. On a retryable failure or interruption, confirm `Retry revision <old>` uses the frozen snapshot while `Render revision <new>` creates from the current Timeline.
4. Render a representative long Timeline and judge preview/output fidelity, real progress cadence, CPU use, memory use, fan noise, and final file size. Preparing/probing/registering must not show invented percentages.
5. Cancel once while queued and once during a sustained render; confirm the UI settles promptly and no FFmpeg process or partial Asset remains.
6. After success, use `Show in Assets` twice and confirm both requests open the real output folder, select it, and focus it. Delete the output in Assets, confirm the 10-second Undo notice, then let a repeated deletion expire and return to Deliver. Within one status refresh Deliver must stop claiming the output is ready, present it as deleted, guide the user to render again, and omit `Show in Assets` rather than exposing the hidden transaction-isolation entry.
7. Terminate and restart the real Agent/Desktop process during rendering; confirm the old job becomes interrupted, shows `render-interrupted` with path-free phase/runtime facts, removes partial output, and Retry creates a new job.
8. Expand **Advanced · Project storage**. Verify the duration starts blank, cancel one preview, then preview again and confirm only safe job IDs/aggregate bytes appear. On the packaged same-origin UI, type `CLEAN`, execute once, and verify actual reclaimed bytes while jobs/events/snapshots/output Assets remain. Confirm a foreign browser Origin is rejected, then complete the approval record in the [retention policy decision](./cinema-render-retention-policy-decision.md); do not add a default or schedule without that approval.
9. On macOS x64 and Windows arm64, confirm Deliver remains unavailable. On Windows x64, macOS arm64, and Linux x64, confirm packaged builds never use a developer-machine `PATH` fallback and only an approved bundled manifest can enable the production capability.
10. After all three runtime targets are promoted and approved, perform the release from clean local checkouts of the same protected `master` commit. Run the Cinema unit, Edit E2E, Deliver E2E, Desktop gate, plugin, and Agent Cinema regressions locally before packaging. On each native platform, configure locally controlled signing/notarization credentials and run release-strict `dist` for Windows x64, macOS arm64, or Linux x64; the wrapper forces `--publish never`. Stage only the required installer and updater files, then generate `candidate-manifest.json` with `describe-desktop-release-candidate.mjs` and the shared commit SHA. The Linux set must include an AppImage with its updater blockmap embedded, a Debian package, and `latest-linux.yml`. Install those exact primary installers, complete three redacted restart records, and complete a copy of [cinema-deliver-release-approval.template.json](./cinema-deliver-release-approval.template.json) with separate license, product, and security approval, including the Linux GPL/corresponding-source scopes. Verify each directory with `verify-desktop-release-candidate.mjs`, then verify the three installed artifacts and approval together with `verify-deliver-release-matrix.mjs`. Create the GitHub Release and synchronize COS from the local release machine using only the already verified files; never rebuild, rename, or replace an asset between verification and publication. Re-download the published files and compare their hashes with the candidate manifests before promoting the release. GitHub Actions is not part of this path and must not be reintroduced as a build, signing, approval, or publishing authority.
# Subtitle burn-in operations

Every render setting explicitly resolves to `subtitles.mode = none` or a single `burn-in` subtitle Track ID. The render fingerprint and immutable job snapshot include this setting. Preflight blocks missing, hidden, non-subtitle and empty tracks, and blocks burn-in unless the runtime reports the `ass` filter plus the locked Noto font digest. Timing/readability findings remain warnings.

During job preparation, the immutable Timeline snapshot is converted to job-local `subtitle.ass`; the locked font is copied into job-local `fonts/`. FFmpeg runs with the job directory as its working directory and uses `ass=subtitle.ass:fontsdir=fonts`, avoiding platform path escaping. The ASS filter is placed after all visual overlays and before Custom Range trim, so absolute Cue timing and retry behavior remain stable.

Every media runtime candidate build must set `ANYBOX_MEDIA_RUNTIME_RUN_SMOKE=1`; the build script fails before downloading sources when that gate is absent. The candidate archive contains `evidence/smoke.mp4`, its FFprobe JSON, and a separate CJK `subtitle-smoke.mp4` with the generating ASS script, FFprobe JSON, and a clean PNG frame. `candidate.json` binds every evidence file by size and SHA-256. Candidate promotion verifies the H.264/AAC facts, libass renderer, locked Noto font digest, dependency versions, duration, and evidence filenames before writing the still-blocked runtime lock. Missing or mismatched smoke evidence is never promotable.

Windows candidate rehearsal from an MSYS2 `MINGW64` shell:

```bash
export ANYBOX_MEDIA_RUNTIME_RUN_SMOKE=1
export ANYBOX_FFMPEG_REVISION=8ad6288553
bash packages/desktop/scripts/build-media-runtime.sh win32 x64
```

Linux x64 candidate rehearsal from Ubuntu 22.04:

```bash
export ANYBOX_MEDIA_RUNTIME_RUN_SMOKE=1
export ANYBOX_FFMPEG_REVISION=8ad6288553
export ANYBOX_X264_REVISION=b35605ace3ddf7c1a5d67a2eb553f034aef41d55
bash packages/desktop/scripts/build-media-runtime.sh linux x64
```

The resulting candidate remains unapproved. Building and hashing it does not authorize mirroring, promotion to approved status, signing, packaging, or publishing.
