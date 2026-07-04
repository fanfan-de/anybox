import { describe, expect, it } from "vitest"
import { internal } from "./desktop-cloud-relay-client"

describe("desktop cloud relay entitlement errors", () => {
  it("maps relay entitlement failures to user-facing copy", () => {
    expect(internal.describeRelayRequestError("relay_disabled", "raw relay error", 403)).toContain("当前套餐不支持 Relay")
    expect(internal.describeRelayRequestError("device_limit_exceeded", "raw device error", 403)).toContain("桌面设备数量已达上限")
  })

  it("keeps server messages for unrelated relay errors", () => {
    expect(internal.describeRelayRequestError("pairing_expired", "Pairing expired.", 403)).toBe("Pairing expired.")
    expect(internal.describeRelayRequestError(undefined, undefined, 500)).toBe("Relay request failed with HTTP 500.")
  })
})

describe("desktop cloud relay mobile HTTP payloads", () => {
  it("allows session model selection PATCH requests", () => {
    expect(internal.parseMobileHttpPayload({
      method: "patch",
      path: "/api/mobile/sessions/session-smoke/model-selection",
      body: "{\"model\":\"openai/gpt-smoke\"}",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer should-not-forward",
      },
    })).toEqual({
      method: "PATCH",
      path: "/api/mobile/sessions/session-smoke/model-selection",
      body: "{\"model\":\"openai/gpt-smoke\"}",
      headers: {
        "content-type": "application/json",
      },
    })
  })

  it("rejects unrelated PATCH mobile bridge requests", () => {
    expect(() => internal.parseMobileHttpPayload({
      method: "PATCH",
      path: "/api/mobile/sessions/session-smoke/messages",
      body: "{\"text\":\"hello\"}",
    })).toThrow("session model PATCH")
  })
})
