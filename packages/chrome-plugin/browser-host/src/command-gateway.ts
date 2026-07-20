import {
  BrowserExtensionTabSummary,
  type BrowserExtensionCommandContext,
} from "@anybox/chrome-shared/browser-extension"
import { createHash } from "node:crypto"
import { realpathSync, statSync } from "node:fs"
import { resolve } from "node:path"
import {
  BROWSER_CONTRACT_V3_PLAYWRIGHT_COMMAND_METHODS,
  BROWSER_CONTRACT_VERSION,
  BrowserCommandExecutionContext,
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
  ...BROWSER_CONTRACT_V3_PLAYWRIGHT_COMMAND_METHODS,
])

const NON_IDEMPOTENT_INPUT_METHODS = new Set<BrowserContractCommandMethod>([
  "page.click",
  "page.clickElement",
  "page.fill",
  "page.type",
  "playwright.locator.click",
  "playwright.locator.dblclick",
  "playwright.locator.fill",
  "playwright.locator.type",
  "playwright.locator.press",
  "playwright.locator.selectOption",
  "playwright.locator.setChecked",
  "playwright.fileChooser.setFiles",
])

function requestedContractVersion(
  request: Pick<BrowserIpcRuntimeCommandRequest, "contractVersion">,
) {
  const version = request.contractVersion
  if (version !== BROWSER_CONTRACT_VERSION) {
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
  authorizationPublicKey?: string,
) {
  const contractVersion = requestedContractVersion(request)
  const method = request.method as BrowserContractCommandMethod
  const backend = bridge.backendInfo(request.context?.browserID)
  const params = normalizeLocalFileParams(
    method,
    parseParams(method, request.params, contractVersion),
  )
  const requestFingerprint = authorizationRequestFingerprint(method, params)

  const parsedContext = parseCommandContext(request.context)
  const context = {
    ...parsedContext,
    extensionInstanceID: backend.instanceID,
  }
  const tabId = readTabId(params)
  const tab = tabId
    ? await describeTab(bridge, tabId, {
        context: request.context,
        timeoutMs: request.timeoutMs,
        browserID: request.context?.browserID,
      })
    : undefined

  enforceLeaseBeforeForward(method, tabId, tab, context)

  const targetUrl = method === "tabs.open"
    ? readStringField(params, "url")
    : tab?.url
  const origin = normalizeBrowserOrigin(targetUrl)
  const decision = authorize(policy, method, params, backend, origin)

  if (decision.permissionAction === "deny") {
    throw new BrowserCommandGatewayError(
      "PERMISSION_DENIED",
      `Browser command '${method}' is denied by origin policy.`,
    )
  }
  if (!authorizationPublicKey) {
    throw new BrowserCommandGatewayError(
      "AUTHORIZATION_INVALID",
      "Browser authorization verification is unavailable.",
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
      context,
      extensionInstanceID,
      origin,
      tabId,
      tabTitle: tab?.title,
      sensitive: decision.sensitive,
      permissionAction: decision.permissionAction,
      risk: decision.risk,
      rationale: decision.reason,
      requestFingerprint,
      authorizationPublicKey,
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
      context,
      extensionInstanceID: backend.instanceID!,
      origin,
      tabId,
      sensitive: decision.sensitive,
      requestFingerprint,
    }, authorizationPublicKey)
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

  let rawResult: unknown
  try {
    rawResult = await bridge.sendCommand(
      method,
      params,
      {
        context: request.context,
        timeoutMs: request.timeoutMs,
        browserID: request.context?.browserID,
        contractVersion,
      },
    )
  } catch (error) {
    throw backendGatewayError(error, method)
  }

  const result = parseResult(method, rawResult, contractVersion)
  updateOwnership(bridge, method, params, result, request.context)
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
  context: ReturnType<typeof parseCommandContext>,
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

function parseCommandContext(context: BrowserExtensionCommandContext | undefined) {
  const parsed = BrowserCommandExecutionContext.safeParse(context)
  if (!parsed.success) {
    throw new BrowserCommandGatewayError(
      "SESSION_REQUIRED",
      "Browser Contract v3 requires sessionID, turnID, messageID, toolCallID, and browserID.",
    )
  }
  return parsed.data
}

function normalizeLocalFileParams(
  method: BrowserContractCommandMethod,
  params: unknown,
) {
  if (method !== "playwright.fileChooser.setFiles") return params
  const input = params as Record<string, unknown>
  const files = Array.isArray(input.files) ? input.files : []
  const normalized: string[] = []
  for (const item of files) {
    if (typeof item !== "string") {
      throw new BrowserCommandGatewayError(
        "INVALID_COMMAND_PARAMS",
        "File chooser paths must be strings.",
      )
    }
    try {
      const canonical = realpathSync.native(resolve(item))
      if (!statSync(canonical).isFile()) {
        throw new Error("not a regular file")
      }
      normalized.push(canonical)
    } catch {
      throw new BrowserCommandGatewayError(
        "PERMISSION_DENIED",
        "A requested upload path is unavailable or is not a local regular file.",
      )
    }
  }
  return { ...input, files: normalized }
}

function authorizationRequestFingerprint(
  method: BrowserContractCommandMethod,
  params: unknown,
) {
  if (method !== "playwright.fileChooser.setFiles") return undefined
  const record = params as Record<string, unknown>
  const files = Array.isArray(record.files)
    ? record.files.filter((item): item is string => typeof item === "string")
    : []
  const resources = files.map((file) => {
    const stats = statSync(file)
    return {
      path: file,
      device: stats.dev,
      inode: stats.ino,
      size: stats.size,
      modifiedAt: stats.mtimeMs,
    }
  })
  return createHash("sha256")
    .update(JSON.stringify(resources), "utf8")
    .digest("hex")
}

export function backendGatewayError(
  error: unknown,
  method: BrowserContractCommandMethod,
) {
  if (error instanceof BrowserCommandGatewayError) return error
  const extensionCode = BrowserContractErrorCode.safeParse(
    error && typeof error === "object"
      ? (error as { code?: unknown }).code
      : undefined,
  )
  if (
    extensionCode.success
    && extensionCode.data === "DEADLINE_EXCEEDED"
    && NON_IDEMPOTENT_INPUT_METHODS.has(method)
  ) {
    return new BrowserCommandGatewayError(
      "ACTION_OUTCOME_UNKNOWN",
      publicBackendErrorMessage("ACTION_OUTCOME_UNKNOWN", method),
      false,
      {
        phase: "transport-timeout",
        action: method,
      },
    )
  }
  if (extensionCode.success) {
    const details = error && typeof error === "object"
      ? sanitizeBackendErrorDetails(
        (error as { details?: unknown }).details,
      )
      : undefined
    return new BrowserCommandGatewayError(
      extensionCode.data,
      publicBackendErrorMessage(extensionCode.data, method),
      error && typeof error === "object"
        && typeof (error as { retryable?: unknown }).retryable === "boolean"
        ? (error as { retryable: boolean }).retryable
        : false,
      details,
    )
  }
  if (NON_IDEMPOTENT_INPUT_METHODS.has(method)) {
    return new BrowserCommandGatewayError(
      "ACTION_OUTCOME_UNKNOWN",
      publicBackendErrorMessage("ACTION_OUTCOME_UNKNOWN", method),
      false,
      {
        phase: "transport",
        action: method,
      },
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
    case "LOCATOR_PARSE_ERROR":
      return `Browser command '${method}' contains an invalid Locator plan.`
    case "LOCATOR_NOT_FOUND":
      return `Browser command '${method}' did not find its Locator target.`
    case "LOCATOR_STRICT_VIOLATION":
      return `Browser command '${method}' matched more than one Locator target.`
    case "LOCATOR_NOT_ACTIONABLE":
      return `Browser command '${method}' found a target that was not actionable.`
    case "STALE_DOCUMENT":
    case "FRAME_DETACHED":
      return `Browser command '${method}' lost its document or frame context.`
    case "ACTION_OUTCOME_UNKNOWN":
      return `Browser command '${method}' may have dispatched input; its outcome is unknown and it must not be replayed blindly.`
    case "EVENT_EXPIRED":
      return `Browser command '${method}' used an expired browser event handle.`
    case "BACKEND_UNAVAILABLE":
      return "The Chrome extension backend is unavailable."
    default:
      return `Browser command '${method}' failed in the extension backend.`
  }
}

function sanitizeBackendErrorDetails(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }
  const input = value as Record<string, unknown>
  const output: Record<string, unknown> = {}
  const stringKeys = [
    "phase",
    "action",
    "reason",
    "engineMessage",
    "cause",
  ] as const
  for (const key of stringKeys) {
    if (typeof input[key] === "string") {
      output[key] = input[key].slice(0, 500)
    }
  }
  for (const key of [
    "matchCount",
    "documentGeneration",
    "fromGeneration",
  ] as const) {
    if (typeof input[key] === "number" && Number.isFinite(input[key])) {
      output[key] = input[key]
    }
  }
  if (Array.isArray(input.candidatePreviews)) {
    output.candidatePreviews = input.candidatePreviews
      .filter((item): item is string => typeof item === "string")
      .slice(0, 10)
      .map((item) => item.slice(0, 500))
  }
  if (Array.isArray(input.framePath)) {
    output.framePath = input.framePath.slice(0, 16).map((item) => {
      const frame = item && typeof item === "object" && !Array.isArray(item)
        ? item as Record<string, unknown>
        : {}
      return typeof frame.frameId === "string"
        ? { frameId: frame.frameId.slice(0, 256) }
        : {}
    })
  }
  return Object.keys(output).length > 0 ? output : undefined
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

function updateOwnership(
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
