import { describe, expect, it } from "bun:test"
import "./sqlite.cleanup.ts"
import * as Identifier from "#id/id.ts"
import * as EventStore from "#session/runtime/event-store.ts"
import type * as Message from "#session/core/message.ts"
import * as Orchestrator from "#session/runtime/orchestrator.ts"
import * as LiveStreamHub from "#session/runtime/live-stream-hub.ts"
import * as RuntimeEvent from "#session/runtime/runtime-event.ts"
import { createSessionExecutionStream } from "#server/usecases/session-stream.ts"
import type * as SessionRunner from "#session/runtime/session-runner.ts"

type StreamResult = {
  info: Message.MessageInfo
  parts: Message.Part[]
}

function assistantMessage(input: {
  sessionID: string
  messageID?: string
  text?: string
}): Message.Assistant {
  return {
    id: input.messageID ?? Identifier.ascending("message"),
    sessionID: input.sessionID,
    role: "assistant",
    created: Date.now(),
    completed: Date.now() + 1,
    parentID: Identifier.ascending("message"),
    modelID: "test-model",
    providerID: "test-provider",
    agent: "default",
    path: {
      cwd: process.cwd(),
      root: process.cwd(),
    },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
    finishReason: "stop",
  }
}

function textPart(input: {
  sessionID: string
  messageID: string
  text: string
}): Message.TextPart {
  return {
    id: Identifier.ascending("part"),
    sessionID: input.sessionID,
    messageID: input.messageID,
    type: "text",
    text: input.text,
    time: {
      start: Date.now(),
      end: Date.now() + 1,
    },
  }
}

function handle(input: {
  sessionID: string
  turnID: string
  mode: SessionRunner.SessionExecutionMode
  promise?: Promise<StreamResult>
  cancel?: () => void
}): SessionRunner.SessionExecutionHandle<StreamResult> {
  return {
    sessionID: input.sessionID,
    turnID: input.turnID,
    executionID: "active-thread",
    targetKind: "active-thread",
    mode: input.mode,
    promise: input.promise ?? new Promise<StreamResult>(() => undefined),
    cancel: input.cancel ?? (() => undefined),
  }
}

function withEnv(name: string, value: string, fn: () => Promise<void>) {
  const previous = process.env[name]
  process.env[name] = value
  return fn().finally(() => {
    if (previous === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = previous
    }
  })
}

describe("session execution stream handles", () => {
  it("sends execution mode before runtime events", async () => {
    const sessionID = Identifier.ascending("session")
    const turnID = Identifier.ascending("turn")
    const factory = RuntimeEvent.createRuntimeEventFactory({
      sessionID,
      turnID,
    })
    const message = assistantMessage({ sessionID })
    const part = textPart({
      sessionID,
      messageID: message.id,
      text: "answer",
    })

    const response = createSessionExecutionStream({
      sessionID,
      heartbeatIntervalMs: 10,
      handle: handle({
        sessionID,
        turnID,
        mode: "new-turn",
        promise: (async () => {
          await new Promise((resolve) => setTimeout(resolve, 5))
          LiveStreamHub.publish(factory.next("turn.started", {}))
          LiveStreamHub.publish(factory.next("turn.completed", {
            status: "completed",
            message,
            parts: [part],
          }))
          return { info: message, parts: [part] }
        })(),
      }),
    })

    const raw = await response.text()
    const modeIndex = raw.indexOf("event: execution.mode")
    const runtimeIndex = raw.indexOf("event: runtime")

    expect(modeIndex).toBe(0)
    expect(runtimeIndex).toBeGreaterThan(modeIndex)
    expect(raw).toContain(`"sessionID":"${sessionID}"`)
    expect(raw).toContain(`"turnID":"${turnID}"`)
    expect(raw).toContain(`"mode":"new-turn"`)
  })

  it("keeps a queued stream bound to its preallocated turn id", async () => {
    const sessionID = Identifier.ascending("session")
    const activeTurnID = Identifier.ascending("turn")
    const queuedTurnID = Identifier.ascending("turn")
    const activeFactory = RuntimeEvent.createRuntimeEventFactory({
      sessionID,
      turnID: activeTurnID,
    })
    const queuedFactory = RuntimeEvent.createRuntimeEventFactory({
      sessionID,
      turnID: queuedTurnID,
    })
    const message = assistantMessage({ sessionID })
    const part = textPart({
      sessionID,
      messageID: message.id,
      text: "queued answer",
    })

    const response = createSessionExecutionStream({
      sessionID,
      heartbeatIntervalMs: 10,
      handle: handle({
        sessionID,
        turnID: queuedTurnID,
        mode: "queued",
        promise: (async () => {
          LiveStreamHub.publish(activeFactory.next("turn.started", {}))
          LiveStreamHub.publish(activeFactory.next("turn.completed", {
            status: "completed",
          }))
          await new Promise((resolve) => setTimeout(resolve, 5))
          LiveStreamHub.publish(queuedFactory.next("turn.started", {}))
          LiveStreamHub.publish(queuedFactory.next("turn.completed", {
            status: "completed",
            message,
            parts: [part],
          }))
          return { info: message, parts: [part] }
        })(),
      }),
    })

    const raw = await response.text()

    expect(raw).toContain(`"turnID":"${queuedTurnID}"`)
    expect(raw).toContain(`"type":"turn.completed"`)
    expect(raw).not.toContain(`"turnID":"${activeTurnID}"`)
  })

  it("keeps a steer stream bound to its continuation turn after handoff", async () => {
    const sessionID = Identifier.ascending("session")
    const activeTurnID = Identifier.ascending("turn")
    const steerTurnID = Identifier.ascending("turn")
    const activeFactory = RuntimeEvent.createRuntimeEventFactory({
      sessionID,
      turnID: activeTurnID,
    })
    const steerFactory = RuntimeEvent.createRuntimeEventFactory({
      sessionID,
      turnID: steerTurnID,
    })
    const message = assistantMessage({ sessionID })
    const part = textPart({
      sessionID,
      messageID: message.id,
      text: "steered answer",
    })

    const response = createSessionExecutionStream({
      sessionID,
      heartbeatIntervalMs: 10,
      handle: handle({
        sessionID,
        turnID: steerTurnID,
        mode: "steer",
        promise: (async () => {
          LiveStreamHub.publish(activeFactory.next("turn.started", {}))
          LiveStreamHub.publish(activeFactory.next("turn.completed", {
            status: "continued_by_user",
          }))
          await new Promise((resolve) => setTimeout(resolve, 5))
          LiveStreamHub.publish(steerFactory.next("turn.started", {}))
          LiveStreamHub.publish(steerFactory.next("text.part.delta", {
            messageID: message.id,
            partID: part.id,
            kind: "text",
            delta: "steered ",
          }))
          LiveStreamHub.publish(steerFactory.next("text.part.delta", {
            messageID: message.id,
            partID: part.id,
            kind: "text",
            delta: "answer",
          }))
          LiveStreamHub.publish(steerFactory.next("turn.completed", {
            status: "completed",
            message,
            parts: [part],
          }))
          return { info: message, parts: [part] }
        })(),
      }),
    })

    const raw = await response.text()

    expect(raw).toContain(`"mode":"steer"`)
    expect(raw).toContain(`"turnID":"${steerTurnID}"`)
    expect(raw).toContain(`"type":"text.part.delta"`)
    expect(raw).toContain("steered ")
    expect(raw).not.toContain(`"turnID":"${activeTurnID}"`)
    expect(raw).not.toContain(`"status":"continued_by_user"`)
  })

  it("cancels active new-turn handles on stream disconnect", async () => {
    const sessionID = Identifier.ascending("session")
    const turnID = Identifier.ascending("turn")
    const turn = Orchestrator.startTurn({
      sessionID,
      turnID,
    })
    const observed: string[] = []
    const unsubscribe = EventStore.subscribe((event) => {
      if (event.sessionID === sessionID) {
        observed.push(event.type)
      }
    })
    let handleCancelled = false
    const response = createSessionExecutionStream({
      sessionID,
      heartbeatIntervalMs: 10,
      handle: handle({
        sessionID,
        turnID,
        mode: "new-turn",
        cancel: () => {
          handleCancelled = true
        },
      }),
    })

    try {
      const reader = response.body?.getReader()
      if (!reader) throw new Error("Expected response body")

      await reader.cancel()

      expect(handleCancelled).toBe(true)
      expect(observed).toContain("turn.cancelled")
    } finally {
      unsubscribe()
      Orchestrator.finishTurn(turn)
    }
  })

  it("does not abort an active turn when a steer stream disconnects", async () => {
    const sessionID = Identifier.ascending("session")
    const activeTurnID = Identifier.ascending("turn")
    const steerTurnID = Identifier.ascending("turn")
    const turn = Orchestrator.startTurn({
      sessionID,
      turnID: activeTurnID,
    })
    const observed: string[] = []
    const unsubscribe = EventStore.subscribe((event) => {
      if (event.sessionID === sessionID) {
        observed.push(event.type)
      }
    })
    let handleCancelled = false
    const response = createSessionExecutionStream({
      sessionID,
      heartbeatIntervalMs: 10,
      handle: handle({
        sessionID,
        turnID: steerTurnID,
        mode: "steer",
        cancel: () => {
          handleCancelled = true
        },
      }),
    })

    try {
      const reader = response.body?.getReader()
      if (!reader) throw new Error("Expected response body")

      await reader.cancel()

      expect(handleCancelled).toBe(true)
      expect(observed).not.toContain("turn.cancelled")
      expect(Orchestrator.activeTurn(sessionID)?.turnID).toBe(activeTurnID)
    } finally {
      unsubscribe()
      Orchestrator.finishTurn(turn)
    }
  })

  it("converts subscriber limit errors into terminal runtime events", async () => {
    await withEnv("ANYBOX_SESSION_MAX_STREAM_SUBSCRIBERS", "1", async () => {
      await withEnv("ANYBOX_SESSION_MAX_STREAM_SUBSCRIBERS_PER_SESSION", "10", async () => {
        const sessionID = Identifier.ascending("session")
        const turnID = Identifier.ascending("turn")
        const existing = LiveStreamHub.subscribe({
          sessionID: Identifier.ascending("session"),
          closeOnTerminalTurn: false,
        })
        let handleCancelled = false

        try {
          const response = createSessionExecutionStream({
            sessionID,
            heartbeatIntervalMs: 10,
            handle: handle({
              sessionID,
              turnID,
              mode: "queued",
              cancel: () => {
                handleCancelled = true
              },
            }),
          })

          const raw = await response.text()

          expect(handleCancelled).toBe(true)
          expect(raw).toContain(`"type":"turn.failed"`)
          expect(raw).toContain(`"code":"SESSION_STREAM_SUBSCRIBER_LIMIT"`)
          expect(raw).toContain(`"turnID":"${turnID}"`)
        } finally {
          existing.close()
        }
      })
    })
  })
})
