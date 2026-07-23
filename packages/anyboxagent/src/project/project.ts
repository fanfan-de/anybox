import z from "zod"
import fs from "fs/promises"
import { normalizeComparablePath } from "@anybox/platform"
import {
  containsWorkspaceLocation,
  createSshWorkspaceUri,
  getWorkspaceBasename,
  isSshWorkspaceUri,
  normalizeSshRemotePath,
  parseWorkspaceLocation,
} from "@anybox/shared"
import * as Filesystem from "#util/filesystem.ts"
import path from "path"
import { $ } from "bun"
import * as db from "#database/Sqlite.ts"
import * as Log from "#util/log.ts"
import { fn } from "#util/fn.ts"
import * as BusEvent from "#bus/bus-event.ts"
import { GlobalBus } from "#bus/global.ts"
import { existsSync, realpathSync } from "fs"
import * as Session from "#session/core/session.ts"
import * as Identifier from "#id/id.ts"
import * as Ssh from "#remote/ssh/index.ts"
import * as Worktree from "#project/worktree.ts"

const log = Log.create({ service: "project" })
const ProjectKind = z.enum(["directory", "git"])
const ProjectConfigRecord = z.object({
  projectID: z.string(),
  config: z.record(z.string(), z.any()),
})
let projectTableGeneration = -1

function ensureProjectTable() {
  const generation = db.getDatabaseGeneration()
  if (projectTableGeneration === generation && generation > 0) return
  db.syncTableColumnsWithZodObject("projects", ProjectInfo)
  projectTableGeneration = db.getDatabaseGeneration()
}

export const ProjectInfo = z
  .object({
    id: z.string(),
    kind: ProjectKind.optional(),
    repositoryRoot: z.string().optional(),
    workspaceRoots: z.array(z.string()).optional(),
    worktree: z.string(),
    gitCommonDir: z.string().optional(),
    vcs: z.literal("git").optional(),
    name: z.string().optional(),
    icon: z
      .object({
        url: z.string().optional(),
        override: z.string().optional(),
        color: z.string().optional(),
      })
      .optional(),
    commands: z
      .object({
        start: z.string().optional().describe("Startup script to run when creating a new workspace (worktree)"),
      })
      .optional(),
    created: z.number(),
    updated: z.number(),
    initialized: z.number().optional(),
    sandboxes: z.array(z.string()),
  })
  .meta({
    ref: "Project",
  })
export type ProjectInfo = z.infer<typeof ProjectInfo>

export const Event = {
  Updated: BusEvent.define("project.updated", ProjectInfo),
}

type ResolvedProjectIdentity =
  | {
      kind: "directory"
      sandbox: string
      worktree: string
      vcs: undefined
    }
  | {
      kind: "git"
      sandbox: string
      worktree: string
      gitCommonDir?: string
      storedProjectID?: string
      vcs: "git"
    }

function normalizeProjectPath(input: string) {
  if (isSshWorkspaceUri(input)) {
    const location = parseWorkspaceLocation(input)
    if (location.kind === "ssh") return createSshWorkspaceUri(location.profileID, location.remotePath)
  }

  const resolved = path.resolve(input)
  let realPath = resolved
  try {
    realPath = realpathSync.native(resolved)
  } catch {
    try {
      realPath = realpathSync(resolved)
    } catch {
      realPath = resolved
    }
  }
  const normalized = path.normalize(realPath)
  return normalizeComparablePath(normalized)
}

async function resolveExistingProjectPath(input: string) {
  if (isSshWorkspaceUri(input)) {
    const location = parseWorkspaceLocation(input)
    if (location.kind !== "ssh") return input
    const remotePath = await Ssh.realpath(input).catch(() => location.remotePath)
    return createSshWorkspaceUri(location.profileID, remotePath)
  }

  const resolved = path.resolve(input)
  return fs.realpath(resolved).catch(() => resolved)
}

function resolveProjectKind(project: Pick<ProjectInfo, "kind" | "vcs">) {
  return project.kind === "git" || project.vcs === "git" ? "git" : "directory"
}

function resolveProjectName(worktree: string) {
  if (isSshWorkspaceUri(worktree)) return getWorkspaceBasename(worktree)
  const folderName = worktree.split(/[\\/]/).filter(Boolean).pop()
  return folderName || worktree
}

function resolveStoredProjectName(worktree: string, currentName?: string) {
  const trimmed = currentName?.trim()
  return trimmed || resolveProjectName(worktree)
}

function resolveProjectRepositoryRoot(project: Pick<ProjectInfo, "repositoryRoot" | "worktree">) {
  return project.repositoryRoot?.trim() || project.worktree
}

function isSameProjectPath(left: string, right: string) {
  return normalizeProjectPath(left) === normalizeProjectPath(right)
}

function isPathInsideProject(directory: string, worktree: string) {
  if (isSshWorkspaceUri(directory) || isSshWorkspaceUri(worktree)) {
    return containsWorkspaceLocation(worktree, directory)
  }

  const relative = path.relative(normalizeProjectPath(worktree), normalizeProjectPath(directory))
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function isAdditionalSandboxDirectory(directory: string, worktree: string) {
  if (normalizeProjectPath(directory) === normalizeProjectPath(worktree)) return false
  return !isPathInsideProject(directory, worktree)
}

function uniqueProjectPaths(input: string[]) {
  const unique = new Map<string, string>()

  for (const item of input) {
    if (!item) continue
    unique.set(normalizeProjectPath(item), item)
  }

  return [...unique.values()]
}

function projectRoots(project: ProjectInfo) {
  return uniqueProjectPaths(project.workspaceRoots?.length ? project.workspaceRoots : [
    resolveProjectRepositoryRoot(project),
    ...(project.sandboxes ?? []),
  ])
}

function projectContainsDirectory(project: ProjectInfo, directory: string) {
  return projectRoots(project).some((root) => isPathInsideProject(directory, root))
}

function matchingRootLength(project: ProjectInfo, directory: string) {
  return projectRoots(project)
    .filter((root) => isPathInsideProject(directory, root))
    .map((root) => normalizeProjectPath(root).length)
    .reduce((max, current) => Math.max(max, current), -1)
}

function normalizeProjectRecord(project: ProjectInfo): ProjectInfo {
  const kind = resolveProjectKind(project)
  const repositoryRoot = resolveProjectRepositoryRoot(project)
  const candidateWorkspaceRoots = uniqueProjectPaths([
    repositoryRoot,
    ...(project.workspaceRoots ?? []),
    ...(project.sandboxes ?? []),
  ])
  const workspaceRoots =
    kind === "git"
      ? candidateWorkspaceRoots.filter(
          (item) =>
            isSameProjectPath(item, repositoryRoot) ||
            (
              !isSshWorkspaceUri(item) &&
              !isSshWorkspaceUri(repositoryRoot) &&
              existsSync(item) &&
              isAdditionalSandboxDirectory(item, repositoryRoot)
            ),
        )
      : [repositoryRoot]
  const sandboxes = workspaceRoots.filter((item) => !isSameProjectPath(item, repositoryRoot))

  return {
    ...project,
    kind,
    repositoryRoot,
    workspaceRoots,
    worktree: repositoryRoot,
    gitCommonDir: kind === "git" ? project.gitCommonDir : undefined,
    vcs: kind === "git" ? "git" : undefined,
    name: resolveStoredProjectName(repositoryRoot, project.name),
    sandboxes,
  }
}

function listStoredProjects() {
  return db
    .findManyWithSchema("projects", ProjectInfo)
    .map(normalizeProjectRecord)
    .filter((project) => isGeneratedProjectID(project.id) && getRepositoryRoot(project).trim() !== "/")
}

function findProjectByID(projects: ProjectInfo[], projectID: string | undefined) {
  if (!projectID) return undefined
  return projects.find((project) => project.id === projectID)
}

function findProjectContainingDirectory(projects: ProjectInfo[], directory: string) {
  return projects
    .filter((project) => projectContainsDirectory(project, directory))
    .sort((left, right) => {
      const lengthDelta = matchingRootLength(right, directory) - matchingRootLength(left, directory)
      if (lengthDelta !== 0) return lengthDelta
      return right.updated - left.updated
    })[0]
}

function findProjectByGitCommonDir(projects: ProjectInfo[], gitCommonDir: string | undefined) {
  if (!gitCommonDir) return undefined
  const normalizedGitCommonDir = normalizeProjectPath(gitCommonDir)
  return projects.find((project) => {
    if (!project.gitCommonDir) return false
    return normalizeProjectPath(project.gitCommonDir) === normalizedGitCommonDir
  })
}

function createProjectID() {
  return Identifier.descending("project")
}

function isGeneratedProjectID(value: string | undefined) {
  return Identifier.schema("project").safeParse(value).success
}

function findProjectSeed(input: ResolvedProjectIdentity, projects: ProjectInfo[]) {
  if (input.kind === "git") {
    const byStoredID = findProjectByID(projects, input.storedProjectID)
    if (byStoredID) return byStoredID

    const byCommonDir = findProjectByGitCommonDir(projects, input.gitCommonDir)
    if (byCommonDir) return byCommonDir
  }

  return findProjectContainingDirectory(projects, input.sandbox)
}

function collectMergeCandidates(input: ResolvedProjectIdentity, projects: ProjectInfo[], nextProjectID: string) {
  const candidates = new Map<string, ProjectInfo>()
  const normalizedWorktree = normalizeProjectPath(input.worktree)
  const normalizedSandbox = normalizeProjectPath(input.sandbox)
  const normalizedGitCommonDir = input.kind === "git" && input.gitCommonDir ? normalizeProjectPath(input.gitCommonDir) : null

  for (const project of projects) {
    if (project.id === nextProjectID) {
      candidates.set(project.id, project)
      continue
    }

    const sameWorktree = normalizeProjectPath(project.worktree) === normalizedWorktree
    const sameSandbox = (project.sandboxes ?? []).some((sandbox) => normalizeProjectPath(sandbox) === normalizedSandbox)
    const sameStoredID = input.kind === "git" && input.storedProjectID ? project.id === input.storedProjectID : false
    const sameGitCommonDir =
      normalizedGitCommonDir !== null &&
      project.gitCommonDir &&
      normalizeProjectPath(project.gitCommonDir) === normalizedGitCommonDir

    if (sameWorktree || sameSandbox || sameStoredID || sameGitCommonDir) {
      candidates.set(project.id, project)
    }
  }

  return [...candidates.values()]
}

function migrateProjectConfigReference(fromProjectID: string, toProjectID: string) {
  if (!db.tableExists("project_configs")) return
  if (fromProjectID === toProjectID) return

  const existingTarget = db.findById("project_configs", ProjectConfigRecord, toProjectID, "projectID")
  if (existingTarget) {
    db.deleteById("project_configs", fromProjectID, "projectID")
    return
  }

  db.updateById("project_configs", fromProjectID, { projectID: toProjectID }, "projectID")
}

function migrateProjectReferences(fromProjectID: string, toProjectID: string) {
  if (!fromProjectID || !toProjectID || fromProjectID === toProjectID) return

  if (db.tableExists("sessions")) {
    db.updateMany("sessions", { projectID: toProjectID }, [{ column: "projectID", value: fromProjectID }])
  }

  if (db.tableExists("archived_sessions")) {
    db.updateMany("archived_sessions", { projectID: toProjectID }, [{ column: "projectID", value: fromProjectID }])
  }

  migrateProjectConfigReference(fromProjectID, toProjectID)

  if (db.tableExists("permission_requests")) {
    db.updateMany("permission_requests", { projectID: toProjectID }, [{ column: "projectID", value: fromProjectID }])
  }

  if (db.tableExists("permission_audits")) {
    db.updateMany("permission_audits", { projectID: toProjectID }, [{ column: "projectID", value: fromProjectID }])
  }

  if (db.tableExists("worktrees")) {
    db.updateMany("worktrees", { projectID: toProjectID }, [{ column: "projectID", value: fromProjectID }])
  }
}

function buildProjectRecord(input: ResolvedProjectIdentity, seed?: ProjectInfo) {
  const normalizedSeed = seed ? normalizeProjectRecord(seed) : undefined
  const id =
    normalizedSeed?.id ??
    (input.kind === "git" && isGeneratedProjectID(input.storedProjectID) ? input.storedProjectID : undefined) ??
    createProjectID()
  const now = Date.now()
  const workspaceRoots =
    input.kind === "git"
      ? uniqueProjectPaths([
          input.worktree,
          ...(normalizedSeed?.workspaceRoots ?? []),
          ...(normalizedSeed?.sandboxes ?? []),
          input.sandbox,
        ]).filter(
          (item) =>
            isSameProjectPath(item, input.worktree) ||
            (
              !isSshWorkspaceUri(item) &&
              !isSshWorkspaceUri(input.worktree) &&
              existsSync(item) &&
              isAdditionalSandboxDirectory(item, input.worktree)
            ),
        )
      : [input.worktree]
  const sandboxes = workspaceRoots.filter((item) => !isSameProjectPath(item, input.worktree))

  return normalizeProjectRecord({
    id,
    kind: input.kind,
    repositoryRoot: input.worktree,
    workspaceRoots,
    worktree: input.worktree,
    gitCommonDir: input.kind === "git" ? input.gitCommonDir : undefined,
    vcs: input.vcs,
    name: resolveStoredProjectName(input.worktree, normalizedSeed?.name),
    icon: normalizedSeed?.icon,
    commands: normalizedSeed?.commands,
    created: normalizedSeed?.created ?? now,
    updated: now,
    initialized: normalizedSeed?.initialized,
    sandboxes,
  })
}

function persistProjectRecord(input: ResolvedProjectIdentity) {
  const projects = listStoredProjects()
  const seed = findProjectSeed(input, projects)
  const nextProject = buildProjectRecord(input, seed)
  const mergeCandidates = collectMergeCandidates(input, projects, nextProject.id)

  db.deleteById("projects", nextProject.id)
  db.insertOneWithSchema("projects", nextProject, ProjectInfo)

  for (const project of mergeCandidates) {
    if (project.id === nextProject.id) continue
    migrateProjectReferences(project.id, nextProject.id)
    db.deleteById("projects", project.id)
  }

  Worktree.ensureProjectWorktrees({
    projectID: nextProject.id,
    repositoryRoot: getRepositoryRoot(nextProject),
    workspaceRoots: getWorkspaceRoots(nextProject),
  })

  return nextProject
}

async function resolveGitCommonDir(cwd: string) {
  if (!Bun.which("git")) return undefined

  const value = await $`git rev-parse --git-common-dir`
    .quiet()
    .nothrow()
    .cwd(cwd)
    .text()
    .then((output) => output.trim())
    .catch(() => undefined)

  if (!value) return undefined
  return path.resolve(cwd, value)
}

async function resolveGitTopLevel(cwd: string) {
  if (!Bun.which("git")) return undefined

  const value = await $`git rev-parse --show-toplevel`
    .quiet()
    .nothrow()
    .cwd(cwd)
    .text()
    .then((output) => output.trim())
    .catch(() => undefined)

  if (!value) return undefined
  return path.resolve(cwd, value)
}

async function readStoredGitProjectID(gitCommonDir?: string) {
  if (!gitCommonDir) return undefined

  const cachedID = await Promise.any(
    ["anybox", "opencode"].map((name) =>
      Bun.file(path.join(gitCommonDir, name))
        .text()
        .then((value) => value.trim()),
    ),
  ).catch(() => undefined)

  return isGeneratedProjectID(cachedID) ? cachedID : undefined
}

async function writeStoredGitProjectID(gitCommonDir: string | undefined, projectID: string) {
  if (gitCommonDir && isSshWorkspaceUri(gitCommonDir)) return
  if (!gitCommonDir || !isGeneratedProjectID(projectID)) return
  const markerPath = path.join(gitCommonDir, "anybox")
  const cachedID = await Bun.file(markerPath)
    .text()
    .then((value) => value.trim())
    .catch(() => undefined)
  if (cachedID === projectID) return

  await Bun.file(markerPath).write(projectID).catch(() => undefined)
}

async function resolveRemoteGitTopLevel(profileID: string, remotePath: string) {
  const result = await Ssh.exec(
    profileID,
    remotePath,
    "git rev-parse --show-toplevel 2>/dev/null",
    { timeoutMs: 10_000, maxOutputChars: 16_384 },
  ).catch(() => undefined)
  if (!result || result.exitCode !== 0) return undefined
  const value = result.stdout.trim().split(/\r?\n/).at(-1)?.trim()
  return value ? normalizeSshRemotePath(value) : undefined
}

async function resolveRemoteGitCommonDir(profileID: string, cwd: string) {
  const result = await Ssh.exec(
    profileID,
    cwd,
    "git rev-parse --git-common-dir 2>/dev/null",
    { timeoutMs: 10_000, maxOutputChars: 16_384 },
  ).catch(() => undefined)
  if (!result || result.exitCode !== 0) return undefined
  const value = result.stdout.trim().split(/\r?\n/).at(-1)?.trim()
  if (!value) return undefined
  return normalizeSshRemotePath(value.startsWith("/") ? value : path.posix.join(cwd, value))
}

async function resolveRemoteProjectIdentity(directory: string): Promise<ResolvedProjectIdentity> {
  const location = parseWorkspaceLocation(directory)
  if (location.kind !== "ssh") throw new Error("Expected SSH workspace URI")

  const realRemotePath = await Ssh.realpath(directory).catch(() => location.remotePath)
  const sandboxUri = createSshWorkspaceUri(location.profileID, realRemotePath)
  const gitTopLevel = await resolveRemoteGitTopLevel(location.profileID, realRemotePath)
  if (!gitTopLevel) {
    return {
      kind: "directory",
      sandbox: sandboxUri,
      worktree: sandboxUri,
      vcs: undefined,
    }
  }

  const gitCommonDir = await resolveRemoteGitCommonDir(location.profileID, gitTopLevel)
  const worktreePath = gitCommonDir ? normalizeSshRemotePath(path.posix.join(gitCommonDir, "..")) : gitTopLevel

  return {
    kind: "git",
    sandbox: createSshWorkspaceUri(location.profileID, gitTopLevel),
    worktree: createSshWorkspaceUri(location.profileID, worktreePath),
    gitCommonDir: gitCommonDir ? createSshWorkspaceUri(location.profileID, gitCommonDir) : undefined,
    storedProjectID: undefined,
    vcs: "git",
  }
}

async function resolveProjectIdentity(directory: string): Promise<ResolvedProjectIdentity> {
  if (isSshWorkspaceUri(directory)) return resolveRemoteProjectIdentity(directory)

  const resolvedDirectory = await resolveExistingProjectPath(directory)
  const matches = Filesystem.up({ targets: [".git"], start: resolvedDirectory })
  const gitMarker = await matches.next().then((item) => item.value)
  await matches.return()

  if (!gitMarker) {
    return {
      kind: "directory",
      sandbox: resolvedDirectory,
      worktree: resolvedDirectory,
      vcs: undefined,
    }
  }

  const gitCwd = path.dirname(gitMarker)
  const gitCommonDir = await resolveGitCommonDir(gitCwd)
  const sandbox = (await resolveGitTopLevel(gitCwd)) ?? gitCwd
  const worktree = gitCommonDir ? path.resolve(gitCommonDir, "..") : sandbox
  const storedProjectID = await readStoredGitProjectID(gitCommonDir)

  return {
    kind: "git",
    sandbox,
    worktree,
    gitCommonDir,
    storedProjectID,
    vcs: "git",
  }
}

export async function fromDirectory(directory: string): Promise<{ project: ProjectInfo; sandbox: string }> {
  ensureProjectTable()
  log.info("fromDirectory", { directory })

  const resolved = await resolveProjectIdentity(directory)
  const project = persistProjectRecord(resolved)
  if (resolved.kind === "git") {
    await writeStoredGitProjectID(resolved.gitCommonDir, project.id)
  }

  GlobalBus.emit("event", {
    payload: {
      type: Event.Updated.type,
      properties: project,
    },
  })

  return {
    project,
    sandbox: resolved.sandbox,
  }
}

export async function setInitialized(projectID: string) {
  ensureProjectTable()
  db.updateById("projects", projectID, {
    initialized: Date.now(),
  })
}

async function repairProjects() {
  const candidates = new Map<string, string>()

  for (const project of listStoredProjects()) {
    for (const directory of projectRoots(project)) {
      if (isSshWorkspaceUri(directory)) continue
      if (!directory || !existsSync(directory)) continue
      candidates.set(normalizeProjectPath(directory), directory)
    }
  }

  if (db.tableExists("sessions")) {
    for (const session of db.findManyWithSchema("sessions", Session.SessionInfo)) {
      const directory = session.directory?.trim()
      if (isSshWorkspaceUri(directory)) continue
      if (!directory || !existsSync(directory)) continue
      candidates.set(normalizeProjectPath(directory), directory)
    }
  }

  for (const directory of candidates.values()) {
    await fromDirectory(directory).catch(() => undefined)
  }
}

export async function list() {
  ensureProjectTable()
  await repairProjects()

  const projects = listStoredProjects()
  const normalizedProjects = new Map<string, ProjectInfo>()

  for (const project of projects) {
    const previous = normalizedProjects.get(project.id)
    const nextProject = normalizeProjectRecord({
      ...(previous ?? project),
      ...project,
      updated: Math.max(previous?.updated ?? 0, project.updated),
      workspaceRoots: uniqueProjectPaths([
        ...(previous?.workspaceRoots ?? []),
        ...(project.workspaceRoots ?? []),
        ...(previous?.sandboxes ?? []),
        ...(project.sandboxes ?? []),
      ]),
      sandboxes: uniqueProjectPaths([...(previous?.sandboxes ?? []), ...(project.sandboxes ?? [])]),
    })

    normalizedProjects.set(nextProject.id, nextProject)
  }

  const result = [...normalizedProjects.values()]
  for (const project of result) {
    Worktree.ensureProjectWorktrees({
      projectID: project.id,
      repositoryRoot: getRepositoryRoot(project),
      workspaceRoots: getWorkspaceRoots(project),
    })
  }
  return result
}

export function get(id: string): ProjectInfo | undefined {
  ensureProjectTable()
  const row = db.findById("projects", ProjectInfo, id)
  return row ? normalizeProjectRecord(row) : undefined
}

export function getRepositoryRoot(project: ProjectInfo): string {
  return normalizeProjectRecord(project).repositoryRoot ?? project.worktree
}

export function getWorkspaceRoots(project: ProjectInfo): string[] {
  return normalizeProjectRecord(project).workspaceRoots ?? [getRepositoryRoot(project)]
}

export const update = fn(
  z.object({
    projectID: z.string(),
    name: z.string().optional(),
    icon: ProjectInfo.shape.icon.optional(),
  }),
  async (input) => {
    ensureProjectTable()
    db.updateById("projects", input.projectID, {
      name: input.name ? input.name : null,
      icon: input.icon ? input.icon : null,
      updated: Date.now(),
    })

    const result = get(input.projectID)

    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type,
        properties: result,
      },
    })

    return result
  },
)

export async function sandboxes(projectID: string) {
  ensureProjectTable()
  const project = get(projectID)
  if (!project?.sandboxes) return []

  const valid: string[] = []
  const repositoryRoot = getRepositoryRoot(project)
  for (const directory of project.sandboxes) {
    if (isSshWorkspaceUri(directory) || isSshWorkspaceUri(repositoryRoot)) continue
    const stat = await fs.stat(directory).catch(() => undefined)
    if (stat?.isDirectory() && isAdditionalSandboxDirectory(directory, repositoryRoot)) valid.push(directory)
  }

  return valid
}

export function listWorktrees(projectID: string) {
  ensureProjectTable()
  const project = get(projectID)
  if (!project) return []
  Worktree.ensureProjectWorktrees({
    projectID: project.id,
    repositoryRoot: getRepositoryRoot(project),
    workspaceRoots: getWorkspaceRoots(project),
  })
  return Worktree.listByProject(projectID)
}

export async function refreshWorktrees(projectID: string) {
  listWorktrees(projectID)
  return Worktree.refreshProjectWorktrees(projectID)
}

export async function refreshWorktree(projectID: string, worktreeID: string) {
  listWorktrees(projectID)
  return Worktree.refreshByID(projectID, worktreeID)
}

export function markWorktreeFailed(projectID: string, worktreeID: string) {
  return Worktree.markFailed(projectID, worktreeID)
}

export async function createManagedWorktree(projectID: string, input: {
  baseRef?: string | null
  branch?: string | null
  cleanupPolicy?: Worktree.WorktreeCleanupPolicy
  ownerRunID?: string
  ownerSessionID?: string
  ownerType?: Worktree.WorktreeOwnerType
  sourceDirectory?: string
}) {
  const project = get(projectID)
  if (!project) return null
  return Worktree.createManaged({
    ...input,
    projectID,
    repositoryRoot: getRepositoryRoot(project),
  })
}

export async function removeManagedWorktree(projectID: string, worktreeID: string, input: {
  force?: boolean
  ownerRunID?: string
  ownerSessionID?: string
} = {}) {
  const project = get(projectID)
  if (!project) return null
  return Worktree.removeManaged({
    ...input,
    projectID,
    worktreeID,
    repositoryRoot: getRepositoryRoot(project),
  })
}

export function removeWorktrees(projectID: string) {
  Worktree.removeProjectWorktrees(projectID)
}
