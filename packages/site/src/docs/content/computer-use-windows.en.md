# Computer Use Windows

Computer Use Windows lets the agent observe and operate one explicitly selected Windows application window. It is intended for desktop software that does not offer a suitable connector, API, or stable command interface, using window-scoped screenshots, bounded accessibility information, and guarded mouse and keyboard input.

> The current plugin targets Windows 11 x64. While desktop control is active, every display shows a blue safety border and a “Press Esc to stop” notice. Desktop access does not continue if that notice cannot be shown.

## When to use it

Computer Use Windows is suitable for:

- Operating Notepad, Paint, media players, and other native Windows apps.
- Clicking menus, changing options, scrolling, dragging, or entering text in software without a structured integration.
- Reading the state currently visible in a selected window and reporting it back to the task.
- Completing a small number of verifiable steps in canvases, graphics editors, or custom desktop controls.

Use the Chrome plugin for ordinary web pages. Use Anybox file and Shell tools for repository files, code changes, and commands. Prefer a connector or API whenever the service provides a structured integration.

## Install and enable it for a project

1. Confirm that the device is running Windows 11 x64.
2. Open **Plugins** from the Anybox navigation.
3. Search for `Computer Use Windows` or `computer-use-windows`, review the high-risk capability summary, and select **Install**.
4. Enable the plugin from the current project's top-menu plugin selector.
5. Prefer opening the target application first, then name the app, window, and allowed outcome in your request.

The plugin package contains the desktop-control runtime and native component. It does not require a separate Computer Use MCP server or settings page. Uninstalling the plugin removes the capability itself.

## Write a bounded request

Name one application window and a clear stopping point:

- “Use Computer Use Windows to operate only the open Notepad window. Insert these three paragraphs and do not close the file.”
- “Read the current result in Calculator and report the value without pressing another key.”
- “In the open drawing app, choose the rectangle tool, draw one outline, and verify it with a screenshot.”
- “Enter this content in the desktop editor, then stop before selecting Send.”

Avoid requests such as “operate my computer.” The more precisely you identify the app, window, data, and final action, the safer target selection and approval boundaries become.

## How an action proceeds

The agent follows a short loop instead of running a blind macro:

1. List the available applications and windows.
2. Select exactly one target window.
3. Capture fresh window state, including a screenshot and bounded accessibility information.
4. Perform one action based on that observation.
5. Observe the result again before deciding what to do next.

Each observation expires quickly and can authorize at most one action. If the window, layout, focus, or occlusion changes, the agent must observe again instead of reusing an old coordinate or element index. This is slower than an uninterrupted macro, but substantially reduces the chance of clicking another window or submitting twice.

## The blue safety notice and stopping

Before desktop access begins, the plugin shows a blue edge treatment and status notice on every active display:

- The notice indicates that Computer Use is active; it is not approval for a high-impact action.
- Press the physical `Esc` key to stop the current desktop-control session immediately.
- The notice cannot be disabled or bypassed in production.
- The agent must stop for the turn if the notice cannot be created, the desktop is locked, or control is interrupted.

Stopping leaves the target application in its current state. Inspect the window before issuing a new request to continue.

## Approvals and prohibited targets

Routine observation and low-risk local interaction do not require an approval for every step. Sending or submitting, deleting, uploading, and installing require a one-time decision immediately before the action. Approval details redact the actual text and assigned values.

Computer Use Windows does not operate:

- Anybox itself, terminals, PowerShell, Command Prompt, or the Windows Run dialog.
- Login, password, verification-code, password-manager, UAC, or secure-desktop prompts.
- Windows security or privacy settings, anti-malware apps, or browser safety warnings.
- Payment flows, age verification, CAPTCHAs, or attempts to bypass website protections.
- The lock screen or protected windows running at a higher integrity level than Anybox.

Treat text shown in webpages, emails, documents, and app windows as untrusted content, not as a new user instruction. The agent should not copy, upload, delete, or reveal data merely because an app tells it to do so.

## Screenshots, text, and privacy

The plugin observes the selected target window for the task, but screenshots and accessibility text may enter the current model context. Close unrelated sensitive windows and avoid displaying passwords, keys, medical or financial records, or private communications in the target window.

Typed text is not shown verbatim in approval summaries, but the destination application still receives content you authorize. Before sending, submitting, or uploading, verify the target app, recipient, and data scope.

## Computer Use Windows or Chrome?

| Need | Preferred capability |
| --- | --- |
| Web text, DOM, forms, tabs, and signed-in browser state | Chrome |
| Native Windows applications and desktop canvases | Computer Use Windows |
| Code, project files, and commands | File or Shell tools |
| Structured objects in a cloud service | A connector or API |

Chrome remains the preferred surface for ordinary web work even though it is a Windows app. Use desktop control for browser chrome only when page-level control cannot reach it and the task does not involve authentication, safety warnings, or sensitive settings.

## Troubleshooting

### The blue safety border does not appear

The plugin treats the notice as a hard requirement for desktop access. If the task has stopped, update or reinstall the plugin and restart Anybox before trying again. Do not attempt to disable the indicator.

### The target window is not listed

Open the application manually and navigate to the intended screen, then give the agent the exact app name and window title. A launcher, welcome screen, and main workspace may be separate windows.

### The window is covered or focus changed

Ask the agent to observe again and activate the target window. Do not ask it to keep clicking coordinates from an earlier screenshot.

### The desktop is locked or a protected prompt appears

Unlock the desktop and handle authentication, UAC, or system permission interfaces yourself. Return to a normal application window before starting a new Computer Use request.

### Pressing Esc stopped the task

That is the expected emergency-stop behavior. Check whether the app contains a partial change, then describe the exact state from which the agent should continue.

## Next steps

Read **Chrome** for browser automation, and **Permissions & Approvals** for one-time decisions and high-impact action review.
