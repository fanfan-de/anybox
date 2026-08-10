import { expect, test } from "bun:test"
import * as ModelRegistry from "#model/registry.ts"
import * as ModelSelection from "#model/selection.ts"
import * as Provider from "#provider/provider.ts"

function createProviderModel(overrides: Record<string, unknown> = {}) {
  return {
    id: "mock-text",
    name: "Mock Text",
    release_date: "2026-01-01",
    attachment: false,
    reasoning: false,
    temperature: true,
    tool_call: true,
    interleaved: false,
    limit: {
      context: 64_000,
      output: 8_192,
    },
    modalities: {
      input: ["text"],
      output: ["text"],
    },
    options: {},
    ...overrides,
  }
}

test("model registry exposes selectable AI SDK models", async () => {
  const restoreProvider = Provider.setProviderRuntimeDependenciesForTesting({
    getModelsDev: async () => ({
      mockai: {
        id: "mockai",
        name: "Mock AI",
        env: [],
        api: "https://mock.ai/v1",
        npm: "@ai-sdk/openai-compatible",
        models: {
          "mock-text": createProviderModel(),
          "mock-image": createProviderModel({
            id: "mock-image",
            name: "Mock Image",
            modalities: {
              input: ["text", "image"],
              output: ["image"],
            },
          }),
        },
      },
      "mock-unconfigured": {
        id: "mock-unconfigured",
        name: "Mock Unconfigured",
        env: ["MOCK_UNCONFIGURED_API_KEY"],
        api: "https://unconfigured.mock.ai/v1",
        npm: "@ai-sdk/openai-compatible",
        models: {
          "unconfigured-text": createProviderModel({
            id: "unconfigured-text",
            name: "Unconfigured Text",
          }),
        },
      },
    }) as never,
    getConfig: async () => ({
      provider: {
        mockai: {},
      },
    }) as never,
    getEnvAll: () => ({}),
    importPackage: async () => {
      throw new Error("Registry catalog tests should not import SDK packages")
    },
  })
  try {
    const catalog = await ModelRegistry.listModelCatalog()
    const textModel = catalog.find((item) => item.registryID === "mockai/mock-text")
    const imageModel = catalog.find((item) => item.registryID === "mockai/mock-image")
    const unconfiguredModel = catalog.find((item) => item.registryID === "mock-unconfigured/unconfigured-text")

    expect(textModel).toMatchObject({
      providerID: "mockai",
      modelID: "mock-text",
      runtimeKind: "ai-sdk",
      selectable: true,
      available: true,
      source: "provider",
      capabilities: {
        output: {
          text: true,
          image: false,
          video: false,
        },
      },
    })
    expect(imageModel?.capabilities.output.image).toBe(true)
    expect(unconfiguredModel).toMatchObject({
      providerID: "mock-unconfigured",
      modelID: "unconfigured-text",
      runtimeKind: "ai-sdk",
      selectable: false,
      available: false,
      source: "provider",
      capabilities: {
        output: {
          text: true,
        },
      },
    })
    expect(await ModelRegistry.listModelCatalog(undefined, { output: "image", selectable: true }))
      .toHaveLength(1)
    expect(await ModelRegistry.listModelCatalog(undefined, { output: "video" }))
      .toHaveLength(0)
    await expect(ModelSelection.resolveImageSelectableModel("mockai/mock-text"))
      .rejects
      .toThrow("does not support image output")
  } finally {
    restoreProvider()
  }
})
