import { describe, expect, it } from "vitest"
import { TEXT_NODE_MAX_LINES, TEXT_NODE_MIN_LINES, textNodeVisibleLineCount } from "./textNodeLayout"

describe("text node visible line count", () => {
  it("keeps empty and short text at the four-line minimum", () => {
    expect(textNodeVisibleLineCount("")).toBe(TEXT_NODE_MIN_LINES)
    expect(textNodeVisibleLineCount("Short note")).toBe(TEXT_NODE_MIN_LINES)
  })

  it("grows with content and clamps long text to twelve lines", () => {
    expect(textNodeVisibleLineCount("a\nb\nc\nd\ne\nf")).toBe(6)
    expect(textNodeVisibleLineCount("x".repeat(1_000))).toBe(TEXT_NODE_MAX_LINES)
  })
})
