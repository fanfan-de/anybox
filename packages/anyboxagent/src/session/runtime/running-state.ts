import * as SessionRunner from "#session/runtime/session-runner.ts"

type RunningSession = {
  abort: AbortController
  startedAt?: number
  reason?: string
}

const runningSessions: Record<string, RunningSession> = Object.create(null)
const subscribers = new Set<(event: RunningStateEvent) => void>()

export type { RunningSession }

export type RunningStateEvent = {
  type: "registered" | "finished" | "cancelled"
  sessionID: string
}

export type RunningSessionSnapshot = {
  sessionID: string
  startedAt: number | null
  activeForMs: number
  reason?: string
  status?: SessionRunner.SessionRunnerStatus
  activeTurnID?: string | null
  directory?: string
  queueLength?: number
  queuedOpCount?: number
  pendingSteerCount?: number
}

export function state() {
  return runningSessions
}

export function isRunning(sessionID: string) {
  return SessionRunner.isRunning(sessionID) || Boolean(runningSessions[sessionID])
}

export function info(sessionID: string): RunningSessionSnapshot | null {
  const runner = SessionRunner.info(sessionID)
  if (runner && (runner.status === "running" || runner.status === "cancelling" || runner.queueLength > 0)) {
    return {
      sessionID: runner.sessionID,
      startedAt: runner.startedAt,
      activeForMs: runner.activeForMs,
      reason: runner.reason,
      status: runner.status,
      activeTurnID: runner.activeTurnID,
      directory: runner.directory,
      queueLength: runner.queueLength,
      queuedOpCount: runner.queuedOpCount,
      pendingSteerCount: runner.pendingSteerCount,
    }
  }

  const current = runningSessions[sessionID]
  if (!current) return null
  const startedAt = current.startedAt ?? Date.now()

  return {
    sessionID,
    startedAt,
    activeForMs: Math.max(0, Date.now() - startedAt),
    reason: current.reason,
    status: "running",
    queueLength: 0,
    queuedOpCount: 0,
    pendingSteerCount: 0,
  }
}

export function snapshot(): RunningSessionSnapshot[] {
  const runnerSnapshots = SessionRunner.snapshot().map((runner) => ({
    sessionID: runner.sessionID,
    startedAt: runner.startedAt,
    activeForMs: runner.activeForMs,
    reason: runner.reason,
    status: runner.status,
    activeTurnID: runner.activeTurnID,
    directory: runner.directory,
    queueLength: runner.queueLength,
    queuedOpCount: runner.queuedOpCount,
    pendingSteerCount: runner.pendingSteerCount,
  }))
  const runnerSessionIDs = new Set(runnerSnapshots.map((item) => item.sessionID))
  const legacySnapshots = Object.keys(runningSessions)
    .filter((sessionID) => !runnerSessionIDs.has(sessionID))
    .map((sessionID) => info(sessionID))
    .filter((value): value is RunningSessionSnapshot => Boolean(value))
  return [...runnerSnapshots, ...legacySnapshots]
    .sort((left, right) => (left.startedAt ?? Number.MAX_SAFE_INTEGER) - (right.startedAt ?? Number.MAX_SAFE_INTEGER))
}

function notify(event: RunningStateEvent) {
  for (const subscriber of [...subscribers]) {
    try {
      subscriber(event)
    } catch {
      subscribers.delete(subscriber)
    }
  }
}

export function subscribe(subscriber: (event: RunningStateEvent) => void) {
  subscribers.add(subscriber)
  const unsubscribeRunner = SessionRunner.subscribe((event) => {
    if (event.type === "queued" || event.type === "steered") return
    subscriber({
      type: event.type,
      sessionID: event.sessionID,
    })
  })
  return () => {
    subscribers.delete(subscriber)
    unsubscribeRunner()
  }
}

export function register(
  sessionID: string,
  controller: AbortController,
  options?: {
    startedAt?: number
    reason?: string
  },
) {
  if (SessionRunner.isRunning(sessionID)) return false
  if (runningSessions[sessionID]) return false

  runningSessions[sessionID] = {
    abort: controller,
    startedAt: options?.startedAt ?? Date.now(),
    reason: options?.reason,
  }
  notify({ type: "registered", sessionID })
  return true
}

export function finish(sessionID: string, controller?: AbortController) {
  const current = runningSessions[sessionID]
  if (!current) return
  if (controller && current.abort !== controller) return

  delete runningSessions[sessionID]
  notify({ type: "finished", sessionID })
}

export async function waitForStop(sessionID: string) {
  await SessionRunner.waitForIdle(sessionID)
  while (runningSessions[sessionID]) await new Promise((resolve) => setTimeout(resolve, 25))
}

export function cancel(sessionID: string) {
  if (SessionRunner.cancel(sessionID)) return true
  const current = runningSessions[sessionID]
  if (!current) return false

  current.abort.abort()
  delete runningSessions[sessionID]
  notify({ type: "cancelled", sessionID })
  return true
}

export function cancelSession(sessionID: string, options?: { cancelQueued?: boolean }) {
  const runnerResult = SessionRunner.cancelSession(sessionID, options)
  if (runnerResult.cancelled) return runnerResult

  const current = runningSessions[sessionID]
  if (!current) return runnerResult

  current.abort.abort()
  delete runningSessions[sessionID]
  notify({ type: "cancelled", sessionID })
  return {
    ...runnerResult,
    activeCancelled: true,
    cancelled: true,
  }
}

export function cancelExecution(
  sessionID: string,
  executionID: string,
  options?: { cancelQueued?: boolean },
) {
  return SessionRunner.cancelExecution(sessionID, executionID, options)
}
