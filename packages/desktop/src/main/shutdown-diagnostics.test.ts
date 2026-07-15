import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DesktopRendererMemoryDiagnosticsRecord } from "../shared/desktop-ipc-contract"

const electronMock = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(),
    getVersion: vi.fn(),
  },
}))

vi.mock("electron", () => ({
  app: electronMock.app,
}))

import { getShutdownDiagnosticsLogPath, recordShutdownDiagnostic } from "./shutdown-diagnostics"
import {
  attachRendererMemoryDiagnostics,
  resetRendererMemoryDiagnosticsStoreForTest,
  setRendererMemoryDiagnosticsRecord,
} from "./renderer-memory-diagnostics-store"

let tempDir: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "anybox-shutdown-diagnostics-"))
  electronMock.app.getPath.mockReturnValue(tempDir)
  electronMock.app.getVersion.mockReturnValue("0.1.23")
  resetRendererMemoryDiagnosticsStoreForTest()
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
  resetRendererMemoryDiagnosticsStoreForTest()
  vi.clearAllMocks()
})

function readDiagnosticEntries() {
  const contents = fs.readFileSync(path.join(tempDir, "shutdown-diagnostics.log"), "utf8").trim()
  return contents.split("\n").map((line) => JSON.parse(line) as Record<string, any>)
}

describe("shutdown diagnostics", () => {
  it("writes JSON lines to the Electron userData directory", () => {
    recordShutdownDiagnostic("before-quit", {
      error: new Error("boom"),
      isQuitting: false,
      windowCount: 2,
    })

    const [entry] = readDiagnosticEntries()

    expect(entry.event).toBe("before-quit")
    expect(entry.appVersion).toBe("0.1.23")
    expect(entry.details.windowCount).toBe(2)
    expect(entry.details.isQuitting).toBe(false)
    expect(entry.details.error.message).toBe("boom")
    expect(entry.versions.node).toBe(process.versions.node)
  })

  it("serializes circular details without throwing", () => {
    const details: Record<string, unknown> = { name: "root" }
    details.self = details

    recordShutdownDiagnostic("unhandledRejection", details)

    const [entry] = readDiagnosticEntries()

    expect(entry.details.name).toBe("root")
    expect(entry.details.self).toBe("[Circular]")
  })

  it("writes the last renderer memory snapshot for OOM exits and still records exits without one", () => {
    const snapshot: DesktopRendererMemoryDiagnosticsRecord = {
      currentSession: {
        assistantMessageCount: 1,
        currentSessionID: "session-7",
        diffChars: 2,
        draftPatchChars: 3,
        maxTraceItemChars: 4,
        messageCount: 5,
        messageTreeContentChars: 6,
        messageTreeNodeCount: 7,
        streamingAssistantMessageCount: 1,
        toolInputChars: 8,
        toolOutputChars: 9,
        traceItemCount: 10,
        traceTextChars: 11,
        updatedAt: 100,
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
      senderURL: "http://127.0.0.1:5173/index.html",
      source: "renderer",
      timestamp: 100,
      webContentsID: 7,
    }
    setRendererMemoryDiagnosticsRecord(snapshot)

    recordShutdownDiagnostic(
      "render-process-gone",
      attachRendererMemoryDiagnostics(7, { reason: "oom", webContentsID: 7 }),
    )
    recordShutdownDiagnostic(
      "render-process-gone",
      attachRendererMemoryDiagnostics(8, { reason: "oom", webContentsID: 8 }),
    )

    const [withSnapshot, withoutSnapshot] = readDiagnosticEntries()
    expect(withSnapshot.details.lastRendererMemoryDiagnostics).toEqual(snapshot)
    expect(withoutSnapshot.details).toEqual({ reason: "oom", webContentsID: 8 })
  })

  it("falls back to cwd when userData is unavailable", () => {
    electronMock.app.getPath.mockImplementation(() => {
      throw new Error("not ready")
    })

    expect(getShutdownDiagnosticsLogPath()).toBe(path.join(process.cwd(), "shutdown-diagnostics.log"))
  })
})
