import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createServerRuntime } from "#server/server.ts"
import { setServerBaseURL } from "#server/base-url.ts"
import { createProject } from "#server/usecases/projects.ts"

const host = "127.0.0.1"
const port = Number.parseInt(process.env.CINEMA_E2E_AGENT_PORT ?? "4187", 10)
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
const cinemaWebDist = path.resolve(moduleDirectory, "../../../cinema-web/dist")
const projectRoot = await mkdtemp(path.join(tmpdir(), "anybox-cinema-e2e-"))

process.env.ANYBOX_CINEMA_WEB_DIST = cinemaWebDist
process.env.ANYBOX_LOG_PRINT = "false"
process.env.ANYBOX_LOG_FILE = "false"

const runtime = createServerRuntime({
  corsWhitelist: [`http://${host}:${port}`],
})

const project = await createProject({ directory: projectRoot })
const projectID = project.id

function fixtureCanvas() {
  return {
    schemaVersion: 1,
    revision: 0,
    canvasType: "node-canvas",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      {
        id: "story-brief",
        type: "text",
        title: "Story Brief",
        position: { x: 160, y: 180 },
        size: { width: 360, height: 220 },
        data: { text: "A test story brief." },
      },
      {
        id: "director-agent",
        type: "agent",
        title: "Director Agent",
        position: { x: 660, y: 220 },
        size: { width: 360, height: 220 },
        data: { text: "Coordinate shots." },
      },
      {
        id: "second-brief",
        type: "text",
        title: "Second Brief",
        position: { x: 160, y: 520 },
        size: { width: 360, height: 220 },
        data: { text: "A second test story brief." },
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

async function resetFixture() {
  const cinemaRoot = path.join(projectRoot, ".anybox-cinema")
  await mkdir(cinemaRoot, { recursive: true })
  await writeFile(path.join(cinemaRoot, "project.json"), `${JSON.stringify({
    schemaVersion: 1,
    name: "Cinema Reliability E2E",
    createdAt: "2026-07-10T00:00:00.000Z",
  }, null, 2)}\n`, "utf8")
  await writeFile(path.join(cinemaRoot, "canvas.json"), `${JSON.stringify(fixtureCanvas(), null, 2)}\n`, "utf8")
  await writeFile(path.join(cinemaRoot, "events.jsonl"), "", "utf8")
  await writeFile(path.join(cinemaRoot, "tasks.jsonl"), "", "utf8")
}

await resetFixture()

runtime.app.get("/e2e/project", (context) => context.json({
  success: true,
  data: {
    projectID,
    projectRoot,
    cinemaURL: `http://${host}:${port}/cinema/?projectID=${encodeURIComponent(projectID)}&agentBaseURL=${encodeURIComponent(`http://${host}:${port}`)}`,
  },
}))

runtime.app.post("/e2e/reset", async (context) => {
  await resetFixture()
  return context.json({ success: true, data: { projectID } })
})

const server = Bun.serve({
  hostname: host,
  port,
  idleTimeout: 120,
  fetch(request, bunServer) {
    return runtime.app.fetch(request, bunServer)
  },
  websocket: runtime.websocket,
})
setServerBaseURL(`http://${host}:${port}`)

async function shutdown() {
  server.stop(true)
  await rm(projectRoot, { recursive: true, force: true })
  process.exit(0)
}

process.on("SIGINT", () => void shutdown())
process.on("SIGTERM", () => void shutdown())

await new Promise(() => undefined)
