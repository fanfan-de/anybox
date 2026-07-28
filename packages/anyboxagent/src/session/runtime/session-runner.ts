import * as Orchestrator from "#session/runtime/orchestrator.ts"
import * as Identifier from "#id/id.ts"
import * as Status from "#session/runtime/status.ts"
import { Instance } from "#project/instance.ts"
import {
  getSessionLimits,
  SessionLimitError,
} from "#session/runtime/session-limits.ts"

export type SessionRunnerStatus = "idle" | "running" | "cancelling" | "stopped"
export type SessionOperationType = "prompt" | "resume"
export type SessionExecutionMode = "new-turn" | "queued" | "steer"
export type SessionThreadTargetKind = "active-thread" | "detached-branch"

export type PromptRuntime = {
  sessionID: string
  turnID: string
  executionID: string
  targetKind: SessionThreadTargetKind
  controller: AbortController
  abort: AbortSignal
  headMessageID: () => string | null
  updateHeadMessageID: (messageID: string) => void
}

export type SessionExecutionHandle<T> = {
  sessionID: string
  turnID: string
  executionID: string
  targetKind: SessionThreadTargetKind
  mode: SessionExecutionMode
  promise: Promise<T>
  cancel: () => void
}

export type SessionRunnerCancelResult = {
  sessionID: string
  executionID?: string
  activeCancelled: boolean
  queuedCancelled: number
  queuedCancelledTurnIDs: string[]
  cancelled: boolean
}

export class SessionOperationCancelledError extends Error {
  constructor(message = "Session operation was cancelled before it started.") {
    super(message)
    this.name = "SessionOperationCancelledError"
  }
}

export type SessionRunnerSnapshot = {
  sessionID: string
  executionID: string
  targetKind: SessionThreadTargetKind
  headMessageID: string | null
  status: SessionRunnerStatus
  startedAt: number | null
  activeForMs: number
  reason?: SessionOperationType
  activeTurnID: string | null
  directory?: string
  queueLength: number
  queuedOpCount: number
  pendingSteerCount: number
}

export type SessionRunnerEvent = {
  type: "registered" | "finished" | "cancelled" | "queued" | "steered"
  sessionID: string
  executionID: string
}

type QueuedOperation<T> = {
  type: SessionOperationType
  sessionID: string
  directory: string
  turnID: string
  execute: (runtime: PromptRuntime) => Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
  cancelled: boolean
  steerHandoffForTurnID?: string
}

type ActiveOperation = {
  type: SessionOperationType
  directory: string
  turnID: string
  controller: AbortController
  startedAt: number
  pendingSteerCount: number
  pendingSteerTurnIDs: Set<string>
  promise: Promise<unknown>
}

type EnqueueOperationInput<T> = {
  sessionID: string
  executionID?: string
  targetKind?: SessionThreadTargetKind
  initialHeadMessageID?: string | null
  directory: string
  type: SessionOperationType
  execute: (runtime: PromptRuntime) => Promise<T>
}

type EnqueuePromptInput<T> = EnqueueOperationInput<T> & {
  allowSteer?: boolean
}

const runners = new Map<string, SessionRunner>()
const subscribers = new Set<(event: SessionRunnerEvent) => void>()
let capacityWakeScheduled = false

function setAggregatedSessionStatus(sessionID: string, status: Status.Info) {
  try {
    void Instance.directory
    Status.set(sessionID, status)
  } catch {
    // Low-level runner tests and shutdown paths may execute without a project
    // instance. Prompt executions run inside one and still publish status.
  }
}

function sessionHasExecutionWork(sessionID: string) {
  return [...runners.values()].some((runner) => (
    runner.sessionID === sessionID &&
    (
      runner.status() === "running" ||
      runner.status() === "cancelling" ||
      runner.queueLength() > 0
    )
  ))
}

function notify(event: SessionRunnerEvent) {
  for (const subscriber of [...subscribers]) {
    try {
      subscriber(event)
    } catch {
      subscribers.delete(subscriber)
    }
  }
}

function activeRunnerSnapshots() {
  return [...runners.values()]
    .map((runner) => runner.snapshot())
    .filter((snapshot) => snapshot.status === "running" || snapshot.status === "cancelling")
}

function assertQueueCapacity(runner: SessionRunner) {
  const limits = getSessionLimits()
  if (runner.queueLength() >= limits.maxQueueOps) {
    throw new SessionLimitError(
      "SESSION_QUEUE_LIMIT",
      `Session '${runner.sessionID}' already has ${limits.maxQueueOps} queued operations.`,
      limits.maxQueueOps,
    )
  }
}

function assertRunningCapacity(directory: string) {
  const limits = getSessionLimits()
  const active = activeRunnerSnapshots()
  if (active.length >= limits.maxRunning) {
    throw new SessionLimitError(
      "SESSION_GLOBAL_CONCURRENCY_LIMIT",
      `At most ${limits.maxRunning} sessions can run concurrently.`,
      limits.maxRunning,
    )
  }

  const activeInDirectory = active.filter((snapshot) => snapshot.directory === directory).length
  if (activeInDirectory >= limits.maxRunningPerDirectory) {
    throw new SessionLimitError(
      "SESSION_DIRECTORY_CONCURRENCY_LIMIT",
      `At most ${limits.maxRunningPerDirectory} sessions can run concurrently in this directory.`,
      limits.maxRunningPerDirectory,
    )
  }
}

function hasImmediateRunningCapacity(directory: string, candidate: SessionRunner) {
  const limits = getSessionLimits()
  const active = activeRunnerSnapshots()
  const pendingStarts = [...runners.values()]
    .filter((runner) => runner !== candidate)
    .map((runner) => runner.pendingStartDirectory())
    .filter((value): value is string => Boolean(value))
  if (active.length + pendingStarts.length >= limits.maxRunning) return false

  const activeInDirectory = active.filter((snapshot) => snapshot.directory === directory).length
  const pendingInDirectory = pendingStarts.filter((pendingDirectory) => pendingDirectory === directory).length
  return activeInDirectory + pendingInDirectory < limits.maxRunningPerDirectory
}

function scheduleCapacityWake() {
  if (capacityWakeScheduled) return
  capacityWakeScheduled = true
  queueMicrotask(() => {
    capacityWakeScheduled = false
    for (const runner of runners.values()) {
      runner.tryWakeForCapacity()
    }
  })
}

class SessionRunner {
  readonly sessionID: string
  readonly executionID: string
  readonly targetKind: SessionThreadTargetKind
  private readonly queue: QueuedOperation<unknown>[] = []
  private currentHeadMessageID: string | null
  private statusValue: SessionRunnerStatus = "idle"
  private active: ActiveOperation | undefined
  private draining = false
  private waitingForCapacity = false
  private idleWaiters: Array<() => void> = []

  constructor(input: {
    sessionID: string
    executionID: string
    targetKind: SessionThreadTargetKind
    initialHeadMessageID?: string | null
  }) {
    this.sessionID = input.sessionID
    this.executionID = input.executionID
    this.targetKind = input.targetKind
    this.currentHeadMessageID = input.initialHeadMessageID ?? null
  }

  status() {
    return this.statusValue
  }

  syncInitialHeadMessageID(headMessageID: string | null | undefined) {
    if (headMessageID === undefined || this.active || this.queueLength() > 0) return
    this.currentHeadMessageID = headMessageID
  }

  queueLength() {
    return this.queue.filter((op) => !op.cancelled).length
  }

  pendingStartDirectory() {
    if (!this.draining || this.active || this.waitingForCapacity) return null
    return this.queue.find((op) => !op.cancelled)?.directory ?? null
  }

  tryWakeForCapacity() {
    if (!this.waitingForCapacity || this.active || this.queueLength() === 0) return
    this.waitingForCapacity = false
    this.drain()
  }

  enqueue<T>(input: EnqueueOperationInput<T>): SessionExecutionHandle<T> {
    assertQueueCapacity(this)
    const turnID = Identifier.ascending("turn")
    const waitsForDetachedCapacity =
      this.targetKind === "detached-branch" &&
      !this.active &&
      !hasImmediateRunningCapacity(input.directory, this)
    const mode: SessionExecutionMode =
      this.active || this.statusValue === "cancelling" || waitsForDetachedCapacity
        ? "queued"
        : "new-turn"

    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<T>((innerResolve, innerReject) => {
      resolve = innerResolve
      reject = innerReject
    })

    const op: QueuedOperation<T> = {
      type: input.type,
      sessionID: input.sessionID,
      directory: input.directory,
      turnID,
      execute: input.execute,
      resolve,
      reject,
      cancelled: false,
    }

    this.queue.push(op as QueuedOperation<unknown>)
    if (this.targetKind === "detached-branch") {
      setAggregatedSessionStatus(this.sessionID, { type: "busy" })
    }
    notify({ type: "queued", sessionID: this.sessionID, executionID: this.executionID })
    this.drain()

    return {
      sessionID: input.sessionID,
      turnID,
      executionID: this.executionID,
      targetKind: this.targetKind,
      mode,
      promise,
      cancel: () => {
        if (this.removeQueued(turnID)) return
        if (this.active?.turnID === turnID) {
          this.cancel()
        }
      },
    }
  }

  enqueuePrompt<T>(input: EnqueuePromptInput<T>): SessionExecutionHandle<T> {
    const activeTurn = this.active
      ? Orchestrator.activeTurn(input.sessionID, this.active.turnID)
      : undefined
    if (
      this.statusValue === "running" &&
      this.active &&
      input.allowSteer === true &&
      activeTurn?.turnID === this.active.turnID &&
      activeTurn.canAcceptSteerHandoff()
    ) {
      assertQueueCapacity(this)
      const activeTurnID = activeTurn.turnID
      const turnID = Identifier.ascending("turn")

      let resolve!: (value: T) => void
      let reject!: (error: unknown) => void
      const promise = new Promise<T>((innerResolve, innerReject) => {
        resolve = innerResolve
        reject = innerReject
      })

      const op: QueuedOperation<T> = {
        type: input.type,
        sessionID: input.sessionID,
        directory: input.directory,
        turnID,
        execute: input.execute,
        resolve,
        reject,
        cancelled: false,
        steerHandoffForTurnID: activeTurnID,
      }

      const insertIndex = this.queue.findIndex((queued) => !queued.cancelled && !queued.steerHandoffForTurnID)
      if (insertIndex === -1) {
        this.queue.push(op as QueuedOperation<unknown>)
      } else {
        this.queue.splice(insertIndex, 0, op as QueuedOperation<unknown>)
      }

      if (this.active?.turnID === activeTurnID) {
        this.active.pendingSteerCount += 1
        this.active.pendingSteerTurnIDs.add(turnID)
      }
      notify({ type: "steered", sessionID: this.sessionID, executionID: this.executionID })
      this.drain()

      return {
        sessionID: input.sessionID,
        turnID,
        executionID: this.executionID,
        targetKind: this.targetKind,
        mode: "steer",
        promise,
        cancel: () => {
          this.removeQueued(turnID)
        },
      }
    }

    return this.enqueue(input)
  }

  cancel() {
    if (!this.active) return false
    this.statusValue = "cancelling"
    this.active.controller.abort()
    notify({ type: "cancelled", sessionID: this.sessionID, executionID: this.executionID })
    return true
  }

  cancelSession(options?: { cancelQueued?: boolean }) {
    const activeCancelled = this.cancel()
    const queuedCancelledTurnIDs = options?.cancelQueued ? this.cancelQueued() : []
    return {
      sessionID: this.sessionID,
      executionID: this.executionID,
      activeCancelled,
      queuedCancelled: queuedCancelledTurnIDs.length,
      queuedCancelledTurnIDs,
      cancelled: activeCancelled || queuedCancelledTurnIDs.length > 0,
    } satisfies SessionRunnerCancelResult
  }

  async consumePendingSteer(turnID: string) {
    if (!this.active || this.active.turnID !== turnID) return 0
    const count = this.active.pendingSteerCount
    this.active.pendingSteerCount = 0
    this.active.pendingSteerTurnIDs.clear()
    return count
  }

  waitForIdle() {
    if (!this.active && this.queueLength() === 0) return Promise.resolve()
    return new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve)
    })
  }

  snapshot(): SessionRunnerSnapshot {
    const startedAt = this.active?.startedAt ?? null
    return {
      sessionID: this.sessionID,
      executionID: this.executionID,
      targetKind: this.targetKind,
      headMessageID: this.currentHeadMessageID,
      status: this.statusValue,
      startedAt,
      activeForMs: startedAt ? Math.max(0, Date.now() - startedAt) : 0,
      reason: this.active?.type,
      activeTurnID: this.active?.turnID ?? null,
      directory: this.active?.directory ?? this.queue.find((op) => !op.cancelled)?.directory,
      queueLength: this.queueLength(),
      queuedOpCount: this.queueLength(),
      pendingSteerCount: this.active?.pendingSteerCount ?? 0,
    }
  }

  private removeQueued(turnID: string) {
    const index = this.queue.findIndex((op) => op.turnID === turnID && !op.cancelled)
    if (index === -1) return false
    const [op] = this.queue.splice(index, 1)
    if (!op) return false
    this.releasePendingSteerHandoff(op)
    op.cancelled = true
    op.reject(new SessionOperationCancelledError())
    this.resolveIdleIfNeeded()
    setAggregatedSessionStatus(
      this.sessionID,
      sessionHasExecutionWork(this.sessionID) ? { type: "busy" } : { type: "idle" },
    )
    return true
  }

  private cancelQueued() {
    const cancelledTurnIDs: string[] = []
    for (const op of this.queue.splice(0)) {
      if (op.cancelled) continue
      this.releasePendingSteerHandoff(op)
      op.cancelled = true
      op.reject(new SessionOperationCancelledError())
      cancelledTurnIDs.push(op.turnID)
    }
    if (cancelledTurnIDs.length > 0) {
      notify({ type: "cancelled", sessionID: this.sessionID, executionID: this.executionID })
      this.resolveIdleIfNeeded()
      setAggregatedSessionStatus(
        this.sessionID,
        sessionHasExecutionWork(this.sessionID) ? { type: "busy" } : { type: "idle" },
      )
    }
    return cancelledTurnIDs
  }

  private drain() {
    if (this.draining) return
    this.draining = true
    queueMicrotask(() => {
      void this.drainLoop()
    })
  }

  private async drainLoop() {
    try {
      while (!this.active) {
        const op = this.queue.shift()
        if (!op) {
          this.statusValue = "idle"
          this.resolveIdleIfNeeded()
          break
        }

        if (op.cancelled) continue
        const completed = await this.runOperation(op)
        if (!completed) break
      }
    } finally {
      this.draining = false
      if (!this.active && this.queueLength() > 0 && !this.waitingForCapacity) {
        this.drain()
      } else if (!this.active && this.targetKind === "detached-branch") {
        const key = runnerKey(this.sessionID, this.executionID)
        if (this.queueLength() === 0 && runners.get(key) === this) {
          runners.delete(key)
        }
      }
    }
  }

  private async runOperation(op: QueuedOperation<unknown>) {
    try {
      assertRunningCapacity(op.directory)
    } catch (error) {
      if (this.targetKind === "detached-branch" && error instanceof SessionLimitError) {
        this.queue.unshift(op)
        this.waitingForCapacity = true
        this.statusValue = "idle"
        return false
      }
      op.reject(error)
      setAggregatedSessionStatus(
        this.sessionID,
        sessionHasExecutionWork(this.sessionID) ? { type: "busy" } : { type: "idle" },
      )
      return true
    }
    const controller = new AbortController()
    const startedAt = Date.now()
    const runtime: PromptRuntime = {
      sessionID: op.sessionID,
      turnID: op.turnID,
      executionID: this.executionID,
      targetKind: this.targetKind,
      controller,
      abort: controller.signal,
      headMessageID: () => this.currentHeadMessageID,
      updateHeadMessageID: (messageID) => {
        this.currentHeadMessageID = messageID
      },
    }
    let resolveActive!: (value: unknown) => void
    let rejectActive!: (error: unknown) => void
    const promise = new Promise<unknown>((resolve, reject) => {
      resolveActive = resolve
      rejectActive = reject
    })
    promise.catch(() => undefined)
    this.active = {
      type: op.type,
      directory: op.directory,
      turnID: op.turnID,
      controller,
      startedAt,
      pendingSteerCount: 0,
      pendingSteerTurnIDs: new Set(),
      promise,
    }
    this.statusValue = "running"
    setAggregatedSessionStatus(this.sessionID, { type: "busy" })
    notify({ type: "registered", sessionID: this.sessionID, executionID: this.executionID })

    try {
      const value = await op.execute(runtime)
      resolveActive(value)
      op.resolve(value)
    } catch (error) {
      rejectActive(error)
      op.reject(error)
    } finally {
      if (this.active?.turnID === op.turnID) {
        this.active = undefined
      }
      notify({ type: "finished", sessionID: this.sessionID, executionID: this.executionID })
      this.statusValue = "idle"
      this.resolveIdleIfNeeded()
      setAggregatedSessionStatus(
        this.sessionID,
        sessionHasExecutionWork(this.sessionID) ? { type: "busy" } : { type: "idle" },
      )
      scheduleCapacityWake()
    }
    return true
  }

  private resolveIdleIfNeeded() {
    if (this.active || this.queueLength() > 0) return
    const waiters = this.idleWaiters.splice(0)
    for (const waiter of waiters) {
      waiter()
    }
  }

  private releasePendingSteerHandoff(op: QueuedOperation<unknown>) {
    const activeTurnID = op.steerHandoffForTurnID
    if (!activeTurnID || this.active?.turnID !== activeTurnID) return
    if (!this.active.pendingSteerTurnIDs.delete(op.turnID)) return
    this.active.pendingSteerCount = Math.max(0, this.active.pendingSteerCount - 1)
  }
}

function normalizeExecutionID(input: Pick<EnqueueOperationInput<unknown>, "executionID" | "targetKind">) {
  const targetKind = input.targetKind ?? "active-thread"
  const executionID = input.executionID?.trim()
  if (executionID) return executionID
  return targetKind === "active-thread"
    ? "active-thread"
    : `detached-${Identifier.ascending("turn")}`
}

function runnerKey(sessionID: string, executionID: string) {
  return `${sessionID}\u0000${executionID}`
}

function getOrCreateRunner<T>(input: EnqueueOperationInput<T>) {
  const executionID = normalizeExecutionID(input)
  const key = runnerKey(input.sessionID, executionID)
  let runner = runners.get(key)
  const targetKind = input.targetKind ?? "active-thread"
  if (runner && runner.targetKind !== targetKind) {
    throw new Error(
      `Execution '${executionID}' cannot change target kind from '${runner.targetKind}' to '${targetKind}'.`,
    )
  }
  if (!runner) {
    runner = new SessionRunner({
      sessionID: input.sessionID,
      executionID,
      targetKind,
      initialHeadMessageID: input.initialHeadMessageID,
    })
    runners.set(key, runner)
  } else {
    runner.syncInitialHeadMessageID(input.initialHeadMessageID)
  }
  return runner
}

export function enqueuePrompt<T>(input: EnqueuePromptInput<T>): SessionExecutionHandle<T> {
  return getOrCreateRunner(input).enqueuePrompt(input)
}

export function enqueueResume<T>(input: EnqueueOperationInput<T>): SessionExecutionHandle<T> {
  return getOrCreateRunner(input).enqueue(input)
}

function runnersForSession(sessionID: string) {
  return [...runners.values()].filter((runner) => runner.sessionID === sessionID)
}

export function cancel(sessionID: string, executionID?: string) {
  if (executionID) {
    return runners.get(runnerKey(sessionID, executionID))?.cancel() ?? false
  }
  const sessionRunners = runnersForSession(sessionID)
  const activeThread = sessionRunners.find((runner) => runner.executionID === "active-thread")
  return activeThread?.cancel() ?? sessionRunners.find((runner) => runner.status() === "running")?.cancel() ?? false
}

export function cancelExecution(
  sessionID: string,
  executionID: string,
  options?: { cancelQueued?: boolean },
): SessionRunnerCancelResult {
  return runners.get(runnerKey(sessionID, executionID))?.cancelSession(options) ?? {
    sessionID,
    executionID,
    activeCancelled: false,
    queuedCancelled: 0,
    queuedCancelledTurnIDs: [],
    cancelled: false,
  }
}

export function cancelSession(sessionID: string, options?: { cancelQueued?: boolean }): SessionRunnerCancelResult {
  const results = runnersForSession(sessionID).map((runner) => runner.cancelSession(options))
  return results.reduce<SessionRunnerCancelResult>((total, result) => ({
    sessionID,
    activeCancelled: total.activeCancelled || result.activeCancelled,
    queuedCancelled: total.queuedCancelled + result.queuedCancelled,
    queuedCancelledTurnIDs: [...total.queuedCancelledTurnIDs, ...result.queuedCancelledTurnIDs],
    cancelled: total.cancelled || result.cancelled,
  }), {
    sessionID,
    activeCancelled: false,
    queuedCancelled: 0,
    queuedCancelledTurnIDs: [],
    cancelled: false,
  })
}

export function isSessionOperationCancelledError(error: unknown) {
  return error instanceof SessionOperationCancelledError
}

export function consumePendingSteer(sessionID: string, turnID: string) {
  const runner = runnersForSession(sessionID).find((candidate) => candidate.snapshot().activeTurnID === turnID)
  return runner?.consumePendingSteer(turnID) ?? Promise.resolve(0)
}

export function waitForIdle(sessionID: string) {
  return Promise.all(runnersForSession(sessionID).map((runner) => runner.waitForIdle())).then(() => undefined)
}

export function info(sessionID: string) {
  const allSnapshots = runnersForSession(sessionID).map((runner) => runner.snapshot())
  if (allSnapshots.length === 0) return null
  const activeSnapshots = allSnapshots.filter(
    (item) => item.status === "running" || item.status === "cancelling" || item.queueLength > 0,
  )
  const snapshots = activeSnapshots.length > 0 ? activeSnapshots : allSnapshots
  const preferred = snapshots.find((item) => item.targetKind === "active-thread") ?? snapshots[0]!
  const started = activeSnapshots
    .map((item) => item.startedAt)
    .filter((value): value is number => value !== null)
  return {
    ...preferred,
    status: activeSnapshots.length > 0 ? preferred.status : "idle" as const,
    startedAt: started.length > 0 ? Math.min(...started) : null,
    activeForMs: Math.max(...snapshots.map((item) => item.activeForMs)),
    queueLength: snapshots.reduce((sum, item) => sum + item.queueLength, 0),
    queuedOpCount: snapshots.reduce((sum, item) => sum + item.queuedOpCount, 0),
    pendingSteerCount: snapshots.reduce((sum, item) => sum + item.pendingSteerCount, 0),
  }
}

export function infoForExecution(sessionID: string, executionID: string) {
  return runners.get(runnerKey(sessionID, executionID))?.snapshot() ?? null
}

export function snapshot() {
  return [...runners.values()]
    .map((runner) => runner.snapshot())
    .filter((item) => item.status === "running" || item.status === "cancelling" || item.queueLength > 0)
    .sort((left, right) => (left.startedAt ?? Number.MAX_SAFE_INTEGER) - (right.startedAt ?? Number.MAX_SAFE_INTEGER))
}

export function isRunning(sessionID: string) {
  return runnersForSession(sessionID).some((runner) => {
    const status = runner.status()
    return status === "running" || status === "cancelling"
  })
}

export function subscribe(subscriber: (event: SessionRunnerEvent) => void) {
  subscribers.add(subscriber)
  return () => {
    subscribers.delete(subscriber)
  }
}

export function runtimeLimitsSnapshot() {
  const limits = getSessionLimits()
  const active = activeRunnerSnapshots()
  const byDirectory = new Map<string, number>()
  for (const runner of active) {
    if (!runner.directory) continue
    byDirectory.set(runner.directory, (byDirectory.get(runner.directory) ?? 0) + 1)
  }

  return {
    limits,
    running: active.length,
    runningByDirectory: [...byDirectory.entries()].map(([directory, count]) => ({ directory, count })),
  }
}
