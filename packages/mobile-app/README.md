# Anybox Mobile App

iOS and Android Expo client for the desktop-hosted Anybox mobile bridge.

## Development

Check the mobile development environment first:

```powershell
corepack pnpm --filter anybox-mobile-app run doctor
```

Use strict mode when you want CI-style failure if Expo Go, local Android builds, or EAS native builds are not ready:

```powershell
corepack pnpm --filter anybox-mobile-app run doctor -- --strict
```

```powershell
corepack pnpm install
corepack pnpm --filter anybox-mobile-app start
```

For iOS on macOS with Xcode installed:

```powershell
corepack pnpm --filter anybox-mobile-app ios
corepack pnpm --filter anybox-mobile-app ios:dev
```

For a local iOS simulator native build:

```powershell
corepack pnpm mobile:ios:simulator
```

For iOS builds through EAS:

```powershell
corepack pnpm --filter anybox-mobile-app build:ios:preview
corepack pnpm --filter anybox-mobile-app build:ios:production
```

iOS uses the same `anybox-mobile://` deep link scheme and the same Provider/relay API path. Local HTTP bridge access is configured for local networking, but the public relay URL is still the preferred path for real-device testing because iOS has no `adb reverse` equivalent.

On Windows, use a short pnpm virtual store path before local APK builds. Native CMake paths can otherwise exceed Windows path limits:

```powershell
corepack pnpm install --frozen-lockfile --force --virtual-store-dir C:\p\anybox-pnpm
```

Scan the QR code with Expo Go first. For a custom Android build:

```powershell
corepack pnpm --filter anybox-mobile-app android:dev
```

This local custom build path requires Java, the Android SDK, and adb on `PATH`.

For a Windows local debug APK, prepare the Android toolchain first:

```powershell
corepack pnpm mobile:android:setup
```

To install the missing Windows packages, run:

```powershell
corepack pnpm mobile:android:setup -- --install --set-env
```

Reopen the terminal after `--set-env`, then install SDK packages and build the debug APK:

```powershell
corepack pnpm mobile:android:setup -- --install-sdk
corepack pnpm mobile:android:build:debug
```

The APK is copied to `packages/mobile-app/build/anybox-mobile-debug.apk`. With USB debugging enabled and a device connected:

```powershell
corepack pnpm mobile:android:install:debug
```

To install the debug APK, launch it, capture a screenshot, and fail on fatal startup logs:

```powershell
corepack pnpm mobile:android:smoke:debug
```

To run a deeper Android smoke test that opens the installed app through an `anybox-mobile://connect?...` deep link, pairs it against a local mock bridge, opens a workspace, opens a chat, approves a pending request, sends a prompt, and verifies streamed reply/messages/tasks load:

```powershell
corepack pnpm mobile:android:smoke:pairing
```

To verify that the Android handoff artifacts and command wiring are ready without requiring a connected device:

```powershell
corepack pnpm mobile:android:delivery-check
```

This also writes `packages/mobile-app/build/anybox-mobile-delivery.json` with APK and screenshot sizes, timestamps, and SHA256 checksums. Pass `-- --manifest <path>` to write it somewhere else, or `-- --no-manifest` to skip the file.

For a single handoff gate that runs desktop typecheck, mobile typecheck, focused mobile bridge tests, the debug APK build, and the delivery check:

```powershell
corepack pnpm mobile:android:handoff-check
```

Use the faster no-build version when you only changed wiring, docs, or scripts:

```powershell
corepack pnpm mobile:android:handoff-check -- --skip-build
```

Use the device version before sharing the APK:

```powershell
corepack pnpm mobile:android:handoff-check -- --with-device
```

Use the real bridge version when the desktop Mobile Connection page is open and you have copied its Android pairing URL or deep link:

```powershell
corepack pnpm mobile:android:handoff-check -- --real-bridge-url "anybox-mobile://connect?url=..."
```

If the desktop app was started after this handoff support landed, it also writes `%APPDATA%\anybox-desktop-agent\mobile-bridge-handoff.json`. In that case the real bridge gate can read the latest pairing link automatically:

```powershell
corepack pnpm mobile:android:handoff-check -- --use-desktop-handoff
```

To run the installed APK against a real desktop bridge, start the desktop app, open the Mobile Connection page, click `复制验收命令`, connect a USB-debuggable Android device, then run the copied command from the repository root.

You can also pass the Android deep link or pairing URL manually. The default desktop QR uses the public bridge endpoint:

```powershell
corepack pnpm mobile:android:smoke:bridge -- --url "https://anybox.com.cn/?code=..."
```

Or pass the full Android deep link:

```powershell
corepack pnpm mobile:android:smoke:bridge -- --url "anybox-mobile://connect?url=..."
```

When the desktop handoff JSON exists, the URL can be omitted:

```powershell
corepack pnpm mobile:android:smoke:bridge
```

This checks `/api/mobile/status` from the computer first without consuming the pairing code, installs the debug APK by default, clears app data, opens the deep link through `adb`, waits for the connected Home UI, captures `packages/mobile-app/build/anybox-mobile-real-bridge.png`, and fails on fatal Android logs. Use `--skip-preflight` if the computer-side status check is not useful for your tunnel setup, `--skip-install` to reuse an installed APK, `--keep-data` to preserve the current pairing, or `--replace-existing` when intentionally switching from an existing paired desktop.

When the pairing URL uses `127.0.0.1` or `localhost`, the real bridge smoke handles Android networking automatically: emulators use `10.0.2.2`, and physical USB devices use `adb reverse` unless `--no-adb-reverse` is passed. You can force a device-visible host with `--android-host <ip-or-host>`.

If the desktop pairing code expires or a previous attempt consumed it, click `刷新配对码` in the desktop Mobile Connection page and pass the new URL/deep link to the smoke command.

After a real-device bridge smoke passes, use the strict handoff gate:

```powershell
corepack pnpm mobile:android:delivery-check -- --require-real-bridge --strict
```

This requires the real bridge smoke screenshot in addition to the debug APK and mock smoke screenshots.

This Windows path uses Expo prebuild plus Gradle `assembleDebug`. EAS local builds are not the default path here because Expo does not officially support local EAS builds on Windows.

For an internal APK build through EAS:

```powershell
corepack pnpm --filter anybox-mobile-app build:android:apk
```

For a Play Store app bundle:

```powershell
corepack pnpm --filter anybox-mobile-app build:android:production
```

For a TestFlight or App Store iOS build:

```powershell
corepack pnpm --filter anybox-mobile-app build:ios:production
```

## Updates

The app supports two update paths:

- EAS Update for JavaScript, asset, and UI-only changes.
- GitHub Releases for native Android APK updates, using only tags that start with `mobile-v`.
- A direct release manifest URL for custom native Android or iOS update hosting. On iOS, use a manifest with an App Store, TestFlight, or IPA URL; GitHub APK releases are ignored.

EAS Update needs an Expo project ID before it can serve OTA updates. Configure it once after logging in:

```powershell
corepack pnpm --filter anybox-mobile-app exec eas login
corepack pnpm --filter anybox-mobile-app exec eas update:configure
```

The dynamic Expo config enables the update URL when `EXPO_PUBLIC_EAS_PROJECT_ID`, `EAS_PROJECT_ID`, or `EXPO_UPDATES_URL` is present at build time. Without one of those values, OTA updates stay disabled and the app continues to run from the embedded bundle.

Publish OTA updates to the build channel:

```powershell
corepack pnpm mobile:update:preview -- --message "Fix mobile workspace refresh"
corepack pnpm mobile:update:production -- --message "Fix mobile workspace refresh"
```

For full app updates, the default setup reads GitHub Releases from `fanfan-de/anybox`, filters tags that start with `mobile-v`, and ignores desktop releases. A mobile release should use a tag like `mobile-v0.2.0` and include these assets:

```text
anybox-mobile.apk
anybox-mobile-release.json
```

Prepare those assets after building the APK:

```powershell
corepack pnpm mobile:android:build:debug
corepack pnpm mobile:release:github:prepare -- --notes "Fix pairing reliability"
```

The prepare command writes:

```text
packages/mobile-app/build/github-release/anybox-mobile.apk
packages/mobile-app/build/github-release/anybox-mobile-release.json
```

It also prints a `gh release create ...` command. The app checks the GitHub Releases API directly, so do not use `releases/latest` for mobile updates.

If you do not want to use GitHub Releases, set `EXPO_PUBLIC_ANYBOX_MOBILE_RELEASE_URL` to a JSON manifest URL before building. That manifest URL takes priority over GitHub Releases.

Example manifest:

```json
{
  "version": "0.2.0",
  "versionCode": 2,
  "minimumVersionCode": 1,
  "apkUrl": "https://example.com/anybox-mobile-0.2.0.apk",
  "sha256": "optional-sha256",
  "notes": ["Fix pairing reliability", "Improve session refresh"],
  "force": false,
  "ios": {
    "version": "0.2.0",
    "buildNumber": "4",
    "minimumBuildNumber": "4",
    "testFlightUrl": "https://testflight.apple.com/join/example"
  }
}
```

The manifest can also contain platform-specific values under `android`, `ios`, `platforms.android`, or `platforms.ios`. Use `minimumVersionCode`, `minimumBuildNumber`, or `force: true` for a required update.

## Bridge API Smoke Test

After starting the desktop app and opening the Mobile Connection page, copy the public URL or the `anybox-mobile://connect?...` deep link and run:

```powershell
corepack pnpm mobile:smoke -- --url "https://anybox.com.cn/?code=..."
```

The smoke test checks public bridge status, pairs a temporary device, verifies authenticated status/workspaces/approvals, and revokes the temporary device by default. Passing `--keep-device` keeps it paired for manual testing.

## Account

The app can sign in to the Anybox Provider account with email and password. The default provider URL is `https://anybox.com.cn`; override it at build time with:

```powershell
$env:EXPO_PUBLIC_ANYBOX_PROVIDER_URL="https://anybox.com.cn"
```

Email registration calls `POST /api/agent/password/register`, which creates the Provider workspace/account and sends the verification email. Email login calls `POST /api/agent/password/login` and stores the returned `ayb_access_...` / `ayb_refresh_...` agent tokens in `expo-secure-store`. The app refreshes the access token with `POST /api/agent/oauth/refresh` and revokes it with `POST /api/agent/oauth/revoke` on sign out.

The Provider account is separate from desktop pairing: sign in with email for the cloud account, then scan or paste a pairing link to connect a desktop.

## Connection

Use the Scan QR code action on the mobile app home screen to scan the desktop Mobile Connection QR code. The desktop QR can carry multiple connection candidates, currently cloud relay and LAN when both are available. After scanning, the app previews each candidate from the phone, hides unavailable paths, and lets the user choose the connection method before exchanging the one-time code for a device token stored with `expo-secure-store`.

The advanced URL login path remains available for troubleshooting. Paste the public URL from the desktop Mobile Connection page, including the `code` or `token` query parameter, paste a LAN URL such as `http://192.168.x.x:4896/?code=...`, or paste a full `anybox-mobile://connect?url=...`, `anybox-mobile://pair?...`, or `anybox-mobile://connect-options?...` deep link.

## Current Scope

- Connect to the desktop bridge with QR pairing, choose between available relay/LAN candidates, or use the advanced public URL/token flow and exchange it for a per-device token.
- Register or sign in to the Anybox Provider account with email/password and store Provider agent tokens securely on iOS and Android.
- Show bridge status, workspaces, recent chats, workspace chats, chat messages, and session tasks.
- Create a chat inside an existing workspace.
- Browse workspace files read-only, search by file name, and preview supported text/image files.
- Send a prompt, show it optimistically, and refresh messages/tasks while the desktop agent is running.
- Receive session runtime updates through SSE, with polling kept as a fallback.
- Receive global workspace/session/approval change events through the desktop bridge SSE stream.
- Resume or stop the active session through the existing mobile bridge routes.
- Revoke the current device token when changing connections.
- Refresh mobile pairing codes, list paired devices, inspect device capabilities, and revoke paired mobile devices from the desktop Mobile Connection page.
- View pending approval requests, approval history, and allow or deny requests from mobile.
- View read-only workspace git change summaries from the Workspace screen.
- Check for OTA updates and native mobile release updates from the Updates screen.

Release signing, store metadata, notifications, and account-linked desktop discovery are not implemented yet.

## iOS Smoke Test

The fastest iOS bring-up is Expo Go or a local simulator build:

1. Start the mobile app:

   ```powershell
   corepack pnpm --filter anybox-mobile-app ios
   ```

2. Use the iOS simulator or Expo Go on an iPhone.
3. Sign in to Anybox Provider, then connect through the public relay desktop list or scan/paste a pairing link.
4. Verify Home loads workspaces, open a chat, send a short prompt, and watch Messages and Tasks refresh.
5. Open a Workspace and verify Chats, Changes, and read-only Files load.
6. Trigger a tool approval from the desktop agent and verify the Approvals screen can allow or deny it.

For native-device iOS handoff, prefer the public relay URL or a LAN URL reachable from the iPhone. Localhost URLs that work with Android smoke scripts through `adb reverse` will not work on iOS.

## Android Smoke Test

The mock pairing smoke (`mobile:android:smoke:pairing`) is the repeatable CI-style check. The delivery check (`mobile:android:delivery-check`) validates the APK and local evidence without needing a device. The real bridge smoke (`mobile:android:smoke:bridge`) is the first check to run before handing the APK to someone else, because it exercises the public mobile bridge URL, tunnel forwarding, QR/deep-link contents, and Android network path.

1. Start the desktop app and open the Mobile Connection page.
2. Start the mobile app:

   ```powershell
   corepack pnpm --filter anybox-mobile-app start -- --lan --port 8082
   ```

3. Open the Expo Go URL on an Android phone.
4. Scan the desktop Mobile Connection QR code, confirm the desktop details, and connect. You can also use Advanced URL login to paste the public URL or `anybox-mobile://connect?...` deep link.
5. Verify Home loads workspaces, open a chat, send a short prompt, and watch the Messages and Tasks sections refresh.
6. Open a Workspace and verify Chats, Changes, and read-only Files load.
7. Trigger a tool approval from the desktop agent and verify the Approvals screen can allow or deny it, then switch to History after resolving it.
