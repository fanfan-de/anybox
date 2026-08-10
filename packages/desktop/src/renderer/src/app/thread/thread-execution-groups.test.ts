import { describe, expect, it } from "vitest"
import type { ToolCallSnapshot, ToolCallState } from "@anybox/shared"
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
  PermissionRequest,
  SessionSummary,
  ThreadMessage,
  ThreadTurn,
  ThreadTurnStatus,
  UserThreadMessage,
} from "../types"
import { DEFAULT_ASSISTANT_TRACE_VISIBILITY } from "../types"

const session = { id: "session-1" } as SessionSummary

function permissionRequest(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    id: "permission-1",
    approvalID: "approval-1",
    sessionID: session.id,
    messageID: "assistant-approval",
    toolCallID: "tool-call-1",
    projectID: "project-1",
    agent: "default",
    status: "pending",
    createdAt: 1,
    prompt: {
      title: "Approve the test tool",
      summary: "Run the test tool.",
      rationale: "The test tool requires approval.",
      risk: "high",
      detailsAvailable: false,
      allowedDecisions: ["deny", "allow"],
      recommendedDecision: "allow",
    },
    ...overrides,
  }
}

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

type TestToolCallState = "pending" | "running" | "waiting-approval" | "returned" | "failed" | "denied"

function toolItem(
  id: string,
  fixtureState: TestToolCallState = "returned",
  extra: Omit<Partial<AssistantTraceItem>, "kind" | "status" | "toolCall"> = {},
): AssistantTraceItem {
  const execution = { sideEffect: "unknown", retry: "unknown" } as const
  let state: ToolCallState

  switch (fixtureState) {
    case "pending":
      state = { phase: "pending" }
      break
    case "running":
      state = { phase: "running" }
      break
    case "waiting-approval":
      state = { phase: "waiting-approval", approval: { id: `approval-${id}` } }
      break
    case "returned":
      state = {
        phase: "settled",
        outcome: {
          kind: "returned",
          result: "success",
          completeness: "complete",
          output: extra.toolOutputText ?? "Tool completed",
          execution,
        },
        control: { mode: "continue-model" },
      }
      break
    case "failed":
      state = {
        phase: "settled",
        outcome: {
          kind: "failed",
          error: {
            stage: "execution",
            source: "tool",
            code: "TEST_TOOL_FAILURE",
            message: extra.toolOutputText ?? "Tool failed",
            handlerExecuted: true,
            retryable: false,
            severity: "recoverable",
          },
          execution,
        },
        control: { mode: "continue-model" },
      }
      break
    case "denied":
      state = {
        phase: "settled",
        outcome: {
          kind: "denied",
          approvalID: `approval-${id}`,
          reason: "Denied by test fixture",
          execution,
        },
        control: { mode: "continue-model" },
      }
      break
  }

  const settled = state.phase === "settled"
  const toolCall: ToolCallSnapshot = {
    schemaVersion: 3,
    callID: id,
    sessionID: session.id,
    turnID: `turn-${id}`,
    messageID: `message-${id}`,
    executionID: `execution-${id}`,
    tool: extra.toolName ?? extra.title ?? "test_tool",
    input: { raw: extra.toolInputText ?? "" },
    source: { kind: "model", providerID: "test", modelID: "test-model" },
    retry: { attempt: 1 },
    revision: fixtureState === "pending" ? 0 : settled ? 2 : 1,
    timestamps: {
      createdAt: 1,
      ...(fixtureState === "running" ? { startedAt: 2 } : {}),
      ...(fixtureState === "waiting-approval" ? { approvalRequestedAt: 2 } : {}),
      ...(settled ? { settledAt: 3 } : {}),
    },
    state,
  }

  return {
    id,
    kind: "tool",
    label: "tool",
    timestamp: 10,
    ...extra,
    toolCallID: id,
    toolCall,
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
    resume = false,
    status = "completed",
    updatedAt = 7_000,
    userMessageID,
  }: {
    finalSegmentID?: string
    lastMessageID?: string
    resume?: boolean
    status?: ThreadTurnStatus
    updatedAt?: number
    userMessageID?: string
  } = {},
): TestThreadTurn {
  return {
    completedAt: status === "running" ? undefined : 8_000,
    finalSegmentID,
    lastMessageID,
    messages,
    ...(resume ? { resume: true } : {}),
    startedAt: 1_000,
    status,
    turnID,
    updatedAt,
    ...(userMessageID ? { userMessageID } : {}),
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
  answeredQuestionIDs?: ReadonlySet<string>,
  pendingPermissionRequests: readonly PermissionRequest[] = [],
) {
  return deriveThreadExecutionGroups({
    answeredQuestionIDs,
    eligibilityLocks,
    messages,
    pendingPermissionRequests,
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

  it("coalesces pending and real canonical aliases before deriving the final response boundary", () => {
    const user = userMessage("user-1", "Run the task")
    const progress = assistantMessage("assistant-progress", [
      reasoningItem("reasoning-progress", "A".repeat(161)),
      textItem("progress-response", "Still working"),
    ], {
      backendTurnID: "pending:user-1",
      phase: "responding",
      segmentID: "pending-segment",
    })
    const final = assistantMessage("assistant-final", [
      reasoningItem("reasoning-final", "Final checks"),
      textItem("final-response", "Done"),
    ], {
      backendTurnID: "real-turn-1",
      segmentID: "real-segment",
    })
    const messages = [user, progress, final]
    const rows = buildRows(messages)
    const result = derive(messages, [
      threadTurn("pending:user-1", [user, progress], {
        status: "running",
        updatedAt: 9_000,
        userMessageID: user.id,
      }),
      threadTurn("real-turn-1", [user, final], {
        finalSegmentID: final.segmentID,
        userMessageID: user.id,
      }),
    ], rows)

    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]).toMatchObject({
      assistantMessageIDs: [progress.id, final.id],
      finalMessageID: final.id,
      groupID: "turn:real-turn-1",
      status: "completed",
      summaryRowID: "turn:real-turn-1:execution-summary",
      turnID: "real-turn-1",
    })
    expect(result.groups[0]!.prefixRowIDs).toContain(rowIDForItem(rows, "progress-response"))
    expect(result.groups[0]!.outcomeRowIDs).toContain(rowIDForItem(rows, "final-response"))
    expect(result.groups[0]!.prefixRowIDs).not.toContain(rowIDForItem(rows, "final-response"))
  })

  it("coalesces adjacent canonical wrappers that share a backend turn identity", () => {
    const progress = assistantMessage("assistant-progress", [
      reasoningItem("reasoning-progress", "A".repeat(161)),
      textItem("progress-response", "Still working"),
    ], {
      backendTurnID: "shared-backend-turn",
      segmentID: "segment-progress",
    })
    const final = assistantMessage("assistant-final", [
      textItem("final-response", "Done"),
    ], {
      backendTurnID: "shared-backend-turn",
      segmentID: "segment-final",
    })
    const messages = [progress, final]
    const rows = buildRows(messages)
    const result = derive(messages, [
      threadTurn("wrapper-turn-1", [progress]),
      threadTurn("wrapper-turn-2", [final], { finalSegmentID: final.segmentID }),
    ], rows)

    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]).toMatchObject({
      assistantMessageIDs: [progress.id, final.id],
      finalMessageID: final.id,
      groupID: "turn:wrapper-turn-2",
      summaryRowID: "turn:wrapper-turn-2:execution-summary",
      turnID: "wrapper-turn-2",
    })
    expect(result.groups[0]!.prefixRowIDs).toContain(rowIDForItem(rows, "progress-response"))
  })

  it("does not coalesce distinct real turns from the same user message without stronger identity", () => {
    const user = userMessage("user-1", "Run the task")
    const first = assistantMessage("assistant-1", [
      reasoningItem("reasoning-1", "A".repeat(161)),
      textItem("response-1", "First result"),
    ], {
      backendTurnID: "backend-turn-1",
      segmentID: "segment-1",
    })
    const second = assistantMessage("assistant-2", [
      reasoningItem("reasoning-2", "B".repeat(161)),
      textItem("response-2", "Second result"),
    ], {
      backendTurnID: "backend-turn-2",
      segmentID: "segment-2",
    })
    const messages = [user, first, second]
    const result = derive(messages, [
      threadTurn("real-turn-1", [user, first], {
        finalSegmentID: first.segmentID,
        userMessageID: user.id,
      }),
      threadTurn("real-turn-2", [user, second], {
        finalSegmentID: second.segmentID,
        userMessageID: user.id,
      }),
    ])

    expect(result.groups).toHaveLength(2)
    expect(result.groups.map((group) => group.groupID)).toEqual([
      "turn:real-turn-1",
      "turn:real-turn-2",
    ])
  })

  it("coalesces a blocked permission turn with its resumed completion and keeps the final response last", () => {
    const user = userMessage("user-permission", "Run the approved tool")
    const blocked = assistantMessage("assistant-blocked", [
      reasoningItem("reasoning-before-approval", "A".repeat(161)),
      toolItem("tool-before-approval", "returned", { title: "activate-window" }),
      toolItem("permission-approved", "returned", {
        section: "approvals",
        title: "activate-window",
      }),
    ], {
      backendTurnID: "turn-blocked",
      segmentID: "segment-blocked",
    })
    const resumed = assistantMessage("assistant-resumed", [
      reasoningItem("reasoning-after-approval", "Verify the approved action."),
      textItem("final-response", "The plugin is ready."),
    ], {
      backendTurnID: "turn-resumed",
      segmentID: "segment-resumed",
    })
    const messages = [user, blocked, resumed]
    const rows = buildRows(messages)
    const result = derive(messages, [
      threadTurn("turn-blocked", [user, blocked], {
        finalSegmentID: blocked.segmentID,
        status: "blocked",
        updatedAt: 5_000,
        userMessageID: user.id,
      }),
      threadTurn("turn-resumed", [resumed], {
        finalSegmentID: resumed.segmentID,
        resume: true,
        status: "completed",
        updatedAt: 9_000,
        userMessageID: user.id,
      }),
    ], rows)

    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]).toMatchObject({
      assistantMessageIDs: [blocked.id, resumed.id],
      finalMessageID: resumed.id,
      groupID: "turn:turn-resumed",
      status: "completed",
      turnID: "turn-resumed",
    })

    const projected = projectThreadDisplayRowsWithExecutionGroups({
      expandedByGroupID: { "turn:turn-resumed": false },
      groups: result.groups,
      rows,
    })
    expect(projected.filter((row) => row.kind === "assistant-execution-summary")).toHaveLength(1)
    expect(projected.at(-1)?.rowID).toBe(rowIDForItem(rows, "final-response"))
    expect(projected.some((row) => row.rowID === rowIDForItem(rows, "tool-before-approval"))).toBe(false)

    const expandedProjected = projectThreadDisplayRowsWithExecutionGroups({
      expandedByGroupID: { "turn:turn-resumed": true },
      groups: result.groups,
      rows,
    })
    const expandedRowIDs = expandedProjected.map((row) => row.rowID)
    expect(expandedRowIDs.indexOf(rowIDForItem(rows, "tool-before-approval"))).toBeLessThan(
      expandedRowIDs.indexOf(rowIDForItem(rows, "final-response")),
    )
    expect(expandedProjected.at(-1)?.rowID).toBe(rowIDForItem(rows, "final-response"))
  })

  it("does not coalesce canonical wrappers across a regular user boundary", () => {
    const first = assistantMessage("assistant-1", [
      reasoningItem("reasoning-1", "A".repeat(161)),
      textItem("response-1", "First result"),
    ], { backendTurnID: "shared-backend-turn" })
    const insertedUser = userMessage("user-between", "Change direction")
    const final = assistantMessage("assistant-2", [
      reasoningItem("reasoning-2", "B".repeat(161)),
      textItem("response-2", "Final result"),
    ], { backendTurnID: "shared-backend-turn" })
    const messages = [first, insertedUser, final]
    const result = derive(messages, [
      threadTurn("wrapper-turn-1", [first]),
      threadTurn("wrapper-turn-2", [final], { finalSegmentID: final.segmentID }),
    ])

    expect(result.groups).toHaveLength(2)
    expect(result.groups.every((group) => group.assistantMessageIDs.length === 1)).toBe(true)
  })

  it("disables disclosure when duplicate wrappers for the same raw turn cross a user boundary", () => {
    const first = assistantMessage("assistant-1", [
      reasoningItem("reasoning-1", "A".repeat(161)),
      textItem("response-1", "First result"),
    ], { backendTurnID: "segment-backend-1" })
    const insertedUser = userMessage("user-between", "Change direction")
    const final = assistantMessage("assistant-2", [
      reasoningItem("reasoning-2", "B".repeat(161)),
      textItem("response-2", "Final result"),
    ], { backendTurnID: "segment-backend-2" })
    const messages = [first, insertedUser, final]
    const rows = buildRows(messages)
    const result = derive(messages, [
      threadTurn("shared-raw-turn", [first]),
      threadTurn("shared-raw-turn", [final], { finalSegmentID: final.segmentID }),
    ], rows)

    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]).toMatchObject({
      assistantMessageIDs: [first.id, final.id],
      eligible: false,
      groupID: "turn:shared-raw-turn",
      hasInsertedUserBoundary: true,
    })
    expect(projectThreadDisplayRowsWithExecutionGroups({
      expandedByGroupID: { [result.groups[0]!.groupID]: false },
      groups: result.groups,
      rows,
    })).toBe(rows)
  })

  it("does not coalesce canonical wrappers when a targeted stream insertion is stored after them", () => {
    const first = assistantMessage("assistant-1", [
      reasoningItem("reasoning-1", "A".repeat(161)),
      textItem("response-1", "First result"),
    ], { backendTurnID: "shared-backend-turn" })
    const final = assistantMessage("assistant-2", [
      reasoningItem("reasoning-2", "B".repeat(161)),
      textItem("response-2", "Final result"),
    ], { backendTurnID: "shared-backend-turn" })
    const inserted = userMessage("inserted-user", "Change direction", {
      afterItemCount: 1,
      assistantThreadMessageID: first.id,
      status: "consumed",
    })
    const messages = [first, final, inserted]
    const result = derive(messages, [
      threadTurn("wrapper-turn-1", [first]),
      threadTurn("wrapper-turn-2", [final], { finalSegmentID: final.segmentID }),
    ])

    expect(result.groups).toHaveLength(2)
    expect(result.groups.every((group) => group.assistantMessageIDs.length === 1)).toBe(true)
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
    expect(eligibleFor([toolItem("tool", "pending", {
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

  it("folds a recovered tool failure into a completed process when the final response is resolved", () => {
    const message = assistantMessage("assistant-recovered", [
      reasoningItem("reasoning-before-failure", "Inspecting the target file."),
      toolItem("recovered-tool-failure", "failed", {
        toolOutputText: "Patch context did not match",
      }),
      reasoningItem("reasoning-after-failure", "Retrying with the current file contents."),
      textItem("recovered-final-response", "The implementation is ready."),
      traceItem("post-response-error", "error", {
        detail: "Artifact publication failed after the response",
        status: "error",
      }),
    ])
    const rows = buildRows([message])
    const group = derive(
      [message],
      [threadTurn("turn-recovered", [message], { finalSegmentID: message.segmentID })],
      rows,
    ).groups[0]!
    const failureRowID = rowIDForItem(rows, "recovered-tool-failure")
    const responseRowID = rowIDForItem(rows, "recovered-final-response")
    const postResponseErrorRowID = rowIDForItem(rows, "post-response-error")

    expect(group.prefixRowIDs).toContain(failureRowID)
    expect(group.outcomeRowIDs).not.toContain(failureRowID)
    expect(group.outcomeRowIDs).toContain(responseRowID)
    expect(group.outcomeRowIDs).toContain(postResponseErrorRowID)
    expect(group.autoCollapseReady).toBe(true)
    expect(resolveExecutionGroupExpanded(group, "auto")).toBe(false)
    expect(projectThreadDisplayRowsWithExecutionGroups({
      expandedByGroupID: { [group.groupID]: false },
      groups: [group],
      rows,
    }).some((row) => row.rowID === failureRowID)).toBe(false)
  })

  it("keeps a running failure in the process prefix instead of promoting it to an outcome", () => {
    const message = assistantMessage("assistant-running-failure", [
      reasoningItem("reasoning-running-1", "Trying the first approach."),
      toolItem("running-tool-failure", "failed", {
        toolOutputText: "The first approach failed",
      }),
      reasoningItem("reasoning-running-2", "Recovering with another approach."),
    ], { phase: "responding" })
    const rows = buildRows([message])
    const group = derive(
      [message],
      [threadTurn("turn-running-failure", [message], { status: "running" })],
      rows,
    ).groups[0]!
    const failureRowID = rowIDForItem(rows, "running-tool-failure")

    expect(group.prefixRowIDs).toContain(failureRowID)
    expect(group.outcomeRowIDs).not.toContain(failureRowID)
    expect(group.autoCollapseReady).toBe(false)
    expect(resolveExecutionGroupExpanded(group, "auto")).toBe(true)
    expect(projectThreadDisplayRowsWithExecutionGroups({
      expandedByGroupID: { [group.groupID]: false },
      groups: [group],
      rows,
    }).some((row) => row.rowID === failureRowID)).toBe(true)
    expect(projectThreadDisplayRowsWithExecutionGroups({
      expandedByGroupID: { [group.groupID]: false },
      groups: [group],
      rows,
    }).some((row) => row.kind === "assistant-execution-summary")).toBe(false)
  })

  it("keeps a running process visible after response streaming starts", () => {
    const message = assistantMessage("assistant-streaming-response", [
      reasoningItem("reasoning-streaming-1", "Inspecting the implementation."),
      toolItem("tool-streaming", "returned", {
        toolOutputText: "Loaded the relevant source files",
      }),
      traceItem("response-streaming", "text", {
        isStreaming: true,
        status: "running",
        text: "The implementation",
      }),
    ], { phase: "responding" })
    const rows = buildRows([message])
    const group = derive(
      [message],
      [threadTurn("turn-streaming-response", [message], {
        finalSegmentID: message.segmentID,
        status: "running",
      })],
      rows,
    ).groups[0]!

    expect(group.autoCollapseReady).toBe(false)
    expect(resolveExecutionGroupExpanded(group, "auto")).toBe(true)
    expect(projectThreadDisplayRowsWithExecutionGroups({
      groups: [group],
      rows,
    }).map((row) => row.kind)).not.toContain("assistant-execution-summary")
    expect(projectThreadDisplayRowsWithExecutionGroups({
      groups: [group],
      rows,
    }).some((row) => row.rowID === rowIDForItem(rows, "tool-streaming"))).toBe(true)
  })

  it("keeps the last failure outside when a completed turn has no resolved final response", () => {
    const message = assistantMessage("assistant-completed-without-response", [
      reasoningItem("reasoning-no-response-1", "Trying the operation."),
      toolItem("completed-tool-failure", "failed", {
        toolOutputText: "The operation failed",
      }),
      reasoningItem("reasoning-no-response-2", "No final response was produced."),
    ])
    const rows = buildRows([message])
    const group = derive(
      [message],
      [threadTurn("turn-completed-without-response", [message])],
      rows,
    ).groups[0]!
    const failureRowID = rowIDForItem(rows, "completed-tool-failure")

    expect(group.outcomeRowIDs).toContain(failureRowID)
    expect(group.prefixRowIDs).not.toContain(failureRowID)
    expect(group.autoCollapseReady).toBe(false)
    expect(resolveExecutionGroupExpanded(group, "auto")).toBe(true)
  })

  it("keeps an abnormal turn visible even when it contains response text", () => {
    const message = assistantMessage("assistant-failed-with-response", [
      reasoningItem("reasoning-failed-with-response", "Trying the operation."),
      toolItem("terminal-failure-before-response", "failed", {
        toolOutputText: "The operation failed",
      }),
      textItem("failed-turn-final-response", "The task could not be completed."),
    ], { phase: "failed" })
    const rows = buildRows([message])
    const group = derive(
      [message],
      [threadTurn("turn-failed-with-response", [message], {
        finalSegmentID: message.segmentID,
        status: "failed",
      })],
      rows,
    ).groups[0]!
    const failureRowID = rowIDForItem(rows, "terminal-failure-before-response")

    expect(group.outcomeRowIDs).toContain(failureRowID)
    expect(group.prefixRowIDs).not.toContain(failureRowID)
    expect(group.autoCollapseReady).toBe(false)
    expect(resolveExecutionGroupExpanded(group, "auto")).toBe(true)
    expect(projectThreadDisplayRowsWithExecutionGroups({
      groups: [group],
      rows,
    }).some((row) => row.rowID === failureRowID)).toBe(true)
    expect(projectThreadDisplayRowsWithExecutionGroups({
      groups: [group],
      rows,
    }).some((row) => row.kind === "assistant-execution-summary")).toBe(false)
  })

  it.each<ThreadTurnStatus>([
    "failed",
    "cancelled",
    "stopped",
    "blocked",
    "continued_by_user",
  ])("protects the last failure outcome without offering disclosure for %s", (status) => {
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
    expect(group.autoCollapseReady).toBe(false)
    expect(resolveExecutionGroupExpanded(group, "auto")).toBe(true)
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

  it("folds answered questions into the process prefix before the final response", () => {
    const questionMessage = assistantMessage("assistant-1", [
      reasoningItem("reasoning-1", "One"),
      reasoningItem("reasoning-2", "Two"),
      traceItem("answered-question", "question", {
        questionPrompt: {
          allowFreeform: false,
          answerText: "yes",
          answered: true,
          multiple: false,
          options: [{ label: "Yes", value: "yes" }],
          question: "Continue?",
          questionID: "que_continue",
          required: true,
          selectedOptions: ["yes"],
        },
        status: "completed",
      }),
    ], { segmentID: "question-segment" })
    const finalMessage = assistantMessage("assistant-2", [
      textItem("final-response", "Done."),
    ], { segmentID: "final-segment" })
    const messages = [questionMessage, finalMessage]
    const rows = buildRows(messages)
    const group = derive(messages, [threadTurn("turn-1", messages, {
      finalSegmentID: finalMessage.segmentID,
    })], rows).groups[0]!

    expect(group.prefixRowIDs).toContain(rowIDForItem(rows, "answered-question"))
    expect(group.outcomeRowIDs).not.toContain(rowIDForItem(rows, "answered-question"))
    expect(group.autoCollapseReady).toBe(true)
  })

  it("folds questions resolved by a historical answer snapshot into the process prefix", () => {
    const questionMessage = assistantMessage("assistant-1", [
      reasoningItem("reasoning-1", "One"),
      reasoningItem("reasoning-2", "Two"),
      traceItem("history-question", "question", {
        questionPrompt: {
          allowFreeform: false,
          multiple: false,
          options: [{ label: "Yes", value: "yes" }],
          question: "Continue?",
          questionID: "que_history_continue",
          required: true,
        },
        status: "completed",
      }),
    ], { segmentID: "question-segment" })
    const finalMessage = assistantMessage("assistant-2", [
      textItem("final-response", "Done."),
    ], { segmentID: "final-segment" })
    const messages = [questionMessage, finalMessage]
    const rows = buildRows(messages)
    const group = derive(
      messages,
      [threadTurn("turn-1", messages, { finalSegmentID: finalMessage.segmentID })],
      rows,
      undefined,
      new Set(["que_history_continue"]),
    ).groups[0]!

    expect(group.prefixRowIDs).toContain(rowIDForItem(rows, "history-question"))
    expect(group.outcomeRowIDs).not.toContain(rowIDForItem(rows, "history-question"))
  })

  it("only protects permission logs that still match an active request", () => {
    const request = permissionRequest()
    const message = assistantMessage("assistant-1", [
      reasoningItem("reasoning-1", "One"),
      reasoningItem("reasoning-2", "Two"),
      traceItem("permission-requested", "system", {
        approvalID: request.approvalID,
        toolCallID: request.toolCallID,
        section: "approvals",
        status: "pending",
        title: "Permission requested",
      }),
      textItem("final-response", "Done."),
    ])
    const rows = buildRows([message])
    const turns = [threadTurn("turn-1", [message], { finalSegmentID: message.segmentID })]
    const permissionRowID = rowIDForItem(rows, "permission-requested")

    const historicalGroup = derive(
      [message],
      turns,
      rows,
      undefined,
      undefined,
      [],
    ).groups[0]!
    expect(historicalGroup.prefixRowIDs).toContain(permissionRowID)
    expect(historicalGroup.outcomeRowIDs).not.toContain(permissionRowID)
    expect(projectThreadDisplayRowsWithExecutionGroups({
      expandedByGroupID: { [historicalGroup.groupID]: false },
      groups: [historicalGroup],
      rows,
    }).some((row) => row.rowID === permissionRowID)).toBe(false)

    const activeGroup = derive(
      [message],
      turns,
      rows,
      undefined,
      undefined,
      [request],
    ).groups[0]!
    expect(activeGroup.outcomeRowIDs).toContain(permissionRowID)
    expect(activeGroup.prefixRowIDs).not.toContain(permissionRowID)
  })

  it("keeps the last failed tool and pending approval outside an abnormal prefix", () => {
    const message = assistantMessage("assistant-1", [
      reasoningItem("reasoning-1", "One"),
      toolItem("failed-tool-1", "failed", { toolOutputText: "First failure" }),
      reasoningItem("reasoning-2", "Two"),
      toolItem("failed-tool-2", "failed", { toolOutputText: "Terminal failure" }),
      toolItem("approval", "waiting-approval", { section: "approvals" }),
    ], { phase: "failed" })
    const rows = buildRows([message])
    const group = derive(
      [message],
      [threadTurn("turn-1", [message], { status: "failed" })],
      rows,
      undefined,
      undefined,
      [permissionRequest({
        approvalID: "approval-approval",
        toolCallID: "approval",
      })],
    ).groups[0]!

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
      toolItem("denied-approval", "denied", {
        section: "approvals",
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
      toolItem("pending-tool", "running", {
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
