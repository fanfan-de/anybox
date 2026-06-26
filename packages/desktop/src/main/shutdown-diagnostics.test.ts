import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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

let tempDir: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "anybox-shutdown-diagnostics-"))
  electronMock.app.getPath.mockReturnValue(tempDir)
  electronMock.app.getVersion.mockReturnValue("0.1.23")
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
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

  it("falls back to cwd when userData is unavailable", () => {
    electronMock.app.getPath.mockImplementation(() => {
      throw new Error("not ready")
    })

    expect(getShutdownDiagnosticsLogPath()).toBe(path.join(process.cwd(), "shutdown-diagnostics.log"))
  })
})
