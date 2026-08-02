import { describe, expect, it } from "bun:test"
import { normalizeTerminalOutput } from "#shell/terminal-output.ts"

describe("terminal output normalization", () => {
  it("removes ANSI control sequences and normalizes terminal line endings", () => {
    expect(normalizeTerminalOutput("\x1b[32mready\x1b[0m\r\nvalue\rnext\x08!\n")).toBe(
      "ready\nvalue\nnex!\n",
    )
  })

  it("removes OSC title updates from model-facing output", () => {
    expect(normalizeTerminalOutput("before\x1b]0;secret title\x07after")).toBe("beforeafter")
  })
})
