import { describe, expect, it } from "vitest"
import { applyAgentStreamEventToTurn, buildSessionStreamingAssistantTurn, buildStreamingAssistantTurn, buildTurnsFromHistory, buildUserTurn, buildUserTurnText } from "./stream"

describe("stream trace reducer", () => {
  it("trusts backend order when history includes parent metadata", () => {
    const turns = buildTurnsFromHistory([
      {
        info: {
          id: "assistant-root",
          sessionID: "session-tree",
          role: "assistant",
          created: 100,
          parentMessageID: null,
        },
        parts: [],
      },
      {
        info: {
          id: "assistant-branch-head",
          sessionID: "session-tree",
          role: "assistant",
          created: 300,
          parentMessageID: "assistant-root",
        },
        parts: [],
      },
      {
        info: {
          id: "assistant-middle",
          sessionID: "session-tree",
          role: "assistant",
          created: 200,
          parentMessageID: "assistant-root",
        },
        parts: [],
      },
    ])

    expect(turns.map((turn) => turn.id)).toEqual([
      "assistant-root",
      "assistant-branch-head",
      "assistant-middle",
    ])
  })

  it("keeps legacy created/id sorting when history has no parent metadata", () => {
    const turns = buildTurnsFromHistory([
      {
        info: {
          id: "assistant-newer",
          sessionID: "session-legacy",
          role: "assistant",
          created: 200,
        },
        parts: [],
      },
      {
        info: {
          id: "assistant-older",
          sessionID: "session-legacy",
          role: "assistant",
          created: 100,
        },
        parts: [],
      },
    ])

    expect(turns.map((turn) => turn.id)).toEqual(["assistant-older", "assistant-newer"])
  })

  it("annotates history trace items with message and backend turn ownership", () => {
    const [turn] = buildTurnsFromHistory([
      {
        info: {
          id: "message-history",
          sessionID: "session-history",
          role: "assistant",
          created: 100,
        },
        turn: {
          id: "turn-history",
          sessionID: "session-history",
          projectID: "project-history",
          status: "completed",
          createdAt: 100,
          updatedAt: 200,
        },
        parts: [{ id: "part-history-text", type: "text", text: "History answer" }],
      },
    ])

    expect(turn?.kind).toBe("assistant")
    if (turn?.kind !== "assistant") return

    const responseItem = turn.items.find((item) => item.kind === "text")
    expect(responseItem?.messageID).toBe("message-history")
    expect(responseItem?.backendTurnID).toBe("turn-history")
  })

  it("treats completed history as completed even when a workflow step-start remains pending", () => {
    const [turn] = buildTurnsFromHistory([
      {
        info: {
          id: "message-completed-with-step",
          sessionID: "session-history",
          role: "assistant",
          created: 100,
          completed: 200,
          finishReason: "stop",
        },
        turn: {
          id: "turn-completed-with-step",
          sessionID: "session-history",
          projectID: "project-history",
          status: "completed",
          phase: "completed",
          lastMessageID: "message-completed-with-step",
          createdAt: 100,
          updatedAt: 200,
          completedAt: 200,
        },
        parts: [
          {
            id: "part-step-start",
            type: "step-start",
          },
          {
            id: "part-response",
            type: "text",
            text: "Done.",
          },
        ],
      },
    ])

    expect(turn?.kind).toBe("assistant")
    if (turn?.kind !== "assistant") return

    expect(turn.runtime.phase).toBe("completed")
    expect(turn.state).toBe("Backend response received")
    expect(turn.isStreaming).toBe(false)
    expect(turn.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "step",
          status: "pending",
          title: "Model step started",
        }),
        expect.objectContaining({
          kind: "system",
          status: "completed",
          title: "Response complete",
        }),
      ]),
    )
  })

  it("keeps completed assistant messages streaming while their backend turn is still running", () => {
    const [turn] = buildTurnsFromHistory([
      {
        info: {
          id: "message-running-after-tool",
          sessionID: "session-history",
          role: "assistant",
          created: 100,
          completed: 180,
          finishReason: "tool-calls",
        },
        turn: {
          id: "turn-running-after-tool",
          sessionID: "session-history",
          projectID: "project-history",
          status: "running",
          phase: "waiting_llm",
          lastMessageID: "message-running-after-tool",
          createdAt: 100,
          updatedAt: 200,
        },
        parts: [
          {
            id: "part-task-create",
            type: "tool",
            messageID: "message-running-after-tool",
            callID: "call-task-create",
            tool: "task_create",
            state: {
              status: "completed",
              output: "Tasks created",
            },
          },
        ],
      },
    ])

    expect(turn?.kind).toBe("assistant")
    if (turn?.kind !== "assistant") return

    expect(turn.runtime.phase).toBe("waiting_llm")
    expect(turn.state).toBe("Waiting for model stream")
    expect(turn.isStreaming).toBe(true)
    expect(turn.items.some((item) => item.kind === "system" && item.title === "Response complete")).toBe(false)
  })

  it("truncates oversized live text items before rendering them", () => {
    let turn = buildStreamingAssistantTurn("Stream a large response")
    const oversizedText = "x".repeat(170_000)

    turn = applyAgentStreamEventToTurn(turn, {
      id: "101:turn-runtime:2",
      event: "runtime",
      data: {
        eventID: "event-2",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 2,
        timestamp: 101,
        type: "text.part.delta",
        payload: {
          messageID: "message-runtime",
          partID: "part-runtime-text",
          kind: "text",
          delta: oversizedText,
          text: oversizedText,
        },
      },
    })

    const responseItem = turn.items.find((item) => item.kind === "text")
    const responseText = responseItem?.text ?? ""

    expect(responseText).toContain("Renderer truncated this live stream item")
    expect(responseText.length).toBeLessThan(161_000)
    expect(responseItem?.debugEntries).toContainEqual({
      label: "stream.render.truncated",
      value: "true",
    })
  })

  it("reduces canonical runtime events into an assistant turn", () => {
    let turn = buildStreamingAssistantTurn("Show runtime trace")

    turn = applyAgentStreamEventToTurn(turn, {
      id: "100:turn-runtime:1",
      event: "runtime",
      data: {
        eventID: "event-1",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 1,
        timestamp: 100,
        type: "turn.started",
        payload: {},
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      id: "101:turn-runtime:2",
      event: "runtime",
      data: {
        eventID: "event-2",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 2,
        timestamp: 101,
        type: "text.part.delta",
        payload: {
          messageID: "message-runtime",
          partID: "part-runtime-text",
          kind: "text",
          delta: "Runtime answer",
          text: "Runtime answer",
        },
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      id: "102:turn-runtime:3",
      event: "runtime",
      data: {
        eventID: "event-3",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 3,
        timestamp: 102,
        type: "turn.completed",
        payload: {
          status: "completed",
          finishReason: "stop",
          parts: [{ id: "part-runtime-text", type: "text", text: "Runtime answer" }],
        },
      },
    })

    expect(turn.runtime.phase).toBe("completed")
    expect(turn.messageID).toBe("message-runtime")
    expect(turn.isStreaming).toBe(false)
    const responseItem = turn.items.find((item) => item.kind === "text" && item.text === "Runtime answer")
    expect(responseItem?.messageID).toBe("message-runtime")
    expect(responseItem?.backendTurnID).toBe("turn-runtime")
  })

  it("uses canonical runtime timestamps for replayed turn duration", () => {
    let turn = buildSessionStreamingAssistantTurn("Replaying backend activity")

    turn = applyAgentStreamEventToTurn(turn, {
      id: "10000:turn-runtime:1",
      event: "runtime",
      data: {
        eventID: "event-started",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 1,
        timestamp: 10_000,
        type: "turn.started",
        payload: {},
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      id: "70000:turn-runtime:2",
      event: "runtime",
      data: {
        eventID: "event-text",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 2,
        timestamp: 70_000,
        type: "text.part.delta",
        payload: {
          messageID: "message-runtime",
          partID: "part-runtime-text",
          kind: "text",
          delta: "Runtime answer",
          text: "Runtime answer",
        },
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      id: "130000:turn-runtime:3",
      event: "runtime",
      data: {
        eventID: "event-completed",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 3,
        timestamp: 130_000,
        type: "turn.completed",
        payload: {
          status: "completed",
          finishReason: "stop",
          parts: [{ id: "part-runtime-text", type: "text", text: "Runtime answer" }],
        },
      },
    })

    expect(turn.runtime.startedAt).toBe(10_000)
    expect(turn.runtime.updatedAt).toBe(130_000)
    expect(turn.runtime.updatedAt - turn.runtime.startedAt).toBe(120_000)
  })

  it("marks runtime cancelled turns as stopped streams", () => {
    let turn = buildStreamingAssistantTurn("Cancel runtime trace")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-cancelled",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 1,
        timestamp: 100,
        type: "turn.cancelled",
        payload: {
          reason: "client-disconnect",
          detail: "client closed the stream",
        },
      },
    })

    expect(turn.runtime.phase).toBe("cancelled")
    expect(turn.isStreaming).toBe(false)
    expect(turn.state).toBe("Backend stream cancelled")
  })

  it("marks continued-by-user runtime completions as settled continuation turns", () => {
    let turn = buildStreamingAssistantTurn("Steer runtime trace")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-continued",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 1,
        timestamp: 100,
        type: "turn.completed",
        payload: {
          status: "continued_by_user",
          finishReason: "user-input",
          parts: [],
        },
      },
    })

    expect(turn.runtime.phase).toBe("continued_by_user")
    expect(turn.isStreaming).toBe(false)
    expect(turn.state).toBe("Continued by user input")
  })

  it("renders task state runtime events as workflow trace items", () => {
    let turn = buildStreamingAssistantTurn("Track tasks")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-task-state",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 1,
        timestamp: 100,
        type: "task.state.updated",
        payload: {
          action: "update",
          changedTaskIDs: ["1"],
          state: {
            sessionID: "session-runtime",
            generatedAt: 100,
            tasks: [
              {
                id: "1",
                sessionID: "session-runtime",
                subject: "Inspect code",
                description: "Inspect code",
                activeForm: "Inspecting code",
                owner: "default",
                status: "completed",
                blocks: ["2"],
                blockedBy: [],
                metadata: {},
                createdAt: 90,
                updatedAt: 100,
                isBlocked: false,
                blockingTasks: [],
                blockedTasks: [],
              },
              {
                id: "2",
                sessionID: "session-runtime",
                subject: "Run tests",
                description: "Run tests",
                activeForm: "Running tests",
                owner: "default",
                status: "in_progress",
                blocks: [],
                blockedBy: ["1"],
                metadata: {},
                createdAt: 91,
                updatedAt: 100,
                isBlocked: false,
                blockingTasks: [],
                blockedTasks: [],
              },
            ],
            current: [],
            next: [],
            blocked: [],
            owners: [],
            teammateActivity: [],
            summary: {
              total: 2,
              completed: 1,
              pending: 0,
              inProgress: 1,
              blocked: 0,
            },
          },
        },
      },
    })

    const taskItem = turn.items.find((item) => item.kind === "task-state")
    expect(taskItem?.title).toBe("1/2 tasks")
    expect(taskItem?.progressItems?.map((item) => item.status)).toEqual(["completed", "in_progress"])
  })

  it("replaces repeated task state runtime snapshots for the same turn", () => {
    let turn = buildStreamingAssistantTurn("Track repeated task updates")
    const createTaskStateEvent = (eventID: string, completed: number) => ({
      event: "runtime",
      data: {
        eventID,
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: completed,
        timestamp: 100 + completed,
        type: "task.state.updated",
        payload: {
          state: {
            sessionID: "session-runtime",
            generatedAt: 100 + completed,
            tasks: [
              {
                id: "1",
                sessionID: "session-runtime",
                subject: "Inspect code",
                description: "Inspect code",
                activeForm: "Inspecting code",
                owner: "default",
                status: completed > 0 ? "completed" : "in_progress",
                blocks: [],
                blockedBy: [],
                metadata: {},
                createdAt: 90,
                updatedAt: 100 + completed,
                isBlocked: false,
                blockingTasks: [],
                blockedTasks: [],
              },
            ],
            current: [],
            next: [],
            blocked: [],
            owners: [],
            teammateActivity: [],
            summary: {
              total: 1,
              completed,
              pending: 0,
              inProgress: completed > 0 ? 0 : 1,
              blocked: 0,
            },
          },
        },
      },
    })

    turn = applyAgentStreamEventToTurn(turn, createTaskStateEvent("event-task-state-1", 0))
    const firstTaskItem = turn.items.find((item) => item.kind === "task-state")
    if (firstTaskItem) {
      turn = {
        ...turn,
        items: [
          ...turn.items,
          {
            ...firstTaskItem,
            id: "stale-task-state",
            sourceID: "task-state:event-task-state-stale",
            title: "0/1 stale tasks",
          },
        ],
      }
    }
    turn = applyAgentStreamEventToTurn(turn, createTaskStateEvent("event-task-state-2", 1))

    const taskItems = turn.items.filter((item) => item.kind === "task-state")
    expect(taskItems).toHaveLength(1)
    expect(taskItems[0]?.sourceID).toBe("task-state:turn-runtime")
    expect(taskItems[0]?.title).toBe("1/1 tasks")
    expect(taskItems[0]?.progressItems?.map((item) => item.status)).toEqual(["completed"])
  })

  it("restores completed task tool history as regular tool trace items", () => {
    const [turn] = buildTurnsFromHistory([
      {
        info: {
          id: "msg-task-state",
          sessionID: "session-1",
          role: "assistant",
          created: 100,
          completed: 120,
          finishReason: "tool-calls",
        },
        parts: [
          {
            id: "part-task-tool",
            type: "tool",
            tool: "TaskUpdate",
            callID: "toolcall-task",
            state: {
              status: "completed",
              input: {},
              output: "Task updated",
              title: "Task updated",
              metadata: {
                kind: "task-state",
                toolCallID: "toolcall-task",
                state: {
                  sessionID: "session-1",
                  generatedAt: 110,
                  tasks: [
                    {
                      id: "1",
                      sessionID: "session-1",
                      subject: "Implement",
                      description: "Implement",
                      activeForm: "Implementing",
                      owner: "default",
                      status: "completed",
                      blocks: [],
                      blockedBy: [],
                      metadata: {},
                      createdAt: 100,
                      updatedAt: 110,
                      isBlocked: false,
                      blockingTasks: [],
                      blockedTasks: [],
                    },
                    {
                      id: "2",
                      sessionID: "session-1",
                      subject: "Verify",
                      description: "Verify",
                      activeForm: "Verifying",
                      owner: "default",
                      status: "pending",
                      blocks: [],
                      blockedBy: [],
                      metadata: {},
                      createdAt: 101,
                      updatedAt: 110,
                      isBlocked: false,
                      blockingTasks: [],
                      blockedTasks: [],
                    },
                  ],
                  current: [],
                  next: [],
                  blocked: [],
                  owners: [],
                  teammateActivity: [],
                  summary: {
                    total: 2,
                    completed: 1,
                    pending: 1,
                    inProgress: 0,
                    blocked: 0,
                  },
                },
              },
              time: {
                start: 101,
                end: 110,
              },
            },
          },
        ],
      },
    ])

    expect(turn?.kind).toBe("assistant")
    if (turn?.kind !== "assistant") return
    const taskToolItem = turn.items.find((item) => item.kind === "tool" && item.toolCallID === "toolcall-task")
    expect(taskToolItem?.title).toBe("TaskUpdate")
    expect(taskToolItem?.toolOutputText).toBe("Task updated")
    expect(taskToolItem?.visibilityKey).toBe("toolCalls")
    expect(turn.items.find((item) => item.kind === "task-state")).toBeUndefined()
  })

  it("settles on completed runtime phase even before a terminal event arrives", () => {
    let turn = buildStreamingAssistantTurn("Finish from state")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-state-completed",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 1,
        timestamp: 100,
        type: "turn.state.changed",
        payload: {
          phase: "completed",
          reason: "stop",
        },
      },
    })

    expect(turn.runtime.phase).toBe("completed")
    expect(turn.isStreaming).toBe(false)
    expect(turn.state).toBe("stop")
  })

  it("does not regress a settled runtime turn when older lifecycle events arrive late", () => {
    let turn = buildStreamingAssistantTurn("Handle duplicate stream ordering")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-completed",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 3,
        timestamp: 103,
        type: "turn.completed",
        payload: {
          status: "completed",
          finishReason: "stop",
          parts: [{ id: "part-text", type: "text", text: "Done." }],
        },
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-started-late",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 1,
        timestamp: 101,
        type: "turn.started",
        payload: {},
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-preparing-late",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 2,
        timestamp: 102,
        type: "turn.state.changed",
        payload: {
          phase: "preparing",
          reason: "Preparing request",
        },
      },
    })

    expect(turn.runtime.phase).toBe("completed")
    expect(turn.isStreaming).toBe(false)
    expect(turn.items.some((item) => item.kind === "text" && item.text === "Done.")).toBe(true)
  })

  it("keeps late-arriving runtime trace items in backend timestamp order", () => {
    let turn = buildStreamingAssistantTurn("Create tasks before spawning agents")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-later-text",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 10,
        timestamp: 300,
        type: "text.part.delta",
        payload: {
          messageID: "message-spawn",
          partID: "part-spawn-text",
          kind: "text",
          delta: "Now I will start the child agents.",
          text: "Now I will start the child agents.",
        },
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-later-tool",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 11,
        timestamp: 310,
        type: "tool.call.completed",
        payload: {
          part: {
            id: "part-spawn-tool",
            sessionID: "session-runtime",
            messageID: "message-spawn",
            type: "tool",
            callID: "call-spawn",
            tool: "spawn_subagent",
            state: {
              status: "completed",
              input: {},
              output: "spawned",
              time: { start: 310, end: 320 },
            },
          },
        },
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-earlier-text-late",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 5,
        timestamp: 100,
        type: "text.part.delta",
        payload: {
          messageID: "message-task",
          partID: "part-task-text",
          kind: "text",
          delta: "I will create the task list first.",
          text: "I will create the task list first.",
        },
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-earlier-tool-late",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 6,
        timestamp: 110,
        type: "tool.call.completed",
        payload: {
          part: {
            id: "part-task-tool",
            sessionID: "session-runtime",
            messageID: "message-task",
            type: "tool",
            callID: "call-task-create",
            tool: "task_create",
            state: {
              status: "completed",
              input: {},
              output: "created",
              time: { start: 110, end: 120 },
            },
          },
        },
      },
    })

    const renderedTrace = turn.items
      .filter((item) => item.kind === "text" || item.kind === "tool")
      .map((item) => item.kind === "tool" ? item.title : item.text)

    expect(renderedTrace).toEqual([
      "I will create the task list first.",
      "task_create",
      "Now I will start the child agents.",
      "spawn_subagent",
    ])
  })

  it("does not regress a settled legacy stream when older events arrive late", () => {
    let turn = buildStreamingAssistantTurn("Handle legacy ordering")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "done",
      data: {
        parts: [{ id: "part-text", type: "text", text: "Done." }],
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "started",
      data: {
        sessionID: "session-legacy",
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "delta",
      data: {
        kind: "text",
        partID: "part-text",
        delta: "late",
        text: "late",
      },
    })

    expect(turn.runtime.phase).toBe("completed")
    expect(turn.isStreaming).toBe(false)
    expect(turn.items.some((item) => item.kind === "text" && item.text === "Done.")).toBe(true)
    expect(turn.items.some((item) => item.kind === "text" && item.text === "late")).toBe(false)
  })

  it("preserves canonical runtime phases instead of folding them into reasoning", () => {
    let turn = buildStreamingAssistantTurn("Track phases")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-state-preparing",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 1,
        timestamp: 100,
        type: "turn.state.changed",
        payload: {
          phase: "preparing",
          reason: "Preparing request",
        },
      },
    })

    expect(turn.runtime.phase).toBe("preparing")
    expect(turn.state).toBe("Preparing request")
    expect(turn.isStreaming).toBe(true)

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-state-waiting-llm",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 2,
        timestamp: 101,
        type: "turn.state.changed",
        payload: {
          phase: "waiting_llm",
          reason: "Awaiting the next model stream.",
        },
      },
    })

    expect(turn.runtime.phase).toBe("waiting_llm")
    expect(turn.state).toBe("Awaiting the next model stream.")
    expect(turn.isStreaming).toBe(true)
  })

  it("keeps blocked runtime phase distinct from approval waiting", () => {
    let turn = buildStreamingAssistantTurn("Block generically")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-state-blocked",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 1,
        timestamp: 100,
        type: "turn.state.changed",
        payload: {
          phase: "blocked",
          reason: "Waiting for a user answer.",
        },
      },
    })

    expect(turn.runtime.phase).toBe("blocked")
    expect(turn.state).toBe("Waiting for a user answer.")
    expect(turn.isStreaming).toBe(false)
  })

  it("uses runtime tool events to advance past earlier lifecycle phases when phase events are missing", () => {
    let turn = buildStreamingAssistantTurn("Wait for model")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-state-waiting-llm",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 1,
        timestamp: 100,
        type: "turn.state.changed",
        payload: {
          phase: "waiting_llm",
        },
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-tool-started",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 2,
        timestamp: 101,
        type: "tool.call.started",
        payload: {
          part: {
            id: "tool-runtime",
            type: "tool",
            tool: "shell",
            state: {
              status: "running",
              title: "Run tests",
            },
          },
        },
      },
    })

    expect(turn.runtime.phase).toBe("tool_running")
    expect(turn.state).toBe("Running tools")
    expect(turn.items.some((item) => item.kind === "tool" && item.title === "shell")).toBe(true)
  })

  it("uses llm started events as a model-wait fallback after turn start", () => {
    let turn = buildStreamingAssistantTurn("Wait for model")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-turn-started",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 1,
        timestamp: 100,
        type: "turn.started",
        payload: {},
      },
    })

    expect(turn.runtime.phase).toBe("preparing")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-llm-started",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 2,
        timestamp: 101,
        type: "llm.call.started",
        payload: {
          messageID: "message-runtime",
          providerID: "openai",
          modelID: "gpt-test",
          messageCount: 3,
        },
      },
    })

    expect(turn.runtime.phase).toBe("waiting_llm")
    expect(turn.state).toBe("Waiting for model stream")
  })

  it("uses runtime tool events as a lifecycle fallback before any phase event arrives", () => {
    let turn = buildStreamingAssistantTurn("Run tool")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-tool-fallback",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 1,
        timestamp: 100,
        type: "tool.call.started",
        payload: {
          part: {
            id: "tool-runtime",
            type: "tool",
            tool: "shell",
            state: {
              status: "running",
              title: "Run tests",
            },
          },
        },
      },
    })

    expect(turn.runtime.phase).toBe("tool_running")
    expect(turn.state).toBe("Running tools")
  })

  it("finalizes generic blocked turns without treating them as approval requests", () => {
    let turn = buildStreamingAssistantTurn("Block without approval")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-blocked-complete",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 1,
        timestamp: 100,
        type: "turn.completed",
        payload: {
          status: "blocked",
          finishReason: "user-input",
          parts: [],
        },
      },
    })

    expect(turn.runtime.phase).toBe("blocked")
    expect(turn.state).toBe("Backend response blocked")
    expect(turn.items.some((item) => item.title === "Approval required")).toBe(false)
  })

  it("does not render canonical user prompt parts as assistant response sections", () => {
    let turn = buildStreamingAssistantTurn("User prompt")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-user-part",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 1,
        timestamp: 100,
        type: "part.recorded",
        payload: {
          part: {
            id: "part-user-prompt",
            messageID: "message-user",
            type: "text",
            text: "User prompt",
          },
        },
      },
    })

    expect(turn.items.some((item) => item.kind === "text" && item.text === "User prompt")).toBe(false)
    expect(turn.runtime.phase).toBe("waiting_first_event")
    expect(turn.isStreaming).toBe(true)
  })

  it("surfaces runtime compaction records as visible workflow status", () => {
    let turn = buildStreamingAssistantTurn("Trigger compaction")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-compaction",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 1,
        timestamp: 100,
        type: "part.recorded",
        payload: {
          part: {
            id: "part-compaction",
            messageID: "message-compaction",
            type: "compaction",
            auto: true,
            compactedFromMessageID: "message-oldest",
            compactedToMessageID: "message-boundary",
            summaryVersion: 1,
          },
        },
      },
    })

    const compactionItem = turn.items.find((item) => item.kind === "compaction")
    expect(compactionItem).toMatchObject({
      kind: "compaction",
      title: "Context auto-compacted",
      section: "workflow",
      status: "completed",
    })
    expect(compactionItem?.visibilityKey).toBeUndefined()
    expect(compactionItem?.debugEntries?.some((entry) => entry.label === "compaction.to" && entry.value === "message-boundary")).toBe(true)
    expect(turn.isStreaming).toBe(true)
  })

  it("surfaces the response text while the stream is still running", () => {
    let turn = buildStreamingAssistantTurn("Show live trace")
    expect(turn.runtime.phase).toBe("waiting_first_event")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "delta",
      data: {
        kind: "reasoning",
        partID: "part-reasoning",
        delta: "Planning live update.",
      },
    })
    expect(turn.runtime.phase).toBe("reasoning")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "delta",
      data: {
        kind: "text",
        partID: "part-text",
        delta: "Streaming answer",
      },
    })
    expect(turn.runtime.phase).toBe("responding")

    expect(turn.items.map((item) => item.kind)).toEqual(["system", "reasoning", "text"])
    expect(turn.items[1]?.text).toBe("Planning live update.")
    expect(turn.items[2]).toMatchObject({
      kind: "text",
      text: "Streaming answer",
      isStreaming: true,
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "done",
      data: {
        parts: [{ id: "part-text", type: "text", text: "Streaming answer" }],
      },
    })

    expect(turn.items.map((item) => item.kind)).toEqual(["system", "reasoning", "text", "system"])
    expect(turn.items[2]?.text).toBe("Streaming answer")
    expect(turn.runtime.phase).toBe("completed")
  })

  it("keeps repeated tool updates on the same trace item", () => {
    let turn = buildStreamingAssistantTurn("Run lint")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "part",
      data: {
        part: {
          id: "tool-1",
          type: "tool",
          tool: "eslint",
          state: {
            status: "running",
            title: "Linting workspace",
          },
        },
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "part",
      data: {
        part: {
          id: "tool-1",
          type: "tool",
          tool: "eslint",
          state: {
            status: "completed",
            output: {
              fixed: 3,
            },
          },
        },
      },
    })

    const toolItems = turn.items.filter((item) => item.kind === "tool")
    expect(toolItems).toHaveLength(1)
    expect(toolItems[0]?.status).toBe("completed")
    expect(toolItems[0]?.toolOutputText).toContain("\"fixed\": 3")
    expect(toolItems[0]?.text).toContain("\"fixed\": 3")
  })

  it("renders unanswered ask-user-question tools as question prompts", () => {
    let turn = buildStreamingAssistantTurn("Ask a question")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "part",
      data: {
        part: {
          id: "tool-question",
          type: "tool",
          tool: "AskUserQuestion",
          state: {
            status: "completed",
            metadata: {
              kind: "ask-user-question",
              questionID: "que_target",
              header: "Deploy target",
              question: "Where should I deploy?",
              options: [{ label: "Vercel", value: "vercel" }],
              allowFreeform: true,
              multiple: false,
              required: true,
            },
          },
        },
      },
    })

    const questionItems = turn.items.filter((item) => item.kind === "question")
    expect(questionItems).toHaveLength(1)
    expect(questionItems[0]?.questionPrompt?.questionID).toBe("que_target")
  })

  it("renders answered ask-user-question tools as normal tool trace items", () => {
    let turn = buildStreamingAssistantTurn("Answer a question")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "part",
      data: {
        part: {
          id: "tool-question",
          type: "tool",
          tool: "AskUserQuestion",
          state: {
            status: "completed",
            output: "Question answered.",
            metadata: {
              kind: "ask-user-question",
              questionID: "que_target",
              header: "Deploy target",
              question: "Where should I deploy?",
              options: [{ label: "Vercel", value: "vercel" }],
              allowFreeform: true,
              multiple: false,
              required: true,
              answered: true,
              answerText: "vercel",
              selectedOptions: ["vercel"],
            },
          },
        },
      },
    })

    expect(turn.items.some((item) => item.kind === "question")).toBe(false)
    const toolItems = turn.items.filter((item) => item.kind === "tool")
    expect(toolItems).toHaveLength(1)
    expect(toolItems[0]).toMatchObject({
      kind: "tool",
      title: "AskUserQuestion",
      text: "Question answered.",
    })
  })

  it("preserves the full completed tool output for disclosure views", () => {
    const longOutput = `${"tool output line ".repeat(24)}tail-marker`

    let turn = buildStreamingAssistantTurn("Inspect long tool output")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "part",
      data: {
        part: {
          id: "tool-long-output",
          type: "tool",
          tool: "shell",
          state: {
            status: "completed",
            output: longOutput,
          },
        },
      },
    })

    const toolItems = turn.items.filter((item) => item.kind === "tool")
    expect(toolItems).toHaveLength(1)
    expect(toolItems[0]?.toolOutputText).toBe(longOutput)
    expect(toolItems[0]?.text).toBe(longOutput)
    expect(toolItems[0]?.toolOutputText).toContain("tail-marker")
    expect(toolItems[0]?.toolOutputText?.endsWith("...")).toBe(false)
  })

  it("captures completed tool inputs separately from outputs", () => {
    let turn = buildStreamingAssistantTurn("Inspect tool payloads")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "part",
      data: {
        part: {
          id: "tool-with-inputs",
          type: "tool",
          tool: "replace-text",
          state: {
            status: "completed",
            input: {
              file_path: "notes.txt",
              old_string: "old-marker",
              new_string: "input-marker",
            },
            output: "output-marker",
            title: "Updated notes.txt",
          },
        },
      },
    })

    const toolItems = turn.items.filter((item) => item.kind === "tool")
    expect(toolItems).toHaveLength(1)
    expect(toolItems[0]?.toolInputText).toContain("\"file_path\": \"notes.txt\"")
    expect(toolItems[0]?.toolInputText).toContain("\"new_string\": \"input-marker\"")
    expect(toolItems[0]?.toolOutputText).toBe("output-marker")
    expect(toolItems[0]?.detail).toBe("Updated notes.txt")
  })

  it("preserves the full streamed tool input while the call is running", () => {
    const longRawInput = `${"streamed input line\n".repeat(40)}tail-input-marker`

    let turn = buildStreamingAssistantTurn("Inspect streamed tool payloads")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "part",
      data: {
        part: {
          id: "tool-streaming-input",
          type: "tool",
          tool: "shell",
          state: {
            status: "running",
            raw: longRawInput,
          },
        },
      },
    })

    const toolItems = turn.items.filter((item) => item.kind === "tool")
    expect(toolItems).toHaveLength(1)
    expect(toolItems[0]?.toolInputText).toBe(longRawInput)
    expect(toolItems[0]?.toolInputText).toContain("tail-input-marker")
    expect(toolItems[0]?.toolInputText?.endsWith("...")).toBe(false)
  })

  it("renders runtime tool input deltas without waiting for a full pending tool event", () => {
    let turn = buildStreamingAssistantTurn("Inspect live tool input")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-tool-input-1",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 1,
        timestamp: 100,
        type: "tool.input.delta",
        payload: {
          messageID: "message-runtime",
          partID: "tool-input-part",
          toolCallID: "call-live-input",
          toolName: "write",
          delta: "{\"path\"",
          rawLength: 7,
        },
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-tool-input-2",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 2,
        timestamp: 101,
        type: "tool.input.delta",
        payload: {
          messageID: "message-runtime",
          partID: "tool-input-part",
          toolCallID: "call-live-input",
          toolName: "write",
          delta: ":\"README.md\"}",
          rawLength: 20,
        },
      },
    })

    const toolItems = turn.items.filter((item) => item.kind === "tool")
    expect(toolItems).toHaveLength(1)
    expect(turn.runtime.phase).toBe("tool_running")
    expect(turn.state).toBe("Preparing tool call")
    expect(toolItems[0]).toMatchObject({
      kind: "tool",
      title: "write",
      status: "pending",
      sourceID: "tool-input-part",
      toolCallID: "call-live-input",
      toolInputText: "{\"path\":\"README.md\"}",
      text: "{\"path\":\"README.md\"}",
      isStreaming: true,
    })
  })

  it("reconciles streamed tool input with a completed part by tool call id", () => {
    let turn = buildStreamingAssistantTurn("Create tasks")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-task-input",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 1,
        timestamp: 200,
        type: "tool.input.delta",
        payload: {
          messageID: "message-runtime",
          partID: "stream-task-create",
          toolCallID: "call-task-create",
          toolName: "task_create",
          delta: "{\"tasks\":[{\"subject\":\"Implement\"}]}",
          rawLength: 37,
        },
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-task-completed",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 2,
        timestamp: 220,
        type: "tool.call.completed",
        payload: {
          part: {
            id: "recorded-task-create",
            sessionID: "session-runtime",
            messageID: "message-runtime",
            type: "tool",
            callID: "call-task-create",
            tool: "task_create",
            state: {
              status: "completed",
              input: { tasks: [{ subject: "Implement" }] },
              output: "Tasks created",
              title: "Tasks created",
              time: { start: 180, end: 220 },
            },
          },
        },
      },
    })

    const toolItems = turn.items.filter((item) => item.kind === "tool")
    expect(toolItems).toHaveLength(1)
    expect(toolItems[0]).toMatchObject({
      id: "stream-task-create",
      sourceID: "recorded-task-create",
      partID: "recorded-task-create",
      toolCallID: "call-task-create",
      status: "completed",
      toolOutputText: "Tasks created",
    })
  })

  it("previews streamed apply_patch input inside the tool trace item", () => {
    const fullInput = JSON.stringify({
      patch: [
        "*** Begin Patch",
        "*** Update File: src/app.ts",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
      ].join("\n"),
    })
    const splitIndex = fullInput.indexOf("+new")
    let turn = buildStreamingAssistantTurn("Preview live patch input")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-patch-input-1",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 1,
        timestamp: 100,
        type: "tool.input.delta",
        payload: {
          messageID: "message-runtime",
          partID: "tool-input-patch",
          toolCallID: "call-live-patch",
          toolName: "apply_patch",
          delta: fullInput.slice(0, splitIndex),
          rawLength: splitIndex,
        },
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-patch-input-2",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 2,
        timestamp: 101,
        type: "tool.input.delta",
        payload: {
          messageID: "message-runtime",
          partID: "tool-input-patch",
          toolCallID: "call-live-patch",
          toolName: "apply_patch",
          delta: fullInput.slice(splitIndex),
          rawLength: fullInput.length,
        },
      },
    })

    const toolItems = turn.items.filter((item) => item.kind === "tool")
    expect(toolItems).toHaveLength(1)
    expect(turn.items.filter((item) => item.kind === "patch")).toHaveLength(0)
    expect(toolItems[0]).toMatchObject({
      kind: "tool",
      title: "apply_patch",
      sourceID: "tool-input-patch",
      status: "pending",
      toolCallID: "call-live-patch",
      draftPatch: {
        status: "running",
        fileChanges: [
          expect.objectContaining({
            additions: 1,
            deletions: 1,
            file: "src/app.ts",
            previewState: "complete",
          }),
        ],
      },
    })
    expect(toolItems[0]?.draftPatch?.fileChanges?.[0]?.previewHunks?.[0]?.rows).toEqual([
      { content: "old", tone: "remove" },
      { content: "new", tone: "add" },
    ])
  })

  it("previews streamed apply_patch input when the provider streams a top-level JSON string", () => {
    const fullInput = JSON.stringify([
      "*** Begin Patch",
      "*** Add File: src/freeform.ts",
      "+hello",
      "*** End Patch",
    ].join("\n"))
    const splitIndex = fullInput.indexOf("+hello")
    let turn = buildStreamingAssistantTurn("Preview freeform patch input")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-freeform-patch-input-1",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 1,
        timestamp: 100,
        type: "tool.input.delta",
        payload: {
          messageID: "message-runtime",
          partID: "tool-input-patch",
          toolCallID: "call-freeform-patch",
          toolName: "apply_patch",
          delta: fullInput.slice(0, splitIndex),
          rawLength: splitIndex,
        },
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-freeform-patch-input-2",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 2,
        timestamp: 101,
        type: "tool.input.delta",
        payload: {
          messageID: "message-runtime",
          partID: "tool-input-patch",
          toolCallID: "call-freeform-patch",
          toolName: "apply_patch",
          delta: fullInput.slice(splitIndex),
          rawLength: fullInput.length,
        },
      },
    })

    const toolItems = turn.items.filter((item) => item.kind === "tool")
    expect(toolItems).toHaveLength(1)
    expect(turn.items.filter((item) => item.kind === "patch")).toHaveLength(0)
    expect(toolItems[0]?.draftPatch).toMatchObject({
      fileChanges: [
        expect.objectContaining({
          additions: 1,
          file: "src/freeform.ts",
          previewState: "complete",
        }),
      ],
    })
  })

  it("previews apply_patch raw input from tool lifecycle events when input deltas are unavailable", () => {
    const rawInput = JSON.stringify({
      patch: [
        "*** Begin Patch",
        "*** Add File: src/lifecycle.ts",
        "+hello",
        "*** End Patch",
      ].join("\n"),
    })
    let turn = buildStreamingAssistantTurn("Preview lifecycle patch input")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-patch-started",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 1,
        timestamp: 100,
        type: "tool.call.started",
        payload: {
          part: {
            id: "tool-lifecycle-patch",
            type: "tool",
            tool: "apply_patch",
            callID: "call-lifecycle-patch",
            state: {
              status: "running",
              raw: rawInput,
            },
          },
        },
      },
    })

    const toolItems = turn.items.filter((item) => item.kind === "tool")
    expect(toolItems).toHaveLength(1)
    expect(turn.items.filter((item) => item.kind === "patch")).toHaveLength(0)
    expect(toolItems[0]).toMatchObject({
      sourceID: "tool-lifecycle-patch",
      status: "running",
      draftPatch: {
        status: "running",
        fileChanges: [
          expect.objectContaining({
            additions: 1,
            file: "src/lifecycle.ts",
            previewState: "complete",
          }),
        ],
      },
    })
  })

  it("keeps streamed draft patch previews on the tool item when the real patch is generated", () => {
    const fullInput = JSON.stringify({
      patch: [
        "*** Begin Patch",
        "*** Update File: src/app.ts",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
      ].join("\n"),
    })
    let turn = buildStreamingAssistantTurn("Replace live patch input")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-patch-input",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 1,
        timestamp: 100,
        type: "tool.input.delta",
        payload: {
          messageID: "message-runtime",
          partID: "tool-input-patch",
          toolCallID: "call-live-patch",
          toolName: "apply_patch",
          delta: fullInput,
          rawLength: fullInput.length,
        },
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-patch-generated",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 2,
        timestamp: 101,
        type: "patch.generated",
        payload: {
          part: {
            id: "patch-real",
            type: "patch",
            scope: "model-call",
            files: ["src/app.ts"],
            summary: {
              files: 1,
              additions: 1,
              deletions: 1,
            },
            changes: [
              {
                file: "src/app.ts",
                additions: 1,
                deletions: 1,
                patch: "@@ -1 +1 @@\n-old\n+new",
              },
            ],
          },
        },
      },
    })

    const patchItems = turn.items.filter((item) => item.kind === "patch")
    expect(patchItems).toHaveLength(1)
    expect(patchItems[0]).toMatchObject({
      kind: "patch",
      label: "Model call",
      sourceID: "patch-real",
      status: "completed",
      fileChanges: [
        expect.objectContaining({
          file: "src/app.ts",
          patch: "@@ -1 +1 @@\n-old\n+new",
        }),
      ],
    })
    const toolItems = turn.items.filter((item) => item.kind === "tool")
    expect(toolItems).toHaveLength(1)
    expect(toolItems[0]?.draftPatch).toMatchObject({
      fileChanges: [
        expect.objectContaining({
          additions: 1,
          deletions: 1,
          file: "src/app.ts",
        }),
      ],
    })
  })

  it("marks streamed draft patch previews as failed when apply_patch fails without a real patch", () => {
    const fullInput = JSON.stringify({
      patch: [
        "*** Begin Patch",
        "*** Update File: src/app.ts",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
      ].join("\n"),
    })
    let turn = buildStreamingAssistantTurn("Fail live patch input")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-patch-input",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 1,
        timestamp: 100,
        type: "tool.input.delta",
        payload: {
          messageID: "message-runtime",
          partID: "tool-input-patch",
          toolCallID: "call-live-patch",
          toolName: "apply_patch",
          delta: fullInput,
          rawLength: fullInput.length,
        },
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-patch-failed",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 2,
        timestamp: 101,
        type: "tool.call.failed",
        payload: {
          part: {
            id: "tool-input-patch",
            type: "tool",
            tool: "apply_patch",
            callID: "call-live-patch",
            state: {
              status: "error",
              input: { patch: "..." },
              error: "Patch failed",
            },
          },
        },
      },
    })

    const toolItems = turn.items.filter((item) => item.kind === "tool")
    expect(toolItems).toHaveLength(1)
    expect(turn.items.filter((item) => item.kind === "patch")).toHaveLength(0)
    expect(toolItems[0]).toMatchObject({
      sourceID: "tool-input-patch",
      status: "error",
      isStreaming: false,
      draftPatch: {
        status: "error",
        isStreaming: false,
      },
    })
  })

  it("marks streamed draft patch previews as cancelled when apply_patch is cancelled", () => {
    const fullInput = JSON.stringify({
      patch: [
        "*** Begin Patch",
        "*** Update File: src/app.ts",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
      ].join("\n"),
    })
    let turn = buildStreamingAssistantTurn("Cancel live patch input")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-patch-input",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 1,
        timestamp: 100,
        type: "tool.input.delta",
        payload: {
          messageID: "message-runtime",
          partID: "tool-input-patch",
          toolCallID: "call-live-patch",
          toolName: "apply_patch",
          delta: fullInput,
          rawLength: fullInput.length,
        },
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-patch-cancelled",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 2,
        timestamp: 101,
        type: "tool.call.cancelled",
        payload: {
          part: {
            id: "tool-input-patch",
            type: "tool",
            tool: "apply_patch",
            callID: "call-live-patch",
            state: {
              status: "cancelled",
              input: { patch: "..." },
              raw: fullInput,
              reason: "Prompt cancellation requested.",
            },
          },
        },
      },
    })

    const toolItems = turn.items.filter((item) => item.kind === "tool")
    expect(toolItems).toHaveLength(1)
    expect(turn.items.filter((item) => item.kind === "patch")).toHaveLength(0)
    expect(toolItems[0]).toMatchObject({
      sourceID: "tool-input-patch",
      status: "cancelled",
      isStreaming: false,
      draftPatch: {
        status: "cancelled",
        isStreaming: false,
      },
    })
  })

  it("marks unfinished streamed tool input as cancelled when the turn is interrupted", () => {
    let turn = buildStreamingAssistantTurn("Inspect live tool input")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-tool-input-1",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 1,
        timestamp: 100,
        type: "tool.input.delta",
        payload: {
          messageID: "message-runtime",
          partID: "tool-input-part",
          toolCallID: "call-live-input",
          toolName: "replace-text",
          delta: "{\"path\":\"game.ts\"",
          rawLength: 17,
        },
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-cancelled",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 2,
        timestamp: 101,
        type: "turn.cancelled",
        payload: {
          reason: "user",
          detail: "Prompt cancellation requested.",
        },
      },
    })

    const toolItems = turn.items.filter((item) => item.kind === "tool")
    expect(toolItems).toHaveLength(1)
    expect(turn.runtime.phase).toBe("cancelled")
    expect(toolItems[0]).toMatchObject({
      kind: "tool",
      title: "replace-text",
      status: "cancelled",
      sourceID: "tool-input-part",
      toolCallID: "call-live-input",
      toolInputText: "{\"path\":\"game.ts\"",
      isStreaming: false,
    })
    expect(turn.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "system",
          title: "Turn cancelled",
        }),
      ]),
    )
  })

  it("keeps cancelled streamed tool input when a late failed part arrives", () => {
    let turn = buildStreamingAssistantTurn("Inspect live tool input")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-tool-input-1",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 1,
        timestamp: 100,
        type: "tool.input.delta",
        payload: {
          messageID: "message-runtime",
          partID: "tool-input-part",
          toolCallID: "call-live-input",
          toolName: "replace-text",
          delta: "{\"path\":\"game.ts\"",
          rawLength: 17,
        },
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-cancelled",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 2,
        timestamp: 101,
        type: "turn.cancelled",
        payload: {
          reason: "user",
          detail: "Prompt cancellation requested.",
        },
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-late-failed",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 3,
        timestamp: 102,
        type: "tool.call.failed",
        payload: {
          part: {
            id: "tool-input-part",
            type: "tool",
            tool: "replace-text",
            callID: "call-live-input",
            state: {
              status: "error",
              input: { path: "game.ts" },
              error: "Late failure should not replace cancellation.",
            },
          },
        },
      },
    })

    const toolItems = turn.items.filter((item) => item.kind === "tool")
    expect(toolItems).toHaveLength(1)
    expect(turn.runtime.phase).toBe("cancelled")
    expect(toolItems[0]).toMatchObject({
      kind: "tool",
      title: "replace-text",
      status: "cancelled",
      sourceID: "tool-input-part",
      toolCallID: "call-live-input",
      isStreaming: false,
    })
  })

  it("keeps late batched tool input cancelled after a local interrupt marker", () => {
    let turn = buildStreamingAssistantTurn("Inspect live tool input")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-cancelled",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 1,
        timestamp: 100,
        type: "turn.cancelled",
        payload: {
          reason: "user",
          detail: "Prompt cancellation requested.",
        },
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-late-tool-input",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 2,
        timestamp: 101,
        type: "tool.input.delta",
        payload: {
          messageID: "message-runtime",
          partID: "tool-input-part",
          toolCallID: "call-live-input",
          toolName: "AskUserQuestion",
          delta: "{}",
          rawLength: 2,
        },
      },
    })

    expect(turn.runtime.phase).toBe("cancelled")
    expect(turn.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool",
          title: "AskUserQuestion",
          status: "cancelled",
          toolInputText: "{}",
          isStreaming: false,
        }),
      ]),
    )
  })

  it("restores cancelled tool history without leaving pending tool traces active", () => {
    const turns = buildTurnsFromHistory([
      {
        info: {
          id: "assistant-cancelled",
          sessionID: "session-runtime",
          role: "assistant",
          created: 100,
          completed: 110,
          finishReason: "cancelled",
        },
        parts: [
          {
            id: "tool-part",
            type: "tool",
            tool: "replace-text",
            callID: "tool-call",
            state: {
              status: "pending",
              raw: "{}",
            },
          },
        ],
      },
    ])

    expect(turns).toHaveLength(1)
    const turn = turns[0]
    expect(turn).toMatchObject({
      kind: "assistant",
      runtime: {
        phase: "cancelled",
      },
      isStreaming: false,
    })
    expect(turn?.kind === "assistant" ? turn.items : []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool",
          status: "cancelled",
          isStreaming: false,
        }),
        expect.objectContaining({
          kind: "system",
          title: "Turn cancelled",
        }),
      ]),
    )
  })

  it("restores cancelled assistant turns as cancelled even when an abort error was persisted", () => {
    const turns = buildTurnsFromHistory([
      {
        info: {
          id: "assistant-cancelled-with-error",
          sessionID: "session-runtime",
          role: "assistant",
          created: 100,
          completed: 110,
          error: {
            name: "UnknownError",
            data: {
              message: "Prompt aborted",
            },
          },
        },
        parts: [
          {
            id: "tool-part",
            type: "tool",
            tool: "apply_patch",
            callID: "tool-call",
            state: {
              status: "pending",
              raw: "{}",
            },
          },
        ],
        turn: {
          id: "turn-cancelled-with-error",
          sessionID: "session-runtime",
          projectID: "project-1",
          status: "cancelled",
          phase: "cancelled",
          lastMessageID: "assistant-cancelled-with-error",
          error: "Prompt aborted",
          createdAt: 100,
          updatedAt: 110,
          completedAt: 110,
        },
      },
    ])

    expect(turns).toHaveLength(1)
    const turn = turns[0]
    expect(turn).toMatchObject({
      kind: "assistant",
      state: "Backend stream cancelled",
      runtime: {
        phase: "cancelled",
      },
      isStreaming: false,
    })
    expect(turn?.kind === "assistant" ? turn.items : []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool",
          title: "apply_patch",
          status: "cancelled",
          isStreaming: false,
        }),
        expect.objectContaining({
          kind: "system",
          title: "Turn cancelled",
        }),
      ]),
    )
    expect(turn?.kind === "assistant" ? turn.items.some((item) => item.kind === "error") : true).toBe(false)
  })

  it("keeps streamed reasoning visible when a sparse completion event is followed by tool input", () => {
    let turn = buildStreamingAssistantTurn("Inspect live reasoning before tools")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-reasoning-delta",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 1,
        timestamp: 100,
        type: "reasoning.part.delta",
        payload: {
          messageID: "message-runtime",
          partID: "reasoning-part",
          delta: "I will inspect the thread renderer.",
        },
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-reasoning-completed",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 2,
        timestamp: 101,
        type: "reasoning.part.completed",
        payload: {
          part: {
            id: "reasoning-part",
            messageID: "message-runtime",
            type: "reasoning",
          },
        },
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "runtime",
      data: {
        eventID: "event-tool-input",
        sessionID: "session-runtime",
        turnID: "turn-runtime",
        seq: 3,
        timestamp: 102,
        type: "tool.input.delta",
        payload: {
          messageID: "message-runtime",
          partID: "tool-input-part",
          toolCallID: "call-live-input",
          toolName: "shell",
          delta: "{\"command\":\"rg ThreadView\"}",
        },
      },
    })

    expect(turn.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "reasoning",
          sourceID: "reasoning-part",
          text: "I will inspect the thread renderer.",
          isStreaming: false,
        }),
        expect.objectContaining({
          kind: "tool",
          sourceID: "tool-input-part",
          title: "shell",
          toolInputText: "{\"command\":\"rg ThreadView\"}",
        }),
      ]),
    )
    expect(turn.runtime.phase).toBe("tool_running")
  })

  it("derives source and attachment trace items from assistant parts", () => {
    const turns = buildTurnsFromHistory([
      {
        info: {
          id: "msg-assistant-assets",
          sessionID: "session-1",
          role: "assistant",
          created: 40,
          completed: 41,
        },
        parts: [
          {
            id: "part-source-1",
            type: "source-url",
            sourceID: "src-1",
            title: "API reference",
            url: "https://example.com/api",
          },
          {
            id: "part-tool-1",
            type: "tool",
            tool: "generate-report",
            state: {
              status: "completed",
              output: { ok: true },
              attachments: [
                {
                  mime: "image/png",
                  filename: "preview.png",
                  url: "https://example.com/preview.png",
                  metadata: {
                    width: 512,
                    height: 384,
                    prompt: "preview prompt",
                  },
                },
              ],
            },
          },
        ],
      },
    ])

    const assistantItems = turns[0]?.kind === "assistant" ? turns[0].items : []
    expect(assistantItems.map((item) => item.kind)).toEqual(["source", "tool", "image", "system"])
    expect(assistantItems[0]).toMatchObject({
      kind: "source",
      title: "API reference",
      section: "sources",
    })
    expect(assistantItems[2]).toMatchObject({
      kind: "image",
      title: "preview.png",
      src: "https://example.com/preview.png",
      mimeType: "image/png",
      width: 512,
      height: 384,
      alt: "preview prompt",
      section: "file-change",
    })
  })

  it("preserves static patch text on patch trace items", () => {
    const patchText = [
      "diff --git a/src/App.tsx b/src/App.tsx",
      "--- a/src/App.tsx",
      "+++ b/src/App.tsx",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n")
    const turns = buildTurnsFromHistory([
      {
        info: {
          id: "msg-assistant-patch",
          sessionID: "session-1",
          role: "assistant",
          created: 50,
          completed: 51,
        },
        parts: [
          {
            id: "part-patch-1",
            type: "patch",
            scope: "model-call",
            files: ["src/App.tsx"],
            summary: {
              files: 1,
              additions: 1,
              deletions: 1,
            },
            changes: [
              {
                file: "src/App.tsx",
                additions: 1,
                deletions: 1,
                patch: patchText,
              },
            ],
          },
        ],
      },
    ])

    const assistantItems = turns[0]?.kind === "assistant" ? turns[0].items : []
    const patchItem = assistantItems.find((item) => item.kind === "patch")

    expect(patchItem).toMatchObject({
      kind: "patch",
      label: "Model call",
      title: "1 file change (+1 -1)",
      fileChanges: [
        {
          file: "src/App.tsx",
          additions: 1,
          deletions: 1,
          patch: patchText,
        },
      ],
      filePaths: ["src/App.tsx"],
    })
  })

  it("keeps non-contiguous reasoning segments separate around tool events", () => {
    let turn = buildStreamingAssistantTurn("Trace tool execution")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "delta",
      data: {
        kind: "reasoning",
        partID: "reasoning-1",
        delta: "Inspecting workspace.",
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "part",
      data: {
        part: {
          id: "tool-2",
          type: "tool",
          tool: "npm test",
          state: {
            status: "running",
            title: "Executing tests",
          },
        },
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "delta",
      data: {
        kind: "reasoning",
        partID: "reasoning-2",
        delta: "Evaluating test output.",
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "done",
      data: {
        parts: [
          { id: "reasoning-1", type: "reasoning", text: "Inspecting workspace." },
          { id: "tool-2", type: "tool", tool: "npm test", state: { status: "completed", output: "ok" } },
          { id: "reasoning-2", type: "reasoning", text: "Evaluating test output." },
        ],
      },
    })

    expect(turn.items.map((item) => item.kind)).toEqual(["system", "reasoning", "tool", "reasoning", "system"])
    expect(turn.items[1]?.text).toBe("Inspecting workspace.")
    expect(turn.items[3]?.text).toBe("Evaluating test output.")
    expect(turn.items[4]?.title).toBe("Response complete")
  })

  it("updates the original text trace item when the same text part resumes after a tool event", () => {
    let turn = buildStreamingAssistantTurn("Resume text after tool")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "delta",
      data: {
        kind: "text",
        partID: "text-1",
        delta: "First sentence.",
        text: "First sentence.",
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "part",
      data: {
        part: {
          id: "tool-3",
          type: "tool",
          tool: "npm test",
          state: {
            status: "running",
            title: "Executing tests",
          },
        },
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "delta",
      data: {
        kind: "text",
        partID: "text-1",
        delta: " Second sentence.",
        text: "First sentence. Second sentence.",
      },
    })

    const streamingTextItems = turn.items.filter((item) => item.kind === "text")
    expect(streamingTextItems).toHaveLength(1)
    expect(streamingTextItems[0]).toMatchObject({
      text: "First sentence. Second sentence.",
      isStreaming: true,
    })
    expect(turn.items.map((item) => item.kind)).toEqual(["system", "text", "tool"])

    turn = applyAgentStreamEventToTurn(turn, {
      event: "done",
      data: {
        parts: [
          { id: "tool-3", type: "tool", tool: "npm test", state: { status: "completed", output: "ok" } },
          { id: "text-1", type: "text", text: "First sentence. Second sentence." },
        ],
      },
    })

    const textItems = turn.items.filter((item) => item.kind === "text")
    expect(textItems).toHaveLength(1)
    expect(textItems[0]?.text).toBe("First sentence. Second sentence.")
  })

  it("replaces anonymous streamed text with the finalized text part on completion", () => {
    let turn = buildStreamingAssistantTurn("Follow up")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "delta",
      data: {
        kind: "text",
        delta: "Second reply.",
        text: "First reply. Second reply.",
      },
    })

    expect(turn.items.filter((item) => item.kind === "text")).toHaveLength(1)
    expect(turn.items.find((item) => item.kind === "text")).toMatchObject({
      text: "First reply. Second reply.",
      isStreaming: true,
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "done",
      data: {
        parts: [{ id: "text-2", type: "text", text: "Second reply." }],
      },
    })

    const textItems = turn.items.filter((item) => item.kind === "text")
    expect(textItems).toHaveLength(1)
    expect(textItems[0]?.text).toBe("Second reply.")
  })

  it("marks blocked turns as waiting for approval when completion carries a waiting tool", () => {
    let turn = buildStreamingAssistantTurn("Review file access")

    turn = applyAgentStreamEventToTurn(turn, {
      event: "part",
      data: {
        part: {
          id: "tool-waiting",
          type: "tool",
          tool: "read-file",
          state: {
            status: "waiting-approval",
            title: "Read repo config",
          },
        },
      },
    })

    turn = applyAgentStreamEventToTurn(turn, {
      event: "done",
      data: {
        status: "blocked",
        parts: [
          {
            id: "tool-waiting",
            type: "tool",
            tool: "read-file",
            state: {
              status: "waiting-approval",
              title: "Read repo config",
            },
          },
        ],
      },
    })

    expect(turn.state).toBe("Waiting for permission approval")
    expect(turn.runtime.phase).toBe("waiting_approval")
    expect(turn.items.some((item) => item.title === "Approval required")).toBe(true)
  })

  it("rebuilds user and assistant turns from persisted session history", () => {
    const turns = buildTurnsFromHistory([
      {
        info: {
          id: "msg-user-1",
          sessionID: "session-1",
          role: "user",
          created: 10,
          diffSummary: {
            stats: {
              files: 1,
              additions: 2,
              deletions: 1,
            },
            diffs: [
              {
                file: "src/App.tsx",
                additions: 2,
                deletions: 1,
                patch: "@@ -1 +1 @@\n-old\n+new",
              },
            ],
          },
        },
        parts: [{ id: "part-user-1", type: "text", text: "Reload this session" }],
      },
      {
        info: {
          id: "msg-assistant-1",
          sessionID: "session-1",
          role: "assistant",
          created: 11,
          completed: 12,
          diffSummary: {
            stats: {
              files: 1,
              additions: 1,
              deletions: 0,
            },
            diffs: [
              {
                file: "src/result.ts",
                additions: 1,
                deletions: 0,
                patch: "@@ -0,0 +1 @@\n+result",
              },
            ],
          },
        },
        parts: [
          { id: "part-reasoning-1", type: "reasoning", text: "Rebuilding from stored parts." },
          { id: "part-text-1", type: "text", text: "History is back." },
        ],
      },
    ])

    expect(turns).toHaveLength(2)
    expect(turns[0]).toMatchObject({
      id: "msg-user-1",
      kind: "user",
      displayText: "Reload this session",
      text: "Reload this session",
      timestamp: 10,
      diffSummary: {
        stats: {
          files: 1,
          additions: 2,
          deletions: 1,
        },
        diffs: [
          {
            file: "src/App.tsx",
            additions: 2,
            deletions: 1,
            patch: "@@ -1 +1 @@\n-old\n+new",
          },
        ],
      },
    })
    expect(turns[1]).toMatchObject({
      id: "msg-assistant-1",
      messageID: "msg-assistant-1",
      kind: "assistant",
      timestamp: 11,
      state: "Backend response received",
      diffSummary: {
        stats: {
          files: 1,
          additions: 1,
          deletions: 0,
        },
        diffs: [
          {
            file: "src/result.ts",
            additions: 1,
            deletions: 0,
            patch: "@@ -0,0 +1 @@\n+result",
          },
        ],
      },
    })
    expect(turns[1]?.kind === "assistant" ? turns[1].runtime.phase : null).toBe("completed")
    expect(turns[1]?.kind === "assistant" ? turns[1].items.map((item) => item.kind) : []).toEqual(["reasoning", "text", "system"])
  })

  it("restores internal compaction history as a status marker without leaking summary text", () => {
    const turns = buildTurnsFromHistory([
      {
        info: {
          id: "msg-user-1",
          sessionID: "session-1",
          role: "user",
          created: 10,
        },
        parts: [{ id: "part-user-1", type: "text", text: "Keep going" }],
      },
      {
        info: {
          id: "msg-compaction",
          sessionID: "session-1",
          role: "user",
          created: 11,
          internal: true,
          agent: "compaction",
        },
        parts: [
          {
            id: "part-compacted-history",
            type: "text",
            text: "<compacted_history>\nSecret compacted summary\n</compacted_history>",
            metadata: {
              kind: "compacted-history",
            },
          },
          {
            id: "part-compaction",
            type: "compaction",
            auto: true,
            compactedFromMessageID: "msg-user-1",
            compactedToMessageID: "msg-assistant-old",
            summaryVersion: 1,
          },
        ],
      },
      {
        info: {
          id: "msg-assistant-1",
          sessionID: "session-1",
          role: "assistant",
          created: 12,
          completed: 13,
        },
        parts: [{ id: "part-text-1", type: "text", text: "Continuing after compaction." }],
      },
    ])

    expect(turns).toHaveLength(2)
    expect(turns[0]).toMatchObject({
      id: "msg-user-1",
      kind: "user",
      text: "Keep going",
    })

    const assistantTurn = turns[1]
    expect(assistantTurn?.kind).toBe("assistant")
    if (assistantTurn?.kind !== "assistant") return

    expect(assistantTurn.items.map((item) => item.kind)).toEqual(["compaction", "text", "system"])
    expect(assistantTurn.items[0]).toMatchObject({
      kind: "compaction",
      title: "Context auto-compacted",
    })
    expect(JSON.stringify(turns)).not.toContain("Secret compacted summary")
    expect(JSON.stringify(turns)).not.toContain("<compacted_history>")
  })

  it("restores referenced file tags from persisted user history", () => {
    const absolutePath = "C:\\Projects\\Atlas\\frontend\\src\\angry-birds.js"
    const turns = buildTurnsFromHistory([
      {
        info: {
          id: "msg-user-file-reference",
          sessionID: "session-1",
          role: "user",
          created: 20,
        },
        parts: [{
          id: "part-user-file-reference",
          type: "text",
          text: `@src/angry-birds.js\n\nReferenced files:\n- ${absolutePath}`,
        }],
      },
    ])

    expect(turns[0]).toMatchObject({
      id: "msg-user-file-reference",
      kind: "user",
      displayText: "@src/angry-birds.js",
      timestamp: 20,
      references: [
        {
          id: `file:${absolutePath}`,
          kind: "file",
          label: "src/angry-birds.js",
          title: absolutePath,
        },
      ],
    })
    expect(turns[0]?.kind === "user" ? turns[0].text : "").toContain("References: src/angry-birds.js")
    expect(turns[0]?.kind === "user" ? turns[0].displayText : "").not.toContain("Referenced files:")
  })

  it("keeps backend-only history parts as hidden system trace items with debug metadata", () => {
    const turns = buildTurnsFromHistory([
      {
        info: {
          id: "msg-assistant-debug",
          sessionID: "session-1",
          role: "assistant",
          created: 30,
          completed: 31,
        },
        parts: [
          {
            id: "part-permission-1",
            sessionID: "session-1",
            messageID: "msg-assistant-debug",
            type: "permission",
            approvalID: "approval-1",
            toolCallID: "toolcall-1",
            tool: "read-file",
            action: "ask",
            created: 30,
          },
          {
            id: "part-text-1",
            sessionID: "session-1",
            messageID: "msg-assistant-debug",
            type: "text",
            text: "History is back.",
          },
        ],
      },
    ])

    expect(turns).toHaveLength(1)
    expect(turns[0]?.kind === "assistant" ? turns[0].items.map((item) => item.kind) : []).toEqual(["system", "text", "system"])

    const permissionItem = turns[0]?.kind === "assistant"
      ? turns[0].items.find((item) => item.title === "Permission requested")
      : null
    const responseItem = turns[0]?.kind === "assistant"
      ? turns[0].items.find((item) => item.kind === "text")
      : null

    expect(permissionItem).toMatchObject({
      kind: "system",
      label: "Permission",
      status: "pending",
    })
    expect(permissionItem?.debugEntries?.some((entry) => entry.label === "approval.id" && entry.value === "approval-1")).toBe(true)
    expect(responseItem?.debugEntries?.some((entry) => entry.label === "part.id" && entry.value === "part-text-1")).toBe(true)
  })

  it("summarizes user attachments when the persisted turn has no text content", () => {
    const turns = buildTurnsFromHistory([
      {
        info: {
          id: "msg-user-attachments",
          sessionID: "session-1",
          role: "user",
          created: 15,
        },
        parts: [
          { id: "part-image-1", type: "image", filename: "hero.png", mime: "image/png", url: "data:image/png;base64,abc" },
          { id: "part-file-1", type: "file", filename: "brief.pdf", mime: "application/pdf", url: "data:application/pdf;base64,xyz" },
        ],
      },
    ])

    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({
      id: "msg-user-attachments",
      kind: "user",
      text: "Sent 2 attachments: hero.png, brief.pdf",
      timestamp: 15,
    })
    expect(turns[0]?.kind === "user" ? turns[0].attachments : null).toEqual([
      { name: "hero.png" },
      { name: "brief.pdf" },
    ])
  })

  it("includes attachment names when optimistic user text is built locally", () => {
    expect(
      buildUserTurnText({
        text: "Review these references",
        attachmentNames: ["hero.png", "brief.pdf"],
      }),
    ).toBe("Review these references\n\nAttachments: hero.png, brief.pdf")
  })

  it("keeps file references as structured metadata on optimistic user turns", () => {
    const turn = buildUserTurn({
      displayText: "@src/angry-birds.js",
      references: [
        {
          id: "file:C:\\Projects\\Atlas\\frontend\\src\\angry-birds.js",
          kind: "file",
          label: "src/angry-birds.js",
          title: "C:\\Projects\\Atlas\\frontend\\src\\angry-birds.js",
        },
      ],
      timestamp: 30,
    })

    expect(turn).toMatchObject({
      kind: "user",
      displayText: "@src/angry-birds.js",
      timestamp: 30,
      references: [
        {
          id: "file:C:\\Projects\\Atlas\\frontend\\src\\angry-birds.js",
          label: "src/angry-birds.js",
          title: "C:\\Projects\\Atlas\\frontend\\src\\angry-birds.js",
        },
      ],
    })
    expect(turn.text).toContain("References: src/angry-birds.js")
  })

  it("summarizes structured references without expanding their prompt text", () => {
    expect(
      buildUserTurnText({
        referenceLabels: ["focus-files.tsx:L2-L3"],
      }),
    ).toBe("Sent reference: focus-files.tsx:L2-L3")
  })

  it("adds an error trace when the persisted assistant turn failed", () => {
    const turns = buildTurnsFromHistory([
      {
        info: {
          id: "msg-assistant-error",
          sessionID: "session-1",
          role: "assistant",
          created: 20,
          error: {
            message: "Backend stream failed",
          },
        },
        parts: [],
      },
    ])

    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({
      id: "msg-assistant-error",
      kind: "assistant",
      state: "Backend request failed",
    })
    expect(turns[0]?.kind === "assistant" ? turns[0].runtime.phase : null).toBe("failed")
    expect(turns[0]?.kind === "assistant" ? turns[0].items.map((item) => item.kind) : []).toEqual(["error"])
  })

  it("labels assistant-level tool argument validation failures distinctly", () => {
    const turns = buildTurnsFromHistory([
      {
        info: {
          id: "msg-assistant-tool-args-error",
          sessionID: "session-1",
          role: "assistant",
          created: 20,
          error: {
            message: "Tool argument validation failed: Invalid input: expected record, received string",
          },
        },
        parts: [],
      },
    ])

    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({
      id: "msg-assistant-tool-args-error",
      kind: "assistant",
      state: "Tool argument validation failed",
    })
    expect(turns[0]?.kind === "assistant" ? turns[0].items[0] : null).toMatchObject({
      kind: "error",
      title: "Tool argument validation failed",
      detail: "Tool argument validation failed: Invalid input: expected record, received string",
    })
  })

  it("restores failed assistant turns from turn outcome error info", () => {
    const turns = buildTurnsFromHistory([
      {
        info: {
          id: "msg-assistant-api-error",
          sessionID: "session-1",
          role: "assistant",
          created: 20,
          error: {
            name: "APIError",
            data: {
              message: "Internal server error",
              metadata: {
                sourceName: "AI_APICallError",
              },
            },
          },
        },
        parts: [],
        turn: {
          id: "turn-api-error",
          sessionID: "session-1",
          projectID: "project-1",
          status: "failed",
          phase: "failed",
          lastMessageID: "msg-assistant-api-error",
          error: "Internal server error",
          errorInfo: {
            name: "AI_APICallError",
            message: "Internal server error",
            statusCode: 500,
            retryable: false,
            providerID: "anybox",
            modelID: "deepseek-chat",
          },
          createdAt: 10,
          updatedAt: 30,
          completedAt: 30,
        },
      },
    ])

    expect(turns).toHaveLength(1)
    expect(turns[0]?.kind === "assistant" ? turns[0].runtime.phase : null).toBe("failed")
    expect(turns[0]?.kind === "assistant" ? turns[0].items[0] : null).toMatchObject({
      kind: "error",
      title: "Backend request failed: AI_APICallError",
      detail: "Internal server error",
    })
  })
})
