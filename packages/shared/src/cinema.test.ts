import { describe, expect, it } from "vitest"
import {
  CinemaImageGenerationResultSchema,
  CinemaImportedImageAssetResultSchema,
  CinemaImageModelsResultSchema,
  CinemaCommandSchema,
  CinemaProjectDirectoryListingSchema,
  CinemaCustomApiAuthStateSchema,
  CinemaCustomApiRunResultSchema,
  CinemaCanvasDocumentSchema,
  CinemaTextGenerationResultSchema,
  CinemaTextModelsResultSchema,
  CinemaGenerationTaskSchema,
  CinemaVideoProviderSchema,
  CinemaVideoProviderManifestSchema,
  CreateCinemaCustomApiNodeApiKeyBodySchema,
  CreateCinemaCustomApiRunBodySchema,
  CreateCinemaGenerationTaskBodySchema,
  CreateCinemaImageGenerationBodySchema,
  CreateCinemaImportedImageAssetBodySchema,
  CreateCinemaTextGenerationBodySchema,
} from "./cinema"

describe("cinema schemas", () => {
  it("parses custom API canvas nodes and run payloads", () => {
    const canvas = CinemaCanvasDocumentSchema.parse({
      schemaVersion: 1,
      canvasType: "node-canvas",
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: "custom-api-1",
          type: "custom-api",
          title: "Custom API",
          position: { x: 100, y: 100 },
          data: {
            status: "idle",
            inputSchema: {
              type: "object",
              properties: {
                prompt: { type: "string" },
              },
              required: ["prompt"],
            },
            inputValues: {
              prompt: "Rainy street.",
            },
            request: {
              method: "POST",
              url: "https://api.example.com/v1/chat/completions",
              headersTemplate: {
                "Content-Type": "application/json",
              },
              bodyTemplate: {
                prompt: "{{inputs.prompt}}",
              },
            },
            auth: {
              type: "bearer",
              credentialProviderID: "cinema-custom-api-1",
            },
            outputMapping: {
              text: "$.choices[0].message.content",
            },
          },
        },
      ],
      edges: [],
      nodeTypes: ["custom-api"],
    })

    expect(canvas.nodes[0]?.type).toBe("custom-api")

    const runBody = CreateCinemaCustomApiRunBodySchema.parse({
      nodeID: "custom-api-1",
      inputValues: {
        prompt: "Rainy street.",
      },
    })
    expect(runBody.mode).toBe("run")

    const previewBody = CreateCinemaCustomApiRunBodySchema.parse({
      nodeID: "custom-api-1",
      mode: "preview",
    })
    expect(previewBody.mode).toBe("preview")

    const authBody = CreateCinemaCustomApiNodeApiKeyBodySchema.parse({
      apiKey: "sk-test",
    })
    expect(authBody.apiKey).toBe("sk-test")

    const authState = CinemaCustomApiAuthStateSchema.parse({
      nodeID: "custom-api-1",
      credentialProviderID: "cinema-custom-api-1",
      connected: true,
      status: "connected",
    })
    expect(authState.connected).toBe(true)

    const result = CinemaCustomApiRunResultSchema.parse({
      nodeID: "custom-api-1",
      requestPreview: {
        method: "POST",
        url: "https://api.example.com/v1/chat/completions",
        headers: {
          authorization: "Bearer [redacted]",
        },
        body: {
          prompt: "Rainy street.",
        },
      },
      statusCode: 200,
      output: {
        text: "Generated response.",
        imageUrl: "https://example.com/image.png",
        json: { ok: true },
      },
      elapsedMs: 20,
    })
    expect(result.output?.text).toBe("Generated response.")

    expect(() =>
      CreateCinemaCustomApiRunBodySchema.parse({
        nodeID: "custom-api-1",
        mode: "stream",
      })
    ).toThrow()
  })

  it("parses custom node definitions and definition commands", () => {
    const canvas = CinemaCanvasDocumentSchema.parse({
      schemaVersion: 1,
      canvasType: "node-canvas",
      viewport: { x: 0, y: 0, zoom: 1 },
      customNodeDefinitions: [
        {
          id: "def-chat",
          title: "OpenAI Chat",
          runtime: "http-json-post",
          inputSchema: {
            type: "object",
            properties: {
              prompt: { type: "string" },
            },
            required: ["prompt"],
          },
          request: {
            method: "POST",
            url: "https://api.example.com/v1/chat/completions",
            headersTemplate: {
              "Content-Type": "application/json",
            },
            bodyTemplate: {
              messages: [{ role: "user", content: "{{inputs.prompt}}" }],
            },
          },
          auth: {
            type: "bearer",
          },
          outputMapping: {
            text: "$.choices[0].message.content",
          },
        },
      ],
      nodes: [
        {
          id: "custom-node-1",
          type: "custom-node",
          title: "OpenAI Chat",
          position: { x: 100, y: 100 },
          data: {
            definitionID: "def-chat",
            status: "idle",
            inputValues: {
              prompt: "Generate a shot beat.",
            },
            auth: {
              type: "bearer",
              credentialProviderID: "cinema-custom-node-1",
            },
          },
        },
      ],
      edges: [],
      nodeTypes: ["custom-node"],
    })

    expect(canvas.customNodeDefinitions[0]?.title).toBe("OpenAI Chat")
    expect(canvas.nodes[0]?.type).toBe("custom-node")

    const createCommand = CinemaCommandSchema.parse({
      type: "create-custom-node-definition",
      definition: canvas.customNodeDefinitions[0],
    })
    expect(createCommand.type).toBe("create-custom-node-definition")

    const updateCommand = CinemaCommandSchema.parse({
      type: "update-custom-node-definition",
      definitionID: "def-chat",
      patch: {
        title: "OpenAI Chat Updated",
      },
    })
    expect(updateCommand.type).toBe("update-custom-node-definition")

    expect(() =>
      CinemaCommandSchema.parse({
        type: "update-custom-node-definition",
        definitionID: "def-chat",
        patch: {},
      })
    ).toThrow()
  })

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
          offeringID: "klingai-global/kling-3.0-turbo",
          providerModelID: "kling-3.0-turbo",
          modes: ["text-to-video", "text-to-video.multi-shot"],
          inputCombinations: [
            {
              mode: "text-to-video.multi-shot",
              label: "Text to video multi-shot",
              inputs: [
                {
                  role: "prompt",
                  modality: "text",
                  required: true,
                  minCount: 1,
                  maxCount: 1,
                  note: "Use Shot n fixed format.",
                },
              ],
              endpoint: {
                method: "POST",
                path: "/text-to-video/kling-3.0-turbo",
              },
            },
          ],
        },
        {
          id: "kling-image-3.0",
          label: "Kling Image 3.0",
          offeringID: "klingai-global/kling-image-3.0",
          providerModelID: "kling-v3",
          modalities: {
            input: ["text", "image"],
            output: ["image"],
          },
          modes: ["text-to-image", "image-to-image", "image-edit"],
          inputCombinations: [
            {
              mode: "image-to-image",
              label: "Image to image",
              requiredModalities: ["image"],
              optionalModalities: ["text"],
              inputs: [
                {
                  role: "image",
                  modality: "image",
                  required: true,
                  minCount: 1,
                  maxCount: 1,
                },
              ],
              endpoint: {
                method: "POST",
                path: "/v1/images/edits",
              },
            },
          ],
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
    expect(manifest.models[0]?.offeringID).toBe("klingai-global/kling-3.0-turbo")
    expect(manifest.models[0]?.modes).toEqual(["text-to-video", "text-to-video.multi-shot"])
    expect(manifest.models[0]?.inputCombinations[0]?.mode).toBe("text-to-video.multi-shot")
    expect(manifest.models[0]?.inputCombinations[0]?.inputs[0]?.note).toBe("Use Shot n fixed format.")
    expect(manifest.models[1]?.providerModelID).toBe("kling-v3")
    expect(manifest.models[1]?.modes).toEqual(["text-to-image", "image-to-image", "image-edit"])
    expect(manifest.models[1]?.inputCombinations[0]).toMatchObject({
      mode: "image-to-image",
      endpoint: {
        method: "POST",
        path: "/v1/images/edits",
      },
      inputs: [{ role: "image", modality: "image", required: true, minCount: 1, maxCount: 1 }],
    })

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

  it("parses provider task modes including catalog-defined combination modes", () => {
    const body = CreateCinemaGenerationTaskBodySchema.parse({
      providerID: "kling",
      modelID: "kling-3.0-turbo",
      mode: "text-to-video",
      taskNodeID: "video-node-1",
    })

    expect(body.taskNodeID).toBe("video-node-1")

    const customModeBody = CreateCinemaGenerationTaskBodySchema.parse({
      providerID: "kling",
      modelID: "kling-3.0-turbo",
      mode: "text-to-video.multi-shot",
    })

    expect(customModeBody.mode).toBe("text-to-video.multi-shot")

    const imageBody = CreateCinemaGenerationTaskBodySchema.parse({
      providerID: "kling",
      modelID: "kling-image-3.0",
      mode: "text-to-image",
    })

    expect(imageBody.mode).toBe("text-to-image")

    const referenceVideoBody = CreateCinemaGenerationTaskBodySchema.parse({
      providerID: "kling",
      modelID: "kling-3.0-turbo",
      mode: "reference-to-video",
      parameters: {
        inputSlots: [
          {
            slot: "referenceImage",
            nodeID: "image-1",
            edgeID: "edge-image-1-video-1",
            assetID: "reference-1",
            path: "assets/reference-1.png",
          },
        ],
        referenceImageAssetID: "reference-1",
        referenceImageAssetIDs: ["reference-1", "reference-2"],
        referenceImagePath: "assets/reference-1.png",
        referenceImagePaths: ["assets/reference-1.png", "assets/reference-2.png"],
      },
    })

    expect(referenceVideoBody.mode).toBe("reference-to-video")
    expect(referenceVideoBody.parameters.referenceImageAssetIDs).toEqual(["reference-1", "reference-2"])

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
          supportsImageInput: true,
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
        supportsImageInput: true,
      },
    })

    expect(models.items[0]?.value).toBe("openai/gpt-5.4")
    expect(models.items[0]?.supportsImageInput).toBe(true)

    const body = CreateCinemaTextGenerationBodySchema.parse({
      nodeID: "text-1",
      prompt: "Expand this beat.",
      model: "openai/gpt-5.4",
      sourceImageAssetID: "image-1",
      sourceImageAssetIDs: ["image-1", "image-2"],
      sourceImagePath: "generated/images/image-1.png",
      sourceImagePaths: ["generated/images/image-1.png", "generated/images/image-2.png"],
      writeMode: "append",
    })

    expect(body.writeMode).toBe("append")
    expect(body.sourceImagePath).toBe("generated/images/image-1.png")
    expect(body.sourceImagePaths).toEqual(["generated/images/image-1.png", "generated/images/image-2.png"])

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
          supportsImageInput: true,
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
        supportsImageInput: true,
      },
    })

    expect(models.effectiveModel?.value).toBe("klingai/kling-image-v3")
    expect(models.effectiveModel?.supportsImageInput).toBe(true)

    const body = CreateCinemaImageGenerationBodySchema.parse({
      nodeID: "image-1",
      prompt: "A neon storyboard frame.",
      userPrompt: "A neon storyboard frame.",
      model: "klingai/kling-image-v3",
      size: "1024x1024",
      count: 2,
      style: "cinematic",
      sourceNodeIDs: ["text-1", "image-ref-1"],
      sourceTextPrompts: ["Storyboard note."],
      sourceImageAssetID: "reference-1",
      sourceImageAssetIDs: ["reference-1", "reference-2"],
      sourceImagePath: "assets/reference-1.png",
      sourceImagePaths: ["assets/reference-1.png", "assets/reference-2.png"],
    })

    expect(body.count).toBe(2)
    expect(body.sourceNodeIDs).toEqual(["text-1", "image-ref-1"])
    expect(body.sourceTextPrompts).toEqual(["Storyboard note."])
    expect(body.sourceImagePath).toBe("assets/reference-1.png")
    expect(body.sourceImagePaths).toEqual(["assets/reference-1.png", "assets/reference-2.png"])

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

    const importBody = CreateCinemaImportedImageAssetBodySchema.parse({
      fileName: "reference.png",
      mimeType: "image/png",
      dataBase64: "iVBORw0KGgo=",
    })
    expect(importBody.fileName).toBe("reference.png")

    const imported = CinemaImportedImageAssetResultSchema.parse({
      asset: {
        id: "import-1",
        kind: "image",
        path: "assets/imported/reference.png",
        mimeType: "image/png",
        sizeBytes: 8,
        width: 1,
        height: 1,
      },
    })
    expect(imported.asset.kind).toBe("image")
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
