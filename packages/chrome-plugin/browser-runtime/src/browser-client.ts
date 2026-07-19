import {
  BROWSER_CONTRACT_VERSION,
  BrowserContractCommandRegistry,
  BrowserContractValidationError,
  BrowserGetInfoResult,
  createBrowserApiManifest,
  createBrowserDocumentationManifest,
  parseBrowserCommandParams,
  parseBrowserCommandResult,
} from "@anybox/chrome-shared/browser-contract"
import type {
  BrowserApiManifest,
  BrowserBackendCapabilities,
  BrowserBackendInfo,
  BrowserContractCommandMethod,
  BrowserContractCommandParams,
  BrowserContractCommandResult,
  BrowserContractErrorCode,
  BrowserDocumentationManifest,
} from "@anybox/chrome-shared/browser-contract"
import type {
  BrowserExtensionAccessibilityTreeResult,
  BrowserExtensionClickResult,
  BrowserExtensionDomTreeResult,
  BrowserExtensionElementActionResult,
  BrowserExtensionFillResult,
  BrowserExtensionInteractiveSnapshotResult,
  BrowserExtensionScreenshotResult,
  BrowserExtensionScrollResult,
  BrowserExtensionSnapshotResult,
  BrowserExtensionTabSummary,
  BrowserExtensionTabsListResult,
  BrowserExtensionTabsReleaseResult,
  BrowserExtensionTypeResult,
  BrowserExtensionWaitForResult,
} from "@anybox/chrome-shared/browser-extension"
import {
  ensureBrowserHostRuntime,
  requestBrowserHost,
} from "./browser-host-client.ts"

type BrowserCommandParams = Record<string, unknown>
type PageFunction<TResult = unknown> = (...args: any[]) => TResult

const NATIVE_INSTALL_ENV = "ANYBOX_BROWSER_NATIVE_INSTALL"
let nativeMessagingHostReady: Promise<void> | undefined

type TabsOpenOptions = Omit<BrowserContractCommandParams<"tabs.open">, "url">
type SnapshotOptions = Omit<BrowserContractCommandParams<"page.snapshot">, "tabId">
type InteractiveSnapshotOptions = Omit<
  BrowserContractCommandParams<"page.interactiveSnapshot">,
  "tabId"
>
type DomTreeOptions = Omit<BrowserContractCommandParams<"page.domTree">, "tabId">
type AccessibilityTreeOptions = Omit<
  BrowserContractCommandParams<"page.accessibilityTree">,
  "tabId"
>
type ScreenshotOptions = Omit<
  BrowserContractCommandParams<"page.screenshot">,
  "tabId"
>
type ClickOptions = Omit<
  BrowserContractCommandParams<"page.click">,
  "tabId" | "x" | "y"
>
type ClickElementOptions = Omit<
  BrowserContractCommandParams<"page.clickElement">,
  "tabId" | "elementId"
>
type FillOptions = Omit<
  BrowserContractCommandParams<"page.fill">,
  "tabId" | "elementId" | "text"
>
type ScrollOptions = Omit<BrowserContractCommandParams<"page.scroll">, "tabId">
type WaitForOptions = Omit<BrowserContractCommandParams<"page.waitFor">, "tabId">

interface BrowserCommandOptions {
  timeoutMs?: number
}

export type BrowserRuntimeTransportRequest =
  | { type: "status" }
  | {
      type: "getInfo"
      contractVersion: typeof BROWSER_CONTRACT_VERSION
    }
  | {
      type: "command"
      contractVersion: typeof BROWSER_CONTRACT_VERSION
      method: BrowserContractCommandMethod
      params: unknown
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
  screenshot(options?: ScreenshotOptions): Promise<BrowserExtensionScreenshotResult>
  waitForSelector(
    selector: string,
    options?: { timeout?: number },
  ): Promise<BrowserExtensionWaitForResult>
  click(selector: string, options?: BrowserCommandParams): Promise<BrowserCommandParams>
  fill(
    selector: string,
    value: unknown,
    options?: BrowserCommandParams,
  ): Promise<BrowserCommandParams>
  keyboard: {
    type(text: string): Promise<BrowserExtensionTypeResult>
  }
  mouse: {
    click(
      x: number,
      y: number,
      options?: ClickOptions,
    ): Promise<BrowserExtensionClickResult>
  }
}

export interface BrowserCollection {
  list(): Promise<BrowserContext[]>
  get(name?: string): Promise<BrowserContext>
  getDefault(): Promise<BrowserContext>
  getForUrl(url: string | URL): Promise<BrowserContext>
}

export interface BrowserRuntimeAgent extends Record<string, unknown> {
  browsers: BrowserCollection
}

export interface BrowserRuntimeGlobals extends Record<string, unknown> {
  agent?: BrowserRuntimeAgent | Record<string, unknown>
  nodeRepl?: {
    readonly requestMeta?: {
      sessionID?: string
      messageID?: string
      toolCallID?: string
    }
  }
  setupBrowserRuntime?: typeof setupBrowserRuntime
}

export interface SetupBrowserRuntimeOptions {
  globals?: BrowserRuntimeGlobals
  transport?: BrowserRuntimeTransport
}

interface BrowserRuntimeErrorOptions {
  retryable?: boolean
  details?: Record<string, unknown>
  cause?: unknown
}

export class BrowserRuntimeError extends Error {
  readonly retryable: boolean
  readonly details?: Record<string, unknown>

  constructor(
    readonly code: BrowserContractErrorCode,
    message: string,
    options: BrowserRuntimeErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = "BrowserRuntimeError"
    this.retryable = options.retryable ?? false
    this.details = options.details
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function pluginBrowserTransport(
  globals: BrowserRuntimeGlobals,
): BrowserRuntimeTransport {
  return async <TResult = unknown>(
    request: BrowserRuntimeTransportRequest,
  ): Promise<TResult> => {
    await ensureBrowserHostRuntime()
    await ensureNativeMessagingHost()
    if (request.type === "status") {
      return requestBrowserHost<TResult>({ operation: "status" })
    }
    if (request.type === "getInfo") {
      return requestBrowserHost<TResult>({
        operation: "getInfo",
        contractVersion: request.contractVersion,
      })
    }
    return requestBrowserHost<TResult>({
      operation: "command",
      contractVersion: request.contractVersion,
      method: request.method,
      params: request.params,
      ...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
      ...(globals.nodeRepl?.requestMeta
        ? { context: globals.nodeRepl.requestMeta }
        : {}),
    })
  }
}

async function ensureNativeMessagingHost(): Promise<void> {
  if (process.env[NATIVE_INSTALL_ENV]?.trim().toLowerCase() === "off") return
  nativeMessagingHostReady ??= (async () => {
    const bootstrapModule = await import(
      new URL("./native-host-bootstrap.js", import.meta.url).href
    ) as {
      ensureNativeMessagingHost?: () => Promise<unknown>
      default?: {
        ensureNativeMessagingHost?: () => Promise<unknown>
      }
    }
    const ensure = bootstrapModule.ensureNativeMessagingHost
      ?? bootstrapModule.default?.ensureNativeMessagingHost
    if (typeof ensure !== "function") {
      throw new Error(
        "Chrome plugin package is missing its Native Messaging Host bootstrap.",
      )
    }
    await ensure()
  })().catch((cause) => {
    nativeMessagingHostReady = undefined
    throw new BrowserRuntimeError(
      "BACKEND_UNAVAILABLE",
      "Chrome Native Messaging Host setup failed.",
      { retryable: true, cause },
    )
  })
  await nativeMessagingHostReady
}

function invalidBackendResult(message: string, cause?: unknown): never {
  throw new BrowserContractValidationError(
    "INVALID_COMMAND_RESULT",
    message,
    cause === undefined ? undefined : { cause },
  )
}

function sameCommandOrder(
  expected: readonly BrowserContractCommandMethod[],
  actual: readonly BrowserContractCommandMethod[],
): boolean {
  return expected.length === actual.length
    && expected.every((method, index) => actual[index] === method)
}

function validateGetInfo(value: unknown): BrowserGetInfoResult {
  const parsed = BrowserGetInfoResult.safeParse(value)
  if (!parsed.success) {
    invalidBackendResult(
      `Browser backend getInfo result does not match contract v${BROWSER_CONTRACT_VERSION}.`,
      parsed.error,
    )
  }

  const result = parsed.data
  const supported = result.backend.capabilities.commands
  const apiCommands = result.apiManifest.commands.map((entry) => entry.method)
  const documentationCommands = result.documentationManifest.entries.map(
    (entry) => entry.method,
  )
  if (
    !sameCommandOrder(supported, apiCommands)
    || !sameCommandOrder(supported, documentationCommands)
  ) {
    invalidBackendResult(
      "Browser backend manifests must exactly match its advertised command capabilities.",
    )
  }

  for (const entry of result.apiManifest.commands) {
    const definition = BrowserContractCommandRegistry[entry.method]
    if (
      entry.apiPath !== definition.apiPath
      || entry.security !== definition.security
    ) {
      invalidBackendResult(
        `Browser backend API manifest entry '${entry.method}' is inconsistent with the Anybox contract.`,
      )
    }
  }
  for (const entry of result.documentationManifest.entries) {
    const definition = BrowserContractCommandRegistry[entry.method]
    if (
      entry.apiPath !== definition.apiPath
      || entry.signature !== definition.signature
      || entry.summary !== definition.summary
      || entry.security !== definition.security
    ) {
      invalidBackendResult(
        `Browser backend documentation entry '${entry.method}' is inconsistent with the Anybox contract.`,
      )
    }
  }
  return {
    backend: result.backend,
    apiManifest: createBrowserApiManifest(supported),
    documentationManifest: createBrowserDocumentationManifest(supported),
  }
}

function parseStatus(value: unknown): BrowserRuntimeStatus {
  if (!isRecord(value) || typeof value.connected !== "boolean") {
    invalidBackendResult("Browser backend status result is invalid.")
  }
  return value as BrowserRuntimeStatus
}

function disabledAdvancedCapability(name: string): Promise<never> {
  return Promise.reject(
    new BrowserRuntimeError(
      "CAPABILITY_UNAVAILABLE",
      `${name} is disabled until Anybox can enforce command-level capability and permission policy.`,
    ),
  )
}

function validateBrowserUrl(value: string | URL): URL {
  try {
    const url = value instanceof URL ? value.href : value
    return new URL(parseBrowserCommandParams("tabs.open", { url }).url)
  } catch (cause) {
    throw new BrowserRuntimeError(
      "INVALID_COMMAND_PARAMS",
      "Browser URL must be absolute and use a non-executable scheme.",
      { cause },
    )
  }
}

function validateTabId(value: number): number {
  return parseBrowserCommandParams("tabs.activate", { tabId: value }).tabId
}

export class BackendTransport {
  readonly #transport: BrowserRuntimeTransport

  constructor(transport: BrowserRuntimeTransport) {
    this.#transport = transport
  }

  async status(): Promise<BrowserRuntimeStatus> {
    return parseStatus(await this.#transport({ type: "status" }))
  }

  async getInfo(): Promise<BrowserGetInfoResult> {
    return validateGetInfo(await this.#transport({
      type: "getInfo",
      contractVersion: BROWSER_CONTRACT_VERSION,
    }))
  }

  async command<TResult = unknown>(
    method: BrowserContractCommandMethod,
    params: unknown,
    options: BrowserCommandOptions = {},
  ): Promise<TResult> {
    return this.#transport<TResult>({
      type: "command",
      contractVersion: BROWSER_CONTRACT_VERSION,
      method,
      params,
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    })
  }
}

export class CommandRouter {
  readonly #backend: BackendTransport
  readonly #supportedCommands: ReadonlySet<BrowserContractCommandMethod>

  constructor(
    backend: BackendTransport,
    capabilities: BrowserBackendCapabilities,
  ) {
    this.#backend = backend
    this.#supportedCommands = new Set(capabilities.commands)
  }

  supports(method: BrowserContractCommandMethod): boolean {
    return this.#supportedCommands.has(method)
  }

  async run<TMethod extends BrowserContractCommandMethod>(
    method: TMethod,
    params: unknown,
    options: BrowserCommandOptions = {},
  ): Promise<BrowserContractCommandResult<TMethod>> {
    if (!this.supports(method)) {
      throw new BrowserRuntimeError(
        "CAPABILITY_UNAVAILABLE",
        `Browser backend does not advertise capability '${method}'.`,
      )
    }
    const parsedParams = parseBrowserCommandParams(method, params)
    const rawResult = await this.#backend.command(
      method,
      parsedParams,
      options,
    )
    return parseBrowserCommandResult(method, rawResult)
  }
}

export class BrowserLocator {
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

export class BrowserTab {
  readonly #router: CommandRouter
  tabId: number
  readonly cdp: CdpAdapter
  readonly playwright: PlaywrightAdapter

  constructor(tabId: number, router: CommandRouter) {
    this.#router = router
    this.tabId = validateTabId(tabId)
    this.cdp = {
      send: <TResult = unknown>(
        _method: string,
        _params: BrowserCommandParams = {},
      ) => disabledAdvancedCapability("Raw CDP") as Promise<TResult>,
    }
    this.playwright = createPlaywrightAdapter(this)
  }

  private withTabId(params: BrowserCommandParams = {}): BrowserCommandParams {
    return { ...params, tabId: this.tabId }
  }

  async info(): Promise<BrowserExtensionTabSummary | undefined> {
    const result = await this.#router.run("tabs.list", {})
    return result.tabs.find((tab) => tab.id === this.tabId)
  }

  async activate(): Promise<BrowserExtensionTabSummary> {
    const tab = await this.#router.run(
      "tabs.activate",
      this.withTabId(),
    )
    this.tabId = tab.id
    return tab
  }

  async snapshot(
    options: SnapshotOptions = {},
  ): Promise<BrowserExtensionSnapshotResult> {
    return this.#router.run(
      "page.snapshot",
      this.withTabId(options),
    )
  }

  async interactiveSnapshot(
    options: InteractiveSnapshotOptions = {},
  ): Promise<BrowserExtensionInteractiveSnapshotResult> {
    return this.#router.run(
      "page.interactiveSnapshot",
      this.withTabId(options),
    )
  }

  async domTree(
    options: DomTreeOptions = {},
  ): Promise<BrowserExtensionDomTreeResult> {
    return this.#router.run(
      "page.domTree",
      this.withTabId(options),
    )
  }

  async accessibilityTree(
    options: AccessibilityTreeOptions = {},
  ): Promise<BrowserExtensionAccessibilityTreeResult> {
    return this.#router.run(
      "page.accessibilityTree",
      this.withTabId(options),
    )
  }

  async screenshot(
    options: ScreenshotOptions = {},
  ): Promise<BrowserExtensionScreenshotResult> {
    return this.#router.run(
      "page.screenshot",
      this.withTabId(options),
    )
  }

  async click(
    x: number,
    y: number,
    options: ClickOptions = {},
  ): Promise<BrowserExtensionClickResult> {
    return this.#router.run(
      "page.click",
      this.withTabId({ ...options, x, y }),
    )
  }

  async clickElement(
    elementId: string,
    options: ClickElementOptions = {},
  ): Promise<BrowserExtensionElementActionResult> {
    return this.#router.run(
      "page.clickElement",
      this.withTabId({ ...options, elementId }),
    )
  }

  async fill(
    elementId: string,
    text: string,
    options: FillOptions = {},
  ): Promise<BrowserExtensionFillResult> {
    return this.#router.run(
      "page.fill",
      this.withTabId({ ...options, elementId, text }),
    )
  }

  async type(text: string): Promise<BrowserExtensionTypeResult> {
    return this.#router.run(
      "page.type",
      this.withTabId({ text }),
    )
  }

  async scroll(
    options: ScrollOptions = {},
  ): Promise<BrowserExtensionScrollResult> {
    return this.#router.run(
      "page.scroll",
      this.withTabId(options),
    )
  }

  async waitFor(
    options: WaitForOptions = {},
  ): Promise<BrowserExtensionWaitForResult> {
    const timeoutMs = options.timeoutMs
      ? Math.min(Math.max(Number(options.timeoutMs), 1), 60_000) + 5_000
      : undefined
    return this.#router.run(
      "page.waitFor",
      this.withTabId(options),
      { timeoutMs },
    )
  }

  async release(): Promise<BrowserExtensionTabsReleaseResult> {
    return this.#router.run("tabs.release", { tabId: this.tabId })
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

function renderDocumentation(
  info: BrowserBackendInfo,
  manifest: BrowserDocumentationManifest,
): string {
  const lines = [
    manifest.title,
    "",
    `Backend: ${info.name} (${info.browserId})`,
    `Connected: ${info.connected ? "yes" : "no"}`,
    `Browser contract: v${manifest.contractVersion}`,
    "",
    "Available API:",
  ]
  for (const entry of manifest.entries) {
    lines.push(`  ${entry.signature}`)
    lines.push(`    ${entry.summary}`)
  }
  lines.push(
    "",
    "Raw page JavaScript and full CDP are unavailable by default.",
  )
  if (info.capabilities.commands.includes("page.screenshot")) {
    lines.push(
      "Emit screenshots with: await nodeRepl.emitImage(await tab.screenshot())",
    )
  }
  return lines.join("\n")
}

export class BrowserContext {
  readonly browserId: string
  readonly capabilities: BrowserBackendCapabilities
  readonly apiManifest: BrowserApiManifest
  readonly documentationManifest: BrowserDocumentationManifest
  readonly info: BrowserBackendInfo
  readonly tabs: {
    list(): Promise<Array<BrowserExtensionTabSummary & { runtime: BrowserTab }>>
    open(url: string, options?: TabsOpenOptions): Promise<BrowserTab>
    activate(tabId: number): Promise<BrowserTab>
    get(tabId: number): Promise<BrowserTab>
    current(): Promise<BrowserTab>
  }
  readonly #backend: BackendTransport
  readonly #router: CommandRouter
  readonly #documentation: string

  constructor(
    backend: BackendTransport,
    getInfo: BrowserGetInfoResult,
  ) {
    this.#backend = backend
    this.info = getInfo.backend
    this.browserId = this.info.browserId
    this.capabilities = this.info.capabilities
    this.apiManifest = getInfo.apiManifest
    this.documentationManifest = getInfo.documentationManifest
    this.#router = new CommandRouter(backend, this.capabilities)
    this.#documentation = renderDocumentation(
      this.info,
      this.documentationManifest,
    )
    this.tabs = {
      list: async () => {
        const result = await this.#router.run("tabs.list", {})
        return result.tabs.map((tab) => ({
          ...tab,
          runtime: new BrowserTab(tab.id, this.#router),
        }))
      },
      open: async (url, options = {}) => {
        const tab = await this.#router.run(
          "tabs.open",
          { ...options, url },
        )
        return new BrowserTab(tab.id, this.#router)
      },
      activate: async (tabId) => {
        const tab = await this.#router.run(
          "tabs.activate",
          { tabId },
        )
        return new BrowserTab(tab.id, this.#router)
      },
      get: async (tabId) =>
        new BrowserTab(tabId, this.#router),
      current: async () => {
        const result = await this.#router.run("tabs.list", {})
        const current = result.tabs.find((tab) => tab.active)
          ?? result.tabs[0]
        if (!current) {
          throw new BrowserRuntimeError(
            "TAB_NOT_FOUND",
            "No Chrome tab is available.",
            { retryable: true },
          )
        }
        return new BrowserTab(current.id, this.#router)
      },
    }
  }

  async status(): Promise<BrowserRuntimeStatus> {
    return this.#backend.status()
  }

  async documentation(): Promise<string> {
    return this.#documentation
  }
}

export class BrowserManager implements BrowserCollection {
  readonly #backend: BackendTransport

  constructor(transport: BrowserRuntimeTransport) {
    this.#backend = new BackendTransport(transport)
  }

  async list(): Promise<BrowserContext[]> {
    return [await this.get("extension")]
  }

  async get(name = "extension"): Promise<BrowserContext> {
    if (name !== "extension") {
      throw new BrowserRuntimeError(
        "BACKEND_UNAVAILABLE",
        `Unknown browser runtime '${name}'.`,
      )
    }
    const info = await this.#backend.getInfo()
    return new BrowserContext(this.#backend, info)
  }

  async getDefault(): Promise<BrowserContext> {
    return this.get("extension")
  }

  async getForUrl(url: string | URL): Promise<BrowserContext> {
    validateBrowserUrl(url)
    return this.getDefault()
  }
}

export async function setupBrowserRuntime(
  options: SetupBrowserRuntimeOptions = {},
): Promise<BrowserRuntimeAgent> {
  const globals = options.globals
    ?? globalThis as unknown as BrowserRuntimeGlobals
  const transport = options.transport
    ?? pluginBrowserTransport(globals)
  const agent = isRecord(globals.agent)
    ? globals.agent as BrowserRuntimeAgent
    : {} as BrowserRuntimeAgent

  agent.browsers = new BrowserManager(transport)
  globals.agent = agent
  globals.setupBrowserRuntime = setupBrowserRuntime
  return agent
}
