import { describe, expect, it } from "vitest"
import { clampContextMenuPosition } from "./contextMenuPosition"

describe("clampContextMenuPosition", () => {
  it("keeps a position that already fits within the viewport", () => {
    expect(clampContextMenuPosition(120, 80, 184, 48, 1280, 720)).toEqual({
      x: 120,
      y: 80,
    })
  })

  it("clamps a menu near the bottom-right edge", () => {
    expect(clampContextMenuPosition(1200, 680, 184, 48, 1280, 720)).toEqual({
      x: 1088,
      y: 664,
    })
  })

  it("clamps negative coordinates to the safe margin", () => {
    expect(clampContextMenuPosition(-30, -20, 184, 48, 1280, 720)).toEqual({
      x: 8,
      y: 8,
    })
  })

  it("anchors an oversized menu at the safe margin", () => {
    expect(clampContextMenuPosition(100, 100, 400, 300, 320, 240)).toEqual({
      x: 8,
      y: 8,
    })
  })
})
