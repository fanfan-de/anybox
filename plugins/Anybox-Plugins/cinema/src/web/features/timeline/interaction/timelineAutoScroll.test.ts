import { describe, expect, it } from "vitest"
import {
  timelineAutoScrollLeft,
  timelineAutoScrollVelocity,
} from "./timelineAutoScroll"

describe("timeline auto scroll", () => {
  it("accelerates toward either edge and stays idle in the center", () => {
    expect(timelineAutoScrollVelocity(105, 100, 500)).toBeLessThan(-15)
    expect(timelineAutoScrollVelocity(495, 100, 500)).toBeGreaterThan(15)
    expect(timelineAutoScrollVelocity(300, 100, 500)).toBe(0)
    expect(Math.abs(timelineAutoScrollVelocity(110, 100, 500)))
      .toBeGreaterThan(Math.abs(timelineAutoScrollVelocity(130, 100, 500)))
  })

  it("clamps scrolling to the available content range", () => {
    expect(timelineAutoScrollLeft(0, -20, 2_000, 800)).toBe(0)
    expect(timelineAutoScrollLeft(400, 20, 2_000, 800)).toBe(420)
    expect(timelineAutoScrollLeft(1_190, 20, 2_000, 800)).toBe(1_200)
  })
})
