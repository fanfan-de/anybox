---
name: anybox-mobile-release
description: Develop, validate, package, preview, and publish the Anybox Mobile Android client from the Anybox monorepo. Use when Codex needs to plan or execute local mobile development, real-device testing, debug or signed APK builds, native fingerprint checks, preview/production OTA updates, mobile-v* GitHub/CDN releases, version bumps, rollback, or mobile delivery documentation.
---

# Anybox Mobile Release

## Core Rules

- Work from the repository root.
- Treat `packages/mobile-app/app.json` as the production source of truth for
  version, Android `versionCode`, repository, tag prefix, update endpoints, and
  release asset names.
- Separate local validation from external publication. Do not mutate preview or
  production merely to prove that a workflow is feasible.
- Require a committed, scoped-clean source tree before OTA or APK publication.
- Require real-device evidence for a native production release.
- Never fabricate screenshots, Smoke results, or device coverage.
- Resolve the selected ADB serial, installed package, signing compatibility, and
  data-loss behavior before installing, clearing, replacing, or uninstalling an
  app.

Use the mobile-only GitHub Release identity:

- Tags start with `mobile-v`, for example `mobile-v0.3.1`.
- Assets include `anybox-mobile.apk`, `anybox-mobile-release.json`, and
  `anybox-mobile-release.json.sig`.
- Never use `releases/latest` for mobile discovery.
- Never mark a mobile release as GitHub latest. Use `--latest=false` or
  `make_latest: "false"`.
- The mobile app filters GitHub releases to `mobile-v*`.

## Required Lifecycle

Use four gates:

1. Local development through Metro or a native development build.
2. Standalone APK validation and real-device Smoke.
3. Immutable preview OTA or signed native candidate validation.
4. Production publication followed by production-path verification.

For development, testing, device strategy, release classification, manual
checklists, and safe workflow validation, read
`references/development-test-release.md`.

For exact GitHub asset names, manifest shape, command form, recovery, Windows
toolchain setup, and upload troubleshooting, read
`references/github-mobile-release.md`.

## Gate 1: Cheap Checks

Run before expensive Android work:

```powershell
corepack pnpm mobile:doctor -- --strict
corepack pnpm mobile:typecheck
corepack pnpm --filter anybox-mobile-app exec expo install --check
```

Run focused tests for the changed area. For update and release tooling:

```powershell
corepack pnpm --filter anybox-mobile-app test:update-tools
```

## Gate 2: Standalone Delivery

Build and check the standalone debug APK:

```powershell
corepack pnpm mobile:android:build:debug
corepack pnpm mobile:android:delivery-check -- --strict --no-manifest
```

On Windows, if Ninja reports `manifest 'build.ninja' still dirty after 100
tries`, do not keep retrying or replace native baselines. Follow the short
pnpm virtual-store procedure in `references/development-test-release.md`.

When a compatible physical device is available:

```powershell
$env:ANDROID_SERIAL = "<adb-serial>"
corepack pnpm mobile:android:install:debug
corepack pnpm mobile:android:smoke:debug
corepack pnpm mobile:android:smoke:pairing
corepack pnpm mobile:android:smoke:bridge -- --url "<pairing-url-or-deep-link>"
```

Remember that `android:smoke:debug` clears app data unless `--keep-data` is
passed, and pairing Smoke intentionally uses a clean state.

## Gate 3: Choose OTA or APK

Run:

```powershell
corepack pnpm mobile:fingerprint:check
```

- First prove that the fingerprint is stable for the same commit and frozen
  lockfile in two different checkout paths. A path-dependent mismatch is a
  tooling failure, not evidence of a native change.
- If the native fingerprint matches, use the self-hosted OTA preview and
  promotion path for JavaScript, UI, translations, business logic, and
  JavaScript assets.
- If it differs, publish a new APK. This includes permissions, native
  dependencies, Expo or React Native changes, native modules, package identity,
  scheme, signing, update source, and app metadata.
- Never bypass a fingerprint mismatch to force an OTA.

## OTA Path

Publish only to preview first:

```powershell
corepack pnpm mobile:update:preview -- --message "Release message"
```

Validate the exact printed `updateId` on a preview client. Promote only that
immutable update:

```powershell
corepack pnpm mobile:update:promote -- --update-id <update-id>
```

Rollback when necessary:

```powershell
corepack pnpm mobile:update:rollback -- --channel production --embedded
```

Preview is channel-scoped, not device-scoped. Do not describe it as a
single-device guarantee unless the update server has an allowlist or
authenticated device routing.

## Native APK Path

For a native release, bump:

- `expo.version`
- `expo.android.versionCode` with a strictly increasing integer
- `packages/mobile-app/package.json` version
- `expo.ios.buildNumber` when mobile versions should remain aligned

Record the finalized native baseline:

```powershell
corepack pnpm mobile:fingerprint:record
```

Build and locally validate the production candidate:

```powershell
corepack pnpm mobile:android:build:release -- --channel production
adb -s <serial> install -r packages/mobile-app/build/anybox-mobile-release.apk
```

Publish only after the candidate gates pass:

```powershell
corepack pnpm mobile:release:publish -- --notes "Release note"
```

The publisher must upload immutable assets before changing the fixed production
pointer. Use long timeouts for large APK uploads.

## Candidate Integrity

The current one-command publisher rebuilds the APK immediately before device
Smoke and upload. The local GitHub asset preparer signs a caller-supplied APK
but does not attest that it came from the current commit. Do not treat
asset-preparation success as candidate-provenance evidence.

If the user requires extended manual validation of the exact uploaded file,
report these limitations and prefer implementing a two-phase candidate record:

```text
candidate: build + sign + verify + record commit/hash/certificate/version/fingerprint
publish: re-verify + upload those exact files without rebuilding
```

Do not claim a candidate command exists until it is implemented and tested.

## Completion Standard

Before declaring success:

- report the source commit and dirty/clean state;
- report version, versionCode, runtime version, channel, package, and signing
  identity as applicable;
- report which automated, standalone, real-device, preview, and production
  gates actually ran;
- report any missing screenshots or skipped device gates;
- verify all expected GitHub and CDN assets after publication;
- verify the production client discovers and applies the release through the
  normal user path.
