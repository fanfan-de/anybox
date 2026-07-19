import {
  BrowserExtensionTabSummary,
  BrowserExtensionTabsListResult,
  type BrowserExtensionCommandContext,
} from "@anybox/chrome-shared/browser-extension"
import {
  BROWSER_CONTRACT_SUPPORTED_VERSIONS,
  BROWSER_CONTRACT_V1_COMMAND_METHODS,
  BROWSER_CONTRACT_V1_VERSION,
  BROWSER_CONTRACT_VERSION,
  BrowserCommandExecutionContextV2,
  BrowserContractErrorCode,
  BrowserContractValidationError,
  parseBrowserCommandParams,
  parseBrowserCommandResult,
  type BrowserBackendInfo,
  type BrowserContractCommandMethod,
} from "@anybox/chrome-shared/browser-contract"
import type { BrowserIpcRuntimeCommandRequest } from "@anybox/chrome-shared/browser-ipc"
import {
  browserAuthorizationService,
  BrowserAuthorizationError,
  normalizeBrowserOrigin,
} from "./browser-authorization.ts"
import {
  browserExtensionBridge,
  type BrowserExtensionBridge,
} from "./bridge.ts"
import {
  BrowserPolicyError,
  browserPolicyEngine,
  type BrowserPolicyEngine,
} from "./browser-policy.ts"

export class BrowserCommandGatewayError extends Error {
  constructor(
    readonly code: BrowserContractErrorCode,
    message: string,
    readonly retryable = false,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = "BrowserCommandGatewayError"
  }
}

const LEGACY_OPTIONAL_TAB_METHODS = new Set<BrowserContractCommandMethod>([
  "tabs.activate",
  "page.snapshot",
  "page.interactiveSnapshot",
  "page.domTree",
  "page.accessibilityTree",
  "page.screenshot",
  "page.click",
  "page.clickElement",
  "page.fill",
  "page.type",
  "page.scroll",
  "page.waitFor",
])

const V1_SAFE_READ_METHODS = new Set<BrowserContractCommandMethod>([
  "tabs.list",
  "page.snapshot",
  "page.interactiveSnapshot",
  "page.domTree",
  "page.accessibilityTree",
  "page.screenshot",
  "page.waitFor",
])
const V1_COMMAND_METHODS = new Set<BrowserContractCommandMethod>(
  BROWSER_CONTRACT_V1_COMMAND_METHODS,
)

const LEASE_REQUIRED_METHODS = new Set<BrowserContractCommandMethod>([
  "tabs.activate",
  "tabs.release",
  "tabs.markDeliverable",
  "page.snapshot",
  "page.interactiveSnapshot",
  "page.domTree",
  "page.accessibilityTree",
  "page.screenshot",
  "page.click",
  "page.clickElement",
  "page.fill",
  "page.type",
  "page.scroll",
  "page.waitFor",
  "locator.click",
  "locator.fill",
  "locator.textContent",
  "locator.inputValue",
  "locator.waitFor",
])

function configuredContractMaxVersion() {
  const value = Number(process.env.ANYBOX_BROWSER_CONTRACT_MAX_VERSION)
  return Number.isInteger(value) && value > 0
    ? Math.min(value, BROWSER_CONTRACT_VERSION)
    : BROWSER_CONTRACT_VERSION
}

function requestedContractVersion(
  request: Pick<BrowserIpcRuntimeCommandRequest, "contractVersion">,
) {
  const version = request.contractVersion ?? BROWSER_CONTRACT_V1_VERSION
  if (
    !BROWSER_CONTRACT_SUPPORTED_VERSIONS.includes(
      version as (typeof BROWSER_CONTRACT_SUPPORTED_VERSIONS)[number],
    )
    || version > configuredContractMaxVersion()
  ) {
    throw new BrowserCommandGatewayError(
      "CONTRACT_VERSION_UNSUPPORTED",
      `Browser contract version '${version}' is not supported.`,
    )
  }
  return version
}

export async function runBrowserRuntimeCommand(
  request: Pick<
    BrowserIpcRuntimeCommandRequest,
    | "contractVersion"
    | "method"
    | "params"
    | "context"
    | "authorization"
    | "timeoutMs"
  >,
  bridge: BrowserExtensionBridge = browserExtensionBridge,
  policy: BrowserPolicyEngine = browserPolicyEngine,
) {
  const contractVersion = requestedContractVersion(request)
  const method = request.method as BrowserContractCommandMethod
  const backend = bridge.backendInfo(request.context?.browserID)
  if (
    contractVersion === BROWSER_CONTRACT_V1_VERSION
    && method === "tabs.open"
  ) {
    // Executable URL schemes are a hard prohibition and take precedence over
    // the migration error returned for all other v1 writes.
    parseParams(method, request.params, contractVersion)
  }
  if (
    contractVersion === BROWSER_CONTRACT_V1_VERSION
    && V1_COMMAND_METHODS.has(method)
    && !V1_SAFE_READ_METHODS.has(method)
  ) {
    throw new BrowserCommandGatewayError(
      "BACKEND_UPDATE_REQUIRED",
      `Browser command '${method}' requires Browser Contract v2 authorization and tab leasing.`,
    )
  }
  const params = await normalizeCommandParams(
    request,
    method,
    contractVersion,
    bridge,
    policy,
    backend,
  )

  if (
    contractVersion === BROWSER_CONTRACT_VERSION
    && backend.contractVersion === BROWSER_CONTRACT_V1_VERSION
    && !V1_SAFE_READ_METHODS.has(method)
  ) {
    throw new BrowserCommandGatewayError(
      "BACKEND_UPDATE_REQUIRED",
      `Browser command '${method}' requires an updated Chrome extension backend.`,
    )
  }

  const parsedContext = contractVersion === BROWSER_CONTRACT_VERSION
    ? parseV2Context(request.context)
    : undefined
  const context = parsedContext
    ? {
        ...parsedContext,
        extensionInstanceID: backend.instanceID,
      }
    : undefined
  const tabId = readTabId(params)
  const tab = tabId
    ? await describeTab(bridge, tabId, {
        context: request.context,
        timeoutMs: request.timeoutMs,
        browserID: request.context?.browserID,
      })
    : undefined

  if (
    contractVersion === BROWSER_CONTRACT_VERSION
    && backend.contractVersion === BROWSER_CONTRACT_VERSION
  ) {
    enforceLeaseBeforeForward(method, tabId, tab, context!)
  }

  const targetUrl = method === "tabs.open"
    ? readStringField(params, "url")
    : tab?.url
  const origin = normalizeBrowserOrigin(targetUrl)
  const decision = authorize(policy, method, params, backend, origin)

  if (contractVersion === BROWSER_CONTRACT_VERSION) {
    if (decision.permissionAction === "deny") {
      throw new BrowserCommandGatewayError(
        "PERMISSION_DENIED",
        `Browser command '${method}' is denied by origin policy.`,
      )
    }
    if (!request.authorization?.value) {
      const extensionInstanceID = backend.instanceID
      if (!extensionInstanceID) {
        throw new BrowserCommandGatewayError(
          "BACKEND_UNAVAILABLE",
          "The Chrome extension backend has no stable instance identity.",
          true,
        )
      }
      const challenge = browserAuthorizationService.createChallenge({
        method,
        security: decision.security,
        context: context!,
        extensionInstanceID,
        origin,
        tabId,
        tabTitle: tab?.title,
        sensitive: decision.sensitive,
        permissionAction: decision.permissionAction,
        risk: decision.risk,
        rationale: decision.reason,
      })
      throw new BrowserCommandGatewayError(
        "APPROVAL_REQUIRED",
        `Browser command '${method}' requires an authorization receipt.`,
        true,
        { challenge },
      )
    }
    try {
      browserAuthorizationService.verify(request.authorization.value, {
        method,
        security: decision.security,
        context: context!,
        extensionInstanceID: backend.instanceID!,
        origin,
        tabId,
        sensitive: decision.sensitive,
      })
    } catch (error) {
      if (error instanceof BrowserAuthorizationError) {
        throw new BrowserCommandGatewayError(
          error.code,
          error.message,
          false,
          error.details,
        )
      }
      throw error
    }
  }

  const dispatchVersion =
    backend.contractVersion === BROWSER_CONTRACT_V1_VERSION
      ? BROWSER_CONTRACT_V1_VERSION
      : contractVersion
  let rawResult: unknown
  try {
    rawResult = await bridge.sendCommand(
      method,
      params,
      {
        context: request.context,
        timeoutMs: request.timeoutMs,
        browserID: request.context?.browserID,
        contractVersion: dispatchVersion,
      },
    )
  } catch (error) {
    throw backendGatewayError(error, method)
  }

  const result = parseResult(method, rawResult, contractVersion)
  updateLegacyOwnership(bridge, method, params, result, request.context)
  return result
}

async function describeTab(
  bridge: BrowserExtensionBridge,
  tabId: number,
  options: {
    context?: BrowserExtensionCommandContext
    timeoutMs?: number
    browserID?: string
  },
) {
  if (typeof bridge.describeTab !== "function") return undefined
  try {
    return await bridge.describeTab(tabId, options)
  } catch {
    return undefined
  }
}

function enforceLeaseBeforeForward(
  method: BrowserContractCommandMethod,
  tabId: number | undefined,
  tab: BrowserExtensionTabSummary | undefined,
  context: ReturnType<typeof parseV2Context>,
) {
  if (method === "tabs.claim") {
    if (
      tab?.lease
      && tab.lease.state !== "released"
      && (
        tab.lease.sessionID !== context.sessionID
        || tab.lease.extensionInstanceID !== context.extensionInstanceID
      )
    ) {
      throw new BrowserCommandGatewayError(
        "TAB_NOT_OWNED",
        "The requested tab belongs to another browser session.",
      )
    }
    return
  }
  if (!LEASE_REQUIRED_METHODS.has(method)) return
  if (!tabId || !tab?.lease || tab.lease.state === "released") {
    throw new BrowserCommandGatewayError(
      "TAB_CLAIM_REQUIRED",
      "The requested tab must be claimed before this command can run.",
    )
  }
  if (
    tab.lease.sessionID !== context.sessionID
    || tab.lease.extensionInstanceID !== context.extensionInstanceID
  ) {
    throw new BrowserCommandGatewayError(
      "TAB_NOT_OWNED",
      "The requested tab belongs to another browser session.",
    )
  }
  if (tab.lease.expiresAt <= Date.now()) {
    throw new BrowserCommandGatewayError(
      "LEASE_EXPIRED",
      "The requested tab lease has expired.",
    )
  }
}

function parseV2Context(context: BrowserExtensionCommandContext | undefined) {
  const parsed = BrowserCommandExecutionContextV2.safeParse(context)
  if (!parsed.success) {
    throw new BrowserCommandGatewayError(
      "SESSION_REQUIRED",
      "Browser Contract v2 requires sessionID, turnID, messageID, toolCallID, and browserID.",
    )
  }
  return parsed.data
}

async function normalizeCommandParams(
  request: Pick<
    BrowserIpcRuntimeCommandRequest,
    "contractVersion" | "params" | "context" | "timeoutMs"
  >,
  method: BrowserContractCommandMethod,
  contractVersion: number,
  bridge: BrowserExtensionBridge,
  policy: BrowserPolicyEngine,
  backend: BrowserBackendInfo,
) {
  if (
    contractVersion !== BROWSER_CONTRACT_V1_VERSION
    || request.contractVersion !== undefined
    || !LEGACY_OPTIONAL_TAB_METHODS.has(method)
  ) {
    return parseParams(method, request.params, contractVersion)
  }

  const legacyParams = legacyParamsRecord(request.params)
  const hasExplicitTabId =
    Object.prototype.hasOwnProperty.call(legacyParams, "tabId")
    && legacyParams.tabId !== undefined
  const validated = parseParams(
    method,
    hasExplicitTabId
      ? legacyParams
      : { ...legacyParams, tabId: 1 },
    contractVersion,
  )
  if (hasExplicitTabId) return validated

  let tabId = bridge.preferredTabID(request.context?.sessionID)
  if (!tabId) {
    const listParams = parseParams(
      "tabs.list",
      {},
      BROWSER_CONTRACT_V1_VERSION,
    )
    authorize(policy, "tabs.list", listParams, backend)

    let rawTabs: unknown
    try {
      rawTabs = await bridge.sendCommand(
        "tabs.list",
        listParams,
        {
          context: request.context,
          timeoutMs: request.timeoutMs,
          contractVersion: BROWSER_CONTRACT_V1_VERSION,
        },
      )
    } catch (error) {
      throw backendGatewayError(error, "tabs.list")
    }
    const listed = BrowserExtensionTabsListResult.parse(
      parseResult(
        "tabs.list",
        rawTabs,
        BROWSER_CONTRACT_V1_VERSION,
      ),
    )
    tabId = listed.tabs.find((candidate) => candidate.active)?.id
  }

  if (!tabId) {
    throw new BrowserCommandGatewayError(
      "TAB_NOT_FOUND",
      "The legacy browser command did not identify a tab and Chrome has no active tab.",
    )
  }

  return parseParams(method, {
    ...legacyParams,
    tabId,
  }, contractVersion)
}

function backendGatewayError(
  error: unknown,
  method: BrowserContractCommandMethod,
) {
  if (error instanceof BrowserCommandGatewayError) return error
  const extensionCode = BrowserContractErrorCode.safeParse(
    error && typeof error === "object"
      ? (error as { code?: unknown }).code
      : undefined,
  )
  if (extensionCode.success) {
    return new BrowserCommandGatewayError(
      extensionCode.data,
      publicBackendErrorMessage(extensionCode.data, method),
      error && typeof error === "object"
        && typeof (error as { retryable?: unknown }).retryable === "boolean"
        ? (error as { retryable: boolean }).retryable
        : false,
    )
  }
  return new BrowserCommandGatewayError(
    "COMMAND_FAILED",
    publicBackendErrorMessage("COMMAND_FAILED", method),
    true,
  )
}

function publicBackendErrorMessage(
  code: BrowserContractErrorCode,
  method: BrowserContractCommandMethod,
) {
  switch (code) {
    case "PERMISSION_DENIED":
      return `Browser command '${method}' was denied by the extension backend.`
    case "APPROVAL_REQUIRED":
      return `Browser command '${method}' requires approval.`
    case "AUTHORIZATION_INVALID":
    case "AUTHORIZATION_EXPIRED":
    case "AUTHORIZATION_REPLAYED":
      return `Browser command '${method}' has no valid authorization receipt.`
    case "BACKEND_UPDATE_REQUIRED":
      return `Browser command '${method}' requires a backend update.`
    case "TAB_NOT_FOUND":
    case "TAB_NOT_OWNED":
    case "TAB_CLAIM_REQUIRED":
    case "LEASE_EXPIRED":
      return `Browser command '${method}' cannot use the requested tab.`
    case "DEADLINE_EXCEEDED":
      return `Browser command '${method}' exceeded its deadline.`
    case "CANCELLED":
      return `Browser command '${method}' was cancelled.`
    case "BACKEND_UNAVAILABLE":
      return "The Chrome extension backend is unavailable."
    default:
      return `Browser command '${method}' failed in the extension backend.`
  }
}

function legacyParamsRecord(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BrowserCommandGatewayError(
      "INVALID_COMMAND_PARAMS",
      "Legacy browser command parameters must be an object.",
    )
  }
  return { ...(value as Record<string, unknown>) }
}

function authorize(
  policy: BrowserPolicyEngine,
  method: BrowserContractCommandMethod,
  params: unknown,
  backend: BrowserBackendInfo,
  origin?: string,
) {
  try {
    return policy.authorize({ method, params, backend, origin })
  } catch (error) {
    if (error instanceof BrowserPolicyError) {
      throw new BrowserCommandGatewayError(
        error.code,
        error.message,
        error.code === "BACKEND_UNAVAILABLE",
      )
    }
    throw error
  }
}

function parseParams(
  method: BrowserContractCommandMethod,
  value: unknown,
  contractVersion: number,
) {
  try {
    return parseBrowserCommandParams(method, value, contractVersion)
  } catch (error) {
    if (error instanceof BrowserContractValidationError) {
      throw new BrowserCommandGatewayError(error.code, error.message)
    }
    throw error
  }
}

function parseResult(
  method: BrowserContractCommandMethod,
  value: unknown,
  contractVersion: number,
) {
  try {
    return parseBrowserCommandResult(method, value, contractVersion)
  } catch (error) {
    if (error instanceof BrowserContractValidationError) {
      throw new BrowserCommandGatewayError(error.code, error.message)
    }
    throw error
  }
}

function updateLegacyOwnership(
  bridge: BrowserExtensionBridge,
  method: BrowserContractCommandMethod,
  params: unknown,
  result: unknown,
  context: BrowserExtensionCommandContext | undefined,
) {
  if (method === "tabs.open") {
    const parsedTab = BrowserExtensionTabSummary.safeParse(result)
    if (parsedTab.success) bridge.markOwnedTab(parsedTab.data, context)
    return
  }
  if (method === "tabs.release") {
    const tabId = readTabId(params)
    if (tabId) bridge.releaseOwnedTab(tabId, context?.sessionID)
    return
  }
  bridge.touchTab(readTabId(result) ?? readTabId(params), context)
}

function readTabId(value: unknown) {
  if (!value || typeof value !== "object") return undefined
  const record = value as { tabId?: unknown; id?: unknown }
  const tabId = record.tabId ?? record.id
  return Number.isInteger(tabId) && Number(tabId) > 0
    ? Number(tabId)
    : undefined
}

function readStringField(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }
  const item = (value as Record<string, unknown>)[key]
  return typeof item === "string" ? item : undefined
}
