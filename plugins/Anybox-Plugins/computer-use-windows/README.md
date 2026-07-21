# Anybox Computer Use for Windows

Anybox Computer Use is a self-contained Windows desktop-control plugin. It
discovers applications and windows, captures one selected window with Windows
Graphics Capture, inspects a bounded UI Automation tree, and sends approved
mouse or keyboard input from a fresh one-action state.

The current plugin version is `0.3.0`. The bundled native helper component is
version `0.2.0`. The supported release target is Windows
11 x64.

## Ownership boundary

Computer Use is implemented entirely by this plugin package:

- `scripts/computer-use-client.mjs` installs the model-facing `sky` API and
  owns per-turn window mappings, observation approval, action approval, image
  emission, and lifecycle cleanup.
- `scripts/runtime.cjs` owns the Computer Use operation dispatcher, policy,
  state registry, window registry, and helper calls.
- `scripts/lib/helper-client.js` verifies and starts the helper shipped in this
  package, then communicates over a private current-user named pipe.
- `helper/win32-x64/computer-use-helper.exe` owns native Windows capture, UIA,
  final target validation, and input injection.
- `skills/computer-use/SKILL.md` teaches the Agent how to load and operate the
  plugin API.

There is no Computer Use MCP server, no Agent-side Computer Use facade or
broker, and no dedicated Desktop Computer Use settings surface. Installing or
uninstalling this package adds or removes the feature itself.

The manifest depends only on Anybox's general-purpose Node REPL. That runtime
provides persistent JavaScript state and generic services such as
`requestPermission`, `emitImage`, request metadata, and lifecycle hooks. It has
no Computer Use operation list, policy, helper path, or native protocol.

## Runtime flow

1. The Agent imports `scripts/computer-use-client.mjs` inside the persistent
   Node REPL and receives the plugin-owned `sky` API.
2. The plugin verifies the packaged helper SHA-256 and, when required by the
   release environment, its Authenticode signature.
3. The plugin starts the helper with a random pipe name and one-time token.
4. The helper restricts the pipe to the current user and validates the parent
   and connected client process IDs.
5. The plugin asks through the generic permission API before exposing an
   application's screenshot/UIA state for the first time in a turn.
6. Every launch or input action receives a separate, parameter-sensitive,
   one-time approval. Typed text and assigned values are redacted.
7. The helper revalidates the window, state, DPI, foreground, point ownership,
   integrity level, desktop state, and physical-input epoch immediately before
   input.

## Plugin `sky` API

Read and observation methods:

- `list_apps`
- `list_windows`
- `get_window`
- `get_window_state`

State-changing methods:

- `launch_app`
- `activate_window`
- `click`
- `scroll`
- `press_key`
- `type_text`
- `set_value`
- `perform_secondary_action`
- `drag`

The normal operating loop is:

```text
list_apps/list_windows
→ choose one application and window
→ get_window_state
→ perform exactly one approved action
→ get_window_state again and verify
```

Native `windowRef` and `stateRef` values never enter the public `sky` surface.
A state expires after 30 seconds and can authorize at most one action,
including a failed action. The plugin permits at most one state-changing
operation per submitted JavaScript snippet.

## User controls

- The first screenshot/UIA observation of an application in each Agent turn
  asks for a one-time decision.
- Every launch or input action asks separately; observation approval never
  implies action approval.
- `auth_or_secret`, `finance`, and `security_settings` actions are rejected
  before any approval prompt.
- Press physical **Esc** to stop the helper and fuse this plugin for the rest
  of the active turn.
- Set `ANYBOX_COMPUTER_USE_DISABLED=1` to disable the plugin runtime, or use
  `ANYBOX_COMPUTER_USE_DENY_APP_IDS` for additional stable app-ID deny entries.

## Development verification

From this directory:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File scripts/package-helper.ps1 -Check

$tests = (Get-ChildItem tests -Filter '*.test.mjs' -File).FullName
node --test $tests

node scripts/smoke-wgc.mjs
node scripts/smoke-uia.mjs
node scripts/smoke-app-catalog.mjs
node scripts/smoke-safety.mjs
```

See [Security and privacy](docs/security.md) and
[Release procedure](docs/release.md) before distribution.
