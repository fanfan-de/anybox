import { describe, expect, test } from "vitest"

import {
  BROWSER_CONTRACT_COMMAND_METHODS,
  BROWSER_CONTRACT_ERROR_CODES,
  BROWSER_CONTRACT_SUPPORTED_VERSIONS,
  BROWSER_CONTRACT_V3_PLAYWRIGHT_COMMAND_METHODS,
  BROWSER_CONTRACT_VERSION,
  BrowserBackendInfo,
  BrowserContractCommandMethod,
  BrowserContractCommandRegistry,
  BrowserContractValidationError,
  BrowserLocatorPlanV3,
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

const locatorPlan = {
  framePath: [],
  expression: {
    kind: "role",
    role: "button",
    name: { type: "string", value: "Save", exact: true },
  },
} as const

const eventID = "00000000-0000-4000-8000-000000000001"

const validParams = {
  "tabs.list": {},
  "tabs.listUser": {},
  "tabs.open": { url: "https://example.com/", active: true },
  "tabs.claim": { tabId: 7 },
  "tabs.activate": { tabId: 7 },
  "tabs.goto": { tabId: 7, url: "https://example.com/next" },
  "tabs.back": { tabId: 7 },
  "tabs.forward": { tabId: 7 },
  "tabs.reload": { tabId: 7 },
  "tabs.close": { tabId: 7 },
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
  "playwright.domSnapshot": {
    tabId: 7,
    maxNodes: 1_000,
    maxChars: 100_000,
  },
  "playwright.elementInfo": { tabId: 7, x: 10, y: 20 },
  "playwright.locator.count": { tabId: 7, plan: locatorPlan },
  "playwright.locator.allTextContents": { tabId: 7, plan: locatorPlan },
  "playwright.locator.textContent": { tabId: 7, plan: locatorPlan },
  "playwright.locator.innerText": { tabId: 7, plan: locatorPlan },
  "playwright.locator.inputValue": { tabId: 7, plan: locatorPlan },
  "playwright.locator.getAttribute": {
    tabId: 7,
    plan: locatorPlan,
    name: "aria-label",
  },
  "playwright.locator.isVisible": { tabId: 7, plan: locatorPlan },
  "playwright.locator.isEnabled": { tabId: 7, plan: locatorPlan },
  "playwright.locator.waitFor": {
    tabId: 7,
    plan: locatorPlan,
    state: "visible",
  },
  "playwright.locator.click": {
    tabId: 7,
    plan: locatorPlan,
    button: "left",
  },
  "playwright.locator.dblclick": {
    tabId: 7,
    plan: locatorPlan,
    button: "left",
  },
  "playwright.locator.fill": {
    tabId: 7,
    plan: locatorPlan,
    value: "hello",
    sensitive: false,
  },
  "playwright.locator.type": {
    tabId: 7,
    plan: locatorPlan,
    value: "hello",
    sensitive: false,
  },
  "playwright.locator.press": {
    tabId: 7,
    plan: locatorPlan,
    value: "Enter",
  },
  "playwright.locator.selectOption": {
    tabId: 7,
    plan: locatorPlan,
    values: ["one"],
  },
  "playwright.locator.setChecked": {
    tabId: 7,
    plan: locatorPlan,
    checked: true,
  },
  "playwright.waitForNavigation": {
    tabId: 7,
    fromGeneration: 1,
    waitUntil: "load",
  },
  "playwright.waitForLoadState": { tabId: 7, state: "load" },
  "playwright.waitForURL": {
    tabId: 7,
    url: "https://example.com/",
    waitUntil: "load",
  },
  "playwright.waitForEvent": { tabId: 7, event: "download" },
  "playwright.download.path": { tabId: 7, eventID },
  "playwright.fileChooser.setFiles": {
    tabId: 7,
    eventID,
    files: ["C:\\tmp\\upload.txt"],
  },
} as const satisfies Record<BrowserContractCommandMethodValue, unknown>

const playwrightResultBase = {
  tabId: 7,
  url: tab.url,
  title: tab.title,
  documentGeneration: 1,
} as const

const validResults = {
  "tabs.list": { tabs: [tab] },
  "tabs.listUser": { tabs: [tab] },
  "tabs.open": tab,
  "tabs.claim": tab,
  "tabs.activate": tab,
  "tabs.goto": tab,
  "tabs.back": tab,
  "tabs.forward": tab,
  "tabs.reload": tab,
  "tabs.close": { tabId: 7, closed: true },
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
  "playwright.domSnapshot": {
    ...playwrightResultBase,
    snapshot: "- button \"Save\"",
    nodeCount: 1,
    truncated: false,
  },
  "playwright.elementInfo": {
    ...playwrightResultBase,
    elements: [],
  },
  "playwright.locator.count": {
    ...playwrightResultBase,
    count: 1,
  },
  "playwright.locator.allTextContents": {
    ...playwrightResultBase,
    values: ["Save"],
  },
  "playwright.locator.textContent": {
    ...playwrightResultBase,
    value: "Save",
  },
  "playwright.locator.innerText": {
    ...playwrightResultBase,
    value: "Save",
  },
  "playwright.locator.inputValue": {
    ...playwrightResultBase,
    value: "hello",
  },
  "playwright.locator.getAttribute": {
    ...playwrightResultBase,
    value: "Save",
  },
  "playwright.locator.isVisible": {
    ...playwrightResultBase,
    value: true,
  },
  "playwright.locator.isEnabled": {
    ...playwrightResultBase,
    value: true,
  },
  "playwright.locator.waitFor": {
    ...playwrightResultBase,
    matched: true,
    state: "visible",
  },
  "playwright.locator.click": {
    ...playwrightResultBase,
    dispatched: true,
  },
  "playwright.locator.dblclick": {
    ...playwrightResultBase,
    dispatched: true,
  },
  "playwright.locator.fill": {
    ...playwrightResultBase,
    dispatched: true,
  },
  "playwright.locator.type": {
    ...playwrightResultBase,
    dispatched: true,
  },
  "playwright.locator.press": {
    ...playwrightResultBase,
    dispatched: true,
  },
  "playwright.locator.selectOption": {
    ...playwrightResultBase,
    dispatched: true,
  },
  "playwright.locator.setChecked": {
    ...playwrightResultBase,
    dispatched: true,
  },
  "playwright.waitForNavigation": {
    ...playwrightResultBase,
    matched: true,
    state: "load",
  },
  "playwright.waitForLoadState": {
    ...playwrightResultBase,
    matched: true,
    state: "load",
  },
  "playwright.waitForURL": {
    ...playwrightResultBase,
    matched: true,
    state: "load",
  },
  "playwright.waitForEvent": {
    ...playwrightResultBase,
    event: "download",
    eventID,
  },
  "playwright.download.path": {
    ...playwrightResultBase,
    path: "C:\\tmp\\download.bin",
  },
  "playwright.fileChooser.setFiles": {
    ...playwrightResultBase,
    fileCount: 1,
  },
} as const satisfies Record<BrowserContractCommandMethodValue, unknown>

describe("Browser Contract command registry", () => {
  test("publishes one strict v3 registry", () => {
    expect(BROWSER_CONTRACT_VERSION).toBe(3)
    expect(BROWSER_CONTRACT_SUPPORTED_VERSIONS).toEqual([3])
    expect(BROWSER_CONTRACT_V3_PLAYWRIGHT_COMMAND_METHODS).toHaveLength(24)
    expect(BROWSER_CONTRACT_COMMAND_METHODS).toHaveLength(48)
    expect(Object.keys(BrowserContractCommandRegistry)).toHaveLength(48)
    expect(new Set(Object.keys(BrowserContractCommandRegistry)))
      .toEqual(new Set(BROWSER_CONTRACT_COMMAND_METHODS))
    expect(BrowserContractCommandMethod.safeParse("page.executeScript").success)
      .toBe(false)
    expect(BrowserContractCommandMethod.safeParse("cdp.send").success).toBe(false)
    expect(() => parseBrowserCommandParams(
      "tabs.claim",
      { tabId: 7 },
      2,
    )).toThrowError(expect.objectContaining({
      code: "COMMAND_NOT_SUPPORTED",
    }))
    expect(() => parseBrowserCommandParams(
      "playwright.domSnapshot",
      { tabId: 7 },
      4,
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
    for (const [method, params] of [
      ["tabs.open", { url }],
      ["tabs.goto", { tabId: 7, url }],
    ] as const) {
      expect(() => parseBrowserCommandParams(method, params))
        .toThrowError(expect.objectContaining({
          code: "INVALID_COMMAND_PARAMS",
        }))
    }
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

  test("bounds immutable locator plans and rejects private selector engines", () => {
    expect(BrowserLocatorPlanV3.parse(locatorPlan)).toEqual(locatorPlan)
    expect(BrowserLocatorPlanV3.safeParse({
      framePath: [],
      expression: {
        kind: "nth",
        source: locatorPlan.expression,
        index: -2,
      },
    }).success).toBe(true)
    expect(BrowserLocatorPlanV3.safeParse({
      framePath: ["internal:control=enter-frame"],
      expression: locatorPlan.expression,
    }).success).toBe(false)
    expect(BrowserLocatorPlanV3.safeParse({
      framePath: [],
      expression: {
        kind: "selector",
        value: "text=/((a+)+)$/",
      },
    }).success).toBe(false)
    expect(BrowserLocatorPlanV3.safeParse({
      framePath: Array.from({ length: 17 }, () => "iframe"),
      expression: locatorPlan.expression,
    }).success).toBe(false)

    let expression: unknown = {
      kind: "selector",
      value: "button",
    }
    for (let index = 0; index < 64; index += 1) {
      expression = { kind: "nth", source: expression, index: 0 }
    }
    expect(BrowserLocatorPlanV3.safeParse({
      framePath: [],
      expression,
    }).success).toBe(false)
    let extremelyDeep: unknown = {
      kind: "selector",
      value: "button",
    }
    for (let index = 0; index < 10_000; index += 1) {
      extremelyDeep = { kind: "nth", source: extremelyDeep, index: 0 }
    }
    expect(() => BrowserLocatorPlanV3.safeParse({
      framePath: [],
      expression: extremelyDeep,
    })).not.toThrow()
    expect(BrowserLocatorPlanV3.safeParse({
      framePath: [],
      expression: extremelyDeep,
    }).success).toBe(false)
    const cyclic: Record<string, unknown> = {
      kind: "nth",
      index: 0,
    }
    cyclic.source = cyclic
    expect(BrowserLocatorPlanV3.safeParse({
      framePath: [],
      expression: cyclic,
    }).success).toBe(false)
    expect(BrowserLocatorPlanV3.safeParse({
      framePath: [],
      expression: {
        kind: "text",
        matcher: {
          type: "regex",
          source: "(",
          flags: "u",
        },
      },
    }).success).toBe(false)
    expect(BrowserLocatorPlanV3.safeParse({
      framePath: [],
      expression: {
        kind: "text",
        matcher: {
          type: "regex",
          source: "(a|aa){100}$",
          flags: "u",
        },
      },
    }).success).toBe(false)
    expect(BrowserLocatorPlanV3.safeParse({
      framePath: [],
      expression: {
        kind: "text",
        matcher: {
          type: "regex",
          source: "(a{1,10}){10}$",
          flags: "u",
        },
      },
    }).success).toBe(false)
    expect(BrowserLocatorPlanV3.safeParse({
      framePath: [],
      expression: {
        kind: "text",
        matcher: {
          type: "regex",
          source: "a{1001}",
          flags: "u",
        },
      },
    }).success).toBe(false)
    expect(BrowserLocatorPlanV3.safeParse({
      framePath: [],
      expression: {
        kind: "text",
        matcher: {
          type: "regex",
          source: String.raw`(save)\1`,
          flags: "u",
        },
      },
    }).success).toBe(false)
    expect(BrowserLocatorPlanV3.safeParse({
      framePath: [],
      expression: {
        kind: "text",
        matcher: {
          type: "regex",
          source: "(a+)+$",
          flags: "u",
        },
      },
    }).success).toBe(false)
    expect(BrowserLocatorPlanV3.safeParse({
      framePath: [],
      expression: {
        kind: "text",
        matcher: {
          type: "regex",
          source: "save",
          flags: "uv",
        },
      },
    }).success).toBe(false)
    expect(() => parseBrowserCommandParams(
      "playwright.locator.press",
      {
        tabId: 7,
        plan: locatorPlan,
        value: "Unsupported+Enter",
      },
    )).toThrow(expect.objectContaining({
      code: "INVALID_COMMAND_PARAMS",
    }))
  })
})

describe("Browser Contract capabilities and manifests", () => {
  test("defaults all advanced features to false", () => {
    const capabilities = createBrowserBackendCapabilities()
    expect(capabilities.commands).toEqual([])
    expect(capabilities.features).toEqual({
      ownership: false,
      claim: false,
      playwrightLocator: false,
      playwrightApiRevision: 0,
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
    expect(manifest.commands).toHaveLength(48)
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

  test("advertises the Playwright surface atomically", () => {
    expect(() => createBrowserBackendCapabilities({
      commands: ["playwright.domSnapshot"],
    })).toThrow()
    expect(() => createBrowserBackendCapabilities({
      commands: BROWSER_CONTRACT_V3_PLAYWRIGHT_COMMAND_METHODS,
    })).toThrow()

    const capabilities = createBrowserBackendCapabilities({
      commands: BROWSER_CONTRACT_V3_PLAYWRIGHT_COMMAND_METHODS,
      features: {
        playwrightLocator: true,
        playwrightApiRevision: 1,
        playwrightEngineVersion: "1.61.1",
      },
    })
    expect(capabilities.features).toMatchObject({
      playwrightLocator: true,
      playwrightApiRevision: 1,
      playwrightEngineVersion: "1.61.1",
    })
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
      contractVersion: 3,
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
    expect(BROWSER_CONTRACT_ERROR_CODES).toContain("LOCATOR_STRICT_VIOLATION")
    expect(BROWSER_CONTRACT_ERROR_CODES).toContain("ACTION_OUTCOME_UNKNOWN")
    expect(BROWSER_CONTRACT_ERROR_CODES).toContain("EVENT_EXPIRED")
  })
})
