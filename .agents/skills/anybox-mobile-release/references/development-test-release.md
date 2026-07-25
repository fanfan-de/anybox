# Anybox Mobile Development, Test, and Release

## Contents

1. Operating model
2. Safety boundary
3. Gate 1: local development
4. Gate 2: standalone Android validation
5. Gate 3: classify the change
6. OTA preview and production
7. Native APK candidate and production
8. Post-release verification
9. Device strategy
10. Manual device checklist
11. Feasibility validation without publishing
12. Known workflow gap

## Operating Model

Use three environments and four gates:

```text
local source
  -> local development
  -> standalone real-device validation
  -> preview or signed native candidate
  -> production publication
  -> production-path verification
```

Do not make the number of installed apps the foundation of the workflow. A
separate development application ID is useful when one personal phone must also
retain the public app, but a dedicated physical test device gives the most
faithful package, scheme, signing, and upgrade validation.

Use a test Provider account, a staging Provider, or only the developer's
desktop bridge. A separate app sandbox does not prevent a development client
from modifying production server data.

## Safety Boundary

Treat these as local-only commands:

```powershell
corepack pnpm mobile:start
corepack pnpm mobile:android:dev
corepack pnpm mobile:android:build:debug
corepack pnpm mobile:android:build:release
corepack pnpm mobile:android:install:debug
corepack pnpm mobile:android:delivery-check
corepack pnpm mobile:fingerprint:check
corepack pnpm mobile:release:github:prepare
```

Treat these as external publication commands:

```powershell
corepack pnpm mobile:update:preview
corepack pnpm mobile:update:promote
corepack pnpm mobile:update:rollback
corepack pnpm mobile:release:publish
gh release create
gh release upload
```

Do not run an external publication command while merely validating
feasibility. Require an explicit request to mutate preview or production.

Do not uninstall an app, clear app data, replace a paired desktop, or install a
different build onto a personal device until the package name, signing
compatibility, target serial, and data-loss behavior are resolved.

## Gate 1: Local Development

Work on a feature branch. Do not bump a production version for ordinary local
development.

Run the environment and cheap checks first:

```powershell
corepack pnpm mobile:doctor -- --strict
corepack pnpm mobile:typecheck
corepack pnpm --filter anybox-mobile-app exec expo install --check
```

For JavaScript, UI, translations, and ordinary business logic, use Metro on the
LAN:

```powershell
corepack pnpm mobile:start -- --lan --port 8082
```

For permissions, native dependencies, Expo SDK changes, config plugins, native
modules, package identity, or scheme changes, use a native development build:

```powershell
corepack pnpm mobile:android:dev
```

The current debug and production builds share `com.anybox.mobile` but use
different signing keys. A debug build cannot replace an installed
production-signed app. Use a dedicated test device, uninstall only with
explicit authorization, or implement a separate development application ID.

For a personal phone that must retain the public app, a separate development
application ID is therefore required for simultaneous installation. It is not
required when a dedicated test phone can be reset and reserved for development.
Even with a development ID, finish native releases with a production-signed
upgrade test because package identity, signing, deep links, updater behavior,
and data migration differ.

Metro success is not a release gate. Continue to a standalone APK before
classifying or publishing the change.

## Gate 2: Standalone Android Validation

Run focused tests appropriate to the touched code. For the update toolchain:

```powershell
corepack pnpm --filter anybox-mobile-app test:update-tools
```

Build the standalone debug APK:

```powershell
corepack pnpm mobile:android:build:debug
```

The expected artifact is:

```text
packages/mobile-app/build/anybox-mobile-debug.apk
```

### Windows native build path

pnpm's normal isolated dependency paths can push Prefab and CMake inputs close
to the Windows path limit. A characteristic failure is:

```text
ninja: error: manifest 'build.ninja' still dirty after 100 tries
```

When this occurs, keep the frozen lockfile and give that checkout its own short
virtual store. Do not share one virtual store between active worktrees:

```powershell
$anyboxVirtualStore = "C:\pvs\m"
corepack pnpm --config.virtual-store-dir=$anyboxVirtualStore install --filter anybox-mobile-app... --frozen-lockfile --force
$env:ANYBOX_ANDROID_ARCHITECTURES = "arm64-v8a"
corepack pnpm mobile:android:build:debug -- --clean
```

The short store changes only the local dependency layout. It must not change
`package.json` or `pnpm-lock.yaml`. Check `git status` immediately afterward.
Use a different short directory for every worktree. A verified build must still
report `BUILD SUCCESSFUL` and produce the expected APK; merely moving the Git
checkout to a shorter path is not sufficient.

Select the exact device before installation:

```powershell
$env:ANDROID_SERIAL = "<adb-serial>"
adb devices -l
```

Install only when signing compatibility and data impact are acceptable:

```powershell
corepack pnpm mobile:android:install:debug
```

Before replacing an existing installation, compare the installed APK and
candidate certificates:

```powershell
$installedApk = (adb -s <serial> shell pm path com.anybox.mobile).Trim() -replace "^package:", ""
adb -s <serial> pull $installedApk packages/mobile-app/build/device-installed.apk
$apksigner = "$env:LOCALAPPDATA\Android\Sdk\build-tools\36.0.0\apksigner.bat"
& $apksigner verify --print-certs packages/mobile-app/build/device-installed.apk
& $apksigner verify --print-certs packages/mobile-app/build/anybox-mobile-debug.apk
```

Different certificate digests plus the same package name means Android cannot
perform an in-place update. Phone-side USB installation confirmation does not
override this rule. Do not uninstall or clear data merely to make the command
pass.

Run local checks:

```powershell
corepack pnpm mobile:android:smoke:debug
corepack pnpm mobile:android:smoke:pairing
corepack pnpm mobile:android:smoke:bridge -- --url "<pairing-url-or-deep-link>"
corepack pnpm mobile:android:delivery-check -- --strict --no-manifest
```

`android:smoke:debug` clears app data unless `--keep-data` is passed.
`android:smoke:pairing` intentionally starts from clean app data. Use a
dedicated test installation for clean-state smoke.

The current launch-smoke readiness check recognizes the English `Connect` and
`Account` screens. On a localized client or when the app restores a nested
route such as Updates, a healthy launch can be reported as a failure. Until the
script uses stable test IDs or locale-independent resource IDs, either run this
gate in its supported locale and start route or record a manual launch check,
process check, fatal-log check, and screenshot. Never convert that manual
evidence into a claimed automated pass.

Do not fabricate screenshots or claim real-device coverage when device
installation or smoke did not run.

## Gate 3: Classify the Change

Run:

```powershell
corepack pnpm mobile:fingerprint:check
```

Before trusting the result, verify fingerprint portability: the same commit,
lockfile, package manager version, and native inputs must produce the same hash
from two different checkout paths. If they do not, the fingerprint source still
contains environment-specific paths or autolinking output. Treat classification
as blocked, use a fixed canonical release workspace temporarily, and fix the
normalization before production OTA.

Never run `mobile:fingerprint:record -- --replace` merely to silence a mismatch.
A replacement baseline is valid only after a reviewed native change and a new
APK version, or after a reviewed normalization fix whose cross-worktree test
passes.

Use OTA only when the native fingerprint still matches the recorded baseline.
Typical OTA-safe changes include React code, styling, translations, business
logic, and JavaScript assets.

Publish a new APK when the native fingerprint changes or the change touches
permissions, native dependencies, Expo or React Native versions, native
modules, package identity, scheme, signing, update source, or app metadata.

When uncertain, use an APK. Never force an OTA around a fingerprint mismatch.

## OTA Preview and Production

Start from a committed, scoped-clean source tree.

Ensure a physical test client is subscribed to `preview`. A local
production-signed preview shell can be built and installed without publishing:

```powershell
corepack pnpm mobile:android:build:release -- --channel preview
adb -s <serial> install -r packages/mobile-app/build/anybox-mobile-release.apk
```

This replaces the installed app with the same package name, so confirm signing
and device-data implications first.

Publish the immutable OTA to preview:

```powershell
corepack pnpm mobile:update:preview -- --message "Describe the update"
```

Record the printed `updateId`. On the preview device, verify that exact
`updateId`, cold start, foreground/background behavior, networking, and the
affected product flows.

Promote only that immutable update:

```powershell
corepack pnpm mobile:update:promote -- --update-id <update-id>
```

Do not rebuild between preview and promotion. Promotion must move the channel
pointer to the already-tested update.

Emergency rollback:

```powershell
corepack pnpm mobile:update:rollback -- --channel production --embedded
```

Preview is channel-scoped, not device-scoped. It affects every compatible
client subscribed to preview. A strict one-device preview requires a server
allowlist or authenticated device-scoped routing.

## Native APK Candidate and Production

Before a native release, update all of:

- `packages/mobile-app/app.json` `expo.version`
- `packages/mobile-app/app.json` `expo.android.versionCode`
- `packages/mobile-app/package.json` `version`
- `packages/mobile-app/app.json` `expo.ios.buildNumber` when mobile versions
  should remain aligned

Require a strictly increasing Android `versionCode`.

When the native configuration is final, record the new compatibility baseline:

```powershell
corepack pnpm mobile:fingerprint:record
```

Build a production-signed candidate locally:

```powershell
corepack pnpm mobile:android:build:release -- --channel production
```

Install it on a physical device and test upgrade data preservation, cold start,
permissions, pairing, authentication, and updater behavior:

```powershell
adb -s <serial> install -r packages/mobile-app/build/anybox-mobile-release.apk
```

The one-command production path is:

```powershell
corepack pnpm mobile:release:publish -- --notes "Release note"
```

It requires a clean source tree and a physical device, builds the production
APK, runs device smoke, creates the `mobile-v*` GitHub release, uploads
immutable GitHub and CDN assets, and changes the fixed production pointer last.

Never mark a mobile GitHub release as latest. Never use `releases/latest` for
mobile discovery.

The GitHub asset preparation step is local and can be validated without
creating a release:

```powershell
corepack pnpm mobile:release:github:prepare -- `
  --apk packages/mobile-app/build/anybox-mobile-release.apk `
  --out-dir packages/mobile-app/build/github-release-feasibility `
  --notes "Local feasibility validation"
```

It must produce `anybox-mobile.apk`, `anybox-mobile-release.json`, and
`anybox-mobile-release.json.sig`. Verify the APK hash in the manifest and its
detached signature locally. Do not run the printed `gh release create` command
unless publication was explicitly authorized.

Asset preparation proves manifest construction and signing; it does not prove
that the supplied APK was built from the current commit. Before treating the
output as a release candidate, independently verify APK freshness, source
commit, version, certificate, native fingerprint, and byte identity.

## Post-Release Verification

Use a production-channel client and follow the user path:

- discover the OTA or APK release;
- verify signed manifest status;
- download through the public CDN or GitHub fallback;
- install or reload;
- verify version, build number, update ID, and retained data;
- repeat the critical product flows;
- inspect update diagnostics and fatal Android logs.

An OTA can roll back to the embedded bundle. A native APK cannot safely roll
back by decreasing `versionCode`; fix it with another, higher-version APK.

## Device Strategy

Prefer, in order:

1. a dedicated physical Android test device using the real production package
   identity for maximum fidelity;
2. one personal phone with a separate development package for daily iteration,
   followed by a production-signed candidate gate;
3. Expo Go for fast JavaScript feedback, followed by standalone and signed
   device gates.

A development package is operational isolation, not proof that the production
package, scheme, signing, self-update, or upgrade path works.

## Manual Device Checklist

Verify at least:

- first install, cold start, force-stop, and restart;
- upgrade over the previous public version with data retained;
- registration, login, token refresh, and logout;
- camera permission, QR scan, pasted links, and deep links;
- relay and LAN pairing;
- offline, reconnect, background, and foreground behavior;
- workspaces, chats, streaming messages, tasks, approvals, and files;
- update check, OTA reload, APK download, and unknown-app install permission;
- version, package, channel, update ID, and diagnostic display;
- fatal Android logs.

## Feasibility Validation Without Publishing

Validate the workflow in this order:

1. Inspect `git status`, mobile config, configured versions, and connected
   devices.
2. Run doctor, typecheck, Expo dependency check, and focused tests.
3. Run `mobile:fingerprint:check`.
   If it fails unexpectedly, repeat the same commit in another checkout before
   classifying the change or replacing the baseline.
4. Run delivery check with `--no-manifest` to expose stale or missing
   evidence.
5. Rebuild the debug APK. On Windows, use a checkout-specific short pnpm
   virtual store if Ninja repeatedly regenerates `build.ninja`.
6. Re-run delivery check.
7. Compare installed and candidate package names, versions, and signing
   certificates before installation.
8. Install and smoke only when the selected device and data effects are
   acceptable.
9. Validate preview and production publisher guards with tests and source
   inspection. Local GitHub asset preparation is allowed; do not invoke
   external publication commands merely to prove they exist.
10. Report every skipped physical-device or external-publication gate
    explicitly.

## Known Workflow Gaps

`mobile:release:publish` rebuilds the APK immediately before device smoke and
publication. A separately hand-tested APK is therefore not guaranteed to be
the byte-identical file later uploaded.

`mobile:release:github:prepare` also accepts a caller-supplied APK without a
source-commit attestation. Its success alone is not a candidate-integrity gate.

For extended manual release-candidate testing, add a two-phase workflow:

```text
mobile:release:candidate
  -> build, sign, verify, and record commit/hash/certificate/version/fingerprint

mobile:release:publish -- --candidate <record>
  -> re-verify and upload the exact recorded files without rebuilding
```

Do not claim this candidate command exists until it is implemented and tested.

The launch-smoke script also needs locale-independent readiness selectors and a
deterministic start route. Until implemented, localized or restored nested
screens require explicitly labeled manual evidence.
