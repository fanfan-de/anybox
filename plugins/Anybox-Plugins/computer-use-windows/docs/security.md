# Computer Use security and privacy

## Security objective

Anybox may act only on a user-approved application, using a just-observed
window state that still belongs to the same process/window instance. One state
permits one explicit action. User input, window/desktop changes, another turn,
or physical Escape must stop or invalidate control.

The skill instructions improve model behavior but are not treated as a
security boundary. Enforcement is split across the Anybox permission engine,
generic Node REPL capability bridge, host broker, plugin facade, and native
helper.

## Enforced invariants

- Only the Anybox-owned `anybox.computer-use` binding can obtain the in-process
  broker. A lookalike third-party MCP owner is not trusted.
- The model sees the generic Node REPL and plugin `sky` API, not the 14
  low-level Computer Use tools. Each `js` invocation receives a fresh 256-bit
  capability grant bound to session, turn, message, and tool-call identity;
  the grant is not exposed through public request metadata and expires when
  that invocation returns.
- Generic capability routing allows only operations selected for the current
  project/plugin. At most one non-read-only operation can be claimed per
  JavaScript invocation.
- The helper pipe uses a random name, current-user ACL, one client, a one-time
  256-bit token, an 8 MiB frame limit, parent PID validation, and connected
  client PID validation.
- Only one Agent turn may hold the global control lease. A second turn receives
  `CU_BUSY`.
- Physical Escape terminates the helper, cancels the turn, and leaves that
  lease interrupted until the turn reaches a terminal state.
- Application approval and action approval are independent. `full_access` and
  persistent app allow do not bypass either required Computer Use boundary.
- `auth_or_secret`, `finance`, and `security_settings` are hard denied.
  Delete, send, submit, upload, install, publish, purchase, and payment intent
  is raised to high risk even if the caller labels it `normal`.
- Window identity includes HWND, PID, process start time, root owner, executable
  identity, session, and integrity level. HWND reuse does not preserve trust.
- State is short-lived, one-action, window-bound, screenshot-bound, and UIA
  revision-bound. Bounds, DPI, tree, or physical input changes invalidate it.
- The target must be foreground and each coordinate must still belong to the
  selected window. Elevated targets, non-input desktops, and lock/secure
  desktops are rejected.
- Synthetic input carries a per-helper marker. Unmarked keyboard or mouse input
  advances the physical-input epoch and invalidates old state.
- Password UIA values are never read. Typing or setting a password element is
  blocked.
- Clipboard paste is sequence-aware. The helper restores its saved value only
  if no user/application write replaced the temporary value.

## Blocked targets

The facade and helper both reject:

- Anybox, Codex, ChatGPT, and the Computer Use helper itself;
- terminals, shells, consoles, WSL, and command interpreters;
- password managers and credential UI;
- UAC, Windows Security, security/privacy permission dialogs, and lock screens;
- higher-integrity processes;
- CAPTCHA, browser certificate/privacy warnings, and known deceptive-site
  interstitials;
- finance/payment and authentication-secret flows.

This is defense in depth, not a promise that a process title alone proves its
identity. Stable executable/app identity and native window checks remain
authoritative.

## Privacy and telemetry

Screenshots are returned only as MCP image content. Structured content does not
duplicate screenshot base64.

The `computer-use.security` log uses a fixed field allowlist:

- per-process HMAC summaries of session, turn, call, app, window, and state;
- tool and helper operation name;
- duration, stable result code, helper version;
- `effectMayHaveOccurred` for interrupted/timed-out actions.

It does not receive or log:

- screenshot pixels or base64;
- full window titles, paths, browser URLs, UIA trees, document or selected text;
- `type_text`/`set_value` contents, passwords, tokens, credentials, or clipboard
  content.

Approval descriptions redact typed text and assigned values to character
counts.

## Known limitations

- Desktop input requires an active, unlocked interactive desktop. Anybox does
  not automate a lock screen, UAC secure desktop, or another user session.
- Windows Graphics Capture can capture an obscured window, but this does not
  make input “background automation.” The chosen window is activated and
  revalidated before input.
- Windows foreground policy, application modal dialogs, protected processes,
  or an integrity mismatch can make a valid request fail safely.
- UI Automation quality depends on the target application. Coordinate fallback
  remains bound to a fresh screenshot and point-ownership check.
- Current hardware validation covers two 100% DPI displays, including a
  negative-coordinate secondary monitor. 125%, 150%, and 200% physical-display
  testing remains a release matrix item.
- Lock-screen and graphics-device-loss tests must be run on a disposable test
  workstation because they disrupt the active desktop.
- The development helper is hash-verified but not Authenticode-signed. A release
  build is intentionally blocked until its signature status is `Valid`, and a
  packaged Windows Desktop repeats that signature check before every helper
  spawn or restart.

## Incident response

If control behaves unexpectedly:

1. Press physical Escape.
2. Revoke the app under **Settings → Computer Use**.
3. Set `ANYBOX_COMPUTER_USE_DISABLED=1` before restarting Anybox if a global
   stop is required.
4. Preserve only the redacted `computer-use.security` result codes and runtime
   manifest; do not collect screenshots or typed content in an issue report.
