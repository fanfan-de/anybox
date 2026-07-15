import { describe, expect, it } from "vitest"
import {
  buildThreadDisplayContext,
  buildThreadDisplayRows,
  type ThreadDisplayRow,
} from "./thread-display-rows"
import {
  deriveThreadExecutionGroups,
  projectThreadDisplayRowsWithExecutionGroups,
  resolveExecutionGroupExpanded,
} from "./thread-execution-groups"
import type {
  AssistantTraceItem,
  AssistantTraceVisibility,
  AssistantThreadMessage,
  SessionSummary,
  ThreadMessage,
  ThreadTurn,
  ThreadTurnStatus,
  UserThreadMessage,
} from "../types"
import { DEFAULT_ASSISTANT_TRACE_VISIBILITY } from "../types"

const session = { id: "session-1" } as SessionSummary

type TestThreadTurn = ThreadTurn & {
  finalSegmentID?: string
  lastMessageID?: string
}

function traceItem(
  id: string,
  kind: AssistantTraceItem["kind"],
  extra: Partial<AssistantTraceItem> = {},
): AssistantTraceItem {
  return {
    id,
    kind,
    label: kind,
    status: "completed",
    timestamp: 10,
    ...extra,
  }
}

function reasoningItem(id: string, text: string) {
  return traceItem(id, "reasoning", { text })
}

function textItem(id: string, text: string) {
  return traceItem(id, "text", { text })
}

function assistantMessage(
  id: string,
  items: AssistantTraceItem[],
  {
    backendTurnID = "backend-turn-1",
    messageID = `${id}:message`,
    phase = "completed",
    segmentID = `${id}:segment`,
  }: {
    backendTurnID?: string
    messageID?: string
    phase?: AssistantThreadMessage["runtime"]["phase"]
    segmentID?: string
  } = {},
): AssistantThreadMessage {
  return {
    backendTurnID,
    id,
    isStreaming: phase !== "completed" && phase !== "failed" && phase !== "cancelled",
    items,
    kind: "assistant",
    messageID,
    runtime: {
      phase,
      startedAt: 1_000,
      updatedAt: 5_000,
    },
    segmentID,
    state: "",
    timestamp: 1_000,
  }
}

function userMessage(
  id: string,
  text: string,
  streamInsertion?: UserThreadMessage["streamInsertion"],
): UserThreadMessage {
  return {
    id,
    kind: "user",
    streamInsertion,
    submissionMode: streamInsertion ? "steer" : undefined,
    text,
    timestamp: 1_000,
  }
}

function threadTurn(
  turnID: string,
  messages: ThreadMessage[],
  {
    finalSegmentID,
    lastMessageID,
    status = "completed",
  }: {
    finalSegmentID?: string
    lastMessageID?: string
    status?: ThreadTurnStatus
  } = {},
): TestThreadTurn {
  return {
    completedAt: status === "running" ? undefined : 8_000,
    finalSegmentID,
    lastMessageID,
    messages,
    startedAt: 1_000,
    status,
    turnID,
    updatedAt: 7_000,
  }
}

function buildRows(
  messages: ThreadMessage[],
  visibility: AssistantTraceVisibility = DEFAULT_ASSISTANT_TRACE_VISIBILITY,
) {
  return buildThreadDisplayRows({
    activeSession: session,
    activeMessages: messages,
    assistantTraceVisibility: visibility,
    context: buildThreadDisplayContext(messages),
    isResolvingPermissionRequest: false,
    pendingPermissionRequests: [],
  })
}

function derive(
  messages: ThreadMessage[],
  turns: ThreadTurn[] | null | undefined,
  rows = buildRows(messages),
  eligibilityLocks?: ReadonlySet<string>,
) {
  return deriveThreadExecutionGroups({
    eligibilityLocks,
    messages,
    rows,
    turns,
  })
}

function rowIDForItem(rows: ThreadDisplayRow[], itemID: string) {
  const row = rows.find((value) => "itemID" in value && value.itemID === itemID)
  expect(row, `expected a row for ${itemID}`).toBeDefined()
  return row!.rowID
}

describe("thread execution groups", () => {
  it("uses the raw final response boundary before visibility filtering", () => {
    const message = assistantMessage("assistant-1", [
      reasoningItem("reasoning-1", "Inspecting."),
      textItem("intermediate-response", "Still working."),
      reasoningItem("reasoning-2", "Verifying."),
      textItem("final-response", "Done."),
      traceItem("post-response-workflow", "step", { detail: "Published artifact" }),
    ])
    const visibility = {
      ...DEFAULT_ASSISTANT_TRACE_VISIBILITY,
      response: false,
      workflow: true,
    }
    const rows = buildRows([message], visibility)
    const group = derive(
      [message],
      [threadTurn("turn-1", [message], { finalSegmentID: message.segmentID })],
      rows,
    ).groups[0]!

    expect(group.finalMessageID).toBe(message.id)
    expect(group.prefixRowIDs).toEqual([
      rowIDForItem(rows, "reasoning-1"),
      rowIDForItem(rows, "reasoning-2"),
    ])
    expect(group.outcomeRowIDs).toEqual([rowIDForItem(rows, "post-response-workflow")])
    expect(group.eligible).toBe(true)
  })

  it("prefers finalSegmentID, then lastMessageID, over the last nonempty response", () => {
    const first = assistantMessage("assistant-1", [
      reasoningItem("reasoning-1", "One"),
      reasoningItem("reasoning-2", "Two"),
      textItem("response-1", "First response"),
    ], { messageID: "backend-message-1", segmentID: "segment-1" })
    const second = assistantMessage("assistant-2", [
      reasoningItem("reasoning-3", "Three"),
      textItem("response-2", "Second response"),
    ], { messageID: "backend-message-2", segmentID: "segment-2" })
    const messages = [first, second]
    const rows = buildRows(messages)

    const finalSegmentGroup = derive(messages, [threadTurn("turn-1", messages, {
      finalSegmentID: "segment-1",
      lastMessageID: "backend-message-2",
    })], rows).groups[0]!
    expect(finalSegmentGroup.finalMessageID).toBe(first.id)
    expect(finalSegmentGroup.finalSegmentID).toBe("segment-1")

    const lastMessageGroup = derive(messages, [threadTurn("turn-1", messages, {
      lastMessageID: "backend-message-1",
    })], rows).groups[0]!
    expect(lastMessageGroup.finalMessageID).toBe(first.id)

    const fallbackGroup = derive(messages, [threadTurn("turn-1", messages)], rows).groups[0]!
    expect(fallbackGroup.finalMessageID).toBe(second.id)
  })

  it("uses the last canonical segment when multiple segments share lastMessageID", () => {
    const first = assistantMessage("assistant-1", [
      reasoningItem("reasoning-1", "First"),
      textItem("response-1", "First response"),
    ], { messageID: "shared-backend-message", segmentID: "segment-1" })
    const second = assistantMessage("assistant-2", [
      reasoningItem("reasoning-2", "Second"),
      textItem("response-2", "Final response"),
    ], { messageID: "shared-backend-message", segmentID: "segment-2" })
    const messages = [first, second]
    const group = derive(messages, [threadTurn("turn-1", messages, {
      lastMessageID: "shared-backend-message",
    })]).groups[0]!

    expect(group.finalMessageID).toBe(second.id)
    expect(group.finalSegmentID).toBe("segment-2")
  })

  it("resolves shared lastMessageID segments in display order when canonical turn hydration is out of order", () => {
    const first = assistantMessage("assistant-1", [
      reasoningItem("reasoning-1", "First"),
      textItem("response-1", "First response"),
    ], { messageID: "shared-backend-message", segmentID: "segment-1" })
    const second = assistantMessage("assistant-2", [
      reasoningItem("reasoning-2", "Second"),
      textItem("response-2", "Final response"),
    ], { messageID: "shared-backend-message", segmentID: "segment-2" })
    const group = derive(
      [first, second],
      [threadTurn("backend-turn-1", [second, first], { lastMessageID: "shared-backend-message" })],
    ).groups[0]!

    expect(group.assistantMessageIDs).toEqual([first.id, second.id])
    expect(group.finalMessageID).toBe(second.id)
    expect(group.finalSegmentID).toBe("segment-2")
  })

  it("lets an explicit finalSegmentID select an earlier segment of the same backend message", () => {
    const first = assistantMessage("assistant-1", [
      reasoningItem("reasoning-1", "First"),
      textItem("response-1", "First response"),
    ], { messageID: "shared-backend-message", segmentID: "segment-1" })
    const second = assistantMessage("assistant-2", [
      reasoningItem("reasoning-2", "Second"),
      textItem("response-2", "Later response"),
    ], { messageID: "shared-backend-message", segmentID: "segment-2" })
    const messages = [first, second]
    const group = derive(messages, [threadTurn("turn-1", messages, {
      finalSegmentID: "segment-1",
      lastMessageID: "shared-backend-message",
    })]).groups[0]!

    expect(group.finalMessageID).toBe(first.id)
    expect(group.finalSegmentID).toBe("segment-1")
    expect(group.outcomeRowIDs).toContain(rowIDForItem(buildRows(messages), "response-1"))
    expect(group.outcomeRowIDs).toContain(rowIDForItem(buildRows(messages), "response-2"))
    expect(group.prefixRowIDs).not.toContain(rowIDForItem(buildRows(messages), "response-2"))
  })

  it("keeps canonical turns together and limits legacy fallback to one source message", () => {
    const first = assistantMessage("assistant-1", [
      reasoningItem("reasoning-1", "A".repeat(161)),
      textItem("response-1", "First response"),
    ])
    const second = assistantMessage("assistant-2", [
      reasoningItem("reasoning-2", "B".repeat(161)),
      textItem("response-2", "Final response"),
    ])
    const messages = [first, second]
    const rows = buildRows(messages)

    const canonical = derive(messages, [threadTurn("turn-1", messages)], rows)
    expect(canonical.groups).toHaveLength(1)
    expect(canonical.groups[0]).toMatchObject({
      canonical: true,
      groupID: "turn:turn-1",
      summaryRowID: "turn:turn-1:execution-summary",
    })

    const legacy = derive(messages, undefined, rows)
    expect(legacy.groups.map((group) => ({
      canonical: group.canonical,
      groupID: group.groupID,
      prefixRowIDs: group.prefixRowIDs,
    }))).toEqual([
      {
        canonical: false,
        groupID: "legacy:backend-turn-1:assistant-1",
        prefixRowIDs: [rowIDForItem(rows, "reasoning-1")],
      },
      {
        canonical: false,
        groupID: "legacy:backend-turn-1:assistant-2",
        prefixRowIDs: [rowIDForItem(rows, "reasoning-2")],
      },
    ])
  })

  it("does not create a disclosure across an inserted user boundary", () => {
    const message = assistantMessage("assistant-1", [
      reasoningItem("reasoning-1", "Before steer"),
      reasoningItem("reasoning-2", "After steer"),
      textItem("final-response", "Done"),
    ], { phase: "responding" })
    const inserted = userMessage("inserted-user", "Change direction", {
      afterItemCount: 1,
      assistantThreadMessageID: message.id,
      status: "consumed",
    })
    const messages = [message, inserted]
    const rows = buildRows(messages)
    const group = derive(messages, [threadTurn("turn-1", messages, {
      finalSegmentID: message.segmentID,
      status: "running",
    })], rows).groups[0]!

    expect(group.prefixRowIDs).toContain(rows.find((row) => row.kind === "assistant-inserted-user-message")!.rowID)
    expect(group.hasInsertedUserBoundary).toBe(true)
    expect(group.eligible).toBe(false)
  })

  it("does not create one disclosure across a regular user row inside a canonical turn", () => {
    const first = assistantMessage("assistant-1", [
      reasoningItem("reasoning-1", "Before user input"),
      textItem("progress-response", "Still working"),
    ])
    const insertedUser = userMessage("user-between-segments", "Change direction")
    const final = assistantMessage("assistant-2", [
      reasoningItem("reasoning-2", "After user input"),
      textItem("final-response", "Done"),
    ])
    const messages = [first, insertedUser, final]
    const group = derive(
      messages,
      [threadTurn("backend-turn-1", messages, { finalSegmentID: final.segmentID })],
    ).groups[0]!

    expect(group.hasInsertedUserBoundary).toBe(true)
    expect(group.eligible).toBe(false)
  })

  it("never hides an inserted user boundary owned by an earlier assistant segment", () => {
    const earlier = assistantMessage("assistant-earlier", [
      reasoningItem("reasoning-1", "Before steer"),
      reasoningItem("reasoning-2", "Still before steer"),
    ], { backendTurnID: "backend-turn-1", segmentID: "segment-1" })
    const inserted = userMessage("inserted-user", "Change direction", {
      afterItemCount: 1,
      assistantThreadMessageID: earlier.id,
      status: "consumed",
    })
    const final = assistantMessage("assistant-final", [
      reasoningItem("reasoning-3", "After steer"),
      textItem("final-response", "Done"),
    ], { backendTurnID: "backend-turn-1", segmentID: "segment-2" })
    const messages = [earlier, inserted, final]
    const rows = buildRows(messages)
    const group = derive(messages, [threadTurn("turn-1", messages, {
      finalSegmentID: final.segmentID,
    })], rows).groups[0]!
    const insertedRow = rows.find((row) => row.kind === "assistant-inserted-user-message")

    expect(insertedRow).toBeDefined()
    expect(group.prefixRowIDs).toContain(insertedRow!.rowID)
    expect(group.hasInsertedUserBoundary).toBe(true)
    expect(group.eligible).toBe(false)
    expect(projectThreadDisplayRowsWithExecutionGroups({
      expandedByGroupID: { [group.groupID]: false },
      groups: [group],
      rows,
    })).toBe(rows)
  })

  it("implements the fixed row, height, text, line, and heavy-payload thresholds", () => {
    const eligibleFor = (prefixItems: AssistantTraceItem[], mutateRows?: (rows: ThreadDisplayRow[]) => void) => {
      const message = assistantMessage("assistant-1", [...prefixItems, textItem("response", "Done")])
      const rows = buildRows([message])
      mutateRows?.(rows)
      return derive([message], [threadTurn("turn-1", [message])], rows).groups[0]!.eligible
    }

    expect(eligibleFor([reasoningItem("short", "Short")])).toBe(false)
    expect(eligibleFor([
      reasoningItem("row-1", "One"),
      reasoningItem("row-2", "Two"),
    ])).toBe(true)
    expect(eligibleFor([reasoningItem("height", "Short")], (rows) => {
      rows[0] = { ...rows[0]!, estimatedHeight: 180 }
    })).toBe(true)
    expect(eligibleFor([reasoningItem("height-179", "Short")], (rows) => {
      rows[0] = { ...rows[0]!, estimatedHeight: 179 }
    })).toBe(false)
    expect(eligibleFor([reasoningItem("text-160", "x".repeat(160))])).toBe(false)
    expect(eligibleFor([reasoningItem("text-161", "x".repeat(161))])).toBe(true)
    expect(eligibleFor([reasoningItem("lines-3", "one\ntwo\nthree")])).toBe(false)
    expect(eligibleFor([reasoningItem("lines-4", "one\ntwo\nthree\nfour")])).toBe(true)
    expect(eligibleFor([traceItem("tool", "tool", {
      toolInputText: "{\"path\":\"src/index.ts\"}",
    })])).toBe(true)
  })

  it("locks eligibility in caller-owned state but omits a summary for an empty visible prefix", () => {
    const message = assistantMessage("assistant-1", [
      reasoningItem("reasoning-1", "One"),
      reasoningItem("reasoning-2", "Two"),
      textItem("response", "Done"),
    ])
    const initial = derive([message], [threadTurn("turn-1", [message])])
    expect(initial.eligibilityLocks.has("turn:turn-1")).toBe(true)

    const visibility = { ...DEFAULT_ASSISTANT_TRACE_VISIBILITY, reasoning: false }
    const hiddenRows = buildRows([message], visibility)
    const hidden = derive(
      [message],
      [threadTurn("turn-1", [message])],
      hiddenRows,
      initial.eligibilityLocks,
    )
    expect(hidden.groups[0]).toMatchObject({
      eligible: true,
      hasVisiblePrefix: false,
      prefixRowIDs: [],
    })
    expect(projectThreadDisplayRowsWithExecutionGroups({
      groups: hidden.groups,
      rows: hiddenRows,
    })).toBe(hiddenRows)
  })

  it.each<ThreadTurnStatus>([
    "failed",
    "cancelled",
    "stopped",
    "blocked",
    "continued_by_user",
  ])("protects the last failure outcome and marks %s ready for auto-collapse", (status) => {
    const message = assistantMessage("assistant-1", [
      reasoningItem("reasoning-1", "One"),
      reasoningItem("reasoning-2", "Two"),
      traceItem("terminal-error", "error", { detail: "Operation failed", status: "error" }),
    ], { phase: status === "failed" ? "failed" : "completed" })
    const rows = buildRows([message])
    const group = derive([message], [threadTurn("turn-1", [message], { status })], rows).groups[0]!

    expect(group.prefixRowIDs).toEqual([
      rowIDForItem(rows, "reasoning-1"),
      rowIDForItem(rows, "reasoning-2"),
    ])
    expect(group.outcomeRowIDs).toContain(rowIDForItem(rows, "terminal-error"))
    expect(group.autoCollapseReady).toBe(true)
    expect(resolveExecutionGroupExpanded(group, "auto")).toBe(false)
  })

  it("keeps unresolved questions outside the process prefix", () => {
    const message = assistantMessage("assistant-1", [
      reasoningItem("reasoning-1", "One"),
      reasoningItem("reasoning-2", "Two"),
      traceItem("question", "question", {
        questionPrompt: {
          allowFreeform: true,
          multiple: false,
          options: [],
          question: "Continue?",
          required: true,
        },
        status: "pending",
      }),
    ], { phase: "blocked" })
    const rows = buildRows([message])
    const group = derive([message], [threadTurn("turn-1", [message], { status: "blocked" })], rows).groups[0]!

    expect(group.outcomeRowIDs).toContain(rowIDForItem(rows, "question"))
    expect(group.prefixRowIDs).not.toContain(rowIDForItem(rows, "question"))
  })

  it("keeps the last failed tool and pending approval outside an abnormal prefix", () => {
    const message = assistantMessage("assistant-1", [
      reasoningItem("reasoning-1", "One"),
      traceItem("failed-tool-1", "tool", { status: "error", toolOutputText: "First failure" }),
      reasoningItem("reasoning-2", "Two"),
      traceItem("failed-tool-2", "tool", { status: "error", toolOutputText: "Terminal failure" }),
      traceItem("approval", "tool", { section: "approvals", status: "waiting-approval" }),
    ], { phase: "failed" })
    const rows = buildRows([message])
    const group = derive([message], [threadTurn("turn-1", [message], { status: "failed" })], rows).groups[0]!

    expect(group.prefixRowIDs).toContain(rowIDForItem(rows, "failed-tool-1"))
    expect(group.outcomeRowIDs).toEqual([
      rowIDForItem(rows, "failed-tool-2"),
      rowIDForItem(rows, "approval"),
    ])
  })

  it("protects a denied approval and a terminalized pending tool from abnormal collapse", () => {
    const deniedApprovalMessage = assistantMessage("assistant-denied", [
      reasoningItem("reasoning-1", "One"),
      reasoningItem("reasoning-2", "Two"),
      traceItem("denied-approval", "tool", {
        section: "approvals",
        status: "denied",
      }),
    ], { phase: "failed" })
    const deniedRows = buildRows([deniedApprovalMessage])
    const deniedGroup = derive(
      [deniedApprovalMessage],
      [threadTurn("turn-denied", [deniedApprovalMessage], { status: "failed" })],
      deniedRows,
    ).groups[0]!

    expect(deniedGroup.outcomeRowIDs).toContain(rowIDForItem(deniedRows, "denied-approval"))
    expect(deniedGroup.prefixRowIDs).not.toContain(rowIDForItem(deniedRows, "denied-approval"))

    const cancelledToolMessage = assistantMessage("assistant-cancelled", [
      reasoningItem("reasoning-3", "Three"),
      reasoningItem("reasoning-4", "Four"),
      traceItem("pending-tool", "tool", {
        status: "running",
        toolInputText: "{\"path\":\"src/app.ts\"}",
      }),
    ], { phase: "cancelled" })
    const cancelledRows = buildRows([cancelledToolMessage])
    const cancelledGroup = derive(
      [cancelledToolMessage],
      [threadTurn("turn-cancelled", [cancelledToolMessage], { status: "cancelled" })],
      cancelledRows,
    ).groups[0]!

    expect(cancelledGroup.outcomeRowIDs).toContain(rowIDForItem(cancelledRows, "pending-tool"))
    expect(cancelledGroup.prefixRowIDs).not.toContain(rowIDForItem(cancelledRows, "pending-tool"))
  })

  it("waits for an authoritative completed final segment before auto-collapsing", () => {
    const message = assistantMessage("assistant-1", [
      reasoningItem("reasoning-1", "One"),
      reasoningItem("reasoning-2", "Two"),
    ])
    const group = derive([message], [threadTurn("turn-1", [message], {
      finalSegmentID: "segment-not-hydrated-yet",
    })]).groups[0]!

    expect(group.finalMessageID).toBeUndefined()
    expect(group.eligible).toBe(true)
    expect(group.autoCollapseReady).toBe(false)
    expect(resolveExecutionGroupExpanded(group)).toBe(true)
  })

  it("derives canonical duration and projects a stable flattened summary row", () => {
    const message = assistantMessage("assistant-1", [
      reasoningItem("reasoning-1", "One"),
      reasoningItem("reasoning-2", "Two"),
      textItem("response", "Done"),
    ])
    const rows = buildRows([message])
    const result = derive([message], [threadTurn("turn-1", [message])], rows)
    const group = result.groups[0]!

    expect(group.durationMs).toBe(7_000)
    expect(result.groupByRowID.get(group.prefixRowIDs[0]!)).toBe(group)

    const collapsed = projectThreadDisplayRowsWithExecutionGroups({
      groups: [group],
      rows,
    })
    expect(collapsed.map((row) => row.kind)).toEqual([
      "assistant-execution-summary",
      "assistant-response-row",
    ])
    expect(collapsed[0]).toMatchObject({
      durationMs: 7_000,
      expanded: false,
      groupID: "turn:turn-1",
      hiddenRowCount: 2,
      kind: "assistant-execution-summary",
      rowID: "turn:turn-1:execution-summary",
      status: "completed",
      turnID: "turn-1",
    })
    group.prefixRowIDs.forEach((rowID) => {
      expect(collapsed.some((row) => row.rowID === rowID)).toBe(false)
    })

    const expanded = projectThreadDisplayRowsWithExecutionGroups({
      expandedByGroupID: { "turn:turn-1": true },
      groups: [group],
      rows,
    })
    expect(expanded[0]).toMatchObject({
      expanded: true,
      hiddenRowCount: 0,
      kind: "assistant-execution-summary",
    })
    expect(expanded.slice(1).map((row) => row.rowID)).toEqual(rows.map((row) => row.rowID))
    expect(expanded.slice(1).map((row) => {
      if (!("sourceMessageID" in row)) return null
      return {
        rowID: row.rowID,
        sourceMessageID: row.sourceMessageID,
        sourceSegmentID: row.sourceSegmentID,
        sourceTurnID: row.sourceTurnID,
      }
    })).toEqual(rows.map((row) => {
      if (!("sourceMessageID" in row)) return null
      return {
        rowID: row.rowID,
        sourceMessageID: row.sourceMessageID,
        sourceSegmentID: row.sourceSegmentID,
        sourceTurnID: row.sourceTurnID,
      }
    }))
  })

  it("lets explicit disclosure preferences override the automatic terminal state", () => {
    const message = assistantMessage("assistant-1", [
      reasoningItem("reasoning-1", "One"),
      reasoningItem("reasoning-2", "Two"),
      textItem("response", "Done"),
    ])
    const group = derive([message], [threadTurn("turn-1", [message])]).groups[0]!

    expect(resolveExecutionGroupExpanded(group, "auto")).toBe(false)
    expect(resolveExecutionGroupExpanded(group, "expanded")).toBe(true)
    expect(resolveExecutionGroupExpanded(group, "collapsed")).toBe(false)
  })
})
