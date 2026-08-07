import { afterEach, describe, expect, it } from "bun:test"
import * as LLM from "#session/core/llm.ts"
import * as Provider from "#provider/provider.ts"
import * as Log from "#util/log.ts"

let restoreLLM: (() => void) | undefined

function createTurnRecorder(sessionID: string) {
  const events: Array<{ type: string; payload: any }> = []

  return {
    events,
    turn: {
      sessionID,
      turnID: "turn-stream-probe",
      emit(type: string, payload: unknown) {
        events.push({
          type,
          payload: structuredClone(payload),
        })

        return {
          eventID: `${type}-${events.length}`,
          sessionID,
          turnID: "turn-stream-probe",
          seq: events.length,
          timestamp: Date.now(),
          type,
          payload,
        }
      },
      emitStream(type: string, payload: unknown) {
        events.push({
          type,
          payload: structuredClone(payload),
        })
      },
      flushStreamEvents() {},
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

describe("processor fullStream consumption probe", () => {
  afterEach(async () => {
    restoreLLM?.()
    restoreLLM = undefined
    delete process.env.ANYBOX_DEBUG_FULLSTREAM_PROBE
    await Log.init({ print: true, file: false, level: "INFO" })
  })

  it("summarizes top-level and tool-result images in llm.call.started without recording bytes", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "base64",
    )
    restoreLLM = LLM.setRuntimeDependenciesForTesting({
      getLanguage: async (model) => model as never,
      streamText: ((options: any) => ({
        fullStream: (async function* () {
          yield { type: "start" }
          yield {
            type: "finish",
            finishReason: "stop",
            totalUsage: { inputTokens: 1, outputTokens: 1 },
          }
          await options.onFinish?.({
            finishReason: "stop",
            text: "",
            totalUsage: { inputTokens: 1, outputTokens: 1 },
          })
        })(),
      })) as never,
    })

    const Processor = await import("#session/core/processor.ts")
    const sessionID = `session-image-trace-${Date.now()}`
    const recorded = createTurnRecorder(sessionID)
    const assistant = {
      id: `assistant-image-trace-${Date.now()}`,
      sessionID,
      role: "assistant",
      created: Date.now(),
      parentID: "user-image-trace",
      modelID: "gpt-5.3-codex",
      providerID: "openai",
      agent: "plan",
      path: { cwd: ".", root: "." },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    } as any
    const streamInput = createStreamInput()
    streamInput.messages = [
      {
        role: "user",
        content: [{ type: "image", image: new Uint8Array(png), mediaType: "image/png" }],
      },
      {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: "call-view-image",
          toolName: "view_image",
          output: {
            type: "content",
            value: [{
              type: "file",
              data: { type: "data", data: new Uint8Array(png) },
              mediaType: "image/png",
              filename: "pixel.png",
            }],
          },
        }],
      },
    ] as any

    const processor = Processor.create({ Assistant: assistant, turn: recorded.turn })
    expect(await processor.process(streamInput)).toBe("continue")

    const started = recorded.events.find((event) => event.type === "llm.call.started")
    expect(started?.payload).toMatchObject({
      topLevelImageParts: 1,
      toolResultImageParts: 1,
      totalImageBytes: png.byteLength * 2,
      hasAttachments: true,
      images: [
        {
          location: "top-level",
          mime: "image/png",
          bytes: png.byteLength,
          width: 1,
          height: 1,
        },
        {
          location: "tool-result",
          mime: "image/png",
          bytes: png.byteLength,
          width: 1,
          height: 1,
          sourceTool: "view_image",
        },
      ],
    })
    expect(started?.payload.images.every((image: any) => /^[a-f0-9]{64}$/.test(image.sha256))).toBe(true)
    expect(JSON.stringify(started?.payload)).not.toContain("iVBORw0KGgo")
    expect(JSON.stringify(started?.payload)).not.toContain("data:image")
  })

  it("keeps fullStream chunk probe logs disabled by default", async () => {
    await Log.init({ print: true, file: false, level: "DEBUG" })
    delete process.env.ANYBOX_DEBUG_FULLSTREAM_PROBE

    restoreLLM = LLM.setRuntimeDependenciesForTesting({
      getLanguage: async (model) => model as never,
      streamText: ((options: any) => ({
        fullStream: (async function* () {
          yield { type: "start" }
          yield { type: "text-start" }
          yield { type: "text-delta", text: "hello" }
          yield { type: "text-end" }
          yield {
            type: "finish",
            finishReason: "stop",
            totalUsage: {
              inputTokens: 1,
              outputTokens: 1,
            },
          }
          await options.onFinish?.({
            finishReason: "stop",
            text: "hello",
            totalUsage: {
              inputTokens: 1,
              outputTokens: 1,
            },
          })
        })(),
      })) as never,
    })

    const Processor = await import("#session/core/processor.ts")
    const sessionID = `session-stream-probe-${Date.now()}`
    const assistantID = `assistant-stream-probe-${Date.now()}`
    const recorded = createTurnRecorder(sessionID)
    const assistant = {
      id: assistantID,
      sessionID,
      role: "assistant",
      created: Date.now(),
      parentID: "user-stream-probe",
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

    const entries = Log.list({
      service: "session.processor",
      q: assistantID,
      limit: 50,
    })
    const started = entries.find((entry) => entry.message === "fullStream.consume.started")
    const chunks = entries.filter((entry) => entry.message === "fullStream.chunk.consumed")
    const completed = entries.find((entry) => entry.message === "fullStream.consume.completed")

    expect(started?.level).toBe("DEBUG")
    expect(started?.extra?.messageID).toBe(assistantID)
    expect(chunks).toHaveLength(0)
    expect(completed?.level).toBe("DEBUG")
    expect(completed?.extra?.chunkCount).toBe(5)
    expect(completed?.extra?.totalMs).toBeNumber()
  })

  it("emits DEBUG timing logs for every consumed fullStream chunk when probe logging is enabled", async () => {
    await Log.init({ print: true, file: false, level: "DEBUG" })
    process.env.ANYBOX_DEBUG_FULLSTREAM_PROBE = "1"

    restoreLLM = LLM.setRuntimeDependenciesForTesting({
      getLanguage: async (model) => model as never,
      streamText: ((options: any) => ({
        fullStream: (async function* () {
          yield { type: "start" }
          yield { type: "text-start" }
          yield { type: "text-delta", text: "hello" }
          yield { type: "text-end" }
          yield {
            type: "finish",
            finishReason: "stop",
            totalUsage: {
              inputTokens: 1,
              outputTokens: 1,
            },
          }
          await options.onFinish?.({
            finishReason: "stop",
            text: "hello",
            totalUsage: {
              inputTokens: 1,
              outputTokens: 1,
            },
          })
        })(),
      })) as never,
    })

    const Processor = await import("#session/core/processor.ts")
    const sessionID = `session-stream-probe-enabled-${Date.now()}`
    const assistantID = `assistant-stream-probe-enabled-${Date.now()}`
    const recorded = createTurnRecorder(sessionID)
    const assistant = {
      id: assistantID,
      sessionID,
      role: "assistant",
      created: Date.now(),
      parentID: "user-stream-probe",
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

    const entries = Log.list({
      service: "session.processor",
      q: assistantID,
      limit: 50,
    })
    const chunks = entries.filter((entry) => entry.message === "fullStream.chunk.consumed")
    const delta = chunks.find((entry) => entry.extra?.chunkType === "text-delta")

    expect(chunks).toHaveLength(5)
    expect(chunks.map((entry) => entry.extra?.chunkType)).toEqual([
      "start",
      "text-start",
      "text-delta",
      "text-end",
      "finish",
    ])
    expect(delta?.level).toBe("DEBUG")
    expect(delta?.extra?.textLength).toBe(5)
    expect(delta?.extra?.sequence).toBe(2)
    expect(delta?.extra?.waitMs).toBeNumber()
    expect(delta?.extra?.handleMs).toBeNumber()
    expect(delta?.extra?.elapsedMs).toBeNumber()
  })

  it("buffers tool-input-delta chunks without emitting every pending update", async () => {
    await Log.init({ print: true, file: false, level: "INFO" })
    const raw = "x".repeat(3000)

    restoreLLM = LLM.setRuntimeDependenciesForTesting({
      getLanguage: async (model) => model as never,
      streamText: ((options: any) => ({
        fullStream: (async function* () {
          yield { type: "start" }
          yield { type: "tool-input-start", id: "call_1", toolName: "write" }
          for (const delta of raw) {
            yield { type: "tool-input-delta", id: "call_1", delta }
          }
          yield { type: "tool-input-end", id: "call_1" }
          yield {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "write",
            input: { path: "README.md" },
            title: "Write file",
          }
          yield {
            type: "tool-result",
            toolCallId: "call_1",
            input: { path: "README.md" },
            output: "ok",
            title: "Write file",
            providerMetadata: {},
          }
          yield {
            type: "finish",
            finishReason: "tool-calls",
            totalUsage: {
              inputTokens: 1,
              outputTokens: 1,
            },
          }
          await options.onFinish?.({
            finishReason: "tool-calls",
            text: "",
            totalUsage: {
              inputTokens: 1,
              outputTokens: 1,
            },
          })
        })(),
      })) as never,
    })

    const Processor = await import("#session/core/processor.ts")
    const sessionID = `session-tool-input-buffer-${Date.now()}`
    const assistantID = `assistant-tool-input-buffer-${Date.now()}`
    const recorded = createTurnRecorder(sessionID)
    const processor = Processor.create({
      Assistant: {
        id: assistantID,
        sessionID,
        role: "assistant",
        created: Date.now(),
        parentID: "user-tool-input-buffer",
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
      } as any,
      turn: recorded.turn,
    })

    expect(await processor.process(createStreamInput())).toBe("continue")

    const pendingEvents = recorded.events.filter((event) => event.type === "tool.call.pending")
    const deltaEvents = recorded.events.filter((event) => event.type === "tool.input.delta")
    const startedEvent = recorded.events.find((event) => event.type === "tool.call.started")
    const completedEvent = recorded.events.find((event) => event.type === "tool.call.completed")

    expect(pendingEvents).toHaveLength(2)
    expect(deltaEvents).toHaveLength(raw.length)
    expect(deltaEvents[0]?.payload).toMatchObject({
      messageID: assistantID,
      toolCallID: "call_1",
      toolName: "write",
      delta: "x",
      rawLength: 1,
    })
    expect(deltaEvents[raw.length - 1]?.payload.rawLength).toBe(raw.length)
    expect(deltaEvents.every((event) => !("part" in event.payload))).toBe(true)
    expect(pendingEvents[0]?.payload.part.state.raw).toBe("")
    expect(pendingEvents[1]?.payload.part.state.raw).toBe(raw)
    expect(startedEvent?.payload.part.state.raw).toBe(raw)
    expect(completedEvent?.payload.part.state.raw).toBe(raw)
  })

  it("stops consuming streamed tool input after abort", async () => {
    const controller = new AbortController()

    restoreLLM = LLM.setRuntimeDependenciesForTesting({
      getLanguage: async (model) => model as never,
      streamText: (() => ({
        fullStream: (async function* () {
          yield { type: "start" }
          yield { type: "tool-input-start", id: "call_1", toolName: "write" }
          yield { type: "tool-input-delta", id: "call_1", delta: "{" }
          controller.abort()
          yield { type: "tool-input-delta", id: "call_1", delta: "\"path\":\"README.md\"}" }
          yield {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "write",
            input: { path: "README.md" },
          }
        })(),
      })) as never,
    })

    const Processor = await import("#session/core/processor.ts")
    const sessionID = `session-tool-input-abort-${Date.now()}`
    const assistantID = `assistant-tool-input-abort-${Date.now()}`
    const recorded = createTurnRecorder(sessionID)
    const assistant = {
      id: assistantID,
      sessionID,
      role: "assistant",
      created: Date.now(),
      parentID: "user-tool-input-abort",
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
      abort: controller.signal,
      turn: recorded.turn,
    })

    await expect(processor.process({
      ...createStreamInput(),
      abort: controller.signal,
    })).rejects.toThrow("Prompt aborted")

    expect(recorded.events.some((event) => event.type === "tool.call.started")).toBe(false)
    expect(recorded.events.some((event) => event.type === "tool.call.failed")).toBe(false)
    expect(assistant.error).toMatchObject({
      name: "MessageAbortedError",
      data: {
        message: "Prompt cancellation requested.",
      },
    })
    const cancelled = recorded.events.find((event) => event.type === "tool.call.cancelled")
    expect(cancelled?.payload.part).toMatchObject({
      type: "tool",
      callID: "call_1",
      tool: "write",
      state: {
        status: "cancelled",
        raw: "{",
        reason: "Prompt cancellation requested.",
      },
    })
  })

  it("marks running tool calls as cancelled after abort", async () => {
    const controller = new AbortController()

    restoreLLM = LLM.setRuntimeDependenciesForTesting({
      getLanguage: async (model) => model as never,
      streamText: (() => ({
        fullStream: (async function* () {
          yield { type: "start" }
          yield { type: "tool-input-start", id: "call_1", toolName: "write" }
          yield { type: "tool-input-delta", id: "call_1", delta: "{\"path\":\"README.md\"}" }
          yield {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "write",
            input: { path: "README.md" },
            title: "Write README.md",
          }
          controller.abort()
          yield {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "write",
            input: { path: "README.md" },
            output: "ok",
          }
        })(),
      })) as never,
    })

    const Processor = await import("#session/core/processor.ts")
    const sessionID = `session-running-tool-abort-${Date.now()}`
    const assistantID = `assistant-running-tool-abort-${Date.now()}`
    const recorded = createTurnRecorder(sessionID)
    const processor = Processor.create({
      Assistant: {
        id: assistantID,
        sessionID,
        role: "assistant",
        created: Date.now(),
        parentID: "user-running-tool-abort",
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
      } as any,
      abort: controller.signal,
      turn: recorded.turn,
    })

    await expect(processor.process({
      ...createStreamInput(),
      abort: controller.signal,
    })).rejects.toThrow("Prompt aborted")

    expect(recorded.events.some((event) => event.type === "tool.call.started")).toBe(true)
    expect(recorded.events.some((event) => event.type === "tool.call.completed")).toBe(false)
    expect(recorded.events.some((event) => event.type === "tool.call.failed")).toBe(false)
    const cancelled = recorded.events.find((event) => event.type === "tool.call.cancelled")
    expect(cancelled?.payload.part).toMatchObject({
      type: "tool",
      callID: "call_1",
      tool: "write",
      state: {
        status: "cancelled",
        input: { path: "README.md" },
        raw: "{\"path\":\"README.md\"}",
        reason: "Prompt cancellation requested.",
      },
    })
  })
})
