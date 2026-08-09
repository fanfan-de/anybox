import { describe, expect, it } from "vitest"
import type { LoadedSessionHistoryMessage } from "./types"
import {
  buildSessionMessageTree,
  isCompletedAssistantResponse,
  listBranchAnchorOptions,
  listRecentBranchThreads,
} from "./session-message-tree"

function createMessage(input: {
  created: number
  completed?: number
  finishReason?: string
  internal?: boolean
  id: string
  parentMessageID?: string | null
  role: "user" | "assistant"
  parts?: unknown[]
  text: string
  turnID?: string
  turnLastMessageID?: string
  turnStatus?: "running" | "completed" | "blocked" | "failed" | "cancelled" | "continued_by_user"
  turnUserMessageID?: string
}): LoadedSessionHistoryMessage {
  return {
    info: {
      created: input.created,
      completed: input.completed ?? (input.role === "assistant" ? input.created : undefined),
      finishReason: input.finishReason,
      id: input.id,
      internal: input.internal,
      parentMessageID: input.parentMessageID ?? null,
      role: input.role,
      sessionID: "session-1",
    },
    parts: input.parts ?? [{ id: `part-${input.id}`, type: "text", text: input.text }],
    turn: input.turnID
      ? {
          id: input.turnID,
          sessionID: "session-1",
          projectID: "project-1",
          userMessageID: input.turnUserMessageID,
          status: input.turnStatus ?? "completed",
          lastMessageID: input.turnLastMessageID,
          createdAt: input.created,
          updatedAt: input.created,
          completedAt: input.created,
        }
      : undefined,
  }
}

function settledToolPart(id: string, tool: string) {
  return {
    id,
    sessionID: "session-1",
    messageID: `message-${id}`,
    type: "tool",
    callID: `call-${id}`,
    tool,
    schemaVersion: 3,
    turnID: `turn-${id}`,
    input: { raw: "{}", value: {} },
    source: { kind: "model" },
    retry: { attempt: 1 },
    revision: 1,
    timestamps: { createdAt: 1, settledAt: 2 },
    state: {
      phase: "settled",
      outcome: {
        kind: "returned",
        result: "success",
        completeness: "complete",
        output: "done",
        execution: { sideEffect: "none", retry: "safe" },
      },
      control: { mode: "continue-model" },
    },
  }
}

describe("session message tree", () => {
  it("recognizes only final completed assistant responses as branch anchors", () => {
    expect(isCompletedAssistantResponse(createMessage({
      id: "assistant-final",
      role: "assistant",
      created: 1,
      text: "Done",
      finishReason: "stop",
    }))).toBe(true)
    expect(isCompletedAssistantResponse(createMessage({
      id: "assistant-tool-loop",
      role: "assistant",
      created: 2,
      text: "Calling a tool",
      finishReason: "tool-calls",
    }))).toBe(false)
    expect(isCompletedAssistantResponse(createMessage({
      id: "user-complete",
      role: "user",
      created: 3,
      text: "Not an assistant response",
    }))).toBe(false)
  })

  it("builds active paths and branch options from parent message links", () => {
    const tree = buildSessionMessageTree([
      createMessage({ id: "user-1", role: "user", created: 1, text: "Start" }),
      createMessage({ id: "assistant-1", role: "assistant", created: 2, parentMessageID: "user-1", text: "Base answer" }),
      createMessage({ id: "user-2", role: "user", created: 3, parentMessageID: "assistant-1", text: "MVP branch" }),
      createMessage({ id: "assistant-2", role: "assistant", created: 4, parentMessageID: "user-2", text: "MVP result" }),
      createMessage({ id: "user-3", role: "user", created: 5, parentMessageID: "assistant-1", text: "Long-term branch" }),
      createMessage({ id: "assistant-3", role: "assistant", created: 6, parentMessageID: "user-3", text: "Long-term result" }),
    ], "assistant-3")

    expect(tree?.activePathMessageIDs).toEqual(["user-1", "assistant-1", "user-3", "assistant-3"])
    expect(tree?.rootMessageIDs).toEqual(["user-1"])
    expect(tree?.branchOptionsByParentID["assistant-1"]).toMatchObject([
      {
        childMessageID: "user-2",
        isActive: false,
        leafMessageID: "assistant-2",
        preview: "MVP branch",
      },
      {
        childMessageID: "user-3",
        isActive: true,
        leafMessageID: "assistant-3",
        preview: "Long-term branch",
      },
    ])
  })

  it("exposes multiple roots in stable created and id order", () => {
    const tree = buildSessionMessageTree([
      createMessage({ id: "root-c", role: "user", created: 3, text: "Third root" }),
      createMessage({ id: "root-b", role: "user", created: 1, text: "Second by id" }),
      createMessage({ id: "root-a", role: "user", created: 1, text: "First by id" }),
      createMessage({ id: "assistant-1", role: "assistant", created: 4, parentMessageID: "root-a", text: "Child" }),
    ], "assistant-1")

    expect(tree?.rootMessageIDs).toEqual(["root-a", "root-b", "root-c"])
    expect(tree?.activePathMessageIDs).toEqual(["root-a", "assistant-1"])
    expect(tree?.branchOptionsByParentID).toEqual({})
  })

  it("keeps only user messages and final assistant response text in the tree", () => {
    const tree = buildSessionMessageTree([
      createMessage({ id: "user-1", role: "user", created: 1, text: "Start" }),
      createMessage({
        id: "assistant-hidden",
        role: "assistant",
        created: 2,
        parentMessageID: "user-1",
        text: "",
        parts: [
          { id: "reasoning-1", type: "reasoning", text: "Private reasoning" },
          settledToolPart("tool-1", "read-file"),
        ],
      }),
      createMessage({
        id: "user-2",
        role: "user",
        created: 3,
        parentMessageID: "assistant-hidden",
        text: "Follow up",
      }),
      createMessage({
        id: "assistant-1",
        role: "assistant",
        created: 4,
        parentMessageID: "user-2",
        text: "",
        parts: [
          { id: "reasoning-2", type: "reasoning", text: "More private reasoning" },
          settledToolPart("tool-2", "grep"),
          { id: "text-1", type: "text", text: "Final response only" },
        ],
      }),
      createMessage({ id: "internal-1", role: "assistant", created: 5, internal: true, text: "Compaction" }),
    ], "assistant-1")

    expect(Object.keys(tree?.nodesByID ?? {})).toEqual(["user-1", "user-2", "assistant-1"])
    expect(tree?.childIDsByParentID["user-1"]).toEqual(["user-2"])
    expect(tree?.nodesByID["assistant-1"]?.preview).toBe("Final response only")
    expect(tree?.nodesByID["assistant-1"]?.content).toBe("Final response only")
    expect(tree?.activePathMessageIDs).toEqual(["user-1", "user-2", "assistant-1"])
  })

  it("hides intermediate text responses from the same backend turn", () => {
    const tree = buildSessionMessageTree([
      createMessage({ id: "user-1", role: "user", created: 1, text: "Start" }),
      createMessage({
        id: "assistant-progress",
        role: "assistant",
        created: 2,
        parentMessageID: "user-1",
        text: "I will inspect the project first.",
        turnID: "turn-1",
        turnLastMessageID: "assistant-final",
        turnUserMessageID: "user-1",
      }),
      createMessage({
        id: "assistant-mid",
        role: "assistant",
        created: 3,
        parentMessageID: "assistant-progress",
        text: "The project contains these files.",
        turnID: "turn-1",
        turnLastMessageID: "assistant-final",
        turnUserMessageID: "user-1",
      }),
      createMessage({
        id: "assistant-final",
        role: "assistant",
        created: 4,
        parentMessageID: "assistant-mid",
        text: "Final answer only.",
        turnID: "turn-1",
        turnLastMessageID: "assistant-final",
        turnUserMessageID: "user-1",
      }),
    ], "assistant-progress")

    expect(Object.keys(tree?.nodesByID ?? {})).toEqual(["user-1", "assistant-final"])
    expect(tree?.childIDsByParentID["user-1"]).toEqual(["assistant-final"])
    expect(tree?.nodesByID["assistant-final"]?.parentMessageID).toBe("user-1")
    expect(tree?.nodesByID["assistant-final"]?.content).toBe("Final answer only.")
    expect(tree?.activeMessageID).toBe("assistant-final")
    expect(tree?.activePathMessageIDs).toEqual(["user-1", "assistant-final"])
  })

  it("falls back to the latest text response when a backend turn has no last message id", () => {
    const tree = buildSessionMessageTree([
      createMessage({ id: "user-1", role: "user", created: 1, text: "Start" }),
      createMessage({
        id: "assistant-progress",
        role: "assistant",
        created: 2,
        parentMessageID: "user-1",
        text: "Working on it.",
        turnID: "turn-1",
        turnUserMessageID: "user-1",
      }),
      createMessage({
        id: "assistant-final",
        role: "assistant",
        created: 3,
        parentMessageID: "assistant-progress",
        text: "Latest visible response.",
        turnID: "turn-1",
        turnUserMessageID: "user-1",
      }),
    ], "assistant-final")

    expect(Object.keys(tree?.nodesByID ?? {})).toEqual(["user-1", "assistant-final"])
    expect(tree?.childIDsByParentID["user-1"]).toEqual(["assistant-final"])
  })

  it("keeps full response content while compacting node previews", () => {
    const longResponse = [
      "First paragraph with enough detail to go beyond the compact preview length.",
      "Second paragraph should stay available for the expanded response card.",
    ].join("\n\n")
    const tree = buildSessionMessageTree([
      createMessage({ id: "user-1", role: "user", created: 1, text: "Start" }),
      createMessage({ id: "assistant-1", role: "assistant", created: 2, parentMessageID: "user-1", text: longResponse }),
    ], "assistant-1")

    expect(tree?.nodesByID["assistant-1"]?.content).toBe(longResponse)
    expect(tree?.nodesByID["assistant-1"]?.preview).toBe(
      "First paragraph with enough detail to go beyond the compact preview len...",
    )
  })

  it("caps very large expanded response content", () => {
    const longResponse = "x".repeat(20_000)
    const tree = buildSessionMessageTree([
      createMessage({ id: "user-1", role: "user", created: 1, text: "Start" }),
      createMessage({ id: "assistant-1", role: "assistant", created: 2, parentMessageID: "user-1", text: longResponse }),
    ], "assistant-1")

    const content = tree?.nodesByID["assistant-1"]?.content ?? ""
    expect(content.length).toBeLessThan(longResponse.length)
    expect(content).toContain("Message tree preview truncated")
  })

  it("derives valid anchors and recent detached leaves relative to the active path", () => {
    const messages = [
      createMessage({ id: "user-root", role: "user", created: 1, text: "Start" }),
      createMessage({ id: "assistant-anchor", role: "assistant", created: 2, parentMessageID: "user-root", text: "Shared answer" }),
      createMessage({ id: "user-main", role: "user", created: 3, parentMessageID: "assistant-anchor", text: "Continue main" }),
      createMessage({ id: "assistant-main", role: "assistant", created: 4, parentMessageID: "user-main", text: "Main result" }),
      createMessage({ id: "user-branch", role: "user", created: 5, parentMessageID: "assistant-anchor", text: "Explore alternative" }),
      createMessage({
        id: "assistant-branch",
        role: "assistant",
        created: 6,
        parentMessageID: "user-branch",
        text: "Alternative result",
        turnID: "turn-branch",
        turnLastMessageID: "assistant-branch",
        turnUserMessageID: "user-branch",
      }),
    ]
    const tree = buildSessionMessageTree(messages, "assistant-main")

    expect(listBranchAnchorOptions(tree).map((anchor) => anchor.messageID)).toEqual([
      "assistant-anchor",
      "assistant-main",
    ])
    expect(listRecentBranchThreads(tree)).toEqual([
      expect.objectContaining({
        originMessageID: "assistant-anchor",
        headMessageID: "assistant-branch",
        title: "Explore alternative",
        leafPreview: "Alternative result",
        status: "completed",
      }),
    ])

    const switchedTree = buildSessionMessageTree(messages, "assistant-branch")
    expect(listRecentBranchThreads(switchedTree)).toEqual([
      expect.objectContaining({
        originMessageID: "assistant-anchor",
        headMessageID: "assistant-main",
        title: "Continue main",
      }),
    ])
  })

  it("excludes blocked tool-loop responses from anchor choices and derives quote-only titles", () => {
    const tree = buildSessionMessageTree([
      createMessage({ id: "user-root", role: "user", created: 1, text: "Start" }),
      createMessage({
        id: "assistant-complete",
        role: "assistant",
        created: 2,
        parentMessageID: "user-root",
        text: "Completed response",
        turnID: "turn-complete",
        turnLastMessageID: "assistant-complete",
        turnStatus: "completed",
        turnUserMessageID: "user-root",
      }),
      createMessage({
        id: "user-main",
        role: "user",
        created: 3,
        parentMessageID: "assistant-complete",
        text: "Continue",
      }),
      createMessage({
        id: "assistant-blocked",
        role: "assistant",
        created: 4,
        parentMessageID: "user-main",
        text: "Waiting for a tool",
        turnID: "turn-blocked",
        turnLastMessageID: "assistant-blocked",
        turnStatus: "blocked",
        turnUserMessageID: "user-main",
      }),
      createMessage({
        id: "user-quote-branch",
        role: "user",
        created: 5,
        parentMessageID: "assistant-complete",
        text: "",
        parts: [{
          id: "quote-only",
          type: "message-quote",
          sourceMessageID: "assistant-complete",
          text: "Quoted title source",
        }],
      }),
      createMessage({
        id: "assistant-quote-branch",
        role: "assistant",
        created: 6,
        parentMessageID: "user-quote-branch",
        text: "Quote branch result",
      }),
    ], "assistant-blocked")

    expect(listBranchAnchorOptions(tree).map((anchor) => anchor.messageID)).toEqual([
      "assistant-complete",
    ])
    expect(listRecentBranchThreads(tree)).toEqual([
      expect.objectContaining({
        headMessageID: "assistant-quote-branch",
        title: "Quoted title source",
      }),
    ])
  })

  it("presents detached leaf runtime status for recent branches", () => {
    const tree = buildSessionMessageTree([
      createMessage({ id: "user-root", role: "user", created: 1, text: "Start" }),
      createMessage({ id: "assistant-anchor", role: "assistant", created: 2, parentMessageID: "user-root", text: "Shared answer" }),
      createMessage({ id: "user-main", role: "user", created: 3, parentMessageID: "assistant-anchor", text: "Main" }),
      createMessage({ id: "assistant-main", role: "assistant", created: 4, parentMessageID: "user-main", text: "Main result" }),
      createMessage({ id: "user-branch", role: "user", created: 5, parentMessageID: "assistant-anchor", text: "Inspect" }),
      createMessage({
        id: "assistant-waiting",
        role: "assistant",
        created: 6,
        parentMessageID: "user-branch",
        text: "Waiting",
        turnID: "turn-waiting",
        turnLastMessageID: "assistant-waiting",
        turnStatus: "blocked",
        turnUserMessageID: "user-branch",
        parts: [
          {
            id: "text-waiting",
            type: "text",
            text: "Waiting",
          },
          {
            id: "tool-waiting",
            sessionID: "session-1",
            messageID: "assistant-waiting",
            type: "tool",
            callID: "tool-call",
            tool: "read-file",
            schemaVersion: 3,
            turnID: "turn-waiting",
            input: { raw: "{}", value: {} },
            source: { kind: "model" },
            retry: { attempt: 1 },
            revision: 1,
            timestamps: { createdAt: 1, approvalRequestedAt: 2 },
            state: {
              phase: "waiting-approval",
              approval: { id: "approval" },
            },
          },
        ],
      }),
    ], "assistant-main")

    expect(listRecentBranchThreads(tree)[0]).toEqual(expect.objectContaining({
      headMessageID: "assistant-waiting",
      status: "waiting_approval",
    }))
  })
})
