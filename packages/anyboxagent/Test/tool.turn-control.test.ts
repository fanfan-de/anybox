import { afterEach, describe, expect, it, mock } from "bun:test"
import type { ToolCallTurnControl } from "@anybox/shared"

function createTurnRecorder(sessionID: string) {
  const events: Array<{ type: string; payload: unknown }> = []
  return {
    events,
    turn: {
      sessionID,
      turnID: `turn-${sessionID}`,
      emit(type: string, payload: unknown) {
        events.push({ type, payload: structuredClone(payload) })
        return {
          eventID: `${type}-${events.length}`,
          sessionID,
          turnID: `turn-${sessionID}`,
          seq: events.length,
          timestamp: Date.now(),
          type,
          payload,
        }
      },
      close() {},
    } as any,
  }
}

function createAssistant(sessionID: string) {
  return {
    id: `assistant-${sessionID}`,
    sessionID,
    role: "assistant",
    created: Date.now(),
    parentID: `user-${sessionID}`,
    modelID: "test-model",
    providerID: "test-provider",
    agent: "plan",
    turnID: `turn-${sessionID}`,
    path: { cwd: ".", root: "." },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  } as any
}

function createStreamInput() {
  return {
    messages: [],
    tools: {},
    model: { providerID: "test-provider", id: "test-model" },
    agent: { name: "plan" },
  } as any
}

describe("processor tool turn control", () => {
  afterEach(() => {
    mock.restore()
  })

  it("applies every explicit control mode without deriving control from metadata", async () => {
    let nextResults: Array<{
      control?: ToolCallTurnControl
      metadata?: Record<string, unknown>
    }> = []

    mock.module("#session/core/llm.ts", () => ({
      stream: async () => ({
        fullStream: (async function* () {
          yield { type: "start" }
          for (const [index, result] of nextResults.entries()) {
            const toolCallId = `tool-control-${index}`
            yield {
              type: "tool-call",
              toolCallId,
              toolName: "control_test",
              input: { index },
            }
            yield {
              type: "tool-result",
              toolCallId,
              toolName: "control_test",
              input: { index },
              output: {
                text: `result-${index}`,
                result: "success",
                completeness: "complete",
                sideEffect: "none",
                retry: "safe",
                metadata: result.metadata,
                control: result.control,
              },
            }
          }
          yield { type: "finish", finishReason: "tool-calls" }
        })(),
      }),
    }))

    const Processor = await import("#session/core/processor.ts")
    const cases: Array<{
      name: string
      controls: Array<ToolCallTurnControl | undefined>
      expected: "continue" | "restart" | "finish" | "stop" | "fail" | "cancel"
      metadata?: Record<string, unknown>
    }> = [
      { name: "continue", controls: [{ mode: "continue-model" }], expected: "continue" },
      { name: "restart", controls: [{ mode: "restart-loop" }], expected: "restart" },
      { name: "finish", controls: [{ mode: "finish-turn" }], expected: "finish" },
      { name: "wait", controls: [{ mode: "wait-user" }], expected: "stop" },
      { name: "fail", controls: [{ mode: "fail-turn" }], expected: "fail" },
      { name: "cancel", controls: [{ mode: "cancel-turn" }], expected: "cancel" },
      {
        name: "metadata-does-not-control",
        controls: [undefined],
        expected: "continue",
        metadata: { kind: "workflow-control", restartLoop: true },
      },
      {
        name: "priority",
        controls: [
          { mode: "cancel-turn", reason: "highest priority" },
          { mode: "fail-turn" },
          { mode: "wait-user" },
          { mode: "finish-turn" },
          { mode: "restart-loop" },
          { mode: "continue-model" },
        ],
        expected: "cancel",
      },
    ]

    for (const testCase of cases) {
      nextResults = testCase.controls.map((control) => ({
        control,
        metadata: testCase.metadata,
      }))
      const sessionID = `session-${testCase.name}`
      const recorded = createTurnRecorder(sessionID)
      const processor = Processor.create({
        Assistant: createAssistant(sessionID),
        turn: recorded.turn,
      })

      expect(await processor.process(createStreamInput())).toBe(testCase.expected)
      expect(processor.turnControl?.mode ?? "continue-model").toBe(
        testCase.controls.find((control) => control?.mode === "cancel-turn")?.mode ??
          testCase.controls[0]?.mode ??
          "continue-model",
      )
    }
  })
})
