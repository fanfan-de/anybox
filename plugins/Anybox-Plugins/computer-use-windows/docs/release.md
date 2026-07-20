# Computer Use Windows release procedure

## Required order

1. Build the native helper from a clean checkout.
2. Sign `computer-use-helper.exe` with the Anybox Authenticode code-signing
   certificate and a trusted timestamp.
3. Generate `computer-use-helper.sha256` **after** signing.
4. Run the helper package verifier and all plugin/Agent/Desktop tests.
   Confirm the plugin package includes `scripts/computer-use-client.mjs`, the
   `sky` API docs, and the Node REPL + Computer Use dual requirements.
5. Build the managed Agent runtime.
6. Verify its Computer Use manifest, CycloneDX SBOM, in-toto/SLSA provenance,
   and Authenticode status with the release-strict gate.
7. Build/sign the desktop installer and retain its artifact digest.

Signing after hash generation is invalid because Authenticode changes the EXE.

## Helper build and package

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File scripts/package-helper.ps1
```

For a production release, insert the organization signing step between the
script's `dotnet publish` output and its copy/hash step, or provide an equivalent
CI stage that signs first and hashes second. Do not hand-edit the hash file.

Validate the package without rebuilding:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File scripts/package-helper.ps1 -Check
```

## Runtime supply-chain gate

From `packages/desktop`:

```powershell
corepack pnpm run build:agent-runtime
node scripts/verify-agent-runtime.mjs --release-strict
```

On Windows, release-strict requires:

- helper digest matches its adjacent SHA-256 manifest;
- runtime `manifest.json` matches all declared artifact sizes/digests;
- CycloneDX file components match the manifest;
- in-toto/SLSA subjects match the manifest;
- source materials contain valid SHA-256 values;
- Authenticode status is exactly `Valid`.

An unsigned development helper should fail this command with an Authenticode
error. Do not bypass that error for a production artifact.

The packaged Windows Desktop also forces
`ANYBOX_COMPUTER_USE_REQUIRE_SIGNATURE=1` in its managed Agent environment. At
runtime the Agent checks the adjacent SHA-256 first and then accepts only
Authenticode status `Valid` before spawning or restarting the helper. Source
development does not force this flag so the checked-in unsigned development
helper remains testable.

## Mandatory tests

```powershell
# Plugin contract and helper protocol
$tests = (Get-ChildItem tests -Filter '*.test.mjs' -File).FullName
node --test $tests

# Controlled Windows fixtures
node scripts/smoke-wgc.mjs
node scripts/smoke-uia.mjs
node scripts/smoke-app-catalog.mjs
node scripts/smoke-safety.mjs

# Agent Node REPL → plugin sky → host facade integration
Set-Location ..\..\..\packages\anyboxagent
bun test Test/computer-use-node-repl-integration.test.ts
```

The release workstation matrix must additionally cover:

- Windows 11 x64 at 100%, 125%, 150%, and 200% scale;
- primary and negative-coordinate secondary displays;
- obscured/minimized windows;
- lock/unlock and non-input desktop rejection;
- graphics device loss/recovery;
- medium helper versus higher-integrity target;
- physical Escape during observation and action;
- installation, project selection, diagnostics, upgrade, downgrade, and
  uninstall while preserving user tool/app decisions.

Record results in `docs/computer-use-windows-development-progress.md`.
