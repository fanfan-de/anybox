# Anybox Mobile App

iOS and Android Expo client for the desktop-hosted Anybox mobile bridge.

## Development

Check the mobile development environment first:

```powershell
corepack pnpm --filter anybox-mobile-app run doctor
```

Use strict mode when you want CI-style failure if Expo Go or local Android
builds are not ready. Add `--release` to include local signing and GitHub CLI
checks:

```powershell
corepack pnpm --filter anybox-mobile-app run doctor -- --strict
corepack pnpm --filter anybox-mobile-app run doctor -- --strict --release
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

iOS uses the same `anybox-mobile://` deep link scheme and the same Provider/relay API path. Local HTTP bridge access is configured for local networking, but the public relay URL is still the preferred path for real-device testing because iOS has no `adb reverse` equivalent.

On Windows, use a short pnpm virtual store path before local APK builds. Native CMake paths can otherwise exceed Windows path limits:

```powershell
corepack pnpm install --frozen-lockfile --force --virtual-store-dir C:\p\a
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

The APK is copied to `packages/mobile-app/build/anybox-mobile-debug.apk`.

APK builds target real Android phones by default (`arm64-v8a,armeabi-v7a`). A
developer who explicitly needs another ABI can set
`ANYBOX_ANDROID_ARCHITECTURES` to a comma-separated subset of
`arm64-v8a,armeabi-v7a,x86,x86_64`.

With USB debugging enabled and a device connected:

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

This Windows path uses Expo prebuild plus Gradle. Debug builds use
`assembleDebug`; signed website releases use `assembleRelease`. Google Play and
iOS publishing are intentionally outside this release track.

## Updates

The Android website build uses two self-hosted update paths:

- JavaScript, images, and fonts use the open-source `expo-updates` client with
  the Anybox protocol service at `https://updates.anybox.com.cn`.
- Native dependencies, permissions, and Expo SDK changes use a signed APK
  described by the signed files at
  `https://download.anybox.com.cn/mobile/android/version.json` and
  `version.sig`. GitHub `mobile-v*` releases are the fallback.

No Expo/EAS account or hosted update service is used.

### One-time key setup

Choose two different absolute backup directories, then run:

```powershell
$env:ANYBOX_MOBILE_BACKUP_DIR_PRIMARY = "D:\EncryptedBackups\AnyboxMobileA"
$env:ANYBOX_MOBILE_BACKUP_DIR_SECONDARY = "E:\EncryptedBackups\AnyboxMobileB"
$env:ANYBOX_MOBILE_BACKUP_PASSPHRASE = "<a long backup passphrase>"
corepack pnpm mobile:keys:init
```

The command refuses to overwrite existing material. Commit only the two public
identity files, `credentials/ota-certificate.pem` and
`credentials/android-release-certificate.sha256`; never commit
`.env.mobile-signing.local`, `.anybox-mobile-keys`, a JKS, or a private PEM.
Every release build must match the pinned Android certificate fingerprint, so
pointing the release environment at a debug or replacement keystore is blocked.

After the native configuration is final, record the `0.3.0` APK compatibility
baseline:

```powershell
corepack pnpm mobile:fingerprint:record
```

### OTA release

Every update is created in preview first:

```powershell
corepack pnpm mobile:update:preview -- --message "Fix mobile workspace refresh"
```

After testing that exact `updateId`, promote only its channel pointer:

```powershell
corepack pnpm mobile:update:promote -- --update-id <update-id>
```

Emergency rollback to the APK-embedded bundle:

```powershell
corepack pnpm mobile:update:rollback -- --channel production --embedded
```

The tools refuse an OTA when its native fingerprint differs from the recorded
APK baseline. The compatibility fingerprint normalizes only the preview versus
production request header; native code, permissions, dependencies, certificate,
and other Expo configuration still participate. Immutable assets are uploaded
and verified before the channel pointer is changed.

### Full APK release

Connect a real USB-debuggable Android device, then run:

```powershell
corepack pnpm mobile:release:publish -- --notes "Fix pairing reliability"
```

The command builds `build/anybox-mobile-release.apk`, verifies package/version/
certificate/zip alignment/signature, runs a physical-device smoke test, creates
a `mobile-v<version>` GitHub release with `--latest=false`, uploads the same
signed assets to COS, and updates the fixed CDN pointer last. It stops if there
is no physical device.

GitHub contains exactly:

```text
anybox-mobile.apk
anybox-mobile-release.json
anybox-mobile-release.json.sig
```

See `../mobile-update-server/README.md` for the read-only protocol service and
Tencent Docker/Caddy deployment.

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
- View pending approval requests inline in the Thread view, then allow or deny them from mobile.
- View read-only workspace git change summaries from the Workspace screen.
- Check for OTA updates and native mobile release updates from the Updates screen.

Google Play/App Store publishing, store metadata, and push notifications are
outside the current self-hosted Android release scope.

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
6. Trigger a tool approval from the desktop agent and verify the current Thread view shows the approval card and can allow or deny it.

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
7. Trigger a tool approval from the desktop agent and verify the current Thread view shows the approval card and can allow or deny it.
