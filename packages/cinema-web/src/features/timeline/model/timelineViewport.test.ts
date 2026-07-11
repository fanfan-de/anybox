import { describe, expect, it } from "vitest"
import {
  timelinePointerAnchorTime,
  timelineScrollLeftForAnchor,
  timelineWheelZoom,
} from "./timelineViewport"

describe("Timeline viewport", () => {
  it("keeps the pointer time stable while zooming", () => {
    const anchorTimeUs = timelinePointerAnchorTime(360, 420, 148, 48)
    const nextScrollLeft = timelineScrollLeftForAnchor(anchorTimeUs, 420, 148, 96)

    expect(anchorTimeUs).toBe(13_166_667)
    expect(nextScrollLeft).toBeCloseTo(992, 4)
    expect(timelinePointerAnchorTime(nextScrollLeft, 420, 148, 96)).toBeCloseTo(anchorTimeUs, -1)
  })

  it("clamps wheel zoom to the supported range", () => {
    expect(timelineWheelZoom(48, -100)).toBeGreaterThan(48)
    expect(timelineWheelZoom(48, 100)).toBeLessThan(48)
    expect(timelineWheelZoom(190, -10_000)).toBe(192)
    expect(timelineWheelZoom(13, 10_000)).toBe(0.5)
  })

  it("does not scroll before the Timeline origin", () => {
    expect(timelineScrollLeftForAnchor(0, 600, 148, 96)).toBe(0)
  })
})
