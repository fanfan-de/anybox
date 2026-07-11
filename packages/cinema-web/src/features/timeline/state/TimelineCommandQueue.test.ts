import { describe, expect, it, vi } from "vitest"
import type {
  CinemaTimelineCommand,
  CinemaTimelineCommandResult,
  CinemaTimelineDocument,
} from "@anybox/shared/cinema-timeline"
import {
  CinemaTimelineCommandQueue,
  type CinemaTimelineCommandQueueSnapshot,
} from "./TimelineCommandQueue"

function timeline(revision: number): CinemaTimelineDocument {
  return {
    schemaVersion: 2,
    id: "timeline-1",
    projectID: "project-1",
    title: "Rough cut",
    revision,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    settings: {
      width: 1920,
      height: 1080,
      frameRate: { numerator: 24, denominator: 1 },
      sampleRate: 48_000,
      backgroundColor: "#000000",
    },
    tracks: [],
    clips: [],
    markers: [],
  }
}

function result(command: CinemaTimelineCommand, revision: number): CinemaTimelineCommandResult {
  return {
    timeline: timeline(revision),
    event: {
      time: "2026-07-10T00:00:00.000Z",
      timelineID: "timeline-1",
      type: `timeline.${command.type}`,
      actor: "test",
      commandID: command.id,
      baseRevision: command.baseRevision,
      revision,
      message: "updated",
      command,
    },
  }
}

function markerCommand(id: string) {
  return {
    id,
    timelineID: "timeline-1",
    type: "add-marker" as const,
    actor: "test",
    marker: { id: `marker-${id}`, timeUs: 0, title: id, color: "default" as const },
  }
}

describe("CinemaTimelineCommandQueue", () => {
  it("sends commands serially and flushes after acknowledgements", async () => {
    const sent: CinemaTimelineCommand[] = []
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const send = vi.fn(async (command: CinemaTimelineCommand) => {
      sent.push(command)
      if (sent.length === 1) await firstGate
      return result(command, command.baseRevision + 1)
    })
    const queue = new CinemaTimelineCommandQueue({
      initialRevision: 4,
      send,
      fetchLatestTimeline: async () => timeline(4),
      isRevisionConflict: () => false,
      retryDelaysMs: [],
    })

    const first = queue.enqueue(markerCommand("one"))
    const second = queue.enqueue(markerCommand("two"))
    const flush = queue.flush()
    await Promise.resolve()
    expect(send).toHaveBeenCalledTimes(1)
    releaseFirst?.()
    await Promise.all([first, second, flush])

    expect(sent.map((command) => command.baseRevision)).toEqual([4, 5])
    expect(queue.getSnapshot()).toEqual({ status: "idle", pendingCount: 0, error: null })
  })

  it("rebases with the same command id after a revision conflict", async () => {
    const sent: CinemaTimelineCommand[] = []
    const conflict = new Error("revision conflict")
    const send = vi.fn(async (command: CinemaTimelineCommand) => {
      sent.push(command)
      if (sent.length === 1) throw conflict
      return result(command, command.baseRevision + 1)
    })
    const queue = new CinemaTimelineCommandQueue({
      initialRevision: 2,
      send,
      fetchLatestTimeline: async () => timeline(7),
      isRevisionConflict: (error) => error === conflict,
      retryDelaysMs: [],
    })

    await queue.enqueue(markerCommand("stable-id"))
    expect(sent.map((command) => [command.id, command.baseRevision])).toEqual([
      ["stable-id", 2],
      ["stable-id", 7],
    ])
  })

  it("keeps failed commands for retry and rejects an active flush", async () => {
    const failure = new Error("offline")
    let online = false
    const snapshots: CinemaTimelineCommandQueueSnapshot[] = []
    const send = vi.fn(async (command: CinemaTimelineCommand) => {
      if (!online) throw failure
      return result(command, command.baseRevision + 1)
    })
    const queue = new CinemaTimelineCommandQueue({
      send,
      fetchLatestTimeline: async () => timeline(0),
      isRevisionConflict: () => false,
      retryDelaysMs: [],
      onSnapshot: (snapshot) => snapshots.push(snapshot),
    })

    const pending = queue.enqueue(markerCommand("retry-me"))
    await expect(queue.flush()).rejects.toBe(failure)
    await expect(pending).rejects.toBe(failure)
    expect(queue.hasPendingCommands()).toBe(true)

    online = true
    queue.retry()
    await vi.waitFor(() => expect(queue.hasPendingCommands()).toBe(false))
    expect(queue.getSnapshot().status).toBe("idle")
    expect(snapshots.some((snapshot) => snapshot.status === "error")).toBe(true)
  })
})
