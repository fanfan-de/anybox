import {
  BrowserContractCommandMethod,
  BrowserContractCommandRegistry,
  type BrowserBackendInfo,
  type BrowserCommandSecurityClass,
  type BrowserContractCommandMethod as BrowserContractCommandMethodValue,
  type BrowserContractErrorCode,
} from "@anybox/chrome-shared/browser-contract"
import { normalizeBrowserOrigin } from "./browser-authorization.ts"

export type BrowserPolicyDecision = {
  method: BrowserContractCommandMethodValue
  security: BrowserCommandSecurityClass
  capabilityChecked: true
  ownershipEnforced: true
  perActionApprovalEnforced: true
  permissionAction: "allow" | "ask" | "deny"
  risk: "low" | "medium" | "high" | "critical"
  sensitive: boolean
  reason: string
}

export class BrowserPolicyError extends Error {
  constructor(
    readonly code: Extract<
      BrowserContractErrorCode,
      "COMMAND_NOT_SUPPORTED" | "BACKEND_UNAVAILABLE" | "CAPABILITY_UNAVAILABLE"
    >,
    message: string,
  ) {
    super(message)
    this.name = "BrowserPolicyError"
  }
}

const SAFE_SESSION_METHODS = new Set<BrowserContractCommandMethodValue>([
  "tabs.list",
  "tabs.listUser",
  "tabs.activate",
  "tabs.release",
  "tabs.markDeliverable",
  "tabs.finalize",
  "page.snapshot",
  "page.interactiveSnapshot",
  "page.domTree",
  "page.accessibilityTree",
  "page.screenshot",
  "page.scroll",
  "page.waitFor",
  "locator.textContent",
  "locator.inputValue",
  "locator.waitFor",
])

const ORIGIN_SCOPED_ASK_METHODS = new Set<BrowserContractCommandMethodValue>([
  "tabs.open",
  "tabs.claim",
  "page.click",
  "page.clickElement",
  "page.fill",
  "page.type",
  "locator.click",
  "locator.fill",
])

function configuredOrigins(name: string) {
  return new Set(
    (process.env[name] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => normalizeBrowserOrigin(value))
      .filter((value) => value !== "browser://unknown"),
  )
}

function paramsRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export class BrowserPolicyEngine {
  authorize(input: {
    method: unknown
    params: unknown
    backend: BrowserBackendInfo
    origin?: string
  }): BrowserPolicyDecision {
    const method = BrowserContractCommandMethod.safeParse(input.method)
    if (!method.success) {
      throw new BrowserPolicyError(
        "COMMAND_NOT_SUPPORTED",
        `Browser command '${String(input.method)}' is not supported by the Anybox browser contract.`,
      )
    }
    if (!input.backend.connected) {
      throw new BrowserPolicyError(
        "BACKEND_UNAVAILABLE",
        `Browser backend '${input.backend.browserId}' is not connected.`,
      )
    }
    if (!input.backend.capabilities.commands.includes(method.data)) {
      throw new BrowserPolicyError(
        "CAPABILITY_UNAVAILABLE",
        `Browser backend '${input.backend.browserId}' does not support '${method.data}'.`,
      )
    }

    const params = paramsRecord(input.params)
    const sensitive = (
      method.data === "page.fill"
      || method.data === "page.type"
      || method.data === "locator.fill"
    ) && params.sensitive === true
    const origin = normalizeBrowserOrigin(input.origin)
    const denyOrigins = configuredOrigins("ANYBOX_BROWSER_ORIGIN_DENY")
    const allowOrigins = configuredOrigins("ANYBOX_BROWSER_ORIGIN_ALLOW")
    let permissionAction: BrowserPolicyDecision["permissionAction"]
    let reason: string
    let risk: BrowserPolicyDecision["risk"]

    // Fixed precedence: hard method restrictions are enforced by the contract
    // registry before this point, then explicit deny, forced-sensitive ask,
    // session grants in Anybox Agent, explicit allow, full access in Agent,
    // and finally the default class policy.
    if (denyOrigins.has(origin)) {
      permissionAction = "deny"
      risk = "high"
      reason = "This browser origin is explicitly denied."
    } else if (sensitive) {
      permissionAction = "ask"
      risk = "high"
      reason = "Sensitive browser input always requires a one-time decision."
    } else if (allowOrigins.has(origin)) {
      permissionAction = "allow"
      risk = "low"
      reason = "This browser origin is explicitly allowed."
    } else if (SAFE_SESSION_METHODS.has(method.data)) {
      permissionAction = "allow"
      risk = "low"
      reason = "This leased-tab operation is safe for the active session."
    } else if (ORIGIN_SCOPED_ASK_METHODS.has(method.data)) {
      permissionAction = "ask"
      risk = method.data.includes("fill") || method.data === "page.type"
        ? "high"
        : "medium"
      reason = "This browser interaction requires origin-scoped approval."
    } else {
      permissionAction = "ask"
      risk = "medium"
      reason = "This browser action requires approval by the default policy."
    }

    return {
      method: method.data,
      security: BrowserContractCommandRegistry[method.data].security,
      capabilityChecked: true,
      ownershipEnforced: true,
      perActionApprovalEnforced: true,
      permissionAction,
      risk,
      sensitive,
      reason,
    }
  }
}

export const browserPolicyEngine = new BrowserPolicyEngine()
