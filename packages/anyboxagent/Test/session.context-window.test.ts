import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import "./sqlite.cleanup.ts"
import * as Sqlite from "#database/Sqlite.ts"
import { Instance } from "#project/instance.ts"
import * as Identifier from "#id/id.ts"
import * as Message from "#session/core/message.ts"
import * as Session from "#session/core/session.ts"
import * as ContextWindow from "#session/core/context-window.ts"

const baseModel = {
  id: "test-model",
  providerID: "test-provider",
  api: {
    id: "test-model",
    url: "",
    npm: "@ai-sdk/openai",
  },
  name: "Test Model",
  capabilities: {
    temperature: true,
    reasoning: false,
    replayAssistantReasoning: false,
    attachment: false,
    toolcall: true,
    input: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
    output: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
    interleaved: false,
  },
  cost: {
    input: 0,
    output: 0,
    cache: {
      read: 0,
      write: 0,
    },
  },
  limit: {
    context: 480,
    input: 360,
    output: 120,
  },
  status: "active" as const,
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

function compactedHistoryMessage(
  sessionID: string,
  input: {
    text?: string
    compactedFromMessageID: string
    compactedToMessageID: string
    created?: number
  },
): Message.WithParts {
  const created = input.created ?? Date.now()
  const message = Message.User.parse({
    id: Identifier.ascending("message"),
    sessionID,
    role: "user",
    created,
    agent: "compaction",
    internal: true,
    model: {
      providerID: baseModel.providerID,
      modelID: baseModel.id,
    },
  })
  const compactionID = Identifier.ascending("compaction")
  const text = Message.TextPart.parse({
    id: Identifier.ascending("part"),
    sessionID,
    messageID: message.id,
    type: "text",
    synthetic: true,
    metadata: {
      kind: "compacted-history",
      compactionID,
      compactedFromMessageID: input.compactedFromMessageID,
      compactedToMessageID: input.compactedToMessageID,
      summaryVersion: ContextWindow.CURRENT_SUMMARY_VERSION,
    },
    text: [
      "<compacted_history>",
      input.text ?? "Earlier turns were compacted.",
      "</compacted_history>",
    ].join("\n"),
  })
  const marker = Message.CompactionPart.parse({
    id: Identifier.ascending("part"),
    sessionID,
    messageID: message.id,
    type: "compaction",
    auto: true,
    compactionID,
    compactedFromMessageID: input.compactedFromMessageID,
    compactedToMessageID: input.compactedToMessageID,
    summaryVersion: ContextWindow.CURRENT_SUMMARY_VERSION,
    createdAt: created,
  })

  return {
    info: message,
    parts: [text, marker],
  }
}

test("preparePromptContext compacts early turns into an internal user message", async () => {
  const root = await mkdtemp(join(tmpdir(), "anybox-context-window-"))
  const databaseFile = join(root, "context-window.db")

  try {
    Sqlite.setDatabaseFile(databaseFile)

    await Instance.provide({
      directory: root,
      async fn() {
        const session = await Session.createSession({
          directory: Instance.directory,
          projectID: Instance.project.id,
        })

        const allMessages: Message.WithParts[] = []
        const compactedBoundaryIDs: string[] = []
        const baseTime = Date.now()

        for (let index = 0; index < 8; index += 1) {
          const user = Message.User.parse({
            id: Identifier.ascending("message"),
            sessionID: session.id,
            role: "user",
            created: baseTime + index * 2,
            agent: "default",
            model: {
              providerID: baseModel.providerID,
              modelID: baseModel.id,
            },
          })
          const userText = Message.TextPart.parse({
            id: Identifier.ascending("part"),
            sessionID: session.id,
            messageID: user.id,
            type: "text",
            text: `user-${index} ` + "context ".repeat(3),
          })

          const assistant = Message.Assistant.parse({
            id: Identifier.ascending("message"),
            sessionID: session.id,
            role: "assistant",
            created: baseTime + index * 2 + 1,
            parentID: user.id,
            modelID: baseModel.id,
            providerID: baseModel.providerID,
            agent: "default",
            finishReason: "stop",
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
          const assistantText = Message.TextPart.parse({
            id: Identifier.ascending("part"),
            sessionID: session.id,
            messageID: assistant.id,
            type: "text",
            text: `assistant-${index} ` + "result ".repeat(4),
          })

          Session.upsertMessage(user)
          Session.upsertPart(userText)
          Session.upsertMessage(assistant)
          Session.upsertPart(assistantText)

          allMessages.push(
            {
              info: user,
              parts: [userText],
            },
            {
              info: assistant,
              parts: [assistantText],
            },
          )

          if (index < 2) {
            compactedBoundaryIDs.push(assistant.id)
          }
        }

        const summaryInputs: Array<{
          system: string[]
          messages: Message.WithParts[]
          tools?: unknown
        }> = []
        const prepared = await ContextWindow.preparePromptContext({
          sessionID: session.id,
          model: baseModel,
          system: ["base-system"],
          messages: allMessages,
          generateSummary: async (summaryInput) => {
            summaryInputs.push(summaryInput)
            return "Earlier turns were compacted."
          },
        })

        expect(summaryInputs).toHaveLength(1)
        expect(summaryInputs[0]?.system).toEqual(["base-system"])
        expect(summaryInputs[0]?.messages.some((message) => message.info.id === allMessages[0]?.info.id)).toBe(true)
        expect(summaryInputs[0]?.messages.some((message) => message.info.id === allMessages[15]?.info.id)).toBe(false)

        const persistedMessages: Message.WithParts[] = []
        for await (const message of Message.stream(session.id)) {
          persistedMessages.push(message)
        }

        const compactedMessage = persistedMessages.find(
          (message) => message.info.role === "user" && message.info.internal === true,
        )
        expect(compactedMessage).toBeDefined()
        expect(compactedMessage?.info).toMatchObject({
          role: "user",
          agent: "compaction",
          internal: true,
        })

        const textPart = compactedMessage?.parts.find((part): part is Message.TextPart => part.type === "text")
        expect(textPart?.text).toContain("<compacted_history>")
        expect(textPart?.text).toContain("Earlier turns were compacted.")
        expect(textPart?.text).toContain("</compacted_history>")

        const compactionPart = compactedMessage?.parts.find(
          (part): part is Message.CompactionPart => part.type === "compaction",
        )
        expect(compactionPart).toMatchObject({
          compactedFromMessageID: allMessages[0]?.info.id,
          compactedToMessageID: compactedBoundaryIDs[1],
          summaryVersion: ContextWindow.CURRENT_SUMMARY_VERSION,
        })

        expect(prepared.compactedHistory?.info.id).toBe(compactedMessage?.info.id)
        expect(prepared.system.join("\n")).not.toContain("<compacted_history>")
        expect(prepared.messages[0]?.info.id).toBe(compactedMessage?.info.id)
        expect(prepared.messages.some((message) => message.info.id === allMessages[0]?.info.id)).toBe(false)
        expect(prepared.messages.some((message) => message.info.id === allMessages[2]?.info.id)).toBe(false)

        const preparedFromPersistedHistory = await ContextWindow.preparePromptContext({
          sessionID: session.id,
          model: {
            ...baseModel,
            limit: {
              context: 4_096,
              input: 3_000,
              output: 512,
            },
          },
          system: ["base-system"],
          messages: persistedMessages,
          disableCompaction: true,
        })
        expect(preparedFromPersistedHistory.messages[0]?.info.id).toBe(compactedMessage?.info.id)
        expect(
          preparedFromPersistedHistory.messages.some((message) => message.info.id === allMessages[0]?.info.id),
        ).toBe(false)
        expect(
          preparedFromPersistedHistory.messages.some((message) => message.info.id === allMessages[4]?.info.id),
        ).toBe(true)
      },
    })
  } finally {
    await Instance.disposeAll()
    Sqlite.setDatabaseFile()
    Sqlite.closeDatabase()
    await rm(databaseFile, { force: true }).catch(() => undefined)
    await rm(`${databaseFile}-wal`, { force: true }).catch(() => undefined)
    await rm(`${databaseFile}-shm`, { force: true }).catch(() => undefined)
    await rm(root, { recursive: true, force: true }).catch(() => undefined)
  }
})

test("compactPromptContext records manual compaction with auto false", async () => {
  const root = await mkdtemp(join(tmpdir(), "anybox-context-manual-"))
  const databaseFile = join(root, "context-manual.db")

  try {
    Sqlite.setDatabaseFile(databaseFile)

    await Instance.provide({
      directory: root,
      async fn() {
        const session = await Session.createSession({
          directory: Instance.directory,
          projectID: Instance.project.id,
        })

        const allMessages: Message.WithParts[] = []
        const baseTime = Date.now()
        for (let index = 0; index < 8; index += 1) {
          const user = Message.User.parse({
            id: Identifier.ascending("message"),
            sessionID: session.id,
            role: "user",
            created: baseTime + index * 2,
            agent: "default",
            model: {
              providerID: baseModel.providerID,
              modelID: baseModel.id,
            },
          })
          const userText = Message.TextPart.parse({
            id: Identifier.ascending("part"),
            sessionID: session.id,
            messageID: user.id,
            type: "text",
            text: `manual user-${index}`,
          })
          const assistant = Message.Assistant.parse({
            id: Identifier.ascending("message"),
            sessionID: session.id,
            role: "assistant",
            created: baseTime + index * 2 + 1,
            parentID: user.id,
            modelID: baseModel.id,
            providerID: baseModel.providerID,
            agent: "default",
            finishReason: "stop",
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
          const assistantText = Message.TextPart.parse({
            id: Identifier.ascending("part"),
            sessionID: session.id,
            messageID: assistant.id,
            type: "text",
            text: `manual assistant-${index}`,
          })

          Session.upsertMessage(user)
          Session.upsertPart(userText)
          Session.upsertMessage(assistant)
          Session.upsertPart(assistantText)
          allMessages.push(
            {
              info: user,
              parts: [userText],
            },
            {
              info: assistant,
              parts: [assistantText],
            },
          )
        }

        const result = await ContextWindow.compactPromptContext({
          sessionID: session.id,
          model: baseModel,
          system: ["base-system"],
          messages: allMessages,
          generateSummary: async () => "Manual history summary.",
          auto: false,
        })

        expect(result.status).toBe("compacted")
        expect(result.sourceMessageCount).toBe(4)

        const persistedMessages: Message.WithParts[] = []
        for await (const message of Message.stream(session.id)) {
          persistedMessages.push(message)
        }

        const compactedMessage = persistedMessages.find(
          (message) => message.info.role === "user" && message.info.internal === true,
        )
        const compactionPart = compactedMessage?.parts.find(
          (part): part is Message.CompactionPart => part.type === "compaction",
        )

        expect(compactionPart).toMatchObject({
          auto: false,
          compactedFromMessageID: allMessages[0]?.info.id,
          compactedToMessageID: allMessages[3]?.info.id,
          summaryVersion: ContextWindow.CURRENT_SUMMARY_VERSION,
        })
      },
    })
  } finally {
    await Instance.disposeAll()
    Sqlite.setDatabaseFile()
    Sqlite.closeDatabase()
    await rm(databaseFile, { force: true }).catch(() => undefined)
    await rm(`${databaseFile}-wal`, { force: true }).catch(() => undefined)
    await rm(`${databaseFile}-shm`, { force: true }).catch(() => undefined)
    await rm(root, { recursive: true, force: true }).catch(() => undefined)
  }
})

test("preparePromptContext prunes oversized tool outputs when compaction cannot help", async () => {
  const root = await mkdtemp(join(tmpdir(), "anybox-context-prune-"))
  const databaseFile = join(root, "context-prune.db")

  try {
    Sqlite.setDatabaseFile(databaseFile)

    await Instance.provide({
      directory: root,
      async fn() {
        const session = await Session.createSession({
          directory: Instance.directory,
          projectID: Instance.project.id,
        })

        const user = Message.User.parse({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          created: Date.now(),
          agent: "default",
          model: {
            providerID: baseModel.providerID,
            modelID: baseModel.id,
          },
        })
        const userText = Message.TextPart.parse({
          id: Identifier.ascending("part"),
          sessionID: session.id,
          messageID: user.id,
          type: "text",
          text: "Please inspect the previous command output.",
        })

        const assistant = Message.Assistant.parse({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "assistant",
          created: Date.now() + 1,
          parentID: user.id,
          modelID: baseModel.id,
          providerID: baseModel.providerID,
          agent: "default",
          finishReason: "tool-calls",
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
        const toolPart = Message.ToolPart.parse({
          id: Identifier.ascending("part"),
          sessionID: session.id,
          messageID: assistant.id,
          type: "tool",
          callID: "tool-1",
          tool: "read_file",
          schemaVersion: 3,
          turnID: "turn-test",
          input: { raw: JSON.stringify({
              path: "README.md",
            }), value: {
              path: "README.md",
            } },
          source: { kind: "model" },
          retry: { attempt: 1 },
          revision: 1,
          timestamps: { createdAt: Date.now(), settledAt: Date.now() + 1 },
          state: { phase: "settled", outcome: { kind: "returned", result: "success", completeness: "complete", output: "line ".repeat(1_600), title: "read_file", metadata: {}, execution: { sideEffect: "unknown", retry: "unknown" } }, control: { mode: "continue-model" } },
        })

        const prepared = await ContextWindow.preparePromptContext({
          sessionID: session.id,
          model: {
            ...baseModel,
            limit: {
              context: 260,
              input: 180,
              output: 80,
            },
          },
          system: ["base-system"],
          messages: [
            {
              info: user,
              parts: [userText],
            },
            {
              info: assistant,
              parts: [toolPart],
            },
          ],
        })

        const prunedTool = prepared.messages[1]?.parts.find(
          (part): part is Message.ToolPart => part.type === "tool",
        )

        expect(prunedTool).toBeDefined()
        if (
          !prunedTool ||
          prunedTool.state.phase !== "settled" ||
          prunedTool.state.outcome.kind !== "returned" ||
          toolPart.state.phase !== "settled" ||
          toolPart.state.outcome.kind !== "returned"
        ) throw new Error("Expected returned tool outputs before and after pruning.")
        expect(String(prunedTool.state.outcome.output).length)
          .toBeLessThan(String(toolPart.state.outcome.output).length)
      },
    })
  } finally {
    await Instance.disposeAll()
    Sqlite.setDatabaseFile()
    Sqlite.closeDatabase()
    await rm(databaseFile, { force: true }).catch(() => undefined)
    await rm(`${databaseFile}-wal`, { force: true }).catch(() => undefined)
    await rm(`${databaseFile}-shm`, { force: true }).catch(() => undefined)
    await rm(root, { recursive: true, force: true }).catch(() => undefined)
  }
})

test("fallback compaction preserves tool input when the result omits the shell command", async () => {
  const sessionID = "ses_compaction_tool_input"
  const command = "Get-Date -Format o"
  const messages: Message.WithParts[] = []

  for (let index = 0; index < 7; index += 1) {
    const userID = `msg-user-${index}`
    const assistantID = `msg-assistant-${index}`
    messages.push(
      {
        info: {
          id: userID,
          sessionID,
          role: "user",
          created: index * 2,
        } as Message.User,
        parts: [
          {
            id: `part-user-${index}`,
            sessionID,
            messageID: userID,
            type: "text",
            text: `user turn ${index}`,
          } as Message.TextPart,
        ],
      },
      {
        info: {
          id: assistantID,
          sessionID,
          role: "assistant",
          created: index * 2 + 1,
        } as Message.Assistant,
        parts: index === 0
          ? [
              {
                id: "part-shell-result",
                sessionID,
                messageID: assistantID,
                type: "tool",
                callID: "call-shell-result",
                tool: "powershell_command",
                schemaVersion: 3,
                turnID: "turn-test",
                input: { raw: JSON.stringify({
                    command,
                    tty: false,
                  }), value: {
                    command,
                    tty: false,
                  } },
                source: { kind: "model" },
                retry: { attempt: 1 },
                revision: 1,
                timestamps: { createdAt: 1, settledAt: 2 },
                state: { phase: "settled", outcome: { kind: "returned", result: "success", completeness: "complete", output: "Exit: 0\nSTDOUT:\n2026-08-07T12:00:00.0000000+08:00\nSTDERR:\n(no stderr)", title: "PowerShell command completed", metadata: {}, execution: { sideEffect: "unknown", retry: "unknown" } }, control: { mode: "continue-model" } },
              } as Message.ToolPart,
            ]
          : [
              {
                id: `part-assistant-${index}`,
                sessionID,
                messageID: assistantID,
                type: "text",
                text: `assistant turn ${index}`,
              } as Message.TextPart,
            ],
      },
    )
  }

  let recorded: Message.WithParts | undefined
  const result = await ContextWindow.compactPromptContext({
    sessionID,
    model: baseModel,
    system: ["base-system"],
    messages,
    generateSummary: async () => "",
    recordCompactionMessage: ({ message, parts }) => {
      recorded = { info: message, parts }
    },
    auto: false,
  })

  expect(result.status).toBe("compacted")
  if (!recorded) throw new Error("Expected fallback compaction to be recorded")
  const textPart = recorded.parts.find((part): part is Message.TextPart => part.type === "text")
  expect(textPart?.text).toContain(`tool powershell_command input: {"command":"${command}","tty":false}`)
  expect(textPart?.text).toContain("returned (success, complete): Exit: 0")
})

test("CompactionPart is internal and is not sent to the model", async () => {
  const compacted = compactedHistoryMessage("ses_compaction_part_internal", {
    compactedFromMessageID: "msg-start",
    compactedToMessageID: "msg-end",
    text: "Use the visible compacted history text only.",
  })

  const modelMessages = await Message.toModelMessages([compacted], baseModel)

  expect(modelMessages).toHaveLength(1)
  const content = modelMessages[0]?.content
  expect(Array.isArray(content)).toBe(true)
  if (Array.isArray(content)) {
    expect(content).toHaveLength(1)
    expect(content[0]).toMatchObject({
      type: "text",
      text: [
        "<compacted_history>",
        "Use the visible compacted history text only.",
        "</compacted_history>",
      ].join("\n"),
    })
  }
})

test("archived compacted history is preserved as an ordinary message", async () => {
  const root = await mkdtemp(join(tmpdir(), "anybox-context-archive-"))
  const databaseFile = join(root, "context-archive.db")

  try {
    Sqlite.setDatabaseFile(databaseFile)

    await Instance.provide({
      directory: root,
      async fn() {
        const session = await Session.createSession({
          directory: Instance.directory,
          projectID: Instance.project.id,
        })

        const compacted = compactedHistoryMessage(session.id, {
          compactedFromMessageID: "msg-start",
          compactedToMessageID: "msg-end",
          text: "Archived compacted history.",
        })
        Session.upsertMessage(compacted.info)
        for (const part of compacted.parts) {
          Session.upsertPart(part)
        }

        const archived = Session.archiveSession(session.id)
        expect(archived?.snapshot.messages.some((message) => message.id === compacted.info.id)).toBe(true)
        expect(archived?.snapshot.parts.some((part) => part.messageID === compacted.info.id)).toBe(true)

        Session.restoreArchivedSession(session.id)
        const restoredMessages: Message.WithParts[] = []
        for await (const message of Message.stream(session.id)) {
          restoredMessages.push(message)
        }
        expect(restoredMessages.some((message) => message.info.id === compacted.info.id)).toBe(true)
      },
    })
  } finally {
    await Instance.disposeAll()
    Sqlite.setDatabaseFile()
    Sqlite.closeDatabase()
    await rm(databaseFile, { force: true }).catch(() => undefined)
    await rm(`${databaseFile}-wal`, { force: true }).catch(() => undefined)
    await rm(`${databaseFile}-shm`, { force: true }).catch(() => undefined)
    await rm(root, { recursive: true, force: true }).catch(() => undefined)
  }
})
