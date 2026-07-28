import { describe, expect, it } from "vitest"
import type { ThreadDisplayRow } from "./thread-display-rows"
import {
  findThreadMessageNavigationRowIndex,
} from "./use-thread-turn-navigation"

function assistantResponseRow(
  ownerMessageID: string,
  ownerMessageIndex: number,
  rowID: string,
  kind: "assistant-response-row" | "assistant-question-row" = "assistant-response-row",
): ThreadDisplayRow {
  return {
    kind,
    ownerMessageID,
    ownerMessageIndex,
    rowID,
  } as unknown as ThreadDisplayRow
}

function assistantActionsRow(
  ownerMessageID: string,
  ownerMessageIndex: number,
  messageID: string,
): ThreadDisplayRow {
  return {
    kind: "assistant-actions",
    ownerMessageID,
    ownerMessageIndex,
    threadMessageID: messageID,
  } as unknown as ThreadDisplayRow
}

function userMessageRow(messageID: string, messageIndex: number): ThreadDisplayRow {
  return {
    kind: "user-message",
    messageID,
    messageIndex,
    rowID: `user:${messageID}`,
  } as unknown as ThreadDisplayRow
}

describe("findThreadMessageNavigationRowIndex", () => {
  it("targets the user row immediately preceding the matching response", () => {
    const rows = [
      userMessageRow("user-1", 0),
      assistantResponseRow("owner-1", 1, "owner-1-response"),
      assistantActionsRow("owner-1", 1, "assistant-1"),
      userMessageRow("user-2", 2),
      assistantResponseRow("owner-2", 3, "owner-2-response-1"),
      assistantResponseRow("owner-2", 3, "owner-2-response-2"),
      assistantActionsRow("owner-2", 3, "assistant-2"),
    ]

    expect(findThreadMessageNavigationRowIndex(rows, "assistant-1")).toBe(0)
    expect(findThreadMessageNavigationRowIndex(rows, "assistant-2")).toBe(3)
    expect(findThreadMessageNavigationRowIndex(rows, "missing")).toBe(-1)
  })

  it("supports question responses and falls back when no user row is available", () => {
    const rows = [
      assistantResponseRow("owner-1", 0, "owner-1-question", "assistant-question-row"),
      assistantActionsRow("owner-1", 0, "assistant-1"),
      assistantActionsRow("owner-2", 1, "assistant-2"),
    ]

    expect(findThreadMessageNavigationRowIndex(rows, "assistant-1")).toBe(0)
    expect(findThreadMessageNavigationRowIndex(rows, "assistant-2")).toBe(2)
  })
})
