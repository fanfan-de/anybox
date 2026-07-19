import { z } from "zod"
import {
  BROWSER_CONTRACT_VERSION,
  BrowserContractCommandMethod,
} from "@anybox/shared/browser-contract"
import type { BrowserExtensionCommandContext } from "@anybox/shared/browser-extension"
import {
  browserExtensionBridge,
  type BrowserExtensionBridge,
} from "#browser-extension/bridge.ts"
import {
  BrowserCommandGatewayError,
  runBrowserRuntimeCommand,
} from "#browser-extension/command-gateway.ts"
import {
  browserPolicyEngine,
  type BrowserPolicyEngine,
} from "#browser-extension/browser-policy.ts"

const BrowserRuntimeHostRequest = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("status"),
    })
    .strict(),
  z
    .object({
      type: z.literal("getInfo"),
      contractVersion: z.number().int(),
    })
    .strict(),
  z
    .object({
      type: z.literal("command"),
      contractVersion: z.number().int(),
      method: BrowserContractCommandMethod,
      params: z.unknown(),
      timeoutMs: z.number().int().positive().max(120_000).optional(),
    })
    .strict(),
])

export async function runBrowserRuntimeHostRequest(
  value: unknown,
  context: BrowserExtensionCommandContext | undefined,
  bridge: BrowserExtensionBridge = browserExtensionBridge,
  policy: BrowserPolicyEngine = browserPolicyEngine,
) {
  const parsed = BrowserRuntimeHostRequest.safeParse(value)
  if (!parsed.success) {
    throw new BrowserCommandGatewayError(
      "INVALID_COMMAND_PARAMS",
      "Browser runtime host request is invalid.",
    )
  }

  const request = parsed.data
  if (request.type === "status") {
    const bridgeStatus = bridge.status()
    const contract = bridge.browserContractCompatibility()
    return {
      connected: bridgeStatus.connected,
      contractCompatible: contract.compatible,
      backendVersion: bridgeStatus.active?.version,
      transport: "anybox-host-service",
    }
  }

  if (request.contractVersion !== BROWSER_CONTRACT_VERSION) {
    throw new BrowserCommandGatewayError(
      "CONTRACT_VERSION_UNSUPPORTED",
      `Browser Contract version '${request.contractVersion}' is not supported.`,
    )
  }

  if (request.type === "getInfo") {
    const contract = bridge.browserContractCompatibility()
    if (contract.connected && !contract.compatible) {
      throw new BrowserCommandGatewayError(
        "CONTRACT_VERSION_UNSUPPORTED",
        "The connected Chrome extension uses an incompatible Browser Contract.",
      )
    }
    return bridge.getInfo()
  }

  return runBrowserRuntimeCommand(
    {
      ...request,
      context,
    },
    bridge,
    policy,
  )
}
