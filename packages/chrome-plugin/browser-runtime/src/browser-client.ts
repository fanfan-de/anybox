import type {
  BrowserExtensionAccessibilityTreeResult,
  BrowserExtensionCommandMethod,
  BrowserExtensionDomTreeResult,
  BrowserExtensionElementActionResult,
  BrowserExtensionFillResult,
  BrowserExtensionInteractiveSnapshotResult,
  BrowserExtensionScreenshotResult,
  BrowserExtensionSnapshotResult,
  BrowserExtensionTabSummary,
  BrowserExtensionTabsListResult,
  BrowserExtensionWaitForResult,
} from "@anybox/shared/browser-extension"

type BrowserCommandParams = Record<string, unknown>
type PageFunction<TResult = unknown> = (...args: any[]) => TResult

interface BrowserCommandOptions {
  timeoutMs?: number
}

export type BrowserRuntimeTransportRequest =
  | { type: "status" }
  | {
      type: "command"
      method: BrowserExtensionCommandMethod
      params: BrowserCommandParams
      timeoutMs?: number
    }

export type BrowserRuntimeTransport = <TResult = unknown>(
  request: BrowserRuntimeTransportRequest,
) => Promise<TResult>

export interface BrowserRuntimeStatus extends Record<string, unknown> {
  connected: boolean
}

interface CdpAdapter {
  send<TResult = unknown>(
    method: string,
    params?: BrowserCommandParams,
  ): Promise<TResult>
}

interface PlaywrightAdapter {
  locator(selector: string): BrowserLocator
  evaluate<TResult = unknown>(
    pageFunction: PageFunction<TResult> | string,
    ...args: unknown[]
  ): Promise<TResult>
  screenshot(options?: BrowserCommandParams): Promise<BrowserExtensionScreenshotResult>
  waitForSelector(
    selector: string,
    options?: BrowserCommandParams & { timeout?: number },
  ): Promise<BrowserExtensionWaitForResult>
  click(selector: string, options?: BrowserCommandParams): Promise<BrowserCommandParams>
  fill(
    selector: string,
    value: unknown,
    options?: BrowserCommandParams,
  ): Promise<BrowserCommandParams>
  keyboard: {
    type(text: string): Promise<unknown>
  }
  mouse: {
    click(x: number, y: number, options?: BrowserCommandParams): Promise<unknown>
  }
}

interface BrowserCollection {
  get(name?: string): Promise<BrowserRuntime>
}

export interface BrowserRuntimeAgent extends Record<string, unknown> {
  browsers: BrowserCollection
}

export interface BrowserRuntimeGlobals extends Record<string, unknown> {
  agent?: BrowserRuntimeAgent | Record<string, unknown>
  setupBrowserRuntime?: typeof setupBrowserRuntime
}

export interface SetupBrowserRuntimeOptions {
  globals?: BrowserRuntimeGlobals
  transport?: BrowserRuntimeTransport
}

const BROWSER_RUNTIME_DOCUMENTATION = [
  "Anybox Chrome browser runtime",
  "",
  "Browser:",
  "  await browser.status()",
  "  await browser.documentation()",
  "  await browser.tabs.list()",
  "  await browser.tabs.open(url, options?)",
  "  await browser.tabs.activate(tabId)",
  "  await browser.tabs.get(tabId)",
  "  await browser.tabs.current()",
  "",
  "Tab inspection:",
  "  await tab.info()",
  "  await tab.snapshot(options?)",
  "  await tab.interactiveSnapshot(options?)",
  "  await tab.domTree(options?)",
  "  await tab.accessibilityTree(options?)",
  "  await tab.screenshot(options?)",
  "",
  "Tab interaction:",
  "  await tab.activate()",
  "  await tab.click(x, y, options?)",
  "  await tab.clickElement(elementId, options?)",
  "  await tab.fill(elementId, text, options?)",
  "  await tab.type(text)",
  "  await tab.scroll(options?)",
  "  await tab.waitFor({ text?, urlIncludes?, selector?, elementId?, timeoutMs? })",
  "  await tab.release()",
  "",
  "Advanced raw evaluate/CDP and selector adapters are disabled until command-level policy is available.",
  "Emit screenshots with: await nodeRepl.emitImage(await tab.screenshot())",
].join("\n")

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function unavailableTransport<TResult>(): Promise<TResult> {
  return Promise.reject(new Error("Chrome browser runtime transport is not available."))
}

async function browserCommand<TResult = unknown>(
  transport: BrowserRuntimeTransport,
  method: BrowserExtensionCommandMethod,
  params: BrowserCommandParams = {},
  options: BrowserCommandOptions = {},
): Promise<TResult> {
  return transport<TResult>({
    type: "command",
    method,
    params,
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  })
}

function disabledAdvancedCapability(name: string): Promise<never> {
  return Promise.reject(
    new Error(
      `${name} is disabled until Anybox can enforce command-level capability and permission policy.`,
    ),
  )
}

class BrowserLocator {
  constructor(
    private readonly tab: BrowserTab,
    readonly selector: string,
  ) {}

  async click(options: BrowserCommandParams = {}): Promise<BrowserCommandParams> {
    return this.tab.playwright.click(this.selector, options)
  }

  async fill(
    value: unknown,
    options: BrowserCommandParams = {},
  ): Promise<BrowserCommandParams> {
    return this.tab.playwright.fill(this.selector, value, options)
  }

  async textContent(): Promise<string | null> {
    return this.tab.evaluate(
      (selector) => document.querySelector(selector)?.textContent ?? null,
      this.selector,
    )
  }

  async inputValue(): Promise<string | null> {
    return this.tab.evaluate((selector) => {
      const element = document.querySelector(selector)
      return element && "value" in element
        ? (element as HTMLInputElement).value
        : null
    }, this.selector)
  }
}

class BrowserTab {
  readonly #transport: BrowserRuntimeTransport
  tabId: number | undefined
  readonly cdp: CdpAdapter
  readonly playwright: PlaywrightAdapter

  constructor(tabId: number | undefined, transport: BrowserRuntimeTransport) {
    this.#transport = transport
    this.tabId = tabId
    this.cdp = {
      send: <TResult = unknown>(
        _method: string,
        _params: BrowserCommandParams = {},
      ) => disabledAdvancedCapability("Raw CDP") as Promise<TResult>,
    }
    this.playwright = createPlaywrightAdapter(this)
  }

  private withTabId(params: BrowserCommandParams = {}): BrowserCommandParams {
    return this.tabId ? { ...params, tabId: this.tabId } : params
  }

  async info(): Promise<BrowserExtensionTabSummary | undefined> {
    if (!this.tabId) return undefined
    const result = await browserCommand<BrowserExtensionTabsListResult>(
      this.#transport,
      "tabs.list",
    )
    return result.tabs.find((tab) => tab.id === this.tabId)
  }

  async activate(): Promise<BrowserExtensionTabSummary> {
    const tab = await browserCommand<BrowserExtensionTabSummary>(
      this.#transport,
      "tabs.activate",
      this.withTabId(),
    )
    this.tabId = tab.id
    return tab
  }

  async snapshot(
    options: BrowserCommandParams = {},
  ): Promise<BrowserExtensionSnapshotResult> {
    return browserCommand(this.#transport, "page.snapshot", this.withTabId(options))
  }

  async interactiveSnapshot(
    options: BrowserCommandParams = {},
  ): Promise<BrowserExtensionInteractiveSnapshotResult> {
    return browserCommand(this.#transport, "page.interactiveSnapshot", this.withTabId(options))
  }

  async domTree(
    options: BrowserCommandParams = {},
  ): Promise<BrowserExtensionDomTreeResult> {
    return browserCommand(this.#transport, "page.domTree", this.withTabId(options))
  }

  async accessibilityTree(
    options: BrowserCommandParams = {},
  ): Promise<BrowserExtensionAccessibilityTreeResult> {
    return browserCommand(this.#transport, "page.accessibilityTree", this.withTabId(options))
  }

  async screenshot(
    options: BrowserCommandParams = {},
  ): Promise<BrowserExtensionScreenshotResult> {
    return browserCommand(this.#transport, "page.screenshot", this.withTabId(options))
  }

  async click(
    x: number,
    y: number,
    options: BrowserCommandParams = {},
  ): Promise<unknown> {
    return browserCommand(this.#transport, "page.click", this.withTabId({ x, y, ...options }))
  }

  async clickElement(
    elementId: string,
    options: BrowserCommandParams = {},
  ): Promise<BrowserExtensionElementActionResult> {
    return browserCommand(
      this.#transport,
      "page.clickElement",
      this.withTabId({ elementId, ...options }),
    )
  }

  async fill(
    elementId: string,
    text: string,
    options: BrowserCommandParams = {},
  ): Promise<BrowserExtensionFillResult> {
    return browserCommand(
      this.#transport,
      "page.fill",
      this.withTabId({ elementId, text, ...options }),
    )
  }

  async type(text: string): Promise<unknown> {
    return browserCommand(this.#transport, "page.type", this.withTabId({ text }))
  }

  async scroll(options: BrowserCommandParams = {}): Promise<unknown> {
    return browserCommand(this.#transport, "page.scroll", this.withTabId(options))
  }

  async waitFor(
    options: BrowserCommandParams & { timeoutMs?: number } = {},
  ): Promise<BrowserExtensionWaitForResult> {
    const timeoutMs = options.timeoutMs
      ? Math.min(Math.max(Number(options.timeoutMs), 1), 60_000) + 5_000
      : undefined
    return browserCommand(
      this.#transport,
      "page.waitFor",
      this.withTabId(options),
      { timeoutMs },
    )
  }

  async release(): Promise<{ tabId?: number; released: boolean }> {
    if (!this.tabId) return { released: false }
    return browserCommand(this.#transport, "tabs.release", { tabId: this.tabId })
  }

  async evaluate<TResult = unknown>(
    _pageFunction: PageFunction<TResult> | string,
    ..._args: unknown[]
  ): Promise<TResult> {
    return disabledAdvancedCapability("Page evaluation") as Promise<TResult>
  }

  locator(selector: string): BrowserLocator {
    return new BrowserLocator(this, selector)
  }
}

function createPlaywrightAdapter(tab: BrowserTab): PlaywrightAdapter {
  return {
    locator: (selector) => new BrowserLocator(tab, selector),
    evaluate: (pageFunction, ...args) => tab.evaluate(pageFunction, ...args),
    screenshot: (options = {}) => tab.screenshot(options),
    waitForSelector: (selector, options = {}) =>
      tab.waitFor({ selector, timeoutMs: options.timeout }),
    click: async (selector, options = {}) => {
      await tab.evaluate((query) => {
        const element = document.querySelector(query)
        if (!element) throw new Error(`Selector '${query}' was not found.`)
        element.scrollIntoView({ block: "center", inline: "center" })
        element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
        element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
        element.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      }, selector)
      return { selector, ...options }
    },
    fill: async (selector, value, options = {}) => {
      await tab.evaluate((query, nextValue) => {
        const element = document.querySelector(query)
        if (!element) throw new Error(`Selector '${query}' was not found.`)
        element.scrollIntoView({ block: "center", inline: "center" })
        ;(element as HTMLElement).focus()
        if ("value" in element) {
          ;(element as HTMLInputElement).value = String(nextValue)
        } else {
          element.textContent = String(nextValue)
        }
        element.dispatchEvent(new Event("input", { bubbles: true }))
        element.dispatchEvent(new Event("change", { bubbles: true }))
      }, selector, value)
      return { selector, textLength: String(value).length, ...options }
    },
    keyboard: {
      type: (text) => tab.type(text),
    },
    mouse: {
      click: (x, y, options = {}) => tab.click(x, y, options),
    },
  }
}

class BrowserRuntime {
  readonly #transport: BrowserRuntimeTransport
  readonly tabs: {
    list(): Promise<Array<BrowserExtensionTabSummary & { runtime: BrowserTab }>>
    open(url: string, options?: BrowserCommandParams): Promise<BrowserTab>
    activate(tabId: number): Promise<BrowserTab>
    get(tabId: number): Promise<BrowserTab>
    current(): Promise<BrowserTab>
  }

  constructor(transport: BrowserRuntimeTransport) {
    this.#transport = transport
    this.tabs = {
      list: async (): Promise<Array<BrowserExtensionTabSummary & { runtime: BrowserTab }>> => {
        const result = await browserCommand<BrowserExtensionTabsListResult>(
          this.#transport,
          "tabs.list",
        )
        return result.tabs.map((tab) => ({
          ...tab,
          runtime: new BrowserTab(tab.id, this.#transport),
        }))
      },
      open: async (
        url: string,
        options: BrowserCommandParams = {},
      ): Promise<BrowserTab> => {
        const tab = await browserCommand<BrowserExtensionTabSummary>(
          this.#transport,
          "tabs.open",
          { url, ...options },
        )
        return new BrowserTab(tab.id, this.#transport)
      },
      activate: async (tabId: number): Promise<BrowserTab> => {
        const tab = await browserCommand<BrowserExtensionTabSummary>(
          this.#transport,
          "tabs.activate",
          { tabId },
        )
        return new BrowserTab(tab.id, this.#transport)
      },
      get: async (tabId: number): Promise<BrowserTab> =>
        new BrowserTab(tabId, this.#transport),
      current: async (): Promise<BrowserTab> =>
        new BrowserTab(undefined, this.#transport),
    }
  }

  async status(): Promise<BrowserRuntimeStatus> {
    return this.#transport<BrowserRuntimeStatus>({ type: "status" })
  }

  async documentation(): Promise<string> {
    return BROWSER_RUNTIME_DOCUMENTATION
  }

}

export async function setupBrowserRuntime(
  options: SetupBrowserRuntimeOptions = {},
): Promise<BrowserRuntimeAgent> {
  const globals = options.globals
    ?? globalThis as unknown as BrowserRuntimeGlobals
  const transport = options.transport ?? unavailableTransport
  const agent = isRecord(globals.agent)
    ? globals.agent as BrowserRuntimeAgent
    : {} as BrowserRuntimeAgent

  agent.browsers = {
    get: async (name = "extension") => {
      if (name !== "extension") {
        throw new Error(`Unknown browser runtime '${name}'.`)
      }
      return new BrowserRuntime(transport)
    },
  }
  globals.agent = agent
  globals.setupBrowserRuntime = setupBrowserRuntime
  return agent
}
