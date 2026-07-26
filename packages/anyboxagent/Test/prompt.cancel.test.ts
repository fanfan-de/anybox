import { expect, test } from "bun:test"
import "./sqlite.cleanup.ts"
import * as Identifier from "#id/id.ts"
import * as Message from "#session/core/message.ts"
import { cancel, cancelSession, reconcileInterruptedTurns, state } from "#session/core/prompt.ts"
import * as Session from "#session/core/session.ts"
import * as EventStore from "#session/runtime/event-store.ts"
import * as Orchestrator from "#session/runtime/orchestrator.ts"
import * as RuntimeEvent from "#session/runtime/runtime-event.ts"

test("cancel can run without a project async context", () => {
  const sessionID = `session_cancel_${Date.now()}`
  const controller = new AbortController()

  state()[sessionID] = { abort: controller }

  expect(() => cancel(sessionID)).not.toThrow()
  expect(controller.signal.aborted).toBe(true)
  expect(state()[sessionID]).toBeUndefined()
})

test("active session cancel delays terminal turn cancellation until prompt cleanup", () => {
  const sessionID = Identifier.ascending("session")
  const turnID = Identifier.ascending("turn")
  Session.createTurn({
    id: turnID,
    sessionID,
    projectID: "project_prompt_cancel_test",
  })
  const turn = Orchestrator.startTurn({
    sessionID,
    turnID,
  })

  try {
    cancelSession(sessionID)

    const cancelEvents = EventStore.listTurnEvents({ sessionID, turnID })
      .filter((event) => event.type === "turn.state.changed" || event.type === "turn.cancelled")

    expect(cancelEvents.map((event) => event.type)).toEqual(["turn.state.changed"])
    expect(cancelEvents[0]?.payload).toMatchObject({
      phase: "cancelled",
    })

    const part = Message.TextPart.parse({
      id: Identifier.ascending("part"),
      sessionID,
      messageID: Identifier.ascending("message"),
      type: "text",
      text: "partial response",
    })

    turn.emit("part.recorded", { part })

    expect(Session.DataBaseRead("parts", part.id)).toMatchObject({
      id: part.id,
      text: "partial response",
    })
  } finally {
    Orchestrator.finishTurn(turn)
  }
})

test("cancel reconciles a persisted running turn when no runtime is active", () => {
  const sessionID = Identifier.ascending("session")
  const turnID = Identifier.ascending("turn")
  const messageID = Identifier.ascending("message")
  const partID = Identifier.ascending("part")
  Session.createTurn({
    id: turnID,
    sessionID,
    projectID: "project_prompt_orphan_cancel_test",
  })
  Session.recordMessage(Message.Assistant.parse({
    id: messageID,
    sessionID,
    turnID,
    role: "assistant",
    created: 100,
    parentID: Identifier.ascending("message"),
    modelID: "test-model",
    providerID: "test-provider",
    agent: "default",
    path: {
      cwd: "C:\\test",
      root: "C:\\test",
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
  }))
  Session.upsertPart(Message.ToolPart.parse({
    id: partID,
    sessionID,
    messageID,
    type: "tool",
    callID: "call_orphan",
    tool: "powershell_command",
    state: {
      status: "running",
      input: {
        command: "Start-BitsTransfer",
      },
      title: "PowerShell",
      time: {
        start: 200,
      },
    },
  }))
  const factory = RuntimeEvent.createRuntimeEventFactory({
    sessionID,
    turnID,
  })
  EventStore.appendAndProject(factory.next("turn.state.changed", {
    phase: "executing_tool",
  }))

  const result = cancelSession(sessionID)

  expect(result).toMatchObject({
    activeCancelled: false,
    cancelled: true,
    queuedCancelled: 0,
  })
  expect(Session.DataBaseRead("turns", turnID)).toMatchObject({
    status: "cancelled",
    phase: "cancelled",
  })
  expect(Session.DataBaseRead("messages", messageID)).toMatchObject({
    completed: expect.any(Number),
    finishReason: "cancelled",
  })
  expect(Session.DataBaseRead("parts", partID)).toMatchObject({
    state: {
      status: "cancelled",
      reason: "The turn no longer had an active runtime and was recovered as cancelled.",
      time: {
        start: 200,
        end: expect.any(Number),
      },
    },
  })
  expect(EventStore.listTurnEvents({ sessionID, turnID }).at(-1)).toMatchObject({
    type: "turn.cancelled",
    seq: 2,
  })
})

test("startup recovery reconciles every persisted running turn", () => {
  const first = {
    sessionID: Identifier.ascending("session"),
    turnID: Identifier.ascending("turn"),
  }
  const second = {
    sessionID: Identifier.ascending("session"),
    turnID: Identifier.ascending("turn"),
  }
  for (const entry of [first, second]) {
    Session.createTurn({
      id: entry.turnID,
      sessionID: entry.sessionID,
      projectID: "project_prompt_startup_recovery_test",
    })
  }

  const result = reconcileInterruptedTurns({
    reason: "shutdown",
  })

  expect(result.cancelled).toBe(2)
  expect([...result.turnIDs].sort()).toEqual([first.turnID, second.turnID].sort())
  expect(Session.DataBaseRead("turns", first.turnID)).toMatchObject({
    status: "cancelled",
    phase: "cancelled",
  })
  expect(Session.DataBaseRead("turns", second.turnID)).toMatchObject({
    status: "cancelled",
    phase: "cancelled",
  })
})
