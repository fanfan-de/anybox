import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { pathToFileURL } from "node:url"

const runtimeURL = pathToFileURL(
  path.resolve(import.meta.dirname, "..", "dist", "browser-client.mjs"),
)
process.env.ANYBOX_BROWSER_NATIVE_INSTALL = "off"

const COMMAND_METADATA = {
  "browser.nameSession": {
    apiPath: "browser.nameSession",
    signature: "browser.nameSession(name)",
    summary: "Name the current browser task and its managed Chrome tab group.",
    security: "tab-lifecycle",
    publicReceiver: "browser",
    publicResult: "command-result",
  },
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
  "tabs.markDeliverable": {
    apiPath: "tab.markDeliverable",
    signature: "tab.markDeliverable()",
    summary: "Retain a leased tab as a user deliverable during finalization.",
    security: "tab-lifecycle",
    publicReceiver: "tab",
    publicResult: "command-result",
  },
  "tabs.markHandoff": {
    apiPath: "tab.markHandoff",
    signature: "tab.markHandoff()",
    summary: "Mark a leased tab as a handoff candidate for the current turn.",
    security: "tab-lifecycle",
    publicReceiver: "tab",
    publicResult: "command-result",
  },
  "tabs.finalize": {
    apiPath: "browser.tabs.finalize",
    signature: "browser.tabs.finalize(options?)",
    summary: "Atomically classify and finalize tab leases for the current turn.",
    security: "tab-lifecycle",
    publicReceiver: "browser",
    publicResult: "command-result",
  },
  "tabs.activate": {
    apiPath: "browser.tabs.activate",
    signature: "browser.tabs.activate(tabId)",
    summary: "Activate a bound Chrome tab.",
    security: "tab-lifecycle",
    publicReceiver: "browser",
    publicResult: "tab-runtime-handle",
  },
  "tabs.goto": {
    apiPath: "tab.goto",
    signature: "tab.goto(url)",
    summary: "Navigate a leased tab to an absolute URL.",
    security: "target-url",
    publicReceiver: "tab",
    publicResult: "command-result",
  },
  "tabs.back": {
    apiPath: "tab.back",
    signature: "tab.back()",
    summary: "Navigate a leased tab backward in its history.",
    security: "page-interaction",
    publicReceiver: "tab",
    publicResult: "command-result",
  },
  "tabs.forward": {
    apiPath: "tab.forward",
    signature: "tab.forward()",
    summary: "Navigate a leased tab forward in its history.",
    security: "page-interaction",
    publicReceiver: "tab",
    publicResult: "command-result",
  },
  "tabs.reload": {
    apiPath: "tab.reload",
    signature: "tab.reload()",
    summary: "Reload a leased tab.",
    security: "page-interaction",
    publicReceiver: "tab",
    publicResult: "command-result",
  },
  "tabs.close": {
    apiPath: "tab.close",
    signature: "tab.close()",
    summary: "Close a leased tab and release its browser resources.",
    security: "tab-lifecycle",
    publicReceiver: "tab",
    publicResult: "command-result",
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
      contractVersion: 4,
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
          playwrightLocator: false,
          playwrightApiRevision: 0,
          cancel: false,
          arbitraryJavaScript: false,
          scopedCdp: false,
          fullCdp: false,
        },
      },
    },
    apiManifest: {
      contractVersion: 4,
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
      contractVersion: 4,
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
    if (request.method === "tabs.list") return { tabs: [] }
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
  assert.equal(typeof agent.browsers.readiness, "function")
  assert.equal(typeof agent.browsers.ensureReady, "function")

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
    requests.filter(({ type }) => type === "getInfo").every((request) =>
      request.contractVersion === 4
    ),
    true,
  )
  assert.equal(requests.filter(({ type }) => type === "getInfo").length, 4)
  assert.equal(requests.filter(({ type }) => type === "command").length, 1)

  await assert.rejects(
    agent.browsers.get("unknown"),
    (error) => error.code === "BACKEND_UNAVAILABLE",
  )
  await assert.rejects(
    agent.browsers.getForUrl("not-an-absolute-url"),
    (error) => error.code === "INVALID_COMMAND_PARAMS",
  )
})

test("rebinds a persistent REPL when the loaded plugin runtime changes", async () => {
  const globals = {}
  const firstRuntime = await importRuntime("persistent-runtime-old")
  await firstRuntime.setupBrowserRuntime({
    globals,
    transport: backendTransport(),
  })
  const firstBrowsers = globals.agent.browsers
  globals.chrome = { stale: true }

  const currentRuntime = await importRuntime("persistent-runtime-current")
  assert.notEqual(
    globals.setupBrowserRuntime,
    currentRuntime.setupBrowserRuntime,
  )

  if (
    globals.agent?.browsers == null
    || globals.setupBrowserRuntime !== currentRuntime.setupBrowserRuntime
  ) {
    await currentRuntime.setupBrowserRuntime({
      globals,
      transport: backendTransport(),
    })
    globals.chrome = undefined
  }

  assert.equal(
    globals.setupBrowserRuntime,
    currentRuntime.setupBrowserRuntime,
  )
  assert.notEqual(globals.agent.browsers, firstBrowsers)
  assert.equal(globals.chrome, undefined)
})

test("opens Chrome once and waits for the extension handshake", async () => {
  let connected = false
  let launchCount = 0
  let statusCount = 0
  const transport = async (request) => {
    if (request.type !== "status") {
      throw new Error(`Unexpected request: ${JSON.stringify(request)}`)
    }
    statusCount += 1
    return {
      connected,
      extensionConnected: connected,
      contractCompatible: true,
    }
  }
  const chromeLauncher = {
    async launch() {
      launchCount += 1
      connected = true
    },
  }
  const { setupBrowserRuntime } = await importRuntime("readiness-launch")
  const agent = await setupBrowserRuntime({
    globals: {},
    transport,
    chromeLauncher,
  })

  const readiness = await agent.browsers.ensureReady({
    launch: true,
    settleTimeoutMs: 0,
    pollIntervalMs: 1,
    timeoutMs: 20,
  })

  assert.equal(readiness.state, "ready")
  assert.equal(readiness.action, "none")
  assert.equal(readiness.connected, true)
  assert.equal(readiness.launched, true)
  assert.equal(launchCount, 1)
  assert.equal(statusCount, 3)
})

test("reports the extension remediation after Chrome opens without a handshake", async () => {
  let launchCount = 0
  const { setupBrowserRuntime } = await importRuntime(
    "readiness-extension-timeout",
  )
  const agent = await setupBrowserRuntime({
    globals: {},
    transport: async (request) => {
      assert.equal(request.type, "status")
      return {
        connected: false,
        extensionConnected: false,
        contractCompatible: true,
      }
    },
    chromeLauncher: {
      async launch() {
        launchCount += 1
      },
    },
  })

  const readiness = await agent.browsers.ensureReady({
    launch: true,
    settleTimeoutMs: 0,
    timeoutMs: 0,
  })

  assert.equal(readiness.state, "needs-extension")
  assert.equal(readiness.action, "enable-extension")
  assert.equal(readiness.launched, true)
  assert.equal(readiness.retryable, true)
  assert.equal(launchCount, 1)
})

test("does not open Chrome for an incompatible extension", async () => {
  let launchCount = 0
  const { setupBrowserRuntime } = await importRuntime(
    "readiness-incompatible-extension",
  )
  const agent = await setupBrowserRuntime({
    globals: {},
    transport: async () => ({
      connected: false,
      extensionConnected: true,
      contractCompatible: false,
    }),
    chromeLauncher: {
      async launch() {
        launchCount += 1
      },
    },
  })

  const readiness = await agent.browsers.ensureReady({ launch: true })

  assert.equal(readiness.state, "needs-extension-update")
  assert.equal(readiness.action, "update-extension")
  assert.equal(readiness.retryable, false)
  assert.equal(launchCount, 0)
})

test("does not report ready when browser receipt verification is unavailable", async () => {
  let launchCount = 0
  const { setupBrowserRuntime } = await importRuntime(
    "readiness-authorization-unavailable",
  )
  const agent = await setupBrowserRuntime({
    globals: {},
    transport: async () => ({
      connected: true,
      extensionConnected: true,
      contractCompatible: true,
      authorizationVerificationAvailable: false,
    }),
    chromeLauncher: {
      async launch() {
        launchCount += 1
      },
    },
  })

  const readiness = await agent.browsers.ensureReady({ launch: true })

  assert.equal(readiness.state, "backend-unavailable")
  assert.equal(readiness.action, "retry")
  assert.equal(readiness.error?.code, "AUTHORIZATION_INVALID")
  assert.equal(readiness.retryable, true)
  assert.equal(launchCount, 0)
})

test("distinguishes missing Chrome from Native Host and backend failures", async () => {
  const disconnected = async () => ({
    connected: false,
    extensionConnected: false,
    contractCompatible: true,
  })
  const { setupBrowserRuntime } = await importRuntime(
    "readiness-failure-classification",
  )
  const missingChrome = await setupBrowserRuntime({
    globals: {},
    transport: disconnected,
    chromeLauncher: {
      async launch() {
        throw Object.assign(new Error("Chrome executable was not found."), {
          code: "CHROME_NOT_FOUND",
        })
      },
    },
  })
  const missingChromeReadiness = await missingChrome.browsers.ensureReady({
    launch: true,
    settleTimeoutMs: 0,
  })
  assert.equal(missingChromeReadiness.state, "browser-not-installed")
  assert.equal(missingChromeReadiness.action, "install-chrome")

  let probeLaunchCount = 0
  const nativeHostProbe = await setupBrowserRuntime({
    globals: {},
    transport: disconnected,
    nativeHostProbe: async () => {
      throw Object.assign(new Error("Native Host probe failed."), {
        code: "NATIVE_HOST_INSTALL_FAILED",
      })
    },
    chromeLauncher: {
      async launch() {
        probeLaunchCount += 1
      },
    },
  })
  const nativeHostProbeReadiness =
    await nativeHostProbe.browsers.ensureReady({
      launch: true,
      settleTimeoutMs: 0,
    })
  assert.equal(nativeHostProbeReadiness.state, "needs-native-host-repair")
  assert.equal(nativeHostProbeReadiness.action, "repair-native-host")
  assert.equal(probeLaunchCount, 0)

  const nativeHost = await setupBrowserRuntime({
    globals: {},
    transport: async () => {
      throw Object.assign(new Error("Native Host install failed."), {
        code: "NATIVE_HOST_INSTALL_FAILED",
      })
    },
  })
  const nativeHostReadiness = await nativeHost.browsers.readiness()
  assert.equal(nativeHostReadiness.state, "needs-native-host-repair")
  assert.equal(nativeHostReadiness.action, "repair-native-host")

  const backend = await setupBrowserRuntime({
    globals: {},
    transport: async () => {
      throw new Error("Browser Host stopped.")
    },
  })
  const backendReadiness = await backend.browsers.readiness()
  assert.equal(backendReadiness.state, "backend-unavailable")
  assert.equal(backendReadiness.action, "retry")
})

test("does not depend on a reverse host-service API in nodeRepl", async () => {
  let reverseHostCalls = 0
  const globals = {
    nodeRepl: {
      requestHost() {
        reverseHostCalls += 1
        throw new Error("The generic Node environment must not receive this call.")
      },
    },
  }
  const previous = process.env.ANYBOX_BROWSER_HOST
  process.env.ANYBOX_BROWSER_HOST = "off"
  const { setupBrowserRuntime } = await importRuntime("no-host-service")
  const agent = await setupBrowserRuntime({ globals })
  try {
    await assert.rejects(
      agent.browsers.getDefault(),
      (error) =>
        error.code === "BACKEND_UNAVAILABLE" && error.retryable === true,
    )
    assert.equal(reverseHostCalls, 0)
  } finally {
    if (previous === undefined) delete process.env.ANYBOX_BROWSER_HOST
    else process.env.ANYBOX_BROWSER_HOST = previous
  }
})

test("routes multiple Chrome profiles by instance, preferred window, and URL", async () => {
  const backends = ["extension:profile-a", "extension:profile-b"].map(
    (browserId) => ({
      ...getInfo(["tabs.list"]).backend,
      browserId,
      instanceID: browserId.replace("extension:", ""),
    }),
  )
  const transport = async (request) => {
    if (request.type === "status") {
      return { connected: true, backends }
    }
    if (request.type === "getInfo") {
      const backend = backends.find((candidate) =>
        candidate.browserId === request.browserID
        || candidate.instanceID === request.browserID
      ) ?? backends[0]
      return {
        ...getInfo(["tabs.list"]),
        backend,
      }
    }
    if (request.method === "tabs.list") {
      const profileB = request.browserID === "extension:profile-b"
      return {
        tabs: [{
          id: profileB ? 22 : 11,
          windowId: profileB ? 202 : 101,
          url: profileB
            ? "https://profile-b.example/work"
            : "https://profile-a.example/home",
          active: true,
        }],
      }
    }
    throw new Error(`Unexpected request: ${JSON.stringify(request)}`)
  }
  const { setupBrowserRuntime } = await importRuntime("multi-profile-routing")
  const agent = await setupBrowserRuntime({ globals: {}, transport })

  assert.equal(
    (await agent.browsers.get({
      extensionInstanceID: "profile-b",
    })).browserId,
    "extension:profile-b",
  )
  assert.equal(
    (await agent.browsers.get({ preferredWindowId: 202 })).browserId,
    "extension:profile-b",
  )
  assert.equal(
    (await agent.browsers.getForUrl(
      "https://profile-b.example/another-path",
    )).browserId,
    "extension:profile-b",
  )
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

test("routes tabs and Tab APIs through the v4 CommandRouter", async () => {
  const requests = []
  const commands = [
    "tabs.list",
    "tabs.open",
    "tabs.goto",
    "tabs.back",
    "tabs.forward",
    "tabs.reload",
    "tabs.close",
    "page.screenshot",
  ]
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
      if ([
        "tabs.goto",
        "tabs.back",
        "tabs.forward",
        "tabs.reload",
      ].includes(request.method)) {
        return {
          id: request.params.tabId,
          title: "Navigated",
          url: request.params.url ?? "https://example.com/history",
          active: true,
        }
      }
      if (request.method === "tabs.close") {
        return {
          tabId: request.params.tabId,
          closed: true,
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
  })
  const screenshot = await opened.screenshot({ fullPage: true })
  const current = await browser.tabs.current()
  await current.screenshot()
  const navigated = await opened.goto("https://example.com/next")
  await opened.back()
  await opened.forward()
  await opened.reload()
  const closed = await opened.close()

  assert.equal(status.connected, true)
  assert.equal(tabs[0].runtime.tabId, 42)
  assert.equal(opened.tabId, 43)
  assert.equal(screenshot.tabId, 43)
  assert.equal(current.tabId, 42)
  assert.equal(navigated.id, 43)
  assert.deepEqual(closed, { tabId: 43, closed: true })

  const commandRequests = requests.filter(({ type }) => type === "command")
  assert.deepEqual(commandRequests[0], {
    type: "command",
    contractVersion: 4,
    method: "tabs.list",
    params: {},
    browserID: "extension",
  })
  assert.deepEqual(commandRequests[1], {
    type: "command",
    contractVersion: 4,
    method: "tabs.open",
    params: {
      url: "https://example.com/open",
      active: false,
    },
    browserID: "extension",
  })
  assert.deepEqual(commandRequests[2], {
    type: "command",
    contractVersion: 4,
    method: "page.screenshot",
    params: {
      tabId: 43,
      fullPage: true,
    },
    browserID: "extension",
  })
  assert.deepEqual(
    commandRequests.filter(({ method }) => method === "page.screenshot").at(-1)?.params,
    { tabId: 42 },
  )
  assert.deepEqual(
    commandRequests
      .filter(({ method }) => method.startsWith("tabs."))
      .slice(-5)
      .map(({ method, params }) => ({ method, params })),
    [
      {
        method: "tabs.goto",
        params: { tabId: 43, url: "https://example.com/next" },
      },
      { method: "tabs.back", params: { tabId: 43 } },
      { method: "tabs.forward", params: { tabId: 43 } },
      { method: "tabs.reload", params: { tabId: 43 } },
      { method: "tabs.close", params: { tabId: 43 } },
    ],
  )

  await assert.rejects(
    browser.tabs.open("not-a-url"),
    (error) => error.code === "INVALID_COMMAND_PARAMS",
  )
  await assert.rejects(
    browser.tabs.open("javascript:document.title='bypass'"),
    (error) => error.code === "INVALID_COMMAND_PARAMS",
  )
  await assert.rejects(
    opened.goto("javascript:document.title='bypass'"),
    (error) => error.code === "INVALID_COMMAND_PARAMS",
  )
  await assert.rejects(
    browser.tabs.get(0),
    (error) => error.code === "INVALID_COMMAND_PARAMS",
  )
})

test("opens temporary tabs and serializes explicit final classifications", async () => {
  const requests = []
  let nextTabId = 50
  const commands = [
    "browser.nameSession",
    "tabs.open",
    "tabs.markDeliverable",
    "tabs.markHandoff",
    "tabs.finalize",
  ]
  const transport = backendTransport({
    commands,
    requests,
    command(request) {
      if (request.method === "tabs.open") {
        nextTabId += 1
        return {
          id: nextTabId,
          title: "Opened",
          url: request.params.url,
          active: request.params.active,
        }
      }
      if (request.method === "tabs.markDeliverable") {
        return {
          tabId: request.params.tabId,
          state: "deliverable",
        }
      }
      if (request.method === "browser.nameSession") {
        return { name: request.params.name }
      }
      if (request.method === "tabs.markHandoff") {
        return {
          tabId: request.params.tabId,
          state: "handoff",
        }
      }
      if (request.method === "tabs.finalize") {
        return {
          sessionID: "session-test",
          closedTabIds: [],
          releasedTabIds: [],
          deliverableTabIds: [request.params.keep[0].tabId],
          handoffTabIds: [request.params.keep[1].tabId],
          detachedTabIds: request.params.keep.map(({ tabId }) => tabId),
        }
      }
      throw new Error(`Unexpected method: ${request.method}`)
    },
  })

  const { setupBrowserRuntime } = await importRuntime("tab-retention")
  const agent = await setupBrowserRuntime({ globals: {}, transport })
  const browser = await agent.browsers.get()
  await browser.nameSession("✍️ Publish update")
  const deliverable = await browser.tabs.open("https://example.com/result")
  const handoff = await browser.tabs.open("https://example.com/helper", {
    active: false,
  })
  await deliverable.markDeliverable()
  await handoff.markHandoff()
  const finalized = await browser.tabs.finalize({
    keep: [
      { tab: deliverable, status: "deliverable" },
      { tab: handoff, status: "handoff" },
    ],
  })

  assert.equal(deliverable.tabId, 51)
  assert.equal(handoff.tabId, 52)
  assert.deepEqual(finalized.deliverableTabIds, [51])
  assert.deepEqual(finalized.handoffTabIds, [52])
  assert.deepEqual(
    requests
      .filter(({ type }) => type === "command")
      .map(({ method, params }) => ({ method, params })),
    [
      {
        method: "browser.nameSession",
        params: { name: "✍️ Publish update" },
      },
      {
        method: "tabs.open",
        params: { url: "https://example.com/result" },
      },
      {
        method: "tabs.open",
        params: {
          url: "https://example.com/helper",
          active: false,
        },
      },
      {
        method: "tabs.markDeliverable",
        params: { tabId: 51 },
      },
      {
        method: "tabs.markHandoff",
        params: { tabId: 52 },
      },
      {
        method: "tabs.finalize",
        params: {
          keep: [
            { tabId: 51, status: "deliverable" },
            { tabId: 52, status: "handoff" },
          ],
        },
      },
    ],
  )

  await assert.rejects(
    browser.tabs.open("https://example.com/invalid", {
      keepOpen: "yes",
    }),
    (error) => error.code === "INVALID_COMMAND_PARAMS",
  )

  const foreignBrowser = await agent.browsers.get()
  const foreignTab = await foreignBrowser.tabs.get(99)
  await assert.rejects(
    browser.tabs.finalize({
      keep: [{ tab: foreignTab, status: "deliverable" }],
    }),
    (error) => error.code === "TAB_NOT_OWNED",
  )
  await assert.rejects(
    browser.tabs.finalize({
      keep: [
        { tab: deliverable, status: "deliverable" },
        { tab: deliverable, status: "handoff" },
      ],
    }),
    (error) => error.code === "INVALID_COMMAND_PARAMS",
  )
})

test("uses an empty keep list for automatic lifecycle finalization", async () => {
  const requests = []
  let lifecycleHook
  const transport = backendTransport({
    commands: ["tabs.finalize"],
    requests,
    command(request) {
      assert.equal(request.method, "tabs.finalize")
      return {
        sessionID: "session-test",
        closedTabIds: [],
        releasedTabIds: [],
        deliverableTabIds: [],
        handoffTabIds: [],
        detachedTabIds: [],
      }
    },
  })
  const { setupBrowserRuntime } = await importRuntime("lifecycle-finalize")
  await setupBrowserRuntime({
    globals: {
      nodeRepl: {
        addLifecycleHook(callback) {
          lifecycleHook = callback
        },
      },
    },
    transport,
  })

  await lifecycleHook({ type: "turn-end" })
  await lifecycleHook({ type: "turn-end" })
  assert.deepEqual(
    requests
      .filter(({ type }) => type === "command")
      .map(({ method, params }) => ({ method, params })),
    [
      {
        method: "tabs.finalize",
        params: { keep: [], reason: "turn-end" },
      },
      {
        method: "tabs.finalize",
        params: { keep: [], reason: "turn-end" },
      },
    ],
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
  const previous = process.env.ANYBOX_BROWSER_HOST
  process.env.ANYBOX_BROWSER_HOST = "off"
  const { setupBrowserRuntime } = await importRuntime("missing-transport")
  const agent = await setupBrowserRuntime({ globals: {} })

  try {
    await assert.rejects(
      agent.browsers.get(),
      (error) => error.code === "BACKEND_UNAVAILABLE" && error.retryable === true,
    )
  } finally {
    if (previous === undefined) delete process.env.ANYBOX_BROWSER_HOST
    else process.env.ANYBOX_BROWSER_HOST = previous
  }
})

test("keeps the Browser Host transport out of model-visible runtime properties", async () => {
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

test("does not expose raw access or a partial Playwright surface", async () => {
  const requests = []
  const { setupBrowserRuntime } = await importRuntime("raw-denied")
  const agent = await setupBrowserRuntime({
    globals: {},
    transport: backendTransport({ requests }),
  })
  const browser = await agent.browsers.get()
  const tab = await browser.tabs.get(7)

  assert.equal(tab.evaluate, undefined)
  assert.equal(tab.cdp, undefined)
  assert.equal(tab.playwright, undefined)
  assert.equal(tab.locator, undefined)
  assert.equal("evaluate" in tab, false)
  assert.equal("cdp" in tab, false)
  assert.equal("playwright" in tab, false)
  assert.equal("locator" in tab, false)
  assert.equal(Object.prototype.hasOwnProperty.call(tab, "locator"), false)
  assert.equal(requests.filter(({ type }) => type === "command").length, 0)
})

test("builds immutable Locator v3 plans and dispatches the complete public surface", async () => {
  const calls = []
  const { BrowserPlaywrightAPI } = await importRuntime("playwright-api")
  const runner = {
    async run(method, params, options) {
      calls.push({ method, params, options })
      const base = { tabId: 17, documentGeneration: 4 }
      if (method === "playwright.locator.count") {
        return { ...base, count: 2 }
      }
      if (method === "playwright.locator.selectOption") {
        return { ...base, dispatched: true, values: ["monthly"] }
      }
      return { ...base, dispatched: true }
    },
  }
  const playwright = new BrowserPlaywrightAPI(runner, () => 17)
  const base = playwright.getByRole("button", {
    name: /save\s+now/iu,
  })
  const emptyName = playwright.getByRole("button", { name: "", exact: true })
  const unchanged = base.filter({})
  const target = base
    .filter({ hasText: "Primary", visible: true })
    .and(playwright.locator("[data-state='ready']"))
    .nth(1)

  assert.equal(Object.isFrozen(base.plan), true)
  assert.equal(Object.isFrozen(base.plan.expression), true)
  assert.deepEqual(unchanged.plan, base.plan)
  assert.notEqual(unchanged, base)
  assert.equal(base.plan.expression.kind, "role")
  assert.deepEqual(emptyName.plan.expression.name, {
    type: "string",
    value: "",
    exact: true,
  })
  assert.equal(target.plan.expression.kind, "nth")
  assert.equal(base.nth(-2).plan.expression.index, -2)
  const otherTab = new BrowserPlaywrightAPI(runner, () => 18)
  assert.throws(
    () => base.and(otherTab.locator("button")),
    /same tab and frame/u,
  )
  assert.throws(
    () => {
      target.plan.framePath.push("iframe")
    },
    TypeError,
  )

  assert.equal(await target.count({ timeout: 250 }), 2)
  assert.deepEqual(await target.selectOption("monthly"), ["monthly"])
  assert.equal(calls[0].method, "playwright.locator.count")
  assert.equal(calls[0].params.tabId, 17)
  assert.equal(calls[0].params.timeoutMs, 250)
  assert.equal(calls[0].options.timeoutMs, 5_250)
  assert.equal(calls[0].params.plan.expression.index, 1)
  assert.deepEqual(
    calls[0].params.plan.expression.source.left.source.name,
    { type: "regex", source: "save\\s+now", flags: "iu" },
  )

  const frameTarget = playwright
    .frameLocator("iframe[name='outer']")
    .frameLocator("iframe[data-inner]")
    .getByLabel("Email", { exact: true })
  assert.deepEqual(frameTarget.plan.framePath, [
    "iframe[name='outer']",
    "iframe[data-inner]",
  ])

  for (const method of [
    "domSnapshot",
    "elementInfo",
    "locator",
    "frameLocator",
    "getByRole",
    "getByText",
    "getByLabel",
    "getByPlaceholder",
    "getByTestId",
    "expectNavigation",
    "waitForURL",
    "waitForLoadState",
    "waitForTimeout",
    "waitForEvent",
  ]) {
    assert.equal(typeof playwright[method], "function", method)
  }
  for (const method of [
    "locator",
    "filter",
    "and",
    "or",
    "first",
    "last",
    "nth",
    "all",
    "count",
    "allTextContents",
    "textContent",
    "innerText",
    "getAttribute",
    "isVisible",
    "isEnabled",
    "inputValue",
    "click",
    "dblclick",
    "fill",
    "type",
    "press",
    "selectOption",
    "setChecked",
    "check",
    "uncheck",
    "waitFor",
  ]) {
    assert.equal(typeof target[method], "function", method)
  }
})

test("registers navigation before the action and preserves one-shot event handles", async () => {
  const calls = []
  const waiterID = "00000000-0000-4000-8000-000000000001"
  const downloadID = "00000000-0000-4000-8000-000000000002"
  const chooserID = "00000000-0000-4000-8000-000000000003"
  const { BrowserPlaywrightAPI } = await importRuntime("playwright-events")
  const runner = {
    async run(method, params) {
      calls.push({ method, params })
      const base = { tabId: 9, documentGeneration: 8 }
      if (
        method === "playwright.waitForNavigation"
        && params.mode === "register"
      ) {
        return {
          ...base,
          matched: true,
          state: "registered",
          waiterID,
        }
      }
      if (method === "playwright.waitForNavigation") {
        return { ...base, matched: true, state: "load" }
      }
      if (method === "playwright.waitForEvent") {
        return {
          ...base,
          event: params.event,
          eventID: params.event === "download" ? downloadID : chooserID,
          ...(params.event === "filechooser" ? { multiple: true } : {}),
        }
      }
      if (method === "playwright.download.path") {
        return { ...base, path: "C:\\managed\\download.bin" }
      }
      if (method === "playwright.fileChooser.setFiles") {
        return { ...base, fileCount: params.files.length }
      }
      throw new Error(`Unexpected method: ${method}`)
    },
  }
  const playwright = new BrowserPlaywrightAPI(runner, () => 9)
  const result = await playwright.expectNavigation(async () => {
    calls.push({ method: "action" })
    return "action-result"
  }, { waitUntil: "load" })

  assert.equal(result, "action-result")
  assert.deepEqual(calls.slice(0, 3).map(({ method }) => method), [
    "playwright.waitForNavigation",
    "action",
    "playwright.waitForNavigation",
  ])
  assert.equal(calls[0].params.fromGeneration, undefined)
  assert.equal(calls[2].params.waiterID, waiterID)

  const actionFailure = new Error("action failed")
  await assert.rejects(
    playwright.expectNavigation(() => {
      throw actionFailure
    }),
    (error) => error === actionFailure,
  )
  assert.deepEqual(calls.at(-1), {
    method: "playwright.waitForNavigation",
    params: {
      tabId: 9,
      mode: "cancel",
      waiterID,
      timeoutMs: 1_000,
    },
  })

  const download = await playwright.waitForEvent("download")
  assert.equal(await download.path(), "C:\\managed\\download.bin")
  const chooser = await playwright.waitForEvent("filechooser")
  assert.equal(chooser.multiple, true)
  await chooser.setFiles(["C:\\approved\\a.txt", "C:\\approved\\b.txt"])
  assert.deepEqual(calls.at(-1).params.files, [
    "C:\\approved\\a.txt",
    "C:\\approved\\b.txt",
  ])
})

test("starts and connects to the plugin-owned Browser Host", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anybox-browser-host-runtime-"))
  const bootstrapPath = path.join(root, "browser-host.runtime.json")
  const hostEntrypoint = path.resolve(
    import.meta.dirname,
    "..",
    "..",
    "browser-host",
    "dist",
    "browser-host.mjs",
  )
  const previous = Object.fromEntries(
    [
      "ANYBOX_AGENT_DATA_DIR",
      "ANYBOX_BROWSER_HOST",
      "ANYBOX_BROWSER_HOST_BOOTSTRAP_PATH",
      "ANYBOX_BROWSER_HOST_ENTRYPOINT",
      "ANYBOX_BROWSER_AUTH_PUBLIC_KEY",
      "ANYBOX_TEST_HOME",
    ].map((key) => [key, process.env[key]]),
  )
  let hostPID
  process.env.ANYBOX_AGENT_DATA_DIR = root
  process.env.ANYBOX_BROWSER_HOST_BOOTSTRAP_PATH = bootstrapPath
  process.env.ANYBOX_BROWSER_HOST_ENTRYPOINT = hostEntrypoint
  process.env.ANYBOX_BROWSER_AUTH_PUBLIC_KEY = "runtime_public_key"
  process.env.ANYBOX_TEST_HOME = root
  delete process.env.ANYBOX_BROWSER_HOST

  try {
    const { setupBrowserRuntime } = await importRuntime("real-browser-host")
    const agent = await setupBrowserRuntime({ globals: {} })
    const browser = await agent.browsers.getDefault()
    const status = await browser.status()
    const bootstrap = JSON.parse(await readFile(bootstrapPath, "utf8"))
    hostPID = bootstrap.hostPID

    assert.equal(browser.browserId, "extension")
    assert.equal(status.connected, false)
    assert.equal(status.authorizationVerificationAvailable, true)
    assert.equal(status.runtimeConnections >= 1, true)
    assert.equal(bootstrap.role, "runtime")
    assert.equal(typeof hostPID, "number")
  } finally {
    if (Number.isInteger(hostPID)) {
      try {
        process.kill(hostPID, "SIGTERM")
      } catch {
        // The host may already have exited after a failed assertion.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(root, { recursive: true, force: true })
  }
})

test("replaces an authenticated Browser Host from an older plugin version", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anybox-browser-host-upgrade-"))
  const bootstrapPath = path.join(root, "browser-host.runtime.json")
  const hostEntrypoint = path.resolve(
    import.meta.dirname,
    "..",
    "..",
    "browser-host",
    "dist",
    "browser-host.mjs",
  )
  const previous = Object.fromEntries(
    [
      "ANYBOX_AGENT_DATA_DIR",
      "ANYBOX_BROWSER_HOST",
      "ANYBOX_BROWSER_HOST_BOOTSTRAP_PATH",
      "ANYBOX_BROWSER_HOST_ENTRYPOINT",
      "ANYBOX_BROWSER_AUTH_PUBLIC_KEY",
      "ANYBOX_TEST_HOME",
    ].map((key) => [key, process.env[key]]),
  )
  const hostPIDs = new Set()
  process.env.ANYBOX_AGENT_DATA_DIR = root
  process.env.ANYBOX_BROWSER_HOST_BOOTSTRAP_PATH = bootstrapPath
  process.env.ANYBOX_BROWSER_HOST_ENTRYPOINT = hostEntrypoint
  process.env.ANYBOX_BROWSER_AUTH_PUBLIC_KEY = "runtime_public_key"
  process.env.ANYBOX_TEST_HOME = root
  delete process.env.ANYBOX_BROWSER_HOST

  try {
    const initialRuntime = await importRuntime("browser-host-upgrade-seed")
    const initialAgent = await initialRuntime.setupBrowserRuntime({ globals: {} })
    await initialAgent.browsers.readiness()
    const initialBootstrap = JSON.parse(await readFile(bootstrapPath, "utf8"))
    hostPIDs.add(initialBootstrap.hostPID)

    await writeFile(bootstrapPath, `${JSON.stringify({
      ...initialBootstrap,
      hostVersion: "0.10.0",
    }, null, 2)}\n`)

    const upgradedRuntime = await importRuntime("browser-host-upgrade-replace")
    const upgradedAgent = await upgradedRuntime.setupBrowserRuntime({ globals: {} })
    const readiness = await upgradedAgent.browsers.readiness()
    const upgradedBootstrap = JSON.parse(await readFile(bootstrapPath, "utf8"))
    hostPIDs.add(upgradedBootstrap.hostPID)

    assert.equal(readiness.state, "needs-browser")
    assert.notEqual(upgradedBootstrap.hostPID, initialBootstrap.hostPID)
    assert.equal(upgradedBootstrap.hostVersion, "0.15.0")
  } finally {
    for (const hostPID of hostPIDs) {
      if (!Number.isInteger(hostPID)) continue
      try {
        process.kill(hostPID, "SIGTERM")
      } catch {
        // The host may already have exited after the replacement or a failed assertion.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(root, { recursive: true, force: true })
  }
})
