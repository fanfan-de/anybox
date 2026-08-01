import { afterEach, describe, expect, it, mock } from "bun:test"
import { existsSync } from "node:fs"
import "./sqlite.cleanup.ts"
import * as db from "#database/Sqlite.ts"
import { Instance } from "#project/instance.ts"
import * as Message from "#session/core/message.ts"
import * as Session from "#session/core/session.ts"
import * as ToolResultPersistence from "#session/support/tool-result-persistence.ts"

function createTurnRecorder(sessionID: string) {
  const events: Array<{ type: string; payload: any }> = []

  return {
    events,
    turn: {
      sessionID,
      turnID: "trn_test",
      emit(type: string, payload: unknown) {
        events.push({
          type,
          payload: structuredClone(payload),
        })

        return {
          eventID: `${type}-${events.length}`,
          sessionID,
          turnID: "trn_test",
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
    tools: {},
    model: {
      providerID: "test-provider",
      id: "test-model",
    },
    agent: {
      name: "plan",
    },
  } as any
}

describe("processor tool persistence", () => {
  afterEach(() => {
    mock.restore()
  })

  it("persists assistant output only from streamText onFinish", async () => {
    let assistantID = ""
    let partsDuringDelta = -1

    mock.module("#session/core/llm.ts", () => ({
      stream: async (input: any) => ({
        fullStream: (async function* () {
          yield { type: "start" }
          yield { type: "text-start" }
          yield { type: "text-delta", text: "hel" }
          partsDuringDelta = db.findManyWithSchema("parts", Message.Part, {
            where: [{ column: "messageID", value: assistantID }],
          }).length
          yield { type: "text-delta", text: "lo!" }
          yield { type: "text-end" }
          yield {
            type: "finish",
            finishReason: "stop",
            totalUsage: {
              inputTokens: 1,
              outputTokens: 2,
            },
          }
          await input.onFinish?.({
            finishReason: "stop",
            text: "hello!",
            totalUsage: {
              inputTokens: 1,
              outputTokens: 2,
            },
          })
        })(),
      }),
    }))

    const Processor = await import("#session/core/processor.ts")

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const session = await Session.createSession({
          directory: Instance.directory,
          projectID: Instance.project.id,
        })
        const assistant = Message.Assistant.parse({
          id: `assistant-onfinish-${session.id}`,
          sessionID: session.id,
          role: "assistant",
          created: Date.now(),
          parentID: "user-onfinish",
          modelID: "test-model",
          providerID: "test-provider",
          agent: "plan",
          path: {
            cwd: Instance.directory,
            root: Instance.worktree,
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
        })
        assistantID = assistant.id

        const processor = Processor.create({
          Assistant: assistant,
        })

        expect(await processor.process(createStreamInput())).toBe("continue")
        expect(partsDuringDelta).toBe(0)

        const persistedParts = db.findManyWithSchema("parts", Message.Part, {
          where: [{ column: "messageID", value: assistant.id }],
        })
        expect(persistedParts).toHaveLength(1)
        expect(persistedParts[0]).toMatchObject({
          type: "text",
          text: "hello!",
        })
        expect(Session.DataBaseRead("messages", assistant.id)).toMatchObject({
          id: assistant.id,
          finishReason: "stop",
          tokens: {
            input: 1,
            output: 2,
          },
        })
      },
    })
  })

  it("emits structured tool results and tool errors as runtime events", async () => {
    const originalNow = Date.now
    Date.now = () => 1000

    try {
      mock.module("#session/core/llm.ts", () => ({
        stream: async () => ({
          fullStream: (async function* () {
            yield { type: "start" }
            yield {
              type: "text-start",
              providerMetadata: { phase: "text" },
            }
            yield {
              type: "text-delta",
              text: "hel",
            }
            yield {
              type: "text-delta",
              text: "lo",
            }
            yield {
              type: "text-delta",
              text: "!",
            }
            yield {
              type: "text-end",
            }
            yield {
              type: "tool-input-start",
              id: "tool-1",
              toolName: "custom",
              providerMetadata: { phase: "input" },
            }
            yield {
              type: "tool-call",
              toolCallId: "tool-1",
              toolName: "custom",
              input: { path: "a.txt" },
              providerMetadata: { phase: "call" },
              title: "Custom Tool",
            }
            yield {
              type: "tool-result",
              toolCallId: "tool-1",
              toolName: "custom",
              input: { path: "a.txt" },
              output: {
                text: "alpha",
                title: "Read a.txt",
                metadata: { source: "unit" },
                attachments: [
                  {
                    url: "https://example.com/a.txt",
                    mime: "text/plain",
                    filename: "a.txt",
                  },
                  {
                    url: "https://example.com/preview.png",
                    mime: "image/png",
                    filename: "preview.png",
                    metadata: {
                      width: 64,
                      height: 32,
                      prompt: "alpha image",
                    },
                  },
                ],
              },
            }
            yield {
              type: "tool-input-start",
              id: "tool-2",
              toolName: "custom",
            }
            yield {
              type: "tool-call",
              toolCallId: "tool-2",
              toolName: "custom",
              input: { path: "b.txt" },
            }
            yield {
              type: "tool-error",
              toolCallId: "tool-2",
              toolName: "custom",
              input: { path: "b.txt" },
              error: new Error("boom"),
              providerMetadata: { source: "unit" },
            }
            yield {
              type: "finish",
              finishReason: "stop",
            }
          })(),
        }),
      }))

      const Processor = await import("#session/core/processor.ts")
      const recorded = createTurnRecorder("session-1")

      const assistant = {
        id: "assistant-1",
        sessionID: "session-1",
        role: "assistant",
        created: Date.now(),
        parentID: "user-1",
        modelID: "test-model",
        providerID: "test-provider",
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
        toolSources: {
          custom: {
            kind: "native-module",
            id: "planner.core",
            name: "Planner",
            description: "Plan and delegate Todo work.",
          },
        },
      })

      expect(await processor.process(createStreamInput())).toBe("continue")

      const textUpdates = recorded.events.filter((event) => event.type === "text.part.delta")
      expect(textUpdates).toHaveLength(3)
      expect(textUpdates.map((event) => event.payload.delta)).toEqual(["hel", "lo", "!"])
      expect(textUpdates[0]?.payload.text).toBeUndefined()
      expect(textUpdates[2]?.payload.text).toBeUndefined()

      const completedText = recorded.events.find((event) => event.type === "text.part.completed")
      expect(completedText?.payload.part.text).toBe("hello!")

      const completed = recorded.events.find(
        (event) =>
          event.type === "tool.call.completed" &&
          event.payload.part.type === "tool" &&
          event.payload.part.callID === "tool-1" &&
          event.payload.part.state?.status === "completed",
      )
      expect(completed).toBeDefined()
      expect(completed?.payload.part.state.output).toBe("alpha")
      expect(completed?.payload.part.state.title).toBe("Read a.txt")
      expect(completed?.payload.part.state.metadata).toEqual({
        source: "unit",
        toolSource: {
          kind: "native-module",
          id: "planner.core",
          name: "Planner",
          description: "Plan and delegate Todo work.",
        },
      })
      const attachments = completed?.payload.part.state.attachments
      expect(attachments).toHaveLength(2)
      expect(attachments?.[0]).toMatchObject({
        type: "file",
        url: "https://example.com/a.txt",
        mime: "text/plain",
        filename: "a.txt",
      })
      expect(attachments?.[1]).toMatchObject({
        type: "image",
        url: "https://example.com/preview.png",
        mime: "image/png",
        filename: "preview.png",
        width: 64,
        height: 32,
        metadata: {
          width: 64,
          height: 32,
          prompt: "alpha image",
        },
      })

      const failed = recorded.events.find(
        (event) =>
          event.type === "tool.call.failed" &&
          event.payload.part.type === "tool" &&
          event.payload.part.callID === "tool-2" &&
          event.payload.part.state?.status === "error",
      )
      expect(failed).toBeDefined()
      expect(failed?.payload.part.state.error).toBe("boom")
      expect(failed?.payload.part.state.metadata).toEqual({
        source: "unit",
        toolSource: {
          kind: "native-module",
          id: "planner.core",
          name: "Planner",
          description: "Plan and delegate Todo work.",
        },
      })

      expect(processor.partFromToolCall("tool-1")?.state.status).toBe("completed")
      expect(processor.partFromToolCall("tool-2")?.state.status).toBe("error")
    } finally {
      Date.now = originalNow
    }
  })

  it("keeps AskUserQuestion UI metadata out of provider metadata", async () => {
    mock.module("#session/core/llm.ts", () => ({
      stream: async () => ({
        fullStream: (async function* () {
          yield { type: "start" }
          yield {
            type: "tool-call",
            toolCallId: "call-ask",
            toolName: "ask_user_question",
            input: {
              header: "Question",
              question: "What next?",
              options: [{ label: "Feature", value: "feature" }],
              allowFreeform: true,
            },
            providerMetadata: {
              openai: {
                itemId: "item-1",
              },
            },
          }
          yield {
            type: "tool-result",
            toolCallId: "call-ask",
            toolName: "ask_user_question",
            input: {
              header: "Question",
              question: "What next?",
              options: [{ label: "Feature", value: "feature" }],
              allowFreeform: true,
            },
            output: {
              text: "User answer received:\nfeature",
              title: "Question",
              metadata: {
                kind: "ask-user-question",
                version: 1,
                questionID: "que_call_ask",
                toolCallID: "call-ask",
                header: "Question",
                question: "What next?",
                options: [{ label: "Feature", value: "feature" }],
                allowFreeform: true,
                multiple: false,
                required: true,
                answered: true,
                answerText: "feature",
                selectedOptions: ["feature"],
              },
            },
          }
          yield {
            type: "finish",
            finishReason: "tool-calls",
          }
        })(),
      }),
    }))

    const Processor = await import("#session/core/processor.ts")
    const recorded = createTurnRecorder("session-question-metadata")

    const processor = Processor.create({
      Assistant: {
        id: "assistant-question-metadata",
        sessionID: "session-question-metadata",
        role: "assistant",
        created: Date.now(),
        parentID: "user-question-metadata",
        modelID: "test-model",
        providerID: "test-provider",
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

    const started = recorded.events.find((event) => event.type === "tool.call.started")
    expect(started?.payload.part.metadata).toEqual({
      openai: {
        itemId: "item-1",
      },
    })
    expect(started?.payload.part.state.metadata).toMatchObject({
      kind: "ask-user-question",
      questionID: "que_call_ask",
    })

    const completed = recorded.events.find((event) => event.type === "tool.call.completed")
    expect(completed?.payload.part.metadata).toEqual({
      openai: {
        itemId: "item-1",
      },
    })
    expect(completed?.payload.part.state.metadata).toMatchObject({
      kind: "ask-user-question",
      answered: true,
      answerText: "feature",
    })
  })

  it("persists raw oversized tool results that bypass the tool wrapper", async () => {
    const sessionID = "ses_processor_large"
    const largeOutput = `${"large-output ".repeat(5_000)}tail-marker`

    try {
      mock.module("#session/core/llm.ts", () => ({
        stream: async () => ({
          fullStream: (async function* () {
            yield { type: "start" }
            yield {
              type: "tool-input-start",
              id: "tool-large",
              toolName: "custom",
            }
            yield {
              type: "tool-call",
              toolCallId: "tool-large",
              toolName: "custom",
              input: { path: "large.txt" },
              title: "Custom Tool",
              providerMetadata: {
                stdout: largeOutput,
              },
            }
            yield {
              type: "tool-result",
              toolCallId: "tool-large",
              toolName: "custom",
              input: { path: "large.txt" },
              output: {
                text: largeOutput,
                title: "Large output",
                metadata: {
                  stdout: largeOutput,
                  keep: "small",
                },
              },
            }
            yield {
              type: "finish",
              finishReason: "stop",
            }
          })(),
        }),
      }))

      const Processor = await import("#session/core/processor.ts")
      const recorded = createTurnRecorder(sessionID)

      const assistant = {
        id: "assistant-large",
        sessionID,
        role: "assistant",
        created: Date.now(),
        parentID: "user-large",
        modelID: "test-model",
        providerID: "test-provider",
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

      const completed = recorded.events.find(
        (event) =>
          event.type === "tool.call.completed" &&
          event.payload.part.type === "tool" &&
          event.payload.part.callID === "tool-large" &&
          event.payload.part.state?.status === "completed",
      )

      expect(completed).toBeDefined()
      const state = completed?.payload.part.state
      expect(state.output).toContain("<persisted-output>")
      expect(state.output).toContain("large-output")
      expect(state.output).not.toContain("tail-marker")
      expect(state.modelOutput).toBeUndefined()
      expect(state.metadata.keep).toBe("small")
      expect(state.metadata.stdout).toContain("[omitted from context; full tool result is saved at")
      expect(state.metadata.persistedOutput).toMatchObject({
        kind: "persisted-tool-output",
        hasMore: true,
      })
      expect(existsSync(ToolResultPersistence.getSessionDirectory(sessionID))).toBe(true)

      const stored = processor.partFromToolCall("tool-large")
      expect(stored?.state.status).toBe("completed")
      expect((stored?.state as any).output).toContain("<persisted-output>")
    } finally {
      ToolResultPersistence.removeSessionOutputDirectory(sessionID)
    }
  })

  it("emits provider-executed tool calls without a prior input-start event", async () => {
    mock.module("#session/core/llm.ts", () => ({
      stream: async () => ({
        fullStream: (async function* () {
          yield { type: "start" }
          yield {
            type: "tool-call",
            toolCallId: "remote-tool-1",
            toolName: "mcp.remote-search",
            input: { query: "latest ai news" },
            title: "Remote Search",
            providerExecuted: true,
            providerMetadata: { call_id: "provider-call-1" },
          }
          yield {
            type: "tool-result",
            toolCallId: "remote-tool-1",
            toolName: "mcp.remote-search",
            input: { query: "latest ai news" },
            providerExecuted: true,
            providerMetadata: { approval: "none" },
            output: {
              type: "call",
              serverLabel: "remote-search",
              name: "search",
              arguments: "{\"query\":\"latest ai news\"}",
              output: "headline results",
            },
          }
          yield {
            type: "finish",
            finishReason: "stop",
          }
        })(),
      }),
    }))

    const Processor = await import("#session/core/processor.ts")
    const recorded = createTurnRecorder("session-remote")

    const assistant = {
      id: "assistant-remote",
      sessionID: "session-remote",
      role: "assistant",
      created: Date.now(),
      parentID: "user-remote",
      modelID: "test-model",
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

    const running = recorded.events.find(
      (event) =>
        event.type === "tool.call.started" &&
        event.payload.part.type === "tool" &&
        event.payload.part.callID === "remote-tool-1" &&
        event.payload.part.state?.status === "running",
    )
    expect(running).toBeDefined()
    expect(running?.payload.part.providerExecuted).toBe(true)

    const completed = recorded.events.find(
      (event) =>
        event.type === "tool.call.completed" &&
        event.payload.part.type === "tool" &&
        event.payload.part.callID === "remote-tool-1" &&
        event.payload.part.state?.status === "completed",
    )
    expect(completed).toBeDefined()
    expect(completed?.payload.part.providerExecuted).toBe(true)
    expect(completed?.payload.part.state.modelOutput).toEqual({
      type: "call",
      serverLabel: "remote-search",
      name: "search",
      arguments: "{\"query\":\"latest ai news\"}",
      output: "headline results",
    })

    const persisted = processor.partFromToolCall("remote-tool-1")
    expect(persisted?.providerExecuted).toBe(true)
    expect(persisted?.state.status).toBe("completed")
    expect((persisted?.state as any).modelOutput).toEqual({
      type: "call",
      serverLabel: "remote-search",
      name: "search",
      arguments: "{\"query\":\"latest ai news\"}",
      output: "headline results",
    })
  })

  it("stops the loop and emits waiting approval state when approval is requested", async () => {
    mock.module("#session/core/llm.ts", () => ({
      stream: async () => ({
        fullStream: (async function* () {
          yield { type: "start" }
          yield {
            type: "tool-input-start",
            id: "tool-approval",
            toolName: "replace_text",
          }
          yield {
            type: "tool-call",
            toolCallId: "tool-approval",
            toolName: "replace_text",
            input: { file_path: "a.txt", old_string: "", new_string: "alpha" },
            title: "Replace Text",
          }
          yield {
            type: "tool-approval-request",
            approvalId: "approval-1",
            toolCallId: "tool-approval",
          }
          yield {
            type: "finish",
            finishReason: "tool-calls",
          }
        })(),
      }),
    }))

    const Processor = await import("#session/core/processor.ts")
    const recorded = createTurnRecorder("session-approval")

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const assistant = {
          id: "msg-assistant-approval",
          sessionID: "session-approval",
          role: "assistant",
          created: Date.now(),
          parentID: "user-approval",
          modelID: "test-model",
          providerID: "test-provider",
          agent: "plan",
          path: {
            cwd: Instance.directory,
            root: Instance.worktree,
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
        expect(processor.partFromToolCall("tool-approval")?.state.status).toBe("waiting-approval")
      },
    })

    const waiting = recorded.events.find(
      (event) =>
        event.type === "tool.call.waiting_approval" &&
        event.payload.part.type === "tool" &&
        event.payload.part.callID === "tool-approval" &&
        event.payload.part.state?.status === "waiting-approval",
    )
    expect(waiting).toBeDefined()
    expect(waiting?.payload.part.state.approvalID).toBe("approval-1")
    expect(waiting?.payload.part.state.input).toEqual({ file_path: "a.txt", old_string: "", new_string: "alpha" })

    const request = recorded.events.find((event) => event.type === "permission.requested")
    expect(request).toBeDefined()
    expect(request?.payload.request.approvalID).toBe("approval-1")
  })

  it("stops and fails dangling tool calls when the stream ends without a result", async () => {
    mock.module("#session/core/llm.ts", () => ({
      stream: async () => ({
        fullStream: (async function* () {
          yield { type: "start" }
          yield {
            type: "tool-input-start",
            id: "tool-stuck",
            toolName: "git_bash_command",
          }
          yield {
            type: "tool-call",
            toolCallId: "tool-stuck",
            toolName: "git_bash_command",
            input: { command: "pwd" },
            title: "Git Bash",
          }
          yield {
            type: "finish",
            finishReason: "tool-calls",
          }
        })(),
      }),
    }))

    const Processor = await import("#session/core/processor.ts")
    const recorded = createTurnRecorder("session-stuck")

    const assistant = {
      id: "assistant-stuck",
      sessionID: "session-stuck",
      role: "assistant",
      created: Date.now(),
      parentID: "user-stuck",
      modelID: "test-model",
      providerID: "test-provider",
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

    const failed = recorded.events.find(
      (event) =>
        event.type === "tool.call.failed" &&
        event.payload.part.type === "tool" &&
        event.payload.part.callID === "tool-stuck" &&
        event.payload.part.state?.status === "error",
    )

    expect(failed).toBeDefined()
    expect(failed?.payload.part.state.error).toContain("did not complete")
    expect(processor.partFromToolCall("tool-stuck")?.state.status).toBe("error")
  })

  it("surfaces stream timeout aborts when tool input never becomes a tool call", async () => {
    mock.module("#session/core/llm.ts", () => ({
      stream: async () => ({
        fullStream: (async function* () {
          yield { type: "start" }
          yield {
            type: "tool-input-start",
            id: "tool-timeout",
            toolName: "replace_text",
          }
          yield {
            type: "tool-input-delta",
            id: "tool-timeout",
            delta: "{\"file_path\":\"big.txt\",\"old_string\":\"\",\"new_string\":\"AAAA",
          }
          yield {
            type: "abort",
            reason: "The operation timed out.",
          }
        })(),
        toolResults: Promise.reject(new Error("timed out")),
        steps: Promise.reject(new Error("timed out")),
        response: Promise.reject(new Error("timed out")),
      }),
    }))

    const Processor = await import("#session/core/processor.ts")
    const recorded = createTurnRecorder("session-timeout")

    const assistant = {
      id: "assistant-timeout",
      sessionID: "session-timeout",
      role: "assistant",
      created: Date.now(),
      parentID: "user-timeout",
      modelID: "test-model",
      providerID: "test-provider",
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

    const llmFailed = recorded.events.find(
      (event) => event.type === "llm.call.failed" && event.payload.error === "The operation timed out.",
    )
    expect(llmFailed).toBeDefined()

    const failed = recorded.events.find(
      (event) =>
        event.type === "tool.call.failed" &&
        event.payload.part.type === "tool" &&
        event.payload.part.callID === "tool-timeout" &&
        event.payload.part.state?.status === "error",
    )

    expect(failed).toBeDefined()
    expect(failed?.payload.part.state.error).toContain("The operation timed out.")
    expect(failed?.payload.part.state.error).toContain("ANYBOX_EXPERIMENTAL_LLM_TOTAL_TIMEOUT_MS")
    expect(processor.partFromToolCall("tool-timeout")?.state.status).toBe("error")
  })

  it("reconciles dangling tool calls from final stream metadata when fullStream misses tool-result", async () => {
    mock.module("#session/core/llm.ts", () => ({
      stream: async () => ({
        fullStream: (async function* () {
          yield { type: "start" }
          yield {
            type: "tool-input-start",
            id: "tool-reconciled",
            toolName: "replace_text",
          }
          yield {
            type: "tool-call",
            toolCallId: "tool-reconciled",
            toolName: "replace_text",
            input: { file_path: "a.txt", old_string: "", new_string: "alpha" },
            title: "Replace Text",
          }
          yield {
            type: "finish",
            finishReason: "tool-calls",
          }
        })(),
        toolResults: Promise.resolve([
          {
            type: "tool-result",
            toolCallId: "tool-reconciled",
            toolName: "replace_text",
            input: { file_path: "a.txt", old_string: "", new_string: "alpha" },
            output: {
              text: "created a.txt",
              title: "Created a.txt",
              metadata: { source: "toolResults" },
            },
          },
        ]),
        steps: Promise.resolve([]),
        response: Promise.resolve({
          messages: [],
        }),
      }),
    }))

    const Processor = await import("#session/core/processor.ts")
    const recorded = createTurnRecorder("session-reconciled")

    const assistant = {
      id: "assistant-reconciled",
      sessionID: "session-reconciled",
      role: "assistant",
      created: Date.now(),
      parentID: "user-reconciled",
      modelID: "test-model",
      providerID: "test-provider",
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

    const completed = recorded.events.find(
      (event) =>
        event.type === "tool.call.completed" &&
        event.payload.part.type === "tool" &&
        event.payload.part.callID === "tool-reconciled" &&
        event.payload.part.state?.status === "completed",
    )

    expect(completed).toBeDefined()
    expect(completed?.payload.part.state.output).toBe("created a.txt")
    expect(completed?.payload.part.state.title).toBe("Created a.txt")
    expect(completed?.payload.part.state.metadata).toEqual({ source: "toolResults" })
    expect(recorded.events.some((event) => event.type === "tool.call.failed")).toBe(false)
    expect(processor.partFromToolCall("tool-reconciled")?.state.status).toBe("completed")
  })
})
