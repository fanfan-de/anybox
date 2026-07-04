import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  CinemaCanvasDocumentSchema,
  type CinemaCanvasDocument,
  type CinemaOpenLink,
  type CinemaProjectSummary,
} from "@anybox/shared/cinema"
import { isSshWorkspaceUri } from "@anybox/shared"
import * as Project from "#project/project.ts"
import { ApiError } from "#server/error.ts"
import { getServerBaseURL } from "#server/base-url.ts"
import { getProcessEnvValue } from "#env/compat.ts"

const CINEMA_DIRECTORY = ".anybox-cinema"
const CANVAS_FILE = "canvas.json"
const PROJECT_FILE = "project.json"
const EVENTS_FILE = "events.jsonl"

function safeReadProject(projectID: string) {
  const project = Project.get(projectID)
  if (!project) {
    throw new ApiError(404, "PROJECT_NOT_FOUND", `Project '${projectID}' not found`)
  }
  return project
}

function resolveCinemaRoot(projectID: string) {
  const project = safeReadProject(projectID)
  const root = Project.getRepositoryRoot(project)
  if (isSshWorkspaceUri(root)) {
    throw new ApiError(409, "CINEMA_UNAVAILABLE_FOR_SSH", "Cinema projects are not available for SSH workspaces yet.")
  }

  return {
    project,
    root,
    cinemaRoot: path.join(root, CINEMA_DIRECTORY),
  }
}

async function readOptionalJson(filePath: string) {
  const raw = await readFile(filePath, "utf8").catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null
    throw error
  })
  if (raw === null) return undefined
  return JSON.parse(raw) as Record<string, unknown>
}

async function pathExists(filePath: string) {
  return await stat(filePath)
    .then(() => true)
    .catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false
      throw error
    })
}

function createInvalidJsonError(fileLabel: string, error: unknown) {
  const message = error instanceof Error && error.message.trim() ? error.message : "Invalid JSON"
  return new ApiError(409, "CINEMA_METADATA_INVALID", `${fileLabel} is invalid: ${message}`)
}

export async function getCinemaProject(projectID: string): Promise<CinemaProjectSummary> {
  const { project, root, cinemaRoot } = resolveCinemaRoot(projectID)
  const projectPath = path.join(cinemaRoot, PROJECT_FILE)
  const initialized = await pathExists(projectPath)
  let metadata: Record<string, unknown> | undefined

  if (initialized) {
    try {
      metadata = await readOptionalJson(projectPath)
    } catch (error) {
      throw createInvalidJsonError(PROJECT_FILE, error)
    }
  }

  return {
    projectID: project.id,
    name: project.name?.trim() || path.basename(root) || project.id,
    root,
    initialized,
    metadataPath: path.join(CINEMA_DIRECTORY, PROJECT_FILE),
    ...(metadata ? { project: metadata } : {}),
  }
}

export async function getCinemaCanvas(projectID: string): Promise<CinemaCanvasDocument> {
  const { cinemaRoot } = resolveCinemaRoot(projectID)
  const canvasPath = path.join(cinemaRoot, CANVAS_FILE)

  let raw: string
  try {
    raw = await readFile(canvasPath, "utf8")
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new ApiError(
        404,
        "CINEMA_PROJECT_NOT_INITIALIZED",
        "This project has not been initialized for anybox for cinema yet.",
      )
    }
    throw error
  }

  try {
    return CinemaCanvasDocumentSchema.parse(JSON.parse(raw))
  } catch (error) {
    throw createInvalidJsonError(CANVAS_FILE, error)
  }
}

export async function updateCinemaCanvas(projectID: string, canvas: CinemaCanvasDocument): Promise<CinemaCanvasDocument> {
  const { cinemaRoot } = resolveCinemaRoot(projectID)
  const projectPath = path.join(cinemaRoot, PROJECT_FILE)
  if (!(await pathExists(projectPath))) {
    throw new ApiError(
      404,
      "CINEMA_PROJECT_NOT_INITIALIZED",
      "This project has not been initialized for anybox for cinema yet.",
    )
  }

  const parsed = CinemaCanvasDocumentSchema.parse(canvas)
  await mkdir(cinemaRoot, { recursive: true })

  const canvasPath = path.join(cinemaRoot, CANVAS_FILE)
  const tempPath = path.join(cinemaRoot, `${CANVAS_FILE}.${process.pid}.${Date.now()}.tmp`)
  await writeFile(tempPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8")
  await rename(tempPath, canvasPath)

  await appendFile(
    path.join(cinemaRoot, EVENTS_FILE),
    `${JSON.stringify({
      time: new Date().toISOString(),
      type: "canvas.updated",
      actor: "cinema-web",
      message: "Updated Cinema canvas.",
    })}\n`,
    "utf8",
  )

  return parsed
}

export function getCinemaOpenLink(projectID: string): CinemaOpenLink {
  safeReadProject(projectID)

  const devURL = getProcessEnvValue("ANYBOX_CINEMA_WEB_DEV_URL")?.trim()
  const baseURL = devURL ? new URL(devURL) : new URL("/cinema/", getServerBaseURL())
  baseURL.searchParams.set("projectID", projectID)
  if (devURL) {
    baseURL.searchParams.set("agentBaseURL", getServerBaseURL().toString().replace(/\/$/, ""))
  }

  return {
    url: baseURL.toString(),
  }
}
