import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ToastProvider } from "./toast"
import { useSettingsPage } from "./use-settings-page"

function wrapper({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>
}

const optimizeResult = {
  traceDeleted: 3,
  orphanArtifactsDeleted: 2,
  toolPartsMigrated: 1,
  archivedSnapshotsMigrated: 1,
  cleanedCount: 5,
  migratedCount: 2,
  beforeBytes: 10_000,
  afterBytes: 4_000,
  reclaimedBytes: 6_000,
  durationMs: 25,
  completedAt: 100,
}

describe("useSettingsPage storage optimization", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.desktop = undefined
  })

  it("confirms, prevents duplicate execution, and refreshes usage after success", async () => {
    let resolveOptimize!: (value: typeof optimizeResult) => void
    const optimizeStorage = vi.fn(() => new Promise<typeof optimizeResult>((resolve) => {
      resolveOptimize = resolve
    }))
    const getStorageUsage = vi.fn().mockResolvedValue(null)
    window.desktop = { optimizeStorage, getStorageUsage } as unknown as Window["desktop"]
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true)
    const { result } = renderHook(() => useSettingsPage({}), { wrapper })

    let first!: Promise<boolean>
    let duplicate!: Promise<boolean>
    act(() => {
      first = result.current.optimizeStorage()
      duplicate = result.current.optimizeStorage()
    })

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("trace"))
    expect(optimizeStorage).toHaveBeenCalledTimes(1)
    await expect(duplicate).resolves.toBe(false)
    expect(result.current.isOptimizingStorage).toBe(true)

    resolveOptimize(optimizeResult)
    await act(async () => {
      await expect(first).resolves.toBe(true)
    })
    await waitFor(() => expect(result.current.isOptimizingStorage).toBe(false))
    expect(getStorageUsage).toHaveBeenCalledTimes(1)
    expect(result.current.storageOptimizeMessage).toMatchObject({ tone: "success" })
  })

  it("keeps the action reusable and shows a nearby error after failure", async () => {
    const optimizeStorage = vi.fn().mockRejectedValue(new Error("STORAGE_MAINTENANCE_BUSY"))
    window.desktop = { optimizeStorage } as unknown as Window["desktop"]
    vi.spyOn(window, "confirm").mockReturnValue(true)
    const { result } = renderHook(() => useSettingsPage({}), { wrapper })

    await act(async () => {
      await expect(result.current.optimizeStorage()).resolves.toBe(false)
    })

    expect(result.current.isOptimizingStorage).toBe(false)
    expect(result.current.storageOptimizeMessage).toEqual({
      tone: "error",
      text: "STORAGE_MAINTENANCE_BUSY",
    })
  })
})
