# GitHub Mobile Release Reference

## Repo Assumptions

- Repository: read from `packages/mobile-app/app.json` `expo.extra.anyboxMobileGitHubRepository` (currently `fanfan-de/anybox`)
- Mobile package: `packages/mobile-app`
- Default APK input: `packages/mobile-app/build/anybox-mobile-release.apk`
- Generated release asset directory: `packages/mobile-app/build/github-release`
- Release tag prefix: `mobile-v`
- APK asset name: `anybox-mobile.apk`
- Manifest asset name: `anybox-mobile-release.json`
- Manifest signature asset name: `anybox-mobile-release.json.sig`

## Manifest Shape

`anybox-mobile-release.json` should contain:

```json
{
  "version": "0.2.0",
  "versionCode": 2,
  "minimumVersionCode": 1,
  "apkUrl": "https://github.com/fanfan-de/anybox/releases/download/mobile-v0.2.0/anybox-mobile.apk",
  "sha256": "optional-sha256",
  "sizeBytes": 123456789,
  "notes": ["Fix pairing reliability"],
  "force": false
}
```

Rules:

- `version` should match `expo.version`.
- `versionCode` should match `expo.android.versionCode`.
- `versionCode` must increase for every native Android release.
- `minimumVersionCode` or `force: true` makes the update required.
- `apkUrl` should point to the same `mobile-v*` release, not `releases/latest`.

## Commands

From repo root:

```powershell
corepack pnpm mobile:android:delivery-check -- --strict --no-manifest
corepack pnpm mobile:android:build:release -- --channel production
corepack pnpm mobile:release:github:prepare -- --notes "Fix pairing reliability"
```

The prepare command prints a command like:

```powershell
gh release create mobile-v0.2.0 "packages/mobile-app/build/github-release/anybox-mobile.apk" "packages/mobile-app/build/github-release/anybox-mobile-release.json" "packages/mobile-app/build/github-release/anybox-mobile-release.json.sig" --repo fanfan-de/anybox --title "Anybox Mobile 0.2.0" --notes "Anybox Mobile 0.2.0" --latest=false
```

For large APKs, allow a long timeout. If `gh release create` times out, check whether it created a draft:

```powershell
gh release view mobile-v0.2.0 --repo fanfan-de/anybox --json tagName,isDraft,assets,url
```

If the draft exists but an asset is missing, upload only the missing asset and then publish:

```powershell
gh release upload mobile-v0.2.0 "packages/mobile-app/build/github-release/anybox-mobile.apk" --repo fanfan-de/anybox --clobber
gh release edit mobile-v0.2.0 --repo fanfan-de/anybox --draft=false
```

Use `--force` on the prepare command only when the mobile app should force users to update:

```powershell
corepack pnpm mobile:release:github:prepare -- --notes "Required update" --force --minimum-version-code 2
```

## Verification

Before handing off:

```powershell
corepack pnpm --filter anybox-mobile-app typecheck
corepack pnpm --filter anybox-mobile-app exec expo install --check
```

For device proof when available:

```powershell
corepack pnpm mobile:android:smoke:debug
corepack pnpm mobile:android:smoke:pairing
```

## Windows Build Fast Path

Use this environment before Android builds on the local Windows workstation:

```powershell
$env:JAVA_HOME="$env:LOCALAPPDATA\AnyboxMobile\AndroidToolchain\jdk-17"
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
$env:ANDROID_NDK_HOME="$env:ANDROID_HOME\ndk\27.1.12297006"
$env:ANDROID_NDK_ROOT=$env:ANDROID_NDK_HOME
$env:PATH="$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:PATH"
```

If `corepack pnpm mobile:android:build:debug` stalls after prebuild but `android/app/src/main/assets/index.android.bundle` exists, continue from Gradle directly:

```powershell
cd packages/mobile-app/android
.\gradlew.bat --no-daemon --console=plain assembleDebug
cd ..\..\..
Copy-Item packages/mobile-app/android/app/build/outputs/apk/debug/app-debug.apk packages/mobile-app/build/anybox-mobile-debug.apk -Force
```

## Troubleshooting

- If the app does not see a release, confirm the tag starts with `mobile-v` and the release is not a draft.
- If the release is a prerelease, it is ignored unless the app config enables prerelease checks.
- If the app finds the release but cannot open download, confirm the asset is named `anybox-mobile.apk`.
- If the app rejects the release manifest, confirm `anybox-mobile-release.json.sig` is present and was produced from the same manifest bytes.
- If desktop releases interfere, confirm no code path uses `releases/latest` for mobile updates.
- If Gradle fails with `Could not resolve com.android.tools.build:gradle:8.5.0`, make sure `packages/mobile-app/scripts/build-android-debug.mjs` patches `expo-updates-gradle-plugin/build.gradle.kts` repositories in addition to the Expo and React Native Gradle plugins.
- If Gradle fails with `[CXX1101] NDK ... did not have a source.properties file`, list `"$env:LOCALAPPDATA\Android\Sdk\ndk"` and move incomplete installer-only NDK directories out of the `ndk` folder before rebuilding.
