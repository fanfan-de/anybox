export interface AgentSessionTurnTarget {
  sessionID: string
  turnID: string
  currentSegmentID?: string
  assistantThreadMessageID?: string
}

interface AgentSessionEventRouterOptions {
  maxSeenCursors?: number
  maxSettledTurns?: number
}

export class AgentSessionEventRouter {
  private readonly maxSeenCursors: number
  private readonly maxSettledTurns: number
  private readonly seenCursorsBySession: Record<string, string[]> = {}
  private readonly turnTargets: Record<string, AgentSessionTurnTarget> = {}
  private readonly settledBackendTurns: Record<string, number> = {}

  constructor(options: AgentSessionEventRouterOptions = {}) {
    this.maxSeenCursors = options.maxSeenCursors ?? 200
    this.maxSettledTurns = options.maxSettledTurns ?? 500
  }

  turnTargetKey(backendSessionID: string, turnID: string) {
    return `${backendSessionID}:${turnID}`
  }

  rememberSeenCursor(sessionID: string, cursor: string) {
    if (!cursor) return false

    const current = this.seenCursorsBySession[sessionID] ?? []
    if (current.includes(cursor)) {
      return true
    }

    const next = [...current, cursor]
    if (next.length > this.maxSeenCursors) {
      next.splice(0, next.length - this.maxSeenCursors)
    }
    this.seenCursorsBySession[sessionID] = next
    return false
  }

  clearSeenCursors(sessionID: string) {
    delete this.seenCursorsBySession[sessionID]
  }

  getTurnTarget(backendSessionID: string, turnID: string) {
    return this.turnTargets[this.turnTargetKey(backendSessionID, turnID)] ?? null
  }

  setTurnTarget(backendSessionID: string, turnID: string, target: AgentSessionTurnTarget) {
    this.turnTargets[this.turnTargetKey(backendSessionID, turnID)] = target
  }

  cleanupTurnTarget(backendSessionID: string | undefined, turnID: string | undefined) {
    if (!backendSessionID || !turnID) return
    delete this.turnTargets[this.turnTargetKey(backendSessionID, turnID)]
  }

  markBackendTurnSettled(backendSessionID: string | undefined, turnID: string | undefined, settledAt = Date.now()) {
    if (!backendSessionID || !turnID) return

    this.settledBackendTurns[this.turnTargetKey(backendSessionID, turnID)] = settledAt

    const entries = Object.entries(this.settledBackendTurns)
    if (entries.length <= this.maxSettledTurns) return

    entries
      .sort((left, right) => left[1] - right[1])
      .slice(0, entries.length - this.maxSettledTurns)
      .forEach(([key]) => {
        delete this.settledBackendTurns[key]
      })
  }

  hasBackendTurnSettled(backendSessionID: string | undefined, turnID: string | undefined) {
    if (!backendSessionID || !turnID) return false
    return Boolean(this.settledBackendTurns[this.turnTargetKey(backendSessionID, turnID)])
  }

  cleanupUISession(sessionID: string) {
    delete this.seenCursorsBySession[sessionID]

    for (const [turnKey, target] of Object.entries(this.turnTargets)) {
      if (target.sessionID === sessionID) {
        delete this.turnTargets[turnKey]
      }
    }
  }

  reset() {
    for (const key of Object.keys(this.seenCursorsBySession)) {
      delete this.seenCursorsBySession[key]
    }
    for (const key of Object.keys(this.turnTargets)) {
      delete this.turnTargets[key]
    }
    for (const key of Object.keys(this.settledBackendTurns)) {
      delete this.settledBackendTurns[key]
    }
  }
}

export function createAgentSessionEventRouter(options?: AgentSessionEventRouterOptions) {
  return new AgentSessionEventRouter(options)
}
