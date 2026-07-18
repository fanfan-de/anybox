---
name: Chrome
description: "Control the user's Chrome browser through a persistent Node REPL when tasks depend on existing tabs, signed-in sessions, extensions, visible page state, or UI interaction. Prefer purpose-built connectors, APIs, or CLIs for semantic resource operations."
---

# Chrome

## Stop: choose the right surface before browser action

Explicit Chrome intent wins. If the user names Chrome or this plugin, asks to open or navigate to a page in Chrome, wants the page's visual or interactive state inspected, or requests UI interaction, continue with this skill and do not silently substitute another browser.

Otherwise, treat a URL or open tab as context rather than browser intent. Before each semantic operation on a linked resource, inspect available tools and use tool discovery when available to find an applicable connector, API, or CLI. Prefer that purpose-built surface when it can complete the operation. Use Chrome when no such surface exists, it lacks the required capability, existing Chrome state matters, or UI work remains.

Use this skill for navigating, inspecting visible page state, testing local web apps, clicking, filling, typing, scrolling, waiting for page changes, and taking screenshots.

## Use only the persistent Node REPL

Control Chrome only through this plugin's `js` tool. Its full Anybox tool ID normally resembles `mcp__plugin_chrome_node_repl__js`. Do not use per-action `browser_*` MCP tools, Computer Use, standalone Playwright, or another browser-control plugin for this Chrome surface.

The `js_reset` tool only clears persistent JavaScript state. The `js_add_node_module_dir` tool only changes CommonJS module resolution. Do not call either helper while trying to expose `js`.

Keep setup details internal. Unless the user asks about implementation, describe progress naturally as connecting to Chrome, inspecting the page, or retrying the connection.

## Bootstrap once

The Node REPL preloads `setupBrowserRuntime`, `agent`, and `nodeRepl`. Do not import an external or built-in `browser-client` package.

Initialize one persistent Chrome binding per fresh REPL session. Read its complete runtime documentation on first use:

```js
if (globalThis.agent?.browsers == null) {
  await setupBrowserRuntime({ globals: globalThis })
}
if (globalThis.chrome == null) {
  globalThis.chrome = await agent.browsers.get("extension")
  nodeRepl.write(await chrome.documentation())
}
```

Reuse `globalThis.chrome` across later calls and user turns. Do not initialize another browser runtime merely because the user sent a new message.

Check the extension connection when state is unclear:

```js
return await chrome.status()
```

If Chrome is disconnected, retry `chrome.status()` once after a short interval. If it remains disconnected, ask the user to install or enable the Anybox Chrome extension, reconnect it, and tell you when it is ready.

## Work with tabs

List tabs before opening a duplicate:

```js
return (await chrome.tabs.list()).map(({ id, title, url, active }) => ({
  id,
  title,
  url,
  active,
}))
```

Bind the selected tab explicitly and persist it:

```js
globalThis.tab = await chrome.tabs.get(123) // Replace 123 with a returned tab ID.
return await tab.snapshot()
```

For a new tab, persist the object returned by `open`:

```js
globalThis.tab = await chrome.tabs.open("https://example.com/")
return await tab.snapshot()
```

An item returned by `chrome.tabs.list()` also contains a bound `runtime` property that can be used within the same call. Prefer an explicit tab binding across calls.

If a tab is missing, stale, or closed, discard only `globalThis.tab` and obtain or create a fresh tab from the existing `chrome` binding. An empty tab list does not invalidate the browser binding.

## Inspect and interact

Prefer the highest-level operation that can complete the task:

- Inspect with `tab.snapshot()`, `interactiveSnapshot()`, `domTree()`, or `accessibilityTree()`.
- Use `tab.interactiveSnapshot()` before element actions, then pass a current `elementId` to `tab.clickElement()` or `tab.fill()`.
- Use `tab.waitFor()` with a concrete URL, text, selector, or element condition after navigation or page-changing actions.
- Use `tab.click()` for coordinates only when element-based interaction is unavailable.
- Raw selector adapters, page JavaScript, and CDP are disabled until Anybox can enforce permission at the command boundary.

Interactive element IDs can become stale after DOM changes. Take a new interactive snapshot instead of retrying an old ID.

To return a screenshot as an image, emit it instead of returning its base64 data:

```js
await nodeRepl.emitImage(await tab.screenshot())
```

Available APIs include:

- `chrome.status()` and `chrome.documentation()`
- `chrome.tabs.list()`, `open(url, options)`, `activate(tabId)`, `get(tabId)`, and `current()`
- `tab.info()`, `activate()`, `snapshot()`, `interactiveSnapshot()`, `domTree()`, `accessibilityTree()`, and `screenshot()`
- `tab.click()`, `clickElement()`, `fill()`, `type()`, `scroll()`, `waitFor()`, and `release()`
- `tab.playwright.screenshot()`, `waitForSelector()`, keyboard typing, and coordinate mouse clicks

## Authentication and privacy

Do not inspect cookies, local storage, session storage, browser profiles, passwords, tokens, or other credential stores. Never use raw JavaScript or CDP to bypass this rule.

If authentication blocks a task in explicitly requested Chrome, ask the user to sign in there and tell you when it is ready. Do not use web search, another site, or another browser merely to bypass sign-in.

<!-- CHROME_SKILL_EOF: This is the complete Anybox Chrome skill. -->
