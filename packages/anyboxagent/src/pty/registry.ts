import { stat } from "node:fs/promises"
import path from "node:path"
import { normalizeComparablePath } from "@anybox/platform"
import * as Identifier from "#id/id.ts"
import * as Project from "#project/project.ts"
import { createManagedPtySession, type ManagedPtySession } from "#pty/session.ts"
import {
  buildPtyEnvironment,
  createNodePtyRuntimeAdapter,
  resolveDefaultPtyShell,
  toPtyCreateError,
  type PtyRuntimeAdapter,
} from "#pty/runtime.ts"
import { PtyEvents, publishPtyEvent } from "#pty/events.ts"
import type { CreatePtySessionBody, PtyReplayPayload, PtySessionInfo, UpdatePtySessionBody } from "#pty/types.ts"

const DEFAULT_COLS = 120
const DEFAULT_ROWS = 32
const DEFAULT_BUFFER_CHARS = 200_000
const DEFAULT_EXIT_RETENTION_MS = 5 * 60 * 1000
const DEFAULT_DELETE_RETENTION_MS = 15_000

function normalizePath(input: string) {
  const resolved = path.resolve(input)
  return normalizeComparablePath(resolved)
}

function isWithinRoot(root: string, candidate: string) {
  const normalizedRoot = normalizePath(root)
  const normalizedCandidate = normalizePath(candidate)
  if (normalizedRoot === normalizedCandidate) return true
  const relative = path.relative(normalizedRoot, normalizedCandidate)
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
}

async function assertDirectory(candidate: string) {
  const isDirectory = await stat(candidate).then((entry) => entry.isDirectory()).catch(() => false)
  if (!isDirectory) {
    throw new Error(`Directory does not exist: ${candidate}`)
  }
}

export interface PtyRegistryOptions {
  runtime?: PtyRuntimeAdapter
  now?: () => number
  bufferChars?: number
  exitRetentionMs?: number
  deleteRetentionMs?: number
}

export type CreateOwnedPtySessionInput = Omit<CreatePtySessionBody, "terminalKey" | "purpose"> & {
  terminalKey?: CreatePtySessionBody["terminalKey"]
  purpose?: CreatePtySessionBody["purpose"]
  cwd: string
}

export class PtyRegistry {
  private readonly sessions = new Map<string, ManagedPtySession>()
  private readonly sessionIndex = new Map<string, string>()
  private readonly pruneTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly runtime: PtyRuntimeAdapter
  private readonly now: () => number
  private readonly bufferChars: number
  private readonly exitRetentionMs: number
  private readonly deleteRetentionMs: number

  constructor(options: PtyRegistryOptions = {}) {
    this.runtime = options.runtime ?? createNodePtyRuntimeAdapter()
    this.now = options.now ?? Date.now
    this.bufferChars = options.bufferChars ?? DEFAULT_BUFFER_CHARS
    this.exitRetentionMs = options.exitRetentionMs ?? DEFAULT_EXIT_RETENTION_MS
    this.deleteRetentionMs = options.deleteRetentionMs ?? DEFAULT_DELETE_RETENTION_MS
  }

  private sessionIndexKey(sessionID: string, terminalKey = "interactive") {
    return `${sessionID}\0${terminalKey}`
  }

  private schedulePrune(id: string, delayMs: number) {
    const existing = this.pruneTimers.get(id)
    if (existing) {
      clearTimeout(existing)
    }

    const timer = setTimeout(() => {
      const session = this.sessions.get(id)
      if (!session) return
      this.sessions.delete(id)
      this.unindexSession(session)
      this.pruneTimers.delete(id)
      session.dispose()
    }, delayMs)
    timer.unref?.()
    this.pruneTimers.set(id, timer)
  }

  private clearPrune(id: string) {
    const existing = this.pruneTimers.get(id)
    if (!existing) return
    clearTimeout(existing)
    this.pruneTimers.delete(id)
  }

  private unindexSession(session: ManagedPtySession) {
    const info = session.info()
    const key = this.sessionIndexKey(info.sessionID, info.terminalKey)
    if (this.sessionIndex.get(key) === info.id) {
      this.sessionIndex.delete(key)
    }
  }

  private pruneNonRunningSession(session: ManagedPtySession) {
    const info = session.info()
    if (info.status === "running") return false

    this.clearPrune(info.id)
    this.sessions.delete(info.id)
    this.unindexSession(session)
    session.dispose()
    return true
  }

  private async resolveAllowedCwd(input?: string) {
    const cwd = path.resolve(input?.trim() || process.cwd())
    await assertDirectory(cwd)

    const { project, sandbox } = await Project.fromDirectory(cwd)
    const allowedRoots = [...Project.getWorkspaceRoots(project), sandbox]

    if (!allowedRoots.some((root) => isWithinRoot(root, cwd))) {
      throw new Error(`Directory is outside the allowed project roots: ${cwd}`)
    }

    return cwd
  }

  async create(input: CreateOwnedPtySessionInput) {
    const terminalKey = input.terminalKey ?? "interactive"
    const existing = this.getBySession(input.sessionID, terminalKey)
    if (existing) return existing.info()

    const cwd = await this.resolveAllowedCwd(input.cwd)
    const shell = await resolveDefaultPtyShell(input.shell)
    const rows = input.rows ?? DEFAULT_ROWS
    const cols = input.cols ?? DEFAULT_COLS
    const id = Identifier.descending("pty")
    const env = buildPtyEnvironment(cwd, shell)
    const runtime: PtyRuntimeAdapter = {
      spawn: (spawnInput) =>
        this.runtime.spawn({
          ...spawnInput,
          env,
        }),
    }

    let session: ManagedPtySession
    try {
      session = await createManagedPtySession({
        id,
        sessionID: input.sessionID,
        terminalKey,
        purpose: input.purpose ?? "interactive",
        title: input.title,
        cwd,
        shell,
        rows,
        cols,
        bufferChars: this.bufferChars,
        runtime,
        now: this.now,
        onExited: (info) => {
          this.sessionIndex.delete(this.sessionIndexKey(info.sessionID, info.terminalKey))
          this.schedulePrune(info.id, this.exitRetentionMs)
        },
        onDeleted: (info) => {
          this.sessionIndex.delete(this.sessionIndexKey(info.sessionID, info.terminalKey))
          this.schedulePrune(info.id, this.deleteRetentionMs)
        },
      })
    } catch (error) {
      throw toPtyCreateError(error, shell)
    }

    this.sessions.set(id, session)
    this.sessionIndex.set(this.sessionIndexKey(input.sessionID, terminalKey), id)
    const info = session.info()
    publishPtyEvent(PtyEvents.Created, { session: info })
    return info
  }

  get(id: string) {
    return this.sessions.get(id) ?? null
  }

  getBySession(sessionID: string, terminalKey = "interactive") {
    const indexKey = this.sessionIndexKey(sessionID, terminalKey)
    const ptyID = this.sessionIndex.get(indexKey)
    if (!ptyID) return null

    const session = this.sessions.get(ptyID)
    if (!session) {
      this.sessionIndex.delete(indexKey)
      return null
    }

    if (this.pruneNonRunningSession(session)) return null
    return session
  }

  info(id: string) {
    return this.get(id)?.info() ?? null
  }

  infoBySession(sessionID: string, terminalKey = "interactive") {
    return this.getBySession(sessionID, terminalKey)?.info() ?? null
  }

  listBySession(sessionID: string) {
    return [...this.sessions.values()]
      .map((session) => session.info())
      .filter((session) => session.sessionID === sessionID && session.status !== "deleted")
      .sort((left, right) => left.createdAt - right.createdAt)
  }

  update(id: string, input: UpdatePtySessionBody) {
    const session = this.get(id)
    if (!session) return null
    return session.update(input)
  }

  delete(id: string) {
    const session = this.get(id)
    if (!session) return null
    const info = session.markDeleted()
    this.unindexSession(session)
    return info
  }

  deleteBySession(sessionID: string) {
    const sessions = this.listBySession(sessionID)
      .map((info) => this.sessions.get(info.id))
      .filter((session): session is ManagedPtySession => Boolean(session))
    const deleted = sessions.map((session) => {
      const info = session.markDeleted()
      this.unindexSession(session)
      return info
    })
    return deleted.find((session) => session.terminalKey === "interactive") ?? deleted[0] ?? null
  }

  deleteBySessionAndKey(sessionID: string, terminalKey: string) {
    const session = this.getBySession(sessionID, terminalKey)
    if (!session) return null
    const info = session.markDeleted()
    this.unindexSession(session)
    return info
  }

  write(id: string, data: string) {
    const session = this.get(id)
    if (!session) return null
    session.write(data)
    return session.info()
  }

  writeBySession(sessionID: string, data: string, terminalKey = "interactive") {
    const session = this.getBySession(sessionID, terminalKey)
    if (!session) return null
    session.write(data)
    return session.info()
  }

  replayBySession(sessionID: string, cursor?: number | null, terminalKey = "interactive"): PtyReplayPayload | null {
    return this.getBySession(sessionID, terminalKey)?.replay(cursor) ?? null
  }
}

let activePtyRegistry: PtyRegistry | undefined

export function getPtyRegistry() {
  if (!activePtyRegistry) {
    activePtyRegistry = new PtyRegistry()
  }

  return activePtyRegistry
}

export function createPtyRegistry(options?: PtyRegistryOptions) {
  return new PtyRegistry(options)
}
