import {
  BROWSER_CONTRACT_V3_PLAYWRIGHT_COMMAND_METHODS,
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
  BrowserExtensionTabsFinalizeResult,
  BrowserExtensionTabsMarkDeliverableResult,
  BrowserExtensionTabsReleaseResult,
  BrowserExtensionTypeResult,
  BrowserExtensionWaitForResult,
} from "@anybox/chrome-shared/browser-extension"
import {
  BrowserHostClientError,
  ensureBrowserHostRuntime,
  requestBrowserHost,
} from "./browser-host-client.ts"
import {
  ChromeLaunchError,
  createChromeLauncher,
  type ChromeLauncher,
} from "./chrome-launcher.ts"
import {
  BrowserPlaywrightAPI,
} from "./playwright-client.ts"
export {
  BrowserPlaywrightAPI,
  BrowserPlaywrightDownload,
  BrowserPlaywrightFileChooser,
  BrowserPlaywrightFrameLocator,
  BrowserPlaywrightLocator,
} from "./playwright-client.ts"

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
      browserID?: string
    }
  | {
      type: "command"
      contractVersion: typeof BROWSER_CONTRACT_VERSION
      method: BrowserContractCommandMethod
      params: unknown
      browserID: string
      timeoutMs?: number
    }

export type BrowserRuntimeTransport = <TResult = unknown>(
  request: BrowserRuntimeTransportRequest,
) => Promise<TResult>

export interface BrowserRuntimeStatus extends Record<string, unknown> {
  connected: boolean
  authorizationVerificationAvailable?: boolean
  contractCompatible?: boolean
  extensionConnected?: boolean
  backends?: BrowserBackendInfo[]
}

export type BrowserReadinessState =
  | "ready"
  | "needs-browser"
  | "needs-extension"
  | "needs-native-host-repair"
  | "needs-extension-update"
  | "browser-not-installed"
  | "backend-unavailable"

export type BrowserReadinessAction =
  | "none"
  | "open-chrome"
  | "enable-extension"
  | "repair-native-host"
  | "update-extension"
  | "install-chrome"
  | "retry"

export interface BrowserReadiness {
  state: BrowserReadinessState
  action: BrowserReadinessAction
  connected: boolean
  launched: boolean
  message: string
  retryable: boolean
  status?: BrowserRuntimeStatus
  error?: {
    code: string
    message: string
    retryable?: boolean
  }
}

export interface BrowserReadinessOptions {
  launch?: boolean
  pollIntervalMs?: number
  settleTimeoutMs?: number
  timeoutMs?: number
}

export type BrowserSelection = {
  browserID?: string
  extensionInstanceID?: string
  preferredWindowId?: number
  url?: string | URL
}

export interface BrowserCollection {
  readiness(): Promise<BrowserReadiness>
  ensureReady(options?: BrowserReadinessOptions): Promise<BrowserReadiness>
  list(): Promise<BrowserContext[]>
  get(selection?: string | BrowserSelection): Promise<BrowserContext>
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
      turnID?: string
      messageID?: string
      toolCallID?: string
    }
    requestPermission?(input: Record<string, unknown>): Promise<{
      allowed: boolean
      decision: "deny" | "allow-once" | "allow-session"
      authorization?: string
      grantID?: string
    }>
    addLifecycleHook?(
      hook: (event: {
        type: string
        context?: {
          sessionID?: string
          turnID?: string
        }
      }) => void | Promise<void>,
    ): () => void
    setResponseMeta?(value: Record<string, unknown>): void
  }
  setupBrowserRuntime?: typeof setupBrowserRuntime
}

export interface SetupBrowserRuntimeOptions {
  chromeLauncher?: ChromeLauncher
  globals?: BrowserRuntimeGlobals
  nativeHostProbe?: () => Promise<void>
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
    if (request.type === "status") {
      return requestBrowserHost<TResult>({ operation: "status" })
    }
    await ensureNativeMessagingHost()
    if (request.type === "getInfo") {
      return requestBrowserHost<TResult>({
        operation: "getInfo",
        contractVersion: request.contractVersion,
        browserID: request.browserID,
      })
    }
    const requestMeta = globals.nodeRepl?.requestMeta
    if (
      !requestMeta?.sessionID
      || !requestMeta.turnID
      || !requestMeta.messageID
      || !requestMeta.toolCallID
    ) {
      throw new BrowserRuntimeError(
        "SESSION_REQUIRED",
        "Browser Contract v3 requires active Node REPL session, turn, message, and tool-call metadata.",
      )
    }
    const context = {
      ...requestMeta,
      browserID: request.browserID,
    }
    const hostRequest = {
      operation: "command",
      contractVersion: request.contractVersion,
      method: request.method,
      params: request.params,
      ...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
      context,
    } as const
    const recordResponseMeta = (result: unknown) => {
      if (typeof globals.nodeRepl?.setResponseMeta !== "function") return
      const record = isRecord(result) ? result : {}
      globals.nodeRepl.setResponseMeta({
        browser: {
          backend: request.browserID,
          method: request.method,
          openTabCount: Array.isArray(record.tabs) ? record.tabs.length : undefined,
          currentOrigin: typeof record.url === "string"
            ? (() => {
                try {
                  return new URL(record.url).origin
                } catch {
                  return undefined
                }
              })()
            : undefined,
          cleanup: request.method === "tabs.finalize"
            ? {
                closed: Array.isArray(record.closedTabIds)
                  ? record.closedTabIds.length
                  : 0,
                released: Array.isArray(record.releasedTabIds)
                  ? record.releasedTabIds.length
                  : 0,
                retained: Array.isArray(record.retainedTabIds)
                  ? record.retainedTabIds.length
                  : 0,
              }
            : undefined,
          screenshot: request.method === "page.screenshot"
            ? {
                tabId: record.tabId,
                mime: record.mime,
                byteLength: typeof record.data === "string"
                  ? Math.trunc(record.data.length * 0.75)
                  : undefined,
              }
            : undefined,
        },
      })
    }
    try {
      const result = await requestBrowserHost<TResult>(hostRequest)
      recordResponseMeta(result)
      return result
    } catch (error) {
      if (
        !(error instanceof BrowserHostClientError)
        || error.code !== "APPROVAL_REQUIRED"
      ) {
        throw error
      }
      const challenge = isRecord(error.details?.challenge)
        ? error.details.challenge
        : undefined
      if (!challenge || typeof globals.nodeRepl?.requestPermission !== "function") {
        throw new BrowserRuntimeError(
          "PERMISSION_DENIED",
          "The browser action requires approval, but in-process permission elicitation is unavailable.",
          { cause: error },
        )
      }
      const method = typeof challenge.method === "string"
        ? challenge.method
        : request.method
      const origin = typeof challenge.origin === "string"
        ? challenge.origin
        : "browser://unknown"
      const tabTitle = typeof challenge.tabTitle === "string"
        ? challenge.tabTitle
        : "Untitled tab"
      const permission = await globals.nodeRepl.requestPermission({
        message: `${method} on ${origin} in “${tabTitle}”`,
        challenge,
        grantID: challenge.grantID,
        method,
        tabID: typeof challenge.tabId === "number" ? challenge.tabId : undefined,
        tabTitle,
        risk: challenge.risk,
        sensitive: challenge.sensitive === true,
        action: challenge.permissionAction,
        rationale: challenge.rationale,
        scope: {
          kind: "browser-origin",
          sessionID: requestMeta.sessionID,
          extensionInstanceID: challenge.extensionInstanceID,
          browserID: request.browserID,
          origin,
        },
      })
      if (!permission.allowed || !permission.authorization) {
        throw new BrowserRuntimeError(
          "PERMISSION_DENIED",
          `Browser command '${request.method}' was not approved.`,
        )
      }
      const result = await requestBrowserHost<TResult>({
        ...hostRequest,
        authorization: {
          value: permission.authorization,
        },
      })
      recordResponseMeta(result)
      return result
    }
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
      "NATIVE_HOST_INSTALL_FAILED",
      "Chrome Native Messaging Host setup failed.",
      {
        retryable: true,
        details: {
          installError: cause instanceof Error
            ? cause.message
            : String(cause),
        },
        cause,
      },
    )
  })
  await nativeMessagingHostReady
}

async function probeNativeMessagingHost(): Promise<void> {
  if (process.env[NATIVE_INSTALL_ENV]?.trim().toLowerCase() === "off") return
  try {
    const bootstrapModule = await import(
      new URL("./native-host-bootstrap.js", import.meta.url).href
    ) as {
      probeNativeMessagingHost?: () => Promise<unknown>
      default?: {
        probeNativeMessagingHost?: () => Promise<unknown>
      }
    }
    const probe = bootstrapModule.probeNativeMessagingHost
      ?? bootstrapModule.default?.probeNativeMessagingHost
    if (typeof probe !== "function") {
      throw new Error(
        "Chrome plugin package is missing its Native Messaging Host probe.",
      )
    }
    await probe()
  } catch (cause) {
    throw new BrowserRuntimeError(
      "NATIVE_HOST_INSTALL_FAILED",
      "Chrome Native Messaging Host health check failed.",
      {
        retryable: true,
        details: {
          probeError: cause instanceof Error ? cause.message : String(cause),
        },
        cause,
      },
    )
  }
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

function wait(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs))
}

function boundedDuration(
  value: number | undefined,
  fallback: number,
  maximum: number,
) {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(0, Math.floor(value)), maximum)
}

function readinessError(error: unknown) {
  const code = (
    error instanceof BrowserRuntimeError
    || error instanceof BrowserHostClientError
    || error instanceof ChromeLaunchError
  )
    ? error.code
    : isRecord(error) && typeof error.code === "string"
      ? error.code
      : "BACKEND_UNAVAILABLE"
  return {
    code,
    message: error instanceof Error
      ? error.message
      : "The Chrome browser backend is unavailable.",
    retryable: (
      error instanceof BrowserRuntimeError
      || error instanceof BrowserHostClientError
    )
      ? error.retryable
      : isRecord(error) && typeof error.retryable === "boolean"
        ? error.retryable
        : undefined,
  }
}

function statusReadiness(
  status: BrowserRuntimeStatus,
  launched = false,
): BrowserReadiness {
  if (status.authorizationVerificationAvailable === false) {
    return {
      state: "backend-unavailable",
      action: "retry",
      connected: false,
      launched,
      message:
        "Browser authorization verification is unavailable in the current Anybox Node REPL session.",
      retryable: true,
      status,
      error: {
        code: "AUTHORIZATION_INVALID",
        message: "Browser authorization verification is unavailable.",
        retryable: true,
      },
    }
  }
  if (status.connected) {
    return {
      state: "ready",
      action: "none",
      connected: true,
      launched,
      message: "Chrome is connected and ready.",
      retryable: false,
      status,
    }
  }
  if (status.contractCompatible === false) {
    return {
      state: "needs-extension-update",
      action: "update-extension",
      connected: false,
      launched,
      message:
        "The connected Anybox Chrome extension is incompatible and must be updated.",
      retryable: false,
      status,
    }
  }
  return {
    state: "needs-browser",
    action: "open-chrome",
    connected: false,
    launched,
    message: "Chrome is not connected. Open Chrome to continue.",
    retryable: true,
    status,
  }
}

function failedReadiness(
  error: unknown,
  launched = false,
): BrowserReadiness {
  const normalized = readinessError(error)
  if (normalized.code === "NATIVE_HOST_INSTALL_FAILED") {
    return {
      state: "needs-native-host-repair",
      action: "repair-native-host",
      connected: false,
      launched,
      message:
        "The Anybox Chrome Native Messaging Host installation or authenticated local channel is unavailable.",
      retryable: true,
      error: normalized,
    }
  }
  return {
    state: "backend-unavailable",
    action: "retry",
    connected: false,
    launched,
    message: "The Anybox Chrome browser backend is unavailable.",
    retryable: normalized.retryable ?? true,
    error: normalized,
  }
}

function launchFailedReadiness(error: unknown): BrowserReadiness {
  const normalized = readinessError(error)
  if (normalized.code === "CHROME_NOT_FOUND") {
    return {
      state: "browser-not-installed",
      action: "install-chrome",
      connected: false,
      launched: false,
      message: "Google Chrome is not installed or could not be found.",
      retryable: false,
      error: normalized,
    }
  }
  return {
    state: "backend-unavailable",
    action: "retry",
    connected: false,
    launched: false,
    message: "Google Chrome could not be opened.",
    retryable: true,
    error: normalized,
  }
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
  readonly #browserID?: string

  constructor(transport: BrowserRuntimeTransport, browserID?: string) {
    this.#transport = transport
    this.#browserID = browserID
  }

  async status(): Promise<BrowserRuntimeStatus> {
    return parseStatus(await this.#transport({ type: "status" }))
  }

  async getInfo(browserID = this.#browserID): Promise<BrowserGetInfoResult> {
    return validateGetInfo(await this.#transport({
      type: "getInfo",
      contractVersion: BROWSER_CONTRACT_VERSION,
      ...(browserID ? { browserID } : {}),
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
      browserID: this.#browserID ?? "extension",
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    })
  }
}

export class CommandRouter {
  readonly #backend: BackendTransport
  readonly #supportedCommands: ReadonlySet<BrowserContractCommandMethod>
  readonly capabilities: BrowserBackendCapabilities

  constructor(
    backend: BackendTransport,
    capabilities: BrowserBackendCapabilities,
  ) {
    this.#backend = backend
    this.capabilities = capabilities
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
    try {
      const rawResult = await this.#backend.command(
        method,
        parsedParams,
        options,
      )
      return parseBrowserCommandResult(method, rawResult)
    } catch (cause) {
      if (cause instanceof BrowserHostClientError) {
        throw new BrowserRuntimeError(
          cause.code as BrowserContractErrorCode,
          cause.message,
          {
            retryable: cause.retryable,
            details: cause.details,
            cause,
          },
        )
      }
      throw cause
    }
  }
}

export class BrowserTab {
  readonly #router: CommandRouter
  declare readonly playwright: BrowserPlaywrightAPI
  tabId: number

  constructor(tabId: number, router: CommandRouter) {
    this.#router = router
    this.tabId = validateTabId(tabId)
    const hasPlaywright = router.capabilities.features.playwrightLocator
      && BROWSER_CONTRACT_V3_PLAYWRIGHT_COMMAND_METHODS.every((method) =>
        router.supports(method)
      )
    if (hasPlaywright) {
      Object.defineProperty(this, "playwright", {
        configurable: false,
        enumerable: true,
        value: new BrowserPlaywrightAPI(router, () => this.tabId),
        writable: false,
      })
    } else {
      return new Proxy(this, {
        get(target, property) {
          if (property === "playwright") return undefined
          const value = Reflect.get(target, property, target)
          return typeof value === "function" ? value.bind(target) : value
        },
        has(target, property) {
          if (property === "playwright") return false
          return Reflect.has(target, property)
        },
        getOwnPropertyDescriptor(target, property) {
          if (property === "playwright") return undefined
          return Reflect.getOwnPropertyDescriptor(target, property)
        },
      })
    }
  }

  private withTabId(
    params: Record<string, unknown> = {},
  ): Record<string, unknown> {
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

  async type(
    text: string,
    options: { sensitive?: boolean } = {},
  ): Promise<BrowserExtensionTypeResult> {
    return this.#router.run(
      "page.type",
      this.withTabId({ text, ...options }),
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

  async markDeliverable(): Promise<BrowserExtensionTabsMarkDeliverableResult> {
    return this.#router.run("tabs.markDeliverable", { tabId: this.tabId })
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
    listUser(): Promise<Array<BrowserExtensionTabSummary & { runtime: BrowserTab }>>
    open(url: string, options?: TabsOpenOptions): Promise<BrowserTab>
    claim(tabId: number): Promise<BrowserTab>
    activate(tabId: number): Promise<BrowserTab>
    get(tabId: number): Promise<BrowserTab>
    current(): Promise<BrowserTab>
    finalize(options?: BrowserContractCommandParams<"tabs.finalize">): Promise<
      BrowserExtensionTabsFinalizeResult
    >
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
    this.#router = new CommandRouter(
      backend,
      this.capabilities,
    )
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
      listUser: async () => {
        const result = await this.#router.run("tabs.listUser", {})
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
      claim: async (tabId) => {
        const tab = await this.#router.run("tabs.claim", { tabId })
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
      finalize: async (options = {}) =>
        this.#router.run("tabs.finalize", options),
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
  readonly #transport: BrowserRuntimeTransport
  readonly #backend: BackendTransport
  readonly #chromeLauncher: ChromeLauncher
  readonly #nativeHostProbe: () => Promise<void>

  constructor(
    transport: BrowserRuntimeTransport,
    chromeLauncher: ChromeLauncher = createChromeLauncher(),
    nativeHostProbe: () => Promise<void> = async () => undefined,
  ) {
    this.#transport = transport
    this.#backend = new BackendTransport(transport)
    this.#chromeLauncher = chromeLauncher
    this.#nativeHostProbe = nativeHostProbe
  }

  private async readReadiness(launched = false) {
    try {
      return statusReadiness(await this.#backend.status(), launched)
    } catch (error) {
      return failedReadiness(error, launched)
    }
  }

  private async waitForReadiness(
    timeoutMs: number,
    pollIntervalMs: number,
    launched: boolean,
  ) {
    const deadline = Date.now() + timeoutMs
    let readiness: BrowserReadiness
    do {
      readiness = await this.readReadiness(launched)
      if (readiness.state !== "needs-browser") return readiness
      const remaining = deadline - Date.now()
      if (remaining <= 0) return readiness
      await wait(Math.min(pollIntervalMs, remaining))
    } while (true)
  }

  async readiness(): Promise<BrowserReadiness> {
    return this.readReadiness()
  }

  async ensureReady(
    options: BrowserReadinessOptions = {},
  ): Promise<BrowserReadiness> {
    const pollIntervalMs = boundedDuration(
      options.pollIntervalMs,
      250,
      5_000,
    )
    const settleTimeoutMs = boundedDuration(
      options.settleTimeoutMs,
      750,
      10_000,
    )
    const timeoutMs = boundedDuration(options.timeoutMs, 10_000, 60_000)

    let readiness = await this.readReadiness()
    if (readiness.state !== "needs-browser" || options.launch !== true) {
      return readiness
    }

    if (settleTimeoutMs > 0) {
      readiness = await this.waitForReadiness(
        settleTimeoutMs,
        Math.max(1, pollIntervalMs),
        false,
      )
      if (readiness.state !== "needs-browser") return readiness
    }

    try {
      await this.#nativeHostProbe()
    } catch (error) {
      const recovered = await this.readReadiness()
      return recovered.state === "ready"
        ? recovered
        : failedReadiness(error)
    }

    readiness = await this.readReadiness()
    if (readiness.state !== "needs-browser") return readiness

    try {
      await this.#chromeLauncher.launch()
    } catch (error) {
      return launchFailedReadiness(error)
    }

    readiness = await this.waitForReadiness(
      timeoutMs,
      Math.max(1, pollIntervalMs),
      true,
    )
    if (readiness.state !== "needs-browser") return readiness
    return {
      ...readiness,
      state: "needs-extension",
      action: "enable-extension",
      message:
        "Chrome opened, but the Anybox Chrome extension did not connect. Install or enable the extension, then retry.",
    }
  }

  async list(): Promise<BrowserContext[]> {
    const status = await this.#backend.status()
    const backends = Array.isArray(status.backends)
      ? status.backends.filter((backend) => backend.connected)
      : []
    if (backends.length === 0) return [await this.getDefault()]
    return Promise.all(
      backends.map((backend) => this.get(backend.browserId)),
    )
  }

  async get(
    selection: string | BrowserSelection = "extension",
  ): Promise<BrowserContext> {
    if (typeof selection !== "string") {
      const requestedID = selection.browserID
        ?? selection.extensionInstanceID
      if (requestedID) return this.get(requestedID)
      if (selection.url) return this.getForUrl(selection.url)
      if (
        Number.isInteger(selection.preferredWindowId)
        && Number(selection.preferredWindowId) > 0
      ) {
        const preferredWindowId = Number(selection.preferredWindowId)
        const browsers = await this.list()
        for (const browser of browsers) {
          const tabs = await this.routingTabs(browser)
          if (tabs.some((tab) => tab.windowId === preferredWindowId)) {
            return browser
          }
        }
      }
      return this.getDefault()
    }
    const name = selection
    const requestedBrowserID = name === "extension" ? undefined : name
    const info = await this.#backend.getInfo(requestedBrowserID)
    if (
      requestedBrowserID
      && info.backend.browserId !== requestedBrowserID
      && info.backend.instanceID !== requestedBrowserID
    ) {
      throw new BrowserRuntimeError(
        "BACKEND_UNAVAILABLE",
        `Unknown browser runtime '${name}'.`,
      )
    }
    return new BrowserContext(
      new BackendTransport(this.#transport, info.backend.browserId),
      info,
    )
  }

  async getDefault(): Promise<BrowserContext> {
    return this.get("extension")
  }

  async getForUrl(url: string | URL): Promise<BrowserContext> {
    const target = validateBrowserUrl(url)
    const browsers = await this.list()
    for (const browser of browsers) {
      const tabs = await this.routingTabs(browser)
      if (tabs.some((tab) => {
        try {
          return tab.url ? new URL(tab.url).origin === target.origin : false
        } catch {
          return false
        }
      })) {
        return browser
      }
    }
    return browsers[0] ?? this.getDefault()
  }

  private async routingTabs(browser: BrowserContext) {
    const methods = [
      browser.capabilities.commands.includes("tabs.list")
        ? browser.tabs.list()
        : Promise.resolve([]),
      browser.capabilities.commands.includes("tabs.listUser")
        ? browser.tabs.listUser()
        : Promise.resolve([]),
    ]
    return (await Promise.all(methods)).flat()
  }

  async finalizeAll(reason: BrowserContractCommandParams<"tabs.finalize">["reason"]) {
    const browsers = await this.list()
    return Promise.all(
      browsers.map((browser) =>
        browser.capabilities.commands.includes("tabs.finalize")
          ? browser.tabs.finalize({ reason })
          : Promise.resolve(undefined)
      ),
    )
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

  const browsers = new BrowserManager(
    transport,
    options.chromeLauncher ?? createChromeLauncher(),
    options.nativeHostProbe
      ?? (options.transport ? async () => undefined : probeNativeMessagingHost),
  )
  agent.browsers = browsers
  globals.agent = agent
  globals.setupBrowserRuntime = setupBrowserRuntime
  globals.nodeRepl?.addLifecycleHook?.(async (event) => {
    const reason = event.type === "reset"
      ? "node-repl-reset"
      : event.type === "session-end"
        ? "session-end"
        : event.type === "transport-close"
          ? "native-disconnect"
          : "turn-end"
    await browsers.finalizeAll(reason).catch(() => undefined)
  })
  return agent
}
