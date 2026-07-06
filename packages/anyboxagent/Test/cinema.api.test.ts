import { describe, expect, test } from "bun:test"
import "./sqlite.cleanup.ts"
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServerApp } from "#server/server.ts"
import {
  setCinemaImageRuntimeDependenciesForTest,
  setCinemaTextRuntimeDependenciesForTest,
  setCinemaVideoProviderAdapterForTest,
  setCinemaVideoProviderCatalogForTest,
} from "#server/usecases/cinema.ts"
import { testDeepSeekModel, type Model, type PublicModel } from "#provider/provider.ts"
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

interface CinemaProjectDirectoryListing {
  projectID: string
  root: string
  path: string
  parentPath: string | null
  entries: Array<{
    name: string
    path: string
    kind: "file" | "directory"
    sizeBytes?: number
    modifiedAt?: string
    mimeType?: string
    previewable: boolean
  }>
  truncated: boolean
}

interface CinemaImportedImageAssetResult {
  asset: {
    id: string
    kind: "image"
    path: string
    mimeType?: string
    sizeBytes?: number
    width?: number
    height?: number
  }
}

interface CinemaVideoProvider {
  manifest: {
    id: string
    name: string
    kind?: string
    authType?: string
    requiresCredential: boolean
    credentialProviderID?: string
    models: Array<{
      id: string
      label?: string
      baseModel?: string
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
    adapterAvailable?: boolean
    adapterID?: string
    supportedModes?: string[]
  }
}

interface ProviderConnectionTestResult {
  providerID: string
  ok: boolean
  status: string
  checkedAt: number
  message: string
  diagnostics?: Record<string, unknown>
}

const TEST_VIDEO_PROVIDER_CATALOG = {
  klingai: {
    id: "klingai",
    name: "KlingAI",
    kind: "native",
    website: "https://klingai.com/",
    doc: "https://kling.ai/document-api/quickStart/productIntroduction/overview",
    regions: ["global"],
    auth_type: "api_key",
    models: {
      "kling-v3": {
        id: "kling-v3",
        catalog_id: "klingai/kling-3.0",
        name: "Kling 3.0",
        family: "Kling",
        lab: "kuaishou",
        base_model: "kuaishou/kling-3.0",
        endpoint_type: "async_polling",
        modalities: {
          input: ["text", "image", "video"],
          output: ["video", "audio"],
        },
        modes: ["text-to-video", "image-to-video", "reference-to-video", "motion-control", "edit"],
        audio_output: true,
        pricing: [{ unit: "unknown", note: "Pricing should be checked against current docs." }],
        limit: {
          durations: [3, 4, 5],
          resolutions: ["720p"],
          aspect_ratios: ["16:9", "9:16", "1:1"],
          max_duration_seconds: 15,
        },
        source_url: "https://kling.ai/document-api/api/get-started/kling-skills",
        source_checked_at: "2026-07-05",
      },
      "kling-image-v3": {
        id: "kling-image-v3",
        catalog_id: "klingai/kling-image-3.0",
        name: "Kling Image 3.0",
        family: "Kling Image",
        lab: "kuaishou",
        base_model: "kuaishou/kling-image-3.0",
        endpoint_type: "async_polling",
        modalities: {
          input: ["text", "image"],
          output: ["image"],
        },
        modes: ["text-to-image", "image-to-image", "image-edit"],
        pricing: [{ unit: "unknown", note: "Pricing should be checked against current docs." }],
        limit: {
          durations: [],
          resolutions: ["720p", "1080p"],
          aspect_ratios: ["16:9", "9:16", "1:1"],
        },
        source_url: "https://kling.ai/document-api/api/get-started/kling-skills",
        source_checked_at: "2026-07-05",
      },
    },
  },
  fal: {
    id: "fal",
    name: "fal",
    kind: "aggregator",
    website: "https://fal.ai/",
    doc: "https://fal.ai/docs",
    regions: ["global"],
    auth_type: "api_key",
    models: {
      "xai/grok-imagine-video/image-to-video": {
        id: "xai/grok-imagine-video/image-to-video",
        catalog_id: "fal/grok-imagine-video",
        name: "Grok Imagine Video",
        family: "Grok Imagine",
        lab: "xai",
        base_model: "xai/grok-imagine-video",
        endpoint_type: "async_polling",
        modalities: {
          input: ["text", "image", "video"],
          output: ["video", "audio"],
        },
        modes: ["image-to-video"],
        audio_output: true,
        pricing: [{ unit: "unknown" }],
        limit: {
          durations: [1, 2, 3],
          resolutions: ["720p"],
          aspect_ratios: ["16:9"],
          max_duration_seconds: 3,
        },
      },
    },
  },
  poe: {
    id: "poe",
    name: "Poe",
    kind: "gateway",
    website: "https://poe.com/",
    doc: "https://creator.poe.com/docs/external-applications/openai-compatible-api",
    regions: ["global"],
    auth_type: "api_key",
    models: {},
  },
}

const TEST_IMAGE_PROVIDER_CATALOG = {
  mockimage: {
    id: "mockimage",
    name: "Mock Image Provider",
    kind: "native",
    regions: ["global"],
    models: {
      "mock-image": {
        id: "mock-image",
        name: "Mock Image",
        family: "Mock Image",
        endpoint_type: "async_polling",
        modalities: {
          input: ["text"],
          output: ["image"],
        },
        modes: ["text-to-image"],
        pricing: [],
      },
      "mock-image-edit": {
        id: "mock-image-edit",
        name: "Mock Image Edit",
        family: "Mock Image",
        endpoint_type: "async_polling",
        modalities: {
          input: ["image"],
          output: ["image"],
        },
        modes: ["image-edit"],
        pricing: [],
      },
    },
  },
  catalogonly: {
    id: "catalogonly",
    name: "Catalog Only Image",
    kind: "native",
    regions: ["global"],
    models: {
      "catalog-image": {
        id: "catalog-image",
        name: "Catalog Image",
        modalities: {
          input: ["text"],
          output: ["image"],
        },
        modes: ["text-to-image"],
        pricing: [],
      },
    },
  },
}

const TEST_IMAGE_INPUT_PROVIDER_CATALOG = {
  mockimageinput: {
    id: "mockimageinput",
    name: "Mock Image Input Provider",
    kind: "native",
    regions: ["global"],
    models: {
      "mock-image-input": {
        id: "mock-image-input",
        name: "Mock Image Input",
        family: "Mock Image",
        endpoint_type: "async_polling",
        modalities: {
          input: ["text", "image"],
          output: ["image"],
        },
        modes: ["text-to-image"],
        pricing: [],
      },
    },
  },
}

const TEST_DUPLICATE_ID_IMAGE_PROVIDER_CATALOG = {
  duplicate: {
    id: "duplicate",
    name: "Duplicate ID Provider",
    kind: "native",
    regions: ["global"],
    models: {
      "shared-video": {
        id: "shared-model",
        name: "Shared Video",
        family: "Shared",
        endpoint_type: "async_polling",
        modalities: {
          input: ["text"],
          output: ["video"],
        },
        modes: ["text-to-video"],
        pricing: [],
      },
      "shared-image": {
        id: "shared-model",
        catalog_id: "duplicate/shared-image",
        name: "Shared Image",
        family: "Shared Image",
        endpoint_type: "async_polling",
        modalities: {
          input: ["text"],
          output: ["image"],
        },
        modes: ["text-to-image"],
        pricing: [],
      },
    },
  },
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
  progress?: {
    phase: string
    percent?: number
    message?: string
    updatedAt?: string
  }
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
  supportsImageInput: boolean
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
  supportsImageInput: boolean
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
  taskID?: string
  status?: string
  assets: CinemaGeneratedAsset[]
}

async function readJson<T>(response: Response) {
  return await response.json() as JsonEnvelope<T>
}

async function waitForCondition(condition: () => Promise<boolean>, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  expect(await condition()).toBe(true)
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

async function clearKlingVideoApiKey(app: ReturnType<typeof createServerApp>, providerID = "klingai") {
  return await app.request(`http://localhost/api/cinema/video-providers/${encodeURIComponent(providerID)}/auth/api-key`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      apiKey: null,
    }),
  })
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

function createPublicVisionTextModel(): Model & PublicModel {
  return {
    ...testDeepSeekModel,
    id: "deepseek-vision",
    name: "DeepSeek Vision",
    providerName: "DeepSeek",
    available: true,
    capabilities: {
      ...testDeepSeekModel.capabilities,
      input: {
        ...testDeepSeekModel.capabilities.input,
        image: true,
      },
      output: {
        ...testDeepSeekModel.capabilities.output,
        text: true,
      },
    },
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

function createCanvasWithVideoNode(overrides: Record<string, unknown> = {}): CinemaCanvasDocument {
  const canvas = createCanvas()
  canvas.nodes.push({
    id: "video-gen",
    type: "video",
    title: "Video Gen",
    position: { x: 920, y: 260 },
    size: { width: 520, height: 430 },
    data: {
      text: "",
      mode: "text-to-video",
      status: "draft",
      parameters: {},
      ...overrides,
    },
  })
  canvas.nodeTypes = ["text", "agent", "video"]
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

function tinyMp4Bytes() {
  return Uint8Array.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
    0x6d, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00,
    0x6d, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6f, 0x6d,
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
      await clearKlingVideoApiKey(app)
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
          supportsImageInput: false,
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

  test("generates text with a source image when the text model supports image input", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const publicTextModel = createPublicVisionTextModel()
    let seenInput: any = null
    const restoreTextRuntime = setCinemaTextRuntimeDependenciesForTest({
      listModels: async () => [publicTextModel],
      resolveSelection: async () => ({
        model: "deepseek/deepseek-vision",
        small_model: undefined,
        image_model: undefined,
        reasoning_effort: undefined,
      }),
      resolveEffectiveModel: async () => publicTextModel,
      getModel: async () => publicTextModel,
      getLanguage: async (model) => model as never,
      getGenerateText: async () => (async (input: any) => {
        seenInput = input
        return { text: "Image-aware line." } as any
      }) as never,
    })

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root)
      await mkdir(join(root, "assets"), { recursive: true })
      await writeFile(
        join(root, "assets", "reference.png"),
        Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lwJ0XwAAAABJRU5ErkJggg==", "base64"),
      )
      await writeFile(
        join(root, "assets", "reference-2.png"),
        Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lwJ0XwAAAABJRU5ErkJggg==", "base64"),
      )

      const modelsResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/text-models`)
      const modelsBody = await readJson<CinemaTextModelsResult>(modelsResponse)
      expect(modelsBody.data?.items[0]?.supportsImageInput).toBe(true)

      const response = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/text-generations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nodeID: "story-brief",
          prompt: "Describe the image.",
          model: "deepseek/deepseek-vision",
          sourceImageAssetID: "reference",
          sourceImageAssetIDs: ["reference", "reference-2"],
          sourceImagePath: "assets/reference.png",
          sourceImagePaths: ["assets/reference.png", "assets/reference-2.png"],
          writeMode: "append",
        }),
      })
      const body = await readJson<CinemaTextGenerationResult>(response)

      expect(response.status).toBe(200)
      expect(body.data?.generatedText).toBe("Image-aware line.")
      expect(seenInput?.prompt).toBeUndefined()
      expect(seenInput?.messages?.[0]?.content?.[0]?.type).toBe("text")
      expect(seenInput?.messages?.[0]?.content?.[1]?.type).toBe("image")
      expect(seenInput?.messages?.[0]?.content?.[1]?.mediaType).toBe("image/png")
      expect(seenInput?.messages?.[0]?.content?.[2]?.type).toBe("image")
      expect(seenInput?.messages?.[0]?.content?.[2]?.mediaType).toBe("image/png")
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

  test("lists only generation provider text-to-image models for image nodes", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const restoreCatalog = setCinemaVideoProviderCatalogForTest(TEST_IMAGE_PROVIDER_CATALOG)
    const restoreImageAdapter = setCinemaVideoProviderAdapterForTest("mockimage", {
      manifest: {} as never,
      supportedModes: ["text-to-image"],
      createTask: async ({ task }) => task,
      refreshTask: async ({ task }) => task,
    })

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root, createCanvasWithImageNode())

      const modelsResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/image-models`)
      const modelsBody = await readJson<CinemaImageModelsResult>(modelsResponse)

      expect(modelsResponse.status).toBe(200)
      expect(modelsBody.data?.items).toEqual([
        {
          value: "mockimage/mock-image",
          providerID: "mockimage",
          modelID: "mock-image",
          label: "Mock Image",
          providerLabel: "Mock Image Provider",
          available: true,
          supportsImageInput: false,
        },
      ])
      expect(modelsBody.data?.selection?.image_model).toBeNull()
      expect(modelsBody.data?.effectiveModel?.value).toBe("mockimage/mock-image")
    } finally {
      restoreImageAdapter()
      restoreCatalog()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("creates image generation tasks bound to image nodes without creating an output node", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const restoreCatalog = setCinemaVideoProviderCatalogForTest(TEST_IMAGE_PROVIDER_CATALOG)
    const restoreImageRuntime = setCinemaImageRuntimeDependenciesForTest({
      getImageGenerationSettings: async () => ({
        default_size: "512x512",
        default_count: 2,
      }),
    })
    const restoreImageAdapter = setCinemaVideoProviderAdapterForTest("mockimage", {
      manifest: {} as never,
      supportedModes: ["text-to-image"],
      createTask: async ({ task }) => ({
        ...task,
        status: "queued" as const,
        updatedAt: "2026-07-05T00:00:00.000Z",
        providerTaskRef: {
          providerID: "mockimage",
          taskID: "mock-image-task-1",
          kind: "image-generation",
        },
      }),
      refreshTask: async ({ task }) => task,
    })

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root, createCanvasWithImageNode())

      const generateResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/image-generations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nodeID: "image-gen",
          prompt: "A quiet moonlit frame.",
          model: "mockimage/mock-image",
          size: "512x512",
          count: 2,
          style: "cinematic noir",
        }),
      })
      const generateBody = await readJson<CinemaImageGenerationResult>(generateResponse)

      expect(generateResponse.status).toBe(200)
      expect(generateBody.data?.nodeID).toBe("image-gen")
      expect(generateBody.data?.model).toBe("mockimage/mock-image")
      expect(generateBody.data?.taskID).toBeString()
      expect(generateBody.data?.status).toBe("queued")
      expect(generateBody.data?.assets).toEqual([])

      const task = JSON.parse(await readFile(join(root, ".anybox-cinema", "tasks", `${generateBody.data!.taskID}.json`), "utf8")) as CinemaGenerationTask
      expect(task).toMatchObject({
        providerID: "mockimage",
        modelID: "mock-image",
        mode: "text-to-image",
        taskNodeID: "image-gen",
        status: "queued",
        progress: {
          phase: "queued",
        },
        input: {
          prompt: "A quiet moonlit frame.",
          parameters: {
            size: "512x512",
            count: 2,
            style: "cinematic noir",
          },
        },
      })

      const imageNode = generateBody.data?.canvas.nodes.find((node) => node.id === "image-gen")
      expect(imageNode?.data).toMatchObject({
        prompt: "A quiet moonlit frame.",
        style: "cinematic noir",
        providerID: "mockimage",
        modelID: "mock-image",
        model: "mockimage/mock-image",
        mode: "text-to-image",
        size: "512x512",
        count: 2,
        status: "queued",
        progress: {
          phase: "queued",
        },
        error: null,
      })
      expect(generateBody.data?.canvas.nodes.some((node) => node.id.startsWith("node-video-"))).toBe(false)
      expect(generateBody.data?.canvas.nodes.some((node) => node.title.endsWith("Result"))).toBe(false)
    } finally {
      restoreImageAdapter()
      restoreImageRuntime()
      restoreCatalog()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("creates image generation tasks with source images when the image model supports image input", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const restoreCatalog = setCinemaVideoProviderCatalogForTest(TEST_IMAGE_INPUT_PROVIDER_CATALOG)
    let seenTask: CinemaGenerationTask | null = null
    const restoreImageRuntime = setCinemaImageRuntimeDependenciesForTest({
      getImageGenerationSettings: async () => ({
        default_size: "512x512",
        default_count: 1,
      }),
    })
    const restoreImageAdapter = setCinemaVideoProviderAdapterForTest("mockimageinput", {
      manifest: {} as never,
      supportedModes: ["text-to-image"],
      createTask: async ({ task }) => {
        seenTask = task
        return {
          ...task,
          status: "queued" as const,
          updatedAt: "2026-07-05T00:00:00.000Z",
          providerTaskRef: {
            providerID: "mockimageinput",
            taskID: "mock-image-input-task-1",
            kind: "image-generation",
          },
        }
      },
      refreshTask: async ({ task }) => task,
    })

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root, createCanvasWithImageNode())
      await mkdir(join(root, "assets"), { recursive: true })
      await writeFile(join(root, "assets", "reference.png"), tinyPngBytes())
      await writeFile(join(root, "assets", "reference-2.png"), tinyPngBytes())

      const modelsResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/image-models`)
      const modelsBody = await readJson<CinemaImageModelsResult>(modelsResponse)
      expect(modelsResponse.status).toBe(200)
      expect(modelsBody.data?.items[0]).toMatchObject({
        value: "mockimageinput/mock-image-input",
        supportsImageInput: true,
      })

      const generateResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/image-generations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nodeID: "image-gen",
          prompt: "Storyboard note.\n\nUse the reference image.",
          userPrompt: "Use the reference image.",
          model: "mockimageinput/mock-image-input",
          sourceNodeIDs: ["text-param", "image-ref-node"],
          sourceTextPrompts: ["Storyboard note."],
          sourceImageAssetID: "reference",
          sourceImageAssetIDs: ["reference", "reference-2"],
          sourceImagePath: "assets/reference.png",
          sourceImagePaths: ["assets/reference.png", "assets/reference-2.png"],
        }),
      })
      const generateBody = await readJson<CinemaImageGenerationResult>(generateResponse)

      expect(generateResponse.status).toBe(200)
      const capturedTask = seenTask as CinemaGenerationTask | null
      expect(capturedTask?.input.prompt).toBe("Storyboard note.\n\nUse the reference image.")
      expect(capturedTask?.input.sourceNodeIDs).toEqual(["text-param", "image-ref-node"])
      expect(capturedTask?.input.parameters).toMatchObject({
        userPrompt: "Use the reference image.",
        sourceTextPrompts: ["Storyboard note."],
        sourceImageAssetID: "reference",
        sourceImageAssetIDs: ["reference", "reference-2"],
        sourceImagePath: "assets/reference.png",
        sourceImagePaths: ["assets/reference.png", "assets/reference-2.png"],
      })

      const task = JSON.parse(await readFile(join(root, ".anybox-cinema", "tasks", `${generateBody.data!.taskID}.json`), "utf8")) as CinemaGenerationTask
      expect(task.input.prompt).toBe("Storyboard note.\n\nUse the reference image.")
      expect(task.input.sourceNodeIDs).toEqual(["text-param", "image-ref-node"])
      expect(task.input.parameters).toMatchObject({
        userPrompt: "Use the reference image.",
        sourceTextPrompts: ["Storyboard note."],
        sourceImageAssetID: "reference",
        sourceImageAssetIDs: ["reference", "reference-2"],
        sourceImagePath: "assets/reference.png",
        sourceImagePaths: ["assets/reference.png", "assets/reference-2.png"],
      })

      const imageNode = generateBody.data?.canvas.nodes.find((node) => node.id === "image-gen")
      expect(imageNode?.data).toMatchObject({
        prompt: "Use the reference image.",
        sourceNodeIDs: ["text-param", "image-ref-node"],
        sourceTextPrompts: ["Storyboard note."],
        sourceImageAssetID: "reference",
        sourceImageAssetIDs: ["reference", "reference-2"],
        sourceImagePath: "assets/reference.png",
        sourceImagePaths: ["assets/reference.png", "assets/reference-2.png"],
      })
    } finally {
      restoreImageAdapter()
      restoreImageRuntime()
      restoreCatalog()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rejects image generation source images when the image model does not support image input", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const restoreCatalog = setCinemaVideoProviderCatalogForTest(TEST_IMAGE_PROVIDER_CATALOG)
    const restoreImageRuntime = setCinemaImageRuntimeDependenciesForTest({
      getImageGenerationSettings: async () => ({
        default_size: "512x512",
        default_count: 1,
      }),
    })
    const restoreImageAdapter = setCinemaVideoProviderAdapterForTest("mockimage", {
      manifest: {} as never,
      supportedModes: ["text-to-image"],
      createTask: async ({ task }) => task,
      refreshTask: async ({ task }) => task,
    })

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root, createCanvasWithImageNode())
      await mkdir(join(root, "assets"), { recursive: true })
      await writeFile(join(root, "assets", "reference.png"), tinyPngBytes())

      const response = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/image-generations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nodeID: "image-gen",
          prompt: "Use the reference image.",
          model: "mockimage/mock-image",
          sourceImagePath: "assets/reference.png",
        }),
      })
      const body = await readJson(response)

      expect(response.status).toBe(400)
      expect(body.error?.code).toBe("CINEMA_IMAGE_MODEL_IMAGE_INPUT_NOT_CAPABLE")
    } finally {
      restoreImageAdapter()
      restoreImageRuntime()
      restoreCatalog()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("resolves text-to-image models when catalog entries share a provider model id", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const restoreCatalog = setCinemaVideoProviderCatalogForTest(TEST_DUPLICATE_ID_IMAGE_PROVIDER_CATALOG)
    const restoreImageRuntime = setCinemaImageRuntimeDependenciesForTest({
      getImageGenerationSettings: async () => ({
        default_size: "512x512",
        default_count: 1,
      }),
    })
    const restoreImageAdapter = setCinemaVideoProviderAdapterForTest("duplicate", {
      manifest: {} as never,
      supportedModes: ["text-to-image"],
      createTask: async ({ task }) => ({
        ...task,
        status: "queued" as const,
        updatedAt: "2026-07-05T00:00:00.000Z",
        providerTaskRef: {
          providerID: "duplicate",
          taskID: "duplicate-image-task-1",
          kind: "image-generation",
        },
      }),
      refreshTask: async ({ task }) => task,
    })

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root, createCanvasWithImageNode())

      const modelsResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/image-models`)
      const modelsBody = await readJson<CinemaImageModelsResult>(modelsResponse)

      expect(modelsResponse.status).toBe(200)
      expect(modelsBody.data?.items).toEqual([
        {
          value: "duplicate/shared-model",
          providerID: "duplicate",
          modelID: "shared-model",
          label: "Shared Image",
          providerLabel: "Duplicate ID Provider",
          available: true,
          supportsImageInput: false,
        },
      ])

      const generateResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/image-generations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nodeID: "image-gen",
          prompt: "A warm lantern at dusk.",
          model: "duplicate/shared-model",
        }),
      })
      const generateBody = await readJson<CinemaImageGenerationResult>(generateResponse)

      expect(generateResponse.status).toBe(200)
      expect(generateBody.data?.model).toBe("duplicate/shared-model")
      expect(generateBody.data?.status).toBe("queued")
      const task = JSON.parse(await readFile(join(root, ".anybox-cinema", "tasks", `${generateBody.data!.taskID}.json`), "utf8")) as CinemaGenerationTask
      expect(task).toMatchObject({
        providerID: "duplicate",
        modelID: "shared-model",
        mode: "text-to-image",
        taskNodeID: "image-gen",
      })
    } finally {
      restoreImageAdapter()
      restoreImageRuntime()
      restoreCatalog()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("refreshes image generation tasks into the bound image node", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const restoreCatalog = setCinemaVideoProviderCatalogForTest(TEST_IMAGE_PROVIDER_CATALOG)
    let refreshCount = 0
    const restoreImageAdapter = setCinemaVideoProviderAdapterForTest("mockimage", {
      manifest: {} as never,
      supportedModes: ["text-to-image"],
      createTask: async ({ task }) => ({
        ...task,
        status: "queued" as const,
        providerTaskRef: {
          providerID: "mockimage",
          taskID: "mock-image-task-2",
          kind: "image-generation",
        },
      }),
      refreshTask: async ({ root: projectRoot, task }) => {
        refreshCount += 1
        await mkdir(join(projectRoot, "generated", "images", "image-gen"), { recursive: true })
        await writeFile(join(projectRoot, "generated", "images", "image-gen", "out.png"), tinyPngBytes())
        return {
          ...task,
          status: "succeeded" as const,
          updatedAt: "2026-07-05T00:00:00.000Z",
          outputAssets: [
            {
              id: "mock-image-output-1",
              kind: "image" as const,
              path: "generated/images/image-gen/out.png",
              mimeType: "image/png",
              sizeBytes: tinyPngBytes().byteLength,
              width: 1,
              height: 1,
            },
          ],
          progress: {
            phase: "succeeded" as const,
            percent: 100,
            updatedAt: "2026-07-05T00:00:00.000Z",
          },
          error: null,
        }
      },
    })

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root, createCanvasWithImageNode())

      const createResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/image-generations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nodeID: "image-gen",
          prompt: "A quiet moonlit frame.",
          model: "mockimage/mock-image",
        }),
      })
      const createBody = await readJson<CinemaImageGenerationResult>(createResponse)
      expect(createResponse.status).toBe(200)

      const refreshResponse = await app.request(
        `http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks/${encodeURIComponent(createBody.data!.taskID!)}/refresh`,
        { method: "POST" },
      )
      const refreshBody = await readJson<CinemaGenerationTask>(refreshResponse)

      expect(refreshResponse.status).toBe(200)
      expect(refreshCount).toBe(1)
      expect(refreshBody.data?.status).toBe("succeeded")
      expect(refreshBody.data?.progress).toMatchObject({
        phase: "succeeded",
        percent: 100,
      })
      expect(refreshBody.data?.outputNodeID).toBeUndefined()
      expect(refreshBody.data?.outputAssets[0]).toMatchObject({
        id: "mock-image-output-1",
        kind: "image",
        path: "generated/images/image-gen/out.png",
      })

      const persisted = JSON.parse(await readFile(join(root, ".anybox-cinema", "canvas.json"), "utf8")) as CinemaCanvasDocument
      const imageNode = persisted.nodes.find((node) => node.id === "image-gen")
      expect(imageNode?.data).toMatchObject({
        taskID: createBody.data?.taskID,
        status: "succeeded",
        progress: {
          phase: "succeeded",
          percent: 100,
        },
        selectedAssetID: "mock-image-output-1",
        generatedAt: "2026-07-05T00:00:00.000Z",
      })
      expect(imageNode?.data?.resultAssets).toEqual(refreshBody.data?.outputAssets)
      expect(persisted.nodes.some((node) => node.id.startsWith("node-video-"))).toBe(false)

      const assetResponse = await app.request(
        `http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/assets/${encodeAssetPath("generated/images/image-gen/out.png")}`,
      )
      const assetBytes = new Uint8Array(await assetResponse.arrayBuffer())
      expect(assetResponse.status).toBe(200)
      expect(assetResponse.headers.get("content-type")).toBe("image/png")
      expect(assetBytes.byteLength).toBe(tinyPngBytes().byteLength)
    } finally {
      restoreImageAdapter()
      restoreCatalog()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("image generation failures keep prior image results on the same node", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const restoreCatalog = setCinemaVideoProviderCatalogForTest(TEST_IMAGE_PROVIDER_CATALOG)
    const restoreImageRuntime = setCinemaImageRuntimeDependenciesForTest({
      getImageGenerationSettings: async () => ({}),
    })
    const restoreImageAdapter = setCinemaVideoProviderAdapterForTest("mockimage", {
      manifest: {} as never,
      supportedModes: ["text-to-image"],
      createTask: async () => {
        throw new Error("Provider rejected request with api_key: sk-test-secret")
      },
      refreshTask: async ({ task }) => task,
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
          model: "mockimage/mock-image",
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
      restoreImageAdapter()
      restoreImageRuntime()
      restoreCatalog()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rejects image generation when no image model is available", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const restoreCatalog = setCinemaVideoProviderCatalogForTest(TEST_IMAGE_PROVIDER_CATALOG)

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
      restoreCatalog()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("project asset previews serve images and videos while rejecting unsafe paths", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root, createCanvasWithImageNode())
      const mp4Bytes = tinyMp4Bytes()
      await mkdir(join(root, "generated", "images", "image-gen"), { recursive: true })
      await mkdir(join(root, "generated", "videos", "video-gen"), { recursive: true })
      await writeFile(join(root, "generated", "images", "image-gen", "note.txt"), "not an image", "utf8")
      await writeFile(join(root, "generated", "videos", "video-gen", "out.mp4"), mp4Bytes)

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

      const videoAssetURL = `http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/assets/generated/videos/video-gen/out.mp4`
      const videoResponse = await app.request(videoAssetURL)
      const videoBytes = new Uint8Array(await videoResponse.arrayBuffer())
      expect(videoResponse.status).toBe(200)
      expect(videoResponse.headers.get("content-type")).toBe("video/mp4")
      expect(videoResponse.headers.get("accept-ranges")).toBe("bytes")
      expect(videoResponse.headers.get("content-length")).toBe(String(mp4Bytes.byteLength))
      expect(Array.from(videoBytes)).toEqual(Array.from(mp4Bytes))

      const rangeResponse = await app.request(videoAssetURL, {
        headers: { range: "bytes=4-11" },
      })
      const rangeBytes = new Uint8Array(await rangeResponse.arrayBuffer())
      expect(rangeResponse.status).toBe(206)
      expect(rangeResponse.headers.get("content-type")).toBe("video/mp4")
      expect(rangeResponse.headers.get("accept-ranges")).toBe("bytes")
      expect(rangeResponse.headers.get("content-range")).toBe(`bytes 4-11/${mp4Bytes.byteLength}`)
      expect(rangeResponse.headers.get("content-length")).toBe("8")
      expect(Array.from(rangeBytes)).toEqual(Array.from(mp4Bytes.slice(4, 12)))

      const suffixRangeResponse = await app.request(videoAssetURL, {
        headers: { range: "bytes=-4" },
      })
      const suffixRangeBytes = new Uint8Array(await suffixRangeResponse.arrayBuffer())
      expect(suffixRangeResponse.status).toBe(206)
      expect(suffixRangeResponse.headers.get("content-range")).toBe(`bytes ${mp4Bytes.byteLength - 4}-${mp4Bytes.byteLength - 1}/${mp4Bytes.byteLength}`)
      expect(Array.from(suffixRangeBytes)).toEqual(Array.from(mp4Bytes.slice(-4)))

      const invalidRangeResponse = await app.request(videoAssetURL, {
        headers: { range: "bytes=99-120" },
      })
      const invalidRangeBody = await readJson(invalidRangeResponse)
      expect(invalidRangeResponse.status).toBe(416)
      expect(invalidRangeBody.error?.code).toBe("CINEMA_ASSET_RANGE_NOT_SATISFIABLE")

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

  test("lists project folders while rejecting unsafe directory paths", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root)
      await mkdir(join(root, "generated", "images", "image-gen"), { recursive: true })
      await writeFile(join(root, "generated", "images", "image-gen", "out.png"), tinyPngBytes())
      await writeFile(join(root, "generated", "images", "image-gen", "note.txt"), "notes", "utf8")

      const generatedResponse = await app.request(
        `http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/files?path=generated/images/image-gen`,
      )
      const generatedBody = await readJson<CinemaProjectDirectoryListing>(generatedResponse)
      expect(generatedResponse.status).toBe(200)
      expect(generatedBody.data).toMatchObject({
        projectID: project.id,
        root,
        path: "generated/images/image-gen",
        parentPath: "generated/images",
        truncated: false,
      })
      expect(generatedBody.data?.entries.map((entry) => entry.name)).toEqual(["note.txt", "out.png"])
      expect(generatedBody.data?.entries.find((entry) => entry.name === "out.png")).toMatchObject({
        kind: "file",
        path: "generated/images/image-gen/out.png",
        mimeType: "image/png",
        previewable: true,
      })

      const traversalResponse = await app.request(
        `http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/files?path=${encodeURIComponent("../")}`,
      )
      const traversalBody = await readJson(traversalResponse)
      expect(traversalResponse.status).toBe(400)
      expect(traversalBody.error?.code).toBe("CINEMA_DIRECTORY_PATH_INVALID")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("imports image assets into the project for canvas previews", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root)
      const imageBytes = tinyPngBytes()

      const importResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/assets/imports`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "Logo Mark.png",
          mimeType: "image/png",
          dataBase64: Buffer.from(imageBytes).toString("base64"),
        }),
      })
      const importBody = await readJson<CinemaImportedImageAssetResult>(importResponse)

      expect(importResponse.status).toBe(200)
      expect(importBody.data?.asset).toMatchObject({
        kind: "image",
        mimeType: "image/png",
        sizeBytes: imageBytes.byteLength,
        width: 1,
        height: 1,
      })
      expect(importBody.data?.asset.path).toMatch(/^assets\/imported\/Logo-Mark-import-.+\.png$/)

      const importedFile = await readFile(join(root, ...(importBody.data?.asset.path.split("/") ?? [])))
      expect(Array.from(importedFile)).toEqual(Array.from(imageBytes))

      const previewResponse = await app.request(
        `http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/assets/${encodeAssetPath(importBody.data!.asset.path)}`,
      )
      const previewBytes = new Uint8Array(await previewResponse.arrayBuffer())
      expect(previewResponse.status).toBe(200)
      expect(previewResponse.headers.get("content-type")).toBe("image/png")
      expect(Array.from(previewBytes)).toEqual(Array.from(imageBytes))

      const invalidResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/assets/imports`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "note.txt",
          mimeType: "text/plain",
          dataBase64: Buffer.from("not an image", "utf8").toString("base64"),
        }),
      })
      const invalidBody = await readJson(invalidResponse)
      expect(invalidResponse.status).toBe(415)
      expect(invalidBody.error?.code).toBe("CINEMA_IMAGE_MIME_UNSUPPORTED")
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
    const restoreVideoCatalog = setCinemaVideoProviderCatalogForTest(TEST_VIDEO_PROVIDER_CATALOG)
    const restoreVideoAdapter = setCinemaVideoProviderAdapterForTest("klingai", {
      manifest: {} as never,
      supportedModes: ["text-to-video", "image-to-video", "frames-to-video", "text-to-image"],
      createTask: async ({ task }) => task,
      refreshTask: async ({ task }) => task,
    })

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root)

      const globalProvidersResponse = await app.request("http://localhost/api/cinema/video-providers")
      const globalProvidersBody = await readJson<CinemaVideoProvider[]>(globalProvidersResponse)

      expect(globalProvidersResponse.status).toBe(200)
      expect(globalProvidersBody.data?.map((provider) => provider.manifest.id)).toEqual(["fal", "klingai", "poe"])
      expect(globalProvidersBody.data?.find((provider) => provider.manifest.id === "poe")?.manifest.models).toEqual([])
      expect(globalProvidersBody.data?.find((provider) => provider.manifest.id === "klingai")?.manifest.models[0]).toMatchObject({
        id: "kling-v3",
        label: "Kling 3.0",
        baseModel: "kuaishou/kling-3.0",
        modes: ["text-to-video", "image-to-video", "frames-to-video", "reference-to-video", "motion-control", "edit"],
      })
      expect(globalProvidersBody.data?.find((provider) => provider.manifest.id === "klingai")?.manifest.models[1]).toMatchObject({
        id: "kling-image-v3",
        label: "Kling Image 3.0",
        baseModel: "kuaishou/kling-image-3.0",
        modalities: {
          input: ["text", "image"],
          output: ["image"],
        },
        modes: ["text-to-image", "image-to-image", "image-edit"],
      })
      expect(globalProvidersBody.data?.find((provider) => provider.manifest.id === "klingai")?.runtime).toMatchObject({
        baseURL: "https://api-singapore.klingai.com",
        baseURLSource: "default",
        adapterAvailable: true,
        adapterID: "klingai",
        supportedModes: ["text-to-video", "image-to-video", "frames-to-video", "text-to-image"],
      })
      expect(globalProvidersBody.data?.find((provider) => provider.manifest.id === "fal")?.runtime?.adapterAvailable).toBe(false)

      const providersResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/video-providers`)
      const providersBody = await readJson<CinemaVideoProvider[]>(providersResponse)

      expect(providersResponse.status).toBe(200)
      expect(providersBody.data?.map((provider) => provider.manifest.id)).toEqual(["fal", "klingai", "poe"])
      expect(providersBody.data?.find((provider) => provider.manifest.id === "klingai")?.runtime?.adapterAvailable).toBe(true)

      const settingsResponse = await app.request("http://localhost/api/cinema/video-providers/klingai/settings", {
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
        adapterAvailable: true,
        adapterID: "klingai",
        supportedModes: ["text-to-video", "image-to-video", "frames-to-video", "text-to-image"],
      })

      const invalidSettingsResponse = await app.request("http://localhost/api/cinema/video-providers/klingai/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseURL: "not-a-url",
        }),
      })
      const invalidSettingsBody = await readJson(invalidSettingsResponse)

      expect(invalidSettingsResponse.status).toBe(400)
      expect(invalidSettingsBody.error?.code).toBe("CINEMA_PROVIDER_BASE_URL_INVALID")

      const savedKeyResponse = await app.request("http://localhost/api/cinema/video-providers/klingai/auth/api-key", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiKey: "test-video-key",
        }),
      })
      const savedKeyBody = await readJson<CinemaVideoProvider["auth"]>(savedKeyResponse)

      expect(savedKeyResponse.status).toBe(200)
      expect(savedKeyBody.data).toMatchObject({
        providerID: "klingai",
        credentialProviderID: "cinema-klingai",
        connected: true,
        status: "connected",
      })

      const clearedSettingsResponse = await app.request("http://localhost/api/cinema/video-providers/klingai/settings", {
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
        adapterAvailable: true,
        adapterID: "klingai",
        supportedModes: ["text-to-video", "image-to-video", "frames-to-video", "text-to-image"],
      })

      const klingAuthResponse = await app.request("http://localhost/api/cinema/video-providers/klingai/auth/api-key")
      const klingAuthBody = await readJson<CinemaVideoProvider["auth"]>(klingAuthResponse)

      expect(klingAuthResponse.status).toBe(200)
      expect(klingAuthBody.data).toMatchObject({
        providerID: "klingai",
        credentialProviderID: "cinema-klingai",
      })

      const clearedKeyResponse = await clearKlingVideoApiKey(app)
      expect(clearedKeyResponse.status).toBe(200)
    } finally {
      await clearKlingVideoApiKey(app)
      restoreVideoAdapter()
      restoreVideoCatalog()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("exposes split KlingAI catalog providers with runtime adapters", async () => {
    const app = createServerApp()
    const restoreVideoCatalog = setCinemaVideoProviderCatalogForTest({
      "klingai-cn": {
        ...TEST_VIDEO_PROVIDER_CATALOG.klingai,
        id: "klingai-cn",
        name: "KlingAI China",
        regions: ["cn"],
        base_url: "https://api-beijing.klingai.com",
      },
      "klingai-global": {
        ...TEST_VIDEO_PROVIDER_CATALOG.klingai,
        id: "klingai-global",
        name: "KlingAI Global",
        regions: ["global"],
        base_url: "https://api-singapore.klingai.com",
      },
    })

    try {
      const response = await app.request("http://localhost/api/cinema/video-providers")
      const body = await readJson<CinemaVideoProvider[]>(response)

      expect(response.status).toBe(200)
      expect(body.data?.map((provider) => provider.manifest.id)).toEqual(["klingai-cn", "klingai-global"])
      expect(body.data?.find((provider) => provider.manifest.id === "klingai-cn")?.runtime).toMatchObject({
        baseURL: "https://api-beijing.klingai.com",
        baseURLSource: "default",
        adapterAvailable: true,
        adapterID: "klingai-cn",
        supportedModes: ["text-to-video", "image-to-video", "frames-to-video", "text-to-image"],
      })
      expect(body.data?.find((provider) => provider.manifest.id === "klingai-global")?.runtime).toMatchObject({
        baseURL: "https://api-singapore.klingai.com",
        baseURLSource: "default",
        adapterAvailable: true,
        adapterID: "klingai-global",
        supportedModes: ["text-to-video", "image-to-video", "frames-to-video", "text-to-image"],
      })
    } finally {
      restoreVideoCatalog()
    }
  })

  test("exposes reference-to-video runtime support when the adapter declares it", async () => {
    const app = createServerApp()
    const restoreVideoCatalog = setCinemaVideoProviderCatalogForTest(TEST_VIDEO_PROVIDER_CATALOG)
    const restoreVideoAdapter = setCinemaVideoProviderAdapterForTest("klingai", {
      manifest: {} as never,
      supportedModes: ["text-to-video", "image-to-video", "frames-to-video", "reference-to-video", "text-to-image"],
      createTask: async ({ task }) => task,
      refreshTask: async ({ task }) => task,
    })

    try {
      const response = await app.request("http://localhost/api/cinema/video-providers")
      const body = await readJson<CinemaVideoProvider[]>(response)
      const provider = body.data?.find((item) => item.manifest.id === "klingai")

      expect(response.status).toBe(200)
      expect(provider?.manifest.models.find((model) => model.id === "kling-v3")?.modes).toContain("reference-to-video")
      expect(provider?.runtime).toMatchObject({
        adapterAvailable: true,
        adapterID: "klingai",
        supportedModes: ["text-to-video", "image-to-video", "frames-to-video", "reference-to-video", "text-to-image"],
      })
    } finally {
      restoreVideoAdapter()
      restoreVideoCatalog()
    }
  })

  test("uses legacy KlingAI credentials for split catalog providers", async () => {
    const app = createServerApp()
    const restoreVideoCatalog = setCinemaVideoProviderCatalogForTest({
      ...TEST_VIDEO_PROVIDER_CATALOG,
      "klingai-cn": {
        ...TEST_VIDEO_PROVIDER_CATALOG.klingai,
        id: "klingai-cn",
        name: "KlingAI China",
        regions: ["cn"],
        base_url: "https://api-beijing.klingai.com",
      },
    })

    try {
      const savedKeyResponse = await app.request("http://localhost/api/cinema/video-providers/klingai/auth/api-key", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiKey: "legacy-kling-key",
        }),
      })
      expect(savedKeyResponse.status).toBe(200)

      const authResponse = await app.request("http://localhost/api/cinema/video-providers/klingai-cn/auth/api-key")
      const authBody = await readJson<CinemaVideoProvider["auth"]>(authResponse)

      expect(authResponse.status).toBe(200)
      expect(authBody.data).toMatchObject({
        providerID: "klingai-cn",
        credentialProviderID: "cinema-klingai",
        connected: true,
        status: "connected",
      })
    } finally {
      await clearKlingVideoApiKey(app)
      restoreVideoCatalog()
    }
  })

  test("tests cinema video provider connections with catalog test endpoints", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        if (new URL(request.url).pathname !== "/v1beta/models") {
          return new Response("Not found", { status: 404 })
        }
        if (request.headers.get("authorization") !== "Bearer valid-video-key") {
          return new Response("Unauthorized", { status: 401 })
        }
        return Response.json({ data: [] })
      },
    })
    const restoreVideoCatalog = setCinemaVideoProviderCatalogForTest({
      ...TEST_VIDEO_PROVIDER_CATALOG,
      klingai: {
        ...TEST_VIDEO_PROVIDER_CATALOG.klingai,
        base_url: `${server.url.toString().replace(/\/$/, "")}/v1beta`,
        connection_test: {
          method: "GET",
          path: "/models",
          auth: "bearer",
          headers: {},
          expected_status: [200],
          timeout_ms: 1000,
        },
      },
    })

    try {
      await createProject(app, root)
      await clearKlingVideoApiKey(app)

      const missingKeyResponse = await app.request("http://localhost/api/cinema/video-providers/klingai/test-connection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
      const missingKeyBody = await readJson<ProviderConnectionTestResult>(missingKeyResponse)

      expect(missingKeyResponse.status).toBe(200)
      expect(missingKeyBody.data).toMatchObject({
        providerID: "klingai",
        ok: false,
        status: "not_connected",
      })

      const successResponse = await app.request("http://localhost/api/cinema/video-providers/klingai/test-connection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiKey: "valid-video-key",
        }),
      })
      const successBody = await readJson<ProviderConnectionTestResult>(successResponse)

      expect(successResponse.status).toBe(200)
      expect(successBody.data).toMatchObject({
        providerID: "klingai",
        ok: true,
        status: "working",
      })
      expect(successBody.data?.diagnostics?.status).toBe(200)
      expect(successBody.data?.diagnostics?.url).toBe(`${server.url.toString().replace(/\/$/, "")}/v1beta/models`)

      const invalidKeyResponse = await app.request("http://localhost/api/cinema/video-providers/klingai/test-connection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiKey: "wrong-key",
        }),
      })
      const invalidKeyBody = await readJson<ProviderConnectionTestResult>(invalidKeyResponse)

      expect(invalidKeyResponse.status).toBe(200)
      expect(invalidKeyBody.data).toMatchObject({
        providerID: "klingai",
        ok: false,
        status: "auth_error",
      })

      const unsupportedResponse = await app.request("http://localhost/api/cinema/video-providers/poe/test-connection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
      const unsupportedBody = await readJson<ProviderConnectionTestResult>(unsupportedResponse)

      expect(unsupportedResponse.status).toBe(200)
      expect(unsupportedBody.data).toMatchObject({
        providerID: "poe",
        ok: false,
        status: "unsupported",
      })
    } finally {
      restoreVideoCatalog()
      server.stop(true)
      await rm(root, { recursive: true, force: true })
    }
  })

  test("binds generation tasks to video nodes without creating an extra output node", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const restoreVideoCatalog = setCinemaVideoProviderCatalogForTest(TEST_VIDEO_PROVIDER_CATALOG)
    const restoreVideoAdapter = setCinemaVideoProviderAdapterForTest("klingai", {
      manifest: {} as never,
      createTask: async ({ task }) => ({
        ...task,
        status: "succeeded" as const,
        updatedAt: "2026-07-05T00:00:00.000Z",
        outputAssets: [
          {
            id: "video-asset-1",
            kind: "video" as const,
            path: "generated/videos/video-gen/out.mp4",
            mimeType: "video/mp4",
            sizeBytes: tinyMp4Bytes().byteLength,
          },
        ],
      }),
      refreshTask: async ({ task }) => task,
    })

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root, createCanvasWithVideoNode())

      const response = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerID: "klingai",
          modelID: "kling-v3",
          mode: "text-to-video",
          prompt: "A calm tracking shot.",
          taskNodeID: "video-gen",
          parameters: {
            aspectRatio: "16:9",
            duration: 5,
            resolution: "720p",
          },
        }),
      })
      const body = await readJson<CinemaGenerationTask>(response)

      expect(response.status).toBe(200)
      expect(body.data?.taskNodeID).toBe("video-gen")
      expect(body.data?.outputNodeID).toBeUndefined()

      const persisted = JSON.parse(await readFile(join(root, ".anybox-cinema", "canvas.json"), "utf8")) as CinemaCanvasDocument
      const videoNode = persisted.nodes.find((node) => node.id === "video-gen")
      expect(videoNode?.type).toBe("video")
      expect(videoNode?.data).toMatchObject({
        text: "A calm tracking shot.",
        taskID: body.data?.id,
        providerID: "klingai",
        modelID: "kling-v3",
        mode: "text-to-video",
        status: "succeeded",
      })
      expect(videoNode?.data?.outputAssets).toEqual(body.data?.outputAssets)
      expect(persisted.nodes.some((node) => node.id.startsWith("node-video-"))).toBe(false)
      expect(persisted.edges.some((edge) => edge.source === "video-gen")).toBe(false)
    } finally {
      restoreVideoAdapter()
      restoreVideoCatalog()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("carries reference image parameters for reference-to-video generation tasks", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    let capturedParameters: Record<string, unknown> | undefined
    const restoreVideoCatalog = setCinemaVideoProviderCatalogForTest(TEST_VIDEO_PROVIDER_CATALOG)
    const restoreVideoAdapter = setCinemaVideoProviderAdapterForTest("klingai", {
      manifest: {} as never,
      supportedModes: ["reference-to-video"],
      createTask: async ({ task }) => {
        capturedParameters = task.input.parameters
        return task
      },
      refreshTask: async ({ task }) => task,
    })

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root, createCanvasWithVideoNode())

      const response = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerID: "klingai",
          modelID: "kling-v3",
          mode: "reference-to-video",
          prompt: "Use the reference images for the subject and scene.",
          taskNodeID: "video-gen",
          parameters: {
            aspectRatio: "16:9",
            duration: 5,
            resolution: "720p",
            inputSlots: [
              {
                slot: "referenceImage",
                nodeID: "image-a",
                edgeID: "edge-image-a-video-gen",
                assetID: "reference-a",
                path: "assets/reference-a.png",
              },
              {
                slot: "referenceImage",
                nodeID: "image-b",
                edgeID: "edge-image-b-video-gen",
                assetID: "reference-b",
                path: "assets/reference-b.png",
              },
            ],
            referenceImageAssetID: "reference-a",
            referenceImageAssetIDs: ["reference-a", "reference-b"],
            referenceImagePath: "assets/reference-a.png",
            referenceImagePaths: ["assets/reference-a.png", "assets/reference-b.png"],
            sourceImageAssetID: "legacy-source",
            sourceImagePath: "assets/source.png",
          },
        }),
      })
      const body = await readJson<CinemaGenerationTask>(response)

      expect(response.status).toBe(200)
      expect(body.data?.mode).toBe("reference-to-video")
      expect(capturedParameters).toMatchObject({
        referenceImageAssetID: "reference-a",
        referenceImageAssetIDs: ["reference-a", "reference-b"],
        referenceImagePath: "assets/reference-a.png",
        referenceImagePaths: ["assets/reference-a.png", "assets/reference-b.png"],
        sourceImageAssetID: "legacy-source",
        sourceImagePath: "assets/source.png",
      })
      expect(capturedParameters?.inputSlots).toEqual([
        {
          slot: "referenceImage",
          nodeID: "image-a",
          edgeID: "edge-image-a-video-gen",
          assetID: "reference-a",
          path: "assets/reference-a.png",
        },
        {
          slot: "referenceImage",
          nodeID: "image-b",
          edgeID: "edge-image-b-video-gen",
          assetID: "reference-b",
          path: "assets/reference-b.png",
        },
      ])
      expect(body.data?.input.parameters).toEqual(capturedParameters)
    } finally {
      restoreVideoAdapter()
      restoreVideoCatalog()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("keeps legacy generation task output node behavior when no task node is provided", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const restoreVideoCatalog = setCinemaVideoProviderCatalogForTest(TEST_VIDEO_PROVIDER_CATALOG)
    const restoreVideoAdapter = setCinemaVideoProviderAdapterForTest("klingai", {
      manifest: {} as never,
      createTask: async ({ task }) => ({
        ...task,
        status: "succeeded" as const,
        updatedAt: "2026-07-05T00:00:00.000Z",
        outputAssets: [
          {
            id: "video-asset-1",
            kind: "video" as const,
            path: "generated/videos/task/out.mp4",
            mimeType: "video/mp4",
            sizeBytes: tinyMp4Bytes().byteLength,
          },
        ],
      }),
      refreshTask: async ({ task }) => task,
    })

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root)

      const response = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerID: "klingai",
          modelID: "kling-v3",
          mode: "text-to-video",
          prompt: "Legacy task node.",
        }),
      })
      const body = await readJson<CinemaGenerationTask>(response)

      expect(response.status).toBe(200)
      expect(body.data?.taskNodeID?.startsWith("node-generation-task-")).toBe(true)
      expect(body.data?.outputNodeID?.startsWith("node-video-")).toBe(true)

      const persisted = JSON.parse(await readFile(join(root, ".anybox-cinema", "canvas.json"), "utf8")) as CinemaCanvasDocument
      expect(persisted.nodes.find((node) => node.id === body.data?.taskNodeID)?.type).toBe("generation-task")
      expect(persisted.nodes.find((node) => node.id === body.data?.outputNodeID)?.type).toBe("video")
      expect(persisted.edges.some((edge) => edge.source === body.data?.taskNodeID && edge.target === body.data?.outputNodeID)).toBe(true)
    } finally {
      restoreVideoAdapter()
      restoreVideoCatalog()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("runs KlingAI adapter create, refresh, and output download", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const mp4Bytes = tinyMp4Bytes()
    const previousCallbackBaseURL = process.env.CINEMA_CALLBACK_BASE_URL
    process.env.CINEMA_CALLBACK_BASE_URL = "https://cinema-callback.example.test/"
    let createRequestBody: Record<string, unknown> | undefined
    let createAuthorization = ""
    const providerID = "klingai-cn"
    let server: ReturnType<typeof Bun.serve> | undefined
    server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/v1/videos/text2video" && request.method === "POST") {
          createAuthorization = request.headers.get("authorization") ?? ""
          createRequestBody = await request.json() as Record<string, unknown>
          return Response.json({
            code: 0,
            data: {
              task_id: "kling-task-1",
              task_status: "submitted",
            },
          })
        }

        if (url.pathname === "/v1/videos/text2video/kling-task-1" && request.method === "GET") {
          return Response.json({
            code: 0,
            data: {
              task_id: "kling-task-1",
              task_status: "succeed",
              task_result: {
                videos: [
                  {
                    id: "kling-output-1",
                    url: `${server!.url.toString().replace(/\/$/, "")}/outputs/out.mp4`,
                  },
                ],
              },
            },
          })
        }

        if (url.pathname === "/outputs/out.mp4" && request.method === "GET") {
          return new Response(mp4Bytes, {
            headers: {
              "content-length": String(mp4Bytes.byteLength),
              "content-type": "video/mp4",
            },
          })
        }

        return new Response("Not found", { status: 404 })
      },
    })
    const restoreVideoCatalog = setCinemaVideoProviderCatalogForTest({
      ...TEST_VIDEO_PROVIDER_CATALOG,
      [providerID]: {
        ...TEST_VIDEO_PROVIDER_CATALOG.klingai,
        id: providerID,
        name: "KlingAI China",
        base_url: server.url.toString().replace(/\/$/, ""),
      },
    })

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root, createCanvasWithVideoNode())
      const keyResponse = await app.request(`http://localhost/api/cinema/video-providers/${encodeURIComponent(providerID)}/auth/api-key`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiKey: "Access Key ID: unit-ak\nAccess Key Secret: unit-sk",
        }),
      })
      expect(keyResponse.status).toBe(200)

      const createResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerID,
          modelID: "kling-v3",
          mode: "text-to-video",
          prompt: "A tiny cinematic cat.",
          taskNodeID: "video-gen",
          parameters: {
            aspectRatio: "16:9",
            duration: 3,
            resolution: "720p",
          },
        }),
      })
      const createBody = await readJson<CinemaGenerationTask>(createResponse)

      expect(createResponse.status).toBe(200)
      expect(createBody.data?.status).toBe("queued")
      expect(createBody.data?.providerTaskRef).toMatchObject({
        providerID,
        taskID: "kling-task-1",
        kind: "text2video",
      })
      const callbackRef = createBody.data?.providerTaskRef?.callback as Record<string, unknown> | undefined
      expect(typeof callbackRef?.token).toBe("string")
      expect(String(callbackRef?.url ?? "")).toContain(
        `/api/cinema/projects/${encodeURIComponent(project.id)}/provider-callbacks/${providerID}/${encodeURIComponent(createBody.data!.id)}/`,
      )
      expect(createRequestBody?.callback_url).toBe(callbackRef?.url)
      expect(createAuthorization).toMatch(/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
      const jwtPayload = JSON.parse(Buffer.from(createAuthorization.replace(/^Bearer\s+/, "").split(".")[1]!, "base64url").toString("utf8"))
      expect(jwtPayload.iss).toBe("unit-ak")
      expect(createRequestBody).toMatchObject({
        model_name: "kling-v3",
        prompt: "A tiny cinematic cat.",
        aspect_ratio: "16:9",
        duration: "3",
        mode: "std",
        external_task_id: createBody.data?.id,
      })

      const refreshResponse = await app.request(
        `http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks/${encodeURIComponent(createBody.data!.id)}/refresh`,
        {
          method: "POST",
        },
      )
      const refreshBody = await readJson<CinemaGenerationTask>(refreshResponse)

      expect(refreshResponse.status).toBe(200)
      expect(refreshBody.data?.status).toBe("succeeded")
      expect(refreshBody.data?.outputNodeID).toBeUndefined()
      expect(refreshBody.data?.outputAssets[0]).toMatchObject({
        id: "kling-output-1",
        kind: "video",
        mimeType: "video/mp4",
        sizeBytes: mp4Bytes.byteLength,
      })
      expect(refreshBody.data?.outputAssets[0]?.path).toStartWith("generated/videos/video-gen/")
      expect(Array.from(await readFile(join(root, refreshBody.data!.outputAssets[0]!.path)))).toEqual(Array.from(mp4Bytes))

      const persisted = JSON.parse(await readFile(join(root, ".anybox-cinema", "canvas.json"), "utf8")) as CinemaCanvasDocument
      const videoNode = persisted.nodes.find((node) => node.id === "video-gen")
      expect(videoNode?.data).toMatchObject({
        taskID: createBody.data?.id,
        status: "succeeded",
        outputAssets: refreshBody.data?.outputAssets,
      })
      expect(persisted.nodes.some((node) => node.id.startsWith("node-video-"))).toBe(false)
    } finally {
      if (previousCallbackBaseURL === undefined) {
        delete process.env.CINEMA_CALLBACK_BASE_URL
      } else {
        process.env.CINEMA_CALLBACK_BASE_URL = previousCallbackBaseURL
      }
      await clearKlingVideoApiKey(app, providerID)
      restoreVideoCatalog()
      server.stop(true)
      await rm(root, { recursive: true, force: true })
    }
  })

  test("runs KlingAI adapter for start and end frame video", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    let createRequestBody: Record<string, unknown> | undefined
    const providerID = "klingai-cn"
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/v1/videos/image2video" && request.method === "POST") {
          createRequestBody = await request.json() as Record<string, unknown>
          return Response.json({
            code: 0,
            data: {
              task_id: "kling-frame-task-1",
              task_status: "submitted",
            },
          })
        }

        return new Response("Not found", { status: 404 })
      },
    })
    const restoreVideoCatalog = setCinemaVideoProviderCatalogForTest({
      ...TEST_VIDEO_PROVIDER_CATALOG,
      [providerID]: {
        ...TEST_VIDEO_PROVIDER_CATALOG.klingai,
        id: providerID,
        name: "KlingAI China",
        base_url: server.url.toString().replace(/\/$/, ""),
      },
    })

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root, createCanvasWithVideoNode())
      await mkdir(join(root, "assets"), { recursive: true })
      await writeFile(join(root, "assets", "start.png"), tinyPngBytes())
      await writeFile(join(root, "assets", "end.png"), tinyPngBytes())
      const expectedImage = Buffer.from(tinyPngBytes()).toString("base64")
      const keyResponse = await app.request(`http://localhost/api/cinema/video-providers/${encodeURIComponent(providerID)}/auth/api-key`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiKey: "Access Key ID: unit-ak\nAccess Key Secret: unit-sk",
        }),
      })
      expect(keyResponse.status).toBe(200)

      const createResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerID,
          modelID: "kling-v3",
          mode: "frames-to-video",
          prompt: "Move from morning to night.",
          taskNodeID: "video-gen",
          parameters: {
            aspectRatio: "16:9",
            duration: 5,
            resolution: "720p",
            startFramePath: "assets/start.png",
            endFramePath: "assets/end.png",
          },
        }),
      })
      const createBody = await readJson<CinemaGenerationTask>(createResponse)

      expect(createResponse.status).toBe(200)
      expect(createBody.data?.providerTaskRef).toMatchObject({
        providerID,
        taskID: "kling-frame-task-1",
        kind: "image2video",
      })
      expect(createRequestBody).toMatchObject({
        model_name: "kling-v3",
        prompt: "Move from morning to night.",
        aspect_ratio: "16:9",
        duration: "5",
        mode: "std",
        image: expectedImage,
        image_tail: expectedImage,
        external_task_id: createBody.data?.id,
      })
    } finally {
      await clearKlingVideoApiKey(app, providerID)
      restoreVideoCatalog()
      server.stop(true)
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rejects KlingAI reference-to-video without falling back to text2video", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const requests: Array<{ method: string; pathname: string }> = []
    const providerID = "klingai-cn"
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        requests.push({ method: request.method, pathname: url.pathname })
        return Response.json({
          code: 0,
          data: {
            task_id: "unexpected-kling-task",
            task_status: "submitted",
          },
        })
      },
    })
    const restoreVideoCatalog = setCinemaVideoProviderCatalogForTest({
      ...TEST_VIDEO_PROVIDER_CATALOG,
      [providerID]: {
        ...TEST_VIDEO_PROVIDER_CATALOG.klingai,
        id: providerID,
        name: "KlingAI China",
        base_url: server.url.toString().replace(/\/$/, ""),
      },
    })

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root, createCanvasWithVideoNode())

      const response = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerID,
          modelID: "kling-v3",
          mode: "reference-to-video",
          prompt: "Use two reference images.",
          taskNodeID: "video-gen",
          parameters: {
            referenceImageAssetIDs: ["reference-a", "reference-b"],
            referenceImagePaths: ["assets/reference-a.png", "assets/reference-b.png"],
          },
        }),
      })
      const body = await readJson(response)

      expect(response.status).toBe(400)
      expect(body.error?.code).toBe("CINEMA_PROVIDER_MODE_UNSUPPORTED")
      expect(requests).toEqual([])
    } finally {
      await clearKlingVideoApiKey(app, providerID)
      restoreVideoCatalog()
      server.stop(true)
      await rm(root, { recursive: true, force: true })
    }
  })

  test("accepts provider callbacks and syncs generation progress to the canvas", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const previousCallbackBaseURL = process.env.CINEMA_CALLBACK_BASE_URL
    process.env.CINEMA_CALLBACK_BASE_URL = "https://cinema-callback.example.test/"
    const callbackPayloads: unknown[] = []
    const restoreVideoCatalog = setCinemaVideoProviderCatalogForTest(TEST_VIDEO_PROVIDER_CATALOG)
    const restoreVideoAdapter = setCinemaVideoProviderAdapterForTest("klingai", {
      manifest: {} as never,
      createTask: async ({ task }) => ({
        ...task,
        status: "queued" as const,
        updatedAt: "2026-07-05T00:00:00.000Z",
        providerTaskRef: {
          ...(task.providerTaskRef ?? {}),
          providerID: "klingai",
          taskID: "callback-provider-task-1",
          kind: "text2video",
        },
      }),
      refreshTask: async ({ task }) => task,
      receiveCallback: async ({ task, payload }) => {
        callbackPayloads.push(payload)
        return {
          ...task,
          status: "succeeded" as const,
          updatedAt: "2026-07-05T00:00:01.000Z",
          outputAssets: [
            {
              id: "callback-output-1",
              kind: "video" as const,
              path: "generated/videos/video-gen/callback.mp4",
              mimeType: "video/mp4",
              sizeBytes: tinyMp4Bytes().byteLength,
            },
          ],
          progress: {
            phase: "succeeded" as const,
            percent: 100,
            updatedAt: "2026-07-05T00:00:01.000Z",
          },
          error: null,
        }
      },
    })

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root, createCanvasWithVideoNode())

      const createResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerID: "klingai",
          modelID: "kling-v3",
          mode: "text-to-video",
          prompt: "A callback-lit shot.",
          taskNodeID: "video-gen",
        }),
      })
      const createBody = await readJson<CinemaGenerationTask>(createResponse)
      expect(createResponse.status).toBe(200)
      expect(createBody.data?.status).toBe("queued")

      const callbackRef = createBody.data?.providerTaskRef?.callback as Record<string, unknown> | undefined
      const token = String(callbackRef?.token ?? "")
      expect(token.length).toBeGreaterThan(20)

      const invalidCallbackResponse = await app.request(
        `http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/provider-callbacks/klingai/${encodeURIComponent(createBody.data!.id)}/wrong-token`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task_id: "callback-provider-task-1", task_status: "succeed" }),
        },
      )
      const invalidCallbackBody = await readJson(invalidCallbackResponse)
      expect(invalidCallbackResponse.status).toBe(403)
      expect(invalidCallbackBody.error?.code).toBe("CINEMA_CALLBACK_TOKEN_INVALID")

      const callbackResponse = await app.request(
        `http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/provider-callbacks/klingai/${encodeURIComponent(createBody.data!.id)}/${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task_id: "callback-provider-task-1", task_status: "succeed" }),
        },
      )
      const callbackBody = await readJson<{ accepted: boolean }>(callbackResponse)
      expect(callbackResponse.status).toBe(202)
      expect(callbackBody.data?.accepted).toBe(true)

      await waitForCondition(async () => {
        const task = JSON.parse(await readFile(join(root, ".anybox-cinema", "tasks", `${createBody.data!.id}.json`), "utf8")) as CinemaGenerationTask
        return task.status === "succeeded"
      })

      expect(callbackPayloads).toHaveLength(1)
      const task = JSON.parse(await readFile(join(root, ".anybox-cinema", "tasks", `${createBody.data!.id}.json`), "utf8")) as CinemaGenerationTask
      expect(task.progress).toMatchObject({
        phase: "succeeded",
        percent: 100,
      })
      expect(task.outputAssets[0]).toMatchObject({
        id: "callback-output-1",
        kind: "video",
      })

      const persisted = JSON.parse(await readFile(join(root, ".anybox-cinema", "canvas.json"), "utf8")) as CinemaCanvasDocument
      const videoNode = persisted.nodes.find((node) => node.id === "video-gen")
      expect(videoNode?.data).toMatchObject({
        taskID: createBody.data?.id,
        status: "succeeded",
        progress: {
          phase: "succeeded",
          percent: 100,
        },
        outputAssets: task.outputAssets,
      })
    } finally {
      if (previousCallbackBaseURL === undefined) {
        delete process.env.CINEMA_CALLBACK_BASE_URL
      } else {
        process.env.CINEMA_CALLBACK_BASE_URL = previousCallbackBaseURL
      }
      restoreVideoAdapter()
      restoreVideoCatalog()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rejects missing and catalog-only cinema video providers", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const restoreVideoCatalog = setCinemaVideoProviderCatalogForTest(TEST_VIDEO_PROVIDER_CATALOG)

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root)

      const missingAuthResponse = await app.request("http://localhost/api/cinema/video-providers/mock/auth/api-key")
      const missingAuthBody = await readJson(missingAuthResponse)

      expect(missingAuthResponse.status).toBe(404)
      expect(missingAuthBody.error?.code).toBe("CINEMA_PROVIDER_NOT_FOUND")

      const missingCreateResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerID: "mock",
          modelID: "mock-video",
          mode: "text-to-video",
          prompt: "Missing provider.",
        }),
      })
      const missingCreateBody = await readJson(missingCreateResponse)

      expect(missingCreateResponse.status).toBe(404)
      expect(missingCreateBody.error?.code).toBe("CINEMA_PROVIDER_NOT_FOUND")

      const missingTaskNodeResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerID: "klingai",
          modelID: "kling-v3",
          mode: "text-to-video",
          prompt: "Missing task node.",
          taskNodeID: "missing-video",
        }),
      })
      const missingTaskNodeBody = await readJson(missingTaskNodeResponse)

      expect(missingTaskNodeResponse.status).toBe(404)
      expect(missingTaskNodeBody.error?.code).toBe("CINEMA_NODE_NOT_FOUND")

      const invalidTaskNodeResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerID: "klingai",
          modelID: "kling-v3",
          mode: "text-to-video",
          prompt: "Invalid task node.",
          taskNodeID: "story-brief",
        }),
      })
      const invalidTaskNodeBody = await readJson(invalidTaskNodeResponse)

      expect(invalidTaskNodeResponse.status).toBe(409)
      expect(invalidTaskNodeBody.error?.code).toBe("CINEMA_TASK_NODE_INVALID")

      const catalogOnlyCreateResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerID: "fal",
          modelID: "xai/grok-imagine-video/image-to-video",
          mode: "image-to-video",
          prompt: "Catalog provider without runtime adapter.",
        }),
      })
      const catalogOnlyCreateBody = await readJson(catalogOnlyCreateResponse)

      expect(catalogOnlyCreateResponse.status).toBe(501)
      expect(catalogOnlyCreateBody.error?.code).toBe("CINEMA_PROVIDER_RUNTIME_UNAVAILABLE")
    } finally {
      restoreVideoCatalog()
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rejects generation tasks for uninitialized cinema projects", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const restoreVideoCatalog = setCinemaVideoProviderCatalogForTest(TEST_VIDEO_PROVIDER_CATALOG)

    try {
      const project = await createProject(app, root)
      const response = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerID: "klingai",
          modelID: "kling-v3",
          mode: "text-to-video",
          prompt: "A test prompt.",
        }),
      })
      const body = await readJson(response)

      expect(response.status).toBe(404)
      expect(body.error?.code).toBe("CINEMA_PROJECT_NOT_INITIALIZED")
    } finally {
      restoreVideoCatalog()
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
