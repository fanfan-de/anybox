import { describe, expect, it } from "vitest"
import {
  buildThreadDisplayContext,
  buildThreadDisplayRows,
  buildThreadDisplayRowsIncremental,
  decorateThreadDisplayRows,
  decorateThreadDisplayRowsIncremental,
  getAssistantTrailingUserDiffMessage,
  isAssistantFinalMessageInUserMessage,
  isAssistantLatestRenderableMessage,
  shouldFoldAssistantMessageIntoFinalRunTrace,
  type DecorateThreadDisplayRowsInput,
  type ThreadDisplayRowsCache,
  type ThreadDisplayRow,
} from "./thread-display-rows"
import { getAssistantStreamInsertionUserMessages } from "../stream-insertion"
import type {
  AssistantTraceItem,
  AssistantTraceVisibility,
  AssistantThreadMessage,
  SessionSummary,
  ThreadMessage,
  UserThreadMessage,
} from "../types"
import { DEFAULT_ASSISTANT_TRACE_VISIBILITY } from "../types"

const session = { id: "session-1" } as SessionSummary

function assistantMessage(
  id: string,
  items: AssistantTraceItem[],
  {
    backendTurnID = id,
    isStreaming = false,
    phase = isStreaming ? "responding" : "completed",
  }: {
    backendTurnID?: string
    isStreaming?: boolean
    phase?: AssistantThreadMessage["runtime"]["phase"]
  } = {},
): AssistantThreadMessage {
  return {
    id,
    backendTurnID,
    segmentID: `${id}:segment`,
    kind: "assistant",
    timestamp: 1,
    runtime: {
      phase,
      startedAt: 1,
      updatedAt: 2,
    },
    state: "",
    items,
    isStreaming,
  }
}

function userMessage(id: string, text: string, streamInsertion?: UserThreadMessage["streamInsertion"]): UserThreadMessage {
  return {
    id,
    kind: "user",
    text,
    timestamp: 1,
    ...(streamInsertion ? { submissionMode: "steer", streamInsertion } : {}),
  }
}

function textItem(id: string, text: string, extra: Partial<AssistantTraceItem> = {}): AssistantTraceItem {
  return {
    id,
    kind: "text",
    timestamp: 1,
    label: "Assistant",
    text,
    status: "completed",
    ...extra,
  }
}

function reasoningItem(id: string, text: string, extra: Partial<AssistantTraceItem> = {}): AssistantTraceItem {
  return {
    id,
    kind: "reasoning",
    timestamp: 1,
    label: "Reasoning",
    text,
    status: "completed",
    ...extra,
  }
}

function toolItem(id: string, title: string, extra: Partial<AssistantTraceItem> = {}): AssistantTraceItem {
  return {
    id,
    kind: "tool",
    timestamp: 1,
    label: "Tool",
    title,
    status: "completed",
    ...extra,
  }
}

function patchItem(id: string, file: string, extra: Partial<AssistantTraceItem> = {}): AssistantTraceItem {
  return {
    id,
    kind: "patch",
    timestamp: 1,
    label: "Patch",
    title: file,
    status: "completed",
    fileChanges: [{
      file,
      additions: 1,
      deletions: 0,
    }],
    ...extra,
  }
}

function debugItem(id: string, text: string, extra: Partial<AssistantTraceItem> = {}): AssistantTraceItem {
  return {
    id,
    kind: "system",
    timestamp: 1,
    label: "Debug",
    text,
    status: "completed",
    ...extra,
  }
}

function expectFileChangeRow(row: ThreadDisplayRow | undefined, itemID: string) {
  expect(row?.kind).toBe("assistant-file-change-row")
  if (row?.kind !== "assistant-file-change-row") return
  expect(row.itemID).toBe(itemID)
  expect(row.items.map((item) => item.itemID)).toEqual([itemID])
}

function buildRows(
  messages: ThreadMessage[],
  {
    traceVisibility = DEFAULT_ASSISTANT_TRACE_VISIBILITY,
  }: {
    traceVisibility?: AssistantTraceVisibility
  } = {},
) {
  const context = buildThreadDisplayContext(messages)
  return buildThreadDisplayRows({
    activeSession: session,
    activeMessages: messages,
    assistantTraceVisibility: traceVisibility,
    context,
    isResolvingPermissionRequest: false,
    pendingPermissionRequests: [],
  })
}

function buildRowsIncremental(
  messages: ThreadMessage[],
  previousCache?: ThreadDisplayRowsCache | null,
  {
    traceVisibility = DEFAULT_ASSISTANT_TRACE_VISIBILITY,
  }: {
    traceVisibility?: AssistantTraceVisibility
  } = {},
) {
  const context = buildThreadDisplayContext(messages)
  return buildThreadDisplayRowsIncremental({
    activeSession: session,
    activeMessages: messages,
    assistantTraceVisibility: traceVisibility,
    context,
    isResolvingPermissionRequest: false,
    pendingPermissionRequests: [],
  }, previousCache)
}

function decorateRowsIncremental(
  messages: ThreadMessage[],
  baseRows: ThreadDisplayRow[],
  previousCache?: ThreadDisplayRowsCache | null,
  overrides: Partial<DecorateThreadDisplayRowsInput> = {},
) {
  const context = overrides.context ?? buildThreadDisplayContext(messages)
  return decorateThreadDisplayRowsIncremental({
    assistantTraceVisibility: DEFAULT_ASSISTANT_TRACE_VISIBILITY,
    canForkFromMessage: true,
    isSessionRunning: false,
    messageTree: null,
    ...overrides,
    hasPendingPermissionRequests: overrides.hasPendingPermissionRequests ?? false,
    baseRows,
    context,
  }, previousCache)
}

function decorateRows(
  messages: ThreadMessage[],
  baseRows: ThreadDisplayRow[],
  overrides: Partial<DecorateThreadDisplayRowsInput> = {},
) {
  const context = overrides.context ?? buildThreadDisplayContext(messages)
  return decorateThreadDisplayRows({
    assistantTraceVisibility: DEFAULT_ASSISTANT_TRACE_VISIBILITY,
    canForkFromMessage: true,
    isSessionRunning: false,
    messageTree: null,
    ...overrides,
    hasPendingPermissionRequests: overrides.hasPendingPermissionRequests ?? false,
    baseRows,
    context,
  })
}

function rowByID(rows: ThreadDisplayRow[], rowID: string) {
  const row = rows.find((candidate) => candidate.rowID === rowID)
  expect(row).toBeDefined()
  return row!
}

describe("thread display rows", () => {
  it("creates a flat assistant response row for a single response", () => {
    const rows = buildRows([
      assistantMessage("assistant-1", [textItem("response-1", "Done.")]),
    ])

    expect(rows.map((row) => row.kind)).toEqual(["assistant-response-row"])
    expect(rows[0]?.rowID).toBe("assistant:assistant-1:response:assistant-1:response-1")
  })

  it("keeps response row IDs stable while streaming text changes", () => {
    const firstRows = buildRows([
      assistantMessage("assistant-1", [textItem("response-1", "Hel", { isStreaming: true, status: "running" })], {
        isStreaming: true,
      }),
    ])
    const nextRows = buildRows([
      assistantMessage("assistant-1", [textItem("response-1", "Hello world", { isStreaming: true, status: "running" })], {
        isStreaming: true,
      }),
    ])

    expect(firstRows[0]?.rowID).toBe(nextRows[0]?.rowID)
  })

  it("creates semantic rows for reasoning, tool, and response items", () => {
    const rows = buildRows([
      assistantMessage("assistant-1", [
        reasoningItem("reasoning-1", "I will inspect."),
        toolItem("tool-1", "read-file"),
        textItem("response-1", "Done."),
      ]),
    ])

    expect(rows.map((row) => row.kind)).toEqual([
      "assistant-reasoning-row",
      "assistant-tool-row",
      "assistant-response-row",
    ])
  })

  it("preserves trace item order around a file change", () => {
    const rows = buildRows([
      assistantMessage("assistant-1", [
        reasoningItem("reasoning-1", "Checking."),
        patchItem("patch-1", "src/app.ts"),
        textItem("response-1", "Done."),
      ]),
    ])

    expect(rows.map((row) => row.kind)).toEqual([
      "assistant-reasoning-row",
      "assistant-file-change-row",
      "assistant-response-row",
    ])
    expect(rows.map((row) => "itemID" in row ? row.itemID : undefined)).toEqual([
      "reasoning-1",
      "patch-1",
      "response-1",
    ])
    expectFileChangeRow(rows[1], "patch-1")
  })

  it("does not merge adjacent file-change items", () => {
    const rows = buildRows([
      assistantMessage("assistant-1", [
        patchItem("patch-1", "src/first.ts"),
        patchItem("patch-2", "src/second.ts"),
      ]),
    ])

    expect(rows.map((row) => row.kind)).toEqual([
      "assistant-file-change-row",
      "assistant-file-change-row",
    ])
    expectFileChangeRow(rows[0], "patch-1")
    expectFileChangeRow(rows[1], "patch-2")
  })

  it("does not merge file-change items across a response", () => {
    const rows = buildRows([
      assistantMessage("assistant-1", [
        patchItem("patch-1", "src/first.ts"),
        textItem("response-1", "Checkpoint."),
        patchItem("patch-2", "src/second.ts"),
      ]),
    ])

    expect(rows.map((row) => row.kind)).toEqual([
      "assistant-file-change-row",
      "assistant-response-row",
      "assistant-file-change-row",
    ])
    expect(rows.map((row) => "itemID" in row ? row.itemID : undefined)).toEqual([
      "patch-1",
      "response-1",
      "patch-2",
    ])
  })

  it("does not merge reasoning items across a file change", () => {
    const rows = buildRows([
      assistantMessage("assistant-1", [
        reasoningItem("reasoning-1", "First thought."),
        patchItem("patch-1", "src/app.ts"),
        reasoningItem("reasoning-2", "Second thought."),
      ]),
    ])

    expect(rows.map((row) => row.kind)).toEqual([
      "assistant-reasoning-row",
      "assistant-file-change-row",
      "assistant-reasoning-row",
    ])
    expect(rows.map((row) => "itemID" in row ? row.itemID : undefined)).toEqual([
      "reasoning-1",
      "patch-1",
      "reasoning-2",
    ])
  })

  it("does not let hidden debug items create file-change aggregation", () => {
    const rows = buildRows([
      assistantMessage("assistant-1", [
        patchItem("patch-1", "src/first.ts"),
        debugItem("debug-1", "hidden debug metadata"),
        patchItem("patch-2", "src/second.ts"),
      ]),
    ], {
      traceVisibility: {
        ...DEFAULT_ASSISTANT_TRACE_VISIBILITY,
        debugMetadata: false,
      },
    })

    expect(rows.map((row) => row.kind)).toEqual([
      "assistant-file-change-row",
      "assistant-file-change-row",
    ])
    expectFileChangeRow(rows[0], "patch-1")
    expectFileChangeRow(rows[1], "patch-2")
  })

  it("keeps a single short reasoning item as a reasoning row before the response", () => {
    const rows = buildRows([
      assistantMessage("assistant-1", [
        reasoningItem("reasoning-1", "Checking."),
        textItem("response-1", "Done."),
      ]),
    ])

    expect(rows.map((row) => row.kind)).toEqual([
      "assistant-reasoning-row",
      "assistant-response-row",
    ])
    expect(rows[0]).toMatchObject({
      kind: "assistant-reasoning-row",
      itemID: "reasoning-1",
      section: "reasoning",
    })
  })

  it("places stream-inserted user messages by raw assistant item index", () => {
    const rows = buildRows([
      assistantMessage("assistant-1", [
        textItem("response-1", "Before"),
        textItem("response-2", "After", { isStreaming: true, status: "running" }),
      ], { isStreaming: true }),
      userMessage("user-steer", "Steer", {
        assistantThreadMessageID: "assistant-1",
        afterItemCount: 1,
        status: "consumed",
      }),
    ])

    expect(rows.map((row) => row.kind)).toEqual([
      "assistant-response-row",
      "assistant-inserted-user-message",
      "assistant-response-row",
    ])
  })

  it("moves stream-inserted user messages after the following completed tool boundary", () => {
    const rows = buildRows([
      assistantMessage("assistant-1", [
        textItem("response-1", "Before"),
        toolItem("tool-1", "load-skill"),
        textItem("response-2", "After", { isStreaming: true, status: "running" }),
      ], { isStreaming: true }),
      userMessage("user-steer", "Steer", {
        assistantThreadMessageID: "assistant-1",
        afterItemCount: 1,
        status: "consumed",
      }),
    ])

    expect(rows.map((row) => row.kind)).toEqual([
      "assistant-response-row",
      "assistant-tool-row",
      "assistant-inserted-user-message",
      "assistant-response-row",
    ])
    expect(rows[1]).toMatchObject({ kind: "assistant-tool-row", itemID: "tool-1" })
  })

  it("places stream-inserted user messages between single-item file-change rows", () => {
    const rows = buildRows([
      assistantMessage("assistant-1", [
        patchItem("patch-1", "src/first.ts"),
        patchItem("patch-2", "src/second.ts"),
        textItem("response-1", "Done."),
      ]),
      userMessage("user-steer", "Steer", {
        assistantThreadMessageID: "assistant-1",
        afterItemCount: 1,
        status: "consumed",
      }),
    ])

    expect(rows.map((row) => row.kind)).toEqual([
      "assistant-file-change-row",
      "assistant-inserted-user-message",
      "assistant-file-change-row",
      "assistant-response-row",
    ])
    expectFileChangeRow(rows[0], "patch-1")
    expectFileChangeRow(rows[2], "patch-2")
  })

  it("attaches folded assistant items to the final owner while preserving source metadata", () => {
    const rows = buildRows([
      userMessage("user-1", "Go"),
      assistantMessage("assistant-intermediate", [textItem("intermediate-response", "Working.")], { backendTurnID: "turn-folded" }),
      assistantMessage("assistant-final", [textItem("final-response", "Done.")], { backendTurnID: "turn-folded" }),
    ])

    const foldedItemRow = rows.find((row) => "sourceMessageID" in row && row.sourceMessageID === "assistant-intermediate")
    expect(foldedItemRow).toMatchObject({
      kind: "assistant-response-row",
      ownerMessageID: "assistant-final",
      sourceMessageID: "assistant-intermediate",
      itemID: "intermediate-response",
      rawItemIndex: 0,
    })
  })

  it("orders folded assistant items by source message before raw item index", () => {
    const rows = buildRows([
      userMessage("user-1", "Go"),
      assistantMessage("assistant-intermediate-1", [patchItem("patch-1", "src/first.ts")], { backendTurnID: "turn-folded" }),
      assistantMessage("assistant-intermediate-2", [reasoningItem("reasoning-1", "Still working.")], { backendTurnID: "turn-folded" }),
      assistantMessage("assistant-final", [textItem("final-response", "Done.")], { backendTurnID: "turn-folded" }),
    ])

    const finalOwnerRows = rows.filter((row) => "ownerMessageID" in row && row.ownerMessageID === "assistant-final")
    expect(finalOwnerRows.map((row) => "itemID" in row ? row.itemID : undefined)).toEqual([
      "patch-1",
      "reasoning-1",
      "final-response",
    ])
    expect(finalOwnerRows.map((row) => "sourceMessageID" in row ? row.sourceMessageID : undefined)).toEqual([
      "assistant-intermediate-1",
      "assistant-intermediate-2",
      "assistant-final",
    ])
  })

  it("keeps adjacent backend turns separate when no user row exists between them", () => {
    const firstAssistant = assistantMessage(
      "assistant-turn-one",
      [textItem("response-turn-one", "First turn result.")],
      { backendTurnID: "turn-one" },
    )
    const secondAssistant = assistantMessage(
      "assistant-turn-two",
      [textItem("response-turn-two", "Second turn result.")],
      { backendTurnID: "turn-two" },
    )
    const messages = [userMessage("user-1", "Go"), firstAssistant, secondAssistant]
    const baseRows = buildRows(messages)
    const decoratedRows = decorateRows(messages, baseRows)

    expect(baseRows.find((row) => row.rowID.includes("response-turn-one"))).toMatchObject({
      ownerMessageID: "assistant-turn-one",
      sourceTurnID: "turn-one",
    })
    expect(baseRows.find((row) => row.rowID.includes("response-turn-two"))).toMatchObject({
      ownerMessageID: "assistant-turn-two",
      sourceTurnID: "turn-two",
    })
    expect(decoratedRows.filter((row) => row.kind === "assistant-actions").map((row) => row.ownerMessageID)).toEqual([
      "assistant-turn-one",
      "assistant-turn-two",
    ])
  })

  it("keeps the linear display context equivalent to the legacy per-message facts", () => {
    const duplicateOne: AssistantThreadMessage = {
      ...assistantMessage("assistant-duplicate-1", [textItem("duplicate-response-1", "First segment.")]),
      backendTurnID: "turn-duplicate",
      messageID: "backend-message",
      segmentID: "segment-1",
    }
    const duplicateTwo: AssistantThreadMessage = {
      ...assistantMessage("assistant-duplicate-2", [textItem("duplicate-response-2", "Second segment.")]),
      backendTurnID: "turn-duplicate",
      messageID: "backend-message",
      segmentID: "segment-2",
    }
    const diffUser: UserThreadMessage = {
      ...userMessage("user-diff", "Continue"),
      diffSummary: {
        diffs: [{ file: "src/app.ts", additions: 1, deletions: 0 }],
      },
    }
    const messages: ThreadMessage[] = [
      userMessage("user-1", "Go"),
      assistantMessage("assistant-intermediate", [reasoningItem("reasoning-1", "Working.")]),
      duplicateOne,
      userMessage("user-inserted", "Steer", {
        assistantThreadMessageID: duplicateOne.id,
        afterItemCount: 0,
        status: "consumed",
      }),
      diffUser,
      duplicateTwo,
    ]
    const context = buildThreadDisplayContext(messages)

    messages.forEach((message, messageIndex) => {
      if (message.kind !== "assistant") return

      expect(context.foldedAssistantMessageIDs.has(message.id)).toBe(
        shouldFoldAssistantMessageIntoFinalRunTrace(messages, messageIndex, message),
      )
      expect(context.finalOperableAssistantMessageIDs.has(message.id)).toBe(
        isAssistantFinalMessageInUserMessage(messages, messageIndex, message),
      )
      expect(context.latestRenderableAssistantMessageID === message.id).toBe(
        isAssistantLatestRenderableMessage(messages, messageIndex, message),
      )
      expect(context.streamInsertedUserMessagesByAssistantID.get(message.id) ?? []).toEqual(
        getAssistantStreamInsertionUserMessages(messages, message),
      )
      expect(context.trailingUserDiffMessageByAssistantID.get(message.id) ?? null).toBe(
        getAssistantTrailingUserDiffMessage(messages, messageIndex, message),
      )
    })
  })

  it("does not serialize nested trace payloads while building incremental rows", () => {
    let serializationCount = 0
    const debugEntries = [] as unknown as NonNullable<AssistantTraceItem["debugEntries"]> & { toJSON: () => unknown[] }
    debugEntries.toJSON = () => {
      serializationCount += 1
      return []
    }
    const assistant = assistantMessage("assistant-large-payload", [
      textItem("response-large-payload", "Done.", { debugEntries }),
    ])

    const first = buildRowsIncremental([assistant])
    const second = buildRowsIncremental([assistant], first.cache)

    expect(serializationCount).toBe(0)
    expect(second.rows[0]).toBe(first.rows[0])
  })

  it("matches legacy context helpers across varied message sequences", () => {
    for (let seed = 1; seed <= 64; seed += 1) {
      let state = seed
      const messages: ThreadMessage[] = []
      const assistants: AssistantThreadMessage[] = []

      for (let position = 0; position < 8; position += 1) {
        state = (state * 1_664_525 + 1_013_904_223) >>> 0
        const choice = state % 5

        if (choice === 0 || assistants.length === 0) {
          const isStreaming = (state & 8) !== 0
          const assistant = assistantMessage(
            `assistant-${seed}-${position}`,
            [textItem(`response-${seed}-${position}`, `Response ${position}.`)],
            { isStreaming },
          )
          assistants.push(assistant)
          messages.push(assistant)
          continue
        }

        if (choice === 1) {
          const user = userMessage(`user-${seed}-${position}`, `User ${position}`)
          if ((state & 16) !== 0) {
            user.diffSummary = {
              diffs: [{ file: `src/${seed}-${position}.ts`, additions: 1, deletions: 0 }],
            }
          }
          messages.push(user)
          continue
        }

        if (choice === 2) {
          messages.push({
            ...userMessage(`user-${seed}-${position}`, `Pending ${position}`),
            submissionMode: "steer",
          })
          continue
        }

        const target = assistants[state % assistants.length]!
        messages.push(userMessage(
          `user-${seed}-${position}`,
          `Inserted ${position}`,
          {
            assistantThreadMessageID: target.id,
            afterItemCount: 0,
            status: choice === 3 ? "consumed" : "pending",
          },
        ))
      }

      const context = buildThreadDisplayContext(messages)
      messages.forEach((message, messageIndex) => {
        if (message.kind !== "assistant") return

        expect(context.foldedAssistantMessageIDs.has(message.id)).toBe(
          shouldFoldAssistantMessageIntoFinalRunTrace(messages, messageIndex, message),
        )
        expect(context.finalOperableAssistantMessageIDs.has(message.id)).toBe(
          isAssistantFinalMessageInUserMessage(messages, messageIndex, message),
        )
        expect(context.latestRenderableAssistantMessageID === message.id).toBe(
          isAssistantLatestRenderableMessage(messages, messageIndex, message),
        )
        expect(context.streamInsertedUserMessagesByAssistantID.get(message.id) ?? []).toEqual(
          getAssistantStreamInsertionUserMessages(messages, message),
        )
        expect(context.trailingUserDiffMessageByAssistantID.get(message.id) ?? null).toBe(
          getAssistantTrailingUserDiffMessage(messages, messageIndex, message),
        )
      })
    }
  })

  it("reuses unchanged base rows while a streaming assistant row changes", () => {
    const userOne = userMessage("user-1", "Start")
    const stableAssistant = assistantMessage("assistant-stable", [textItem("stable-response", "Done.")])
    const userTwo = userMessage("user-2", "Continue")
    const streamingAssistant = assistantMessage(
      "assistant-streaming",
      [textItem("stream-response", "Hel", { isStreaming: true, status: "running" })],
      { isStreaming: true },
    )
    const first = buildRowsIncremental([userOne, stableAssistant, userTwo, streamingAssistant])
    const nextStreamingAssistant = assistantMessage(
      "assistant-streaming",
      [textItem("stream-response", "Hello world", { isStreaming: true, status: "running" })],
      { isStreaming: true },
    )
    const next = buildRowsIncremental(
      [userOne, stableAssistant, userTwo, nextStreamingAssistant],
      first.cache,
    )

    expect(rowByID(next.rows, "user:user-1")).toBe(rowByID(first.rows, "user:user-1"))
    expect(rowByID(next.rows, "assistant:assistant-stable:response:assistant-stable:stable-response")).toBe(
      rowByID(first.rows, "assistant:assistant-stable:response:assistant-stable:stable-response"),
    )
    expect(rowByID(next.rows, "user:user-2")).toBe(rowByID(first.rows, "user:user-2"))
    expect(rowByID(next.rows, "assistant:assistant-streaming:response:assistant-streaming:stream-response")).not.toBe(
      rowByID(first.rows, "assistant:assistant-streaming:response:assistant-streaming:stream-response"),
    )
    expect(next.stats).toMatchObject({
      cacheHitCount: 3,
      cacheMissCount: 1,
      invalidatedMessageCount: 1,
    })
  })

  it("reuses assistant base rows when only the activeMessages array is new", () => {
    const assistant = assistantMessage("assistant-1", [textItem("response-1", "Done.")])
    const first = buildRowsIncremental([assistant])
    const next = buildRowsIncremental([assistant], first.cache)

    expect(next.rows[0]).toBe(first.rows[0])
    expect(next.stats).toMatchObject({
      cacheHitCount: 1,
      cacheMissCount: 0,
      invalidatedMessageCount: 0,
    })
  })

  it("rebuilds final owner rows when a folded intermediate assistant changes without touching unrelated rows", () => {
    const userOne = userMessage("user-1", "Go")
    const intermediateAssistant = assistantMessage("assistant-intermediate", [
      textItem("intermediate-response", "Working."),
    ], { backendTurnID: "turn-folded" })
    const finalAssistant = assistantMessage("assistant-final", [textItem("final-response", "Done.")], { backendTurnID: "turn-folded" })
    const userTwo = userMessage("user-2", "Next")
    const unrelatedAssistant = assistantMessage("assistant-unrelated", [textItem("unrelated-response", "Ready.")])
    const first = buildRowsIncremental([
      userOne,
      intermediateAssistant,
      finalAssistant,
      userTwo,
      unrelatedAssistant,
    ])
    const nextIntermediateAssistant = assistantMessage("assistant-intermediate", [
      textItem("intermediate-response", "Still working."),
    ], { backendTurnID: "turn-folded" })
    const next = buildRowsIncremental([
      userOne,
      nextIntermediateAssistant,
      finalAssistant,
      userTwo,
      unrelatedAssistant,
    ], first.cache)

    const firstFinalRows = first.rows.filter((row) => "ownerMessageID" in row && row.ownerMessageID === "assistant-final")
    const nextFinalRows = next.rows.filter((row) => "ownerMessageID" in row && row.ownerMessageID === "assistant-final")
    expect(nextFinalRows).toHaveLength(firstFinalRows.length)
    nextFinalRows.forEach((row, index) => {
      expect(row).not.toBe(firstFinalRows[index])
    })
    expect(rowByID(next.rows, "assistant:assistant-unrelated:response:assistant-unrelated:unrelated-response")).toBe(
      rowByID(first.rows, "assistant:assistant-unrelated:response:assistant-unrelated:unrelated-response"),
    )
    expect(rowByID(next.rows, "user:user-1")).toBe(rowByID(first.rows, "user:user-1"))
    expect(rowByID(next.rows, "user:user-2")).toBe(rowByID(first.rows, "user:user-2"))
  })

  it("keeps unrelated decoration rows stable when the final operable assistant changes", () => {
    const userOne = userMessage("user-1", "Start")
    const stableAssistant = assistantMessage("assistant-stable", [textItem("stable-response", "Done.")])
    const userTwo = userMessage("user-2", "Continue")
    const oldFinalAssistant = assistantMessage("assistant-old-final", [textItem("old-response", "First.")], { backendTurnID: "turn-changing-final" })
    const firstMessages = [userOne, stableAssistant, userTwo, oldFinalAssistant]
    const firstBase = buildRowsIncremental(firstMessages)
    const firstDecorated = decorateRowsIncremental(firstMessages, firstBase.rows, firstBase.cache)
    const newFinalAssistant = assistantMessage(
      "assistant-new-final",
      [textItem("new-response", "Second.", { isStreaming: true, status: "running" })],
      { backendTurnID: "turn-changing-final", isStreaming: true },
    )
    const nextMessages = [userOne, stableAssistant, userTwo, oldFinalAssistant, newFinalAssistant]
    const nextBase = buildRowsIncremental(nextMessages, firstDecorated.cache)
    const nextDecorated = decorateRowsIncremental(nextMessages, nextBase.rows, nextBase.cache)

    expect(rowByID(nextDecorated.rows, "assistant:assistant-stable:actions")).toBe(
      rowByID(firstDecorated.rows, "assistant:assistant-stable:actions"),
    )
    expect(firstDecorated.rows.some((row) => row.rowID === "assistant:assistant-old-final:actions")).toBe(true)
    expect(nextDecorated.rows.some((row) => row.rowID === "assistant:assistant-old-final:actions")).toBe(false)
    expect(rowByID(nextDecorated.rows, "assistant:assistant-new-final:actions")).toBeDefined()
  })

  it("builds response actions from the last visible response segment", () => {
    const messages = [
      assistantMessage("assistant-1", [
        textItem("response-1", "First response."),
        patchItem("patch-1", "src/app.ts"),
        textItem("response-2", "Second response."),
      ]),
    ]
    const baseRows = buildRows(messages)
    const decoratedRows = decorateRows(messages, baseRows)
    const actionsRow = rowByID(decoratedRows, "assistant:assistant-1:actions")

    expect(actionsRow?.kind).toBe("assistant-actions")
    if (actionsRow?.kind !== "assistant-actions") return
    expect(actionsRow.responseItems.map((item) => item.id)).toEqual(["response-2"])
    expect(actionsRow.responseCopyText).toBe("Second response.")
  })

  it("does not merge a progress response into the final response when their workflow separator is hidden", () => {
    const messages = [
      assistantMessage("assistant-1", [
        textItem("progress-response", "Still working."),
        {
          id: "workflow-separator",
          kind: "step" as const,
          timestamp: 1,
          label: "Workflow",
          detail: "Verification started",
          status: "completed" as const,
        },
        textItem("final-response", "Finished."),
      ]),
    ]
    const baseRows = buildRows(messages, {
      traceVisibility: {
        ...DEFAULT_ASSISTANT_TRACE_VISIBILITY,
        workflow: false,
      },
    })
    const decoratedRows = decorateRows(messages, baseRows, {
      assistantTraceVisibility: {
        ...DEFAULT_ASSISTANT_TRACE_VISIBILITY,
        workflow: false,
      },
    })
    const actionsRow = rowByID(decoratedRows, "assistant:assistant-1:actions")

    expect(actionsRow.kind).toBe("assistant-actions")
    if (actionsRow.kind !== "assistant-actions") return
    expect(actionsRow.responseItems.map((item) => item.id)).toEqual(["final-response"])
    expect(actionsRow.responseCopyText).toBe("Finished.")
  })

  it("suppresses assistant response actions while a permission request is pending", () => {
    const messages = [
      assistantMessage("assistant-1", [
        textItem("response-1", "Waiting on approval."),
      ]),
    ]
    const baseRows = buildRows(messages)
    const decoratedRows = decorateRows(messages, baseRows)
    const pendingDecoratedRows = decorateRows(messages, baseRows, {
      hasPendingPermissionRequests: true,
    })

    expect(decoratedRows.some((row) => row.rowID === "assistant:assistant-1:actions")).toBe(true)
    expect(pendingDecoratedRows.some((row) => row.rowID === "assistant:assistant-1:actions")).toBe(false)
  })

  it("matches the non-cached build and decorate output", () => {
    const messages = [
      userMessage("user-1", "Go"),
      assistantMessage("assistant-1", [
        reasoningItem("reasoning-1", "Checking."),
        toolItem("tool-1", "read-file"),
        textItem("response-1", "Done."),
      ]),
      userMessage("user-2", "Next"),
      assistantMessage("assistant-2", [
        textItem("response-2", "Ready."),
      ]),
    ]
    const baselineBaseRows = buildRows(messages)
    const incrementalBaseRows = buildRowsIncremental(messages)
    expect(incrementalBaseRows.rows).toEqual(baselineBaseRows)

    const baselineDecoratedRows = decorateRows(messages, baselineBaseRows)
    const incrementalDecoratedRows = decorateRowsIncremental(
      messages,
      incrementalBaseRows.rows,
      incrementalBaseRows.cache,
    )
    expect(incrementalDecoratedRows.rows).toEqual(baselineDecoratedRows)
  })
})
