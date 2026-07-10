import { afterEach, describe, expect, test } from "bun:test"
import * as Provider from "#provider/provider.ts"

let restoreProvider: (() => void) | undefined

afterEach(() => {
  restoreProvider?.()
  restoreProvider = undefined
})

describe("OpenAI Codex model discovery", () => {
  test("loads account-visible models with the current OAuth credentials", async () => {
    let capturedURL = ""
    let capturedHeaders = new Headers()

    restoreProvider = Provider.setProviderRuntimeDependenciesForTesting({
      fetch: (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        capturedURL = String(input)
        capturedHeaders = new Headers(init?.headers)
        return Response.json({
          models: [
            {
              slug: "gpt-hidden",
              display_name: "GPT Hidden",
              visibility: "hide",
              priority: 0,
            },
            {
              slug: "gpt-5.4-mini",
              display_name: "GPT-5.4 Mini",
              description: "Fast GPT model",
              default_reasoning_level: "medium",
              supported_reasoning_levels: [
                { effort: "low", description: "Faster" },
                { effort: "medium", description: "Balanced" },
              ],
              visibility: "list",
              priority: 2,
              context_window: 128_000,
              input_modalities: ["text"],
            },
            {
              slug: "gpt-5.5",
              display_name: "GPT-5.5",
              default_reasoning_level: "high",
              supported_reasoning_levels: [{ effort: "high" }],
              visibility: "list",
              priority: 0,
              context_window: 272_000,
              input_modalities: ["text", "image"],
            },
            { display_name: "Invalid without slug" },
          ],
        })
      }) as unknown as typeof fetch,
    })

    const models = await Provider.fetchOpenAICodexModels({
      apiKey: "oauth-access-token",
      runtimeBaseURL: "https://chatgpt.com/backend-api/codex",
      runtimeHeaders: {
        "ChatGPT-Account-ID": "account-123",
        originator: "Codex Desktop",
      },
      authMode: "codex",
      authCapabilities: [],
      authState: {
        providerID: "openai",
        scope: "global",
        status: "connected",
        capabilities: [],
        credentials: [],
      },
    })

    expect(new URL(capturedURL).pathname).toBe("/backend-api/codex/models")
    expect(new URL(capturedURL).searchParams.get("client_version")).toBeTruthy()
    expect(capturedHeaders.get("authorization")).toBe("Bearer oauth-access-token")
    expect(capturedHeaders.get("ChatGPT-Account-ID")).toBe("account-123")
    expect(Object.keys(models)).toEqual(["gpt-5.5", "gpt-5.4-mini"])
    expect(models["gpt-hidden"]).toBeUndefined()

    expect(models["gpt-5.5"]).toMatchObject({
      id: "gpt-5.5",
      name: "GPT-5.5",
      family: "gpt-5",
      api: {
        id: "gpt-5.5",
        url: "https://chatgpt.com/backend-api/codex",
      },
      capabilities: {
        reasoning: true,
        attachment: true,
        input: {
          text: true,
          image: true,
          pdf: true,
        },
      },
      limit: {
        context: 272_000,
        output: 32_768,
      },
    })

    expect(models["gpt-5.4-mini"]?.capabilities.input.image).toBe(false)
    expect(models["gpt-5.4-mini"]?.options.supportedReasoningEfforts).toEqual(["low", "medium"])
  })

  test("rejects unusable remote catalogs so callers can use the static fallback", async () => {
    restoreProvider = Provider.setProviderRuntimeDependenciesForTesting({
      fetch: (async () => Response.json({ models: [] })) as unknown as typeof fetch,
    })

    await expect(
      Provider.fetchOpenAICodexModels({
        apiKey: "oauth-access-token",
        authMode: "codex",
        authCapabilities: [],
        authState: {
          providerID: "openai",
          scope: "global",
          status: "connected",
          capabilities: [],
          credentials: [],
        },
      }),
    ).rejects.toThrow("returned no visible models")
  })
})
