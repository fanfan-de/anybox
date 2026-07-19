import { describe, expect, test } from "bun:test"
import "./sqlite.cleanup.ts"
import { createServerApp } from "#server/server.ts"

interface JsonEnvelope<T> {
  success: boolean
  data?: T
}

describe("browser extension HTTP surface", () => {
  test("keeps only a minimal public health endpoint", async () => {
    const response = await createServerApp().request(
      "/api/browser-extension/health",
    )
    const body = (await response.json()) as JsonEnvelope<{ ok: boolean }>

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      data: { ok: true },
    })
    expect(JSON.stringify(body)).not.toContain("pipe")
    expect(JSON.stringify(body)).not.toContain("broker")
    expect(JSON.stringify(body)).not.toContain("connection")
    expect(JSON.stringify(body)).not.toContain("token")
  })

  test.each([
    ["GET", "/api/browser-extension/status"],
    ["POST", "/api/browser-extension/command"],
    ["POST", "/api/browser-extension/trusted-command"],
    ["GET", "/api/browser-extension/ws"],
  ])("does not register the legacy %s %s endpoint", async (method, pathname) => {
    const response = await createServerApp().request(pathname, {
      method,
      headers: {
        authorization: "Bearer obsolete-token",
        "content-type": "application/json",
        "x-anybox-browser-trusted-token": "obsolete-token",
      },
      body: method === "POST"
        ? JSON.stringify({
            method: "tabs.list",
          })
        : undefined,
    })

    expect(response.status).toBe(404)
  })

  test("does not expose browser routes through CORS preflight", async () => {
    const response = await createServerApp().request(
      "/api/browser-extension/command",
      {
        method: "OPTIONS",
        headers: {
          origin: "https://malicious.example",
          "access-control-request-method": "POST",
          "access-control-request-headers": "x-anybox-browser-trusted-token",
        },
      },
    )

    expect(response.status).toBe(404)
    expect(response.headers.get("access-control-allow-origin")).toBeNull()
    expect(response.headers.get("access-control-allow-headers")).toBeNull()
  })
})
