import { describe, expect, it } from "vitest"
import {
  CinemaImageGenerationResultSchema,
  CinemaImageModelsResultSchema,
  CinemaTextGenerationResultSchema,
  CinemaTextModelsResultSchema,
  CinemaGenerationTaskSchema,
  CinemaVideoProviderSchema,
  CinemaVideoProviderManifestSchema,
  CreateCinemaGenerationTaskBodySchema,
  CreateCinemaImageGenerationBodySchema,
  CreateCinemaTextGenerationBodySchema,
} from "./cinema"

describe("cinema schemas", () => {
  it("parses provider manifests and generation tasks", () => {
    const manifest = CinemaVideoProviderManifestSchema.parse({
      id: "kling",
      name: "Kling AI",
      baseURL: "https://api.example.com",
      credentialProviderID: "cinema-kling",
      requiresCredential: true,
      connectionTest: {
        path: "/v1/models",
      },
      models: [
        {
          id: "kling-3.0-turbo",
          label: "Kling 3.0 Turbo",
          modes: ["text-to-video"],
        },
      ],
    })

    expect(manifest.requiresCredential).toBe(true)
    expect(manifest.baseURL).toBe("https://api.example.com")
    expect(manifest.connectionTest).toMatchObject({
      method: "GET",
      path: "/v1/models",
      auth: "bearer",
      expectedStatus: [200],
      timeoutMs: 10000,
    })
    expect(manifest.models[0]?.durations).toEqual([])

    const task = CinemaGenerationTaskSchema.parse({
      id: "task-1",
      projectID: "project-1",
      providerID: "kling",
      modelID: "kling-3.0-turbo",
      mode: "text-to-video",
      title: "Test",
      status: "running",
      createdAt: "2026-07-04T00:00:00.000Z",
      updatedAt: "2026-07-04T00:00:00.000Z",
      input: {
        prompt: "A test prompt",
      },
    })

    expect(task.input.sourceNodeIDs).toEqual([])
    expect(task.outputAssets).toEqual([])
  })

  it("parses provider runtime metadata", () => {
    const provider = CinemaVideoProviderSchema.parse({
      manifest: {
        id: "kling",
        name: "Kling AI",
        credentialProviderID: "cinema-kling",
        requiresCredential: true,
        models: [
          {
            id: "kling-3.0-turbo",
            label: "Kling 3.0 Turbo",
            modes: ["text-to-video"],
          },
        ],
      },
      auth: {
        providerID: "kling",
        credentialProviderID: "cinema-kling",
        requiresCredential: true,
        connected: true,
        status: "connected",
      },
      runtime: {
        baseURL: "https://api-singapore.klingai.com",
        configuredBaseURL: "https://kling-proxy.example.com",
        baseURLSource: "settings",
      },
    })

    expect(provider.runtime?.baseURL).toBe("https://api-singapore.klingai.com")
    expect(provider.runtime?.configuredBaseURL).toBe("https://kling-proxy.example.com")
    expect(provider.runtime?.baseURLSource).toBe("settings")
  })

  it("rejects unsupported generation task modes", () => {
    expect(() =>
      CreateCinemaGenerationTaskBodySchema.parse({
        providerID: "kling",
        modelID: "kling-3.0-turbo",
        mode: "not-a-mode",
      })
    ).toThrow()
  })

  it("parses text model lists and text generation payloads", () => {
    const models = CinemaTextModelsResultSchema.parse({
      items: [
        {
          value: "openai/gpt-5.4",
          providerID: "openai",
          modelID: "gpt-5.4",
          label: "GPT-5.4",
          providerLabel: "OpenAI",
          available: true,
        },
      ],
      selection: {
        model: "openai/gpt-5.4",
      },
      effectiveModel: {
        value: "openai/gpt-5.4",
        providerID: "openai",
        modelID: "gpt-5.4",
        label: "GPT-5.4",
        providerLabel: "OpenAI",
        available: true,
      },
    })

    expect(models.items[0]?.value).toBe("openai/gpt-5.4")

    const body = CreateCinemaTextGenerationBodySchema.parse({
      nodeID: "text-1",
      prompt: "Expand this beat.",
      model: "openai/gpt-5.4",
      writeMode: "append",
    })

    expect(body.writeMode).toBe("append")

    const result = CinemaTextGenerationResultSchema.parse({
      canvas: {
        schemaVersion: 1,
        canvasType: "node-canvas",
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [],
        edges: [],
        nodeTypes: [],
      },
      nodeID: "text-1",
      text: "Original\n\nGenerated",
      generatedText: "Generated",
      model: "openai/gpt-5.4",
    })

    expect(result.generatedText).toBe("Generated")
  })

  it("rejects invalid text generation payloads", () => {
    expect(() =>
      CreateCinemaTextGenerationBodySchema.parse({
        nodeID: "text-1",
        prompt: "   ",
        writeMode: "append",
      })
    ).toThrow()

    expect(() =>
      CreateCinemaTextGenerationBodySchema.parse({
        nodeID: "text-1",
        prompt: "Generate",
        writeMode: "replace",
      })
    ).toThrow()
  })

  it("parses image model lists and image generation payloads", () => {
    const models = CinemaImageModelsResultSchema.parse({
      items: [
        {
          value: "openai/gpt-image-1",
          providerID: "openai",
          modelID: "gpt-image-1",
          label: "GPT Image 1",
          providerLabel: "OpenAI",
          available: true,
        },
      ],
      selection: {
        image_model: "openai/gpt-image-1",
      },
      effectiveModel: {
        value: "openai/gpt-image-1",
        providerID: "openai",
        modelID: "gpt-image-1",
        label: "GPT Image 1",
        providerLabel: "OpenAI",
        available: true,
      },
    })

    expect(models.effectiveModel?.value).toBe("openai/gpt-image-1")

    const body = CreateCinemaImageGenerationBodySchema.parse({
      nodeID: "image-1",
      prompt: "A neon storyboard frame.",
      model: "openai/gpt-image-1",
      size: "1024x1024",
      count: 2,
      style: "cinematic",
    })

    expect(body.count).toBe(2)

    const result = CinemaImageGenerationResultSchema.parse({
      canvas: {
        schemaVersion: 1,
        canvasType: "node-canvas",
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [],
        edges: [],
        nodeTypes: [],
      },
      nodeID: "image-1",
      model: "openai/gpt-image-1",
      assets: [
        {
          id: "asset-1",
          kind: "image",
          path: "generated/images/image-1/2026-07-05-1.png",
          mimeType: "image/png",
          sizeBytes: 68,
          width: 1,
          height: 1,
        },
      ],
    })

    expect(result.assets[0]?.width).toBe(1)
  })

  it("rejects invalid image generation payloads", () => {
    expect(() =>
      CreateCinemaImageGenerationBodySchema.parse({
        nodeID: "image-1",
        prompt: "   ",
      })
    ).toThrow()

    expect(() =>
      CreateCinemaImageGenerationBodySchema.parse({
        nodeID: "image-1",
        prompt: "Generate",
        size: "square",
      })
    ).toThrow()

    expect(() =>
      CreateCinemaImageGenerationBodySchema.parse({
        nodeID: "image-1",
        prompt: "Generate",
        count: 5,
      })
    ).toThrow()
  })
})
