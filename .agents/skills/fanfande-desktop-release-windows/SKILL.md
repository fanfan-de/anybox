---
name: fanfande-desktop-release-windows
description: Build, package, version, tag, push, publish Fanfande Studio desktop releases from the fanfande_studio workspace, and optionally sync installer assets to a Tencent Cloud COS/CDN domestic download mirror. Use when Codex is asked to update the desktop app version, create a Windows installer, run release checks, publish an Electron/electron-builder GitHub Release, upload installers to Tencent Cloud, fix GH_TOKEN publishing failures, or verify auto-update artifacts such as latest.yml, blockmap files, and installer assets.
---

# Fanfande Desktop Release

Use this skill for the `C:\Projects\fanfande_studio` Electron desktop release path. The desktop package is `packages/desktop`; its version controls the installer and auto-updater release metadata. The root package version is not the desktop release version unless the user explicitly asks to align it.

## Release Map

- Desktop package: `packages/desktop/package.json`
- Builder config: `packages/desktop/electron-builder.yml`
- Release command: `corepack pnpm dist:publish`
- Local package command: `corepack pnpm dist`
- Installer output: `packages/desktop/dist`
- GitHub Release target: `fanfan-de/fanfande_studio`
- Auto-update metadata: `packages/desktop/dist/latest.yml`
- Domestic download mirror, when configured: Tencent Cloud COS + CDN, usually exposed through a download domain such as `https://download.anybox.com.cn`
- Tencent upload config: `.env.downloads` at the workspace root; never commit this file

This is a GitHub Release publishing flow, not `npm publish`.

## Before Editing

1. Run `git status --short --branch` from the workspace root and preserve unrelated user changes.
2. Read `packages/desktop/package.json` and `packages/desktop/electron-builder.yml` before advising or acting.
3. Confirm the intended version if the user did not specify one. If they say "next version", use a conservative patch bump from `packages/desktop/package.json`.
4. Do not ask the user to paste a token into chat. If GitHub publishing is needed, instruct them to set `GH_TOKEN` in their shell or verify that it is already set.
5. If a domestic download mirror is requested, read the repo's upload script, package scripts, and download-site configuration before uploading. Prefer an existing scripted uploader over manual browser uploads.

## Version Bump

From the workspace root, bump the desktop package version:

```powershell
cd C:\Projects\fanfande_studio\packages\desktop
npm pkg set version=0.1.2
cd ..\..
```

Replace `0.1.2` with the target version. Re-read `packages/desktop/package.json` after the edit.

## Dependency Prep

Use the package managers already used by the repo:

```powershell
cd C:\Projects\fanfande_studio
corepack enable
corepack pnpm install

cd packages\fanfandeagent
bun install
cd ..\..
```

`packages/desktop/scripts/prepare-agent-runtime.mjs` needs Bun and `packages/fanfandeagent/node_modules/node-pty`; missing Bun or `node-pty` means the managed agent runtime cannot be bundled.

## Official Connector Config

Official desktop release builds must inject Anybox-managed connector client metadata at build time. For Gmail OAuth, set `ANYBOX_GMAIL_OAUTH_CLIENT_ID` and `ANYBOX_GMAIL_OAUTH_CLIENT_SECRET` in the same shell or CI job before running `dist` or `dist:publish`:

```powershell
$env:ANYBOX_GMAIL_OAUTH_CLIENT_ID="1234567890-example.apps.googleusercontent.com"
$env:ANYBOX_GMAIL_OAUTH_CLIENT_SECRET="GOCSPX-example"
corepack pnpm dist
```

For GitHub publishing, set both release environment variables in the same session:

```powershell
$env:ANYBOX_GMAIL_OAUTH_CLIENT_ID="1234567890-example.apps.googleusercontent.com"
$env:ANYBOX_GMAIL_OAUTH_CLIENT_SECRET="GOCSPX-example"
$env:GH_TOKEN="..."
corepack pnpm dist:publish
```

These values are release/build configuration managed by Anybox, not plugin configuration and not end-user configuration. Do not ask ordinary users to create Google Cloud OAuth clients or set these variables. Google Desktop OAuth clients may require `client_secret` at token exchange even when PKCE is used; treat the secret as Google client metadata for official builds, not as a user-entered plugin secret.

Open-source or local developer builds may omit these variables; in that case the Gmail connector can remain unavailable unless the developer provides a local override. Do not commit generated `build/agent-runtime/config/connectors.json`.

## Checks

Run the standard desktop checks before packaging:

```powershell
cd C:\Projects\fanfande_studio
corepack pnpm typecheck
corepack pnpm test
```

If the release includes agent/server changes, also run:

```powershell
cd C:\Projects\fanfande_studio\packages\fanfandeagent
bun run test:server
cd ..\..
```

If checks fail, stop and report the failing command and relevant error. Do not publish a release after failed checks unless the user explicitly overrides.

## Local Packaging

Create a local Windows installer without publishing:

```powershell
cd C:\Projects\fanfande_studio
corepack pnpm dist
```

Inspect the newest files in `packages/desktop/dist`. A normal Windows release has:

- `Fanfande Studio-<version>-x64.exe`
- `Fanfande Studio-<version>-x64.exe.blockmap`
- `latest.yml`
- `win-unpacked/`

Open `latest.yml` and verify its `version`, `path`, `files[].url`, `sha512`, and `size`. If publishing manually, the release asset names must match `latest.yml`; otherwise auto-update can fail.

## Git Push And Tag

Installer assets are release artifacts and normally should not be committed. Commit the version/config/source changes only:

```powershell
cd C:\Projects\fanfande_studio
git status --short
git add packages\desktop\package.json pnpm-lock.yaml
git commit -m "chore: release v0.1.2"
git tag v0.1.2
git push origin master
git push origin v0.1.2
```

Adjust the branch name if the current branch is not `master`. Do not stage unrelated files such as local databases, generated notes, or old installer outputs.

## Publish To GitHub Release

`dist:publish` requires a GitHub Personal Access Token in the same PowerShell session. Official release builds that include Gmail OAuth also require `ANYBOX_GMAIL_OAUTH_CLIENT_ID` and `ANYBOX_GMAIL_OAUTH_CLIENT_SECRET` in that same session:

```powershell
$env:ANYBOX_GMAIL_OAUTH_CLIENT_ID="1234567890-example.apps.googleusercontent.com"
$env:ANYBOX_GMAIL_OAUTH_CLIENT_SECRET="GOCSPX-example"
$env:GH_TOKEN="..."
corepack pnpm dist:publish
```

Recommended token scopes:

- Public repo with classic PAT: `public_repo`
- Private repo with classic PAT: `repo`
- Fine-grained token: select `fanfan-de/fanfande_studio`, grant `Contents: Read and write`

Never store `GH_TOKEN` in repo files. On Windows PowerShell, `$env:GH_TOKEN=...` is session-scoped; a new terminal window needs it again.

## Publish To Tencent COS/CDN Mirror

Use the Tencent COS/CDN mirror after the GitHub Release is published or after the local installer is known-good. The mirror is for faster China downloads from the official website. Keep GitHub Releases as the canonical open-source/foreign fallback unless the user explicitly asks to move auto-updates to a generic provider.

Do not treat COS upload as a replacement for the Electron GitHub Release flow:

- GitHub Release still needs the installer, `.blockmap`, and `latest.yml` for electron-updater when `electron-builder.yml` uses GitHub publishing.
- The CDN mirror normally serves the website download button and a `downloads.json` manifest.
- Do not rewrite `latest.yml` for CDN unless `electron-builder.yml` has been intentionally changed to a generic update provider and the update URL contract has been tested.

### One-time Tencent Cloud setup

Before relying on the mirror, confirm these Tencent Cloud resources exist:

1. COS bucket in the target region, for example `ap-shanghai`.
2. CDN domain, for example `download.anybox.com.cn`, pointing at the COS origin.
3. DNS CNAME from the download domain to Tencent CDN.
4. HTTPS certificate bound to the CDN domain.
5. CDN cache rules:
   - installers and blockmaps: long cache, for example `public, max-age=31536000, immutable`;
   - `downloads.json`: short cache or no cache, for example `public, max-age=60`.
6. CORS for the manifest if the official site is on another origin:

```text
Access-Control-Allow-Origin: https://<official-site-domain>
Access-Control-Allow-Methods: GET, HEAD
```

### Local mirror config

Keep Tencent credentials out of chat and out of git. Store them in `.env.downloads` at the workspace root and make sure `.gitignore` excludes it:

```env
DOWNLOAD_BASE_URL=https://download.anybox.com.cn
TENCENT_COS_SECRET_ID=...
TENCENT_COS_SECRET_KEY=...
TENCENT_COS_BUCKET=...
TENCENT_COS_REGION=ap-shanghai
```

Use the exact environment variable names expected by the repo's upload script. Some shared scripts may use a product-prefixed base URL such as `ANYBOX_DOWNLOAD_BASE_URL`; read the script before running it and do not invent new names during a release.

### Required uploader behavior

The upload must be repeatable from the command line. If the repo does not already have a `downloads:publish` or equivalent script, add or port one before using browser-console uploads for production releases.

The uploader should:

- detect or accept the Windows installer path, especially when the file name contains spaces such as `Fanfande Studio-<version>-x64.exe`;
- compute `sha256` and `sizeBytes`;
- upload immutable assets under a versioned key such as `releases/v<version>/<file>`;
- upload `downloads.json` at a stable key such as `downloads.json`;
- set uploaded COS objects to `public-read`, or otherwise ensure the CDN can read them;
- include `fallbackUrl` pointing to the matching GitHub Release;
- never upload `.env.downloads`, tokens, local databases, or unrelated generated files.

If using Tencent COS REST signing directly, remember that any uploaded ACL header must be part of the signed headers. For `x-cos-acl: public-read`, sign both `host` and `x-cos-acl`; otherwise COS can reject the upload or the CDN can later see private objects as `403`.

Example scripted flow, adjust names to the repo's actual scripts:

```powershell
cd C:\Projects\fanfande_studio
corepack pnpm downloads:publish -- --env-file .env.downloads --require windows
```

If auto-detection does not find the installer, pass it explicitly:

```powershell
corepack pnpm downloads:publish -- `
  --env-file .env.downloads `
  --windows "packages\desktop\dist\Fanfande Studio-0.1.2-x64.exe" `
  --require windows
```

The expected manifest shape is product-specific, but it should at least let the website prefer CDN and fall back to GitHub:

```json
{
  "version": "v0.1.2",
  "platforms": {
    "windows": {
      "url": "https://download.anybox.com.cn/releases/v0.1.2/Fanfande%20Studio-0.1.2-x64.exe",
      "fallbackUrl": "https://github.com/fanfan-de/fanfande_studio/releases/tag/v0.1.2",
      "fileName": "Fanfande Studio-0.1.2-x64.exe",
      "sha256": "...",
      "sizeBytes": 123456789,
      "version": "v0.1.2"
    }
  }
}
```

### Mirror verification

After uploading, verify the CDN domain from the terminal, not only from the Tencent console:

```powershell
curl.exe -I --max-time 30 https://download.anybox.com.cn/downloads.json
curl.exe -sS --max-time 30 https://download.anybox.com.cn/downloads.json
curl.exe -I --max-time 30 "https://download.anybox.com.cn/releases/v0.1.2/Fanfande%20Studio-0.1.2-x64.exe"
```

Passing signs:

- `downloads.json` returns `HTTP/1.1 200 OK`;
- HTTPS does not fail with certificate-name errors such as `SEC_E_WRONG_PRINCIPAL`;
- installer URL returns `200 OK`, a non-zero `Content-Length`, and an installer content type such as `application/vnd.microsoft.portable-executable`;
- manifest `url` points at the CDN domain and `fallbackUrl` points at GitHub;
- the official website's download button uses the manifest URL, for example `VITE_DOWNLOAD_MANIFEST_URL=https://download.anybox.com.cn/downloads.json`.

Common Tencent mirror failures:

- `403` from CDN/COS: object is private or CDN origin access is not authorized; fix object ACL or origin permissions, then re-upload.
- HTTPS certificate mismatch: CDN HTTPS certificate is missing or bound to the wrong domain; bind the certificate for the exact download domain.
- Manifest works over HTTP but fails over HTTPS: CDN HTTPS is not enabled or the certificate deployment is still pending.
- Website still downloads from GitHub: site build lacks the manifest URL env var, manifest fetch failed due CORS, or the platform entry is missing from `downloads.json`.

## Common Failure

If publishing fails with:

```text
GitHub Personal Access Token is not set, neither programmatically, nor using env "GH_TOKEN"
```

The package build may already have succeeded. Check `packages/desktop/dist` for the new installer and `latest.yml`, then tell the user to set `GH_TOKEN` in the same shell and rerun. For official Gmail-enabled builds, include `ANYBOX_GMAIL_OAUTH_CLIENT_ID` and `ANYBOX_GMAIL_OAUTH_CLIENT_SECRET` again because a rerun may rebuild the managed agent runtime:

```powershell
$env:ANYBOX_GMAIL_OAUTH_CLIENT_ID="1234567890-example.apps.googleusercontent.com"
$env:ANYBOX_GMAIL_OAUTH_CLIENT_SECRET="GOCSPX-example"
$env:GH_TOKEN="..."
corepack pnpm dist:publish
```

If the user wants to avoid a rebuild, they may upload the generated installer, `.blockmap`, and `latest.yml` to the GitHub Release manually, but verify that `latest.yml` references the exact published asset names.

## Final Verification

After publishing:

1. Confirm the GitHub Release exists for the matching tag/version.
2. Confirm the release contains the installer, `.blockmap`, and `latest.yml`.
3. Confirm `latest.yml` points to the same installer asset name and version.
4. If the Tencent mirror is part of the release, confirm `https://download.anybox.com.cn/downloads.json` and the installer CDN URL both return `200 OK` over HTTPS.
5. Report the exact installer path, GitHub Release URL, and CDN download URL if known.
