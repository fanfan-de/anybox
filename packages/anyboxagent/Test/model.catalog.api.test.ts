import { expect, test } from "bun:test"
import "./sqlite.cleanup.ts"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CinemaVideoProviderManifestSchema } from "@anybox/shared/cinema"
import * as CinemaProviderRuntime from "#cinema/provider-runtime.ts"
import * as Provider from "#provider/provider.ts"
import { createServerApp } from "#server/server.ts"

interface JsonEnvelope<T = unknown> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
}

interface ProjectResponse {
  id: string
  directory: string
}

interface LegacyModelsResponse {
  items: Provider.PublicModel[]
  selection: Record<string, unknown>
}

interface ModelCatalogResponse {
  items: Array<{
    registryID: string
    providerID: string
    modelID: string
    runtimeKind: "ai-sdk" | "cinema-task"
    selectable: boolean
    available: boolean
    source: "provider" | "cinema"
    capabilities: {
      output: {
        text: boolean
        image: boolean
        video: boolean
      }
      taskModes: string[]
    }
  }>
}

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

async function readJson<T>(response: Response) {
  return (await response.json()) as JsonEnvelope<T>
}

test("model catalog API keeps legacy models selectable and exposes read-only cinema task models", async () => {
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
      throw new Error("Model catalog API tests should not import SDK packages")
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
          modes: ["text-to-video"],
          pricing: [],
          modalities: {
            input: ["text"],
            output: ["video"],
          },
        },
      },
    },
  })
  const restoreVideoAdapter = CinemaProviderRuntime.setCinemaVideoProviderAdapterForTest("mock-video", {
    manifest: {} as never,
    createTask: async ({ task }) => task,
    refreshTask: async ({ task }) => task,
  })
  const tempRoot = await realpath(await mkdtemp(join(tmpdir(), "anybox-model-catalog-api-")))

  try {
    const app = createServerApp()
    const legacyResponse = await app.request("http://localhost/api/models")
    const legacyBody = await readJson<LegacyModelsResponse>(legacyResponse)

    expect(legacyResponse.status).toBe(200)
    expect(legacyBody.success).toBe(true)
    expect(legacyBody.data?.items).toHaveLength(1)
    expect(legacyBody.data?.items[0]).toMatchObject({
      providerID: "mockai",
      id: "mock-text",
    })

    const catalogResponse = await app.request("http://localhost/api/model-catalog")
    const catalogBody = await readJson<ModelCatalogResponse>(catalogResponse)
    const aiModel = catalogBody.data?.items.find((item) => item.registryID === "mockai/mock-text")
    const unconfiguredModel = catalogBody.data?.items.find((item) => item.registryID === "mock-unconfigured/unconfigured-text")
    const taskModel = catalogBody.data?.items.find((item) => item.registryID === "cinema-task:mock-video/task-video")

    expect(catalogResponse.status).toBe(200)
    expect(catalogBody.success).toBe(true)
    expect(aiModel).toMatchObject({
      providerID: "mockai",
      modelID: "mock-text",
      runtimeKind: "ai-sdk",
      selectable: true,
      source: "provider",
    })
    expect(unconfiguredModel).toMatchObject({
      providerID: "mock-unconfigured",
      modelID: "unconfigured-text",
      runtimeKind: "ai-sdk",
      selectable: false,
      available: false,
      source: "provider",
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
        taskModes: ["text-to-video"],
      },
    })

    const projectCreateResponse = await app.request("http://localhost/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ directory: tempRoot }),
    })
    const projectCreateBody = await readJson<ProjectResponse>(projectCreateResponse)
    const projectID = projectCreateBody.data?.id

    expect(projectCreateResponse.status).toBe(201)
    expect(projectID).toBeString()

    const projectCatalogResponse = await app.request(`http://localhost/api/projects/${projectID}/model-catalog`)
    const projectCatalogBody = await readJson<ModelCatalogResponse>(projectCatalogResponse)

    expect(projectCatalogResponse.status).toBe(200)
    expect(projectCatalogBody.success).toBe(true)
    expect(projectCatalogBody.data?.items.some((item) => item.registryID === "mockai/mock-text")).toBe(true)
    expect(projectCatalogBody.data?.items.some((item) => item.registryID === "cinema-task:mock-video/task-video")).toBe(true)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
    restoreVideoAdapter()
    restoreVideoCatalog()
    restoreProvider()
  }
})

test("normalizes generation form specs from provider manifest inputs", () => {
  const provider = CinemaVideoProviderManifestSchema.parse({
    id: "klingai-cn",
    name: "KlingAI CN",
    requiresCredential: false,
    regions: [],
    models: [
      {
        id: "kling-image-v3",
        label: "Kling Image 3.0 Omni",
        offeringID: "klingai-cn/kling-image-3.0-omni",
        providerModelID: "kling-v3-omni",
        modalities: {
          input: ["text", "image"],
          output: ["image"],
        },
        modes: ["omni-image"],
        inputCombinations: [
          {
            mode: "omni-image",
            label: "Omni image",
            requiredModalities: ["text"],
            optionalModalities: ["image"],
            inputs: [
              {
                role: "prompt",
                modality: "text",
                required: true,
                minCount: 1,
                maxCount: 1,
                maxLength: 2500,
              },
              {
                role: "image_list",
                apiField: "image_list",
                modality: "image",
                required: false,
                minCount: 0,
                maxCount: 10,
              },
              {
                role: "result_type",
                apiField: "result_type",
                modality: "parameter",
                required: false,
                minCount: 0,
                maxCount: 1,
                default: "single",
                options: ["single", "series"],
              },
              {
                role: "count",
                apiField: "count",
                modality: "parameter",
                required: false,
                minCount: 0,
                maxCount: 1,
                default: 1,
                min: 1,
                max: 9,
                visibleWhen: {
                  result_type: "single",
                },
              },
              {
                role: "series_amount",
                apiField: "series_amount",
                modality: "parameter",
                required: false,
                minCount: 0,
                maxCount: 1,
                default: 4,
                options: [2, 3, 4, "auto"],
                visibleWhen: {
                  result_type: "series",
                },
              },
            ],
          },
        ],
        pricing: [],
        formSpecs: [],
        parameterSchema: {},
      },
    ],
  })
  const model = provider.models[0]!
  const combination = model.inputCombinations[0]!
  const formSpec = CinemaProviderRuntime.normalizeGenerationFormSpec(provider, model, combination)

  expect(formSpec).toMatchObject({
    providerID: "klingai-cn",
    target: {
      kind: "model",
      modelID: "klingai-cn/kling-image-3.0-omni",
    },
    mode: "omni-image",
    output: "image",
  })
  expect(formSpec.controls.find((control) => control.key === "image_list")).toMatchObject({
    type: "image-list",
    maxCount: 10,
  })
  expect(formSpec.controls.find((control) => control.key === "count")).toMatchObject({
    type: "number",
    max: 9,
    visibleWhen: {
      result_type: "single",
    },
  })
  expect(formSpec.controls.find((control) => control.key === "series_amount")).toMatchObject({
    type: "select",
    visibleWhen: {
      result_type: "series",
    },
  })
})
