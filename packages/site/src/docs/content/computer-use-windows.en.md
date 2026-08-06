# Computer Use Windows

Computer Use Windows lets the agent observe and operate one specified Windows application window. Use it for desktop software without a suitable connector, API, or stable command interface.

> The plugin currently supports Windows 11 x64. Every display shows a blue border and “Press Esc to stop” while control is active; desktop access stops if the notice cannot be shown.

## Installation and Scope

1. Install `computer-use-windows` from Plugins and enable it for the current project.
2. Open the target application first.
3. Name exactly one window, allowed actions, and a stopping point.

> Operate only the open Notepad window, enter this content, and stop before saving.

Use Chrome for ordinary web pages, file or Shell tools for code and commands, and a connector or API when a structured integration exists.

## How Actions Work

Each step lists windows, selects the target, captures fresh screenshot and accessibility state, performs one action, and observes again. One observation authorizes only one action. Layout, focus, or occlusion changes require a fresh observation; old coordinates cannot be reused.

Press the physical `Esc` key to stop immediately. The app remains in its current state, so inspect any partial change before continuing.

## Approval and Prohibited Targets

High-impact actions such as sending, submitting, deleting, uploading, and installing require one-time confirmation. The plugin does not operate:

- Anybox, terminals, PowerShell, Command Prompt, or the Run dialog.
- Login, password, verification-code, password-manager, UAC, or secure-desktop prompts.
- Security and privacy settings, payments, CAPTCHAs, or browser safety warnings.
- The lock screen or protected windows above Anybox's integrity level.

Window screenshots and accessibility text may enter model context. Close unrelated sensitive windows and verify the app, recipient, and data scope before sending, submitting, or uploading.

## Capability Choice

| Need | Preferred capability |
| --- | --- |
| Web pages, forms, tabs, and login state | Chrome |
| Native Windows apps and canvases | Computer Use Windows |
| Code, files, and commands | File / Shell tools |
| Structured cloud objects | Connector / API |

## Troubleshooting

- Blue border missing: update or reinstall the plugin and restart Anybox; do not bypass the notice.
- Window missing: open the intended screen manually and provide the exact app name and title.
- Focus or layout changed: ask the agent to observe again.
- Lock, authentication, or UAC appeared: handle it yourself, then start a new request.
