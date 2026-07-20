# Anybox Computer Use for Windows

Anybox Computer Use is a guarded Windows desktop-control plugin. It can discover
applications and windows, capture one selected window with Windows Graphics
Capture, inspect a bounded UI Automation tree, and send approved mouse or
keyboard input from a fresh one-action state.

The current plugin version is `0.2.0`. The supported release target is Windows
11 x64. Other operating systems do not register the built-in runtime.

## Architecture

The plugin declares `mcpRequirements` dependencies on the generic
`anybox.node-repl` runtime and the hidden `anybox.computer-use` host
capability:

1. The model loads this plugin's `scripts/computer-use-client.mjs` in the
   persistent Node REPL and uses its `sky` API.
2. The generic REPL creates a short-lived plugin-capability grant bound to the
   current JavaScript tool call. It contains no Computer Use business logic.
3. The 14 low-level facade operations remain hidden from model tool discovery.
4. The Agent starts the native helper over a private, current-user named pipe.
5. Before spawn, the Agent verifies the helper SHA-256; packaged Windows builds
   additionally require a `Valid` Authenticode signature.
6. The helper verifies the Agent parent/client PID and one-time stdin token.
7. The broker requests app approval before observation or control.
8. Every input action receives a separate parameter-sensitive approval.
9. The helper revalidates the window, state, DPI, foreground, point ownership,
   integrity level, desktop state, and physical-input epoch immediately before
   input.

The plugin process never receives the pipe name, broker token, or native helper
handle.

## Plugin `sky` API

The model-facing surface is the plugin-owned `sky` object, not dedicated MCP
tools. Read-only methods:

- `list_apps`
- `list_windows`
- `get_window`
- `get_window_state`

Approved application/input methods:

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
→ select one approved application and window
→ get_window_state
→ perform exactly one approved action
→ get_window_state again and verify
```

The plugin keeps native `windowRef` and `stateRef` values private. A state
expires after 30 seconds and can authorize at most one action, including a
failed action. The host additionally permits at most one state-changing plugin
capability operation per `js` call.

## User controls

- The first access to an application asks for once, session, always, or deny.
- Persistent app approvals are visible and revocable in
  **Settings → Computer Use**.
- Every input or launch action still asks for approval; an always-allowed app
  does not imply approval for an action.
- Press physical **Esc** to interrupt the helper and fuse Computer Use for the
  rest of the active turn.
- Administrators can set `ANYBOX_COMPUTER_USE_DISABLED=1` or provide
  comma/semicolon/newline-separated stable IDs in
  `ANYBOX_COMPUTER_USE_DENY_APP_IDS`.

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
