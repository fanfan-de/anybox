---
name: Browser
description: Use when the Browser plugin is enabled and the user asks to inspect or control Chrome through the Anybox browser connector or Node REPL browser runtime.
---

# Browser

Use the Browser MCP tools and Node REPL browser runtime from this plugin to inspect and control Chrome through the Anybox browser extension.

Start with `browser_status` when connection state is unclear. Prefer `browser_open_tab` for new work and carry the returned `tabId` into later calls. Use `browser_interactive_snapshot` before element-level actions, then pass the returned `elementId` to `browser_click_element` or `browser_fill`. Use `browser_wait_for` after navigation or actions that change the page.

For multi-step browser workflows, page inspection that needs JavaScript, or raw CDP access, use `node_repl_js` and initialize the browser runtime:

```js
await setupBrowserRuntime({ globals: globalThis })
globalThis.browser = await agent.browsers.get("extension")
```

After initialization, use `browser.tabs.list()`, `browser.tabs.open(url)`, `browser.tabs.get(tabId)`, `tab.snapshot()`, `tab.screenshot()`, `tab.click()`, `tab.fill()`, `tab.evaluate()`, `tab.cdp.send()`, and `tab.playwright.*`. Use raw `evaluate` and CDP only when the normal `browser_*` tools are not sufficient.
