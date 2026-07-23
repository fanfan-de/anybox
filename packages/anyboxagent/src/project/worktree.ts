import { existsSync, realpathSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { normalizeComparablePath } from "@anybox/platform"
import {
  containsWorkspaceLocation,
  createSshWorkspaceUri,
  isSshWorkspaceUri,
  parseWorkspaceLocation,
} from "@anybox/shared"
import z from "zod"
import * as db from "#database/Sqlite.ts"
import { getProcessEnvValue } from "#env/compat.ts"
import * as Identifier from "#id/id.ts"

export const WorktreeKind = z.enum(["primary", "external", "managed"])
export const WorktreeOwnerType = z.enum(["session", "automation-run", "subagent", "manual"])
export const WorktreeStatus = z.enum(["active", "missing", "dirty", "archived", "removing", "removed", "failed"])
export const WorktreeCleanupPolicy = z.enum(["never", "on-session-archive", "on-success-if-clean", "manual"])

export const WorktreeRecord = z.object({
  id: Identifier.schema("worktree"),
  projectID: z.string(),
  path: z.string(),
  sourceDirectory: z.string().optional(),
  workingDirectory: z.string().optional(),
  branch: z.string().nullable().optional(),
  baseRef: z.string().nullable().optional(),
  baseSha: z.string().nullable().optional(),
  kind: WorktreeKind,
  managed: z.boolean(),
  ownerType: WorktreeOwnerType.optional(),
  ownerSessionID: z.string().optional(),
  ownerRunID: z.string().optional(),
  status: WorktreeStatus,
  cleanupPolicy: WorktreeCleanupPolicy,
  createdAt: z.number(),
  updatedAt: z.number(),
  lastSeenAt: z.number().optional(),
})
export type WorktreeRecord = z.output<typeof WorktreeRecord>
export type WorktreeKind = z.output<typeof WorktreeKind>
export type WorktreeOwnerType = z.output<typeof WorktreeOwnerType>
export type WorktreeCleanupPolicy = z.output<typeof WorktreeCleanupPolicy>
export type WorktreeStatus = z.output<typeof WorktreeStatus>

interface GitCommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

interface ManagedWorktreeInput {
  baseRef?: string | null
  branch?: string | null
  cleanupPolicy?: WorktreeCleanupPolicy
  ownerRunID?: string
  ownerSessionID?: string
  ownerType?: WorktreeOwnerType
  projectID: string
  repositoryRoot: string
  sourceDirectory?: string
}

interface RemoveManagedWorktreeInput {
  force?: boolean
  ownerRunID?: string
  ownerSessionID?: string
  projectID: string
  repositoryRoot: string
  worktreeID: string
}

let worktreeTableGeneration = -1

function ensureWorktreeTable() {
  const generation = db.getDatabaseGeneration()
  if (worktreeTableGeneration === generation && generation > 0) return
  db.syncTableColumnsWithZodObject("worktrees", WorktreeRecord)
  worktreeTableGeneration = generation
}

function normalizePath(input: string) {
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

  return normalizeComparablePath(path.normalize(realPath))
}

function sameWorkspacePath(left: string, right: string) {
  return normalizePath(left) === normalizePath(right)
}

function containsPath(root: string, target: string) {
  if (isSshWorkspaceUri(root) || isSshWorkspaceUri(target)) {
    return containsWorkspaceLocation(root, target)
  }

  const relative = path.relative(normalizePath(root), normalizePath(target))
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function inferStatus(worktreePath: string): z.output<typeof WorktreeStatus> {
  if (isSshWorkspaceUri(worktreePath)) return "active"
  return existsSync(worktreePath) ? "active" : "missing"
}

function createWorktreeID() {
  return Identifier.descending("worktree")
}

function listRaw() {
  ensureWorktreeTable()
  return db.findManyWithSchema("worktrees", WorktreeRecord)
}

function saveRecord(record: WorktreeRecord) {
  ensureWorktreeTable()
  const existing = db.findById("worktrees", WorktreeRecord, record.id)
  if (existing) {
    db.updateByIdWithSchema("worktrees", record.id, record, WorktreeRecord)
  } else {
    db.insertOneWithSchema("worktrees", record, WorktreeRecord)
  }

  return record
}

function requireGitBinary() {
  const git = Bun.which(process.platform === "win32" ? "git.exe" : "git") ?? Bun.which("git")
  if (!git) throw new Error("Git is not installed.")
  return git
}

function trimCommandOutput(value: string) {
  return value.replace(/\r\n/g, "\n").trim()
}

async function runGit(args: string[], cwd: string): Promise<GitCommandResult> {
  const normalizedArgs = ["-c", "core.longpaths=true", ...args]
  const proc = Bun.spawn([requireGitBinary(), ...normalizedArgs], {
    cwd,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    stdout: "pipe",
    stderr: "pipe",
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  return {
    stdout: trimCommandOutput(stdout),
    stderr: trimCommandOutput(stderr),
    exitCode,
  }
}

async function runGitOrThrow(args: string[], cwd: string, fallback: string) {
  const result = await runGit(args, cwd)
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || fallback)
  }

  return result
}

function normalizeLocalPath(input: string) {
  return path.resolve(input.trim())
}

function safePathSegment(value: string) {
  const segment = value
    .trim()
    .replace(/[\x00-\x1f<>:"/\\|?*]+/g, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, 90)

  if (!segment) return "worktree"
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(segment)) {
    return `worktree-${segment}`
  }

  return segment
}

function repositoryFolderSegment(repositoryRoot: string) {
  return safePathSegment(path.basename(path.resolve(repositoryRoot)) || "worktree")
}

function managedWorktreeParent(input: { projectID: string; repositoryRoot: string }) {
  const managedDataDir = getProcessEnvValue("ANYBOX_AGENT_DATA_DIR")?.trim()
  if (managedDataDir) {
    return path.join(path.resolve(managedDataDir), "data", "worktrees", input.projectID)
  }

  return path.join(path.dirname(path.resolve(input.repositoryRoot)), ".anybox-worktrees", input.projectID)
}

function requireLocalRepositoryRoot(repositoryRoot: string) {
  if (isSshWorkspaceUri(repositoryRoot)) {
    throw new Error("Managed worktrees are not available for SSH workspaces yet.")
  }

  const trimmed = repositoryRoot.trim()
  if (!trimmed) throw new Error("A repository root is required.")
  return normalizeLocalPath(trimmed)
}

function assertManagedPathAllowed(input: {
  projectID: string
  repositoryRoot: string
  worktreePath: string
}) {
  const parent = managedWorktreeParent(input)
  const target = normalizeLocalPath(input.worktreePath)
  if (!containsPath(parent, target)) {
    throw new Error("Managed worktree path is outside the configured worktree parent.")
  }
}

async function resolveCommitSha(directory: string, ref: string) {
  const result = await runGit(["rev-parse", "--verify", `${ref}^{commit}`], directory)
  return result.exitCode === 0 && result.stdout ? result.stdout : null
}

async function resolveHeadSha(directory: string) {
  return resolveCommitSha(directory, "HEAD")
}

async function resolveCurrentBranch(directory: string) {
  const symbolic = await runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], directory)
  if (symbolic.exitCode === 0 && symbolic.stdout) return symbolic.stdout

  const result = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], directory)
  if (result.exitCode !== 0 || !result.stdout || result.stdout === "HEAD") return null
  return result.stdout
}

async function isDirty(directory: string) {
  const result = await runGit(["status", "--porcelain"], directory)
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || "Failed to inspect worktree status.")
  }

  return Boolean(result.stdout)
}

async function validateBranchName(repositoryRoot: string, branch: string) {
  const result = await runGit(["check-ref-format", "--branch", branch], repositoryRoot)
  if (result.exitCode !== 0) {
    throw new Error("Enter a valid branch name.")
  }
}

async function localBranchExists(repositoryRoot: string, branch: string) {
  const result = await runGit(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], repositoryRoot)
  return result.exitCode === 0
}

async function uniqueManagedTargetPath(parent: string, segment: string) {
  let candidate = path.join(parent, segment)
  for (let suffix = 2; existsSync(candidate); suffix += 1) {
    candidate = path.join(parent, `${segment}-${suffix}`)
  }

  return candidate
}

function buildManagedRecord(input: ManagedWorktreeInput & {
  baseSha?: string | null
  branch: string
  id: string
  path: string
  status: WorktreeStatus
}) {
  const now = Date.now()
  return WorktreeRecord.parse({
    id: input.id,
    projectID: input.projectID,
    path: input.path,
    sourceDirectory: input.sourceDirectory,
    workingDirectory: input.sourceDirectory
      ? path.join(
          input.path,
          path.relative(normalizeLocalPath(input.repositoryRoot), normalizeLocalPath(input.sourceDirectory)),
        )
      : input.path,
    branch: input.branch,
    baseRef: input.baseRef ?? null,
    baseSha: input.baseSha ?? null,
    kind: "managed",
    managed: true,
    ownerType: input.ownerType ?? (input.ownerRunID ? "automation-run" : "manual"),
    ownerSessionID: input.ownerSessionID,
    ownerRunID: input.ownerRunID,
    status: input.status,
    cleanupPolicy: input.cleanupPolicy ?? "manual",
    createdAt: now,
    updatedAt: now,
    lastSeenAt: input.status === "missing" ? undefined : now,
  })
}

function isBranchAlreadyExistsError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /branch named .+ already exists/i.test(message) || /branch .+ already exists/i.test(message)
}

async function removeFailedWorktreePath(worktreePath: string) {
  await rm(worktreePath, { recursive: true, force: true }).catch(() => undefined)
}

async function cleanupCreatedBranch(repositoryRoot: string, branch: string, error: unknown) {
  if (isBranchAlreadyExistsError(error)) return
  if (!await localBranchExists(repositoryRoot, branch)) return

  await runGit(["branch", "-D", branch], repositoryRoot).catch(() => undefined)
}

function findExact(projectID: string, worktreePath: string) {
  const normalizedTarget = normalizePath(worktreePath)
  return listRaw().find(
    (record) => record.projectID === projectID && normalizePath(record.path) === normalizedTarget,
  )
}

export function listByProject(projectID: string) {
  return listRaw()
    .filter((record) => record.projectID === projectID)
    .sort((left, right) => {
      const order = { primary: 0, external: 1, managed: 2 } satisfies Record<WorktreeKind, number>
      if (left.kind !== right.kind) return order[left.kind] - order[right.kind]
      return left.path.localeCompare(right.path)
    })
}

export function getByID(worktreeID: string) {
  ensureWorktreeTable()
  return db.findById("worktrees", WorktreeRecord, worktreeID)
}

export function findForDirectory(projectID: string, directory: string) {
  const normalizedDirectory = normalizePath(directory)
  return listByProject(projectID)
    .filter((record) => containsPath(record.path, normalizedDirectory))
    .sort((left, right) => normalizePath(right.path).length - normalizePath(left.path).length)[0]
}

export function upsertObserved(input: {
  baseRef?: string | null
  baseSha?: string | null
  branch?: string | null
  cleanupPolicy?: WorktreeCleanupPolicy
  kind: WorktreeKind
  managed?: boolean
  path: string
  projectID: string
}) {
  ensureWorktreeTable()
  const now = Date.now()
  const existing = findExact(input.projectID, input.path)
  const record: WorktreeRecord = {
    ...(existing ?? {
      id: createWorktreeID(),
      createdAt: now,
      cleanupPolicy: input.cleanupPolicy ?? "manual",
      managed: input.managed ?? (input.kind === "managed"),
      status: inferStatus(input.path),
    }),
    projectID: input.projectID,
    path: input.path,
    kind: input.kind,
    managed: input.managed ?? existing?.managed ?? (input.kind === "managed"),
    branch: input.branch ?? existing?.branch ?? null,
    baseRef: input.baseRef ?? existing?.baseRef ?? null,
    baseSha: input.baseSha ?? existing?.baseSha ?? null,
    cleanupPolicy: input.cleanupPolicy ?? existing?.cleanupPolicy ?? "manual",
    status: inferStatus(input.path),
    updatedAt: now,
    lastSeenAt: now,
  }

  if (existing) {
    db.updateByIdWithSchema("worktrees", existing.id, record, WorktreeRecord)
  } else {
    db.insertOneWithSchema("worktrees", record, WorktreeRecord)
  }

  return record
}

export function ensureProjectWorktrees(input: {
  projectID: string
  repositoryRoot: string
  workspaceRoots: string[]
}) {
  const repositoryRoot = input.repositoryRoot.trim()
  if (!repositoryRoot) return []

  const uniqueRoots = new Map<string, string>()
  uniqueRoots.set(normalizePath(repositoryRoot), repositoryRoot)
  for (const root of input.workspaceRoots) {
    const trimmed = root.trim()
    if (!trimmed) continue
    uniqueRoots.set(normalizePath(trimmed), trimmed)
  }

  return [...uniqueRoots.values()].map((root) =>
    upsertObserved({
      projectID: input.projectID,
      path: root,
      kind: sameWorkspacePath(root, repositoryRoot) ? "primary" : "external",
      managed: false,
      cleanupPolicy: "manual",
    }),
  )
}

export function removeProjectWorktrees(projectID: string) {
  ensureWorktreeTable()
  for (const record of listByProject(projectID)) {
    db.deleteById("worktrees", record.id)
  }
}

export async function refresh(record: WorktreeRecord) {
  ensureWorktreeTable()
  const now = Date.now()
  if (isSshWorkspaceUri(record.path)) {
    return saveRecord(WorktreeRecord.parse({
      ...record,
      status: "active",
      updatedAt: now,
      lastSeenAt: now,
    }))
  }

  if (!existsSync(record.path)) {
    return saveRecord(WorktreeRecord.parse({
      ...record,
      status: "missing",
      updatedAt: now,
    }))
  }

  try {
    const [branch, headSha, dirty] = await Promise.all([
      resolveCurrentBranch(record.path),
      resolveHeadSha(record.path),
      isDirty(record.path),
    ])

    return saveRecord(WorktreeRecord.parse({
      ...record,
      branch,
      baseSha: headSha ?? record.baseSha ?? null,
      status: dirty ? "dirty" : "active",
      updatedAt: now,
      lastSeenAt: now,
    }))
  } catch {
    return saveRecord(WorktreeRecord.parse({
      ...record,
      status: "failed",
      updatedAt: now,
      lastSeenAt: now,
    }))
  }
}

export async function refreshByID(projectID: string, worktreeID: string) {
  const record = getByID(worktreeID)
  if (!record || record.projectID !== projectID) return null
  return refresh(record)
}

export function markFailed(projectID: string, worktreeID: string) {
  const record = getByID(worktreeID)
  if (!record || record.projectID !== projectID) return null
  return saveRecord(WorktreeRecord.parse({
    ...record,
    status: "failed",
    updatedAt: Date.now(),
  }))
}

export async function refreshProjectWorktrees(projectID: string) {
  const refreshed: WorktreeRecord[] = []
  for (const record of listByProject(projectID)) {
    refreshed.push(await refresh(record))
  }

  return refreshed
}

export async function createManaged(input: ManagedWorktreeInput) {
  ensureWorktreeTable()
  const repositoryRoot = requireLocalRepositoryRoot(input.repositoryRoot)
  const sourceDirectory = input.sourceDirectory
    ? normalizeLocalPath(input.sourceDirectory)
    : repositoryRoot
  if (!containsPath(repositoryRoot, sourceDirectory)) {
    throw new Error("Worktree source directory must be inside the project repository.")
  }
  const requestedBaseRef = input.baseRef?.trim()
  const resolvedBaseRef = requestedBaseRef || "HEAD"
  const id = createWorktreeID()
  const branch = input.branch?.trim() || `anybox/${input.ownerRunID ?? input.ownerSessionID ?? id}`
  await validateBranchName(repositoryRoot, branch)
  const branchExists = await localBranchExists(repositoryRoot, branch)

  const parent = managedWorktreeParent({
    projectID: input.projectID,
    repositoryRoot,
  })
  await mkdir(parent, { recursive: true })

  const worktreePath = await uniqueManagedTargetPath(parent, repositoryFolderSegment(repositoryRoot))
  const targetRef = branchExists ? branch : resolvedBaseRef
  const baseSha = await resolveCommitSha(repositoryRoot, targetRef)
  const createOrphanWorktree = !branchExists && !baseSha && (!requestedBaseRef || requestedBaseRef === "HEAD")
  const baseRef = createOrphanWorktree ? null : targetRef
  const record = buildManagedRecord({
    ...input,
    sourceDirectory,
    id,
    repositoryRoot,
    path: worktreePath,
    branch,
    baseRef,
    baseSha,
    cleanupPolicy: input.cleanupPolicy ?? "manual",
    status: "active",
  })

  try {
    await runGitOrThrow(
      branchExists
        ? ["worktree", "add", worktreePath, branch]
        : createOrphanWorktree
          ? ["worktree", "add", "--orphan", "-b", branch, worktreePath]
          : ["worktree", "add", "-b", branch, worktreePath, resolvedBaseRef],
      repositoryRoot,
      "Failed to create managed worktree.",
    )
  } catch (error) {
    if (!branchExists) {
      await cleanupCreatedBranch(repositoryRoot, branch, error)
    }
    await removeFailedWorktreePath(worktreePath)
    saveRecord(WorktreeRecord.parse({
      ...record,
      status: "failed",
      updatedAt: Date.now(),
      lastSeenAt: undefined,
    }))
    throw error
  }

  return refresh(record)
}

export async function removeManaged(input: RemoveManagedWorktreeInput) {
  ensureWorktreeTable()
  const record = getByID(input.worktreeID)
  if (!record || record.projectID !== input.projectID) return null
  if (!record.managed || record.kind !== "managed") {
    throw new Error("Only managed worktrees can be deleted by this API.")
  }

  const repositoryRoot = requireLocalRepositoryRoot(input.repositoryRoot)
  assertManagedPathAllowed({
    projectID: input.projectID,
    repositoryRoot,
    worktreePath: record.path,
  })

  if (input.ownerRunID && record.ownerRunID && record.ownerRunID !== input.ownerRunID) {
    throw new Error("Worktree ownerRunID does not match.")
  }
  if (input.ownerSessionID && record.ownerSessionID && record.ownerSessionID !== input.ownerSessionID) {
    throw new Error("Worktree ownerSessionID does not match.")
  }

  const refreshed = await refresh(record)
  if (refreshed.status === "dirty" && input.force !== true) {
    throw new Error("Worktree has uncommitted changes. Pass force=true to delete it.")
  }

  const removing = saveRecord(WorktreeRecord.parse({
    ...refreshed,
    status: "removing",
    updatedAt: Date.now(),
  }))

  try {
    if (existsSync(removing.path)) {
      await runGitOrThrow(
        ["worktree", "remove", ...(input.force === true ? ["--force"] : []), removing.path],
        repositoryRoot,
        "Failed to remove managed worktree.",
      )
    }

    db.deleteById("worktrees", removing.id)
    return WorktreeRecord.parse({
      ...removing,
      status: "removed",
      updatedAt: Date.now(),
    })
  } catch (error) {
    saveRecord(WorktreeRecord.parse({
      ...removing,
      status: "failed",
      updatedAt: Date.now(),
    }))
    throw error
  }
}
