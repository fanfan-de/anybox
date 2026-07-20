---
name: Chrome
description: "Control the user's Chrome browser through a persistent Node REPL when tasks depend on existing tabs, signed-in sessions, extensions, visible page state, or UI interaction. Prefer purpose-built connectors, APIs, or CLIs for semantic resource operations."
---

# Chrome

## Stop: choose the right surface before browser action

Explicit Chrome intent wins. If the user names Chrome or this plugin, asks to open or navigate to a page in Chrome, wants the page's visual or interactive state inspected, or requests UI interaction, continue with this skill and do not silently substitute another browser.

Otherwise, treat a URL or open tab as context rather than browser intent. Before each semantic operation on a linked resource, inspect available tools and use tool discovery when available to find an applicable connector, API, or CLI. Prefer that purpose-built surface when it can complete the operation. Use Chrome when no such surface exists, it lacks the required capability, existing Chrome state matters, or UI work remains.

Use this skill for navigating, inspecting visible page state, testing local web apps, clicking, filling, typing, scrolling, waiting for page changes, and taking screenshots.

## Use only the Anybox Node REPL

Control Chrome only through the general-purpose Anybox Node REPL `js` tool. Its full Anybox tool ID normally resembles `mcp__connector_node_repl_default__js`. Do not use per-action `browser_*` MCP tools, Computer Use, standalone Playwright, or another browser-control plugin for this Chrome surface.

The `js_reset` tool only clears persistent JavaScript state. The `js_add_node_module_dir` tool only changes CommonJS module resolution. Do not call either helper while trying to expose `js`.

Keep setup details internal. Unless the user asks about implementation, describe progress naturally as connecting to Chrome, inspecting the page, or retrying the connection.

The Browser Client sends only operations advertised by Browser Contract v3 to the plugin-owned Browser Host over authenticated local IPC. The client performs an early schema and capability check, and the Browser Host authoritatively validates every command again before it can reach Chrome. The general-purpose Node environment does not provide a browser host-service API; do not call or expect `nodeRepl.requestHost(...)`.

## Bootstrap and reload safely

The Node REPL is a general Anybox environment. It preloads `nodeRepl`, but it does not preload `browser-client`, `setupBrowserRuntime`, `agent`, or Chrome-specific capabilities.

Importing and initializing the Browser Client starts or reconnects the Browser Host from this same plugin package as needed. Keep that lifecycle internal unless the user explicitly asks about implementation.

The absolute path shown when this Skill is loaded ends in `skills/chrome/SKILL.md`. Resolve this plugin's package root by moving two directories up from that Skill directory. The bundled Browser Client is `scripts/browser-client.mjs` under that package root. Import exactly that file through an absolute file URL. Never import an external or built-in `browser-client` package. If the bundled file is missing, stop and report that the Chrome plugin package is incomplete.

Import the Browser Client from the currently loaded plugin package. Reuse it while that package version remains active, but replace a Browser Client retained from an older plugin version before using Chrome. Initialize one persistent Chrome binding and read its complete runtime documentation on first use:

```js
const { resolve } = require("node:path")
const { pathToFileURL } = require("node:url")
const pluginRoot = "<absolute plugin root derived from this Skill's loaded path>"
const browserClientPath = resolve(pluginRoot, "scripts", "browser-client.mjs")
const { setupBrowserRuntime } = await import(pathToFileURL(browserClientPath).href)
if (
  globalThis.agent?.browsers == null
  || globalThis.setupBrowserRuntime !== setupBrowserRuntime
) {
  await setupBrowserRuntime({ globals: globalThis })
  globalThis.chrome = undefined
}
if (globalThis.chrome == null) {
  const readiness = await agent.browsers.ensureReady({ launch: true })
  if (readiness.state !== "ready") return readiness
  globalThis.chrome = await agent.browsers.getDefault()
  nodeRepl.write(await chrome.documentation())
}
```

Reuse `globalThis.chrome` across later calls and user turns while the imported setup function still matches `globalThis.setupBrowserRuntime`. A mismatch means the persistent REPL retained an older plugin version, so reinitialize from the currently loaded package and discard the stale Chrome binding. Do not initialize another browser runtime merely because the user sent a new message.

`agent.browsers.readiness()` reports the current connection state without launching Chrome or running the Native Host probe. During an explicit Chrome task, `agent.browsers.ensureReady({ launch: true })` first allows an in-flight extension reconnect to settle, verifies the installed Native Messaging Host through its authenticated local IPC probe, opens Chrome at most once when needed, and waits for a bounded extension handshake. It never scans Chrome profiles or credential stores.

Check or restore the connection when state is unclear:

```js
return await agent.browsers.ensureReady({ launch: true })
```

`chrome.status().authorizationVerificationAvailable` is the receipt-verification
readiness signal. `peerProcessIdentityVerified` only reports the current
PID/SID/uid verification limitation and does not gate browser commands.

Handle the returned state directly instead of treating every failure as a generic disconnect:

- `ready`: continue with the existing `chrome` binding, or initialize it if absent.
- `needs-extension`: Chrome opened, but the extension did not connect. Ask the user to install or enable the Anybox Chrome extension and then retry.
- `needs-extension-update`: ask the user to update the Anybox Chrome extension; do not bypass the Contract mismatch.
- `needs-native-host-repair`: the Native Messaging Host installation or authenticated local channel failed; ask the user to repair or reinstall the Chrome plugin.
- `browser-not-installed`: report that Google Chrome could not be found.
- `backend-unavailable`: retry once only when `retryable` is true; if it persists, report the returned `error.code` and `error.message`.

Do not keep polling or repeatedly open Chrome after `ensureReady` returns a non-ready state.

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

- When `tab.playwright` is advertised, inspect with `tab.playwright.domSnapshot()` first. Use `elementInfo({ x, y })` to turn screenshot coordinates into role, accessible name, text, test ID, frame path, and stable selector candidates.
- Construct a semantic Locator with `getByRole()`, `getByLabel()`, `getByPlaceholder()`, `getByTestId()`, or a stable CSS selector. Treat Locator objects as immutable.
- Use `count()` only when uniqueness is uncertain. A single-element read or action requires exactly one match; use `first()`, `last()`, or `nth()` only as an explicit, inspected disambiguation.
- Perform one unique action, then verify its specific result with a Locator read, `waitForURL()`, or `waitForLoadState()`.
- Wrap navigation-producing actions in `expectNavigation(() => action, options)` so the waiter is registered before input dispatch.
- Use the lower-level `interactiveSnapshot()` and element-ID methods only when the atomic `tab.playwright` surface is unavailable.
- Structured locators are available only when advertised by the connected Extension. Raw page JavaScript and unrestricted CDP are disabled.

Interactive element IDs can become stale after DOM changes. Take a new interactive snapshot instead of retrying an old ID.

The fixed Locator workflow is:

```js
const snapshot = await tab.playwright.domSnapshot()
const save = tab.playwright.getByRole("button", {
  name: "Save",
  exact: true,
})
const count = await save.count()
if (count !== 1) return { count, snapshot }
const saved = tab.playwright.getByRole("status", { name: "Saved" })
await save.click()
await saved.waitFor({ state: "visible" })
return await saved.innerText()
```

For a navigation-producing action:

```js
await tab.playwright.expectNavigation(
  () => tab.playwright.getByRole("link", { name: "Next" }).click(),
  { waitUntil: "domcontentloaded" },
)
return await tab.playwright.domSnapshot()
```

Register one-shot browser events before the action that produces them:

```js
const downloadPromise = tab.playwright.waitForEvent("download")
await tab.playwright.getByRole("button", { name: "Export" }).click()
const download = await downloadPromise
return await download.path()
```

For a file chooser, create the event promise first, click once, then call
`chooser.setFiles(...)`. The Host will request a new `local-file-read`
authorization for that exact normalized file set; never print those paths.

After `LOCATOR_PARSE_ERROR`, `LOCATOR_STRICT_VIOLATION`,
`LOCATOR_NOT_FOUND`, `STALE_DOCUMENT`, `FRAME_DETACHED`, navigation, or a
deadline, capture a new DOM snapshot before changing or retrying the Locator.
Never blindly replay an action. `ACTION_OUTCOME_UNKNOWN` is non-retryable:
the first input event was dispatched but the final state is unknown, so
inspect the new page state and decide from evidence.

To return a screenshot as an image, emit it instead of returning its base64 data:

```js
await nodeRepl.emitImage(await tab.screenshot())
```

Available APIs include:

- `agent.browsers.readiness()`, `ensureReady({ launch })`, `list()`, `get("extension")`, `getDefault()`, and `getForUrl(url)`
- `chrome.browserId`, `chrome.capabilities`, `chrome.status()`, and capability-filtered `chrome.documentation()`
- `chrome.tabs.list()`, `listUser()`, `open(url, options)`, `claim(tabId)`, `activate(tabId)`, `get(tabId)`, `current()`, and `finalize()`
- `tab.info()`, `activate()`, `snapshot()`, `interactiveSnapshot()`, `domTree()`, `accessibilityTree()`, and `screenshot()`
- `tab.click()`, `clickElement()`, `fill()`, `type()`, `scroll()`, `waitFor()`, `release()`, and `markDeliverable()`
- `tab.playwright.domSnapshot()`, `elementInfo()`, `locator()`, `frameLocator()`, `getByRole()`, `getByText()`, `getByLabel()`, `getByPlaceholder()`, and `getByTestId()`
- Locator composition with `locator()`, `filter()`, `and()`, `or()`, `first()`, `last()`, `nth()`, and `all()`
- Locator reads with `count()`, `allTextContents()`, `textContent()`, `innerText()`, `getAttribute()`, `isVisible()`, `isEnabled()`, and `inputValue()`
- Locator actions with `click()`, `dblclick()`, `fill()`, `type()`, `press()`, `selectOption()`, `setChecked()`, `check()`, `uncheck()`, and `waitFor()`
- Page waiting with `expectNavigation()`, `waitForURL()`, `waitForLoadState()`, `waitForTimeout()`, and `waitForEvent("download" | "filechooser")`
There is no arbitrary page JavaScript, unrestricted CDP, element screenshot,
`downloadMedia()`, or `waitForSelector()` compatibility alias.

## Authentication and privacy

Do not inspect cookies, local storage, session storage, browser profiles, passwords, tokens, or other credential stores. Never use raw JavaScript or CDP to bypass this rule.

Pass `sensitive: true` only when the user-authorized task requires filling or
typing a sensitive field. File chooser paths are a separate
`local-file-read` permission: the Browser Host validates regular local files
and requests one-time approval for every upload. Do not print input values or
file paths. Downloads are written to the Browser Host's managed temporary
directory and are not a media-download escape hatch.

If authentication blocks a task in explicitly requested Chrome, ask the user to sign in there and tell you when it is ready. Do not use web search, another site, or another browser merely to bypass sign-in.

<!-- CHROME_SKILL_EOF: This is the complete Anybox Chrome skill. -->
