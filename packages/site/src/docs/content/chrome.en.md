# Chrome

The Chrome plugin lets the agent use your existing Google Chrome tabs, signed-in state, and visible pages for web interaction and real-browser acceptance testing.

> Page content, screenshots, and entered information may enter model context. Expose only the pages and data required for the task.

## Install and Use

1. Install Chrome from Anybox Plugins and enable it for the current project.
2. Confirm that the Anybox Chrome extension is installed, enabled, and connected in the browser.
3. Name Chrome, the target site, expected result, and stopping point in the request.

Example:

> Use Chrome to open `http://localhost:5173`, check the mobile navigation, and take a screenshot. Do not change data.

The agent can switch tabs, navigate, read page structure, click, type, select, scroll, wait for downloads, and capture screenshots. Confirm before submission, sending, upload, purchase, deletion, or access changes.

## Safety Boundaries

Chrome does not inspect cookies, browser storage, profile directories, saved passwords, or tokens. It does not expose arbitrary page JavaScript or unrestricted DevTools commands.

When login, CAPTCHA, or a safety prompt needs you, the agent leaves the page ready for handoff. If an outcome is uncertain, inspect fresh page state instead of repeating the click.

## Choose the Right Capability

| Task | Preferred capability |
| --- | --- |
| Page DOM, forms, tabs, and existing login state | Chrome |
| Native Windows apps and desktop canvases | Computer Use Windows |
| Structured cloud data or bulk objects | Connector / API |
| Code, files, and commands | File / Shell tools |

## Connection Problems

- **Extension missing or outdated:** install, enable, or update Anybox Chrome from the Chrome extensions page.
- **Native component failure:** reinstall or repair the plugin in Anybox, then fully restart Chrome.
- **Site signed out:** sign in yourself and then resume; the agent does not read saved passwords.
