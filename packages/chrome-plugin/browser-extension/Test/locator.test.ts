import { beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { BROWSER_CONTRACT_VERSION } from "@anybox/chrome-shared/browser-contract"
import type { BrowserExtensionCommandContext } from "@anybox/chrome-shared/browser-extension"
import { createLease } from "../src/background/lease-store"

type FakeRect = {
  x: number
  y: number
  width: number
  height: number
  left: number
  top: number
}

const visibleRect = (
  x = 10,
  y = 20,
  width = 120,
  height = 28,
): FakeRect => ({
  x,
  y,
  width,
  height,
  left: x,
  top: y,
})

class FakeEvent {
  readonly type: string

  constructor(type: string, readonly init: Record<string, unknown> = {}) {
    this.type = type
  }
}

class FakeInputEvent extends FakeEvent {}
class FakeMouseEvent extends FakeEvent {}

class FakeView {
  readonly innerWidth = 1_024
  readonly innerHeight = 768
  readonly Event = FakeEvent
  readonly InputEvent = FakeInputEvent
  readonly MouseEvent = FakeMouseEvent
  readonly HTMLInputElement = FakeInput
  readonly HTMLTextAreaElement = FakeTextArea

  requestAnimationFrame(callback: (timestamp: number) => void) {
    return setTimeout(() => callback(Date.now()), 0) as unknown as number
  }

  getComputedStyle(element: FakeElement) {
    return element.style
  }
}

class FakeRoot {
  readonly elements: FakeElement[] = []
  pointerTarget: FakeElement | null = null

  querySelectorAll(selector: string) {
    return this.elements.filter((element) => matchesSelector(element, selector))
  }

  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null
  }

  elementFromPoint() {
    return this.pointerTarget
  }
}

class FakeDocument extends FakeRoot {
  readonly defaultView = new FakeView()
  readonly body = { innerText: "" }
}

class FakeShadowRoot extends FakeRoot {}

class FakeElement {
  readonly attributes = new Map<string, string>()
  readonly children: FakeElement[] = []
  readonly events: string[] = []
  readonly style = {
    visibility: "visible",
    display: "block",
    opacity: "1",
  }
  readonly ownerDocument: FakeDocument
  readonly tagName: string
  root: FakeRoot
  shadowRoot: FakeShadowRoot | null = null
  contentDocument: FakeDocument | null = null
  textContent = ""
  innerText = ""
  disabled = false
  isContentEditable = false
  focused = false
  scrolled = false
  rects: FakeRect[] = [visibleRect()]

  constructor(tagName: string, ownerDocument: FakeDocument) {
    this.tagName = tagName.toUpperCase()
    this.ownerDocument = ownerDocument
    this.root = ownerDocument
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value)
  }

  hasAttribute(name: string) {
    return this.attributes.has(name)
  }

  closest(selector: string) {
    return selector === "label" && this.tagName === "LABEL" ? this : null
  }

  contains(candidate: unknown): boolean {
    return candidate === this
      || this.children.some((child) => child.contains(candidate))
  }

  getRootNode() {
    return this.root
  }

  getBoundingClientRect() {
    if (this.rects.length > 1) return this.rects.shift()!
    return this.rects[0]!
  }

  scrollIntoView() {
    this.scrolled = true
  }

  focus() {
    this.focused = true
  }

  dispatchEvent(event: FakeEvent) {
    this.events.push(event.type)
    return true
  }
}

class FakeInput extends FakeElement {
  #value = ""

  constructor(ownerDocument: FakeDocument) {
    super("input", ownerDocument)
  }

  get value() {
    return this.#value
  }

  set value(value: string) {
    this.#value = String(value)
  }
}

class FakeTextArea extends FakeElement {
  #value = ""

  constructor(ownerDocument: FakeDocument) {
    super("textarea", ownerDocument)
  }

  get value() {
    return this.#value
  }

  set value(value: string) {
    this.#value = String(value)
  }
}

function matchesSelector(element: FakeElement, selector: string) {
  if (selector === "*") return true
  if (selector.startsWith("#")) {
    return element.getAttribute("id") === selector.slice(1)
  }
  const testID = selector.match(/^\[data-testid="([^"]+)"\]$/u)?.[1]
  if (testID) return element.getAttribute("data-testid") === testID
  const labelFor = selector.match(/^label\[for="([^"]+)"\]$/u)?.[1]
  if (labelFor) {
    return element.tagName === "LABEL"
      && element.getAttribute("for") === labelFor
  }
  return element.tagName.toLowerCase() === selector.toLowerCase()
}

function addElement(
  root: FakeRoot,
  element: FakeElement,
  options: { pointer?: boolean } = {},
) {
  element.root = root
  root.elements.push(element)
  if (options.pointer !== false) root.pointerTarget = element
  return element
}

const storage = new Map<string, unknown>()
let page = new FakeDocument()
let executeFailures = 0
let handleBrowserCommand: typeof import("../src/background/commands").handleBrowserCommand

const context: BrowserExtensionCommandContext = {
  sessionID: "session-locator",
  turnID: "turn-locator",
  messageID: "message-locator",
  toolCallID: "tool-locator",
  browserID: "browser-locator",
  extensionInstanceID: "extension-locator",
}

async function run(
  method:
    | "locator.click"
    | "locator.fill"
    | "locator.textContent"
    | "locator.inputValue"
    | "locator.waitFor",
  params: Record<string, unknown>,
) {
  return handleBrowserCommand(method, {
    tabId: 7,
    ...params,
  }, {
    contractVersion: BROWSER_CONTRACT_VERSION,
    context,
  })
}

beforeAll(async () => {
  Object.assign(globalThis, {
    CSS: {
      escape(value: string) {
        return value.replace(/[^a-zA-Z0-9_-]/gu, "\\$&")
      },
    },
    chrome: {
      debugger: {
        async attach() {},
        async detach() {},
        async sendCommand() {},
        onDetach: { addListener() {} },
      },
      scripting: {
        async executeScript(input: {
          func: (...args: unknown[]) => unknown
          args?: unknown[]
        }) {
          if (executeFailures > 0) {
            executeFailures -= 1
            throw new Error("The frame navigated during execution.")
          }
          return [{
            result: await input.func(...(input.args ?? [])),
          }]
        },
      },
      storage: {
        session: {
          async get(key: string) {
            return { [key]: storage.get(key) }
          },
          async set(values: Record<string, unknown>) {
            for (const [key, value] of Object.entries(values)) {
              storage.set(key, structuredClone(value))
            }
          },
        },
      },
      tabs: {
        async get(tabId: number) {
          return {
            id: tabId,
            title: "Locator fixture",
            url: "https://fixture.invalid/locator?token=hidden",
          }
        },
        async query() {
          return [{ id: 7, active: true }]
        },
      },
    },
  })

  ;({ handleBrowserCommand } = await import("../src/background/commands"))
})

beforeEach(async () => {
  storage.clear()
  executeFailures = 0
  page = new FakeDocument()
  Object.assign(globalThis, {
    document: page,
    window: page.defaultView,
  })
  await createLease({
    tabId: 7,
    source: "agent",
    context,
    extensionInstanceID: context.extensionInstanceID!,
  })
})

describe("structured locator execution", () => {
  test("re-locates through open shadow roots and same-origin frames", async () => {
    const host = addElement(page, new FakeElement("div", page))
    const shadow = new FakeShadowRoot()
    host.shadowRoot = shadow
    const shadowButton = addElement(
      shadow,
      new FakeElement("button", page),
    )
    shadowButton.setAttribute("id", "shadow-action")
    shadowButton.innerText = "Save"

    const frame = addElement(page, new FakeElement("iframe", page), {
      pointer: false,
    })
    const frameDocument = new FakeDocument()
    frame.contentDocument = frameDocument
    const frameInput = addElement(frameDocument, new FakeInput(frameDocument))
    frameInput.setAttribute("id", "frame-name")

    await expect(run("locator.click", {
      locator: { css: "#shadow-action" },
      timeoutMs: 500,
    })).resolves.toMatchObject({
      tabId: 7,
      elementId: "locator",
    })
    expect(shadowButton.events).toContain("click")

    await expect(run("locator.fill", {
      locator: { css: "#frame-name" },
      text: "Ada",
      timeoutMs: 500,
    })).resolves.toMatchObject({
      tabId: 7,
      textLength: 3,
    })
    expect(frameInput.value).toBe("Ada")
    expect(frameInput.events).toEqual(["input", "change"])
  })

  test("retries dynamic DOM and a navigation-invalidated execution", async () => {
    const waiting = run("locator.waitFor", {
      locator: { testId: "late-node" },
      state: "visible",
      timeoutMs: 1_000,
    })
    setTimeout(() => {
      const late = addElement(page, new FakeElement("div", page))
      late.setAttribute("data-testid", "late-node")
      late.textContent = "Ready"
    }, 125)

    await expect(waiting).resolves.toMatchObject({
      matched: true,
      reason: "Locator reached state 'visible'.",
    })

    const text = addElement(page, new FakeElement("div", page))
    text.setAttribute("id", "after-navigation")
    text.textContent = "Recovered"
    executeFailures = 1
    await expect(run("locator.textContent", {
      locator: { css: "#after-navigation" },
      timeoutMs: 1_000,
    })).resolves.toMatchObject({
      value: "Recovered",
    })
  })

  test("waits for stability and rejects hidden, disabled, or covered targets", async () => {
    const moving = addElement(page, new FakeElement("button", page))
    moving.setAttribute("id", "moving")
    moving.rects = [
      visibleRect(10, 20),
      visibleRect(40, 20),
      visibleRect(40, 20),
      visibleRect(40, 20),
    ]
    await expect(run("locator.click", {
      locator: { css: "#moving" },
      timeoutMs: 1_000,
    })).resolves.toMatchObject({ elementId: "locator" })

    const cases = [
      {
        id: "hidden",
        configure(element: FakeElement) {
          element.style.display = "none"
        },
        reason: "not visible",
      },
      {
        id: "disabled",
        configure(element: FakeElement) {
          element.disabled = true
        },
        reason: "disabled",
      },
      {
        id: "covered",
        configure() {
          page.pointerTarget = new FakeElement("div", page)
        },
        reason: "covered",
      },
    ]

    for (const item of cases) {
      page = new FakeDocument()
      Object.assign(globalThis, {
        document: page,
        window: page.defaultView,
      })
      const target = addElement(page, new FakeElement("button", page))
      target.setAttribute("id", item.id)
      item.configure(target)
      await expect(run("locator.click", {
        locator: { css: `#${item.id}` },
        timeoutMs: 1,
      })).rejects.toMatchObject({
        code: "COMMAND_FAILED",
        message: expect.stringContaining(item.reason),
      })
    }
  })

  test("requires an explicit sensitive retry and never returns the value", async () => {
    const password = addElement(page, new FakeInput(page))
    password.setAttribute("id", "password")
    password.setAttribute("type", "password")

    await expect(run("locator.fill", {
      locator: { css: "#password" },
      text: "super-secret",
      timeoutMs: 500,
    })).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    })
    expect(password.value).toBe("")

    const filled = await run("locator.fill", {
      locator: { css: "#password" },
      text: "super-secret",
      sensitive: true,
      timeoutMs: 500,
    })
    expect(filled).toMatchObject({
      textLength: 12,
    })
    expect(JSON.stringify(filled)).not.toContain("super-secret")
    expect(password.value).toBe("super-secret")

    await expect(run("locator.inputValue", {
      locator: { css: "#password" },
      timeoutMs: 500,
    })).resolves.toMatchObject({
      value: null,
    })
  })

  test("treats cross-origin frames as an explicit unsupported boundary", async () => {
    const frame = addElement(page, new FakeElement("iframe", page))
    frame.contentDocument = null

    await expect(run("locator.waitFor", {
      locator: { css: "#inside-cross-origin-frame" },
      state: "attached",
      timeoutMs: 1,
    })).resolves.toMatchObject({
      matched: false,
      reason: expect.stringContaining("same-origin frames"),
    })
  })
})
