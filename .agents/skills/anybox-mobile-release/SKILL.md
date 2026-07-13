---
name: anybox-mobile-release
description: Prepare, verify, and publish the Anybox Mobile Android app release from the Anybox monorepo using the mobile-v* GitHub Releases flow. Use when the user asks to release, package, publish, update, or document the Anybox mobile/iPad/Android client, create mobile GitHub release assets, bump mobile versionCode/version, or avoid desktop releases interfering with mobile updates.
---

# Anybox Mobile Release

## Core Rule

Use the mobile-only GitHub Release flow:

- Tags must start with `mobile-v`, for example `mobile-v0.2.0`.
- Release assets must include `anybox-mobile.apk` and `anybox-mobile-release.json`.
- Do not use `releases/latest` for mobile update checks; desktop releases can become latest.
- Do not mark mobile releases as GitHub `latest`; pass `--latest=false` with `gh` or `make_latest: "false"` with the GitHub Releases API.
- The mobile app checks GitHub Releases API and filters only `mobile-v*` tags.

## Workflow

1. Work from the repository root, and treat `packages/mobile-app/app.json` as the source of truth for the GitHub repository, tag prefix, asset names, version, and Android `versionCode`.
2. Inspect current mobile config in `packages/mobile-app/app.json`.
3. Confirm the target tag does not already exist locally, remotely, or as a GitHub Release:
   ```powershell
   git tag --list mobile-v*
   git ls-remote --tags origin refs/tags/mobile-vX.Y.Z
   ```
4. For a native APK release, bump:
   - `expo.version`
   - `expo.android.versionCode` with a strictly increasing integer.
   - `packages/mobile-app/package.json` version.
   - `expo.ios.buildNumber` when the release version should stay aligned across mobile platforms.
5. Run dependency and type checks before spending time on Android builds:
   ```powershell
   corepack pnpm --filter anybox-mobile-app typecheck
   corepack pnpm --filter anybox-mobile-app exec expo install --check
   ```
6. Build or confirm the APK:
   ```powershell
   corepack pnpm mobile:android:build:debug
   ```
7. Run delivery checks and device smoke where available:
   ```powershell
   corepack pnpm mobile:android:delivery-check -- --strict --no-manifest
   corepack pnpm mobile:android:smoke:debug
   corepack pnpm mobile:android:smoke:pairing
   ```
   If no Android device or emulator is available, do not fabricate screenshots; record the device-smoke gap explicitly.
8. Generate GitHub Release assets:
   ```powershell
   corepack pnpm mobile:release:github:prepare -- --notes "Release note"
   ```
9. Commit the version/dependency changes, push the commit, and publish a tag or create the release with an explicit target commit. The release tag must match the printed `mobile-v*` tag.
10. Upload the generated files from `packages/mobile-app/build/github-release/` to the GitHub Release and verify both assets are present:
   ```powershell
   anybox-mobile.apk
   anybox-mobile-release.json
   ```

## Fast Path

Before rebuilding, use the fastest checks to avoid repeating slow work:

1. Check whether the existing APK is fresh:
   ```powershell
   corepack pnpm mobile:android:delivery-check -- --strict --no-manifest
   ```
   If `APK freshness` passes, the version/tag is still correct, and required smoke screenshots are present, reuse `packages/mobile-app/build/anybox-mobile-debug.apk`.
2. On Windows, set the known local toolchain before Android builds:
   ```powershell
   $env:JAVA_HOME="$env:LOCALAPPDATA\AnyboxMobile\AndroidToolchain\jdk-17"
   $env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
   $env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
   $env:ANDROID_NDK_HOME="$env:ANDROID_HOME\ndk\27.1.12297006"
   $env:ANDROID_NDK_ROOT=$env:ANDROID_NDK_HOME
   $env:PATH="$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:PATH"
   ```
3. On macOS, if the local portable toolchain exists, set it only for the release commands:
   ```bash
   export JAVA_HOME="$HOME/.local/share/anybox-mobile-android-toolchain/jdk-17/Contents/Home"
   export ANDROID_HOME="$HOME/.local/share/anybox-mobile-android-toolchain/android-sdk"
   export ANDROID_SDK_ROOT="$ANDROID_HOME"
   export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/27.1.12297006"
   export ANDROID_NDK_ROOT="$ANDROID_NDK_HOME"
   export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
   ```
4. If Gradle reports a broken NDK such as `ndk\27.0.12077973` missing `source.properties`, move that incomplete SDK directory out of `Android\Sdk\ndk` or `$ANDROID_HOME/ndk` after verifying it only contains installer residue.
5. Avoid `--clean` unless generated native files are corrupt. A clean prebuild can add many minutes. If `prebuild` already produced `android/` and `index.android.bundle`, continue with direct Gradle:
   ```powershell
   .\gradlew.bat --no-daemon --console=plain assembleDebug
   ```
   Then copy `android/app/build/outputs/apk/debug/app-debug.apk` to `packages/mobile-app/build/anybox-mobile-debug.apk`.
6. GitHub APK uploads are slow for ~200 MB files. Use long timeouts. If `gh release create` times out and leaves a draft release, do not recreate blindly; inspect it, upload missing assets with `gh release upload`, then publish with `gh release edit --draft=false`.

## Decision Points

- For JS/style/business logic only, prefer EAS Update if configured.
- For Android permissions, native dependencies, Expo SDK changes, `android/`, or app metadata changes, publish a new mobile APK release.
- If the user wants GitHub-only updates, keep EAS project ID unset; mobile APK checks still work through GitHub Releases.
- If publishing is requested and GitHub CLI is available, use the `gh release create ... --latest=false` command printed by the prepare script plus the latest flag. If `gh` is unavailable but `GH_TOKEN` or `GITHUB_TOKEN` is available, use the GitHub Releases API with `make_latest: "false"` to create the release and upload both assets. Otherwise report the exact files and tag to upload manually.

## Reference

Read `references/github-mobile-release.md` when the task needs exact asset names, manifest fields, release command shape, or troubleshooting details.
