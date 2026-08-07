# Computer Use Windows release procedure

The released plugin archive is the complete Computer Use product unit. It must
contain the Skill, JavaScript client/runtime, native helper, adjacent helper
digest, and documentation. No Computer Use runtime artifact may be copied into
the Anybox Agent or Desktop package.

## Required order

1. Build the native helper from a clean checkout.
2. Sign `computer-use-helper.exe` with the Anybox Authenticode certificate and
   a trusted timestamp.
3. Generate `computer-use-helper.sha256` after signing.
4. Run the plugin package verifier and plugin tests.
5. Run the Agent integration proving generic Node REPL loads the installed
   plugin directly and that no retired Computer Use server is registered.
6. Build the Desktop Agent runtime and run its generic Node REPL smoke test.
7. Generate the plugin archive digest, SBOM, and provenance in release CI.

Signing after hash generation is invalid because Authenticode changes the EXE.

## Helper build and package

```powershell
pwsh.exe -NoProfile -ExecutionPolicy Bypass `
  -File scripts/package-helper.ps1
```

Insert the organization signing step between `dotnet publish` and the final
copy/hash step, or perform the same order in CI. Do not hand-edit the digest.

Validate an already assembled plugin package:

```powershell
pwsh.exe -NoProfile -ExecutionPolicy Bypass `
  -File scripts/package-helper.ps1 -Check

$env:ANYBOX_COMPUTER_USE_REQUIRE_SIGNATURE = '1'
node scripts/verify-package.mjs
Remove-Item Env:ANYBOX_COMPUTER_USE_REQUIRE_SIGNATURE
```

`verify-package.mjs` checks version agreement, helper digest, plugin-owned
broker handshake, capabilities, and health. In release mode the helper client
also requires Authenticode status `Valid` before spawn.

## Mandatory tests

```powershell
# Plugin contracts, policy, state, helper protocol, and direct runtime
$tests = (Get-ChildItem tests -Filter '*.test.mjs' -File).FullName
node --test $tests

# Native overlay state machine and interactive Win32 invariants
dotnet test helper/ComputerUse.Helper.Tests/ComputerUse.Helper.Tests.csproj `
  -c Release

# Controlled Windows fixtures
node scripts/smoke-wgc.mjs
node scripts/smoke-uia.mjs
node scripts/smoke-app-catalog.mjs
node scripts/smoke-safety.mjs

# Agent Manager → generic Node REPL → installed plugin → plugin helper
Set-Location ..\..\..\packages\anyboxagent
bun test Test/computer-use-plugin-node-repl-integration.test.ts `
  Test/retired-computer-use-builtin.test.ts `
  Test/node-repl-mcp.test.ts `
  Test/permission.test.ts `
  Test/plugin.test.ts

# Packaged Agent must contain Node REPL and no Computer Use runtime
Set-Location ..\desktop
corepack pnpm run build:agent-runtime
node scripts/smoke-node-repl-runtime.mjs
```

The release workstation matrix must additionally cover Windows 11 x64 at
100%, 125%, 150%, and 200% scale; multiple displays; obscured/minimized
windows; lock/unlock; device loss; integrity mismatch; physical Escape during
observation/action; and plugin install, upgrade, downgrade, disable, and
uninstall. Overlay inspection must cover its localized notice, light/dark/high
contrast palettes, reduced-effects behavior, segmented status-pill layout,
one window per display, topmost/no-activate/click-through styles,
taskbar/catalog exclusion, capture exclusion, 700 ms normal cleanup, and
immediate physical-Escape cleanup.

Record results in `docs/computer-use-windows-development-progress.md`.
