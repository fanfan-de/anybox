import { describe, expect, it } from "bun:test"
import "./sqlite.cleanup.ts"
import * as Identifier from "#id/id.ts"
import * as EventStore from "#session/runtime/event-store.ts"
import * as Orchestrator from "#session/runtime/orchestrator.ts"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function toolPart(raw: string, revision: number) {
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

describe("turn stream events", () => {
  it("queues transient stream events off the emit call stack", async () => {
    const turn = Orchestrator.startTurn({
      sessionID: Identifier.ascending("session"),
    })
    const observed: string[] = []
    const unsubscribe = EventStore.subscribe((event) => {
      if (event.type === "text.part.delta") {
        observed.push(event.type)
      }
    })

    try {
      turn.emitStream("text.part.delta", {
        messageID: "assistant-1",
        partID: "part-1",
        kind: "text",
        delta: "hello",
      })

      expect(observed).toEqual([])

      await sleep(1)

      expect(observed).toEqual(["text.part.delta"])
    } finally {
      unsubscribe()
      Orchestrator.finishTurn(turn)
    }
  })

  it("flushes queued stream events before synchronous terminal events", () => {
    const turn = Orchestrator.startTurn({
      sessionID: Identifier.ascending("session"),
    })
    const observed: string[] = []
    const unsubscribe = EventStore.subscribe((event) => {
      if (event.turnID === turn.turnID) {
        observed.push(event.type)
      }
    })

    try {
      turn.emitStream("text.part.delta", {
        messageID: "assistant-1",
        partID: "part-1",
        kind: "text",
        delta: "hello",
      })
      turn.emit("turn.completed", {
        status: "completed",
      })

      expect(observed).toEqual(["text.part.delta", "turn.completed"])
    } finally {
      unsubscribe()
      Orchestrator.finishTurn(turn)
    }
  })

  it("coalesces same-tick text, reasoning, and tool input deltas for the same part", async () => {
    const turn = Orchestrator.startTurn({
      sessionID: Identifier.ascending("session"),
    })
    const observed: Array<{ type: string; delta?: string }> = []
    const unsubscribe = EventStore.subscribe((event) => {
      if (event.turnID !== turn.turnID) return
      if (event.type === "text.part.delta" || event.type === "reasoning.part.delta" || event.type === "tool.call.input_delta") {
        observed.push({
          type: event.type,
          delta: event.payload.delta,
        })
      }
    })

    try {
      turn.emitStream("text.part.delta", {
        messageID: "assistant-1",
        partID: "part-1",
        kind: "text",
        delta: "hel",
      })
      turn.emitStream("text.part.delta", {
        messageID: "assistant-1",
        partID: "part-1",
        kind: "text",
        delta: "lo",
      })
      turn.emitStream("reasoning.part.delta", {
        messageID: "assistant-1",
        partID: "reasoning-1",
        kind: "reasoning",
        delta: "why",
      })
      turn.emitStream("tool.call.input_delta", {
        part: toolPart("{\"p", 1),
        messageID: "assistant-1",
        partID: "tool-part-1",
        toolCallID: "call-1",
        toolName: "write",
        delta: "{\"p",
        rawLength: 3,
      })
      turn.emitStream("tool.call.input_delta", {
        part: toolPart("{\"p\":1}", 2),
        messageID: "assistant-1",
        partID: "tool-part-1",
        toolCallID: "call-1",
        toolName: "write",
        delta: "\":1}",
        rawLength: 7,
      })

      await sleep(1)

      expect(observed).toEqual([
        { type: "text.part.delta", delta: "hello" },
        { type: "reasoning.part.delta", delta: "why" },
        { type: "tool.call.input_delta", delta: "{\"p\":1}" },
      ])
    } finally {
      unsubscribe()
      Orchestrator.finishTurn(turn)
    }
  })
})
