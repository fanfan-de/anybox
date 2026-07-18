import { afterEach, describe, expect, test } from "bun:test"
import "./sqlite.cleanup.ts"
import {
  ANYBOX_CHROME_EXTENSION_ID,
  BROWSER_EXTENSION_PROTOCOL_VERSION,
} from "@anybox/shared/browser-extension"
import {
  getBrowserTransportToken,
  getBrowserTrustedCommandToken,
} from "#browser-extension/runtime-token.ts"
import { createServerApp, createServerRuntime } from "#server/server.ts"

interface JsonEnvelope<T> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
}

const activeServers: Bun.Server<unknown>[] = []

afterEach(() => {
  for (const server of activeServers.splice(0, activeServers.length)) {
    server.stop(true)
  }
})

describe("browser extension command routes", () => {
  test("keeps the minimal health endpoint public", async () => {
    const app = createServerApp()

    const response = await app.request("/api/browser-extension/health")
    const body = (await response.json()) as JsonEnvelope<{ ok: boolean }>

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toEqual({ ok: true })
  })

  test("requires the browser token for every browser HTTP control endpoint", async () => {
    const app = createServerApp()
    const requests: Array<[string, RequestInit | undefined]> = [
      ["/api/browser-extension/status", undefined],
      ["/api/browser-extension/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "tabs.release", params: { tabId: 123 } }),
      }],
      ["/api/browser-extension/trusted-command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "tabs.release", params: { tabId: 123 } }),
      }],
    ]

    for (const [path, init] of requests) {
      const response = await app.request(path, init)
      const body = (await response.json()) as JsonEnvelope<unknown>

      expect(response.status).toBe(401)
      expect(body.success).toBe(false)
      expect(body.error?.code).toBe("UNAUTHORIZED")
    }
  })

  test("accepts status requests with the browser token", async () => {
    const app = createServerApp()

    const response = await app.request("/api/browser-extension/status", {
      headers: {
        "x-anybox-browser-trusted-token": getBrowserTrustedCommandToken(),
      },
    })
    const body = (await response.json()) as JsonEnvelope<{ connected: boolean }>

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data?.connected).toBe(false)
  })

  test("does not expose browser control routes through CORS", async () => {
    const app = createServerApp()

    const response = await app.request("/api/browser-extension/command", {
      method: "OPTIONS",
      headers: {
        origin: "https://malicious.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "x-anybox-browser-trusted-token",
      },
    })

    expect(response.headers.get("access-control-allow-origin")).toBeNull()
    expect(response.headers.get("access-control-allow-headers")).toBeNull()

    const browserOrigin = await app.request("/api/browser-extension/status", {
      headers: {
        origin: "https://malicious.example",
        "x-anybox-browser-trusted-token": getBrowserTrustedCommandToken(),
      },
    })
    expect(browserOrigin.status).toBe(403)
  })

  test("rejects unauthenticated and browser-origin WebSocket requests before upgrade", async () => {
    const app = createServerApp()
    const unauthenticated = await app.request("/api/browser-extension/ws", {
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
      },
    })
    expect(unauthenticated.status).toBe(401)

    const browserOrigin = await app.request("/api/browser-extension/ws", {
      headers: {
        authorization: `Bearer ${getBrowserTransportToken()}`,
        connection: "Upgrade",
        origin: "https://malicious.example",
        upgrade: "websocket",
      },
    })
    expect(browserOrigin.status).toBe(403)
  })

  test("accepts an authenticated Native Host WebSocket after the protocol hello", async () => {
    const runtime = createServerRuntime()
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request, bunServer) {
        return runtime.app.fetch(request, bunServer)
      },
      websocket: runtime.websocket,
    })
    activeServers.push(server)

    const socket = new WebSocket(
      `ws://127.0.0.1:${String(server.port)}/api/browser-extension/ws`,
      {
        headers: {
          authorization: `Bearer ${getBrowserTransportToken()}`,
        },
      },
    )
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true })
      socket.addEventListener("error", () => reject(new Error("Authenticated browser WebSocket failed.")), { once: true })
    })

    socket.send(JSON.stringify({
      type: "hello",
      protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
      extensionInstanceID: "integration-instance",
      extensionID: ANYBOX_CHROME_EXTENSION_ID,
      version: "0.1.0",
    }))

    let status: JsonEnvelope<{
      connected: boolean
      active: {
        extensionInstanceID?: string
        extensionID?: string
        transport?: string
      } | null
    }> | undefined
    const started = Date.now()
    while (Date.now() - started < 2_000) {
      const response = await fetch(
        `http://127.0.0.1:${String(server.port)}/api/browser-extension/status`,
        {
          headers: {
            "x-anybox-browser-trusted-token": getBrowserTrustedCommandToken(),
          },
        },
      )
      status = await response.json() as typeof status
      if (status?.data?.connected) break
      await Bun.sleep(20)
    }

    expect(status?.data).toMatchObject({
      connected: true,
      active: {
        extensionInstanceID: "integration-instance",
        extensionID: ANYBOX_CHROME_EXTENSION_ID,
        transport: "native",
      },
    })
    socket.close()
  })

  test("releases local tab ownership without requiring an extension connection", async () => {
    const app = createServerApp()

    const response = await app.request("/api/browser-extension/command", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-anybox-browser-trusted-token": getBrowserTrustedCommandToken(),
      },
      body: JSON.stringify({
        method: "tabs.release",
        params: {
          tabId: 123,
        },
      }),
    })
    const body = (await response.json()) as JsonEnvelope<{ tabId: number; released: boolean }>

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toEqual({ tabId: 123, released: false })
  })

  test("rejects script execution through the MCP command route", async () => {
    const app = createServerApp()

    const response = await app.request("/api/browser-extension/command", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-anybox-browser-trusted-token": getBrowserTrustedCommandToken(),
      },
      body: JSON.stringify({
        method: "page.executeScript",
        params: {
          script: "document.title",
        },
      }),
    })
    const body = (await response.json()) as JsonEnvelope<unknown>

    expect(response.status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error?.code).toBe("INVALID_PAYLOAD")
  })

  test("requires a trusted token for raw browser commands", async () => {
    const app = createServerApp()

    const response = await app.request("/api/browser-extension/trusted-command", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        method: "page.executeScript",
        params: {
          script: "document.title",
        },
      }),
    })
    const body = (await response.json()) as JsonEnvelope<unknown>

    expect(response.status).toBe(401)
    expect(body.success).toBe(false)
    expect(body.error?.code).toBe("UNAUTHORIZED")
  })

  test("accepts trusted command payloads with the runtime token", async () => {
    const app = createServerApp()

    const response = await app.request("/api/browser-extension/trusted-command", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-anybox-browser-trusted-token": getBrowserTrustedCommandToken(),
      },
      body: JSON.stringify({
        method: "tabs.release",
        params: {
          tabId: 123,
        },
      }),
    })
    const body = (await response.json()) as JsonEnvelope<{ tabId: number; released: boolean }>

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toEqual({ tabId: 123, released: false })
  })
})
