import type { MiddlewareHandler } from "hono"
import type { UpgradeWebSocket } from "hono/ws"
import { Hono } from "hono"
import z from "zod"
import {
  ANYBOX_CHROME_NATIVE_HOST_NAME,
  BrowserExtensionCommandContext,
  BrowserExtensionCommandMethod,
  BrowserExtensionTabSummary,
} from "@anybox/shared/browser-extension"
import { browserExtensionBridge } from "#browser-extension/bridge.ts"
import {
  isBrowserTransportAuthorization,
  isBrowserTrustedCommandToken,
} from "#browser-extension/runtime-token.ts"
import { ApiError } from "#server/error.ts"
import { ok, parseJsonBody } from "#server/http.ts"
import type { AppEnv } from "#server/types.ts"

const BrowserMcpCommandMethod = z.enum([
  "tabs.list",
  "tabs.open",
  "tabs.activate",
  "tabs.release",
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

const BrowserCommandBody = z.object({
  method: BrowserMcpCommandMethod,
  params: z.unknown().optional(),
  context: BrowserExtensionCommandContext.optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
})

const BrowserTrustedCommandBody = z.object({
  method: BrowserExtensionCommandMethod,
  params: z.unknown().optional(),
  context: BrowserExtensionCommandContext.optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
})

const requireBrowserTrustedToken: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isBrowserTrustedCommandToken(c.req.header("x-anybox-browser-trusted-token"))) {
    throw new ApiError(401, "UNAUTHORIZED", "Browser trusted token is invalid.")
  }
  if (c.req.header("origin")) {
    throw new ApiError(403, "FORBIDDEN", "Browser-origin control requests are not allowed.")
  }
  await next()
}

const requireBrowserNativeTransport: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isBrowserTransportAuthorization(c.req.header("authorization"))) {
    throw new ApiError(401, "UNAUTHORIZED", "Browser transport credential is invalid.")
  }
  if (c.req.header("origin")) {
    throw new ApiError(403, "FORBIDDEN", "Browser-origin WebSocket connections are not allowed.")
  }
  await next()
}

function readMessageData(data: MessageEvent["data"]) {
  if (typeof data === "string") return data
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data)
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength))
  }
  throw new Error("Browser extension websocket payload must be text.")
}

export function BrowserExtensionRoutes(options: { upgradeWebSocket: UpgradeWebSocket }) {
  const app = new Hono<AppEnv>()

  app.get("/health", (c) => ok(c, { ok: true }))
  app.use("/status", requireBrowserTrustedToken)
  app.use("/command", requireBrowserTrustedToken)
  app.use("/trusted-command", requireBrowserTrustedToken)
  app.use("/ws", requireBrowserNativeTransport)

  app.get("/status", (c) => ok(c, browserExtensionBridge.status()))
  app.post("/command", async (c) => {
    const body = await parseJsonBody(c, BrowserCommandBody, "Browser command payload is invalid.")
    return ok(c, await runBrowserCommand(body))
  })

  app.post("/trusted-command", async (c) => {
    const body = await parseJsonBody(c, BrowserTrustedCommandBody, "Browser trusted command payload is invalid.")
    return ok(c, await runBrowserCommand(body, { trusted: true }))
  })

  async function runBrowserCommand(
    body: z.infer<typeof BrowserTrustedCommandBody>,
    options: { trusted?: boolean } = {},
  ) {
    if (body.method === "tabs.release") {
      const tabId = readTabId(body.params)
      if (!tabId) throw new ApiError(400, "INVALID_PAYLOAD", "tabs.release requires a tabId.")
      return {
        tabId,
        released: browserExtensionBridge.releaseOwnedTab(tabId, body.context?.sessionID),
      }
    }

    const result = await browserExtensionBridge.sendCommand(body.method, body.params, {
      context: body.context,
      timeoutMs: body.timeoutMs,
      trusted: options.trusted,
    })

    if (body.method === "tabs.open") {
      const parsedTab = BrowserExtensionTabSummary.safeParse(result)
      if (parsedTab.success) browserExtensionBridge.markOwnedTab(parsedTab.data, body.context)
    } else {
      browserExtensionBridge.touchTab(readTabId(result) ?? readTabId(body.params), body.context)
    }

    return result
  }

  app.get(
    "/ws",
    options.upgradeWebSocket(() => {
      let connectionID: string | undefined

      return {
        onOpen(_event, ws) {
          connectionID = browserExtensionBridge.register(ws, {
            transport: "native",
            hostName: ANYBOX_CHROME_NATIVE_HOST_NAME,
          })
        },
        onMessage(event, ws) {
          if (!connectionID) {
            ws.close(1011, "Browser extension connection was not initialized.")
            return
          }

          try {
            browserExtensionBridge.handleRawMessage(connectionID, readMessageData(event.data))
          } catch {
            ws.close(1008, "Browser extension protocol message is invalid.")
          }
        },
        onClose() {
          if (connectionID) browserExtensionBridge.unregister(connectionID)
          connectionID = undefined
        },
        onError(_event, ws) {
          ws.close(1011, "Browser extension websocket failed.")
        },
      }
    }),
  )

  return app
}

function readTabId(value: unknown) {
  if (!value || typeof value !== "object") return undefined
  const tabId = (value as { tabId?: unknown }).tabId
  return Number.isInteger(tabId) && Number(tabId) > 0 ? Number(tabId) : undefined
}
