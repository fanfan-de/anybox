# Anybox Computer Use for Windows

Anybox Computer Use is a self-contained Windows desktop-control plugin. It
discovers applications and windows, captures one selected window with Windows
Graphics Capture, inspects a bounded UI Automation tree, and sends guarded
mouse or keyboard input from a fresh one-action state.

The current plugin version is `0.3.4`. The bundled native helper component is
version `0.2.2`. The supported release target is Windows
11 x64.

## Ownership boundary

Computer Use is implemented entirely by this plugin package:

- `scripts/computer-use-client.mjs` installs the model-facing `sky` API and
  owns per-turn window mappings, risk-based action approval, image
  emission, and lifecycle cleanup.
- `scripts/runtime.cjs` owns the Computer Use operation dispatcher, policy,
  state registry, window registry, and helper calls.
- `scripts/lib/helper-client.js` verifies and starts the helper shipped in this
  package, then communicates over a private current-user named pipe.
- `helper/win32-x64/computer-use-helper.exe` owns the native per-display safety
  overlay, Windows capture, UIA, final target validation, and input injection.
- `skills/computer-use/SKILL.md` teaches the Agent how to load and operate the
  plugin API.

There is no Computer Use MCP server, no Agent-side Computer Use facade or
broker, and no Desktop-owned Computer Use overlay or settings surface. The
plugin Helper draws its own native safety overlay. Installing or uninstalling
this package adds or removes the feature itself.

The manifest depends only on Anybox's general-purpose Node REPL. That runtime
provides persistent JavaScript state and generic services such as
`requestPermission`, `emitImage`, request metadata, and lifecycle hooks. It has
no Computer Use operation list, policy, helper path, or native protocol.

## Native safety overlay

The Helper owns a dedicated STA UI thread and one transparent native window per
active display. Each window is topmost, non-activating, mouse-transparent,
hidden from the taskbar and Computer Use catalogs, and excluded from capture.
Display/DPI changes rebuild the registered window set. Only those exact HWNDs
are ignored during point-ownership checks; every other occluding window remains
blocking.

The visual treatment follows the Codex Windows overlay: a compact, segmented
status pill sits below the top edge while a blue edge treatment gently pulses
around each display. The status text carries a restrained shimmer when Windows
UI effects are enabled. Light, dark, reduced-effects, and high-contrast modes
remain independently legible.

Overlay availability is a protocol capability and a hard precondition for
desktop access. Creation, show, display synchronization, or capture-exclusion
failure returns `CU_OVERLAY_UNAVAILABLE` and terminates the current Computer Use
session. There is no production disable switch.

## Runtime flow

1. The Agent imports `scripts/computer-use-client.mjs` inside the persistent
   Node REPL and receives the plugin-owned `sky` API.
2. The plugin verifies the packaged helper SHA-256 and, when required by the
   release environment, its Authenticode signature.
3. The plugin starts the helper with a random pipe name and one-time token.
4. The helper restricts the pipe to the current user and validates the parent
   and connected client process IDs.
5. During initialization the helper creates and validates one hidden native
   overlay window per active display. Before any desktop observation or
   control, it synchronously shows a blue edge treatment and a segmented
   “Press Esc to stop” status pill.
6. Routine observation and ordinary local interaction run directly without a
   plugin approval prompt.
7. Send/submit, delete, upload, and install actions receive a separate,
   parameter-sensitive, one-time approval. Typed text and assigned values are
   redacted.
8. The helper revalidates the window, state, DPI, foreground, point ownership,
   integrity level, desktop state, and physical-input epoch immediately before
   input.
9. `end_turn` keeps the notice visible for at least 700 ms and hides it before
   the plugin stops the Helper. Physical Escape hides it immediately.

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

Anybox Node REPL executes submitted code as an async function body. Agent code
must explicitly `return` every value it needs to inspect; bare expressions run
but produce a `null` tool result. Reusable app, window, and state handles should
be stored on `globalThis` between calls.

Native `windowRef` and `stateRef` values never enter the public `sky` surface.
A state expires after 30 seconds and can authorize at most one action,
including a failed action. The plugin permits at most one state-changing
operation per submitted JavaScript snippet.

## User controls

- Screenshots, bounded UIA state, pre-existing app launch/activation, and
  `normal` local actions run without a plugin approval prompt.
- Send/submit, delete, upload, and install actions ask separately at the action
  boundary.
- `auth_or_secret`, `finance`, and `security_settings` actions are rejected
  before any approval prompt.
- Press physical **Esc** to stop the helper and fuse this plugin for the rest
  of the active turn.
- The blue border is a safety indicator, not an authorization grant. It cannot
  be disabled in production and never relaxes approval or hard-deny policy.
- Set `ANYBOX_COMPUTER_USE_DISABLED=1` to disable the plugin runtime, or use
  `ANYBOX_COMPUTER_USE_DENY_APP_IDS` for additional stable app-ID deny entries.

## Development verification

From this directory:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File scripts/package-helper.ps1 -Check

$tests = (Get-ChildItem tests -Filter '*.test.mjs' -File).FullName
node --test $tests

dotnet test helper/ComputerUse.Helper.Tests/ComputerUse.Helper.Tests.csproj `
  -c Release

node scripts/smoke-wgc.mjs
node scripts/smoke-uia.mjs
node scripts/smoke-app-catalog.mjs
node scripts/smoke-safety.mjs
```

See [Security and privacy](docs/security.md) and
[Release procedure](docs/release.md) before distribution.
