import { describe, expect, it } from "vitest"
import {
  formatTimelineTime,
  timelineSecondsInputFromUs,
  timelineSecondsInputToUs,
} from "./timelineTime"

describe("Timeline time presentation", () => {
  it("formats transport time with milliseconds", () => {
    expect(formatTimelineTime(0)).toBe("00:00:00.000")
    expect(formatTimelineTime(3_723_456_789)).toBe("01:02:03.456")
  })

  it("round-trips decimal seconds without changing the microsecond contract", () => {
    expect(timelineSecondsInputFromUs(0)).toBe("0")
    expect(timelineSecondsInputFromUs(1_250_001)).toBe("1.250001")
    expect(timelineSecondsInputToUs("1.250001")).toBe(1_250_001)
    expect(timelineSecondsInputToUs(".5")).toBe(500_000)
  })

  it("rejects negative, exponent, and over-precision input", () => {
    expect(timelineSecondsInputToUs("-1")).toBeNull()
    expect(timelineSecondsInputToUs("1e3")).toBeNull()
    expect(timelineSecondsInputToUs("0.1234567")).toBeNull()
  })
})
