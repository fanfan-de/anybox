import path from "node:path"
import { IpythonSessionManager } from "#ipython/session-manager.ts"
import { IpythonRuntimeError, type IpythonExecutionResult } from "#ipython/types.ts"
import * as Log from "#util/log.ts"

export const DEFAULT_MAX_ACTIVE_IPYTHON_SESSIONS = 4

export interface IpythonManagedSession {
  readonly sessionID: string
  readonly cwd: string
  readonly generation: number
  readonly isExited: boolean
  execute(input: { code: string; signal?: AbortSignal }): Promise<IpythonExecutionResult>
  interrupt(): Promise<boolean>
  dispose(): Promise<void>
}

export interface IpythonRegistryOptions {
  maxActiveSessions?: number
  createManager?: (input: {
    sessionID: string
    cwd: string
    generation: number
    onExit: (manager: IpythonManagedSession) => void
  }) => IpythonManagedSession
}

interface ManagerRetirement {
  manager: IpythonManagedSession
  promise: Promise<void>
  failed: boolean
  error?: unknown
}

const log = Log.create({ service: "ipython.registry" })
const globallyClosedSessionIDs = new Set<string>()

function abortedBeforeManager(generation: number): IpythonExecutionResult {
  return {
    status: "aborted",
    stdout: "",
    stderr: "",
    displays: [],
    durationMs: 0,
    kernelGeneration: generation,
    stateLost: false,
    outputTruncated: false,
  }
}

export class IpythonRegistry {
  private readonly maxActiveSessions: number
  private readonly createManager: NonNullable<IpythonRegistryOptions["createManager"]>
  private readonly sessions = new Map<string, IpythonManagedSession>()
  private readonly generations = new Map<string, number>()
  private readonly closedSessionIDs = new Set<string>()
  private readonly sessionDisposals = new Map<string, Promise<boolean>>()
  private readonly managerRetirements = new Map<string, ManagerRetirement>()
  private disposed = false
  private disposePromise?: Promise<void>

  constructor(options: IpythonRegistryOptions = {}) {
    this.maxActiveSessions = options.maxActiveSessions ?? DEFAULT_MAX_ACTIVE_IPYTHON_SESSIONS
    this.createManager = options.createManager ?? ((input) => new IpythonSessionManager(input))
  }

  get activeSessionCount() {
    return this.sessions.size
  }

  private generationFor(sessionID: string) {
    return this.sessions.get(sessionID)?.generation
      ?? this.managerRetirements.get(sessionID)?.manager.generation
      ?? this.generations.get(sessionID)
      ?? 0
  }

  private managerFor(sessionID: string, cwd: string) {
    if (globallyClosedSessionIDs.has(sessionID) || this.closedSessionIDs.has(sessionID)) {
      throw new IpythonRuntimeError(
        "IPYTHON_HOST_EXITED",
        "The IPython session is closing or no longer active.",
        { stateLost: true, kernelGeneration: this.generationFor(sessionID) },
      )
    }
    if (this.managerRetirements.has(sessionID)) {
      throw new IpythonRuntimeError(
        "IPYTHON_HOST_EXITED",
        "The previous IPython kernel is still shutting down.",
        { stateLost: true, kernelGeneration: this.generationFor(sessionID) },
      )
    }
    const normalizedCwd = path.resolve(cwd)
    const existing = this.sessions.get(sessionID)
    if (existing) {
      if (existing.cwd !== normalizedCwd) {
        throw new IpythonRuntimeError(
          "IPYTHON_SESSION_WORKDIR_CHANGED",
          `The IPython session was created in '${existing.cwd}' and cannot be reused in '${normalizedCwd}'. Close the session before changing its workspace.`,
        )
      }
      return existing
    }

    if (this.disposed) {
      throw new IpythonRuntimeError(
        "IPYTHON_HOST_EXITED",
        "The IPython runtime has been shut down.",
        { stateLost: true, kernelGeneration: this.generationFor(sessionID) },
      )
    }
    if (this.sessions.size >= this.maxActiveSessions) {
      throw new IpythonRuntimeError(
        "IPYTHON_KERNEL_LIMIT",
        `Anybox already has ${this.sessions.size} active IPython sessions. Archive or close one before starting another.`,
      )
    }

    const generation = (this.generations.get(sessionID) ?? 0) + 1
    this.generations.set(sessionID, generation)
    const manager = this.createManager({
      sessionID,
      cwd: normalizedCwd,
      generation,
      onExit: (candidate) => {
        if (this.sessions.get(sessionID) === candidate) {
          this.beginManagerRetirement(sessionID, candidate)
        }
      },
    })
    this.sessions.set(sessionID, manager)
    return manager
  }

  async execute(input: {
    sessionID: string
    cwd: string
    code: string
    signal?: AbortSignal
  }): Promise<IpythonExecutionResult> {
    if (input.signal?.aborted) {
      return abortedBeforeManager(
        this.sessions.get(input.sessionID)?.generation
          ?? this.generations.get(input.sessionID)
          ?? 0,
      )
    }
    const retirementCompleted = await this.waitForManagerRetirement(input.sessionID, input.signal)
    if (!retirementCompleted || input.signal?.aborted) {
      return abortedBeforeManager(
        this.sessions.get(input.sessionID)?.generation
          ?? this.generations.get(input.sessionID)
          ?? 0,
      )
    }
    const manager = this.managerFor(input.sessionID, input.cwd)
    try {
      const result = await manager.execute({ code: input.code, signal: input.signal })
      if (result.stateLost && this.sessions.get(input.sessionID) === manager) {
        this.beginManagerRetirement(input.sessionID, manager)
      }
      return result
    } catch (error) {
      const enrichedError = error instanceof IpythonRuntimeError
        ? error.withKernelGeneration(manager.generation)
        : error
      if (
        (manager.isExited || (enrichedError instanceof IpythonRuntimeError && enrichedError.stateLost))
        && this.sessions.get(input.sessionID) === manager
      ) {
        this.beginManagerRetirement(input.sessionID, manager)
      }
      throw enrichedError
    }
  }

  private beginManagerRetirement(sessionID: string, manager: IpythonManagedSession) {
    const existing = this.managerRetirements.get(sessionID)
    if (existing) return existing
    if (this.sessions.get(sessionID) === manager) this.sessions.delete(sessionID)

    const retirement: ManagerRetirement = {
      manager,
      promise: Promise.resolve(),
      failed: false,
    }
    this.managerRetirements.set(sessionID, retirement)
    retirement.promise = (async () => {
      try {
        await manager.dispose()
      } catch (error) {
        retirement.failed = true
        retirement.error = error
        this.closedSessionIDs.add(sessionID)
        log.error("manager-retirement-failed", { sessionID, error })
      } finally {
        if (!retirement.failed && this.managerRetirements.get(sessionID) === retirement) {
          this.managerRetirements.delete(sessionID)
        }
      }
    })()
    return retirement
  }

  private async waitForManagerRetirement(sessionID: string, signal?: AbortSignal) {
    const retirement = this.managerRetirements.get(sessionID)
    if (!retirement) return true
    if (signal?.aborted) return false

    if (signal) {
      const outcome = await new Promise<"retired" | "aborted">((resolve) => {
        const onAbort = () => {
          signal.removeEventListener("abort", onAbort)
          resolve("aborted")
        }
        signal.addEventListener("abort", onAbort, { once: true })
        retirement.promise.then(() => {
          signal.removeEventListener("abort", onAbort)
          resolve("retired")
        })
      })
      if (outcome === "aborted") return false
    } else {
      await retirement.promise
    }

    if (retirement.failed) {
      throw new IpythonRuntimeError(
        "IPYTHON_HOST_EXITED",
        "The previous IPython kernel could not be stopped cleanly.",
        {
          cause: retirement.error,
          stateLost: true,
          kernelGeneration: retirement.manager.generation,
        },
      )
    }
    return true
  }

  async interruptSession(sessionID: string) {
    return await this.sessions.get(sessionID)?.interrupt() ?? false
  }

  async disposeSession(sessionID: string) {
    this.closedSessionIDs.add(sessionID)
    const existingDisposal = this.sessionDisposals.get(sessionID)
    if (existingDisposal) return await existingDisposal

    const disposal = this.disposeSessionOnce(sessionID)
    this.sessionDisposals.set(sessionID, disposal)
    try {
      return await disposal
    } finally {
      if (this.sessionDisposals.get(sessionID) === disposal) {
        this.sessionDisposals.delete(sessionID)
      }
    }
  }

  private async disposeSessionOnce(sessionID: string) {
    const retirement = this.managerRetirements.get(sessionID)
    if (retirement) {
      await this.waitForManagerRetirement(sessionID)
      return true
    }
    const manager = this.sessions.get(sessionID)
    if (!manager) return false
    try {
      await manager.dispose()
    } finally {
      if (this.sessions.get(sessionID) === manager) this.sessions.delete(sessionID)
    }
    return true
  }

  resumeSession(sessionID: string) {
    if (this.sessionDisposals.has(sessionID)) {
      throw new IpythonRuntimeError(
        "IPYTHON_HOST_EXITED",
        "The previous IPython kernel is still shutting down.",
        { stateLost: true, kernelGeneration: this.generationFor(sessionID) },
      )
    }
    this.closedSessionIDs.delete(sessionID)
  }

  async disposeAll() {
    this.disposed = true
    if (!this.disposePromise) this.disposePromise = this.disposeAllOnce()
    await this.disposePromise
  }

  private async disposeAllOnce() {
    const pendingSessionDisposals = [...this.sessionDisposals.values()]
    const pendingRetirements = [...this.managerRetirements.values()]
    const managers = [...this.sessions.values()]
    this.sessions.clear()
    const results = await Promise.allSettled([
      ...pendingSessionDisposals,
      ...pendingRetirements.map((retirement) => retirement.promise),
      ...managers.map((manager) => manager.dispose()),
    ])

    const failures = [
      ...results.flatMap((result) => result.status === "rejected" ? [result.reason] : []),
      ...pendingRetirements.flatMap((retirement) => retirement.failed ? [retirement.error] : []),
    ]
    if (failures.length > 0) {
      log.error("dispose-failed", { count: failures.length, errors: failures })
      throw new AggregateError(failures, "Failed to stop every IPython session")
    }
  }
}

let activeRegistry: IpythonRegistry | undefined
let runtimeShuttingDown = false

export function getIpythonRegistry() {
  if (runtimeShuttingDown) {
    throw new IpythonRuntimeError(
      "IPYTHON_HOST_EXITED",
      "The IPython runtime is shutting down.",
      { stateLost: true },
    )
  }
  if (!activeRegistry) activeRegistry = new IpythonRegistry()
  return activeRegistry
}

export function beginIpythonRuntimeShutdown() {
  runtimeShuttingDown = true
}

export function resumeIpythonRuntime() {
  runtimeShuttingDown = false
}

export function createIpythonRegistry(options?: IpythonRegistryOptions) {
  return new IpythonRegistry(options)
}

export function setIpythonRegistryForTest(registry: IpythonRegistry | undefined) {
  activeRegistry = registry
}

export async function interruptIpythonSession(sessionID: string) {
  return await activeRegistry?.interruptSession(sessionID) ?? false
}

export async function disposeIpythonSession(sessionID: string) {
  globallyClosedSessionIDs.add(sessionID)
  const registry = activeRegistry
  return await registry?.disposeSession(sessionID) ?? false
}

export function resumeIpythonSession(sessionID: string) {
  globallyClosedSessionIDs.delete(sessionID)
  activeRegistry?.resumeSession(sessionID)
}

export async function disposeIpythonRegistry() {
  const registry = activeRegistry
  if (!registry) return
  // Keep a failed, permanently disposed registry installed as a tombstone.
  // Clearing it after an incomplete shutdown could allow a new generation to
  // start alongside an orphaned host/kernel. A clean shutdown is the only
  // point at which replacing the singleton is safe.
  await registry.disposeAll()
  if (activeRegistry === registry) activeRegistry = undefined
}
