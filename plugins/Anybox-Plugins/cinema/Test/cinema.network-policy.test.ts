import { afterEach, describe, expect, test } from "bun:test"
import {
  assertSafeProviderURL,
  isBlockedProviderAddress,
  normalizeProviderBaseURL,
  safeProviderFetch,
  sameOriginFetch,
  setProviderNetworkLookupForTest,
} from "../src/providers/network-policy.ts"
import { createCinemaOpenAICompatibleProvider } from "../src/providers/openai-compatible.ts"

const servers: Array<ReturnType<typeof Bun.serve>> = []

afterEach(() => {
  setProviderNetworkLookupForTest(undefined)
  while (servers.length) servers.pop()?.stop(true)
})

describe("Cinema provider network policy", () => {
  test("accepts HTTPS and explicit loopback HTTP but rejects credentials and remote HTTP", () => {
    expect(normalizeProviderBaseURL("https://provider.example/v1/")).toBe("https://provider.example/v1")
    expect(normalizeProviderBaseURL("http://127.0.0.1:8188/")).toBe("http://127.0.0.1:8188")
    expect(() => normalizeProviderBaseURL("http://provider.example/v1")).toThrow("must use HTTPS")
    expect(() => normalizeProviderBaseURL("https://secret@provider.example/v1")).toThrow("cannot contain credentials")
  })

  test("blocks private, link-local, metadata, carrier, benchmark, multicast, and IPv4-mapped addresses", async () => {
    for (const address of [
      "10.0.0.1",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "198.18.0.1",
      "224.0.0.1",
      "::ffff:169.254.169.254",
      "fd00::1",
      "fe80::1",
    ]) expect(isBlockedProviderAddress(address)).toBe(true)
    await expect(assertSafeProviderURL("https://169.254.169.254/latest/meta-data"))
      .rejects.toMatchObject({ code: "PROVIDER_CONFIGURATION_INVALID" })
  })

  test("rejects a DNS answer set containing a rebinding target before connecting", async () => {
    setProviderNetworkLookupForTest(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ])
    await expect(assertSafeProviderURL("https://provider.example"))
      .rejects.toMatchObject({ code: "PROVIDER_CONFIGURATION_INVALID" })
  })

  test("pins a loopback request, follows only same-origin redirects, and supports FormData bodies", async () => {
    let port = 0
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/redirect") return Response.redirect(`http://127.0.0.1:${port}/final`, 302)
        if (url.pathname === "/cross-origin") return Response.redirect(`http://localhost:${port}/final`, 302)
        if (url.pathname === "/upload") {
          const form = await request.formData()
          return Response.json({ value: form.get("value"), authorization: request.headers.get("authorization") })
        }
        return Response.json({ authorization: request.headers.get("authorization") })
      },
    })
    servers.push(server)
    port = server.port
    const origin = `http://127.0.0.1:${port}`

    const redirected = await sameOriginFetch(new URL(`${origin}/redirect`), {
      headers: { authorization: "Bearer test-secret" },
    })
    expect(await redirected.json()).toEqual({ authorization: "Bearer test-secret" })

    const form = new FormData()
    form.set("value", "cinema")
    const uploaded = await sameOriginFetch(new URL(`${origin}/upload`), {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: form,
    })
    expect(await uploaded.json()).toEqual({ value: "cinema", authorization: "Bearer test-secret" })

    await expect(sameOriginFetch(new URL(`${origin}/cross-origin`), {
      headers: { authorization: "Bearer must-not-cross" },
    })).rejects.toMatchObject({ code: "PROVIDER_REDIRECT_REJECTED" })
  })

  test("adapts SDK Request inputs without bypassing the pinned transport", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        return Response.json({
          body: await request.json(),
          authorization: request.headers.get("authorization"),
        })
      },
    })
    servers.push(server)
    const request = new Request(`http://127.0.0.1:${server.port}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: "Bearer sdk-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "cinema-model", stream: true }),
    })

    const response = await safeProviderFetch(request)
    expect(await response.json()).toEqual({
      body: { model: "cinema-model", stream: true },
      authorization: "Bearer sdk-secret",
    })
  })

  test("wires the OpenAI-compatible SDK to the safe provider transport", () => {
    const provider = createCinemaOpenAICompatibleProvider({
      baseURL: "https://provider.example/v1",
      apiKey: "test-key",
    })
    const model = provider.languageModel("cinema-model") as unknown as {
      config?: { fetch?: unknown }
    }
    expect(model.config?.fetch).toBe(safeProviderFetch)
  })
})
