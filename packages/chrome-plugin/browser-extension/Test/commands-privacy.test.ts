import { beforeAll, beforeEach, describe, expect, test } from "bun:test"
import type {
  BrowserExtensionCommandContext,
  BrowserExtensionCommandMethod,
} from "@anybox/chrome-shared/browser-extension"

type Rect = {
  x: number
  y: number
  width: number
  height: number
  left: number
  top: number
}

class FakeElement {
  readonly attributes = new Map<string, string>()
  readonly tagName: string
  textContent = ""
  innerText = ""
  name = ""
  type: string | undefined = ""
  placeholder = ""
  value = ""
  href = ""
  id = ""
  autocomplete = ""
  disabled = false

  constructor(tagName: string, values: Partial<FakeElement> = {}) {
    this.tagName = tagName.toUpperCase()
    Object.assign(this, values)
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value)
  }

  getBoundingClientRect(): Rect {
    return {
      x: 10,
      y: 20,
      width: 120,
      height: 24,
      left: 10,
      top: 20,
    }
  }
}

const fields: FakeElement[] = []
const links: FakeElement[] = []
const cdpResponses = new Map<string, unknown>()
let currentTabUrl = "https://fixture.invalid/form"
let queriedTabs: Array<Record<string, unknown>> = [{ id: 7, active: true }]
let currentWindowTabId = 7
let tabOperations: Array<Record<string, unknown>> = []
const sessionStorage: Record<string, unknown> = {}
const localStorage: Record<string, unknown> = {}
const tabGroupByTab = new Map<number, number>()
let groupOperationFails = false
const commandContext = {
  sessionID: "privacy-session",
  turnID: "privacy-turn",
  messageID: "privacy-message",
  toolCallID: "privacy-tool",
  browserID: "extension:privacy-instance",
  extensionInstanceID: "privacy-instance",
} satisfies BrowserExtensionCommandContext

function leaseFixture(tabId: number) {
  const now = Date.now()
  return {
    tabId,
    source: "agent",
    sessionID: commandContext.sessionID,
    turnID: commandContext.turnID,
    state: "active",
    extensionInstanceID: commandContext.extensionInstanceID,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + 60_000,
  }
}

function installLeases(...tabIds: number[]) {
  sessionStorage["anybox.browser.tabLeases.v4"] = Object.fromEntries(
    tabIds.map((tabId) => [String(tabId), leaseFixture(tabId)]),
  )
}

function installPage(
  fieldsForPage: FakeElement[],
  bodyText = "Account form",
  linksForPage: FakeElement[] = [],
  tabUrl = "https://fixture.invalid/form",
) {
  fields.splice(0, fields.length, ...fieldsForPage)
  links.splice(0, links.length, ...linksForPage)
  currentTabUrl = tabUrl
  Object.assign(globalThis, {
    document: {
      body: { innerText: bodyText },
      getElementById() {
        return null
      },
      querySelectorAll(selector: string) {
        if (selector === "a[href]") return links
        if (selector.includes("button, [role='button']")) return []
        if (selector.includes("a[href]") && selector.includes("input")) return [...links, ...fields]
        if (selector.includes("input") || selector.includes("[contenteditable]")) return fields
        return []
      },
    },
    window: {
      getComputedStyle() {
        return { visibility: "visible", display: "block" }
      },
    },
  })
}

let rawHandleBrowserCommand: (
  method: BrowserExtensionCommandMethod,
  params?: unknown,
  options?: {
    context?: BrowserExtensionCommandContext
    signal?: AbortSignal
  },
) => Promise<unknown>
let releaseAllTabLeases: () => Promise<{
  closedTabIds: number[]
  releasedTabIds: number[]
  deliverableTabIds: number[]
  handoffTabIds: number[]
  detachedTabIds: number[]
}>

function handleBrowserCommand(
  method: BrowserExtensionCommandMethod,
  params?: unknown,
  options: {
    context?: BrowserExtensionCommandContext
    signal?: AbortSignal
  } = {},
) {
  return rawHandleBrowserCommand(method, params, {
    context: commandContext,
    ...options,
  })
}

beforeAll(async () => {
  Object.assign(globalThis, {
    chrome: {
      debugger: {
        async attach() {},
        async sendCommand(_target: unknown, method: string) {
          return cdpResponses.get(method)
        },
        onDetach: { addListener() {} },
      },
      scripting: {
        async executeScript(input: { func: (...args: unknown[]) => unknown; args?: unknown[] }) {
          return [{ result: input.func(...(input.args ?? [])) }]
        },
      },
      tabs: {
        async create(input: { url: string; active: boolean }) {
          return { id: 8, ...input }
        },
        async get(tabId: number) {
          return {
            id: tabId,
            windowId: 1,
            groupId: tabGroupByTab.get(tabId) ?? -1,
            title: "Fixture",
            url: currentTabUrl,
          }
        },
        async update(tabId: number, properties: Record<string, unknown>) {
          tabOperations.push({ method: "update", tabId, properties })
          if (typeof properties.url === "string") currentTabUrl = properties.url
          return {
            id: tabId,
            title: "Fixture",
            url: currentTabUrl,
            active: properties.active === true,
          }
        },
        async goBack(tabId: number) {
          tabOperations.push({ method: "goBack", tabId })
        },
        async goForward(tabId: number) {
          tabOperations.push({ method: "goForward", tabId })
        },
        async reload(tabId: number) {
          tabOperations.push({ method: "reload", tabId })
        },
        async query(query: { active?: boolean; currentWindow?: boolean }) {
          if (query.active && query.currentWindow) {
            return queriedTabs.filter((tab) => tab.id === currentWindowTabId)
          }
          return queriedTabs
        },
        async remove(tabId: number | number[]) {
          tabOperations.push({ method: "remove", tabId })
          const tabIds = Array.isArray(tabId) ? tabId : [tabId]
          tabIds.forEach((id) => tabGroupByTab.delete(id))
        },
        async group(input: { groupId?: number; tabIds: number[] }) {
          if (groupOperationFails) throw new Error("Grouping failed")
          const groupId = input.groupId ?? 1
          input.tabIds.forEach((tabId) => tabGroupByTab.set(tabId, groupId))
          return groupId
        },
        async ungroup(tabId: number) {
          tabGroupByTab.delete(tabId)
        },
        async sendMessage() {},
      },
      storage: {
        session: {
          async get(key: string) {
            return { [key]: structuredClone(sessionStorage[key]) }
          },
          async set(values: Record<string, unknown>) {
            Object.assign(sessionStorage, structuredClone(values))
          },
          async remove(key: string) {
            delete sessionStorage[key]
          },
        },
        local: {
          async get(key: string) {
            return { [key]: structuredClone(localStorage[key]) }
          },
          async set(values: Record<string, unknown>) {
            Object.assign(localStorage, structuredClone(values))
          },
        },
      },
      tabGroups: {
        async get(groupId: number) {
          if (![...tabGroupByTab.values()].includes(groupId)) {
            throw new Error("Group not found")
          }
          return { id: groupId, windowId: 1 }
        },
        async update(groupId: number, values: Record<string, unknown>) {
          return { id: groupId, windowId: 1, ...values }
        },
      },
    },
  })

  const commands = await import("../src/background/commands.ts")
  rawHandleBrowserCommand = commands.handleBrowserCommand
  releaseAllTabLeases = commands.releaseAllTabLeases
})

beforeEach(() => {
  cdpResponses.clear()
  queriedTabs = [{ id: 7, active: true }]
  currentWindowTabId = 7
  tabOperations = []
  groupOperationFails = false
  tabGroupByTab.clear()
  for (const key of Object.keys(localStorage)) delete localStorage[key]
  for (const key of Object.keys(sessionStorage)) delete sessionStorage[key]
  installLeases(7)
  installPage([])
})

describe("browser command contract defense", () => {
  test("strictly validates tabs.list parameters and extension results", async () => {
    await expect(handleBrowserCommand("tabs.list", { unexpected: true })).rejects.toMatchObject({
      code: "INVALID_COMMAND_PARAMS",
    })

    queriedTabs = [{
      id: 7,
      active: true,
      title: "Fixture",
      url: "https://fixture.invalid/private/path?token=secret",
    }]
    await expect(handleBrowserCommand("tabs.list")).resolves.toMatchObject({
      tabs: [{
        id: 7,
        active: true,
        title: "Fixture",
        url: "https://fixture.invalid/[redacted-path]?[redacted]",
        lease: {
          source: "agent",
          sessionID: commandContext.sessionID,
          state: "active",
        },
      }],
    })

    queriedTabs = [{ id: 0, active: true }]
    await expect(handleBrowserCommand("tabs.list")).resolves.toEqual({
      tabs: [],
    })
  })

  test("executes a v4 tab write, groups it, and records its lease", async () => {
    await expect(handleBrowserCommand("tabs.open", {
      url: "https://fixture.invalid/write",
    })).resolves.toMatchObject({
      id: 8,
      active: true,
      url: "https://fixture.invalid/[redacted-path]",
    })
    expect(
      (sessionStorage["anybox.browser.tabLeases.v4"] as Record<string, unknown>)["8"],
    ).toMatchObject({
      tabId: 8,
      sessionID: commandContext.sessionID,
      extensionInstanceID: commandContext.extensionInstanceID,
    })
    expect(tabGroupByTab.get(8)).toBe(1)
  })

  test("rolls back a newly opened tab and lease when grouping fails", async () => {
    groupOperationFails = true
    await expect(handleBrowserCommand("tabs.open", {
      url: "https://fixture.invalid/write",
    })).rejects.toMatchObject({
      code: "COMMAND_FAILED",
      retryable: true,
    })
    expect(tabOperations).toContainEqual({ method: "remove", tabId: 8 })
    expect(
      (sessionStorage["anybox.browser.tabLeases.v4"] as Record<string, unknown>)
        ["8"],
    ).toBeUndefined()
  })

  test("finalizes deliverable, handoff, temporary, and user tabs", async () => {
    installLeases(7, 8, 9, 10)
    const leases = sessionStorage["anybox.browser.tabLeases.v4"] as
      Record<string, Record<string, unknown>>
    leases["10"]!.source = "user"
    queriedTabs = [7, 8, 9, 10].map((id) => ({
      id,
      windowId: 1,
      active: id === 7,
    }))
    tabGroupByTab.set(7, 1)
    tabGroupByTab.set(8, 1)
    tabGroupByTab.set(9, 1)
    tabGroupByTab.set(10, 99)
    localStorage["anybox.browser.tabGroups.v4"] = {
      [commandContext.sessionID!]: {
        sessionID: commandContext.sessionID,
        extensionInstanceID: commandContext.extensionInstanceID,
        name: "Publish",
        groupId: 1,
        windowId: 1,
        color: "blue",
        updatedAt: Date.now(),
      },
    }

    await expect(handleBrowserCommand("tabs.finalize", {
      keep: [
        { tabId: 8, status: "deliverable" },
        { tabId: 9, status: "handoff" },
      ],
    })).resolves.toEqual({
      sessionID: commandContext.sessionID,
      closedTabIds: [7],
      releasedTabIds: [10],
      deliverableTabIds: [8],
      handoffTabIds: [9],
      detachedTabIds: [7, 10, 8, 9],
    })

    expect(tabOperations).toContainEqual({ method: "remove", tabId: [7] })
    expect(tabGroupByTab.get(8)).toBeUndefined()
    expect(tabGroupByTab.get(9)).toBe(1)
    expect(tabGroupByTab.get(10)).toBe(99)
    expect(
      Object.keys(
        sessionStorage["anybox.browser.tabLeases.v4"] as Record<string, unknown>,
      ),
    ).toEqual(["9"])
    expect(
      (sessionStorage["anybox.browser.tabLeases.v4"] as Record<
        string,
        Record<string, unknown>
      >)["9"],
    ).toMatchObject({ state: "handoff" })
  })

  test("stops control while preserving every open tab", async () => {
    installLeases(7, 8)
    const leases = sessionStorage["anybox.browser.tabLeases.v4"] as
      Record<string, Record<string, unknown>>
    leases["8"]!.source = "user"
    queriedTabs = [7, 8].map((id) => ({
      id,
      windowId: 1,
      active: id === 7,
    }))
    tabGroupByTab.set(7, 1)
    tabGroupByTab.set(8, 99)
    localStorage["anybox.browser.tabGroups.v4"] = {
      [commandContext.sessionID!]: {
        sessionID: commandContext.sessionID,
        extensionInstanceID: commandContext.extensionInstanceID,
        name: "Publish",
        groupId: 1,
        windowId: 1,
        color: "blue",
        updatedAt: Date.now(),
      },
    }

    await expect(releaseAllTabLeases()).resolves.toEqual({
      sessionID: "user-stop",
      closedTabIds: [],
      releasedTabIds: [7, 8],
      deliverableTabIds: [],
      handoffTabIds: [],
      detachedTabIds: [7, 8],
    })

    expect(tabOperations).not.toContainEqual({
      method: "remove",
      tabId: expect.anything(),
    })
    expect(tabGroupByTab.get(7)).toBeUndefined()
    expect(tabGroupByTab.get(8)).toBe(99)
    expect(
      Object.keys(
        sessionStorage["anybox.browser.tabLeases.v4"] as Record<string, unknown>,
      ),
    ).toEqual([])
  })

  test("navigates and closes a leased tab through the explicit tab APIs", async () => {
    await expect(handleBrowserCommand("tabs.goto", {
      tabId: 7,
      url: "https://fixture.invalid/private/next?token=secret",
    })).resolves.toMatchObject({
      id: 7,
      url: "https://fixture.invalid/[redacted-path]?[redacted]",
    })
    await expect(handleBrowserCommand("tabs.back", { tabId: 7 }))
      .resolves.toMatchObject({ id: 7 })
    await expect(handleBrowserCommand("tabs.forward", { tabId: 7 }))
      .resolves.toMatchObject({ id: 7 })
    await expect(handleBrowserCommand("tabs.reload", { tabId: 7 }))
      .resolves.toMatchObject({ id: 7 })
    await expect(handleBrowserCommand("tabs.close", { tabId: 7 }))
      .resolves.toEqual({ tabId: 7, closed: true })

    expect(tabOperations).toEqual([
      {
        method: "update",
        tabId: 7,
        properties: {
          url: "https://fixture.invalid/private/next?token=secret",
        },
      },
      { method: "goBack", tabId: 7 },
      { method: "goForward", tabId: 7 },
      { method: "reload", tabId: 7 },
      { method: "remove", tabId: 7 },
    ])
    expect(
      (sessionStorage["anybox.browser.tabLeases.v4"] as Record<string, unknown>)["7"],
    ).toBeUndefined()
  })

  test("aborts an in-flight wait when the Browser Host connection closes", async () => {
    const controller = new AbortController()
    const pending = handleBrowserCommand("page.waitFor", {
      tabId: 7,
      urlIncludes: "never-matches",
      timeoutMs: 5_000,
    }, {
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 20)

    await expect(pending).rejects.toMatchObject({
      code: "BACKEND_UNAVAILABLE",
      retryable: true,
    })
  })

  test("orders the selected current-window tab before active tabs in other windows", async () => {
    queriedTabs = [
      { id: 7, windowId: 1, active: true },
      { id: 9, windowId: 2, active: true },
    ]
    currentWindowTabId = 9
    installLeases(7, 9)

    await expect(handleBrowserCommand("tabs.list")).resolves.toMatchObject({
      tabs: [
        { id: 9, windowId: 2, active: true },
        { id: 7, windowId: 1, active: true },
      ],
    })
  })

  test("defensively rejects arbitrary JavaScript and raw CDP", async () => {
    await expect(handleBrowserCommand("tabs.open", {
      url: "javascript:document.title='bypass'",
    })).rejects.toMatchObject({
      code: "INVALID_COMMAND_PARAMS",
    })
    await expect(handleBrowserCommand("page.executeScript", {
      tabId: 7,
      script: "document.title",
    })).rejects.toMatchObject({
      code: "COMMAND_NOT_SUPPORTED",
    })
    await expect(handleBrowserCommand("cdp.send", {
      tabId: 7,
      method: "Runtime.evaluate",
      params: { expression: "document.title" },
    })).rejects.toMatchObject({
      code: "COMMAND_NOT_SUPPORTED",
    })
  })
})

describe("browser snapshot privacy", () => {
  test("omits password, OTP, token, and card values from the compact snapshot", async () => {
    installPage([
      new FakeElement("input", { type: "password", name: "password", value: "password-secret" }),
      new FakeElement("input", { type: "text", name: "otp", value: "482913" }),
      new FakeElement("input", { type: "text", name: "access_token", value: "token-secret" }),
      new FakeElement("input", { type: "text", name: "accessToken", value: "camel-token-secret" }),
      new FakeElement("input", { type: "text", name: "otpCode", value: "731955" }),
      new FakeElement("input", { type: "text", name: "cardNumber", value: "5555555555554444" }),
      new FakeElement("input", { type: "text", name: "oneTimeCode", value: "246810" }),
      new FakeElement("input", { type: "text", autocomplete: "cc-number", value: "4111111111111111" }),
      new FakeElement("input", { type: "hidden", name: "state", value: "hidden-secret" }),
      new FakeElement("input", { type: "text", name: "username", value: "alice" }),
    ])

    const result = await handleBrowserCommand("page.snapshot", { tabId: 7 })
    const serialized = JSON.stringify(result)

    expect(serialized).not.toContain("password-secret")
    expect(serialized).not.toContain("482913")
    expect(serialized).not.toContain("token-secret")
    expect(serialized).not.toContain("camel-token-secret")
    expect(serialized).not.toContain("731955")
    expect(serialized).not.toContain("5555555555554444")
    expect(serialized).not.toContain("246810")
    expect(serialized).not.toContain("4111111111111111")
    expect(serialized).not.toContain("hidden-secret")
    expect(serialized).not.toContain("alice")
    expect(serialized).toContain("username")
  })

  test("never derives an interactive element name or value from a sensitive field value", async () => {
    installPage([
      new FakeElement("input", { type: "password", value: "password-secret" }),
      new FakeElement("input", { type: "text", name: "otp", value: "482913" }),
      new FakeElement("input", { type: "text", name: "accessToken", value: "camel-token-secret" }),
      new FakeElement("input", { type: "text", name: "username", value: "alice" }),
    ])

    const result = await handleBrowserCommand("page.interactiveSnapshot", { tabId: 7 })
    const serialized = JSON.stringify(result)

    expect(serialized).not.toContain("password-secret")
    expect(serialized).not.toContain("482913")
    expect(serialized).not.toContain("camel-token-secret")
    expect(serialized).not.toContain("alice")
    expect(result).toMatchObject({
      elements: [
        { sensitive: true, value: undefined, name: undefined },
        { sensitive: true, value: undefined, name: undefined },
        { sensitive: true, value: undefined, name: undefined },
        { value: undefined, name: undefined, sensitive: undefined },
      ],
    })
  })

  test("defaults editable values to private while classifying multilingual security labels", async () => {
    installPage([
      new FakeElement("input", { type: "text", name: "verificationCode", value: "verification-secret" }),
      new FakeElement("input", { type: "text", name: "securityCode", value: "security-secret" }),
      new FakeElement("input", { type: "text", name: "pin", value: "pin-secret" }),
      new FakeElement("input", { type: "text", name: "验证码", value: "chinese-secret" }),
      new FakeElement("input", { type: "text", name: "secretary", value: "secretary-value" }),
      new FakeElement("input", { type: "text", name: "cardinal", value: "cardinal-value" }),
    ])

    const compact = await handleBrowserCommand("page.snapshot", { tabId: 7 })
    const interactive = await handleBrowserCommand("page.interactiveSnapshot", { tabId: 7 }) as {
      elements: Array<{ sensitive?: boolean; value?: string }>
    }
    const serialized = JSON.stringify({ compact, interactive })

    for (const value of [
      "verification-secret",
      "security-secret",
      "pin-secret",
      "chinese-secret",
      "secretary-value",
      "cardinal-value",
    ]) {
      expect(serialized).not.toContain(value)
    }
    expect(interactive.elements.slice(0, 4).every((element) => element.sensitive === true)).toBe(true)
    expect(interactive.elements.slice(4).every((element) => element.sensitive !== true)).toBe(true)
    expect(interactive.elements.every((element) => element.value === undefined)).toBe(true)
  })

  test("does not echo a private editable value through labels or placeholders", async () => {
    const field = new FakeElement("input", {
      type: "text",
      name: "code",
      value: "605183",
      placeholder: "605183",
    })
    field.setAttribute("aria-label", "605183")
    installPage([field], "Enter the code")

    const compact = await handleBrowserCommand("page.snapshot", { tabId: 7 })
    const interactive = await handleBrowserCommand("page.interactiveSnapshot", { tabId: 7 }) as {
      elements: Array<{
        name?: string
        placeholder?: string
        sensitive?: boolean
        value?: string
      }>
    }
    const serialized = JSON.stringify({ compact, interactive })

    expect(serialized).not.toContain("605183")
    expect(interactive.elements[0]).toMatchObject({
      name: undefined,
      placeholder: undefined,
      sensitive: undefined,
      value: undefined,
    })
  })

  test("redacts sensitive contenteditable text from compact and interactive snapshots", async () => {
    const editor = new FakeElement("div", {
      type: undefined,
      id: "api-token",
      textContent: "contenteditable-hidden-secret",
      innerText: "contenteditable-visible-secret",
    })
    editor.setAttribute("contenteditable", "plaintext-only")
    installPage([editor], "API token: contenteditable-visible-secret")

    const compact = await handleBrowserCommand("page.snapshot", { tabId: 7 })
    const interactive = await handleBrowserCommand("page.interactiveSnapshot", { tabId: 7 })
    const serialized = JSON.stringify({ compact, interactive })

    expect(serialized).not.toContain("contenteditable-visible-secret")
    expect(serialized).not.toContain("contenteditable-hidden-secret")
    expect(serialized).toContain("[redacted]")
    expect(interactive).toMatchObject({
      elements: [
        {
          tag: "div",
          sensitive: true,
          name: undefined,
          text: undefined,
          value: undefined,
        },
      ],
    })
  })

  test("redacts sensitive values in DOM attributes, descendant text, and accessibility output", async () => {
    cdpResponses.set("DOM.getDocument", {
      root: {
        nodeId: 1,
        nodeType: 9,
        nodeName: "#document",
        children: [
          {
            nodeId: 2,
            nodeType: 1,
            nodeName: "INPUT",
            localName: "input",
            attributes: ["type", "hidden", "name", "state", "value", "dom-hidden-secret"],
          },
          {
            nodeId: 3,
            backendNodeId: 42,
            nodeType: 1,
            nodeName: "DIV",
            localName: "div",
            attributes: [
              "id", "accessToken",
              "contenteditable", "true",
              "data-value", "dom-data-secret",
              "aria-valuetext", "dom-aria-secret",
            ],
            children: [
              {
                nodeId: 4,
                nodeType: 3,
                nodeName: "#text",
                nodeValue: "dom-token-secret",
              },
            ],
          },
          {
            nodeId: 5,
            nodeType: 1,
            nodeName: "INPUT",
            localName: "input",
            attributes: [
              "type", "text",
              "name", "verificationCode",
              "value", "dom-verification-secret",
            ],
          },
          {
            nodeId: 6,
            nodeType: 1,
            nodeName: "A",
            localName: "a",
            attributes: [
              "href", "https://fixture.invalid/reset-password/dom-path-secret",
            ],
          },
          {
            nodeId: 7,
            backendNodeId: 77,
            nodeType: 1,
            nodeName: "INPUT",
            localName: "input",
            attributes: [
              "type", "text",
              "name", "code",
              "value", "605183",
              "placeholder", "605183",
              "aria-label", "605183",
            ],
          },
          {
            nodeId: 8,
            nodeType: 1,
            nodeName: "IMG",
            localName: "img",
            attributes: [
              "srcset", "https://cdn.invalid/magic-link/srcset-secret 1x",
              "style", "background-image:url(https://cdn.invalid/reset/style-secret)",
            ],
          },
        ],
      },
    })
    cdpResponses.set("Accessibility.getFullAXTree", {
      nodes: [
        {
          nodeId: "ax-1",
          ignored: false,
          role: { value: "textbox" },
          name: { value: "Password" },
          value: { value: "ax-password-secret" },
          description: { value: "ax-description-secret" },
          properties: [
            { name: "valuetext", value: { value: "ax-property-secret" } },
          ],
        },
        {
          nodeId: "ax-2",
          backendDOMNodeId: 42,
          ignored: false,
          role: { value: "textbox" },
          name: { value: "Code" },
          value: { value: 482913 },
          childIds: ["ax-static"],
        },
        {
          nodeId: "ax-static",
          ignored: false,
          role: { value: "StaticText" },
          name: { value: "615902" },
          childIds: ["ax-inline"],
        },
        {
          nodeId: "ax-inline",
          ignored: false,
          role: { value: "InlineTextBox" },
          name: { value: "615902" },
        },
        {
          nodeId: "ax-neutral-editable",
          backendDOMNodeId: 77,
          ignored: false,
          role: { value: "textbox" },
          name: { value: "605183" },
          value: { value: 605183 },
          description: { value: "605183" },
        },
        {
          nodeId: "ax-3",
          ignored: false,
          role: { value: "link" },
          name: { value: "Continue" },
          properties: [
            {
              name: "url",
              value: { value: "https://fixture.invalid/magic-link/ax-path-secret" },
            },
          ],
        },
      ],
    })

    const dom = await handleBrowserCommand("page.domTree", { tabId: 7 })
    const accessibility = await handleBrowserCommand("page.accessibilityTree", { tabId: 7 })
    const serialized = JSON.stringify({ dom, accessibility })

    expect(serialized).not.toContain("dom-hidden-secret")
    expect(serialized).not.toContain("dom-token-secret")
    expect(serialized).not.toContain("dom-data-secret")
    expect(serialized).not.toContain("dom-aria-secret")
    expect(serialized).not.toContain("dom-verification-secret")
    expect(serialized).not.toContain("dom-path-secret")
    expect(serialized).not.toContain("srcset-secret")
    expect(serialized).not.toContain("style-secret")
    expect(serialized).not.toContain("ax-password-secret")
    expect(serialized).not.toContain("ax-description-secret")
    expect(serialized).not.toContain("ax-property-secret")
    expect(serialized).not.toContain("ax-path-secret")
    expect(serialized).not.toContain("482913")
    expect(serialized).not.toContain("615902")
    expect(serialized).not.toContain("605183")
    expect(serialized).toContain("[redacted]")
  })

  test("exposes only safe URL origins and hides local file paths", async () => {
    const link = new FakeElement("a", {
      href: "https://user:password@fixture.invalid/reset-password/link-path-secret?access_token=link-secret#link-fragment",
      textContent: "Continue",
      innerText: "Continue",
    })
    const fileLink = new FakeElement("a", {
      href: "file:///C:/Users/Alice/private/file-secret.txt",
      textContent: "Local file",
      innerText: "Local file",
    })
    installPage(
      [],
      "Continue",
      [link, fileLink],
      "https://fixture.invalid/magic-link/tab-path-secret?access_token=tab-secret#tab-fragment",
    )

    const compact = await handleBrowserCommand("page.snapshot", { tabId: 7 })
    const interactive = await handleBrowserCommand("page.interactiveSnapshot", { tabId: 7 })
    const serialized = JSON.stringify({ compact, interactive })

    expect(serialized).not.toContain("tab-secret")
    expect(serialized).not.toContain("tab-path-secret")
    expect(serialized).not.toContain("tab-fragment")
    expect(serialized).not.toContain("link-secret")
    expect(serialized).not.toContain("link-path-secret")
    expect(serialized).not.toContain("link-fragment")
    expect(serialized).not.toContain("user:password")
    expect(serialized).not.toContain("C:/Users/Alice")
    expect(serialized).not.toContain("file-secret")
    expect(serialized).toContain("[redacted-path]")
    expect(serialized).toContain("[redacted-url]")
    expect(serialized).toContain("[redacted]")
  })

  test("handles non-string values on sensitive ARIA textboxes without leaking or throwing", async () => {
    const progress = new FakeElement("progress", {
      type: undefined,
      name: "otpCode",
      value: 937155 as unknown as string,
    })
    progress.setAttribute("role", "textbox")
    installPage([progress], "Verification code")

    const compact = await handleBrowserCommand("page.snapshot", { tabId: 7 })
    const interactive = await handleBrowserCommand("page.interactiveSnapshot", { tabId: 7 })
    const serialized = JSON.stringify({ compact, interactive })

    expect(serialized).not.toContain("937155")
    expect(serialized).toContain("\"sensitive\":true")
  })
})
