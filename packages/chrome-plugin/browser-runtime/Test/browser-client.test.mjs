import assert from "node:assert/strict"
import path from "node:path"
import test from "node:test"
import { pathToFileURL } from "node:url"

const runtimeURL = pathToFileURL(
  path.resolve(import.meta.dirname, "..", "dist", "browser-client.mjs"),
)

function importRuntime(label) {
  return import(`${runtimeURL.href}?test=${label}-${Date.now()}`)
}

test("installs the browser runtime on the provided globals object", async () => {
  const { setupBrowserRuntime } = await importRuntime("setup")
  const globals = {}
  const agent = await setupBrowserRuntime({ globals })

  assert.equal(globals.agent, agent)
  assert.equal(globals.setupBrowserRuntime, setupBrowserRuntime)
  assert.equal(typeof agent.browsers.get, "function")
  const browser = await agent.browsers.get("extension")
  assert.ok(browser)
  assert.match(await browser.documentation(), /Anybox Chrome browser runtime/)
  assert.match(await browser.documentation(), /nodeRepl\.emitImage/)
  await assert.rejects(agent.browsers.get("unknown"), /Unknown browser runtime/)
})

test("routes browser commands through the Anybox agent API", async () => {
  const requests = []
  const transport = async (request) => {
    requests.push(request)
    if (request.type === "status") {
      return { connected: true, connectionCount: 1 }
    }
    if (request.method === "tabs.list") {
      return { tabs: [{ id: 42, title: "Example", url: "https://example.com" }] }
    }
    return {}
  }

  const { setupBrowserRuntime } = await importRuntime("commands")
  const agent = await setupBrowserRuntime({ globals: {}, transport })
  const browser = await agent.browsers.get()
  const status = await browser.status()
  const tabs = await browser.tabs.list()

  assert.equal(status.connected, true)
  assert.equal(tabs.length, 1)
  assert.equal(tabs[0].id, 42)
  assert.equal(tabs[0].runtime.tabId, 42)
  await assert.rejects(
    tabs[0].runtime.evaluate((value) => value + 1, 2),
    /disabled until Anybox can enforce command-level capability/,
  )
  await assert.rejects(
    tabs[0].runtime.cdp.send("Runtime.evaluate", { expression: "1 + 1" }),
    /disabled until Anybox can enforce command-level capability/,
  )

  assert.deepEqual(requests[0], { type: "status" })
  assert.deepEqual(requests[1], {
    type: "command",
    method: "tabs.list",
    params: {},
  })
  assert.equal(requests.length, 2)
})

test("rejects browser API calls when the host transport is unavailable", async () => {
  const { setupBrowserRuntime } = await importRuntime("missing-transport")
  const agent = await setupBrowserRuntime({ globals: {} })
  const browser = await agent.browsers.get()

  await assert.rejects(browser.status(), /runtime transport is not available/)
  await assert.rejects(browser.tabs.list(), /runtime transport is not available/)
})

test("keeps the host transport out of model-visible runtime properties", async () => {
  const transport = async () => ({ connected: true })
  const { setupBrowserRuntime } = await importRuntime("private-transport")
  const agent = await setupBrowserRuntime({ globals: {}, transport })
  const browser = await agent.browsers.get()
  const tab = await browser.tabs.get(7)

  assert.equal(Object.prototype.hasOwnProperty.call(browser, "transport"), false)
  assert.equal(Object.prototype.hasOwnProperty.call(tab, "transport"), false)
  assert.equal(JSON.stringify({ browser, tab }).includes("transport"), false)
})
