import { describe, expect, it } from "bun:test"
import * as Identifier from "#id/id.ts"
import * as LiveStreamHub from "#session/runtime/live-stream-hub.ts"
import * as RuntimeEvent from "#session/runtime/runtime-event.ts"
import { SessionLimitError } from "#session/runtime/session-limits.ts"

function createFactory() {
  return RuntimeEvent.createRuntimeEventFactory({
    sessionID: Identifier.ascending("session"),
    turnID: Identifier.ascending("turn"),
  })
}

function toolPart(raw: string, revision = 0) {
  return {
    id: "tool-part-1",
    sessionID: "session-test",
    messageID: "assistant-1",
    type: "tool" as const,
    schemaVersion: 3 as const,
    turnID: "turn-test",
    callID: "call-1",
    tool: "write",
    input: { raw },
    source: { kind: "model" as const },
    retry: { attempt: 1 },
    revision,
    timestamps: { createdAt: 1 },
    state: { phase: "pending" as const },
  }
}

function withEnv(name: string, value: string, fn: () => void) {
  const previous = process.env[name]
  process.env[name] = value
  try {
    fn()
  } finally {
    if (previous === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = previous
    }
  }
}

describe("live stream hub", () => {
  it("uses opaque monotonic cursors even when wall clock time moves backwards", () => {
    const timestamps = [2_000, 1_000]
    const factory = RuntimeEvent.createRuntimeEventFactory({
      sessionID: Identifier.ascending("session"),
      turnID: Identifier.ascending("turn"),
      timestamp: () => timestamps.shift() ?? 0,
    })
    const first = factory.next("turn.started", {})
    const second = factory.next("turn.started", {})
    LiveStreamHub.publish(first)
    LiveStreamHub.publish(second)

    const firstCursor = LiveStreamHub.cursorForEvent(first)
    const secondCursor = LiveStreamHub.cursorForEvent(second)
    const serialized = LiveStreamHub.serializeCursor(firstCursor)
    expect(serialized.startsWith("v2.")).toBe(true)
    expect(LiveStreamHub.parseCursor(serialized)).toEqual(firstCursor)
    expect(first.timestamp).toBeGreaterThan(second.timestamp)
    expect(secondCursor.sequence).toBeGreaterThan(firstCursor.sequence)
    expect(LiveStreamHub.replay({ sessionID: first.sessionID, cursor: firstCursor })).toEqual({
      status: "ok",
      events: [second],
    })
    LiveStreamHub.clearSession(first.sessionID)
  })

  it("requires resync for a cursor from another process epoch", () => {
    const factory = createFactory()
    const event = factory.next("turn.started", {})
    LiveStreamHub.publish(event)

    expect(LiveStreamHub.replay({
      sessionID: event.sessionID,
      cursor: {
        schemaVersion: 2,
        processEpoch: "previous-process",
        sequence: LiveStreamHub.cursorForEvent(event).sequence,
      },
    })).toEqual({
      status: "resync-required",
      reason: "epoch-changed",
      events: [],
    })
    LiveStreamHub.clearSession(event.sessionID)
  })

  it("requires resync when a same-epoch cursor falls outside the retained buffer", () => {
    const factory = createFactory()
    const first = factory.next("turn.started", {})
    LiveStreamHub.publish(first)
    const cursor = LiveStreamHub.cursorForEvent(first)
    for (let index = 0; index < LiveStreamHub.MAX_RECENT_EVENTS_PER_SESSION + 5; index += 1) {
      LiveStreamHub.publish(factory.next("turn.started", {}))
    }

    expect(LiveStreamHub.replay({ sessionID: first.sessionID, cursor })).toEqual({
      status: "resync-required",
      reason: "cursor-expired",
      events: [],
    })
    LiveStreamHub.clearSession(first.sessionID)
  })

  it("coalesces queued text deltas for slow subscribers", async () => {
    const factory = createFactory()
    const first = factory.next("text.part.delta", {
      messageID: "assistant-1",
      partID: "part-1",
      kind: "text",
      delta: "hel",
    })
    const second = factory.next("text.part.delta", {
      messageID: "assistant-1",
      partID: "part-1",
      kind: "text",
      delta: "lo",
    })
    const subscription = LiveStreamHub.subscribe({
      sessionID: first.sessionID,
      turnID: first.turnID,
      closeOnTerminalTurn: false,
    })

    try {
      LiveStreamHub.publish(first)
      LiveStreamHub.publish(second)

      const next = await subscription.next()
      if (next?.type !== "text.part.delta") {
        throw new Error(`Expected text.part.delta, got ${next?.type}`)
      }
      expect(next?.seq).toBe(second.seq)
      expect(next.payload.delta).toBe("hello")
    } finally {
      subscription.close()
    }
  })

  it("coalesces queued tool input deltas for slow subscribers", async () => {
    const factory = createFactory()
    const first = factory.next("tool.call.input_delta", {
      part: toolPart("{\"p", 1),
      messageID: "assistant-1",
      partID: "tool-part-1",
      toolCallID: "call-1",
      toolName: "write",
      delta: "{\"p",
      rawLength: 3,
    })
    const second = factory.next("tool.call.input_delta", {
      part: toolPart("{\"p\":1}", 2),
      messageID: "assistant-1",
      partID: "tool-part-1",
      toolCallID: "call-1",
      toolName: "write",
      delta: "\":1}",
      rawLength: 7,
    })
    const subscription = LiveStreamHub.subscribe({
      sessionID: first.sessionID,
      turnID: first.turnID,
      closeOnTerminalTurn: false,
    })

    try {
      LiveStreamHub.publish(first)
      LiveStreamHub.publish(second)

      const next = await subscription.next()
      if (next?.type !== "tool.call.input_delta") {
        throw new Error(`Expected tool.call.input_delta, got ${next?.type}`)
      }
      expect(next?.seq).toBe(second.seq)
      expect(next.payload.delta).toBe("{\"p\":1}")
      expect(next.payload.rawLength).toBe(7)
    } finally {
      subscription.close()
    }
  })

  it("buffers recent transient events for late subscribers", async () => {
    const factory = createFactory()
    const delta = factory.next("tool.call.input_delta", {
      part: {
        ...toolPart("{\"cmd\":\"patch\"}", 1),
        id: "tool-part-late",
        messageID: "assistant-late",
        callID: "call-late",
        tool: "apply_patch",
      },
      messageID: "assistant-late",
      partID: "tool-part-late",
      toolCallID: "call-late",
      toolName: "apply_patch",
      delta: "{\"cmd\":\"patch\"}",
      rawLength: 15,
    })

    LiveStreamHub.publish(delta)

    const seed = LiveStreamHub.listRecentEvents({
      sessionID: delta.sessionID,
      turnID: delta.turnID,
    })
    const subscription = LiveStreamHub.subscribe({
      sessionID: delta.sessionID,
      turnID: delta.turnID,
      closeOnTerminalTurn: false,
      seed,
    })

    try {
      const next = await subscription.next()
      expect(next?.eventID).toBe(delta.eventID)
      expect(next?.type).toBe("tool.call.input_delta")
    } finally {
      subscription.close()
    }
  })

  it("never lets a coalesced delta exceed the per-subscription byte budget", async () => {
    const factory = createFactory()
    const sessionID = factory.next("turn.started", {}).sessionID
    const subscription = LiveStreamHub.subscribe({
      sessionID,
      closeOnTerminalTurn: false,
    })
    const largeDelta = "x".repeat(1_200_000)

    try {
      LiveStreamHub.publish(factory.next("text.part.delta", {
        messageID: "assistant-large",
        partID: "part-large",
        kind: "text",
        delta: largeDelta,
      }))
      LiveStreamHub.publish(factory.next("text.part.delta", {
        messageID: "assistant-large",
        partID: "part-large",
        kind: "text",
        delta: largeDelta,
      }))

      const session = LiveStreamHub.snapshot().sessions.find((item) => item.sessionID === sessionID)
      expect(session?.queuedBytes).toBeLessThanOrEqual(LiveStreamHub.MAX_SUBSCRIPTION_QUEUE_BYTES)
      const next = await subscription.next()
      expect(next?.type).toBe("text.part.delta")
    } finally {
      subscription.close()
      LiveStreamHub.clearSession(sessionID)
    }
  })

  it("bounds recent events per session", () => {
    const factory = createFactory()
    const first = factory.next("turn.started", {})
    const sessionID = first.sessionID

    LiveStreamHub.publish(first)
    for (let index = 1; index < 2005; index += 1) {
      LiveStreamHub.publish(factory.next("turn.started", {}))
    }

    const recent = LiveStreamHub.listRecentEvents({
      sessionID,
    })

    expect(recent.length).toBeLessThanOrEqual(2000)
    LiveStreamHub.clearSession(sessionID)
  })

  it("drops transient deltas before closing slow subscribers with non-transient queues", () => {
    const sessionID = Identifier.ascending("session")
    const turnID = Identifier.ascending("turn")
    const eventFactory = RuntimeEvent.createRuntimeEventFactory({
      sessionID,
      turnID,
    })
    const subscription = LiveStreamHub.subscribe({
      sessionID,
      closeOnTerminalTurn: false,
    })
    const before = LiveStreamHub.snapshot().totals.closedSlowClients

    try {
      LiveStreamHub.publish(eventFactory.next("text.part.delta", {
        messageID: "assistant-1",
        partID: "part-1",
        kind: "text",
        delta: "drop-me",
      }))

      for (let index = 0; index < 1000; index += 1) {
        LiveStreamHub.publish(eventFactory.next("turn.started", {}))
      }

      expect(LiveStreamHub.snapshot().totals.droppedEvents).toBeGreaterThan(0)

      LiveStreamHub.publish(eventFactory.next("turn.started", {}))

      expect(LiveStreamHub.snapshot().totals.closedSlowClients).toBeGreaterThan(before)
    } finally {
      subscription.close()
    }
  })

  it("enforces the global subscriber limit without closing existing subscribers", () => {
    withEnv("ANYBOX_SESSION_MAX_STREAM_SUBSCRIBERS", "1", () => {
      withEnv("ANYBOX_SESSION_MAX_STREAM_SUBSCRIBERS_PER_SESSION", "10", () => {
        const first = LiveStreamHub.subscribe({
          sessionID: Identifier.ascending("session"),
          closeOnTerminalTurn: false,
        })

        try {
          expect(() => LiveStreamHub.subscribe({
            sessionID: Identifier.ascending("session"),
            closeOnTerminalTurn: false,
          })).toThrow(SessionLimitError)
          expect(LiveStreamHub.snapshot().activeSubscriptions).toBe(1)
        } finally {
          first.close()
        }
      })
    })
  })

  it("enforces the per-session subscriber limit without closing existing subscribers", () => {
    withEnv("ANYBOX_SESSION_MAX_STREAM_SUBSCRIBERS", "10", () => {
      withEnv("ANYBOX_SESSION_MAX_STREAM_SUBSCRIBERS_PER_SESSION", "1", () => {
        const sessionID = Identifier.ascending("session")
        const first = LiveStreamHub.subscribe({
          sessionID,
          closeOnTerminalTurn: false,
        })

        try {
          expect(() => LiveStreamHub.subscribe({
            sessionID,
            closeOnTerminalTurn: false,
          })).toThrow(SessionLimitError)
          expect(LiveStreamHub.snapshot().activeSubscriptions).toBe(1)
        } finally {
          first.close()
        }
      })
    })
  })
})
