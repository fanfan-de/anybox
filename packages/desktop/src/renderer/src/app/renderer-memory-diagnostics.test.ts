import { afterEach, describe, expect, it, vi } from "vitest"
import {
  clearRendererPerformanceEntries,
  installRendererMemoryDiagnostics,
  uninstallRendererMemoryDiagnostics,
} from "./renderer-memory-diagnostics"

afterEach(() => {
  uninstallRendererMemoryDiagnostics()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function installPerformanceMock(input: {
  clearMarks?: () => void
  clearMeasures?: () => void
  clearResourceTimings?: () => void
}) {
  vi.stubGlobal("performance", input)
  return input
}

describe("renderer performance entry cleanup", () => {
  it("clears marks and measures immediately and every second in development", () => {
    vi.useFakeTimers()
    const clearMarks = vi.fn()
    const clearMeasures = vi.fn()
    installPerformanceMock({ clearMarks, clearMeasures })

    installRendererMemoryDiagnostics()

    expect(clearMeasures).toHaveBeenCalledTimes(1)
    expect(clearMarks).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(2_000)

    expect(clearMeasures).toHaveBeenCalledTimes(3)
    expect(clearMarks).toHaveBeenCalledTimes(3)
  })

  it("does not install performance cleanup outside development", () => {
    vi.useFakeTimers()
    vi.stubEnv("DEV", false)
    const clearMarks = vi.fn()
    const clearMeasures = vi.fn()
    installPerformanceMock({ clearMarks, clearMeasures })

    installRendererMemoryDiagnostics()
    vi.advanceTimersByTime(2_000)

    expect(clearMeasures).not.toHaveBeenCalled()
    expect(clearMarks).not.toHaveBeenCalled()
  })

  it("stops periodic cleanup when diagnostics are uninstalled", () => {
    vi.useFakeTimers()
    const clearMarks = vi.fn()
    const clearMeasures = vi.fn()
    installPerformanceMock({ clearMarks, clearMeasures })

    installRendererMemoryDiagnostics()
    uninstallRendererMemoryDiagnostics()
    vi.advanceTimersByTime(2_000)

    expect(clearMeasures).toHaveBeenCalledTimes(1)
    expect(clearMarks).toHaveBeenCalledTimes(1)
  })

  it("does not clear resource or other performance entries", () => {
    const clearMarks = vi.fn()
    const clearMeasures = vi.fn()
    const clearResourceTimings = vi.fn()
    installPerformanceMock({ clearMarks, clearMeasures, clearResourceTimings })

    clearRendererPerformanceEntries()

    expect(clearMeasures).toHaveBeenCalledOnce()
    expect(clearMarks).toHaveBeenCalledOnce()
    expect(clearResourceTimings).not.toHaveBeenCalled()
  })

  it("silently tolerates missing or throwing Performance cleanup APIs", () => {
    installPerformanceMock({})
    expect(() => clearRendererPerformanceEntries()).not.toThrow()

    const clearMarks = vi.fn(() => {
      throw new Error("marks unavailable")
    })
    const clearMeasures = vi.fn(() => {
      throw new Error("measures unavailable")
    })
    installPerformanceMock({ clearMarks, clearMeasures })

    expect(() => clearRendererPerformanceEntries()).not.toThrow()
    expect(clearMeasures).toHaveBeenCalledOnce()
    expect(clearMarks).toHaveBeenCalledOnce()
  })
})
