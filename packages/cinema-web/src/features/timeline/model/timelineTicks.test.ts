import { describe, expect, it } from "vitest"
import { timelineRulerScale, timelineRulerTicks } from "./timelineTicks"

const frameRate = { numerator: 24, denominator: 1 }

describe("Timeline ruler ticks", () => {
  it("uses frame ticks at the closest zoom and second-scale labels otherwise", () => {
    expect(timelineRulerScale(192, frameRate).minorStepUs).toBe(41_667)
    expect(timelineRulerScale(48, frameRate)).toEqual({ minorStepUs: 400_000, majorStepUs: 2_000_000 })
  })

  it("reaches ten-second and minute-scale labels when zoomed out", () => {
    expect(timelineRulerScale(12, frameRate).majorStepUs).toBe(10_000_000)
    expect(timelineRulerScale(1, frameRate).majorStepUs).toBe(120_000_000)
  })

  it("only materializes ticks around the visible viewport", () => {
    const ticks = timelineRulerTicks({
      pixelsPerSecond: 48,
      frameRate,
      scrollLeft: 4_912,
      viewportWidth: 1_000,
      trackHeaderWidth: 112,
      durationUs: 1_800_000_000,
    })
    expect(ticks.length).toBeLessThan(100)
    expect(ticks[0]!.timeUs).toBeGreaterThan(90_000_000)
    expect(ticks.some((tick) => tick.major && tick.label === "1:40")).toBe(true)
  })
})
