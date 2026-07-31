import { expect, test } from "bun:test"
import { Instance } from "#project/instance.ts"
import * as Provider from "#provider/provider.ts"

test("provider supports @ai-sdk/openai-compatible with env-only API keys", async () => {
  const languageModel = {
    doGenerate() {},
    doStream() {},
  }
  const capturedImports: Array<{ pkg: string; version?: string }> = []
  const capturedFactoryInputs: Array<Record<string, unknown>> = []

  const restoreProvider = Provider.setProviderRuntimeDependenciesForTesting({
    getModelsDev: async () => ({}) as never,
    getConfig: async () =>
      ({
        provider: {
          "compatible-test": {
            name: "Compatible Test",
            env: ["COMPATIBLE_TEST_API_KEY"],
            npm: "@ai-sdk/openai-compatible",
            options: {
              baseURL: "https://api.deepseek.com",
            },
            models: {
              "compat-model": {
                id: "compat-model",
                name: "Compatible Model",
              },
            },
          },
        },
      }) as never,
    getEnvAll: () => ({
      COMPATIBLE_TEST_API_KEY: "test-compatible-env-key",
    }),
    importPackage: async (pkg: string, version?: string) => {
      capturedImports.push({ pkg, version })

      return {
        name: pkg,
        version: version ?? "test-version",
        entry: `${pkg}/index.js`,
        root: pkg,
        module: {
          createOpenAICompatible(options: Record<string, unknown>) {
            capturedFactoryInputs.push(options)
            return {
              languageModel() {
                return languageModel
              },
            }
          },
        },
      }
    },
  })

  try {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const model = await Provider.getModel("compatible-test", "compat-model")
        const language = await Provider.getLanguage(model)

        expect(model.api.npm).toBe("@ai-sdk/openai-compatible")
        expect(language).toMatchObject(languageModel)
        expect(capturedImports).toEqual([
          {
            pkg: "@ai-sdk/openai-compatible",
            version: "3.0.18",
          },
        ])
        expect(capturedFactoryInputs).toEqual([
          {
            name: "compatible-test",
            apiKey: "test-compatible-env-key",
            baseURL: "https://api.deepseek.com",
            headers: undefined,
          },
        ])
      },
    })
  } finally {
    restoreProvider()
  }
})

test("custom openai-compatible providers rewrite chat endpoint and override authorization header", async () => {
  const languageModel = {
    doGenerate() {},
    doStream() {},
  }
  const capturedFactoryInputs: Array<Record<string, unknown>> = []
  const capturedRequests: Array<{
    url: string
    authorization: string | null
    body: string
  }> = []
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : new Request(input.toString(), init)
    capturedRequests.push({
      url: request.url,
      authorization: request.headers.get("authorization"),
      body: await request.text(),
    })
    return Response.json({ id: "chatcmpl_custom_runtime", choices: [] })
  }) as typeof fetch

  const restoreProvider = Provider.setProviderRuntimeDependenciesForTesting({
    getModelsDev: async () => ({}) as never,
    getConfig: async () =>
      ({
        provider: {
          "custom-runtime": {
            name: "Custom Runtime",
            env: ["CUSTOM_RUNTIME_AUTH"],
            api: "https://gateway.test/v1",
            npm: "@ai-sdk/openai-compatible",
            options: {
              baseURL: "https://gateway.test/v1",
              customProvider: true,
              customAuthHeaderName: "Authorization",
              customChatEndpoint: "/compatible/chat",
            },
            models: {
              "deepseek-chat": {
                id: "deepseek-chat",
                name: "deepseek-chat",
                provider: {
                  api: "https://gateway.test/v1",
                  npm: "@ai-sdk/openai-compatible",
                },
              },
            },
          },
        },
      }) as never,
    getEnvAll: () => ({
      CUSTOM_RUNTIME_AUTH: "Bearer sk-custom-runtime",
    }),
    importPackage: async (pkg: string, version?: string) => ({
      name: pkg,
      version: version ?? "test-version",
      entry: `${pkg}/index.js`,
      root: pkg,
      module: {
        createOpenAICompatible(options: Record<string, unknown>) {
          capturedFactoryInputs.push(options)
          return {
            languageModel() {
              return languageModel
            },
          }
        },
      },
    }),
  })

  try {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const model = await Provider.getModel("custom-runtime", "deepseek-chat")
        const language = await Provider.getLanguage(model)
        const runtimeFetch = capturedFactoryInputs[0]?.fetch as typeof fetch | undefined

        expect(language).toMatchObject(languageModel)
        expect(capturedFactoryInputs[0]).toMatchObject({
          name: "custom-runtime",
          apiKey: "custom-provider-key",
          baseURL: "https://gateway.test/v1",
          headers: undefined,
        })
        expect(typeof runtimeFetch).toBe("function")

        const response = await runtimeFetch!("https://gateway.test/v1/chat/completions?trace=1", {
          method: "POST",
          headers: {
            authorization: "Bearer custom-provider-key",
            "content-type": "application/json",
          },
          body: "{}",
        })

        expect(response.status).toBe(200)
        expect(capturedRequests).toEqual([
          {
            url: "https://gateway.test/v1/compatible/chat?trace=1",
            authorization: "Bearer sk-custom-runtime",
            body: "{}",
          },
        ])
      },
    })
  } finally {
    globalThis.fetch = originalFetch
    restoreProvider()
  }
})
