import {
  BrowserExtensionTabSummary,
  BrowserExtensionTabsListResult,
  type BrowserExtensionCommandContext,
} from "@anybox/chrome-shared/browser-extension"
import {
  BROWSER_CONTRACT_VERSION,
  BrowserContractErrorCode,
  BrowserContractValidationError,
  parseBrowserCommandParams,
  parseBrowserCommandResult,
  type BrowserBackendInfo,
  type BrowserContractCommandMethod,
} from "@anybox/chrome-shared/browser-contract"
import type { BrowserIpcRuntimeCommandRequest } from "@anybox/chrome-shared/browser-ipc"
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
  ) {
    super(message)
    this.name = "BrowserCommandGatewayError"
  }
}

export async function runBrowserRuntimeCommand(
  request: Pick<
    BrowserIpcRuntimeCommandRequest,
    "contractVersion" | "method" | "params" | "context" | "timeoutMs"
  >,
  bridge: BrowserExtensionBridge = browserExtensionBridge,
  policy: BrowserPolicyEngine = browserPolicyEngine,
) {
  const method = request.method as BrowserContractCommandMethod
  const backend = bridge.backendInfo()
  const params = await normalizeCommandParams(
    request,
    method,
    bridge,
    policy,
    backend,
  )
  authorize(policy, method, params, backend)

  let rawResult: unknown
  try {
    if (method === "tabs.release") {
      const tabId = readTabId(params)
      if (!tabId) {
        throw new BrowserCommandGatewayError(
          "INVALID_COMMAND_PARAMS",
          "tabs.release requires a positive integer tabId.",
        )
      }
      rawResult = {
        tabId,
        released: bridge.releaseOwnedTab(
          tabId,
          request.context?.sessionID,
        ),
      }
    } else {
      rawResult = await bridge.sendCommand(
        method,
        params,
        {
          context: request.context,
          timeoutMs: request.timeoutMs,
        },
      )
    }
  } catch (error) {
    throw backendGatewayError(error, method)
  }

  const result = parseResult(method, rawResult)
  updateOwnership(bridge, method, params, result, request.context)
  return result
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

async function normalizeCommandParams(
  request: Pick<
    BrowserIpcRuntimeCommandRequest,
    "contractVersion" | "params" | "context" | "timeoutMs"
  >,
  method: BrowserContractCommandMethod,
  bridge: BrowserExtensionBridge,
  policy: BrowserPolicyEngine,
  backend: BrowserBackendInfo,
) {
  if (
    request.contractVersion !== undefined
    && request.contractVersion !== BROWSER_CONTRACT_VERSION
  ) {
    throw new BrowserCommandGatewayError(
      "CONTRACT_VERSION_UNSUPPORTED",
      `Browser contract version '${String(request.contractVersion)}' is not supported.`,
    )
  }

  if (
    request.contractVersion === BROWSER_CONTRACT_VERSION
    || !LEGACY_OPTIONAL_TAB_METHODS.has(method)
  ) {
    return parseParams(method, request.params)
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
  )
  if (hasExplicitTabId) return validated

  let tabId = bridge.preferredTabID(request.context?.sessionID)
  if (!tabId) {
    const listParams = parseParams("tabs.list", {})
    authorize(policy, "tabs.list", listParams, backend)

    let rawTabs: unknown
    try {
      rawTabs = await bridge.sendCommand(
        "tabs.list",
        listParams,
        {
          context: request.context,
          timeoutMs: request.timeoutMs,
        },
      )
    } catch (error) {
      throw backendGatewayError(error, "tabs.list")
    }
    const listed = BrowserExtensionTabsListResult.parse(
      parseResult("tabs.list", rawTabs),
    )
    tabId = listed.tabs.find((tab) => tab.active)?.id
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
  })
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
    case "TAB_NOT_FOUND":
    case "TAB_NOT_OWNED":
    case "TAB_CLAIM_REQUIRED":
      return `Browser command '${method}' cannot use the requested tab.`
    case "DEADLINE_EXCEEDED":
      return `Browser command '${method}' exceeded its deadline.`
    case "CANCELLED":
      return `Browser command '${method}' was cancelled.`
    case "BACKEND_UNAVAILABLE":
      return "The Chrome extension backend is unavailable."
    case "INVALID_COMMAND_PARAMS":
    case "INVALID_COMMAND_RESULT":
    case "COMMAND_NOT_SUPPORTED":
    case "CAPABILITY_UNAVAILABLE":
    case "CONTRACT_VERSION_UNSUPPORTED":
    case "SESSION_REQUIRED":
    case "SESSION_ENDED":
    case "TURN_ENDED":
    case "COMMAND_FAILED":
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
) {
  try {
    return policy.authorize({ method, params, backend })
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
) {
  try {
    return parseBrowserCommandParams(method, value)
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
) {
  try {
    return parseBrowserCommandResult(method, value)
  } catch (error) {
    if (error instanceof BrowserContractValidationError) {
      throw new BrowserCommandGatewayError(error.code, error.message)
    }
    throw error
  }
}

function updateOwnership(
  bridge: BrowserExtensionBridge,
  method: BrowserContractCommandMethod,
  params: unknown,
  result: unknown,
  context: BrowserExtensionCommandContext | undefined,
) {
  if (method === "tabs.open") {
    const parsedTab = BrowserExtensionTabSummary.safeParse(result)
    if (parsedTab.success) {
      bridge.markOwnedTab(parsedTab.data, context)
    }
    return
  }

  bridge.touchTab(
    readTabId(result) ?? readTabId(params),
    context,
  )
}

function readTabId(value: unknown) {
  if (!value || typeof value !== "object") return undefined
  const tabId = (value as { tabId?: unknown }).tabId
  return Number.isInteger(tabId) && Number(tabId) > 0
    ? Number(tabId)
    : undefined
}
