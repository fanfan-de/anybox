import * as Identifier from "#id/id.ts"
import * as EventStore from "#session/runtime/event-store.ts"
import * as RuntimeEvent from "#session/runtime/runtime-event.ts"
import * as Log from "#util/log.ts"

const log = Log.create({ service: "session.orchestrator" })

type PendingStreamEvent = {
  [TType in RuntimeEvent.TransientStreamEventType]: {
    type: TType
    payload: RuntimeEvent.RuntimeEventPayloadByType[TType]
  }
}[RuntimeEvent.TransientStreamEventType]

type PendingDeltaStreamEventType = "text.part.delta" | "reasoning.part.delta" | "tool.input.delta"

type PendingDeltaStreamEvent = PendingStreamEvent & {
  type: PendingDeltaStreamEventType
  payload: RuntimeEvent.RuntimeEventPayloadByType[PendingDeltaStreamEventType]
}

export type ConcurrentInputDisposition = "steer" | "interrupt"

function isPendingDeltaStreamEvent(event: PendingStreamEvent): event is PendingDeltaStreamEvent {
  return event.type === "text.part.delta" || event.type === "reasoning.part.delta" || event.type === "tool.input.delta"
}

function canCoalescePendingStreamEvent(current: PendingStreamEvent, next: PendingStreamEvent) {
  if (!isPendingDeltaStreamEvent(current) || !isPendingDeltaStreamEvent(next)) return false
  if (current.type !== next.type) return false
  if (current.type === "tool.input.delta" && next.type === "tool.input.delta") {
    return (
      current.payload.messageID === next.payload.messageID &&
      current.payload.partID === next.payload.partID &&
      current.payload.toolCallID === next.payload.toolCallID
    )
  }

  return (
    current.payload.messageID === next.payload.messageID &&
    current.payload.partID === next.payload.partID
  )
}

function coalescePendingStreamEvent(current: PendingDeltaStreamEvent, next: PendingDeltaStreamEvent): PendingDeltaStreamEvent {
  return {
    type: next.type,
    payload: {
      ...next.payload,
      delta: current.payload.delta + next.payload.delta,
    },
  } as PendingDeltaStreamEvent
}

function readToolCallID(
  payload: RuntimeEvent.RuntimeEventPayloadByType[
    | "tool.call.pending"
    | "tool.call.started"
    | "tool.call.waiting_approval"
    | "tool.call.approved"
    | "tool.call.denied"
    | "tool.call.cancelled"
    | "tool.call.completed"
    | "tool.call.failed"
  ],
) {
  return payload.part.callID
}

export interface TurnContext {
  readonly sessionID: string
  readonly turnID: string
  readonly executionID: string
  readonly targetKind: "active-thread" | "detached-branch"
  readonly initialParentMessageID?: string | null
  readonly steerable: boolean
  emit<TType extends RuntimeEvent.RuntimeEventType>(
    type: TType,
    payload: RuntimeEvent.RuntimeEventPayloadByType[TType],
  ): RuntimeEvent.RuntimeEvent
  emitStream<TType extends RuntimeEvent.TransientStreamEventType>(
    type: TType,
    payload: RuntimeEvent.RuntimeEventPayloadByType[TType],
  ): void
  flushStreamEvents(): void
  canAcceptSteerHandoff(): boolean
  concurrentInputDisposition(): ConcurrentInputDisposition
  setAcceptingSteer(accepting: boolean): void
  close(): void
}

const activeTurns = new Map<string, TurnRuntime>()

class TurnRuntime implements TurnContext {
  readonly sessionID: string
  readonly turnID: string
  readonly executionID: string
  readonly targetKind: "active-thread" | "detached-branch"
  readonly initialParentMessageID?: string | null
  readonly steerable: boolean
  private readonly factory: ReturnType<typeof RuntimeEvent.createRuntimeEventFactory>
  private readonly pendingStreamEvents: PendingStreamEvent[] = []
  private streamFlushScheduled = false
  private closed = false
  private terminalEvent: RuntimeEvent.RuntimeEvent | undefined
  private acceptingSteer = true
  private readonly preparingToolCallIDs = new Set<string>()

  constructor(input: {
    sessionID: string
    turnID: string
    executionID: string
    targetKind: "active-thread" | "detached-branch"
    initialParentMessageID?: string | null
    steerable: boolean
  }) {
    this.sessionID = input.sessionID
    this.turnID = input.turnID
    this.executionID = input.executionID
    this.targetKind = input.targetKind
    this.initialParentMessageID = input.initialParentMessageID
    this.steerable = input.steerable
    this.factory = RuntimeEvent.createRuntimeEventFactory({
      sessionID: input.sessionID,
      turnID: input.turnID,
      executionID: input.executionID,
      targetKind: input.targetKind,
    })
  }

  emit<TType extends RuntimeEvent.RuntimeEventType>(
    type: TType,
    payload: RuntimeEvent.RuntimeEventPayloadByType[TType],
  ) {
    if (this.closed) {
      throw new Error(`Turn '${this.turnID}' is already closed.`)
    }

    if (this.terminalEvent) {
      return this.terminalEvent
    }

    this.flushStreamEvents()
    this.applyConcurrentInputTransition(type, payload)
    const event = this.emitNow(type, payload)

    if (RuntimeEvent.isTerminalRuntimeEvent(event)) {
      this.acceptingSteer = false
      this.preparingToolCallIDs.clear()
      this.terminalEvent = event
    }

    return event
  }

  emitStream<TType extends RuntimeEvent.TransientStreamEventType>(
    type: TType,
    payload: RuntimeEvent.RuntimeEventPayloadByType[TType],
  ) {
    if (this.closed || this.terminalEvent) return

    this.applyConcurrentInputTransition(type, payload)
    const next = { type, payload } as PendingStreamEvent
    const previous = this.pendingStreamEvents[this.pendingStreamEvents.length - 1]
    if (previous && canCoalescePendingStreamEvent(previous, next)) {
      this.pendingStreamEvents[this.pendingStreamEvents.length - 1] = coalescePendingStreamEvent(
        previous as PendingDeltaStreamEvent,
        next as PendingDeltaStreamEvent,
      )
    } else {
      this.pendingStreamEvents.push(next)
    }
    this.scheduleStreamFlush()
  }

  flushStreamEvents() {
    this.streamFlushScheduled = false

    while (!this.terminalEvent && this.pendingStreamEvents.length > 0) {
      const pending = this.pendingStreamEvents.shift()!
      this.emitNow(
        pending.type as RuntimeEvent.TransientStreamEventType,
        pending.payload as RuntimeEvent.RuntimeEventPayloadByType[RuntimeEvent.TransientStreamEventType],
      )
    }
  }

  canAcceptSteerHandoff() {
    return (
      this.steerable &&
      this.acceptingSteer &&
      !this.closed &&
      !this.terminalEvent
    )
  }

  concurrentInputDisposition(): ConcurrentInputDisposition {
    return this.preparingToolCallIDs.size > 0 ? "interrupt" : "steer"
  }

  setAcceptingSteer(accepting: boolean) {
    if (this.closed || this.terminalEvent) {
      this.acceptingSteer = false
      return
    }
    this.acceptingSteer = accepting
  }

  close() {
    if (this.closed) return
    this.flushStreamEvents()
    this.closed = true

    activeTurns.delete(this.turnID)
  }

  private emitNow<TType extends RuntimeEvent.RuntimeEventType>(
    type: TType,
    payload: RuntimeEvent.RuntimeEventPayloadByType[TType],
  ) {
    const event = this.factory.next(type, payload)
    EventStore.appendAndProject(event)
    return event
  }

  private applyConcurrentInputTransition<TType extends RuntimeEvent.RuntimeEventType>(
    type: TType,
    payload: RuntimeEvent.RuntimeEventPayloadByType[TType],
  ) {
    switch (type) {
      case "tool.call.pending": {
        const toolCallID = readToolCallID(payload as RuntimeEvent.RuntimeEventPayloadByType["tool.call.pending"])
        if (toolCallID) this.preparingToolCallIDs.add(toolCallID)
        return
      }
      case "tool.input.delta": {
        const toolCallID = (payload as RuntimeEvent.RuntimeEventPayloadByType["tool.input.delta"]).toolCallID
        if (toolCallID) this.preparingToolCallIDs.add(toolCallID)
        return
      }
      case "tool.call.started":
      case "tool.call.waiting_approval":
      case "tool.call.approved":
      case "tool.call.denied":
      case "tool.call.cancelled":
      case "tool.call.completed":
      case "tool.call.failed": {
        const toolCallID = readToolCallID(
          payload as RuntimeEvent.RuntimeEventPayloadByType[
            | "tool.call.started"
            | "tool.call.waiting_approval"
            | "tool.call.approved"
            | "tool.call.denied"
            | "tool.call.cancelled"
            | "tool.call.completed"
            | "tool.call.failed"
          ],
        )
        if (toolCallID) this.preparingToolCallIDs.delete(toolCallID)
        return
      }
    }
  }

  private scheduleStreamFlush() {
    if (this.streamFlushScheduled) return
    this.streamFlushScheduled = true

    setTimeout(() => {
      try {
        this.flushStreamEvents()
      } catch (error) {
        log.error("failed to flush stream runtime events", { error })
      }
    }, 0)
  }
}

export function startTurn(input: {
  sessionID: string
  turnID?: string
  executionID?: string
  targetKind?: "active-thread" | "detached-branch"
  initialParentMessageID?: string | null
  userMessageID?: string
  agent?: string
  model?: {
    providerID: string
    modelID: string
  }
  resume?: boolean
  steerable?: boolean
}) {
  const turnID = input.turnID ?? Identifier.ascending("turn")
  if (activeTurns.has(turnID)) {
    throw new Error(`Turn '${turnID}' is already active.`)
  }
  const executionID = input.executionID?.trim() || "active-thread"
  if (
    [...activeTurns.values()].some(
      (turn) => turn.sessionID === input.sessionID && turn.executionID === executionID,
    )
  ) {
    throw new Error(
      `Execution '${executionID}' in session '${input.sessionID}' already has an active turn.`,
    )
  }

  const turn = new TurnRuntime({
    sessionID: input.sessionID,
    turnID,
    executionID,
    targetKind: input.targetKind ?? "active-thread",
    initialParentMessageID: input.initialParentMessageID,
    steerable: input.steerable ?? true,
  })
  activeTurns.set(turn.turnID, turn)
  turn.emit("turn.started", {
    userMessageID: input.userMessageID,
    agent: input.agent,
    model: input.model,
    resume: input.resume,
    executionID: turn.executionID,
    targetKind: turn.targetKind,
    initialParentMessageID: turn.initialParentMessageID,
  })
  return turn
}

export function activeTurn(sessionID: string, turnID?: string) {
  if (turnID) {
    const turn = activeTurns.get(turnID)
    return turn?.sessionID === sessionID ? turn : undefined
  }
  const turns = [...activeTurns.values()].filter((turn) => turn.sessionID === sessionID)
  return turns.find((turn) => turn.targetKind === "active-thread") ?? turns[0]
}

export function activeTurnsForSession(sessionID: string) {
  return [...activeTurns.values()].filter((turn) => turn.sessionID === sessionID)
}

export function finishTurn(turn: TurnContext) {
  turn.close()
}
