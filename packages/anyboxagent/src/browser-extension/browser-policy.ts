import {
  BrowserContractCommandMethod,
  BrowserContractCommandRegistry,
  type BrowserBackendInfo,
  type BrowserCommandSecurityClass,
  type BrowserContractCommandMethod as BrowserContractCommandMethodValue,
  type BrowserContractErrorCode,
} from "@anybox/shared/browser-contract"

export type BrowserPolicyDecision = {
  method: BrowserContractCommandMethodValue
  security: BrowserCommandSecurityClass
  capabilityChecked: true
  ownershipEnforced: false
  perActionApprovalEnforced: false
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

/**
 * First-slice policy boundary.
 *
 * This engine authoritatively restricts runtime commands to the negotiated
 * backend capability set. Tab ownership and per-action approval are
 * intentionally reported as unenforced until their dedicated protocol phases
 * land; callers must not interpret a successful decision as either proof.
 */
export class BrowserPolicyEngine {
  authorize(input: {
    method: unknown
    params: unknown
    backend: BrowserBackendInfo
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

    // Keep params in the policy input even though this phase only applies the
    // backend capability gate. Later origin and action policies can inspect the
    // already contract-validated value without changing the call boundary.
    void input.params

    return {
      method: method.data,
      security: BrowserContractCommandRegistry[method.data].security,
      capabilityChecked: true,
      ownershipEnforced: false,
      perActionApprovalEnforced: false,
    }
  }
}

export const browserPolicyEngine = new BrowserPolicyEngine()
