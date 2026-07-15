import { describe, expect, it } from "vitest"
import { pickCreateSessionUsageTipIndex } from "./create-session-tips"

describe("pickCreateSessionUsageTipIndex", () => {
  it("selects a valid initial tip", () => {
    expect(pickCreateSessionUsageTipIndex(-1, 12, () => 0)).toBe(0)
    expect(pickCreateSessionUsageTipIndex(-1, 12, () => 0.999)).toBe(11)
  })

  it("never immediately repeats the current tip", () => {
    for (let currentIndex = 0; currentIndex < 12; currentIndex += 1) {
      for (const randomValue of [0, 0.25, 0.5, 0.75, 0.999]) {
        const nextIndex = pickCreateSessionUsageTipIndex(currentIndex, 12, () => randomValue)
        expect(nextIndex).toBeGreaterThanOrEqual(0)
        expect(nextIndex).toBeLessThan(12)
        expect(nextIndex).not.toBe(currentIndex)
      }
    }
  })

  it("handles empty and single-item tip collections", () => {
    expect(pickCreateSessionUsageTipIndex(-1, 0, () => 0.5)).toBe(-1)
    expect(pickCreateSessionUsageTipIndex(-1, 1, () => 0.5)).toBe(0)
    expect(pickCreateSessionUsageTipIndex(0, 1, () => 0.5)).toBe(0)
  })
})
