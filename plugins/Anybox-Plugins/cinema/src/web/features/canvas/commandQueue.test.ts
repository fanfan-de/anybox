import { describe, expect, it, vi } from "vitest"
import type { CinemaCanvasDocument, CinemaCommand, CinemaCommandResult } from "@anybox/cinema-plugin/contracts"
import { CinemaCommandQueue, type CinemaCommandQueueSnapshot } from "./commandQueue"

function canvas(revision: number): CinemaCanvasDocument {
  return {
    schemaVersion: 1,
    revision,
    canvasType: "node-canvas",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
    nodeTypes: [],
  }
}

function result(revision: number): CinemaCommandResult {
  return {
    canvas: canvas(revision),
    event: {
      time: "2026-07-10T00:00:00.000Z",
      type: "command.update-viewport",
      actor: "test",
      message: "updated",
      commandID: `command-${revision}`,
    },
  }
}

function viewportCommand(id: string) {
  return {
    id,
    type: "update-viewport" as const,
    actor: "test",
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}

describe("CinemaCommandQueue", () => {
  it("sends commands serially with the acknowledged revision", async () => {
    const sent: CinemaCommand[] = []
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const send = vi.fn(async (command: CinemaCommand) => {
      sent.push(command)
      if (sent.length === 1) await firstGate
      return result(command.baseRevision + 1)
    })
    const queue = new CinemaCommandQueue({
      initialRevision: 4,
      send,
      fetchLatestCanvas: async () => canvas(4),
      isRevisionConflict: () => false,
      retryDelaysMs: [],
    })

    const first = queue.enqueue(viewportCommand("one"))
    const second = queue.enqueue(viewportCommand("two"))
    await Promise.resolve()
    expect(send).toHaveBeenCalledTimes(1)
    releaseFirst?.()
    await Promise.all([first, second])

    expect(sent.map((command) => command.baseRevision)).toEqual([4, 5])
    expect(queue.getSnapshot()).toEqual({ status: "idle", pendingCount: 0, error: null })
  })

  it("rebases a stale command and retries with the same id", async () => {
    const sent: CinemaCommand[] = []
    const conflict = new Error("revision conflict")
    const send = vi.fn(async (command: CinemaCommand) => {
      sent.push(command)
      if (sent.length === 1) throw conflict
      return result(command.baseRevision + 1)
    })
    const queue = new CinemaCommandQueue({
      initialRevision: 2,
      send,
      fetchLatestCanvas: async () => canvas(7),
      isRevisionConflict: (error) => error === conflict,
      retryDelaysMs: [],
    })

    await queue.enqueue(viewportCommand("stable-id"))

    expect(sent.map((command) => [command.id, command.baseRevision])).toEqual([
      ["stable-id", 2],
      ["stable-id", 7],
    ])
  })

  it("keeps failed commands queued until manual retry succeeds", async () => {
    const failure = new Error("offline")
    let online = false
    const snapshots: CinemaCommandQueueSnapshot[] = []
    const send = vi.fn(async (command: CinemaCommand) => {
      if (!online) throw failure
      return result(command.baseRevision + 1)
    })
    const queue = new CinemaCommandQueue({
      send,
      fetchLatestCanvas: async () => canvas(0),
      isRevisionConflict: () => false,
      retryDelaysMs: [],
      onSnapshot: (snapshot) => snapshots.push(snapshot),
    })

    await expect(queue.enqueue(viewportCommand("retry-me"))).rejects.toBe(failure)
    expect(queue.hasPendingCommands()).toBe(true)
    expect(queue.getSnapshot().status).toBe("error")

    online = true
    queue.retry()
    await vi.waitFor(() => expect(queue.hasPendingCommands()).toBe(false))
    expect(queue.getSnapshot().status).toBe("idle")
    expect(snapshots.some((snapshot) => snapshot.status === "error")).toBe(true)
  })
})
