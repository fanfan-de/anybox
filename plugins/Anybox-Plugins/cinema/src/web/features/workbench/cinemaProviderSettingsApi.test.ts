import { afterEach, describe, expect, it, vi } from "vitest"
import {
  CinemaProviderSettingsApiError,
  createCinemaProviderSettingsApi,
} from "./cinemaProviderSettingsApi"

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

describe("cinemaProviderSettingsApi", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("loads normalized settings and credential state", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const pathname = new URL(String(input)).pathname
      if (pathname.endsWith("/settings")) {
        return jsonResponse({
          baseURL: " https://example.com/v1 ",
          defaultModel: " model-b ",
          models: [{ id: "model-b" }, { id: "model-b" }, { id: "" }],
        })
      }
      return jsonResponse({ configured: true, persistence: "system-keychain" })
    })
    vi.stubGlobal("fetch", fetchMock)
    const api = createCinemaProviderSettingsApi("http://127.0.0.1:4096")

    await expect(api.getSettings("openai-compatible")).resolves.toEqual({
      baseURL: "https://example.com/v1",
      defaultModel: "model-b",
      models: [{ id: "model-b" }],
    })
    await expect(api.getCredential("openai-compatible")).resolves.toEqual({
      configured: true,
      persistence: "system-keychain",
    })
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://127.0.0.1:4096/api/cinema/providers/openai-compatible/settings",
    )
  })

  it("saves credentials only through the credential endpoint", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => (
      jsonResponse({ configured: true, persistence: "session" })
    ))
    vi.stubGlobal("fetch", fetchMock)
    const api = createCinemaProviderSettingsApi("http://127.0.0.1:4096")

    await expect(api.saveCredential("google-ai-sdk", "secret-value", "session")).resolves.toEqual({
      configured: true,
      persistence: "session",
    })

    const [requestURL, requestInit] = fetchMock.mock.calls[0]!
    expect(String(requestURL)).toBe(
      "http://127.0.0.1:4096/api/cinema/providers/google-ai-sdk/credential",
    )
    expect(requestInit?.method).toBe("PUT")
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      apiKey: "secret-value",
      persistence: "session",
    })
  })

  it("sends settings and credentials through one configuration request", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}))
    vi.stubGlobal("fetch", fetchMock)
    const api = createCinemaProviderSettingsApi("http://runtime.example:8765")

    await expect(api.saveConfiguration("openai-compatible", {
      settings: {
        baseURL: "https://api.example.com/v1",
        defaultModel: "model-a",
        models: [{ id: "model-a" }],
      },
      credential: { apiKey: "secret-value", persistence: "session" },
    })).resolves.toBeUndefined()

    const [requestURL, requestInit] = fetchMock.mock.calls[0]!
    expect(String(requestURL)).toBe(
      "http://runtime.example:8765/api/cinema/providers/openai-compatible/configuration",
    )
    expect(requestInit?.method).toBe("PUT")
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      settings: {
        baseURL: "https://api.example.com/v1",
        defaultModel: "model-a",
        models: [{ id: "model-a" }],
      },
      credential: { apiKey: "secret-value", persistence: "session" },
    })
  })

  it("discovers and deduplicates OpenAI-compatible models", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      items: [{ id: "model-b" }, { id: "model-a", label: "Model A" }, { id: "model-b" }],
    }))
    vi.stubGlobal("fetch", fetchMock)
    const api = createCinemaProviderSettingsApi("http://127.0.0.1:4096")

    await expect(api.discoverOpenAIModels()).resolves.toEqual([
      { id: "model-b" },
      { id: "model-a", label: "Model A" },
    ])
    const [requestURL, requestInit] = fetchMock.mock.calls[0]!
    expect(String(requestURL)).toBe(
      "http://127.0.0.1:4096/api/cinema/providers/openai-compatible/models/discover",
    )
    expect(requestInit?.method).toBe("POST")
  })

  it("connects a transient ComfyUI candidate and returns its effective identity", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      ok: true,
      status: "ready",
      persisted: true,
      effectiveBaseURL: " http://127.0.0.1:8000 ",
      userID: " default ",
      connectionID: " comfy_connection_1 ",
      workflows: 3,
      readyWorkflows: 1,
    }))
    vi.stubGlobal("fetch", fetchMock)
    const api = createCinemaProviderSettingsApi("http://127.0.0.1:4096")

    await expect(api.connectProvider("comfyui-local", {
      baseURL: "http://127.0.0.1:8000",
      userID: null,
    })).resolves.toEqual({
      ok: true,
      status: "ready",
      models: [],
      persisted: true,
      effectiveBaseURL: "http://127.0.0.1:8000",
      userID: "default",
      connectionID: "comfy_connection_1",
      workflows: 3,
      readyWorkflows: 1,
    })

    const [requestURL, requestInit] = fetchMock.mock.calls[0]!
    expect(String(requestURL)).toBe(
      "http://127.0.0.1:4096/api/cinema/providers/comfyui-local/connect",
    )
    expect(requestInit?.method).toBe("POST")
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      baseURL: "http://127.0.0.1:8000",
      userID: null,
    })
  })

  it("preserves management API errors for actionable UI feedback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      success: false,
      error: { code: "KEYCHAIN_UNAVAILABLE", message: "Choose session storage." },
    }), {
      status: 503,
      headers: { "content-type": "application/json" },
    })))
    const api = createCinemaProviderSettingsApi("http://127.0.0.1:4096")

    await expect(api.saveCredential("klingai-cn", "ak:sk", "system-keychain"))
      .rejects.toEqual(expect.objectContaining<CinemaProviderSettingsApiError>({
        status: 503,
        code: "KEYCHAIN_UNAVAILABLE",
        message: "Choose session storage.",
      }))
  })
})
