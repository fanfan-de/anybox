import { randomUUID } from "node:crypto"
import { appendFile, mkdir, readFile, realpath, stat } from "node:fs/promises"
import path from "node:path"
import * as Global from "#global/global.ts"
import { ApiError } from "#server/error.ts"
import { inspectProjectMigration, migrateProject, type ProjectMigrationStatus } from "../migrations/project-v1.ts"
import { atomicWriteJson, readJsonFile } from "./atomic.ts"

const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export type ProjectInfo = {
  id: string
  name: string
  worktree: string
  directory: string
  lastOpenedAt: string
}

type ProjectRegistry = { schemaVersion: 1; projects: ProjectInfo[] }
type ProjectMetadata = {
  schemaVersion: 1
  runtimeVersion: 1
  projectType: "anybox-for-cinema"
  id: string
  name: string
  createdAt: string
  updatedAt: string
  status: string
  description: string
  language: string
}

const projects = new Map<string, ProjectInfo>()
const pendingMigrations = new Map<string, ProjectInfo>()
let loaded = false

function registryPath() {
  return path.join(Global.Path.state, "projects.json")
}

async function persistRegistry() {
  const registry: ProjectRegistry = {
    schemaVersion: 1,
    projects: [...projects.values()].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt)),
  }
  await atomicWriteJson(registryPath(), registry)
}

export async function initializeProjectRegistry() {
  if (loaded) return
  loaded = true
  const registry = await readJsonFile<ProjectRegistry>(registryPath()).catch(() => ({ schemaVersion: 1 as const, projects: [] }))
  for (const item of registry.projects ?? []) {
    if (item && PROJECT_ID.test(item.id) && path.isAbsolute(item.worktree)) projects.set(item.id, item)
  }
}

export function get(projectID: string) {
  if (pendingMigrations.has(projectID)) return undefined
  return projects.get(projectID)
}

export function getRepositoryRoot(project: ProjectInfo) {
  return project.worktree
}

export async function listRecentProjects() {
  await initializeProjectRegistry()
  return [...projects.values()].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))
}

function cinemaRoot(root: string) {
  return path.join(root, ".anybox-cinema")
}

async function assertDirectory(root: string) {
  const info = await stat(root).catch(() => undefined)
  if (!info?.isDirectory()) throw new ApiError(404, "PROJECT_NOT_FOUND", "Selected project directory was not found.")
}

export async function initializeCinemaProject(rootInput: string) {
  const root = await realpath(path.resolve(rootInput))
  await assertDirectory(root)
  const metadataRoot = cinemaRoot(root)
  const projectFile = path.join(metadataRoot, "project.json")
  const projectFileExists = await stat(projectFile).then((item) => item.isFile()).catch(() => false)
  if (projectFileExists) return await openProjectRoot(root)
  const existing = await readJsonFile<Partial<ProjectMetadata>>(projectFile).catch(() => undefined)
  const now = new Date().toISOString()
  const id = existing?.id && PROJECT_ID.test(existing.id) ? existing.id : `cin_${randomUUID()}`
  const metadata: ProjectMetadata = {
    schemaVersion: 1,
    runtimeVersion: 1,
    projectType: "anybox-for-cinema",
    id,
    name: existing?.name?.trim() || path.basename(root) || id,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    status: existing?.status || "draft",
    description: existing?.description || "",
    language: existing?.language || "",
  }
  await mkdir(metadataRoot, { recursive: true })
  await Promise.all([
    mkdir(path.join(metadataRoot, "tasks"), { recursive: true }),
    mkdir(path.join(metadataRoot, "timelines"), { recursive: true }),
    ...["assets", "references", "prompts", "generated", "renders", "exports"].map((name) => mkdir(path.join(root, name), { recursive: true })),
  ])
  await atomicWriteJson(projectFile, metadata)
  const providersFile = path.join(metadataRoot, "providers.json")
  await stat(providersFile).catch(async () => {
    await atomicWriteJson(providersFile, {
      schemaVersion: 1,
      policy: "bring-your-own-key",
      secretStorage: "cinema-system-keychain",
      providers: [],
    })
  })
  const canvasFile = path.join(metadataRoot, "canvas.json")
  await stat(canvasFile).catch(async () => {
    await atomicWriteJson(canvasFile, {
      schemaVersion: 1,
      canvasType: "node-canvas",
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [],
      edges: [],
      nodeTypes: ["text", "image", "video", "audio"],
    })
  })
  await appendFile(path.join(metadataRoot, "events.jsonl"), `${JSON.stringify({
    time: now,
    type: existing ? "project.repaired" : "project.initialized",
    actor: "cinema-runtime",
    message: existing ? "Cinema project metadata was repaired." : "Cinema project was initialized.",
  })}\n`, "utf8")
  return await openProjectRoot(root)
}

export async function openProjectRoot(rootInput: string) {
  await initializeProjectRegistry()
  const root = await realpath(path.resolve(rootInput))
  await assertDirectory(root)
  const projectFile = path.join(cinemaRoot(root), "project.json")
  const exists = await stat(projectFile).then((item) => item.isFile()).catch(() => false)
  if (!exists) throw new ApiError(409, "PROJECT_INITIALIZATION_REQUIRED", "The selected directory is not a Cinema project.")
  const metadata: Partial<ProjectMetadata> = await readJsonFile<Partial<ProjectMetadata>>(projectFile).catch(() => ({}))
  const metadataID = metadata.id && PROJECT_ID.test(metadata.id) ? metadata.id : undefined
  let id = metadataID ?? `cin_${randomUUID()}`
  const existing = projects.get(id)
  if (existing && path.resolve(existing.worktree) !== path.resolve(root)) {
    const oldExists = await stat(existing.worktree).then((item) => item.isDirectory()).catch(() => false)
    if (oldExists) {
      const cloneProjectID = `cin_${randomUUID()}`
      pendingMigrations.set(cloneProjectID, {
        id: cloneProjectID,
        name: metadata.name?.trim() || path.basename(root) || cloneProjectID,
        worktree: root,
        directory: root,
        lastOpenedAt: new Date().toISOString(),
      })
      throw new ApiError(409, "PROJECT_ID_CONFLICT", `Cinema project id '${id}' is already registered to another directory.`, {
        projectID: id,
        cloneProjectID,
        action: "POST_PROJECT_MIGRATION_TO_CLONE_ID",
      })
    }
  }
  const entry: ProjectInfo = {
    id,
    name: metadata.name?.trim() || path.basename(root) || id,
    worktree: root,
    directory: root,
    lastOpenedAt: new Date().toISOString(),
  }
  const migration = await inspectProjectMigration(root, id)
  if (migration.state === "required" || migration.state === "blocked") {
    projects.delete(id)
    pendingMigrations.set(id, entry)
    throw new ApiError(409, "PROJECT_MIGRATION_REQUIRED", "Cinema project must be migrated before it can be opened.", migration)
  }
  pendingMigrations.delete(id)
  projects.set(entry.id, entry)
  await persistRegistry()
  return entry
}

function migrationTarget(projectID: string) {
  return pendingMigrations.get(projectID) ?? projects.get(projectID)
}

export async function getProjectMigration(projectID: string): Promise<ProjectMigrationStatus> {
  await initializeProjectRegistry()
  const project = migrationTarget(projectID)
  if (!project) throw new ApiError(404, "PROJECT_NOT_FOUND", `Cinema project '${projectID}' was not found.`)
  return await inspectProjectMigration(project.worktree, projectID)
}

export async function runProjectMigration(projectID: string) {
  await initializeProjectRegistry()
  const project = migrationTarget(projectID)
  if (!project) throw new ApiError(404, "PROJECT_NOT_FOUND", `Cinema project '${projectID}' was not found.`)
  const result = await migrateProject(project.worktree, projectID)
  pendingMigrations.delete(projectID)
  const opened = await openProjectRoot(project.worktree)
  return { migration: result, project: opened }
}

export async function openRecentProject(projectID: string) {
  await initializeProjectRegistry()
  const project = projects.get(projectID)
  if (!project) throw new ApiError(404, "PROJECT_NOT_FOUND", `Cinema project '${projectID}' was not found.`)
  return await openProjectRoot(project.worktree)
}

export async function removeRecentProject(projectID: string) {
  await initializeProjectRegistry()
  const removed = projects.delete(projectID)
  if (removed) await persistRegistry()
  return { projectID, removed }
}

export async function registerProjectForTesting(root: string, projectID: string) {
  await initializeProjectRegistry()
  const entry: ProjectInfo = {
    id: projectID,
    name: path.basename(root) || projectID,
    worktree: path.resolve(root),
    directory: path.resolve(root),
    lastOpenedAt: new Date().toISOString(),
  }
  projects.set(projectID, entry)
  return entry
}

export function resetProjectsForTest() {
  projects.clear()
  pendingMigrations.clear()
  loaded = false
}
