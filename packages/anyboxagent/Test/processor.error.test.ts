import { afterEach, describe, expect, it } from "bun:test"
import * as LLM from "#session/core/llm.ts"
import * as Message from "#session/core/message.ts"
import * as Provider from "#provider/provider.ts"

let restoreLLM: (() => void) | undefined

function createTurnRecorder(sessionID: string) {
  const events: Array<{ type: string; payload: any }> = []

  return {
    events,
    turn: {
      sessionID,
      turnID: "turn-test",
      emit(type: string, payload: unknown) {
        events.push({
          type,
          payload: structuredClone(payload),
        })

        return {
          eventID: `${type}-${events.length}`,
          sessionID,
          turnID: "turn-test",
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

function createStreamInput() {
  return {
    messages: [],
    system: [],
    tools: {},
    abort: new AbortController().signal,
    model: {
      ...Provider.testDeepSeekModel,
      providerID: "openai",
      id: "gpt-5.3-codex",
      api: {
        ...Provider.testDeepSeekModel.api,
        id: "gpt-5.3-codex",
        url: "https://example.test/v1",
      },
      capabilities: {
        ...Provider.testDeepSeekModel.capabilities,
        input: {
          ...Provider.testDeepSeekModel.capabilities.input,
        },
        output: {
          ...Provider.testDeepSeekModel.capabilities.output,
        },
      },
    },
    agent: {
      name: "plan",
      mode: "primary",
    },
  } as any
}

describe("processor stream error persistence", () => {
  afterEach(() => {
    restoreLLM?.()
    restoreLLM = undefined
  })

  it("records stream-only errors on the assistant message", async () => {
    restoreLLM = LLM.setRuntimeDependenciesForTesting({
      getLanguage: async (model) => model as never,
      streamText: (() => ({
        fullStream: (async function* () {
          yield { type: "start" }
          yield {
            type: "error",
            error: new Error("Instructions are required"),
          }
        })(),
      })) as never,
    })

    const Processor = await import("#session/core/processor.ts")
    const recorded = createTurnRecorder("session-1")
    const assistant = {
      id: "assistant-1",
      sessionID: "session-1",
      role: "assistant",
      created: Date.now(),
      parentID: "user-1",
      modelID: "gpt-5.3-codex",
      providerID: "openai",
      agent: "plan",
      path: {
        cwd: ".",
        root: ".",
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
    } as any

    const processor = Processor.create({
      Assistant: assistant,
      turn: recorded.turn,
    })

    expect(await processor.process(createStreamInput())).toBe("stop")
    expect(assistant.error).toEqual({
      name: "UnknownError",
      data: {
        message: "Instructions are required",
      },
    })

    const failed = recorded.events.find((event) => event.type === "llm.call.failed")
    expect(failed?.payload.error).toBe("Instructions are required")
  })

  it("normalizes string tool inputs before recording tool state", async () => {
    restoreLLM = LLM.setRuntimeDependenciesForTesting({
      getLanguage: async (model) => model as never,
      streamText: (() => ({
        fullStream: (async function* () {
          yield { type: "start" }
          yield {
            type: "tool-call",
            toolCallId: "tool-string-input",
            toolName: "read_file",
            input: "{\"path\":\"README.md\"}",
          }
          yield {
            type: "tool-error",
            toolCallId: "tool-string-input",
            toolName: "read_file",
            input: "not-json",
            error: new Error("read failed"),
          }
          yield {
            type: "finish",
            finishReason: "stop",
          }
        })(),
      })) as never,
    })

    const Processor = await import("#session/core/processor.ts")
    const recorded = createTurnRecorder("session-2")
    const assistant = {
      id: "assistant-2",
      sessionID: "session-2",
      role: "assistant",
      created: Date.now(),
      parentID: "user-2",
      modelID: "gpt-5.3-codex",
      providerID: "openai",
      agent: "plan",
      path: {
        cwd: ".",
        root: ".",
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
    } as any

    const processor = Processor.create({
      Assistant: assistant,
      turn: recorded.turn,
    })

    expect(await processor.process(createStreamInput())).toBe("continue")

    const started = recorded.events.find((event) => event.type === "tool.call.phase_changed")
    expect(started?.payload.part.input.value).toEqual({ path: "README.md" })
    expect(started?.payload.part.input.raw).toBe("{\"path\":\"README.md\"}")
    expect(Message.ToolPart.safeParse(started?.payload.part).success).toBe(true)

    const failed = recorded.events.find((event) => event.type === "tool.call.settled")
    expect(failed?.payload.part.input.value).toEqual({ path: "README.md" })
    expect(failed?.payload.part.input.raw).toBe("{\"path\":\"README.md\"}")
    expect(failed?.payload.part.state).toMatchObject({
      phase: "settled",
      outcome: {
        kind: "failed",
        error: {
          code: "TOOL_EXECUTION_ERROR",
          message: "read failed",
        },
      },
      control: { mode: "continue-model" },
    })
    expect(Message.ToolPart.safeParse(failed?.payload.part).success).toBe(true)
  })

  it("recovers tool argument shape stream errors as blocked calls", async () => {
    restoreLLM = LLM.setRuntimeDependenciesForTesting({
      getLanguage: async (model) => model as never,
      streamText: (() => ({
        fullStream: (async function* () {
          yield { type: "start" }
          yield {
            type: "tool-input-start",
            id: "tool-bad-args",
            toolName: "multi_tool_use_parallel",
          }
          yield {
            type: "tool-input-delta",
            id: "tool-bad-args",
            delta: "{\"calls\":",
          }
          yield {
            type: "error",
            error: new Error("Invalid input: expected record, received string"),
          }
        })(),
      })) as never,
    })

    const Processor = await import("#session/core/processor.ts")
    const recorded = createTurnRecorder("session-3")
    const assistant = {
      id: "assistant-3",
      sessionID: "session-3",
      role: "assistant",
      created: Date.now(),
      parentID: "user-3",
      modelID: "gpt-5.3-codex",
      providerID: "openai",
      agent: "plan",
      path: {
        cwd: ".",
        root: ".",
      },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
    } as any

    const processor = Processor.create({
      Assistant: assistant,
      turn: recorded.turn,
    })

    expect(await processor.process(createStreamInput())).toBe("continue")
    expect(assistant.error).toBeUndefined()
    expect(assistant.finishReason).toBe("tool-calls")
    expect(typeof assistant.completed).toBe("number")
    expect(recorded.events.some((event) => event.type === "llm.call.failed")).toBe(false)

    const blocked = recorded.events.find((event) => event.type === "tool.call.settled")
    expect(blocked?.payload.part.input).toMatchObject({ raw: "{\"calls\":" })
    const parsedBlockedPart = Message.ToolPart.safeParse(blocked?.payload.part)
    if (!parsedBlockedPart.success) throw parsedBlockedPart.error
    expect(blocked?.payload.part.state).toMatchObject({
      phase: "settled",
      outcome: {
        kind: "blocked",
        code: "TOOL_INPUT_VALIDATION_BLOCKED",
      },
      control: { mode: "continue-model" },
    })
    expect(blocked?.payload.part.state.outcome.reason).toContain("Tool argument validation failed")

    const modelMessages = await Message.toModelMessages(
      [
        {
          info: assistant,
          parts: [blocked?.payload.part],
        },
      ] as any,
      createStreamInput().model,
    )
    const toolMessage = modelMessages.find((message) => message.role === "tool") as any
    expect(toolMessage?.content[0]?.output?.type).toBe("error-text")
    expect(toolMessage?.content[0]?.output?.value).toContain("Tool argument validation failed")
  })
})
