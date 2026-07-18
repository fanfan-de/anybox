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

interface AgentFetchOptions extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>
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
}

const DEFAULT_AGENT_BASE_URL = defaultAgentBaseURL()
const AGENT_BASE_URL = normalizeBaseURL(
  process.env.ANYBOX_AGENT_BASE_URL || DEFAULT_AGENT_BASE_URL,
)
const TRUSTED_TOKEN = process.env.ANYBOX_BROWSER_TRUSTED_TOKEN || ""

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function defaultAgentBaseURL(): string {
  const host = String(process.env.ANYBOX_SERVER_HOST || "127.0.0.1").trim() || "127.0.0.1"
  const port = String(process.env.ANYBOX_SERVER_PORT || "4096").trim() || "4096"
  return `http://${host}:${port}`
}

function normalizeBaseURL(value: unknown): string {
  const normalized = String(value || DEFAULT_AGENT_BASE_URL).trim().replace(/\/+$/, "")
  return normalized || DEFAULT_AGENT_BASE_URL
}

function readApiErrorMessage(body: unknown): string | undefined {
  if (!isRecord(body) || !isRecord(body.error)) return undefined
  return typeof body.error.message === "string" ? body.error.message : undefined
}

async function agentFetch<TResult>(
  requestPath: string,
  options: AgentFetchOptions,
): Promise<TResult> {
  if (typeof fetch !== "function") {
    throw new Error("The Chrome runtime requires a Node.js runtime with fetch support.")
  }

  const response = await fetch(`${AGENT_BASE_URL}${requestPath}`, {
    headers: {
      accept: "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  })
  const bodyText = await response.text()
  let body: unknown
  try {
    body = bodyText ? JSON.parse(bodyText) : undefined
  } catch {
    body = undefined
  }

  if (!response.ok) {
    throw new Error(
      readApiErrorMessage(body)
      || bodyText.trim()
      || `Anybox agent request failed with HTTP ${response.status}.`,
    )
  }
  if (!isRecord(body) || body.success !== true) {
    throw new Error("Anybox agent returned an invalid API envelope.")
  }
  return body.data as TResult
}

async function browserCommand<TResult = unknown>(
  method: BrowserExtensionCommandMethod,
  params: BrowserCommandParams = {},
  options: BrowserCommandOptions = {},
): Promise<TResult> {
  return agentFetch<TResult>("/api/browser-extension/command", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      method,
      params,
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    }),
  })
}

async function trustedBrowserCommand<TResult = unknown>(
  method: BrowserExtensionCommandMethod,
  params: BrowserCommandParams = {},
  options: BrowserCommandOptions = {},
): Promise<TResult> {
  if (!TRUSTED_TOKEN) throw new Error("Chrome trusted command token is not available.")
  return agentFetch<TResult>("/api/browser-extension/trusted-command", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-anybox-browser-trusted-token": TRUSTED_TOKEN,
    },
    body: JSON.stringify({
      method,
      params,
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    }),
  })
}

function serializeEvaluation<TResult>(
  pageFunction: PageFunction<TResult> | string,
  args: unknown[],
): string {
  if (typeof pageFunction === "function") {
    return `(${pageFunction.toString()})(...${JSON.stringify(args)})`
  }
  if (typeof pageFunction === "string") return pageFunction
  throw new Error("evaluate requires a function or JavaScript expression string.")
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
  tabId: number | undefined
  readonly cdp: CdpAdapter
  readonly playwright: PlaywrightAdapter

  constructor(tabId: number | undefined) {
    this.tabId = tabId
    this.cdp = {
      send: <TResult = unknown>(
        method: string,
        params: BrowserCommandParams = {},
      ) => trustedBrowserCommand<TResult>("cdp.send", {
        tabId: this.tabId,
        method,
        params,
      }),
    }
    this.playwright = createPlaywrightAdapter(this)
  }

  private withTabId(params: BrowserCommandParams = {}): BrowserCommandParams {
    return this.tabId ? { ...params, tabId: this.tabId } : params
  }

  async info(): Promise<BrowserExtensionTabSummary | undefined> {
    if (!this.tabId) return undefined
    const result = await browserCommand<BrowserExtensionTabsListResult>("tabs.list")
    return result.tabs.find((tab) => tab.id === this.tabId)
  }

  async activate(): Promise<BrowserExtensionTabSummary> {
    const tab = await browserCommand<BrowserExtensionTabSummary>(
      "tabs.activate",
      this.withTabId(),
    )
    this.tabId = tab.id
    return tab
  }

  async snapshot(
    options: BrowserCommandParams = {},
  ): Promise<BrowserExtensionSnapshotResult> {
    return browserCommand("page.snapshot", this.withTabId(options))
  }

  async interactiveSnapshot(
    options: BrowserCommandParams = {},
  ): Promise<BrowserExtensionInteractiveSnapshotResult> {
    return browserCommand("page.interactiveSnapshot", this.withTabId(options))
  }

  async domTree(
    options: BrowserCommandParams = {},
  ): Promise<BrowserExtensionDomTreeResult> {
    return browserCommand("page.domTree", this.withTabId(options))
  }

  async accessibilityTree(
    options: BrowserCommandParams = {},
  ): Promise<BrowserExtensionAccessibilityTreeResult> {
    return browserCommand("page.accessibilityTree", this.withTabId(options))
  }

  async screenshot(
    options: BrowserCommandParams = {},
  ): Promise<BrowserExtensionScreenshotResult> {
    return browserCommand("page.screenshot", this.withTabId(options))
  }

  async click(
    x: number,
    y: number,
    options: BrowserCommandParams = {},
  ): Promise<unknown> {
    return browserCommand("page.click", this.withTabId({ x, y, ...options }))
  }

  async clickElement(
    elementId: string,
    options: BrowserCommandParams = {},
  ): Promise<BrowserExtensionElementActionResult> {
    return browserCommand(
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
      "page.fill",
      this.withTabId({ elementId, text, ...options }),
    )
  }

  async type(text: string): Promise<unknown> {
    return browserCommand("page.type", this.withTabId({ text }))
  }

  async scroll(options: BrowserCommandParams = {}): Promise<unknown> {
    return browserCommand("page.scroll", this.withTabId(options))
  }

  async waitFor(
    options: BrowserCommandParams & { timeoutMs?: number } = {},
  ): Promise<BrowserExtensionWaitForResult> {
    const timeoutMs = options.timeoutMs
      ? Math.min(Math.max(Number(options.timeoutMs), 1), 60_000) + 5_000
      : undefined
    return browserCommand(
      "page.waitFor",
      this.withTabId(options),
      { timeoutMs },
    )
  }

  async release(): Promise<{ tabId?: number; released: boolean }> {
    if (!this.tabId) return { released: false }
    return browserCommand("tabs.release", { tabId: this.tabId })
  }

  async evaluate<TResult = unknown>(
    pageFunction: PageFunction<TResult> | string,
    ...args: unknown[]
  ): Promise<TResult> {
    const result = await trustedBrowserCommand<{ value: TResult }>(
      "page.executeScript",
      this.withTabId({
        script: serializeEvaluation(pageFunction, args),
      }),
    )
    return result.value
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
  readonly tabs = {
    list: async (): Promise<Array<BrowserExtensionTabSummary & { runtime: BrowserTab }>> => {
      const result = await browserCommand<BrowserExtensionTabsListResult>("tabs.list")
      return result.tabs.map((tab) => ({
        ...tab,
        runtime: new BrowserTab(tab.id),
      }))
    },
    open: async (
      url: string,
      options: BrowserCommandParams = {},
    ): Promise<BrowserTab> => {
      const tab = await browserCommand<BrowserExtensionTabSummary>(
        "tabs.open",
        { url, ...options },
      )
      return new BrowserTab(tab.id)
    },
    activate: async (tabId: number): Promise<BrowserTab> => {
      const tab = await browserCommand<BrowserExtensionTabSummary>(
        "tabs.activate",
        { tabId },
      )
      return new BrowserTab(tab.id)
    },
    get: async (tabId: number): Promise<BrowserTab> => new BrowserTab(tabId),
    current: async (): Promise<BrowserTab> => new BrowserTab(undefined),
  }
}

export async function setupBrowserRuntime(
  options: SetupBrowserRuntimeOptions = {},
): Promise<BrowserRuntimeAgent> {
  const globals = options.globals
    ?? globalThis as unknown as BrowserRuntimeGlobals
  const agent = isRecord(globals.agent)
    ? globals.agent as BrowserRuntimeAgent
    : {} as BrowserRuntimeAgent

  agent.browsers = {
    get: async (name = "extension") => {
      if (name !== "extension") {
        throw new Error(`Unknown browser runtime '${name}'.`)
      }
      return new BrowserRuntime()
    },
  }
  globals.agent = agent
  globals.setupBrowserRuntime = setupBrowserRuntime
  return agent
}
