import { expect, test } from "bun:test"
import "./sqlite.cleanup.ts"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
    runtimeKind: "ai-sdk"
    selectable: boolean
    available: boolean
    source: "provider"
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

test("model catalog API keeps provider models selectable", async () => {
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
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
    restoreProvider()
  }
})
