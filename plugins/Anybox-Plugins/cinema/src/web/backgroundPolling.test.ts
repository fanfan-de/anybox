import { describe, expect, it, vi } from "vitest"
import { createNonOverlappingPoll, refreshGenerationTasksIndependently } from "./backgroundPolling"

describe("background polling", () => {
  it("does not overlap event polls and reopens the gate after completion", async () => {
    let finish!: () => void
    const run = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const poll = createNonOverlappingPoll(run)

    const first = poll()
    await expect(poll()).resolves.toBe(false)
    expect(run).toHaveBeenCalledTimes(1)
    finish()
    await expect(first).resolves.toBe(true)

    const next = poll()
    expect(run).toHaveBeenCalledTimes(2)
    finish()
    await expect(next).resolves.toBe(true)
  })

  it("refreshes later generation tasks even when the first task fails", async () => {
    const refreshTask = vi.fn(async (taskID: string) => {
      if (taskID === "task-1") throw new Error("transient failure")
      return taskID
    })

    const results = await refreshGenerationTasksIndependently(["task-1", "task-2"], refreshTask)

    expect(refreshTask).toHaveBeenCalledTimes(2)
    expect(refreshTask).toHaveBeenNthCalledWith(2, "task-2")
    expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled"])
  })
})
