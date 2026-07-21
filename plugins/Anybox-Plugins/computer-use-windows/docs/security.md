# Computer Use security and privacy

## Security objective

The plugin may observe only an explicitly approved application during the
active Agent turn and may act only from a just-observed window state. One state
permits one explicit action. Physical input, window or desktop changes, turn
completion, reset, transport close, or physical Escape invalidates control.

Skill instructions improve model behavior but are not a security boundary.
Enforcement is split between plugin JavaScript, the plugin-owned native helper,
and Anybox's business-neutral permission display/continuation service.

## Ownership and isolation

- Anybox core contains no Computer Use tool definitions, operation router,
  helper transport, target policy, app decisions, telemetry, or settings UI.
- The generic Node REPL supplies JavaScript execution, request metadata,
  permission continuation, image emission, and lifecycle hooks only.
- The plugin constructs every permission title, summary, risk, and redacted
  detail. The permission engine does not interpret Computer Use arguments.
- The helper path is resolved relative to the installed plugin. Its SHA-256 is
  verified before every spawn; release environments may require Authenticode
  status `Valid` with `ANYBOX_COMPUTER_USE_REQUIRE_SIGNATURE=1`.
- The helper pipe uses a random name, current-user ACL, one client, a one-time
  256-bit token, an 8 MiB frame limit, parent PID validation, and connected
  client PID validation.
- Plugin lifecycle hooks close the helper and erase window/state mappings at
  turn end, session end, REPL reset, and transport close.

## Enforced invariants

- The first screenshot/UIA observation for an application in a turn requires
  a one-time generic plugin-action decision.
- Every launch or input operation requires another one-time decision. At most
  one state-changing operation may be claimed per submitted JavaScript snippet.
- `auth_or_secret`, `finance`, and `security_settings` are hard denied before a
  prompt. High-impact intent remains prominently described in approval UI.
- Window identity includes HWND, PID, process start time, root owner,
  executable identity, session, and integrity level. HWND reuse does not
  preserve trust.
- State is short-lived, one-action, window-bound, screenshot-bound, and UIA
  revision-bound. Bounds, DPI, tree, or physical-input changes invalidate it.
- The target must be foreground and each coordinate must still belong to the
  selected window. Elevated targets, non-input desktops, and lock/secure
  desktops are rejected.
- Synthetic input carries a per-helper marker. Unmarked keyboard or mouse
  input advances the physical-input epoch and invalidates old state.
- Password UIA values are never read. Typing or setting a password element is
  blocked.
- Clipboard paste is sequence-aware. The helper restores its saved value only
  if no user or application write replaced the temporary value.
- Physical Escape terminates the helper and blocks further plugin operations
  until the next turn.

## Blocked targets

Plugin policy and the helper reject:

- Anybox, Codex, ChatGPT, and the Computer Use helper itself;
- terminals, shells, consoles, WSL, and command interpreters;
- password managers and credential UI;
- UAC, Windows Security, security/privacy permission dialogs, and lock screens;
- higher-integrity processes;
- CAPTCHA, browser certificate/privacy warnings, and known deceptive-site
  interstitials;
- finance/payment and authentication-secret flows.

This is defense in depth. Stable executable/app identity and native window
checks remain authoritative; a process title alone never grants trust.

## Privacy

Screenshots are emitted through the generic Node REPL image API. Structured
results do not duplicate screenshot base64. Native window handles, executable
paths, state references, and helper launch selectors remain private to the
plugin runtime.

Permission descriptions do not contain screenshot pixels, UIA text, document
text, selected text, clipboard data, or typed/assigned values. `type_text` and
`set_value` payloads are reduced to character counts.

## Known limitations

- Desktop input requires an active, unlocked interactive desktop.
- Window capture does not make input background automation; the chosen window
  is activated and revalidated before input.
- UI Automation quality depends on the target application. Coordinate fallback
  remains bound to a fresh screenshot and point-ownership check.
- Windows foreground policy, modal dialogs, protected processes, and integrity
  mismatches can make a valid request fail safely.
- DPI, multi-monitor, lock-screen, and graphics-device-loss cases remain part
  of the Windows release hardware matrix.
- The checked-in development helper is hash-verified but unsigned. A production
  package must be signed before its adjacent digest is generated.

## Incident response

If control behaves unexpectedly:

1. Press physical Escape.
2. End the current Agent turn or reset Node REPL state.
3. Disable or uninstall the plugin. For a global startup stop, set
   `ANYBOX_COMPUTER_USE_DISABLED=1` before restarting Anybox.
4. Do not attach screenshots, UIA content, typed text, or clipboard content to
   an issue report.
