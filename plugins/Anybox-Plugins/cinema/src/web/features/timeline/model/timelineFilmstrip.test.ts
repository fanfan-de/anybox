import { describe, expect, it } from "vitest"
import { timelineFilmstripCells } from "./timelineFilmstrip"

describe("Timeline filmstrip virtualization", () => {
  it("only creates cells around the visible portion of a long Clip", () => {
    const cells = timelineFilmstripCells({
      clipLeftPx: 0,
      clipWidthPx: 72_000,
      visibleStartPx: 14_400,
      visibleEndPx: 15_120,
    })
    expect(cells.length).toBeLessThanOrEqual(13)
    expect(cells[0]?.index).toBe(199)
    expect(cells.at(-1)?.index).toBe(210)
  })

  it("clips the final repeated thumbnail to the Clip edge", () => {
    expect(timelineFilmstripCells({
      clipLeftPx: 100,
      clipWidthPx: 100,
      visibleStartPx: 0,
      visibleEndPx: 500,
    })).toEqual([
      { index: 0, leftPx: 0, widthPx: 72 },
      { index: 1, leftPx: 72, widthPx: 28 },
    ])
  })

  it("returns no cells outside the viewport", () => {
    expect(timelineFilmstripCells({
      clipLeftPx: 1_000,
      clipWidthPx: 200,
      visibleStartPx: 0,
      visibleEndPx: 900,
    })).toEqual([])
  })
})
