import { expect, test } from "bun:test"
import * as CinemaProviderRuntime from "#cinema/provider-runtime.ts"
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

test("model registry merges selectable AI SDK models and read-only cinema task models", async () => {
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
  const restoreVideoCatalog = CinemaProviderRuntime.setCinemaVideoProviderCatalogForTest({
    "mock-video": {
      id: "mock-video",
      name: "Mock Video",
      kind: "native",
      regions: [],
      models: {
        "task-video": {
          id: "task-video",
          name: "Task Video",
          family: "Task",
          modes: ["text-to-video", "image-to-video"],
          pricing: [],
          modalities: {
            input: ["text", "image"],
            output: ["video"],
          },
          limit: {
            durations: [5],
            resolutions: ["720p"],
            aspect_ratios: ["16:9"],
          },
        },
      },
    },
    "mock-disconnected": {
      id: "mock-disconnected",
      name: "Mock Disconnected",
      kind: "native",
      auth_type: "api_key",
      regions: [],
      models: {
        "task-video": {
          id: "task-video",
          name: "Disconnected Task Video",
          modes: ["text-to-video"],
          pricing: [],
        },
      },
    },
  })
  const restoreVideoAdapter = CinemaProviderRuntime.setCinemaVideoProviderAdapterForTest("mock-video", {
    manifest: {} as never,
    createTask: async ({ task }) => task,
    refreshTask: async ({ task }) => task,
  })

  try {
    const catalog = await ModelRegistry.listModelCatalog()
    const textModel = catalog.find((item) => item.registryID === "mockai/mock-text")
    const imageModel = catalog.find((item) => item.registryID === "mockai/mock-image")
    const unconfiguredModel = catalog.find((item) => item.registryID === "mock-unconfigured/unconfigured-text")
    const taskModel = catalog.find((item) => item.registryID === "cinema-task:mock-video/task-video")
    const disconnectedTaskModel = catalog.find((item) => item.registryID === "cinema-task:mock-disconnected/task-video")

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
    expect(taskModel).toMatchObject({
      providerID: "mock-video",
      modelID: "task-video",
      runtimeKind: "cinema-task",
      selectable: false,
      available: true,
      source: "cinema",
      capabilities: {
        output: {
          video: true,
        },
        taskModes: ["text-to-video", "image-to-video"],
      },
    })
    expect(disconnectedTaskModel).toMatchObject({
      runtimeKind: "cinema-task",
      selectable: false,
      available: false,
    })

    expect(await ModelRegistry.listModelCatalog(undefined, { output: "image", selectable: true }))
      .toHaveLength(1)
    expect(await ModelRegistry.listModelCatalog(undefined, { output: "video" }))
      .toHaveLength(2)
    await expect(ModelSelection.resolveImageSelectableModel("mockai/mock-text"))
      .rejects
      .toThrow("does not support image output")
    await expect(ModelSelection.resolveImageSelectableModel("mock-video/task-video"))
      .rejects
      .toThrow()
  } finally {
    restoreVideoAdapter()
    restoreVideoCatalog()
    restoreProvider()
  }
})
