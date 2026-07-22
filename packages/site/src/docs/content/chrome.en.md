# Chrome

The Chrome plugin lets the agent use your real Google Chrome browser when you explicitly ask it to. It is designed for work that depends on existing tabs, signed-in sessions, browser extensions, or visible page state, such as checking an authenticated dashboard, completing a web form, testing a local site, or leaving a finished result page open for review.

> Chrome can read and interact with the current page. Page content, screenshots, and information you authorize the agent to enter may become part of the current model context. Keep access limited to the pages and data required for the task.

## When to use Chrome

Chrome is the right surface when:

- The task explicitly asks to open, inspect, or operate a page in Chrome.
- An existing signed-in session or already-open tab matters.
- You need to inspect layout, visible state, dialogs, loading behavior, or interaction results.
- The task requires clicking, scrolling, filling, selecting, downloading, or capturing a page.
- You are testing a local web app and need to verify what a user actually sees.

For structured cloud data or object management, prefer a relevant connector, API, or CLI when one is available. Those surfaces are usually more reliable and easier to scope. Use Chrome when they cannot complete the task, browser state matters, or page interaction remains.

## Install and enable it for a project

1. Open **Plugins** from the Anybox navigation.
2. Search for `Chrome`, review the access summary, and select **Install**.
3. Enable `Chrome` from the plugin selector in the current project's top menu.
4. Open Google Chrome and confirm that the Anybox Chrome extension is installed, enabled, and connected.
5. Start a task that explicitly names Chrome and states the target site and desired outcome.

Anybox registers the native communication component bundled with the plugin during installation. Both the Anybox plugin and the Chrome extension are required. If the extension is missing, disabled, or too old, the agent stops and tells you how to restore the connection instead of silently switching browsers.

## Write a clear request

State the outcome, browser, site, and stopping point. This helps the agent select the right tab and pause before consequential actions.

- “Use Chrome to open `http://localhost:5173`, check the mobile navigation, and take a screenshot. Do not change data.”
- “In Chrome, inspect the dashboard where I am already signed in and list this week's failed jobs. Do not rerun them.”
- “Use Chrome to complete this form, then stop before submitting it.”
- “Inspect the current tab and explain why the saved state is not visible.”

A URL by itself does not always mean Chrome is required. Name Chrome when the real browser session or visual page state is important.

## What the agent can do

After the connection is ready, the agent can:

- List, open, select, and switch tabs.
- Navigate, go back or forward, reload, and wait for page changes.
- Read visible structure, accessible names, and text.
- Locate buttons, links, fields, and other controls semantically.
- Click, type, select, scroll, wait for downloads, and handle file choosers.
- Capture screenshots and verify outcomes against fresh page state.

Temporary agent-created tabs are managed as part of the task. A final result page can remain open for inspection, and a page that requires your login or decision can remain open as a handoff. Tabs that were already yours are not automatically closed when the task ends.

## Permission and privacy boundaries

The Chrome plugin does not inspect cookies, local or session storage, browser profiles, passwords, tokens, or other credential stores. It also does not expose arbitrary page JavaScript or unrestricted Chrome DevTools Protocol commands.

Additional approval or a handoff may be required before the agent:

- Enters personal information, passwords, or verification codes into sensitive fields.
- Selects and uploads a local file.
- Sends a message, submits a form, publishes content, makes a purchase, deletes data, or changes access.
- Accepts browser permissions for the camera, microphone, location, downloads, or extension installation.

Review the destination site, account, transmitted data, and consequence shown by the approval. If login, a CAPTCHA, or a browser safety prompt blocks progress, the agent should leave the page ready for you instead of bypassing the restriction elsewhere.

## Chrome or Computer Use Windows?

| Task | Preferred capability |
| --- | --- |
| Page DOM, text, forms, and tabs | Chrome |
| Web work that depends on an existing Chrome login | Chrome |
| Native Windows apps, canvases, and desktop controls | Computer Use Windows |
| Browser chrome that page-level control cannot reach | Computer Use Windows, with care |
| Structured cloud reads or bulk object operations | The relevant connector or API |

Do not use desktop automation to click through an ordinary web page just for consistency. Chrome understands page structure more accurately and makes outcomes easier to verify.

## Connection troubleshooting

### The extension is missing or disabled

Open Chrome's extension manager and make sure the Anybox Chrome extension is installed and enabled. Return to the task and ask the agent to retry after it is connected.

### The extension needs an update

Update the Anybox Chrome extension before continuing. The plugin verifies the browser capability version and will not send commands across an incompatible connection.

### The native component needs repair

Reinstall or repair the Chrome plugin from Anybox, then fully quit and reopen Chrome. Do not manually copy native messaging configuration files.

### The target site is signed out

Sign in directly in Chrome, then tell the agent that the page is ready. The agent does not read saved passwords and should not use another site to bypass authentication.

### The outcome of an action is uncertain

Ask the agent to inspect fresh page state before trying again. Navigation, reloads, and DOM updates can invalidate a previously located control.

## Next steps

Read **Computer Use Windows** for native desktop automation, and **Permissions & Approvals** for what to review before data is sent, uploaded, or changed.
