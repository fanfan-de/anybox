import { describe, expect, test } from "vitest"

import {
  BROWSER_CONTRACT_COMMAND_METHODS,
  BROWSER_CONTRACT_ERROR_CODES,
  BROWSER_CONTRACT_V1_COMMAND_METHODS,
  BROWSER_CONTRACT_V1_VERSION,
  BROWSER_CONTRACT_VERSION,
  BrowserBackendInfo,
  BrowserContractCommandMethod,
  BrowserContractCommandRegistry,
  BrowserContractValidationError,
  BrowserGetInfoResult,
  createBrowserApiManifest,
  createBrowserBackendCapabilities,
  createBrowserBackendInfo,
  createBrowserDocumentationManifest,
  createBrowserGetInfoResult,
  parseBrowserCommandParams,
  parseBrowserCommandResult,
  type BrowserContractCommandMethod as BrowserContractCommandMethodValue,
} from "./browser-contract"

const tab = {
  id: 7,
  windowId: 1,
  title: "Example",
  url: "https://example.com/",
  active: true,
}

const validParams = {
  "tabs.list": {},
  "tabs.listUser": {},
  "tabs.open": { url: "https://example.com/", active: true },
  "tabs.claim": { tabId: 7 },
  "tabs.activate": { tabId: 7 },
  "tabs.release": { tabId: 7 },
  "tabs.markDeliverable": { tabId: 7 },
  "tabs.finalize": { reason: "turn-end" },
  "page.snapshot": { tabId: 7, maxTextChars: 20_000 },
  "page.interactiveSnapshot": { tabId: 7, maxElements: 200 },
  "page.domTree": {
    tabId: 7,
    maxDepth: 6,
    maxNodes: 1_000,
    pierce: true,
    includeText: true,
    includeAttributes: true,
  },
  "page.accessibilityTree": {
    tabId: 7,
    maxDepth: 8,
    maxNodes: 1_000,
    includeIgnored: false,
  },
  "page.screenshot": { tabId: 7, fullPage: false },
  "page.click": { tabId: 7, x: 10, y: 20, button: "left" },
  "page.clickElement": {
    tabId: 7,
    elementId: "element-1",
    elementName: "Submit",
    role: "button",
    button: "left",
  },
  "page.fill": {
    tabId: 7,
    elementId: "element-2",
    text: "",
    elementName: "Search",
    sensitive: false,
  },
  "page.type": { tabId: 7, text: "hello" },
  "page.scroll": { tabId: 7, scrollX: 0, scrollY: 500 },
  "page.waitFor": { tabId: 7, text: "Ready", timeoutMs: 10_000 },
  "locator.click": {
    tabId: 7,
    locator: { role: "button", name: "Save" },
  },
  "locator.fill": {
    tabId: 7,
    locator: { label: "Email" },
    text: "a@example.com",
  },
  "locator.textContent": {
    tabId: 7,
    locator: { css: "#status" },
  },
  "locator.inputValue": {
    tabId: 7,
    locator: { label: "Email" },
  },
  "locator.waitFor": {
    tabId: 7,
    locator: { text: "Ready" },
    state: "visible",
  },
} as const satisfies Record<BrowserContractCommandMethodValue, unknown>

const validResults = {
  "tabs.list": { tabs: [tab] },
  "tabs.listUser": { tabs: [tab] },
  "tabs.open": tab,
  "tabs.claim": tab,
  "tabs.activate": tab,
  "tabs.release": { tabId: 7, released: true },
  "tabs.markDeliverable": { tabId: 7, state: "deliverable" },
  "tabs.finalize": {
    sessionID: "session-test",
    closedTabIds: [],
    releasedTabIds: [7],
    retainedTabIds: [],
    detachedTabIds: [7],
  },
  "page.snapshot": {
    tabId: 7,
    url: tab.url,
    title: tab.title,
    text: "Example",
    links: [{ text: "Home", href: "https://example.com/" }],
    buttons: [{ text: "Submit" }],
    inputs: [{ sensitive: true }],
    truncated: false,
  },
  "page.interactiveSnapshot": {
    tabId: 7,
    url: tab.url,
    title: tab.title,
    elements: [{
      elementId: "element-1",
      tag: "button",
      disabled: false,
      visible: true,
      rect: { x: 1, y: 2, width: 30, height: 10 },
    }],
    truncated: false,
  },
  "page.domTree": {
    tabId: 7,
    url: tab.url,
    title: tab.title,
    root: { nodeType: 9, nodeName: "#document" },
    nodeCount: 1,
    maxDepth: 6,
    maxNodes: 1_000,
    truncated: false,
  },
  "page.accessibilityTree": {
    tabId: 7,
    url: tab.url,
    title: tab.title,
    nodes: [],
    nodeCount: 0,
    maxDepth: 8,
    maxNodes: 1_000,
    includeIgnored: false,
    truncated: false,
  },
  "page.screenshot": {
    tabId: 7,
    mime: "image/png",
    data: "cG5n",
  },
  "page.click": {
    tabId: 7,
    x: 10,
    y: 20,
    button: "left",
  },
  "page.clickElement": {
    tabId: 7,
    elementId: "element-1",
    url: tab.url,
    title: tab.title,
  },
  "page.fill": {
    tabId: 7,
    elementId: "element-2",
    textLength: 0,
    url: tab.url,
    title: tab.title,
  },
  "page.type": {
    tabId: 7,
    textLength: 5,
  },
  "page.scroll": {
    tabId: 7,
    scrollX: 0,
    scrollY: 500,
    position: { scrollX: 0, scrollY: 500 },
  },
  "page.waitFor": {
    tabId: 7,
    url: tab.url,
    title: tab.title,
    matched: true,
    reason: "Text appeared.",
  },
  "locator.click": {
    tabId: 7,
    elementId: "locator-1",
    url: tab.url,
    title: tab.title,
  },
  "locator.fill": {
    tabId: 7,
    elementId: "locator-2",
    textLength: 13,
    url: tab.url,
    title: tab.title,
  },
  "locator.textContent": {
    tabId: 7,
    value: "Ready",
    url: tab.url,
    title: tab.title,
  },
  "locator.inputValue": {
    tabId: 7,
    value: "a@example.com",
    url: tab.url,
    title: tab.title,
  },
  "locator.waitFor": {
    tabId: 7,
    url: tab.url,
    title: tab.title,
    matched: true,
    reason: "Locator is visible.",
  },
} as const satisfies Record<BrowserContractCommandMethodValue, unknown>

describe("Browser Contract command registry", () => {
  test("keeps immutable v1 and publishes the additive v2 registry", () => {
    expect(BROWSER_CONTRACT_V1_VERSION).toBe(1)
    expect(BROWSER_CONTRACT_VERSION).toBe(2)
    expect(BROWSER_CONTRACT_V1_COMMAND_METHODS).toHaveLength(15)
    expect(BROWSER_CONTRACT_COMMAND_METHODS).toHaveLength(24)
    expect(Object.keys(BrowserContractCommandRegistry))
      .toEqual([...BROWSER_CONTRACT_COMMAND_METHODS])
    expect(BrowserContractCommandMethod.safeParse("page.executeScript").success)
      .toBe(false)
    expect(BrowserContractCommandMethod.safeParse("cdp.send").success).toBe(false)
    expect(() => parseBrowserCommandParams(
      "tabs.claim",
      { tabId: 7 },
      BROWSER_CONTRACT_V1_VERSION,
    )).toThrowError(expect.objectContaining({
      code: "COMMAND_NOT_SUPPORTED",
    }))
  })

  test.each(BROWSER_CONTRACT_COMMAND_METHODS)(
    "strictly parses %s params and results",
    (method) => {
      expect(parseBrowserCommandParams(method, validParams[method]))
        .toEqual(validParams[method])
      expect(parseBrowserCommandResult(method, validResults[method]))
        .toEqual(validResults[method])

      expect(() => parseBrowserCommandParams(method, {
        ...(validParams[method] as Record<string, unknown>),
        unexpected: true,
      })).toThrowError(expect.objectContaining({
        code: "INVALID_COMMAND_PARAMS",
      }))
      expect(() => parseBrowserCommandResult(method, {
        ...(validResults[method] as Record<string, unknown>),
        unexpected: true,
      })).toThrowError(expect.objectContaining({
        code: "INVALID_COMMAND_RESULT",
      }))
    },
  )

  test("requires a bound tab and a concrete wait condition", () => {
    expect(() => parseBrowserCommandParams("tabs.list", null))
      .toThrowError(expect.objectContaining({
        code: "INVALID_COMMAND_PARAMS",
      }))
    expect(() => parseBrowserCommandParams("page.snapshot", {}))
      .toThrowError(expect.objectContaining({
        code: "INVALID_COMMAND_PARAMS",
      }))
    expect(() => parseBrowserCommandParams("page.waitFor", { tabId: 7 }))
      .toThrowError(expect.objectContaining({
        code: "INVALID_COMMAND_PARAMS",
      }))
    expect(() => parseBrowserCommandParams("page.waitFor", {
      tabId: 7,
      selector: "   ",
    })).toThrowError(expect.objectContaining({
      code: "INVALID_COMMAND_PARAMS",
    }))
    expect(parseBrowserCommandParams("page.waitFor", {
      tabId: 7,
      selector: "  button[data-ready]  ",
    })).toMatchObject({
      selector: "button[data-ready]",
    })
  })

  test.each([
    "javascript:document.body.textContent='bypass'",
    "data:text/html,<script>document.title='bypass'</script>",
    "vbscript:msgbox(1)",
  ])("rejects executable target URL scheme %s", (url) => {
    expect(() => parseBrowserCommandParams("tabs.open", { url }))
      .toThrowError(expect.objectContaining({
        code: "INVALID_COMMAND_PARAMS",
      }))
  })

  test("reports an unsupported command with a stable contract error", () => {
    try {
      parseBrowserCommandParams(
        "page.executeScript" as BrowserContractCommandMethodValue,
        {},
      )
      throw new Error("Expected command parsing to fail.")
    } catch (error) {
      expect(error).toBeInstanceOf(BrowserContractValidationError)
      expect(error).toMatchObject({ code: "COMMAND_NOT_SUPPORTED" })
    }
  })

  test("preserves the sensitive marker in snapshot results", () => {
    const result = parseBrowserCommandResult(
      "page.snapshot",
      validResults["page.snapshot"],
    )
    expect(result.inputs).toEqual([{ sensitive: true }])
  })
})

describe("Browser Contract capabilities and manifests", () => {
  test("defaults all advanced features to false", () => {
    const capabilities = createBrowserBackendCapabilities()
    expect(capabilities.commands).toEqual([])
    expect(capabilities.features).toEqual({
      ownership: false,
      claim: false,
      locator: false,
      cancel: false,
      arbitraryJavaScript: false,
      scopedCdp: false,
      fullCdp: false,
    })
  })

  test("normalizes command order and filters API and documentation manifests", () => {
    const commands = ["page.screenshot", "tabs.list"] as const
    const api = createBrowserApiManifest(commands)
    const documentation = createBrowserDocumentationManifest(commands)

    expect(api.commands.map((entry) => entry.method))
      .toEqual(["tabs.list", "page.screenshot"])
    expect(documentation.entries.map((entry) => entry.method))
      .toEqual(["tabs.list", "page.screenshot"])
    expect(api.commands[0]).toMatchObject({
      publicReceiver: "browser",
      publicResult: "tab-list-with-runtime-handles",
    })
    expect(api.commands[0]?.commandParamsSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
    })
    expect(api.commands[1]).toMatchObject({
      publicReceiver: "tab",
      publicResult: "command-result",
    })
    expect(api.commands[1]?.commandResultSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
    })
    expect(JSON.parse(JSON.stringify(api))).toEqual(api)
  })

  test("documents the executable-scheme restriction in machine-readable schema", () => {
    const open = createBrowserApiManifest(["tabs.open"]).commands[0]
    expect(open).toMatchObject({
      publicReceiver: "browser",
      publicResult: "tab-runtime-handle",
    })
    expect(open?.commandParamsSchema).toMatchObject({
      properties: {
        url: {
          format: "uri",
          pattern: expect.any(String),
          description: expect.stringContaining("javascript:"),
        },
      },
    })
    const properties = open?.commandParamsSchema.properties as
      | Record<string, Record<string, unknown>>
      | undefined
    const pattern = new RegExp(String(properties?.url?.pattern))
    expect(pattern.test("https://example.com/")).toBe(true)
    expect(pattern.test("javascript:alert(1)")).toBe(false)
    expect(pattern.test("DATA:text/plain,secret")).toBe(false)
    expect(pattern.test("VbScRiPt:msgbox(1)")).toBe(false)
  })

  test("generates serializable JSON Schema for all commands, including DOM and waitFor", () => {
    const manifest = createBrowserApiManifest()
    expect(manifest.commands).toHaveLength(24)
    expect(manifest.commands.map((entry) => entry.method))
      .toEqual([...BROWSER_CONTRACT_COMMAND_METHODS])

    const dom = manifest.commands.find((entry) =>
      entry.method === "page.domTree"
    )
    const waitFor = manifest.commands.find((entry) =>
      entry.method === "page.waitFor"
    )
    expect(dom?.commandResultSchema).toMatchObject({ type: "object" })
    expect(waitFor?.commandParamsSchema).toMatchObject({
      anyOf: expect.arrayContaining([
        expect.objectContaining({
          type: "object",
          required: expect.arrayContaining(["tabId"]),
          additionalProperties: false,
        }),
      ]),
    })
    const waitBranches = waitFor?.commandParamsSchema.anyOf as
      | Array<{
          required?: string[]
          properties?: Record<string, Record<string, unknown>>
        }>
      | undefined
    const selectorBranch = waitBranches?.find((branch) =>
      branch.required?.includes("selector")
    )
    expect(selectorBranch?.properties?.selector).toMatchObject({
      minLength: 1,
      pattern: "\\S",
    })
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest)
  })

  test("requires advertised capabilities to use canonical contract order", () => {
    const canonical = createBrowserBackendInfo({
      connected: true,
      commands: ["tabs.list", "page.screenshot"],
    })
    expect(BrowserBackendInfo.safeParse({
      ...canonical,
      capabilities: {
        ...canonical.capabilities,
        commands: ["page.screenshot", "tabs.list"],
      },
    }).success).toBe(false)
  })

  test("builds one exact getInfo result from backend capabilities", () => {
    const backend = createBrowserBackendInfo({
      connected: true,
      protocolVersion: 1,
      backendVersion: "0.1.1",
      instanceID: "extension-instance",
      commands: ["tabs.list"],
    })
    const info = createBrowserGetInfoResult(backend)

    expect(BrowserBackendInfo.parse(backend)).toEqual(backend)
    expect(BrowserGetInfoResult.parse(info)).toEqual(info)
    expect(info.backend).toMatchObject({
      contractVersion: 2,
      browserId: "extension",
      kind: "extension",
      connected: true,
    })
    expect(info.apiManifest.commands.map((entry) => entry.method))
      .toEqual(["tabs.list"])
    expect(info.documentationManifest.entries.map((entry) => entry.method))
      .toEqual(["tabs.list"])
  })

  test("publishes a stable, unique contract error code set", () => {
    expect(new Set(BROWSER_CONTRACT_ERROR_CODES).size)
      .toBe(BROWSER_CONTRACT_ERROR_CODES.length)
    expect(BROWSER_CONTRACT_ERROR_CODES).toContain("PERMISSION_DENIED")
    expect(BROWSER_CONTRACT_ERROR_CODES).toContain("TAB_NOT_OWNED")
    expect(BROWSER_CONTRACT_ERROR_CODES).toContain("DEADLINE_EXCEEDED")
    expect(BROWSER_CONTRACT_ERROR_CODES).toContain("CANCELLED")
  })
})
