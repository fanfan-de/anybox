import type { BrowserExtensionCommandContext } from "@anybox/shared/browser-extension"
import { BrowserCommandGatewayError } from "#browser-extension/command-gateway.ts"

export interface McpHostRequestContext {
  sessionID?: string
  messageID?: string
  toolCallID?: string
}

export type McpHostServiceResponse =
  | {
      ok: true
      data: unknown
    }
  | {
      ok: false
      error: {
        code: string
        message: string
        retryable?: boolean
        details?: Record<string, unknown>
      }
    }

function errorResponse(error: unknown): McpHostServiceResponse {
  if (error instanceof BrowserCommandGatewayError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      },
    }
  }

  return {
    ok: false,
    error: {
      code: "HOST_SERVICE_FAILED",
      message: "The Anybox host service could not complete the request.",
    },
  }
}

export async function runMcpHostService(
  service: string,
  request: unknown,
  context: McpHostRequestContext | undefined,
): Promise<McpHostServiceResponse> {
  try {
    if (service === "browser") {
      const { runBrowserRuntimeHostRequest } = await import(
        "#browser-extension/runtime-host.ts"
      )
      return {
        ok: true,
        data: await runBrowserRuntimeHostRequest(
          request,
          context as BrowserExtensionCommandContext | undefined,
        ),
      }
    }

    return {
      ok: false,
      error: {
        code: "HOST_SERVICE_NOT_FOUND",
        message: `Anybox host service '${service}' is not registered.`,
      },
    }
  } catch (error) {
    return errorResponse(error)
  }
}
