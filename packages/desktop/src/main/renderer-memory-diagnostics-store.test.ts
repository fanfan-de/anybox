import { afterEach, describe, expect, it } from "vitest"
import type { DesktopRendererMemoryDiagnosticsRecord } from "../shared/desktop-ipc-contract"
import {
  attachRendererMemoryDiagnostics,
  deleteRendererMemoryDiagnosticsRecord,
  getRendererMemoryDiagnosticsRecord,
  listRendererMemoryDiagnosticsRecords,
  resetRendererMemoryDiagnosticsStoreForTest,
  setRendererMemoryDiagnosticsRecord,
} from "./renderer-memory-diagnostics-store"

afterEach(() => {
  resetRendererMemoryDiagnosticsStoreForTest()
})

function createRecord(webContentsID: number, timestamp: number): DesktopRendererMemoryDiagnosticsRecord {
  return {
    currentSession: {
      assistantMessageCount: 1,
      currentSessionID: `session-${webContentsID}`,
      diffChars: 2,
      draftPatchChars: 3,
      maxTraceItemChars: 4,
      messageTreeContentChars: 5,
      messageTreeNodeCount: 6,
      streamingAssistantMessageCount: 1,
      toolInputChars: 7,
      toolOutputChars: 8,
      traceItemCount: 9,
      traceTextChars: 10,
      messageCount: 11,
      updatedAt: timestamp,
    },
    heap: {
      jsHeapSizeLimit: 4_000,
      totalJSHeapSize: 2_000,
      usedJSHeapSize: 1_000,
    },
    performanceEntries: {
      mark: 12,
      measure: 13,
      navigation: 1,
      paint: 2,
      resource: 14,
      total: 42,
    },
    senderURL: "http://localhost:5173/",
    source: "renderer",
    timestamp,
    webContentsID,
  }
}

describe("renderer memory diagnostics store", () => {
  it("isolates records by WebContents and returns newest records first", () => {
    const older = createRecord(1, 100)
    const newer = createRecord(2, 200)

    setRendererMemoryDiagnosticsRecord(older)
    setRendererMemoryDiagnosticsRecord(newer)

    expect(getRendererMemoryDiagnosticsRecord(1)).toEqual(older)
    expect(getRendererMemoryDiagnosticsRecord(2)).toEqual(newer)
    expect(listRendererMemoryDiagnosticsRecords()).toEqual([newer, older])
  })

  it("replaces an older snapshot for the same WebContents", () => {
    setRendererMemoryDiagnosticsRecord(createRecord(1, 100))
    const replacement = createRecord(1, 300)

    setRendererMemoryDiagnosticsRecord(replacement)

    expect(getRendererMemoryDiagnosticsRecord(1)).toEqual(replacement)
    expect(listRendererMemoryDiagnosticsRecords()).toEqual([replacement])
  })

  it("deletes destroyed WebContents records without affecting other windows", () => {
    setRendererMemoryDiagnosticsRecord(createRecord(1, 100))
    const retained = createRecord(2, 200)
    setRendererMemoryDiagnosticsRecord(retained)

    deleteRendererMemoryDiagnosticsRecord(1)

    expect(getRendererMemoryDiagnosticsRecord(1)).toBeNull()
    expect(getRendererMemoryDiagnosticsRecord(2)).toEqual(retained)
  })

  it("attaches the last snapshot to crash details when one is available", () => {
    const record = createRecord(1, 100)
    setRendererMemoryDiagnosticsRecord(record)

    expect(attachRendererMemoryDiagnostics(1, { reason: "oom" })).toEqual({
      reason: "oom",
      lastRendererMemoryDiagnostics: record,
    })
  })

  it("leaves crash details unchanged when no snapshot is available", () => {
    const details = { reason: "oom" }

    expect(attachRendererMemoryDiagnostics(99, details)).toBe(details)
    expect(attachRendererMemoryDiagnostics(99, details)).not.toHaveProperty("lastRendererMemoryDiagnostics")
  })
})
