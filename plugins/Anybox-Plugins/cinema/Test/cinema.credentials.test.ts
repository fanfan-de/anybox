import { afterEach, describe, expect, test } from "bun:test"
import { createServerApp } from "#server/server.ts"
import { ApiError } from "#server/error.ts"
import { clearSessionCredentials, readProviderApiKey } from "#auth/provider-auth.ts"
import { setNativeHelperCallForTest } from "../src/platform/native-helper.ts"

const restores: Array<() => void> = []

afterEach(() => {
  clearSessionCredentials()
  while (restores.length) restores.pop()?.()
})

describe("Cinema provider credentials", () => {
  test("uses the fixed keychain service and never returns a secret from the API", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = []
    restores.push(setNativeHelperCallForTest(async (method, params) => {
      calls.push({ method, params })
      if (method === "credential.get") return { value: "super-secret-value" }
      return { configured: true }
    }))
    const app = createServerApp()
    const response = await app.request("http://localhost/api/cinema/providers/openai-compatible/credential")
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(text).not.toContain("super-secret-value")
    expect(JSON.parse(text).data).toEqual({ configured: true, persistence: "system-keychain" })
    expect(calls[0]).toEqual({
      method: "credential.get",
      params: { service: "com.anybox.cinema", account: "provider.openai-compatible.api-key" },
    })
  })

  test("requires an explicit temporary-session choice when the keychain is unavailable", async () => {
    restores.push(setNativeHelperCallForTest(async () => {
      throw new ApiError(503, "KEYCHAIN_UNAVAILABLE", "Unavailable")
    }))
    const app = createServerApp()
    const endpoint = "http://localhost/api/cinema/providers/openai-compatible/credential"
    const persistent = await app.request(endpoint, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "temporary-secret" }),
    })
    expect(persistent.status).toBe(503)
    expect(await readProviderApiKey("openai-compatible")).toBeUndefined()

    const temporary = await app.request(endpoint, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "temporary-secret", persistence: "session" }),
    })
    const text = await temporary.text()
    expect(temporary.status).toBe(200)
    expect(text).not.toContain("temporary-secret")
    expect(JSON.parse(text).data).toEqual({ configured: true, persistence: "session" })
    expect(await readProviderApiKey("openai-compatible")).toEqual({
      value: "temporary-secret",
      source: "session",
    })

    clearSessionCredentials()
    expect(await readProviderApiKey("openai-compatible")).toBeUndefined()
  })
})
