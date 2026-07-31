import { expect, test } from "bun:test"
import { Instance } from "#project/instance.ts"
import * as Provider from "#provider/provider.ts"

test("provider supports the OpenRouter AI SDK provider for image models", async () => {
  const openrouterImageModel = {
    provider: "openrouter",
    modelId: "google/gemini-2.5-flash-image-preview",
    doGenerate() {},
  }
  const capturedImports: Array<{ pkg: string; version?: string }> = []
  const capturedFactoryInputs: Array<Record<string, unknown>> = []
  const capturedImageModelIDs: string[] = []

  const restoreProvider = Provider.setProviderRuntimeDependenciesForTesting({
    getModelsDev: async () => ({}) as never,
    getConfig: async () =>
      ({
        provider: {
          "openrouter-test-adapter": {
            name: "OpenRouter",
            env: ["ANYBOX_TEST_OPENROUTER_API_KEY"],
            api: "https://openrouter.ai/api/v1",
            npm: "@openrouter/ai-sdk-provider",
            models: {
              "google/gemini-2.5-flash-image-preview": {
                id: "google/gemini-2.5-flash-image-preview",
                name: "Gemini Image Preview",
                modalities: {
                  input: ["text"],
                  output: ["image"],
                },
              },
            },
          },
        },
      }) as never,
    getEnvAll: () => ({
      ANYBOX_TEST_OPENROUTER_API_KEY: "test-openrouter-env-key",
    }),
    importPackage: async (pkg: string, version?: string) => {
      capturedImports.push({ pkg, version })

      return {
        name: pkg,
        version: version ?? "test-version",
        entry: `${pkg}/index.js`,
        root: pkg,
        module: {
          createOpenRouter(options: Record<string, unknown>) {
            capturedFactoryInputs.push(options)
            return {
              imageModel(modelID: string) {
                capturedImageModelIDs.push(modelID)
                return openrouterImageModel
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
        const model = await Provider.getModel(
          "openrouter-test-adapter",
          "google/gemini-2.5-flash-image-preview",
        )
        const image = await Provider.getImage(model)

        expect(model.api.npm).toBe("@openrouter/ai-sdk-provider")
        expect(model.capabilities.output.image).toBe(true)
        expect(image).toMatchObject(openrouterImageModel)
        expect(capturedImports).toEqual([
          {
            pkg: "@openrouter/ai-sdk-provider",
            version: "3.0.0",
          },
        ])
        expect(capturedFactoryInputs).toEqual([
          {
            apiKey: "test-openrouter-env-key",
            baseURL: "https://openrouter.ai/api/v1",
            headers: undefined,
          },
        ])
        expect(capturedImageModelIDs).toEqual(["google/gemini-2.5-flash-image-preview"])
      },
    })
  } finally {
    restoreProvider()
  }
})
