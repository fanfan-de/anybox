const ANSI_OSC = /\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g
const ANSI_CSI = /\x1B\[[0-?]*[ -/]*[@-~]/g
const ANSI_TWO_CHAR = /\x1B[@-_]/g

function applyBackspaces(input: string) {
  const output: string[] = []
  for (const char of input) {
    if (char === "\u0008") {
      output.pop()
      continue
    }
    output.push(char)
  }
  return output.join("")
}

export function normalizeTerminalOutput(input: string) {
  const normalized = input
    .replace(ANSI_OSC, "")
    .replace(ANSI_CSI, "")
    .replace(ANSI_TWO_CHAR, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
  return applyBackspaces(normalized)
}
