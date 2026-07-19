import assert from "node:assert/strict"
import path from "node:path"
import test from "node:test"
import { pathToFileURL } from "node:url"

const runtimeURL = pathToFileURL(
  path.resolve(import.meta.dirname, "..", "dist", "browser-client.mjs"),
)
process.env.ANYBOX_BROWSER_NATIVE_INSTALL = "off"

const COMMAND_METADATA = {
  "tabs.list": {
    apiPath: "browser.tabs.list",
    signature: "browser.tabs.list()",
    summary: "List tabs visible to the extension backend.",
    security: "browser-metadata-read",
    publicReceiver: "browser",
    publicResult: "tab-list-with-runtime-handles",
  },
  "tabs.open": {
    apiPath: "browser.tabs.open",
    signature: "browser.tabs.open(url, options?)",
    summary: "Open a URL in a new Chrome tab.",
    security: "target-url",
    publicReceiver: "browser",
    publicResult: "tab-runtime-handle",
  },
  "tabs.activate": {
    apiPath: "browser.tabs.activate",
    signature: "browser.tabs.activate(tabId)",
    summary: "Activate a bound Chrome tab.",
    security: "tab-lifecycle",
    publicReceiver: "browser",
    publicResult: "tab-runtime-handle",
  },
  "page.screenshot": {
    apiPath: "tab.screenshot",
    signature: "tab.screenshot(options?)",
    summary: "Capture a PNG screenshot of a tab.",
    security: "page-content-read",
    publicReceiver: "tab",
    publicResult: "command-result",
  },
}

function importRuntime(label) {
  return import(`${runtimeURL.href}?test=${label}-${Date.now()}`)
}

function getInfo(commands = ["tabs.list"]) {
  return {
    backend: {
      contractVersion: 1,
      browserId: "extension",
      name: "Anybox Chrome Extension",
      kind: "extension",
      connected: true,
      protocolVersion: 1,
      backendVersion: "0.1.1",
      instanceID: "extension-test-instance",
      capabilities: {
        commands,
        features: {
          ownership: false,
          claim: false,
          locator: false,
          cancel: false,
          arbitraryJavaScript: false,
          scopedCdp: false,
          fullCdp: false,
        },
      },
    },
    apiManifest: {
      contractVersion: 1,
      commands: commands.map((method) => ({
        method,
        apiPath: COMMAND_METADATA[method].apiPath,
        security: COMMAND_METADATA[method].security,
        publicReceiver: COMMAND_METADATA[method].publicReceiver,
        publicResult: COMMAND_METADATA[method].publicResult,
        commandParamsSchema: { type: "object" },
        commandResultSchema: { type: "object" },
      })),
    },
    documentationManifest: {
      contractVersion: 1,
      title: "Anybox Browser Client Runtime",
      entries: commands.map((method) => ({
        method,
        apiPath: COMMAND_METADATA[method].apiPath,
        signature: COMMAND_METADATA[method].signature,
        summary: COMMAND_METADATA[method].summary,
        security: COMMAND_METADATA[method].security,
      })),
    },
  }
}

function backendTransport({
  commands = ["tabs.list"],
  requests = [],
  command,
  info = getInfo(commands),
} = {}) {
  return async (request) => {
    requests.push(request)
    if (request.type === "getInfo") return info
    if (request.type === "status") {
      return { connected: true, connectionCount: 1 }
    }
    if (command) return command(request)
    throw new Error(`Unexpected command: ${request.method}`)
  }
}

test("installs a discovery-backed BrowserManager on the provided globals", async () => {
  const requests = []
  const transport = backendTransport({ requests })
  const { setupBrowserRuntime } = await importRuntime("setup")
  const globals = {}
  const agent = await setupBrowserRuntime({ globals, transport })

  assert.equal(globals.agent, agent)
  assert.equal(globals.setupBrowserRuntime, setupBrowserRuntime)
  assert.equal(typeof agent.browsers.list, "function")
  assert.equal(typeof agent.browsers.get, "function")
  assert.equal(typeof agent.browsers.getDefault, "function")
  assert.equal(typeof agent.browsers.getForUrl, "function")

  const listed = await agent.browsers.list()
  const named = await agent.browsers.get("extension")
  const fallback = await agent.browsers.getDefault()
  const forUrl = await agent.browsers.getForUrl("https://example.com/")

  assert.equal(listed.length, 1)
  assert.equal(listed[0].browserId, "extension")
  assert.equal(named.info.kind, "extension")
  assert.equal(fallback.capabilities.commands[0], "tabs.list")
  assert.equal(forUrl.browserId, "extension")
  assert.equal(
    requests.every((request) =>
      request.type === "getInfo" && request.contractVersion === 1
    ),
    true,
  )
  assert.equal(requests.length, 4)

  await assert.rejects(
    agent.browsers.get("unknown"),
    (error) => error.code === "BACKEND_UNAVAILABLE",
  )
  await assert.rejects(
    agent.browsers.getForUrl("not-an-absolute-url"),
    (error) => error.code === "INVALID_COMMAND_PARAMS",
  )
})

test("uses the generic Anybox host-service bridge from nodeRepl", async () => {
  const requests = []
  const transport = backendTransport({ requests })
  const services = []
  const globals = {
    nodeRepl: {
      requestHost(service, request) {
        services.push(service)
        return transport(request)
      },
    },
  }
  const { setupBrowserRuntime } = await importRuntime("host-service")
  const agent = await setupBrowserRuntime({ globals })
  const browser = await agent.browsers.getDefault()

  assert.deepEqual(services, ["browser"])
  assert.equal(browser.browserId, "extension")
  assert.deepEqual(requests, [{
    type: "getInfo",
    contractVersion: 1,
  }])
})

test("filters API manifests and documentation from backend capabilities", async () => {
  const requests = []
  const { setupBrowserRuntime } = await importRuntime("capabilities")
  const agent = await setupBrowserRuntime({
    globals: {},
    transport: backendTransport({ requests, commands: ["tabs.list"] }),
  })
  const browser = await agent.browsers.get()
  const documentation = await browser.documentation()

  assert.deepEqual(browser.apiManifest.commands.map(({ method }) => method), [
    "tabs.list",
  ])
  assert.equal(
    browser.apiManifest.commands[0].commandParamsSchema.additionalProperties,
    false,
  )
  assert.deepEqual(
    browser.documentationManifest.entries.map(({ method }) => method),
    ["tabs.list"],
  )
  assert.match(documentation, /browser\.tabs\.list\(\)/)
  assert.doesNotMatch(documentation, /browser\.tabs\.open/)
  assert.doesNotMatch(documentation, /tab\.screenshot/)

  await assert.rejects(
    browser.tabs.open("https://example.com/"),
    (error) => error.code === "CAPABILITY_UNAVAILABLE",
  )
  assert.equal(requests.filter(({ type }) => type === "command").length, 0)
})

test("routes legacy tabs and Tab APIs through one versioned CommandRouter", async () => {
  const requests = []
  const commands = ["tabs.list", "tabs.open", "page.screenshot"]
  const transport = backendTransport({
    commands,
    requests,
    command(request) {
      if (request.method === "tabs.list") {
        return {
          tabs: [{
            id: 42,
            title: "Example",
            url: "https://example.com/",
            active: true,
          }],
        }
      }
      if (request.method === "tabs.open") {
        return {
          id: 43,
          title: "Opened",
          url: request.params.url,
          active: request.params.active,
        }
      }
      if (request.method === "page.screenshot") {
        return {
          tabId: request.params.tabId,
          mime: "image/png",
          data: "fixture-image",
        }
      }
      throw new Error(`Unexpected method: ${request.method}`)
    },
  })

  const { setupBrowserRuntime } = await importRuntime("commands")
  const agent = await setupBrowserRuntime({ globals: {}, transport })
  const browser = await agent.browsers.get()
  const status = await browser.status()
  const tabs = await browser.tabs.list()
  const opened = await browser.tabs.open("https://example.com/open", {
    active: false,
    url: "https://should-not-override.example/",
  })
  const screenshot = await opened.screenshot({ fullPage: true })
  const current = await browser.tabs.current()
  await current.screenshot()

  assert.equal(status.connected, true)
  assert.equal(tabs[0].runtime.tabId, 42)
  assert.equal(opened.tabId, 43)
  assert.equal(screenshot.tabId, 43)
  assert.equal(current.tabId, 42)

  const commandRequests = requests.filter(({ type }) => type === "command")
  assert.deepEqual(commandRequests[0], {
    type: "command",
    contractVersion: 1,
    method: "tabs.list",
    params: {},
  })
  assert.deepEqual(commandRequests[1], {
    type: "command",
    contractVersion: 1,
    method: "tabs.open",
    params: {
      url: "https://example.com/open",
      active: false,
    },
  })
  assert.deepEqual(commandRequests[2], {
    type: "command",
    contractVersion: 1,
    method: "page.screenshot",
    params: {
      tabId: 43,
      fullPage: true,
    },
  })
  assert.deepEqual(commandRequests.at(-1)?.params, { tabId: 42 })

  await assert.rejects(
    browser.tabs.open("not-a-url"),
    (error) => error.code === "INVALID_COMMAND_PARAMS",
  )
  await assert.rejects(
    browser.tabs.open("javascript:document.title='bypass'"),
    (error) => error.code === "INVALID_COMMAND_PARAMS",
  )
  await assert.rejects(
    browser.tabs.get(0),
    (error) => error.code === "INVALID_COMMAND_PARAMS",
  )
})

test("rejects malformed backend info and command results with stable codes", async () => {
  const { setupBrowserRuntime } = await importRuntime("invalid-results")
  const malformedInfoAgent = await setupBrowserRuntime({
    globals: {},
    transport: async () => ({ backend: { connected: true } }),
  })
  await assert.rejects(
    malformedInfoAgent.browsers.get(),
    (error) => error.code === "INVALID_COMMAND_RESULT",
  )

  const malformedCommandAgent = await setupBrowserRuntime({
    globals: {},
    transport: backendTransport({
      command: () => ({ tabs: [{ id: 0 }] }),
    }),
  })
  const browser = await malformedCommandAgent.browsers.get()
  await assert.rejects(
    browser.tabs.list(),
    (error) => error.code === "INVALID_COMMAND_RESULT",
  )
})

test("preserves authoritative transport error metadata", async () => {
  const denied = new Error("Origin permission denied.")
  denied.code = "PERMISSION_DENIED"
  denied.retryable = false
  denied.details = { origin: "https://example.com" }

  const { setupBrowserRuntime } = await importRuntime("error-code")
  const agent = await setupBrowserRuntime({
    globals: {},
    transport: backendTransport({
      command: () => {
        throw denied
      },
    }),
  })
  const browser = await agent.browsers.get()

  await assert.rejects(browser.tabs.list(), (error) => {
    assert.equal(error, denied)
    assert.equal(error.code, "PERMISSION_DENIED")
    assert.equal(error.retryable, false)
    assert.deepEqual(error.details, { origin: "https://example.com" })
    return true
  })
})

test("rejects browser API calls when the host transport is unavailable", async () => {
  const { setupBrowserRuntime } = await importRuntime("missing-transport")
  const agent = await setupBrowserRuntime({ globals: {} })

  await assert.rejects(
    agent.browsers.get(),
    (error) => error.code === "BACKEND_UNAVAILABLE" && error.retryable === true,
  )
})

test("keeps the host transport out of model-visible runtime properties", async () => {
  const transport = backendTransport()
  const { setupBrowserRuntime } = await importRuntime("private-transport")
  const agent = await setupBrowserRuntime({ globals: {}, transport })
  const browser = await agent.browsers.get()
  const tab = await browser.tabs.get(7)

  assert.equal(Object.prototype.hasOwnProperty.call(agent.browsers, "transport"), false)
  assert.equal(Object.prototype.hasOwnProperty.call(browser, "transport"), false)
  assert.equal(Object.prototype.hasOwnProperty.call(tab, "transport"), false)
  assert.equal(JSON.stringify({ browser, tab }).includes("transport"), false)
})

test("keeps raw page evaluation, selector execution, and CDP locally denied", async () => {
  const requests = []
  const { setupBrowserRuntime } = await importRuntime("raw-denied")
  const agent = await setupBrowserRuntime({
    globals: {},
    transport: backendTransport({ requests }),
  })
  const browser = await agent.browsers.get()
  const tab = await browser.tabs.get(7)

  await assert.rejects(
    tab.evaluate((value) => value + 1, 2),
    (error) => error.code === "CAPABILITY_UNAVAILABLE",
  )
  await assert.rejects(
    tab.cdp.send("Runtime.evaluate", { expression: "1 + 1" }),
    (error) => error.code === "CAPABILITY_UNAVAILABLE",
  )
  await assert.rejects(
    tab.locator("button").click(),
    (error) => error.code === "CAPABILITY_UNAVAILABLE",
  )
  assert.equal(requests.filter(({ type }) => type === "command").length, 0)
})
