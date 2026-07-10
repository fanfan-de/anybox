import { describe, expect, it } from "vitest"
import { canRestoreGeneratedText, type TextGenerationUndoRecord } from "./textGenerationUndo"

describe("text generation undo", () => {
  const record: TextGenerationUndoRecord = {
    nodeID: "text-1",
    previousText: "Before",
    generatedText: "After",
    expiresAt: 10_000,
  }

  it("allows restoration while the generated text is unchanged", () => {
    expect(canRestoreGeneratedText(record, "After", 9_000)).toBe(true)
  })

  it("expires after editing, regenerating, deletion, or timeout", () => {
    expect(canRestoreGeneratedText(record, "Edited", 9_000)).toBe(false)
    expect(canRestoreGeneratedText(record, "Another generation", 9_000)).toBe(false)
    expect(canRestoreGeneratedText(record, undefined, 9_000)).toBe(false)
    expect(canRestoreGeneratedText(record, "After", 10_001)).toBe(false)
  })
})
