import { describe, expect, it } from "vitest"
import { timelineSourceRangePeaks } from "./timelineWaveform"

describe("Timeline waveform source mapping", () => {
  const peaks = Array.from({ length: 101 }, (_, index) => index / 100)

  it("crops peaks to the Clip source range", () => {
    const visible = timelineSourceRangePeaks(peaks, 2_000_000, 4_000_000, 10_000_000)
    expect(visible).toHaveLength(41)
    expect(visible[0]).toBe(0.2)
    expect(visible.at(-1)).toBe(0.6)
  })

  it("maps a start trim without regenerating the underlying waveform", () => {
    expect(timelineSourceRangePeaks(peaks, 5_000_000, 5_000_000, 10_000_000)[0]).toBe(0.5)
    expect(peaks).toHaveLength(101)
  })

  it("falls back to all peaks when asset duration is unknown", () => {
    expect(timelineSourceRangePeaks(peaks, 2_000_000, 4_000_000, null)).toEqual(peaks)
  })
})
