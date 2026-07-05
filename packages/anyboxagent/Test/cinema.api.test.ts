import { describe, expect, test } from "bun:test"
import "./sqlite.cleanup.ts"
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServerApp } from "#server/server.ts"
import {
  setCinemaImageRuntimeDependenciesForTest,
  setCinemaKlingApiKeyForTest,
  setCinemaKlingClientFactoryForTest,
  setCinemaTextRuntimeDependenciesForTest,
} from "#server/usecases/cinema.ts"
import { testDeepSeekModel, type PublicModel } from "#provider/provider.ts"
import { Instance } from "#project/instance.ts"

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
  name?: string
  repositoryRoot: string
  worktree: string
}

interface CinemaProjectSummary {
  projectID: string
  name: string
  root: string
  initialized: boolean
  project?: Record<string, unknown>
}

interface CinemaCanvasDocument {
  schemaVersion: 1
  canvasType: "node-canvas"
  viewport: {
    x: number
    y: number
    zoom: number
  }
  nodes: Array<{
    id: string
    type: string
    title: string
    position: {
      x: number
      y: number
    }
    size?: {
      width: number
      height: number
    }
    data?: Record<string, unknown>
  }>
  edges: Array<{
    id: string
    source: string
    target: string
  }>
  nodeTypes: string[]
}

interface CinemaProjectEvent {
  time: string
  type: string
  actor: string
  message: string
  commandID?: string
  data?: Record<string, unknown>
}

interface CinemaCommandResult {
  canvas: CinemaCanvasDocument
  event: CinemaProjectEvent
}

interface CinemaEventsResult {
  events: CinemaProjectEvent[]
  nextCursor: number
}

interface CinemaProjectStateSummary {
  projectID: string
  initialized: boolean
  nodeCount: number
  edgeCount: number
  nodeTypeCounts: Record<string, number>
  nodes: Array<{
    id: string
    type: string
    title: string
    text?: string
    status?: string
  }>
  recentEvents: CinemaProjectEvent[]
  directories: Array<{
    path: string
    exists: boolean
    fileCount: number
    sample: string[]
  }>
  gaps: string[]
}

interface CinemaVideoProvider {
  manifest: {
    id: string
    name: string
    requiresCredential: boolean
    credentialProviderID?: string
    models: Array<{
      id: string
      modes: string[]
    }>
  }
  auth: {
    providerID: string
    credentialProviderID: string
    connected: boolean
    status: string
  }
  runtime?: {
    baseURL?: string
    configuredBaseURL?: string
    baseURLSource?: "settings" | "environment" | "default"
  }
}

interface CinemaGenerationTask {
  id: string
  projectID: string
  providerID: string
  modelID: string
  mode: string
  title: string
  status: string
  taskNodeID?: string
  outputNodeID?: string
  providerTaskRef?: Record<string, unknown>
  input: {
    prompt: string
    sourceNodeIDs: string[]
    parameters: Record<string, unknown>
  }
  outputAssets: Array<{
    id: string
    kind: string
    path: string
    mimeType?: string
    sizeBytes?: number
  }>
}

interface CinemaGeneratedAsset {
  id: string
  kind: string
  path: string
  mimeType?: string
  sizeBytes?: number
  width?: number
  height?: number
}

interface CinemaTextModel {
  value: string
  providerID: string
  modelID: string
  label: string
  providerLabel: string
  available: boolean
}

interface CinemaTextModelsResult {
  items: CinemaTextModel[]
  selection?: {
    model?: string | null
  }
  effectiveModel?: CinemaTextModel | null
}

interface CinemaTextGenerationResult {
  canvas: CinemaCanvasDocument
  nodeID: string
  text: string
  generatedText: string
  model: string
}

interface CinemaImageModel {
  value: string
  providerID: string
  modelID: string
  label: string
  providerLabel: string
  available: boolean
}

interface CinemaImageModelsResult {
  items: CinemaImageModel[]
  selection?: {
    image_model?: string | null
  }
  effectiveModel?: CinemaImageModel | null
}

interface CinemaImageGenerationResult {
  canvas: CinemaCanvasDocument
  nodeID: string
  model: string
  assets: CinemaGeneratedAsset[]
}

async function readJson<T>(response: Response) {
  return await response.json() as JsonEnvelope<T>
}

async function createTempProjectRoot() {
  return await realpath(await mkdtemp(join(tmpdir(), "anybox-cinema-api-")))
}

async function createProject(app: ReturnType<typeof createServerApp>, directory: string) {
  const response = await app.request("http://localhost/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ directory }),
  })
  const body = await readJson<ProjectResponse>(response)

  expect(response.status).toBe(201)
  expect(body.success).toBe(true)
  expect(body.data?.id).toBeString()

  return body.data!
}

function createCanvas(): CinemaCanvasDocument {
  return {
    schemaVersion: 1,
    canvasType: "node-canvas",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      {
        id: "story-brief",
        type: "text",
        title: "Story Brief",
        position: { x: 120, y: 140 },
        size: { width: 360, height: 220 },
        data: {
          text: "A test story brief.",
        },
      },
      {
        id: "director-agent",
        type: "agent",
        title: "Director Agent",
        position: { x: 560, y: 180 },
        size: { width: 360, height: 220 },
        data: {
          text: "Coordinate shots.",
        },
      },
    ],
    edges: [
      {
        id: "edge-story-director",
        source: "story-brief",
        target: "director-agent",
      },
    ],
    nodeTypes: ["text", "agent"],
  }
}

function createPublicTextModel(): PublicModel {
  return {
    ...testDeepSeekModel,
    providerName: "DeepSeek",
    available: true,
  }
}

function createPublicImageModel(): PublicModel {
  return {
    ...testDeepSeekModel,
    id: "deepseek-image",
    name: "DeepSeek Image",
    providerName: "DeepSeek",
    available: true,
    capabilities: {
      ...testDeepSeekModel.capabilities,
      input: {
        ...testDeepSeekModel.capabilities.input,
        text: true,
      },
      output: {
        ...testDeepSeekModel.capabilities.output,
        image: true,
      },
    },
  }
}

function createProviderImageModel() {
  return {
    ...testDeepSeekModel,
    id: "deepseek-image",
    name: "DeepSeek Image",
    capabilities: {
      ...testDeepSeekModel.capabilities,
      input: {
        ...testDeepSeekModel.capabilities.input,
        text: true,
      },
      output: {
        ...testDeepSeekModel.capabilities.output,
        image: true,
      },
    },
  }
}

function createCanvasWithImageNode(overrides: Record<string, unknown> = {}): CinemaCanvasDocument {
  const canvas = createCanvas()
  canvas.nodes.push({
    id: "image-gen",
    type: "image",
    title: "Image Gen",
    position: { x: 920, y: 260 },
    size: { width: 420, height: 440 },
    data: {
      prompt: "A quiet moonlit frame.",
      size: "1024x1024",
      count: 1,
      status: "idle",
      ...overrides,
    },
  })
  canvas.nodeTypes = ["text", "agent", "image"]
  return canvas
}

function tinyPngBytes() {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ])
}

function encodeAssetPath(assetPath: string) {
  return assetPath.split("/").map((segment) => encodeURIComponent(segment)).join("/")
}

async function initializeCinemaProject(root: string, canvas = createCanvas()) {
  const cinemaDir = join(root, ".anybox-cinema")
  await mkdir(cinemaDir, { recursive: true })
  await writeFile(
    join(cinemaDir, "project.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      name: "Cinema Fixture",
      createdAt: "2026-07-04T00:00:00.000Z",
    }, null, 2)}\n`,
    "utf8",
  )
  await writeFile(join(cinemaDir, "canvas.json"), `${JSON.stringify(canvas, null, 2)}\n`, "utf8")
}

describe("cinema api", () => {
  test("reads initialized project summary and canvas", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root)

      const projectResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}`)
      const projectBody = await readJson<CinemaProjectSummary>(projectResponse)

      expect(projectResponse.status).toBe(200)
      expect(projectBody.success).toBe(true)
      expect(projectBody.data).toMatchObject({
        projectID: project.id,
        root,
        initialized: true,
      })
      expect(projectBody.data?.project?.name).toBe("Cinema Fixture")

      const canvasResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/canvas`)
      const canvasBody = await readJson<CinemaCanvasDocument>(canvasResponse)

      expect(canvasResponse.status).toBe(200)
      expect(canvasBody.success).toBe(true)
      expect(canvasBody.data?.nodes.map((node) => node.id)).toEqual(["story-brief", "director-agent"])
      expect(canvasBody.data?.edges).toHaveLength(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("does not initialize missing cinema projects while reading canvas", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()

    try {
      const project = await createProject(app, root)
      const projectResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}`)
      const projectBody = await readJson<CinemaProjectSummary>(projectResponse)

      expect(projectResponse.status).toBe(200)
      expect(projectBody.data?.initialized).toBe(false)

      const canvasResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/canvas`)
      const canvasBody = await readJson(canvasResponse)

      expect(canvasResponse.status).toBe(404)
      expect(canvasBody.success).toBe(false)
      expect(canvasBody.error?.code).toBe("CINEMA_PROJECT_NOT_INITIALIZED")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("writes canvas atomically and appends update events", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()

    try {
      const project = await createProject(app, root)
      const nextCanvas = createCanvas()
      nextCanvas.nodes[0]!.position = { x: 220, y: 260 }
      nextCanvas.nodes.push({
        id: "shot-1",
        type: "shot",
        title: "Shot 1",
        position: { x: 920, y: 320 },
        size: { width: 380, height: 250 },
        data: {
          text: "Opening shot.",
        },
      })
      nextCanvas.nodeTypes = ["text", "agent", "shot"]

      await initializeCinemaProject(root)

      const updateResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/canvas`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(nextCanvas),
      })
      const updateBody = await readJson<CinemaCanvasDocument>(updateResponse)

      expect(updateResponse.status).toBe(200)
      expect(updateBody.success).toBe(true)
      expect(updateBody.data?.nodes.map((node) => node.id)).toContain("shot-1")

      const persisted = JSON.parse(await readFile(join(root, ".anybox-cinema", "canvas.json"), "utf8")) as CinemaCanvasDocument
      expect(persisted.nodes.find((node) => node.id === "story-brief")?.position).toEqual({ x: 220, y: 260 })

      const events = await readFile(join(root, ".anybox-cinema", "events.jsonl"), "utf8")
      expect(events).toContain("\"type\":\"canvas.updated\"")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("applies cinema commands and exposes events plus project summary", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root)

      const createResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "cmd-create-shot",
          type: "create-node",
          actor: "test-agent",
          node: {
            id: "shot-1",
            type: "shot",
            title: "Shot 1",
            position: { x: 880, y: 260 },
            size: { width: 380, height: 250 },
            data: { text: "Opening shot." },
          },
        }),
      })
      const createBody = await readJson<CinemaCommandResult>(createResponse)

      expect(createResponse.status).toBe(200)
      expect(createBody.success).toBe(true)
      expect(createBody.data?.event).toMatchObject({
        type: "command.create-node",
        actor: "test-agent",
        commandID: "cmd-create-shot",
      })
      expect(createBody.data?.canvas.nodes.map((node) => node.id)).toContain("shot-1")
      expect(createBody.data?.canvas.nodeTypes).toContain("shot")

      const updateResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "update-node",
          actor: "cinema-web",
          nodeID: "shot-1",
          patch: {
            title: "Shot 1 - revised",
            data: { text: "A revised opening shot." },
          },
        }),
      })
      expect(updateResponse.status).toBe(200)

      const connectResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "connect-nodes",
          actor: "cinema-web",
          edge: {
            id: "edge-story-shot",
            source: "story-brief",
            target: "shot-1",
          },
        }),
      })
      expect(connectResponse.status).toBe(200)

      const viewportResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "update-viewport",
          actor: "cinema-web",
          viewport: { x: 24, y: 48, zoom: 0.8 },
        }),
      })
      expect(viewportResponse.status).toBe(200)

      const disconnectResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "disconnect-edge",
          actor: "cinema-web",
          edgeID: "edge-story-shot",
        }),
      })
      expect(disconnectResponse.status).toBe(200)

      const duplicateDisconnectResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "disconnect-edge",
          actor: "cinema-web",
          edgeID: "edge-story-shot",
        }),
      })
      expect(duplicateDisconnectResponse.status).toBe(200)

      const persisted = JSON.parse(await readFile(join(root, ".anybox-cinema", "canvas.json"), "utf8")) as CinemaCanvasDocument
      expect(persisted.nodes.find((node) => node.id === "shot-1")?.title).toBe("Shot 1 - revised")
      expect(persisted.edges.map((edge) => edge.id)).not.toContain("edge-story-shot")
      expect(persisted.viewport).toEqual({ x: 24, y: 48, zoom: 0.8 })

      const eventsResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/events?after=0&limit=10`)
      const eventsBody = await readJson<CinemaEventsResult>(eventsResponse)

      expect(eventsResponse.status).toBe(200)
      expect(eventsBody.data?.events.map((event) => event.type)).toEqual([
        "command.create-node",
        "command.update-node",
        "command.connect-nodes",
        "command.update-viewport",
        "command.disconnect-edge",
        "command.disconnect-edge",
      ])
      expect(eventsBody.data?.nextCursor).toBe(6)

      const summaryResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/summary`)
      const summaryBody = await readJson<CinemaProjectStateSummary>(summaryResponse)

      expect(summaryResponse.status).toBe(200)
      expect(summaryBody.data).toMatchObject({
        projectID: project.id,
        initialized: true,
        nodeCount: 3,
        edgeCount: 1,
      })
      expect(summaryBody.data?.nodeTypeCounts.shot).toBe(1)
      expect(summaryBody.data?.nodes.find((node) => node.id === "shot-1")).toMatchObject({
        title: "Shot 1 - revised",
        text: "A revised opening shot.",
      })
      expect(summaryBody.data?.recentEvents).toHaveLength(6)
      expect(summaryBody.data?.directories.map((directory) => directory.path)).toContain("generated")
      expect(summaryBody.data?.gaps).toContain("no-provider-configured")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("lists text models and appends generated text to text nodes", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const publicTextModel = createPublicTextModel()
    const generationPrompts: string[] = []
    const restoreTextRuntime = setCinemaTextRuntimeDependenciesForTest({
      listModels: async () => [publicTextModel],
      resolveSelection: async () => ({
        model: "deepseek/deepseek-chat",
        small_model: undefined,
        image_model: undefined,
        reasoning_effort: undefined,
      }),
      resolveEffectiveModel: async () => publicTextModel,
      getModel: async () => testDeepSeekModel,
      getLanguage: async (model) => model as never,
      getGenerateText: async () => (async (input: any) => {
        generationPrompts.push(String(input.prompt ?? ""))
        return { text: "Generated beat." } as any
      }) as never,
    })

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root, {
        ...createCanvas(),
        nodes: createCanvas().nodes.map((node) =>
          node.id === "story-brief"
            ? {
              ...node,
              data: {
                ...node.data,
                generationPrompt: "Expand this.",
              },
            }
            : node
        ),
      })

      const modelsResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/text-models`)
      const modelsBody = await readJson<CinemaTextModelsResult>(modelsResponse)

      expect(modelsResponse.status).toBe(200)
      expect(modelsBody.data?.items).toEqual([
        {
          value: "deepseek/deepseek-chat",
          providerID: "deepseek",
          modelID: "deepseek-chat",
          label: "DeepSeek Chat",
          providerLabel: "DeepSeek",
          available: true,
        },
      ])
      expect(modelsBody.data?.effectiveModel?.value).toBe("deepseek/deepseek-chat")

      const generateResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/text-generations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nodeID: "story-brief",
          prompt: "Expand this story beat.",
          model: "deepseek/deepseek-chat",
          writeMode: "append",
        }),
      })
      const generateBody = await readJson<CinemaTextGenerationResult>(generateResponse)

      expect(generateResponse.status).toBe(200)
      expect(generateBody.data).toMatchObject({
        nodeID: "story-brief",
        generatedText: "Generated beat.",
        model: "deepseek/deepseek-chat",
        text: "A test story brief.\n\nGenerated beat.",
      })
      expect(generationPrompts[0]).toContain("Existing text:\nA test story brief.")
      expect(generationPrompts[0]).toContain("Generation request:\nExpand this story beat.")

      const generatedNode = generateBody.data?.canvas.nodes.find((node) => node.id === "story-brief")
      expect(generatedNode?.data?.text).toBe("A test story brief.\n\nGenerated beat.")
      expect(generatedNode?.data?.generationPrompt).toBe("")
      expect(generatedNode?.data?.textModel).toBe("deepseek/deepseek-chat")

      const persisted = JSON.parse(await readFile(join(root, ".anybox-cinema", "canvas.json"), "utf8")) as CinemaCanvasDocument
      expect(persisted.nodes.find((node) => node.id === "story-brief")?.data?.text).toBe("A test story brief.\n\nGenerated beat.")

      const events = await readFile(join(root, ".anybox-cinema", "events.jsonl"), "utf8")
      expect(events).toContain("\"type\":\"text.generated\"")
      expect(events).not.toContain("test-deepseek-key")

      const invalidNodeResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/text-generations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nodeID: "director-agent",
          prompt: "Try to generate.",
          writeMode: "append",
        }),
      })
      const invalidNodeBody = await readJson(invalidNodeResponse)

      expect(invalidNodeResponse.status).toBe(409)
      expect(invalidNodeBody.error?.code).toBe("CINEMA_TEXT_NODE_INVALID")

      const emptyPromptResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/text-generations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nodeID: "story-brief",
          prompt: "   ",
          writeMode: "append",
        }),
      })

      expect(emptyPromptResponse.status).toBe(400)
    } finally {
      restoreTextRuntime()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("generates text into empty text nodes without a leading separator", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const publicTextModel = createPublicTextModel()
    const restoreTextRuntime = setCinemaTextRuntimeDependenciesForTest({
      listModels: async () => [publicTextModel],
      resolveSelection: async () => ({
        model: "deepseek/deepseek-chat",
        small_model: undefined,
        image_model: undefined,
        reasoning_effort: undefined,
      }),
      resolveEffectiveModel: async () => publicTextModel,
      getModel: async () => testDeepSeekModel,
      getLanguage: async (model) => model as never,
      getGenerateText: async () => (async () => ({ text: "First generated line." }) as any) as never,
    })

    try {
      const project = await createProject(app, root)
      const canvas = createCanvas()
      canvas.nodes = canvas.nodes.map((node) =>
        node.id === "story-brief"
          ? {
            ...node,
            data: {
              ...node.data,
              text: "",
            },
          }
          : node
      )
      await initializeCinemaProject(root, canvas)

      const generateResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/text-generations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nodeID: "story-brief",
          prompt: "Draft the first line.",
          writeMode: "append",
        }),
      })
      const generateBody = await readJson<CinemaTextGenerationResult>(generateResponse)

      expect(generateResponse.status).toBe(200)
      expect(generateBody.data?.text).toBe("First generated line.")
    } finally {
      restoreTextRuntime()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("generates text inside the project instance context", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const publicTextModel = createPublicTextModel()
    let seenProjectID = ""
    const restoreTextRuntime = setCinemaTextRuntimeDependenciesForTest({
      listModels: async () => [publicTextModel],
      resolveSelection: async () => ({
        model: "deepseek/deepseek-chat",
        small_model: undefined,
        image_model: undefined,
        reasoning_effort: undefined,
      }),
      resolveEffectiveModel: async () => publicTextModel,
      getModel: async () => testDeepSeekModel,
      getLanguage: async (model) => {
        seenProjectID = Instance.project.id
        return model as never
      },
      getGenerateText: async () => (async () => ({ text: "Context-aware line." }) as any) as never,
    })

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root)

      const response = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/text-generations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nodeID: "story-brief",
          prompt: "Generate with project context.",
          writeMode: "append",
        }),
      })
      const body = await readJson<CinemaTextGenerationResult>(response)

      expect(response.status).toBe(200)
      expect(seenProjectID).toBe(project.id)
      expect(body.data?.generatedText).toBe("Context-aware line.")
    } finally {
      restoreTextRuntime()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rejects text generation when no text model is available", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const restoreTextRuntime = setCinemaTextRuntimeDependenciesForTest({
      listModels: async () => [],
      resolveSelection: async () => ({
        model: undefined,
        small_model: undefined,
        image_model: undefined,
        reasoning_effort: undefined,
      }),
      resolveEffectiveModel: async () => null,
    })

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root)

      const response = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/text-generations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nodeID: "story-brief",
          prompt: "Generate text.",
          writeMode: "append",
        }),
      })
      const body = await readJson(response)

      expect(response.status).toBe(400)
      expect(body.error?.code).toBe("CINEMA_TEXT_MODEL_NOT_AVAILABLE")
    } finally {
      restoreTextRuntime()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("lists image models and saves generated images into the cinema project", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const publicImageModel = createPublicImageModel()
    const providerImageModel = createProviderImageModel()
    const generationPrompts: string[] = []
    const restoreImageRuntime = setCinemaImageRuntimeDependenciesForTest({
      listModels: async () => [publicImageModel],
      resolveSelection: async () => ({
        model: undefined,
        small_model: undefined,
        image_model: "deepseek/deepseek-image",
        reasoning_effort: undefined,
      }),
      resolveEffectiveModel: async () => publicImageModel,
      getModel: async () => providerImageModel,
      getImage: async (model) => model as never,
      getImageGenerationSettings: async () => ({
        default_size: "512x512",
        default_count: 2,
      }),
      getGenerateImage: async () => (async (input: any) => {
        generationPrompts.push(String(input.prompt ?? ""))
        return {
          images: [
            { uint8Array: tinyPngBytes(), mediaType: "image/png" },
            { uint8Array: tinyPngBytes(), mediaType: "image/png" },
          ],
        } as any
      }) as never,
    })

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root, createCanvasWithImageNode())

      const modelsResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/image-models`)
      const modelsBody = await readJson<CinemaImageModelsResult>(modelsResponse)

      expect(modelsResponse.status).toBe(200)
      expect(modelsBody.data?.items).toEqual([
        {
          value: "deepseek/deepseek-image",
          providerID: "deepseek",
          modelID: "deepseek-image",
          label: "DeepSeek Image",
          providerLabel: "DeepSeek",
          available: true,
        },
      ])
      expect(modelsBody.data?.selection?.image_model).toBe("deepseek/deepseek-image")
      expect(modelsBody.data?.effectiveModel?.value).toBe("deepseek/deepseek-image")

      const generateResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/image-generations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nodeID: "image-gen",
          prompt: "A quiet moonlit frame.",
          model: "deepseek/deepseek-image",
          size: "512x512",
          count: 2,
          style: "cinematic noir",
        }),
      })
      const generateBody = await readJson<CinemaImageGenerationResult>(generateResponse)

      expect(generateResponse.status).toBe(200)
      expect(generateBody.data?.nodeID).toBe("image-gen")
      expect(generateBody.data?.model).toBe("deepseek/deepseek-image")
      expect(generateBody.data?.assets).toHaveLength(2)
      expect(generationPrompts[0]).toContain("A quiet moonlit frame.")
      expect(generationPrompts[0]).toContain("Style: cinematic noir")

      const asset = generateBody.data!.assets[0]!
      expect(asset).toMatchObject({
        kind: "image",
        mimeType: "image/png",
        width: 1,
        height: 1,
      })
      expect(asset.path.startsWith("generated/images/image-gen/")).toBe(true)
      const persistedAssetBytes = await readFile(join(root, asset.path))
      expect(persistedAssetBytes.byteLength).toBe(tinyPngBytes().byteLength)

      const imageNode = generateBody.data?.canvas.nodes.find((node) => node.id === "image-gen")
      expect(imageNode?.data).toMatchObject({
        prompt: "A quiet moonlit frame.",
        style: "cinematic noir",
        model: "deepseek/deepseek-image",
        size: "512x512",
        count: 2,
        status: "succeeded",
        selectedAssetID: asset.id,
        error: null,
      })
      expect(imageNode?.data?.resultAssets).toHaveLength(2)

      const assetResponse = await app.request(
        `http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/assets/${encodeAssetPath(asset.path)}`,
      )
      const assetBytes = new Uint8Array(await assetResponse.arrayBuffer())
      expect(assetResponse.status).toBe(200)
      expect(assetResponse.headers.get("content-type")).toBe("image/png")
      expect(assetBytes.byteLength).toBe(tinyPngBytes().byteLength)

      const events = await readFile(join(root, ".anybox-cinema", "events.jsonl"), "utf8")
      expect(events).toContain("\"type\":\"image.generated\"")
    } finally {
      restoreImageRuntime()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("image generation failures keep prior image results on the same node", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const publicImageModel = createPublicImageModel()
    const providerImageModel = createProviderImageModel()
    const restoreImageRuntime = setCinemaImageRuntimeDependenciesForTest({
      listModels: async () => [publicImageModel],
      resolveSelection: async () => ({
        model: undefined,
        small_model: undefined,
        image_model: "deepseek/deepseek-image",
        reasoning_effort: undefined,
      }),
      resolveEffectiveModel: async () => publicImageModel,
      getModel: async () => providerImageModel,
      getImage: async (model) => model as never,
      getImageGenerationSettings: async () => ({}),
      getGenerateImage: async () => (async () => {
        throw new Error("Provider rejected request with api_key: sk-test-secret")
      }) as never,
    })

    try {
      const project = await createProject(app, root)
      const oldAssets: CinemaGeneratedAsset[] = [
        {
          id: "old-image",
          kind: "image",
          path: "generated/images/image-gen/old.png",
          mimeType: "image/png",
          sizeBytes: 68,
        },
      ]
      await initializeCinemaProject(root, createCanvasWithImageNode({
        status: "succeeded",
        resultAssets: oldAssets,
        selectedAssetID: "old-image",
      }))

      const response = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/image-generations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nodeID: "image-gen",
          prompt: "Try again.",
          model: "deepseek/deepseek-image",
        }),
      })
      const body = await readJson(response)

      expect(response.status).toBe(502)
      expect(body.error?.code).toBe("CINEMA_IMAGE_GENERATION_FAILED")
      expect(body.error?.message).toContain("Provider rejected request")
      expect(body.error?.message).not.toContain("sk-test-secret")
      expect(body.error?.message).toContain("api_key: [redacted]")

      const persisted = JSON.parse(await readFile(join(root, ".anybox-cinema", "canvas.json"), "utf8")) as CinemaCanvasDocument
      const imageNode = persisted.nodes.find((node) => node.id === "image-gen")
      expect(imageNode?.data?.resultAssets).toEqual(oldAssets)
      expect(imageNode?.data?.selectedAssetID).toBe("old-image")
      expect(imageNode?.data?.status).toBe("failed")
      expect(String(imageNode?.data?.error ?? "")).toContain("Provider rejected request")
      expect(String(imageNode?.data?.error ?? "")).not.toContain("sk-test-secret")
    } finally {
      restoreImageRuntime()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rejects image generation when no image model is available", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const restoreImageRuntime = setCinemaImageRuntimeDependenciesForTest({
      listModels: async () => [],
      resolveSelection: async () => ({
        model: undefined,
        small_model: undefined,
        image_model: undefined,
        reasoning_effort: undefined,
      }),
      resolveEffectiveModel: async () => null,
      getImageGenerationSettings: async () => ({}),
    })

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root, createCanvasWithImageNode())

      const response = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/image-generations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nodeID: "image-gen",
          prompt: "Generate image.",
        }),
      })
      const body = await readJson(response)

      expect(response.status).toBe(400)
      expect(body.error?.code).toBe("CINEMA_IMAGE_MODEL_NOT_AVAILABLE")
    } finally {
      restoreImageRuntime()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("project image asset previews reject unsafe or non-image paths", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root, createCanvasWithImageNode())
      await mkdir(join(root, "generated", "images", "image-gen"), { recursive: true })
      await writeFile(join(root, "generated", "images", "image-gen", "note.txt"), "not an image", "utf8")

      const traversalResponse = await app.request(
        `http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/assets/%252E%252E/package.json`,
      )
      const traversalBody = await readJson(traversalResponse)
      expect(traversalResponse.status).toBe(400)
      expect(traversalBody.error?.code).toBe("CINEMA_ASSET_PATH_INVALID")

      const textResponse = await app.request(
        `http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/assets/generated/images/image-gen/note.txt`,
      )
      const textBody = await readJson(textResponse)
      expect(textResponse.status).toBe(415)
      expect(textBody.error?.code).toBe("CINEMA_ASSET_MIME_UNSUPPORTED")

      const uninitializedRoot = await createTempProjectRoot()
      try {
        const uninitializedProject = await createProject(app, uninitializedRoot)
        const uninitializedResponse = await app.request(
          `http://localhost/api/cinema/projects/${encodeURIComponent(uninitializedProject.id)}/assets/generated/images/image-gen/out.png`,
        )
        const uninitializedBody = await readJson(uninitializedResponse)
        expect(uninitializedResponse.status).toBe(404)
        expect(uninitializedBody.error?.code).toBe("CINEMA_PROJECT_NOT_INITIALIZED")
      } finally {
        await rm(uninitializedRoot, { recursive: true, force: true })
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("returns a clear error when the text model runtime fails", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const publicTextModel = createPublicTextModel()
    const restoreTextRuntime = setCinemaTextRuntimeDependenciesForTest({
      listModels: async () => [publicTextModel],
      resolveSelection: async () => ({
        model: "deepseek/deepseek-chat",
        small_model: undefined,
        image_model: undefined,
        reasoning_effort: undefined,
      }),
      resolveEffectiveModel: async () => publicTextModel,
      getModel: async () => testDeepSeekModel,
      getLanguage: async (model) => model as never,
      getGenerateText: async () => (async () => {
        throw new Error("Provider rejected request with Authorization: Bearer test-secret-token")
      }) as never,
    })

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root)

      const response = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/text-generations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nodeID: "story-brief",
          prompt: "Generate text.",
          writeMode: "append",
        }),
      })
      const body = await readJson(response)

      expect(response.status).toBe(502)
      expect(body.error?.code).toBe("CINEMA_TEXT_GENERATION_FAILED")
      expect(body.error?.message).toContain("Provider rejected request")
      expect(body.error?.message).not.toContain("test-secret-token")
      expect(body.error?.message).toContain("Bearer [redacted]")
    } finally {
      restoreTextRuntime()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rejects invalid cinema commands without changing the canvas", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root)

      const invalidPayloadResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "update-node",
          nodeID: "story-brief",
          patch: {},
        }),
      })
      const invalidPayloadBody = await readJson(invalidPayloadResponse)

      expect(invalidPayloadResponse.status).toBe(400)
      expect(invalidPayloadBody.success).toBe(false)
      expect(invalidPayloadBody.error?.code).toBe("INVALID_PAYLOAD")

      const missingNodeResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "connect-nodes",
          edge: {
            id: "edge-missing-story",
            source: "missing-node",
            target: "story-brief",
          },
        }),
      })
      const missingNodeBody = await readJson(missingNodeResponse)

      expect(missingNodeResponse.status).toBe(404)
      expect(missingNodeBody.error?.code).toBe("CINEMA_NODE_NOT_FOUND")

      const persisted = JSON.parse(await readFile(join(root, ".anybox-cinema", "canvas.json"), "utf8")) as CinemaCanvasDocument
      expect(persisted.edges.map((edge) => edge.id)).not.toContain("edge-missing-story")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rejects invalid project ids and invalid canvas payloads", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root)

      const missingResponse = await app.request("http://localhost/api/cinema/projects/prj_missing/canvas")
      expect(missingResponse.status).toBe(404)

      const invalidPayloadResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/canvas`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ schemaVersion: 1, canvasType: "node-canvas", nodes: [] }),
      })
      const invalidPayloadBody = await readJson(invalidPayloadResponse)

      expect(invalidPayloadResponse.status).toBe(400)
      expect(invalidPayloadBody.success).toBe(false)
      expect(invalidPayloadBody.error?.code).toBe("INVALID_PAYLOAD")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("exposes cinema video providers and API key auth state", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root)

      const globalProvidersResponse = await app.request("http://localhost/api/cinema/video-providers")
      const globalProvidersBody = await readJson<CinemaVideoProvider[]>(globalProvidersResponse)

      expect(globalProvidersResponse.status).toBe(200)
      expect(globalProvidersBody.data?.map((provider) => provider.manifest.id)).toEqual(["kling"])
      expect(globalProvidersBody.data?.[0]?.runtime?.baseURL).toBe("https://api-singapore.klingai.com")
      expect(globalProvidersBody.data?.[0]?.runtime?.baseURLSource).toBe("default")

      const providersResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/video-providers`)
      const providersBody = await readJson<CinemaVideoProvider[]>(providersResponse)

      expect(providersResponse.status).toBe(200)
      expect(providersBody.data?.map((provider) => provider.manifest.id)).toEqual(["kling"])
      expect(providersBody.data?.[0]?.runtime?.baseURL).toBe("https://api-singapore.klingai.com")
      expect(providersBody.data?.[0]?.runtime?.baseURLSource).toBe("default")

      const settingsResponse = await app.request("http://localhost/api/cinema/video-providers/kling/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseURL: "https://kling-proxy.example.com/",
        }),
      })
      const settingsBody = await readJson<CinemaVideoProvider>(settingsResponse)

      expect(settingsResponse.status).toBe(200)
      expect(settingsBody.data?.runtime).toMatchObject({
        baseURL: "https://kling-proxy.example.com",
        configuredBaseURL: "https://kling-proxy.example.com",
        baseURLSource: "settings",
      })

      const invalidSettingsResponse = await app.request("http://localhost/api/cinema/video-providers/kling/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseURL: "not-a-url",
        }),
      })
      const invalidSettingsBody = await readJson(invalidSettingsResponse)

      expect(invalidSettingsResponse.status).toBe(400)
      expect(invalidSettingsBody.error?.code).toBe("CINEMA_PROVIDER_BASE_URL_INVALID")

      const clearedSettingsResponse = await app.request("http://localhost/api/cinema/video-providers/kling/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseURL: null,
        }),
      })
      const clearedSettingsBody = await readJson<CinemaVideoProvider>(clearedSettingsResponse)

      expect(clearedSettingsResponse.status).toBe(200)
      expect(clearedSettingsBody.data?.runtime).toMatchObject({
        baseURL: "https://api-singapore.klingai.com",
        baseURLSource: "default",
      })
      expect(clearedSettingsBody.data?.runtime?.configuredBaseURL).toBeUndefined()

      const klingAuthResponse = await app.request("http://localhost/api/cinema/video-providers/kling/auth/api-key")
      const klingAuthBody = await readJson<CinemaVideoProvider["auth"]>(klingAuthResponse)

      expect(klingAuthResponse.status).toBe(200)
      expect(klingAuthBody.data).toMatchObject({
        providerID: "kling",
        credentialProviderID: "cinema-kling",
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rejects removed cinema video providers", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root)

      for (const providerID of ["mock", "fal"]) {
        const authResponse = await app.request(`http://localhost/api/cinema/video-providers/${providerID}/auth/api-key`)
        const authBody = await readJson(authResponse)

        expect(authResponse.status).toBe(404)
        expect(authBody.error?.code).toBe("CINEMA_PROVIDER_NOT_FOUND")

        const createResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            providerID,
            modelID: providerID === "fal" ? "fal-ai/wan-25-preview/text-to-video" : "mock-video",
            mode: "text-to-video",
            prompt: "Removed provider.",
          }),
        })
        const createBody = await readJson(createResponse)

        expect(createResponse.status).toBe(404)
        expect(createBody.error?.code).toBe("CINEMA_PROVIDER_NOT_FOUND")
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rejects generation tasks for uninitialized cinema projects", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()

    try {
      const project = await createProject(app, root)
      const response = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerID: "kling",
          modelID: "kling-3.0-turbo",
          mode: "text-to-video",
          prompt: "A test prompt.",
        }),
      })
      const body = await readJson(response)

      expect(response.status).toBe(404)
      expect(body.error?.code).toBe("CINEMA_PROJECT_NOT_INITIALIZED")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rejects kling generation tasks when the Cinema kling credential is missing", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root)

      const response = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerID: "kling",
          modelID: "kling-3.0-turbo",
          mode: "text-to-video",
          prompt: "This should not call Kling without a key.",
        }),
      })
      const body = await readJson(response)

      expect(response.status).toBe(400)
      expect(body.error?.code).toBe("CINEMA_PROVIDER_NOT_CONNECTED")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("creates kling tasks with a JWT when saved credentials include access and secret keys", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const originalFetch = globalThis.fetch
    const restoreKlingApiKey = setCinemaKlingApiKeyForTest(JSON.stringify({
      accessKey: "test-access-key",
      secretKey: "test-secret-key",
    }))
    let authorization = ""
    let createURL = ""

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      if (url === "https://api-singapore.klingai.com/text-to-video/kling-3.0-turbo") {
        createURL = url
        authorization = new Headers(init?.headers).get("authorization") ?? ""
        return Response.json({
          code: 0,
          request_id: "kling-jwt-request",
          data: {
            id: "kling-jwt-task",
            status: "submitted",
          },
        })
      }
      return await originalFetch(input, init)
    }) as typeof fetch

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root)

      const createResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerID: "kling",
          modelID: "kling-3.0-turbo",
          mode: "text-to-video",
          prompt: "A JWT auth test prompt.",
        }),
      })
      const createBody = await readJson<CinemaGenerationTask>(createResponse)

      expect(createResponse.status).toBe(200)
      expect(createBody.data?.providerTaskRef).toMatchObject({
        taskID: "kling-jwt-task",
        requestID: "kling-jwt-request",
      })
      expect(createURL).toBe("https://api-singapore.klingai.com/text-to-video/kling-3.0-turbo")
      expect(authorization).toStartWith("Bearer ")
      const token = authorization.slice("Bearer ".length)
      expect(token).not.toContain("test-access-key")
      const [, payload] = token.split(".")
      const decodedPayload = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")) as Record<string, unknown>
      expect(decodedPayload.iss).toBe("test-access-key")
      expect(typeof decodedPayload.exp).toBe("number")
      expect(typeof decodedPayload.nbf).toBe("number")
    } finally {
      globalThis.fetch = originalFetch
      restoreKlingApiKey()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("creates and refreshes kling text-to-video generation tasks with an injected client", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const originalFetch = globalThis.fetch
    const restoreKlingApiKey = setCinemaKlingApiKeyForTest("test-kling-key")
    let createRequest: Record<string, unknown> | undefined
    let refreshRequest: Record<string, unknown> | undefined
    const clientBaseURLs: Array<string | undefined> = []

    const restoreKlingClient = setCinemaKlingClientFactoryForTest((apiKey, options) => {
      expect(apiKey).toBe("test-kling-key")
      clientBaseURLs.push(options?.baseURL)
      return {
        createTask: async (input) => {
          createRequest = {
            mode: input.mode,
            path: input.path,
            payload: input.payload,
          }
          return {
            code: 0,
            request_id: "kling-request-1",
            data: {
              id: "kling-task-1",
              status: "submitted",
            },
          }
        },
        refreshTask: async (input) => {
          refreshRequest = {
            taskID: input.taskID,
            tasksPath: input.tasksPath,
          }
          return {
            code: 0,
            data: [
              {
                id: "kling-task-1",
                status: "succeeded",
                result: [
                  {
                    type: "video",
                    url: "https://media.example.test/kling-output.mp4",
                  },
                ],
              },
            ],
          }
        },
      }
    })

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      if (url === "https://media.example.test/kling-output.mp4") {
        return new Response(new Uint8Array([5, 6, 7, 8]), {
          status: 200,
          headers: {
            "content-type": "video/mp4",
          },
        })
      }
      return await originalFetch(input, init)
    }) as typeof fetch

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root)

      const settingsResponse = await app.request("http://localhost/api/cinema/video-providers/kling/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseURL: "https://kling-proxy.example.com",
        }),
      })
      expect(settingsResponse.status).toBe(200)

      const createResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerID: "kling",
          modelID: "kling-3.0-turbo",
          mode: "text-to-video",
          title: "Kling Render",
          prompt: "A Kling test prompt.",
          parameters: {
            duration: 5,
            aspect_ratio: "16:9",
            resolution: "720p",
          },
        }),
      })
      const createBody = await readJson<CinemaGenerationTask>(createResponse)

      expect(createResponse.status).toBe(200)
      expect(createBody.data).toMatchObject({
        providerID: "kling",
        modelID: "kling-3.0-turbo",
        status: "running",
        title: "Kling Render",
      })
      expect(createBody.data?.providerTaskRef).toMatchObject({
        taskID: "kling-task-1",
        requestID: "kling-request-1",
        createPath: "/text-to-video/kling-3.0-turbo",
        tasksPath: "/tasks",
        baseURL: "https://kling-proxy.example.com",
      })
      expect(clientBaseURLs).toEqual(["https://kling-proxy.example.com"])
      expect(createRequest).toMatchObject({
        mode: "text-to-video",
        path: "/text-to-video/kling-3.0-turbo",
        payload: {
          prompt: "A Kling test prompt.",
          settings: {
            duration: 5,
            aspect_ratio: "16:9",
            resolution: "720p",
          },
        },
      })

      const taskID = createBody.data!.id
      const changedSettingsResponse = await app.request("http://localhost/api/cinema/video-providers/kling/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseURL: "https://other-kling-proxy.example.com",
        }),
      })
      expect(changedSettingsResponse.status).toBe(200)

      const refreshResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks/${encodeURIComponent(taskID)}/refresh`, {
        method: "POST",
      })
      const refreshBody = await readJson<CinemaGenerationTask>(refreshResponse)

      expect(refreshResponse.status).toBe(200)
      expect(refreshRequest).toMatchObject({
        taskID: "kling-task-1",
        tasksPath: "/tasks",
      })
      expect(clientBaseURLs).toEqual([
        "https://kling-proxy.example.com",
        "https://kling-proxy.example.com",
      ])
      expect(refreshBody.data?.status).toBe("succeeded")
      expect(refreshBody.data?.outputAssets[0]).toMatchObject({
        kind: "video",
        path: `generated/${taskID}/output-1.mp4`,
        mimeType: "video/mp4",
        sizeBytes: 4,
      })

      const downloaded = await readFile(join(root, "generated", taskID, "output-1.mp4"))
      expect([...downloaded]).toEqual([5, 6, 7, 8])
    } finally {
      try {
        await app.request("http://localhost/api/cinema/video-providers/kling/settings", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ baseURL: null }),
        })
      } catch {
        // Best-effort cleanup for the global test config.
      }
      globalThis.fetch = originalFetch
      restoreKlingClient()
      restoreKlingApiKey()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("builds kling image-to-video tasks from source node URLs", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const restoreKlingApiKey = setCinemaKlingApiKeyForTest("test-kling-key")
    let createRequest: Record<string, unknown> | undefined

    const restoreKlingClient = setCinemaKlingClientFactoryForTest((apiKey) => {
      expect(apiKey).toBe("test-kling-key")
      return {
        createTask: async (input) => {
          createRequest = {
            mode: input.mode,
            path: input.path,
            payload: input.payload,
          }
          return {
            code: 0,
            request_id: "kling-request-i2v",
            data: {
              id: "kling-task-i2v",
              status: "submitted",
            },
          }
        },
        refreshTask: async () => ({
          code: 0,
          data: [],
        }),
      }
    })

    try {
      const project = await createProject(app, root)
      const canvas = createCanvas()
      canvas.nodes.push({
        id: "source-frame",
        type: "image",
        title: "Source Frame",
        position: { x: 980, y: 160 },
        size: { width: 360, height: 220 },
        data: {
          url: "https://cdn.example.test/source-frame.png",
        },
      })
      canvas.nodeTypes.push("image")
      await initializeCinemaProject(root, canvas)

      const createResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerID: "kling",
          modelID: "kling-3.0-turbo",
          mode: "image-to-video",
          title: "Kling Image Render",
          prompt: "Move the camera gently.",
          sourceNodeIDs: ["source-frame"],
          parameters: {
            duration: 5,
            resolution: "720p",
          },
        }),
      })
      const createBody = await readJson<CinemaGenerationTask>(createResponse)

      expect(createResponse.status).toBe(200)
      expect(createBody.data?.providerTaskRef).toMatchObject({
        taskID: "kling-task-i2v",
        createPath: "/image-to-video/kling-3.0-turbo",
      })
      expect(createRequest).toMatchObject({
        mode: "image-to-video",
        path: "/image-to-video/kling-3.0-turbo",
        payload: {
          contents: [
            { type: "prompt", text: "Move the camera gently." },
            { type: "first_frame", url: "https://cdn.example.test/source-frame.png" },
          ],
          settings: {
            duration: 5,
            resolution: "720p",
          },
        },
      })
    } finally {
      restoreKlingClient()
      restoreKlingApiKey()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("returns open link and serves cinema static assets", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const dist = await mkdtemp(join(tmpdir(), "anybox-cinema-web-dist-"))
    const previousDist = process.env.ANYBOX_CINEMA_WEB_DIST
    const previousDevURL = process.env.ANYBOX_CINEMA_WEB_DEV_URL

    process.env.ANYBOX_CINEMA_WEB_DIST = dist
    process.env.ANYBOX_CINEMA_WEB_DEV_URL = "http://127.0.0.1:4175/cinema/"

    try {
      const project = await createProject(app, root)
      await mkdir(join(dist, "assets"), { recursive: true })
      await writeFile(join(dist, "index.html"), "<!doctype html><div id=\"root\"></div>", "utf8")
      await writeFile(join(dist, "assets", "app.js"), "console.log('cinema')", "utf8")

      const linkResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/open-link`, {
        method: "POST",
      })
      const linkBody = await readJson<{ url: string }>(linkResponse)

      expect(linkResponse.status).toBe(200)
      expect(linkBody.data?.url).toStartWith("http://127.0.0.1:4175/cinema/")
      expect(linkBody.data?.url).toContain(`projectID=${encodeURIComponent(project.id)}`)
      expect(linkBody.data?.url).toContain("agentBaseURL=")

      const assetResponse = await app.request("http://localhost/cinema/assets/app.js")
      expect(assetResponse.status).toBe(200)
      expect(await assetResponse.text()).toContain("cinema")

      const fallbackResponse = await app.request("http://localhost/cinema/projects/example")
      expect(fallbackResponse.status).toBe(200)
      expect(await fallbackResponse.text()).toContain("root")

      const traversalResponse = await app.request("http://localhost/cinema/%2e%2e%2fsecret.txt")
      expect(traversalResponse.status).toBe(403)
    } finally {
      if (previousDist === undefined) {
        delete process.env.ANYBOX_CINEMA_WEB_DIST
      } else {
        process.env.ANYBOX_CINEMA_WEB_DIST = previousDist
      }
      if (previousDevURL === undefined) {
        delete process.env.ANYBOX_CINEMA_WEB_DEV_URL
      } else {
        process.env.ANYBOX_CINEMA_WEB_DEV_URL = previousDevURL
      }
      await rm(root, { recursive: true, force: true })
      await rm(dist, { recursive: true, force: true })
    }
  })
})
