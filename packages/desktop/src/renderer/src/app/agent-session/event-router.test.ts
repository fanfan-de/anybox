import { describe, expect, it } from "vitest"
import { createAgentSessionEventRouter } from "./event-router"

describe("agent session event router", () => {
  it("deduplicates cursors per ui session and keeps independent session windows", () => {
    const router = createAgentSessionEventRouter({ maxSeenCursors: 2 })

    expect(router.rememberSeenCursor("session-a", "cursor-1")).toBe(false)
    expect(router.rememberSeenCursor("session-a", "cursor-1")).toBe(true)
    expect(router.rememberSeenCursor("session-b", "cursor-1")).toBe(false)

    expect(router.rememberSeenCursor("session-a", "cursor-2")).toBe(false)
    expect(router.rememberSeenCursor("session-a", "cursor-3")).toBe(false)
    expect(router.rememberSeenCursor("session-a", "cursor-1")).toBe(false)
  })

  it("dedupes identical runtime cursors without dropping unseen older runtime cursors", () => {
    const router = createAgentSessionEventRouter()

    expect(router.rememberSeenCursor("session-a", "1000:turn-a:3")).toBe(false)
    expect(router.rememberSeenCursor("session-a", "1000:turn-a:3")).toBe(true)
    expect(router.rememberSeenCursor("session-a", "1000:turn-a:2")).toBe(false)
    expect(router.rememberSeenCursor("session-a", "999:turn-z:99")).toBe(false)

    expect(router.rememberSeenCursor("session-b", "1000:turn-a:3")).toBe(false)
  })

  it("tracks backend turn targets and removes them on cleanup", () => {
    const router = createAgentSessionEventRouter()

    router.setTurnTarget("backend-1", "turn-1", {
      sessionID: "ui-1",
      assistantThreadMessageID: "assistant-1",
    })

    expect(router.getTurnTarget("backend-1", "turn-1")).toEqual({
      sessionID: "ui-1",
      assistantThreadMessageID: "assistant-1",
    })

    router.cleanupTurnTarget("backend-1", "turn-1")

    expect(router.getTurnTarget("backend-1", "turn-1")).toBeNull()
  })

  it("remembers settled backend turns with bounded retention", () => {
    const router = createAgentSessionEventRouter({ maxSettledTurns: 2 })

    router.markBackendTurnSettled("backend-1", "turn-1", 1)
    router.markBackendTurnSettled("backend-1", "turn-2", 2)
    router.markBackendTurnSettled("backend-1", "turn-3", 3)

    expect(router.hasBackendTurnSettled("backend-1", "turn-1")).toBe(false)
    expect(router.hasBackendTurnSettled("backend-1", "turn-2")).toBe(true)
    expect(router.hasBackendTurnSettled("backend-1", "turn-3")).toBe(true)
  })
})
