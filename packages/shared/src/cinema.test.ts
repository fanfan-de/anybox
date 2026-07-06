import { describe, expect, it } from "vitest"
import {
  CinemaImageGenerationResultSchema,
  CinemaImageModelsResultSchema,
  CinemaProjectDirectoryListingSchema,
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
        {
          id: "kling-image-3.0",
          label: "Kling Image 3.0",
          modalities: {
            input: ["text", "image"],
            output: ["image"],
          },
          modes: ["text-to-image", "image-to-image", "image-edit"],
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
    expect(manifest.models[1]?.modes).toEqual(["text-to-image", "image-to-image", "image-edit"])

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
    expect(task.progress).toBeUndefined()

    const taskWithProgress = CinemaGenerationTaskSchema.parse({
      ...task,
      progress: {
        phase: "processing",
        message: "Provider is rendering.",
        updatedAt: "2026-07-04T00:01:00.000Z",
      },
    })
    expect(taskWithProgress.progress?.phase).toBe("processing")

    const completedTask = CinemaGenerationTaskSchema.parse({
      ...task,
      status: "succeeded",
      progress: {
        phase: "succeeded",
        percent: 100,
      },
    })
    expect(completedTask.progress?.percent).toBe(100)
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
        adapterAvailable: true,
        adapterID: "kling",
      },
    })

    expect(provider.runtime?.baseURL).toBe("https://api-singapore.klingai.com")
    expect(provider.runtime?.configuredBaseURL).toBe("https://kling-proxy.example.com")
    expect(provider.runtime?.baseURLSource).toBe("settings")
    expect(provider.runtime?.adapterAvailable).toBe(true)
    expect(provider.runtime?.adapterID).toBe("kling")
  })

  it("parses provider task modes while rejecting unknown task modes", () => {
    const body = CreateCinemaGenerationTaskBodySchema.parse({
      providerID: "kling",
      modelID: "kling-3.0-turbo",
      mode: "text-to-video",
      taskNodeID: "video-node-1",
    })

    expect(body.taskNodeID).toBe("video-node-1")

    expect(() =>
      CreateCinemaGenerationTaskBodySchema.parse({
        providerID: "kling",
        modelID: "kling-3.0-turbo",
        mode: "not-a-mode",
      })
    ).toThrow()

    const imageBody = CreateCinemaGenerationTaskBodySchema.parse({
      providerID: "kling",
      modelID: "kling-image-3.0",
      mode: "text-to-image",
    })

    expect(imageBody.mode).toBe("text-to-image")

    expect(() =>
      CreateCinemaGenerationTaskBodySchema.parse({
        providerID: "kling",
        modelID: "kling-3.0-turbo",
        mode: "text-to-video",
        taskNodeID: "",
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
          value: "klingai/kling-image-v3",
          providerID: "klingai",
          modelID: "kling-image-v3",
          label: "Kling Image 3.0",
          providerLabel: "KlingAI",
          available: true,
        },
      ],
      selection: {
        image_model: null,
      },
      effectiveModel: {
        value: "klingai/kling-image-v3",
        providerID: "klingai",
        modelID: "kling-image-v3",
        label: "Kling Image 3.0",
        providerLabel: "KlingAI",
        available: true,
      },
    })

    expect(models.effectiveModel?.value).toBe("klingai/kling-image-v3")

    const body = CreateCinemaImageGenerationBodySchema.parse({
      nodeID: "image-1",
      prompt: "A neon storyboard frame.",
      model: "klingai/kling-image-v3",
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
      model: "klingai/kling-image-v3",
      taskID: "task-image-1",
      status: "running",
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

  it("parses project directory listings", () => {
    const listing = CinemaProjectDirectoryListingSchema.parse({
      projectID: "project-1",
      root: "/tmp/project",
      path: "generated/images",
      parentPath: "generated",
      entries: [
        {
          name: "shot-1.png",
          path: "generated/images/shot-1.png",
          kind: "file",
          sizeBytes: 128,
          modifiedAt: "2026-07-06T00:00:00.000Z",
          mimeType: "image/png",
          previewable: true,
        },
        {
          name: "refs",
          path: "generated/images/refs",
          kind: "directory",
        },
      ],
    })

    expect(listing.entries[0]?.previewable).toBe(true)
    expect(listing.entries[1]?.previewable).toBe(false)
  })
})
