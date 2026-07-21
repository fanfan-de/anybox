import * as Identifier from "#id/id.ts"
import * as LiveStreamHub from "#session/runtime/live-stream-hub.ts"
import * as Message from "#session/core/message.ts"
import * as Orchestrator from "#session/runtime/orchestrator.ts"
import * as RuntimeEvent from "#session/runtime/runtime-event.ts"
import { isSessionLimitError } from "#session/runtime/session-limits.ts"
import * as SessionRunner from "#session/runtime/session-runner.ts"
import * as Log from "#util/log.ts"
import * as TurnError from "#session/core/turn-error.ts"

const log = Log.create({ service: "server.session" })
const STREAM_HEARTBEAT_INTERVAL_MS = 3000
const STREAM_BACKPRESSURE_TIMEOUT_MS = 30_000
const STREAM_BACKPRESSURE_POLL_MS = 25

type SessionStreamResult = {
  info: Message.MessageInfo
  parts: Message.Part[]
}

type ExecutionModePayload = {
  sessionID: string
  turnID: string
  mode: SessionRunner.SessionExecutionMode
}

function normalizeLogError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function toSSE(event: string, data: unknown, id?: string) {
  const lines = []
  if (id) lines.push(`id: ${id}`)
  lines.push(`event: ${event}`)
  lines.push(`data: ${JSON.stringify(data)}`)
  return `${lines.join("\n")}\n\n`
}

function createSSEHeaders(requestId?: string) {
  const headers: Record<string, string> = {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  }
  if (requestId) headers["x-request-id"] = requestId
  return headers
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function executionModePayload(input: {
  sessionID: string
  handle?: SessionRunner.SessionExecutionHandle<SessionStreamResult>
}): ExecutionModePayload | undefined {
  if (!input.handle) return undefined
  return {
    sessionID: input.sessionID,
    turnID: input.handle.turnID,
    mode: input.handle.mode,
  }
}

function replayRuntimeEvents(input: {
  sessionID: string
  turnID?: string
  sinceSeq?: number
}) {
  if (input.turnID) {
    return LiveStreamHub.listRecentEvents({
      sessionID: input.sessionID,
      turnID: input.turnID,
      sinceSeq: input.sinceSeq,
    })
  }

  const activeTurn = Orchestrator.activeTurn(input.sessionID)
  if (activeTurn) {
    return LiveStreamHub.listRecentEvents({
      sessionID: input.sessionID,
      turnID: activeTurn.turnID,
    })
  }

  return []
}

export function parseSinceSeq(value: string | undefined) {
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  return Math.floor(parsed)
}

export function parseReplayCursor(value: string | undefined) {
  if (!value) return undefined
  return LiveStreamHub.parseCursor(value.trim())
}

export function serializeReplayCursor(cursor: LiveStreamHub.LiveStreamCursor) {
  return LiveStreamHub.serializeCursor(cursor)
}

function runtimeEventSSEID(event: RuntimeEvent.RuntimeEvent) {
  return LiveStreamHub.serializeCursor(LiveStreamHub.cursorForEvent(event))
}

async function waitForControllerCapacity(
  controller: ReadableStreamDefaultController<Uint8Array>,
  input: {
    sessionID: string
    requestId?: string
    streamType: "event" | "execution"
  },
) {
  if ((controller.desiredSize ?? 1) > 0) return true

  const startedAt = Date.now()
  while (Date.now() - startedAt < STREAM_BACKPRESSURE_TIMEOUT_MS) {
    await sleep(STREAM_BACKPRESSURE_POLL_MS)
    if ((controller.desiredSize ?? 1) > 0) return true
  }

  log.warn("closing slow session stream client", {
    sessionID: input.sessionID,
    requestId: input.requestId,
    streamType: input.streamType,
    desiredSize: controller.desiredSize,
    timeoutMs: STREAM_BACKPRESSURE_TIMEOUT_MS,
  })
  return false
}

async function sendRuntimeEvent(
  send: (event: string, data: unknown, id?: string) => Promise<boolean>,
  event: RuntimeEvent.RuntimeEvent,
) {
  return send("runtime", event, runtimeEventSSEID(event))
}

function createTransportTerminalEvent(input: {
  sessionID: string
  turnID?: string
  seq?: number
  type: "turn.completed" | "turn.failed" | "turn.cancelled"
  payload:
    | RuntimeEvent.RuntimeEventPayloadByType["turn.completed"]
    | RuntimeEvent.RuntimeEventPayloadByType["turn.failed"]
    | RuntimeEvent.RuntimeEventPayloadByType["turn.cancelled"]
}) {
  return RuntimeEvent.RuntimeEvent.parse({
    schemaVersion: 2,
    scope: input.turnID ? "turn" : "session",
    eventID: Identifier.ascending("event"),
    sessionID: input.sessionID,
    turnID: input.turnID ?? null,
    seq: input.seq ?? 1,
    timestamp: Date.now(),
    type: input.type,
    payload: input.payload,
  })
}

function failedRuntimePayload(error: unknown, phase: string, retryable = false) {
  const errorInfo = TurnError.fromUnknown(error)
  return {
    error: errorInfo.message,
    errorInfo,
    code: isSessionLimitError(error) ? error.code : undefined,
    phase,
    retryable: retryable || errorInfo.retryable,
  } satisfies RuntimeEvent.RuntimeEventPayloadByType["turn.failed"]
}

function isCancellationError(error: unknown) {
  return (
    SessionRunner.isSessionOperationCancelledError(error) ||
    (
      error instanceof Error &&
      (error.name === "AbortError" || error.message === "Prompt aborted")
    )
  )
}

function cancelledRuntimePayload(error: unknown, reason: RuntimeEvent.RuntimeEventPayloadByType["turn.cancelled"]["reason"] = "user") {
  return {
    reason,
    detail: error instanceof Error ? error.message : String(error),
  } satisfies RuntimeEvent.RuntimeEventPayloadByType["turn.cancelled"]
}

function isFinalFinishReason(finishReason?: string) {
  return Boolean(finishReason && !["tool-calls", "unknown"].includes(finishReason))
}

function isBlockingToolPart(part: Message.Part) {
  if (part.type !== "tool") return false
  if (part.state.status === "waiting-approval") return true
  const metadata = part.state.status === "completed" ? part.state.metadata : undefined
  return Boolean(
    metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    "kind" in metadata &&
    metadata.kind === "ask-user-question" &&
    metadata.answered !== true,
  )
}

function createResolvedFallbackTerminalEvent(input: {
  sessionID: string
  turnID?: string
  seq: number
  resolved: SessionStreamResult
}) {
  const assistant = input.resolved.info.role === "assistant" ? input.resolved.info : undefined
  const finishReason = assistant?.finishReason
  const hasBlockingPart = input.resolved.parts.some(isBlockingToolPart)
  const stoppedWithoutCompletion = assistant && !hasBlockingPart && !isFinalFinishReason(finishReason)

  if (assistant?.error || stoppedWithoutCompletion) {
    return createTransportTerminalEvent({
      sessionID: input.sessionID,
      turnID: input.turnID,
      seq: input.seq,
      type: "turn.failed",
      payload: {
        ...failedRuntimePayload(
          assistant?.error
            ? "Assistant turn failed."
            : "Assistant turn stopped before producing a final response.",
          "execution",
          true,
        ),
        message: input.resolved.info,
        parts: input.resolved.parts,
      },
    })
  }

  return createTransportTerminalEvent({
    sessionID: input.sessionID,
    turnID: input.turnID,
    seq: input.seq,
    type: "turn.completed",
    payload: {
      status: hasBlockingPart ? "blocked" : "completed",
      finishReason,
      message: input.resolved.info,
      parts: input.resolved.parts,
    },
  })
}

export function createSessionExecutionErrorStream(input: {
  sessionID: string
  requestId?: string
  turnID?: string
  error: unknown
  phase?: string
}) {
  const event = createTransportTerminalEvent({
    sessionID: input.sessionID,
    turnID: input.turnID,
    type: "turn.failed",
    payload: failedRuntimePayload(input.error, input.phase ?? "execution"),
  })

  return new Response(toSSE("runtime", event, runtimeEventSSEID(event)), {
    headers: createSSEHeaders(input.requestId),
  })
}

function cancelActiveRuntimeTurn(input: {
  sessionID: string
  reason: RuntimeEvent.RuntimeEventPayloadByType["turn.cancelled"]["reason"]
  detail?: string
}) {
  const turn = Orchestrator.activeTurn(input.sessionID)
  if (!turn) return

  try {
    turn.emit("turn.state.changed", {
      phase: "cancelled",
      reason: input.detail ?? input.reason,
    })
    turn.emit("turn.cancelled", {
      reason: input.reason,
      detail: input.detail,
    })
  } catch (error) {
    log.warn("failed to emit runtime cancellation event", {
      sessionID: input.sessionID,
      error: normalizeLogError(error),
    })
  }
}

export function createSessionEventStream(input: {
  sessionID: string
  requestId?: string
  heartbeatIntervalMs?: number
  since?: LiveStreamHub.LiveStreamCursor
  invalidReplayCursor?: boolean
}) {
  let cancelled = false
  const heartbeatIntervalMs = input.heartbeatIntervalMs ?? STREAM_HEARTBEAT_INTERVAL_MS
  const subscription = LiveStreamHub.subscribe({
    sessionID: input.sessionID,
    closeOnTerminalTurn: false,
  })
  const replay: LiveStreamHub.ReplayResult = input.invalidReplayCursor
    ? { status: "resync-required", reason: "cursor-invalid", events: [] }
    : LiveStreamHub.replay({
        sessionID: input.sessionID,
        cursor: input.since,
      })

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      let lastChunkAt = Date.now()

      const closeSlowClient = () => {
        cancelled = true
        subscription.close()
        try {
          controller.close()
        } catch {
          // The stream may already be closed by the runtime.
        }
      }

      const enqueue = async (chunk: string) => {
        if (cancelled) return false
        if (!await waitForControllerCapacity(controller, {
          sessionID: input.sessionID,
          requestId: input.requestId,
          streamType: "event",
        })) {
          closeSlowClient()
          return false
        }

        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          cancelled = true
          subscription.close()
          return false
        }

        lastChunkAt = Date.now()
        return true
      }

      const send = (event: string, data: unknown, id?: string) => {
        return enqueue(toSSE(event, data, id))
      }

      const sendKeepalive = () => {
        return enqueue(`: keepalive ${Date.now()}\n\n`)
      }

      void (async () => {
        if (replay.status === "resync-required") {
          if (!await send("resync-required", {
            schemaVersion: 2,
            sessionID: input.sessionID,
            reason: replay.reason,
            processEpoch: LiveStreamHub.getProcessEpoch(),
          })) {
            subscription.close()
            return
          }
        } else {
          for (const event of replay.events) {
            if (!await sendRuntimeEvent(send, event)) {
              subscription.close()
              return
            }
          }
        }
        let nextEventPromise = subscription.next()

        while (!cancelled) {
          const timeoutMs = Math.max(0, heartbeatIntervalMs - (Date.now() - lastChunkAt))
          const next = await Promise.race([
            nextEventPromise.then((event) => ({ type: "event" as const, event })),
            sleep(timeoutMs).then(() => ({ type: "heartbeat" as const })),
          ])

          if (next.type === "heartbeat") {
            if (!await sendKeepalive()) break
            continue
          }

          nextEventPromise = subscription.next()

          if (!next.event) {
            break
          }

          if (!await sendRuntimeEvent(send, next.event)) break
        }

        subscription.close()
        if (!cancelled) controller.close()
      })().catch(async (error) => {
        log.error("session event stream crashed", {
          sessionID: input.sessionID,
          requestId: input.requestId,
          error: normalizeLogError(error),
        })
        await sendRuntimeEvent(send, createTransportTerminalEvent({
          sessionID: input.sessionID,
          type: "turn.failed",
          payload: {
            error: error instanceof Error ? error.message : String(error),
            phase: "stream",
            retryable: true,
          },
        }))
        subscription.close()
        if (!cancelled) controller.close()
      })
    },
    cancel() {
      cancelled = true
      subscription.close()
    },
  })

  return new Response(stream, {
    headers: createSSEHeaders(input.requestId),
  })
}

export function createSessionExecutionStream(input: {
  sessionID: string
  handle?: SessionRunner.SessionExecutionHandle<SessionStreamResult>
  execute?: () => Promise<SessionStreamResult>
  cancel?: () => void
  requestId?: string
  heartbeatIntervalMs?: number
  replayTurnID?: string
  sinceSeq?: number
}) {
  let cancelled = false
  const heartbeatIntervalMs = input.heartbeatIntervalMs ?? STREAM_HEARTBEAT_INTERVAL_MS
  const streamTurnID = input.replayTurnID ?? input.handle?.turnID
  let subscription: LiveStreamHub.LiveStreamSubscription
  try {
    subscription = LiveStreamHub.subscribe({
      sessionID: input.sessionID,
      turnID: streamTurnID,
      closeOnTerminalTurn: true,
      seed: replayRuntimeEvents({
        sessionID: input.sessionID,
        turnID: streamTurnID,
        sinceSeq: input.sinceSeq,
      }),
    })
  } catch (error) {
    input.handle?.cancel()
    return createSessionExecutionErrorStream({
      sessionID: input.sessionID,
      requestId: input.requestId,
      turnID: streamTurnID,
      error,
      phase: "stream",
    })
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      let lastChunkAt = Date.now()

      const closeSlowClient = () => {
        cancelled = true
        subscription.close()
        try {
          controller.close()
        } catch {
          // The stream may already be closed by the runtime.
        }
      }

      const enqueue = async (chunk: string) => {
        if (cancelled) return false
        if (!await waitForControllerCapacity(controller, {
          sessionID: input.sessionID,
          requestId: input.requestId,
          streamType: "execution",
        })) {
          closeSlowClient()
          return false
        }

        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          cancelled = true
          subscription.close()
          return false
        }

        lastChunkAt = Date.now()
        return true
      }

      const send = (event: string, data: unknown, id?: string) => {
        return enqueue(toSSE(event, data, id))
      }

      const sendKeepalive = () => {
        return enqueue(`: keepalive ${Date.now()}\n\n`)
      }

      void (async () => {
        const modePayload = executionModePayload(input)
        if (modePayload && !(await send("execution.mode", modePayload))) {
          subscription.close()
          return
        }

        let resolved: SessionStreamResult | undefined
        let failed: unknown
        let terminalEvent: RuntimeEvent.RuntimeEvent | undefined
        let observedTurnID = streamTurnID
        let observedSeq = input.sinceSeq ?? 0
        let executionDone = false

        const execution = (input.handle?.promise ?? input.execute?.() ?? Promise.reject(new Error("Missing session execution handle")))
          .then((value) => {
            resolved = value
            executionDone = true
          })
          .catch((error) => {
            failed = error
            executionDone = true
          })
        let nextEventPromise = subscription.next()

        while (!cancelled) {
          const timeoutMs = Math.max(0, heartbeatIntervalMs - (Date.now() - lastChunkAt))
          const next = await Promise.race([
            nextEventPromise.then((event) => ({ type: "event" as const, event })),
            sleep(timeoutMs).then(() => ({ type: "heartbeat" as const })),
          ])

          if (next.type === "heartbeat") {
            if (executionDone) {
              break
            }
            if (!await sendKeepalive()) break
            continue
          }

          nextEventPromise = subscription.next()

          if (!next.event) {
            break
          }

          observedTurnID = next.event.turnID ?? observedTurnID
          observedSeq = Math.max(observedSeq, next.event.seq)
          if (!await sendRuntimeEvent(send, next.event)) break

          if (RuntimeEvent.isTerminalRuntimeEvent(next.event)) {
            terminalEvent = next.event
            break
          }
        }

        if (!cancelled) {
          await execution
        }

        if (!cancelled) {
          if (terminalEvent) {
            // terminal runtime events already mapped to renderer events
          } else if (failed) {
            log.error("session execution stream failed", {
              sessionID: input.sessionID,
              requestId: input.requestId,
              error: normalizeLogError(failed),
            })
            if (isCancellationError(failed)) {
              await sendRuntimeEvent(send, createTransportTerminalEvent({
                sessionID: input.sessionID,
                turnID: observedTurnID,
                seq: observedSeq + 1,
                type: "turn.cancelled",
                payload: cancelledRuntimePayload(failed),
              }))
            } else {
                await sendRuntimeEvent(send, createTransportTerminalEvent({
                  sessionID: input.sessionID,
                  turnID: observedTurnID,
                  seq: observedSeq + 1,
                  type: "turn.failed",
                  payload: failedRuntimePayload(failed, "execution"),
                }))
            }
          } else if (resolved) {
            log.warn("session execution stream completed without terminal runtime event", {
              sessionID: input.sessionID,
              requestId: input.requestId,
              assistantMessageID: resolved.info.id,
              finishReason: resolved.info.role === "assistant" ? resolved.info.finishReason : undefined,
              partCount: resolved.parts.length,
            })
            await sendRuntimeEvent(
              send,
              createResolvedFallbackTerminalEvent({
                sessionID: input.sessionID,
                turnID: observedTurnID,
                seq: observedSeq + 1,
                resolved,
              }),
            )
          } else {
            log.error("session execution stream exited without result", {
              sessionID: input.sessionID,
              requestId: input.requestId,
            })
            await sendRuntimeEvent(send, createTransportTerminalEvent({
              sessionID: input.sessionID,
              turnID: observedTurnID,
              seq: observedSeq + 1,
              type: "turn.failed",
              payload: {
                error: "Prompt exited unexpectedly",
                phase: "execution",
                retryable: true,
              },
            }))
          }
        }

        subscription.close()
        if (!cancelled) controller.close()
      })().catch(async (error) => {
        log.error("session execution stream crashed", {
          sessionID: input.sessionID,
          requestId: input.requestId,
          error: normalizeLogError(error),
        })
        await sendRuntimeEvent(send, createTransportTerminalEvent({
          sessionID: input.sessionID,
          turnID: streamTurnID,
          type: "turn.failed",
          payload: failedRuntimePayload(error, "stream", true),
        }))
        subscription.close()
        if (!cancelled) controller.close()
      })
    },
    cancel() {
      cancelled = true
      if (!input.handle || input.handle.mode === "new-turn") {
        cancelActiveRuntimeTurn({
          sessionID: input.sessionID,
          reason: "client-disconnect",
          detail: "Execution stream was cancelled by the client.",
        })
      }
      subscription.close()
      if (input.handle) {
        input.handle.cancel()
      } else {
        input.cancel?.()
      }
    },
  })

  return new Response(stream, {
    headers: createSSEHeaders(input.requestId),
  })
}
