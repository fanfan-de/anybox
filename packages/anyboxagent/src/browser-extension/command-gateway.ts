import {
  BrowserExtensionTabSummary,
  type BrowserExtensionCommandContext,
} from "@anybox/shared/browser-extension"
import type { BrowserIpcRuntimeCommandRequest } from "@anybox/shared/browser-ipc"
import {
  browserExtensionBridge,
  type BrowserExtensionBridge,
} from "#browser-extension/bridge.ts"

export class BrowserCommandGatewayError extends Error {
  constructor(
    readonly code: "INVALID_MESSAGE" | "BROWSER_COMMAND_FAILED",
    message: string,
  ) {
    super(message)
    this.name = "BrowserCommandGatewayError"
  }
}

export async function runBrowserRuntimeCommand(
  request: Pick<
    BrowserIpcRuntimeCommandRequest,
    "method" | "params" | "context" | "timeoutMs"
  >,
  bridge: BrowserExtensionBridge = browserExtensionBridge,
) {
  if (request.method === "tabs.release") {
    const tabId = readTabId(request.params)
    if (!tabId) {
      throw new BrowserCommandGatewayError(
        "INVALID_MESSAGE",
        "tabs.release requires a positive integer tabId.",
      )
    }
    return {
      tabId,
      released: bridge.releaseOwnedTab(
        tabId,
        request.context?.sessionID,
      ),
    }
  }

  let result: unknown
  try {
    result = await bridge.sendCommand(
      request.method,
      request.params,
      {
        context: request.context,
        timeoutMs: request.timeoutMs,
      },
    )
  } catch (error) {
    throw new BrowserCommandGatewayError(
      "BROWSER_COMMAND_FAILED",
      error instanceof Error ? error.message : String(error),
    )
  }

  updateOwnership(bridge, request.method, request.params, result, request.context)
  return result
}

function updateOwnership(
  bridge: BrowserExtensionBridge,
  method: BrowserIpcRuntimeCommandRequest["method"],
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
