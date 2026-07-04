import { describe, expect, test } from "bun:test"
import "./sqlite.cleanup.ts"
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServerApp } from "#server/server.ts"
import {
  setCinemaFalApiKeyForTest,
  setCinemaFalClientFactoryForTest,
  setCinemaKlingApiKeyForTest,
  setCinemaKlingClientFactoryForTest,
} from "#server/usecases/cinema.ts"

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
      expect(globalProvidersBody.data?.map((provider) => provider.manifest.id)).toContain("kling")

      const providersResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/video-providers`)
      const providersBody = await readJson<CinemaVideoProvider[]>(providersResponse)

      expect(providersResponse.status).toBe(200)
      expect(providersBody.data?.map((provider) => provider.manifest.id)).toContain("mock")
      expect(providersBody.data?.map((provider) => provider.manifest.id)).toContain("fal")
      expect(providersBody.data?.map((provider) => provider.manifest.id)).toContain("kling")
      expect(providersBody.data?.find((provider) => provider.manifest.id === "mock")?.auth.connected).toBe(true)

      const authResponse = await app.request("http://localhost/api/cinema/video-providers/fal/auth/api-key")
      const authBody = await readJson<CinemaVideoProvider["auth"]>(authResponse)

      expect(authResponse.status).toBe(200)
      expect(authBody.data).toMatchObject({
        providerID: "fal",
        credentialProviderID: "cinema-fal",
      })

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

  test("rejects generation tasks for uninitialized cinema projects", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()

    try {
      const project = await createProject(app, root)
      const response = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerID: "mock",
          modelID: "mock-video",
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

  test("creates, refreshes, persists, and cancels mock generation tasks", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root)

      const createResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerID: "mock",
          modelID: "mock-video",
          mode: "text-to-video",
          title: "Mock Render",
          prompt: "A quiet test shot.",
          parameters: {
            duration: 4,
            aspect_ratio: "16:9",
          },
        }),
      })
      const createBody = await readJson<CinemaGenerationTask>(createResponse)

      expect(createResponse.status).toBe(200)
      expect(createBody.data).toMatchObject({
        providerID: "mock",
        modelID: "mock-video",
        status: "running",
        title: "Mock Render",
      })
      expect(createBody.data?.taskNodeID).toStartWith("node-generation-task-")

      const taskID = createBody.data!.id
      const refreshResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks/${encodeURIComponent(taskID)}/refresh`, {
        method: "POST",
      })
      const refreshBody = await readJson<CinemaGenerationTask>(refreshResponse)

      expect(refreshResponse.status).toBe(200)
      expect(refreshBody.data?.status).toBe("succeeded")
      expect(refreshBody.data?.outputAssets[0]?.path).toBe(`generated/${taskID}/mock-output.mp4`)

      const persistedTask = JSON.parse(await readFile(join(root, ".anybox-cinema", "tasks", `${taskID}.json`), "utf8")) as CinemaGenerationTask
      expect(persistedTask.status).toBe("succeeded")

      const mockOutput = await readFile(join(root, "generated", taskID, "mock-output.mp4"), "utf8")
      expect(mockOutput).toContain("A quiet test shot.")

      const canvas = JSON.parse(await readFile(join(root, ".anybox-cinema", "canvas.json"), "utf8")) as CinemaCanvasDocument
      expect(canvas.nodes.find((node) => node.id === refreshBody.data?.taskNodeID)?.data?.status).toBe("succeeded")
      expect(canvas.nodes.find((node) => node.id === refreshBody.data?.outputNodeID)?.type).toBe("video")
      expect(canvas.edges.some((edge) => edge.source === refreshBody.data?.taskNodeID && edge.target === refreshBody.data?.outputNodeID)).toBe(true)

      const tasksLog = await readFile(join(root, ".anybox-cinema", "tasks.jsonl"), "utf8")
      expect(tasksLog).toContain("generation-task.created")
      expect(tasksLog).toContain("generation-task.refreshed")

      const cancelCreateResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerID: "mock",
          modelID: "mock-video",
          mode: "text-to-video",
          title: "Cancel Me",
          prompt: "Cancel this task.",
        }),
      })
      const cancelCreateBody = await readJson<CinemaGenerationTask>(cancelCreateResponse)
      const cancelResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks/${encodeURIComponent(cancelCreateBody.data!.id)}/cancel`, {
        method: "POST",
      })
      const cancelBody = await readJson<CinemaGenerationTask>(cancelResponse)

      expect(cancelResponse.status).toBe(200)
      expect(cancelBody.data?.status).toBe("canceled")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rejects fal generation tasks when the Cinema fal credential is missing", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()

    try {
      const project = await createProject(app, root)
      await initializeCinemaProject(root)

      const response = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerID: "fal",
          modelID: "fal-ai/wan-25-preview/text-to-video",
          mode: "text-to-video",
          prompt: "This should not call fal without a key.",
        }),
      })
      const body = await readJson(response)

      expect(response.status).toBe(400)
      expect(body.error?.code).toBe("CINEMA_PROVIDER_NOT_CONNECTED")
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

  test("creates and refreshes kling text-to-video generation tasks with a mocked client", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const originalFetch = globalThis.fetch
    const restoreKlingApiKey = setCinemaKlingApiKeyForTest("test-kling-key")
    let createRequest: Record<string, unknown> | undefined
    let refreshRequest: Record<string, unknown> | undefined

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
      })
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
      const refreshResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks/${encodeURIComponent(taskID)}/refresh`, {
        method: "POST",
      })
      const refreshBody = await readJson<CinemaGenerationTask>(refreshResponse)

      expect(refreshResponse.status).toBe(200)
      expect(refreshRequest).toMatchObject({
        taskID: "kling-task-1",
        tasksPath: "/tasks",
      })
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

  test("creates and refreshes fal generation tasks with a mocked client", async () => {
    const app = createServerApp()
    const root = await createTempProjectRoot()
    const originalFetch = globalThis.fetch
    const restoreFalApiKey = setCinemaFalApiKeyForTest("test-fal-key")
    let submittedEndpoint = ""
    let submittedInput: Record<string, unknown> | undefined
    let statusRequest: Record<string, unknown> | undefined
    let resultRequest: Record<string, unknown> | undefined

    const restoreFalClient = setCinemaFalClientFactoryForTest((apiKey) => {
      expect(apiKey).toBe("test-fal-key")
      return {
        queue: {
          submit: async (endpointID: unknown, options: unknown) => {
            submittedEndpoint = String(endpointID)
            submittedInput = (options as { input?: Record<string, unknown> }).input
            return { request_id: "fal-request-1" }
          },
          status: async (endpointID: unknown, options: unknown) => {
            statusRequest = {
              endpointID: String(endpointID),
              requestId: (options as { requestId?: string }).requestId,
              logs: (options as { logs?: boolean }).logs,
            }
            return { status: "COMPLETED" }
          },
          result: async (endpointID: unknown, options: unknown) => {
            resultRequest = {
              endpointID: String(endpointID),
              requestId: (options as { requestId?: string }).requestId,
            }
            return {
              data: {
                video: {
                  url: "https://media.example.test/fal-output.mp4",
                },
              },
            }
          },
          cancel: async () => undefined,
        },
        storage: {
          upload: async () => "https://storage.example.test/input.png",
        },
      } as never
    })

    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      if (url === "https://media.example.test/fal-output.mp4") {
        return new Response(new Uint8Array([1, 2, 3, 4]), {
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

      const createResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerID: "fal",
          modelID: "fal-ai/wan-25-preview/text-to-video",
          mode: "text-to-video",
          title: "fal Render",
          prompt: "A fal test prompt.",
          parameters: {
            duration: 5,
            aspect_ratio: "16:9",
          },
        }),
      })
      const createBody = await readJson<CinemaGenerationTask>(createResponse)

      expect(createResponse.status).toBe(200)
      expect(createBody.data).toMatchObject({
        providerID: "fal",
        status: "running",
        title: "fal Render",
      })
      expect(createBody.data?.providerTaskRef).toMatchObject({
        endpointID: "fal-ai/wan-25-preview/text-to-video",
        requestID: "fal-request-1",
      })
      expect(submittedEndpoint).toBe("fal-ai/wan-25-preview/text-to-video")
      expect(submittedInput).toMatchObject({
        prompt: "A fal test prompt.",
        duration: 5,
        aspect_ratio: "16:9",
      })

      const taskID = createBody.data!.id
      const refreshResponse = await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/generation-tasks/${encodeURIComponent(taskID)}/refresh`, {
        method: "POST",
      })
      const refreshBody = await readJson<CinemaGenerationTask>(refreshResponse)

      expect(refreshResponse.status).toBe(200)
      expect(statusRequest).toMatchObject({
        endpointID: "fal-ai/wan-25-preview/text-to-video",
        requestId: "fal-request-1",
        logs: true,
      })
      expect(resultRequest).toMatchObject({
        endpointID: "fal-ai/wan-25-preview/text-to-video",
        requestId: "fal-request-1",
      })
      expect(refreshBody.data?.status).toBe("succeeded")
      expect(refreshBody.data?.outputAssets[0]).toMatchObject({
        kind: "video",
        path: `generated/${taskID}/output-1.mp4`,
        mimeType: "video/mp4",
        sizeBytes: 4,
      })

      const downloaded = await readFile(join(root, "generated", taskID, "output-1.mp4"))
      expect([...downloaded]).toEqual([1, 2, 3, 4])

      const canvas = JSON.parse(await readFile(join(root, ".anybox-cinema", "canvas.json"), "utf8")) as CinemaCanvasDocument
      expect(canvas.nodes.find((node) => node.id === refreshBody.data?.taskNodeID)?.data?.status).toBe("succeeded")
      expect(canvas.nodes.find((node) => node.id === refreshBody.data?.outputNodeID)?.data?.path).toBe(`generated/${taskID}/output-1.mp4`)
    } finally {
      globalThis.fetch = originalFetch
      restoreFalClient()
      restoreFalApiKey()
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
