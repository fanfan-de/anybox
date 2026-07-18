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
  assert.ok(await agent.browsers.get("extension"))
  await assert.rejects(agent.browsers.get("unknown"), /Unknown browser runtime/)
})

test("routes browser commands through the Anybox agent API", async () => {
  const originalBaseURL = process.env.ANYBOX_AGENT_BASE_URL
  const originalTrustedToken = process.env.ANYBOX_BROWSER_TRUSTED_TOKEN
  const originalFetch = globalThis.fetch
  const requests = []

  process.env.ANYBOX_AGENT_BASE_URL = "http://127.0.0.1:9876/"
  process.env.ANYBOX_BROWSER_TRUSTED_TOKEN = "test-token"
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(String(options.body))
    requests.push({ url: String(url), options, body })

    const data = body.method === "tabs.list"
      ? { tabs: [{ id: 42, title: "Example", url: "https://example.com" }] }
      : body.method === "page.executeScript"
        ? { value: 3 }
        : {}
    return new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }

  try {
    const { setupBrowserRuntime } = await importRuntime("commands")
    const agent = await setupBrowserRuntime({ globals: {} })
    const browser = await agent.browsers.get()
    const tabs = await browser.tabs.list()

    assert.equal(tabs.length, 1)
    assert.equal(tabs[0].id, 42)
    assert.equal(tabs[0].runtime.tabId, 42)
    assert.equal(
      await tabs[0].runtime.evaluate((value) => value + 1, 2),
      3,
    )

    assert.equal(requests[0].url, "http://127.0.0.1:9876/api/browser-extension/command")
    assert.equal(requests[0].body.method, "tabs.list")
    assert.equal(
      requests[1].url,
      "http://127.0.0.1:9876/api/browser-extension/trusted-command",
    )
    assert.equal(requests[1].body.method, "page.executeScript")
    assert.equal(
      requests[1].options.headers["x-anybox-browser-trusted-token"],
      "test-token",
    )
  } finally {
    if (originalBaseURL === undefined) {
      delete process.env.ANYBOX_AGENT_BASE_URL
    } else {
      process.env.ANYBOX_AGENT_BASE_URL = originalBaseURL
    }
    if (originalTrustedToken === undefined) {
      delete process.env.ANYBOX_BROWSER_TRUSTED_TOKEN
    } else {
      process.env.ANYBOX_BROWSER_TRUSTED_TOKEN = originalTrustedToken
    }
    globalThis.fetch = originalFetch
  }
})
