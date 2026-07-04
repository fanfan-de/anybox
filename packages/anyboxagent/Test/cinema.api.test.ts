import { describe, expect, test } from "bun:test"
import "./sqlite.cleanup.ts"
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
