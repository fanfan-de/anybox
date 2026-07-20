import { describe, expect, test } from "bun:test"
import { buildComputerUseTelemetry } from "../src/mcp/computer-use/telemetry.ts"

describe("Computer Use security telemetry", () => {
  test("emits only bounded metadata and irreversible identifiers", () => {
    const sensitive = {
      sessionID: "session-private-value",
      turnID: "turn-private-value",
      toolCallID: "call-private-value",
      appID: "win32:private-app:identity",
      windowRef: "window-private-reference",
      stateRef: "state-private-reference",
    }
    const fields = buildComputerUseTelemetry({
      ...sensitive,
      toolName: "type_text",
      operation: "perform_action",
      durationMs: 12.4,
      resultCode: "CU_TIMEOUT",
      helperVersion: "0.2.0",
      effectMayHaveOccurred: true,
    })
    const serialized = JSON.stringify(fields)

    for (const value of Object.values(sensitive)) {
      expect(serialized).not.toContain(value)
    }
    expect(fields).toMatchObject({
      toolName: "type_text",
      operation: "perform_action",
      durationMs: 12,
      resultCode: "CU_TIMEOUT",
      helperVersion: "0.2.0",
      effectMayHaveOccurred: true,
    })
    expect(fields.sessionDigest).toHaveLength(20)
    expect(fields.windowDigest).toHaveLength(20)
    expect(fields.stateDigest).toHaveLength(20)
    expect(Object.keys(fields).sort()).toEqual([
      "appDigest",
      "durationMs",
      "effectMayHaveOccurred",
      "helperVersion",
      "operation",
      "resultCode",
      "sessionDigest",
      "stateDigest",
      "toolCallDigest",
      "toolName",
      "turnDigest",
      "windowDigest",
    ])
  })

  test("rejects unbounded labels instead of copying them to logs", () => {
    const injected = "typed secret with spaces and\nnewlines"
    const fields = buildComputerUseTelemetry({
      sessionID: "s",
      turnID: "t",
      toolCallID: "c",
      toolName: injected,
      operation: injected,
      durationMs: -10,
      resultCode: injected,
    })
    expect(fields).toMatchObject({
      toolName: "unknown",
      operation: "unknown",
      resultCode: "CU_INTERNAL_ERROR",
      durationMs: 0,
    })
    expect(JSON.stringify(fields)).not.toContain(injected)
  })
})
