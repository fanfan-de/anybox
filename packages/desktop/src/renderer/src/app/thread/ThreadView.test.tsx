import { createRef, type ComponentProps } from "react"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { DEFAULT_ASSISTANT_TRACE_VISIBILITY, type AssistantTraceItem, type AssistantTraceItemKind, type AssistantThreadMessage, type PermissionRequest, type SessionSummary, type ThreadMessage, type ThreadTurn, type UserThreadMessage } from "../types"
import type { SessionMessageTree } from "../session-message-tree"
import { SIDEBAR_RESIZE_END_EVENT } from "../sidebar-resize-events"
import { I18nProvider } from "../i18n/I18nProvider"
import { formatThreadExecutionDuration, ThreadView } from "./ThreadView"
import { createThreadPresentationStore } from "./thread-presentation-store"

const session: SessionSummary = {
  id: "session-1",
  title: "Session",
  branch: "main",
  status: "Live",
  updated: 1,
  focus: "",
  summary: "",
}

const sessionB: SessionSummary = {
  ...session,
  id: "session-2",
  title: "Session 2",
}

function assistantMessage(id: string, text: string): AssistantThreadMessage {
  return {
    id,
    kind: "assistant",
    backendTurnID: `turn-${id}`,
    segmentID: id,
    timestamp: 1,
    runtime: {
      phase: "responding",
      startedAt: 1,
      updatedAt: 1,
    },
    state: "responding",
    items: [
      {
        id: `${id}-text`,
        kind: "text",
        timestamp: 1,
        label: "Assistant",
        text,
        status: "running",
      },
    ],
    isStreaming: true,
  }
}

function assistantTraceMessage(
  id: string,
  items: AssistantTraceItem[],
  isStreaming: boolean,
  backendTurnID = `turn-${id}`,
): AssistantThreadMessage {
  return {
    id,
    kind: "assistant",
    backendTurnID,
    segmentID: id,
    timestamp: 1,
    runtime: {
      phase: isStreaming ? "responding" : "completed",
      startedAt: 1,
      updatedAt: 1,
    },
    state: isStreaming ? "responding" : "completed",
    items,
    isStreaming,
  }
}

function userMessage(id: string, text: string): UserThreadMessage {
  return {
    id,
    kind: "user",
    text,
    timestamp: 1,
  }
}

function threadTurn(
  turnID: string,
  user: UserThreadMessage,
  messages: ThreadMessage[] = [user],
  overrides: Partial<ThreadTurn> = {},
): ThreadTurn {
  return {
    turnID,
    status: "completed",
    startedAt: user.timestamp,
    updatedAt: user.timestamp,
    userMessageID: user.id,
    messages,
    ...overrides,
  }
}

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
      title: "Check Node.js and npm availability",
      summary: "Run a Git Bash command in C:/Projects/Anybox.",
      rationale: "Tool requires approval before it can continue.",
      risk: "high",
      detailsAvailable: true,
      details: {
        command: "node --version && npm --version",
        workdir: "C:/Projects/Anybox",
        paths: ["C:/Projects/Anybox"],
      },
      allowedDecisions: ["deny", "allow"],
      recommendedDecision: "allow",
    },
    ...overrides,
  }
}

function approvalTraceMessageForRequest(
  request: PermissionRequest,
  overrides: Partial<AssistantTraceItem> = {},
): AssistantThreadMessage {
  return assistantTraceMessage(
    "assistant-approval",
    [
      {
        id: "approval-requested",
        kind: "system",
        timestamp: 1,
        label: "Permission",
        title: "Permission requested",
        detail: "git_bash_command - Tool requires approval before it can continue.",
        status: "pending",
        approvalID: request.approvalID,
        toolCallID: request.toolCallID,
        section: "approvals",
        visibilityKey: "approvals",
        ...overrides,
      },
    ],
    false,
  )
}

function createThreadProps(
  activeMessages: ThreadMessage[],
  threadColumnRef = createRef<HTMLDivElement | null>(),
  overrides: Partial<ComponentProps<typeof ThreadView>> = {},
) {
  const presentationStore = overrides.presentationStore ?? createThreadPresentationStore()
  if (overrides.presentationStore === undefined && overrides.activeTurns === undefined) {
    const scopeID = overrides.scrollStateKey ?? overrides.activeSession?.id ?? session.id
    for (const message of activeMessages) {
      if (message.kind !== "assistant") continue
      presentationStore.getState().setProcessDisclosurePreference(
        scopeID,
        `legacy:${message.backendTurnID}:${message.id}`,
        "expanded",
      )
    }
  }

  return {
    activeSession: session,
    activeMessages,
    assistantTraceVisibility: DEFAULT_ASSISTANT_TRACE_VISIBILITY,
    isResolvingPermissionRequest: false,
    pendingPermissionRequests: [],
    permissionRequestActionError: null,
    permissionRequestActionRequestID: null,
    threadColumnRef,
    presentationStore,
    onAskUserQuestionAnswer: vi.fn(),
    onPermissionRequestResponse: vi.fn(),
    ...overrides,
  } satisfies ComponentProps<typeof ThreadView>
}

function renderThread(activeMessages: ThreadMessage[], overrides: Partial<ComponentProps<typeof ThreadView>> = {}) {
  const threadColumnRef = createRef<HTMLDivElement | null>()
  const props = createThreadProps(activeMessages, threadColumnRef, overrides)
  const view = render(<ThreadView {...props} />)

  return {
    ...view,
    props,
    threadColumn: threadColumnRef.current!,
  }
}

function setScrollMetrics(
  node: HTMLElement,
  metrics: {
    clientHeight: number
    scrollHeight: number
    scrollTop?: number
  },
) {
  Object.defineProperty(node, "clientHeight", {
    configurable: true,
    value: metrics.clientHeight,
  })
  Object.defineProperty(node, "scrollHeight", {
    configurable: true,
    value: metrics.scrollHeight,
  })
  if (metrics.scrollTop !== undefined) {
    node.scrollTop = metrics.scrollTop
  }
}

function createElementRect(input: { top?: number; left?: number; width?: number; height?: number } = {}) {
  const top = input.top ?? 0
  const left = input.left ?? 0
  const width = input.width ?? 100
  const height = input.height ?? 0

  return {
    x: left,
    y: top,
    width,
    height,
    top,
    left,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect
}

function readTransformYOffset(transform: string | undefined) {
  if (!transform) return null

  const translateYMatch = /^translateY\((-?\d+(?:\.\d+)?)px\)$/.exec(transform)
  if (translateYMatch) return Number(translateYMatch[1])

  const translate3dMatch =
    /^translate3d\(0(?:px)?,\s*(-?\d+(?:\.\d+)?)px,\s*0(?:px)?\)$/.exec(transform)
  if (translate3dMatch) return Number(translate3dMatch[1])

  return null
}

function installManualAnimationFrame() {
  const originalRequestAnimationFrame = window.requestAnimationFrame
  const originalCancelAnimationFrame = window.cancelAnimationFrame
  let nextFrameID = 0
  const pendingFrames = new Map<number, FrameRequestCallback>()

  window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    nextFrameID += 1
    pendingFrames.set(nextFrameID, callback)
    return nextFrameID
  })
  window.cancelAnimationFrame = vi.fn((frameID: number) => {
    pendingFrames.delete(frameID)
  })

  return {
    flush(timestamp = 10_000) {
      const callbacks = Array.from(pendingFrames.values())
      pendingFrames.clear()
      for (const callback of callbacks) {
        callback(timestamp)
      }
    },
    restore() {
      pendingFrames.clear()
      window.requestAnimationFrame = originalRequestAnimationFrame
      window.cancelAnimationFrame = originalCancelAnimationFrame
    },
  }
}

const traceItemKinds: AssistantTraceItemKind[] = [
  "system",
  "reasoning",
  "text",
  "question",
  "tool",
  "source",
  "file",
  "image",
  "patch",
  "subtask",
  "compaction",
  "step",
  "retry",
  "snapshot",
  "task-state",
  "error",
]

function traceSmokeItem(kind: AssistantTraceItemKind): AssistantTraceItem {
  const base: AssistantTraceItem = {
    id: `trace-smoke-${kind}`,
    kind,
    timestamp: 1,
    label: kind,
    title: `Smoke ${kind}`,
    text: `Rendered ${kind}`,
    status: "completed",
  }

  if (kind === "question") {
    return {
      ...base,
      questionPrompt: {
        questionID: "smoke-question",
        question: "Choose a smoke answer",
        options: [
          {
            label: "Continue",
            value: "continue",
          },
        ],
        allowFreeform: false,
        multiple: false,
        required: true,
      },
    }
  }

  if (kind === "tool") {
    return {
      ...base,
      title: "Smoke tool",
      toolOutputText: "tool output",
    }
  }

  if (kind === "image") {
    return {
      ...base,
      alt: "Smoke image",
      src: "https://example.com/smoke.png",
    }
  }

  if (kind === "patch") {
    return {
      ...base,
      filePaths: ["src/smoke.ts"],
    }
  }

  if (kind === "task-state") {
    return {
      ...base,
      progressItems: [
        {
          id: "task-1",
          status: "completed",
          step: "Render smoke task",
        },
      ],
    }
  }

  return base
}

function toolStatusTraceItem(status: NonNullable<AssistantTraceItem["status"]>): AssistantTraceItem {
  const showsInput = status === "pending" || status === "running" || status === "waiting-approval" || status === "cancelled"

  return {
    id: `tool-${status}`,
    kind: "tool",
    timestamp: 1,
    label: "Tool",
    title: `Tool ${status}`,
    toolName: `Tool ${status}`,
    detail: "Tool detail",
    status,
    toolInputText: showsInput ? "tool input" : undefined,
    toolOutputText: showsInput ? undefined : "tool output",
  }
}

describe("ThreadView trace item renderers", () => {
  it("renders every assistant trace item kind through the registry", () => {
    for (const kind of traceItemKinds) {
      const { container, unmount } = renderThread(
        [
          userMessage(`user-${kind}`, `Trigger ${kind}`),
          assistantTraceMessage(`assistant-${kind}`, [traceSmokeItem(kind)], false),
        ],
        {
          assistantTraceVisibility: {
            ...DEFAULT_ASSISTANT_TRACE_VISIBILITY,
            debugMetadata: true,
            workflow: true,
          },
        },
      )

      try {
        expect(container.querySelector(`.trace-kind-${kind}`)).not.toBeNull()
      } finally {
        unmount()
      }
    }
  })

  it("renders semantic trace rows with lightweight containers while keeping response and file changes sectioned", () => {
    const { container } = renderThread(
      [
        assistantTraceMessage(
          "assistant-lite-trace",
          [
            {
              id: "reasoning-lite",
              kind: "reasoning",
              timestamp: 1,
              label: "Reasoning",
              text: "Planning light path",
              status: "completed",
            },
            toolStatusTraceItem("completed"),
            {
              id: "workflow-lite",
              kind: "step",
              timestamp: 1,
              label: "Step",
              title: "Workflow step finished",
              section: "workflow",
              visibilityKey: "workflow",
              status: "completed",
            },
            {
              id: "source-lite",
              kind: "source",
              timestamp: 1,
              label: "Source",
              title: "Source reference",
              text: "Source visible",
              status: "completed",
            },
            {
              id: "approval-lite",
              kind: "system",
              timestamp: 1,
              label: "Approval",
              title: "Approval event",
              text: "Approval visible",
              section: "approvals",
              visibilityKey: "approvals",
              status: "completed",
            },
            {
              id: "debug-lite",
              kind: "system",
              timestamp: 1,
              label: "Debug",
              title: "Debug event",
              text: "Debug visible",
              status: "completed",
            },
            {
              id: "response-sectioned",
              kind: "text",
              timestamp: 1,
              label: "Assistant",
              text: "Final answer",
              status: "completed",
            },
            {
              id: "file-change-sectioned",
              kind: "patch",
              timestamp: 1,
              label: "Patch",
              title: "1 file change (+1 -0)",
              fileChanges: [
                {
                  file: "src/light.ts",
                  additions: 1,
                  deletions: 0,
                },
              ],
              status: "completed",
            },
          ],
          false,
        ),
      ],
      {
        assistantTraceVisibility: {
          ...DEFAULT_ASSISTANT_TRACE_VISIBILITY,
          approvals: true,
          debugMetadata: true,
          sources: true,
          workflow: true,
        },
      },
    )

    const liteRows = [
      ["assistant-reasoning-row", "is-reasoning"],
      ["assistant-tool-row", "is-tools"],
      ["assistant-workflow-row", "is-workflow"],
      ["assistant-source-row", "is-sources"],
      ["assistant-approval-row", "is-approvals"],
      ["assistant-debug-row", "is-debug"],
    ] as const

    for (const [rowKind, sectionClassName] of liteRows) {
      const row = container.querySelector(`.assistant-trace-lite-row[data-thread-row-kind="${rowKind}"]`) as HTMLElement | null
      expect(row).not.toBeNull()
      expect(row).toHaveClass("assistant-trace-lite-row")
      expect(row?.querySelector(`.assistant-trace-lite.${sectionClassName}[role="region"]`)).not.toBeNull()
      expect(row?.querySelector(".assistant-shell")).toBeNull()
      expect(row?.querySelector(".assistant-section")).toBeNull()
    }

    expect(screen.getByText("Planning light path")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Tool completed/ })).toBeInTheDocument()
    expect(screen.getByText("Workflow step finished")).toBeInTheDocument()
    expect(screen.getByText("Source visible")).toBeInTheDocument()
    expect(screen.getByText("Approval visible")).toBeInTheDocument()
    expect(screen.getByText("Debug visible")).toBeInTheDocument()

    const responseRow = screen.getByText("Final answer").closest('[data-thread-row-kind="assistant-response-row"]') as HTMLElement | null
    expect(responseRow?.querySelector(".assistant-shell.is-sectioned")).not.toBeNull()
    expect(responseRow?.querySelector(".assistant-section.is-response")).not.toBeNull()
    expect(responseRow?.querySelector(".assistant-trace-lite")).toBeNull()

    const fileChangeRow = container.querySelector('[data-thread-row-kind="assistant-file-change-row"]') as HTMLElement | null
    expect(fileChangeRow?.querySelector(".assistant-shell.is-sectioned")).not.toBeNull()
    expect(fileChangeRow?.querySelector(".assistant-section.is-file-change")).not.toBeNull()
    expect(fileChangeRow?.querySelector(".assistant-trace-lite")).toBeNull()
  })

  it("renders a matching pending permission request alongside the approval event row", () => {
    const request = permissionRequest()
    const onPermissionRequestResponse = vi.fn()
    const { container, queryByRole } = renderThread(
      [approvalTraceMessageForRequest(request)],
      {
        assistantTraceVisibility: {
          ...DEFAULT_ASSISTANT_TRACE_VISIBILITY,
          approvals: true,
        },
        onPermissionRequestResponse,
        onForkFromMessage: vi.fn(),
        pendingPermissionRequests: [request],
      },
    )

    const approvalRow = container.querySelector('[data-thread-row-kind="assistant-approval-row"]') as HTMLElement | null
    expect(approvalRow).not.toBeNull()
    expect(approvalRow?.querySelector(".trace-item")).not.toBeNull()
    expect(approvalRow?.querySelector(".trace-item-status")).toBeNull()
    expect(approvalRow?.querySelector(".permission-request-card")).not.toBeNull()
    expect(approvalRow?.querySelector(".permission-request-status")).toBeNull()
    expect(within(approvalRow!).getAllByText("Permission requested").length).toBeGreaterThanOrEqual(2)
    expect(within(approvalRow!).queryByText("git_bash_command - Tool requires approval before it can continue.")).toBeNull()
    expect(container.querySelector('[data-thread-row-kind="permission-request"]')).toBeNull()
    expect(queryByRole("button", { name: "Open Branch Chat from here" })).toBeNull()

    fireEvent.click(within(approvalRow!).getByRole("button", { name: "Allow: Check Node.js and npm availability" }))

    expect(onPermissionRequestResponse).toHaveBeenCalledWith({
      sessionID: session.id,
      request,
      decision: "allow",
    })
  })

  it("keeps the pending permission card visible while the response is applying", () => {
    const request = permissionRequest()
    const { container } = renderThread(
      [approvalTraceMessageForRequest(request)],
      {
        assistantTraceVisibility: {
          ...DEFAULT_ASSISTANT_TRACE_VISIBILITY,
          approvals: true,
        },
        isResolvingPermissionRequest: true,
        pendingPermissionRequests: [request],
        permissionRequestActionRequestID: request.id,
      },
    )

    const approvalRow = container.querySelector('[data-thread-row-kind="assistant-approval-row"]') as HTMLElement | null
    const card = approvalRow?.querySelector(".permission-request-card") as HTMLElement | null

    expect(approvalRow?.querySelector(".trace-item-status")).toBeNull()
    expect(card).not.toBeNull()
    expect(card?.querySelector(".permission-request-status")).toBeNull()
    for (const button of Array.from(card!.querySelectorAll(".permission-request-actions button"))) {
      expect(button).toBeDisabled()
    }
  })

  it("keeps the pending permission card actionable after a response error", () => {
    const request = permissionRequest()
    const { container } = renderThread(
      [approvalTraceMessageForRequest(request)],
      {
        assistantTraceVisibility: {
          ...DEFAULT_ASSISTANT_TRACE_VISIBILITY,
          approvals: true,
        },
        pendingPermissionRequests: [request],
        permissionRequestActionError: "Approval failed",
      },
    )

    const card = container.querySelector(".permission-request-card") as HTMLElement | null
    expect(card).not.toBeNull()
    expect(card?.querySelector(".permission-request-status")).toBeNull()
    expect(within(card!).getByText("Approval failed")).toBeInTheDocument()
    expect(within(card!).getByRole("button", { name: "Allow: Check Node.js and npm availability" })).not.toBeDisabled()
  })

  it("renders multiple approval events as stateless log rows", () => {
    const request = permissionRequest()
    const { container } = renderThread(
      [
        assistantTraceMessage(
          "assistant-approval-history",
          [
            {
              id: "approval-requested",
              kind: "system",
              timestamp: 1,
              label: "Permission",
              title: "Permission requested",
              status: "pending",
              approvalID: request.approvalID,
              toolCallID: request.toolCallID,
              section: "approvals",
              visibilityKey: "approvals",
            },
            {
              id: "approval-allowed",
              kind: "system",
              timestamp: 2,
              label: "Permission",
              title: "Permission allowed",
              status: "completed",
              approvalID: request.approvalID,
              toolCallID: request.toolCallID,
              section: "approvals",
              visibilityKey: "approvals",
            },
          ],
          false,
        ),
      ],
      {
        assistantTraceVisibility: {
          ...DEFAULT_ASSISTANT_TRACE_VISIBILITY,
          approvals: true,
        },
      },
    )

    const approvalRows = Array.from(container.querySelectorAll('[data-thread-row-kind="assistant-approval-row"]'))
    expect(approvalRows).toHaveLength(2)
    expect(screen.getByText("Permission requested")).toBeInTheDocument()
    expect(screen.getByText("Permission allowed")).toBeInTheDocument()
    expect(container.querySelector(".trace-item-status")).toBeNull()
    expect(container.querySelector(".permission-request-card")).toBeNull()
  })

  it("renders tool traces as lightweight log rows", () => {
    const items = [
      toolStatusTraceItem("pending"),
      toolStatusTraceItem("running"),
      toolStatusTraceItem("waiting-approval"),
      toolStatusTraceItem("completed"),
      toolStatusTraceItem("error"),
      toolStatusTraceItem("denied"),
      toolStatusTraceItem("cancelled"),
    ]
    const { container } = renderThread([
      assistantTraceMessage("assistant-tools", items, true),
    ])

    expect(container.querySelectorAll(".trace-kind-tool .trace-log-row")).toHaveLength(items.length)
    expect(container.querySelectorAll(".trace-kind-tool .trace-log-filler")).toHaveLength(items.length)
    expect(screen.getByRole("button", { name: /Tool pending/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Tool running/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Tool waiting-approval/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Tool completed/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Tool error/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Tool denied/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Tool cancelled/ })).toBeInTheDocument()
    expect(container.querySelector(".trace-kind-tool .trace-tool-status-indicator")).toBeNull()
    expect(container.querySelector(".trace-kind-tool .trace-log-label")).toBeNull()

    const pendingToolName = container.querySelector(".trace-kind-tool.is-pending .trace-tool-name")
    expect(pendingToolName).not.toBeNull()
    expect(pendingToolName).toHaveClass("is-pending")

    const waitingApprovalToolName = container.querySelector(".trace-kind-tool.is-waiting-approval .trace-tool-name")
    expect(waitingApprovalToolName).not.toBeNull()
    expect(waitingApprovalToolName).toHaveClass("is-waiting-approval")

    const runningToolName = container.querySelector(".trace-kind-tool.is-running .trace-tool-name")
    expect(runningToolName).not.toBeNull()
    expect(runningToolName).toHaveClass("is-running")

    const completedToolName = container.querySelector(".trace-kind-tool.is-completed .trace-tool-name")
    expect(completedToolName).not.toBeNull()
    expect(completedToolName).not.toHaveClass("is-running")

    const errorToolName = container.querySelector(".trace-kind-tool.is-error .trace-tool-name")
    expect(errorToolName).not.toBeNull()
    expect(errorToolName).not.toHaveClass("is-running")

    const deniedToolName = container.querySelector(".trace-kind-tool.is-denied .trace-tool-name")
    expect(deniedToolName).not.toBeNull()
    expect(deniedToolName).not.toHaveClass("is-running")

    const cancelledToolName = container.querySelector(".trace-kind-tool.is-cancelled .trace-tool-name")
    expect(cancelledToolName).not.toBeNull()
    expect(cancelledToolName).not.toHaveClass("is-running")
  })

  it("renders the toolName field as the tool row name", () => {
    renderThread([
      assistantTraceMessage(
        "assistant-tool-name",
        [
          {
            id: "tool-with-title",
            kind: "tool",
            timestamp: 1,
            label: "Tool",
            title: "Human title should not render",
            toolName: "actual_tool_name",
            status: "running",
          },
        ],
        true,
      ),
    ])

    expect(screen.getByText("actual_tool_name")).toBeInTheDocument()
    expect(screen.queryByText("Human title should not render")).not.toBeInTheDocument()
  })

  it("promotes legacy tool titles to toolName before rendering", () => {
    renderThread([
      assistantTraceMessage(
        "assistant-legacy-tool-name",
        [
          {
            id: "legacy-tool",
            kind: "tool",
            timestamp: 1,
            label: "Tool",
            title: "legacy_tool_name",
            status: "completed",
          },
        ],
        false,
      ),
    ])

    expect(screen.getByText("legacy_tool_name")).toBeInTheDocument()
    expect(screen.queryByText("Tool")).not.toBeInTheDocument()
  })

  it("renders pending tool traces as cancelled when the assistant message is cancelled", () => {
    const assistantMessage = assistantTraceMessage("assistant-cancelled", [toolStatusTraceItem("pending")], false)
    assistantMessage.runtime = {
      ...assistantMessage.runtime,
      phase: "cancelled",
    }
    assistantMessage.state = "Backend stream cancelled"

    const { container } = renderThread([assistantMessage])

    expect(screen.getByRole("button", { name: /Tool pending/ })).toBeInTheDocument()
    expect(container.querySelector(".trace-kind-tool.is-pending")).toBeNull()
    expect(container.querySelector(".trace-kind-tool.is-cancelled .trace-tool-status-indicator")).toBeNull()
    expect(container.querySelector(".trace-kind-tool.is-cancelled .trace-log-label")).toBeNull()
    const cancelledToolName = container.querySelector(".trace-kind-tool.is-cancelled .trace-tool-name")
    expect(cancelledToolName).not.toBeNull()
    expect(cancelledToolName).not.toHaveClass("is-running")
  })

  it("applies the active tool-name treatment to streaming non-patch tools", () => {
    const toolItem: AssistantTraceItem = {
      ...toolStatusTraceItem("completed"),
      id: "tool-streaming-shell",
      isStreaming: true,
      status: undefined,
      title: "powershell_command",
    }

    const { container } = renderThread([
      assistantTraceMessage("assistant-streaming-shell", [toolItem], true),
    ])

    const toolName = container.querySelector(".trace-kind-tool .trace-tool-name")
    expect(toolName).not.toBeNull()
    expect(toolName).toHaveClass("is-active")
    expect(toolName).not.toHaveClass("is-completed")
  })

  it("keeps tool details available after expanding compact summaries", () => {
    renderThread(
      [
        assistantTraceMessage("assistant-tools", [toolStatusTraceItem("running")], true),
      ],
      {
        assistantTraceVisibility: {
          ...DEFAULT_ASSISTANT_TRACE_VISIBILITY,
          toolInputs: true,
        },
      },
    )

    fireEvent.click(screen.getByRole("button", { name: /Tool running/ }))

    expect(screen.queryByText("Input")).toBeNull()
    expect(screen.getByText("tool input")).toBeInTheDocument()
    expect(screen.getByText("Tool detail")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Copy Tool running input content" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Expand Tool running input content" })).toBeInTheDocument()
  })

  it("renders expanded tool input and output as full content panes with pane actions", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })

    const toolItem: AssistantTraceItem = {
      ...toolStatusTraceItem("completed"),
      toolInputText: "tool input",
      toolOutputText: "tool output",
      detail: "tool detail",
    }
    const { container } = renderThread(
      [
        assistantTraceMessage("assistant-tools", [toolItem], false),
      ],
      {
        assistantTraceVisibility: {
          ...DEFAULT_ASSISTANT_TRACE_VISIBILITY,
          toolInputs: true,
          toolOutputs: true,
        },
      },
    )

    fireEvent.click(screen.getByRole("button", { name: /Tool completed/ }))

    const inputPane = screen.getByRole("region", { name: "Tool completed input content" })
    const outputPane = screen.getByRole("region", { name: "Tool completed output content" })
    expect(inputPane).toHaveClass("trace-tool-io-pane")
    expect(inputPane).not.toHaveClass("trace-fixed-content-pane")
    expect(outputPane).toHaveClass("trace-tool-io-pane")
    expect(outputPane).not.toHaveClass("trace-fixed-content-pane")
    expect(within(inputPane).getByRole("button", { name: "Copy Tool completed input content" })).toBeInTheDocument()
    expect(within(inputPane).getByRole("button", { name: "Expand Tool completed input content" })).toBeInTheDocument()
    expect(within(outputPane).getByRole("button", { name: "Copy Tool completed output content" })).toBeInTheDocument()
    const outputExpandButton = within(outputPane).getByRole("button", { name: "Expand Tool completed output content" })
    expect(outputExpandButton).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByText("Input")).toBeNull()
    expect(screen.queryByText("Output")).toBeNull()
    expect(container.querySelector(".trace-kind-tool .trace-tool-io-stack")).not.toBeNull()
    expect(container.querySelectorAll(".trace-kind-tool .trace-tool-io-stack .trace-tool-io-pane")).toHaveLength(2)
    expect(container.querySelectorAll(".trace-kind-tool .trace-tool-io-pane")).toHaveLength(2)

    fireEvent.click(within(inputPane).getByRole("button", { name: "Copy Tool completed input content" }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("tool input"))

    fireEvent.click(within(outputPane).getByRole("button", { name: "Copy Tool completed output content" }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("tool output\n\ntool detail"))

    fireEvent.click(outputExpandButton)
    expect(outputPane).toHaveClass("is-expanded")
    expect(within(outputPane).getByRole("button", { name: "Collapse Tool completed output content" })).toHaveAttribute("aria-expanded", "true")
  })

  it("formats JSON tool input and output while expanding multiline and serialized JSON strings", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    const rawInput = JSON.stringify({
      code: "{\n  // Deep pattern analysis\n  const patterns = {}\n}",
      options: '{"caseSensitive":true}',
    })
    const rawOutput = '{"result":{"hits":2}}'
    const toolItem: AssistantTraceItem = {
      ...toolStatusTraceItem("completed"),
      detail: undefined,
      toolInputText: rawInput,
      toolOutputText: rawOutput,
    }

    renderThread(
      [assistantTraceMessage("assistant-json-tool-input", [toolItem], false)],
      {
        assistantTraceVisibility: {
          ...DEFAULT_ASSISTANT_TRACE_VISIBILITY,
          toolInputs: true,
          toolOutputs: true,
        },
      },
    )

    fireEvent.click(screen.getByRole("button", { name: /Tool completed/ }))

    const inputPane = screen.getByRole("region", { name: "Tool completed input content" })
    const outputPane = screen.getByRole("region", { name: "Tool completed output content" })
    const formattedInput = inputPane.querySelector(".trace-tool-io-json")
    const formattedOutput = outputPane.querySelector(".trace-tool-io-json")
    expect(formattedInput?.textContent).toBe([
      "{",
      '  "code": """',
      "    {",
      "      // Deep pattern analysis",
      "      const patterns = {}",
      "    }",
      '  """,',
      '  "options": json"""',
      "    {",
      '      "caseSensitive": true',
      "    }",
      '  """',
      "}",
    ].join("\n"))
    expect(formattedInput).toHaveAttribute("data-expanded-json-string", "true")
    expect(formattedInput).toHaveAttribute("data-expanded-multiline-string", "true")
    expect(formattedOutput?.textContent).toBe([
      "{",
      '  "result": {',
      '    "hits": 2',
      "  }",
      "}",
    ].join("\n"))

    fireEvent.click(within(inputPane).getByRole("button", { name: "Copy Tool completed input content" }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(rawInput))

    fireEvent.click(within(outputPane).getByRole("button", { name: "Copy Tool completed output content" }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(rawOutput))
  })

  it("renders valid exec input as read-only JavaScript while keeping output and copy behavior generic", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    const executionMarker = "__anyboxExecTraceRendererExecuted"
    Reflect.deleteProperty(window, executionMarker)
    const code = [
      `window.${executionMarker} = true`,
      'const hits = await tools.grep({ pattern: "ThreadView" })',
      "return { count: hits.length }",
    ].join("\n")
    const rawInput = JSON.stringify({ code })
    const rawOutput = JSON.stringify({
      result: { count: 2 },
      toolCalls: [],
      durationMs: 12,
    })
    const toolItem: AssistantTraceItem = {
      ...toolStatusTraceItem("completed"),
      detail: undefined,
      title: "exec",
      toolName: "exec",
      toolInputText: rawInput,
      toolOutputText: rawOutput,
    }

    const { container } = renderThread(
      [assistantTraceMessage("assistant-exec-tool-input", [toolItem], false)],
      {
        assistantTraceVisibility: {
          ...DEFAULT_ASSISTANT_TRACE_VISIBILITY,
          toolInputs: true,
          toolOutputs: true,
        },
        codeTheme: "dracula",
      },
    )

    fireEvent.click(screen.getByRole("button", { name: /exec/i }))

    const inputPane = screen.getByRole("region", { name: "exec input content" })
    const outputPane = screen.getByRole("region", { name: "exec output content" })
    const codeBlock = inputPane.querySelector(".trace-tool-exec-code")
    expect(within(inputPane).getByText("JavaScript · async body")).toBeInTheDocument()
    expect(codeBlock).toHaveAttribute("data-language", "javascript")
    expect(codeBlock).toHaveAttribute("data-theme", "dracula")
    expect(codeBlock?.querySelectorAll(".code-highlight-row")).toHaveLength(3)
    expect(codeBlock?.querySelectorAll(".code-highlight-raw-line")[1]?.textContent).toBe(
      'const hits = await tools.grep({ pattern: "ThreadView" })',
    )
    expect(inputPane.querySelector(".trace-tool-io-json")).toBeNull()
    expect(outputPane.querySelector(".trace-tool-io-json")).not.toBeNull()
    expect(container.querySelectorAll(".trace-tool-exec-code")).toHaveLength(1)
    expect(Reflect.get(window, executionMarker)).toBeUndefined()

    fireEvent.click(within(inputPane).getByRole("button", { name: "Copy exec input content" }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(rawInput))
  })

  it("falls back to raw text for incomplete exec input", () => {
    const toolItem: AssistantTraceItem = {
      ...toolStatusTraceItem("running"),
      title: "exec",
      toolName: "exec",
      toolInputText: '{"code":"const pending = true"',
    }

    renderThread(
      [assistantTraceMessage("assistant-partial-exec-tool-input", [toolItem], true)],
      {
        assistantTraceVisibility: {
          ...DEFAULT_ASSISTANT_TRACE_VISIBILITY,
          toolInputs: true,
        },
      },
    )

    fireEvent.click(screen.getByRole("button", { name: /exec/i }))

    const inputPane = screen.getByRole("region", { name: "exec input content" })
    expect(inputPane.querySelector(".trace-tool-exec-code")).toBeNull()
    expect(within(inputPane).getByText('{"code":"const pending = true"')).toBeInTheDocument()
  })

  it("falls back to generic JSON when an exec input has fields outside the known schema", () => {
    const rawInput = JSON.stringify({
      code: "return 1",
      timeoutMs: 5000,
    })
    const toolItem: AssistantTraceItem = {
      ...toolStatusTraceItem("completed"),
      detail: undefined,
      title: "exec",
      toolName: "exec",
      toolInputText: rawInput,
    }

    renderThread(
      [assistantTraceMessage("assistant-unknown-exec-input", [toolItem], false)],
      {
        assistantTraceVisibility: {
          ...DEFAULT_ASSISTANT_TRACE_VISIBILITY,
          toolInputs: true,
        },
      },
    )

    fireEvent.click(screen.getByRole("button", { name: /exec/i }))

    const inputPane = screen.getByRole("region", { name: "exec input content" })
    expect(inputPane.querySelector(".trace-tool-exec-code")).toBeNull()
    expect(inputPane.querySelector(".trace-tool-io-json")).not.toBeNull()
    expect(inputPane).toHaveTextContent('"timeoutMs": 5000')
  })

  it("keeps incomplete JSON tool inputs as raw text while streaming", () => {
    const toolItem: AssistantTraceItem = {
      ...toolStatusTraceItem("running"),
      toolInputText: '{"command":"rg ThreadView"',
    }

    renderThread(
      [assistantTraceMessage("assistant-partial-json-tool-input", [toolItem], true)],
      {
        assistantTraceVisibility: {
          ...DEFAULT_ASSISTANT_TRACE_VISIBILITY,
          toolInputs: true,
        },
      },
    )

    fireEvent.click(screen.getByRole("button", { name: /Tool running/ }))

    const inputPane = screen.getByRole("region", { name: "Tool running input content" })
    expect(inputPane.querySelector(".trace-tool-io-json")).toBeNull()
    expect(within(inputPane).getByText('{"command":"rg ThreadView"')).toBeInTheDocument()
  })

  it("localizes tool input and output content regions in Chinese mode", async () => {
    const previousDesktop = window.desktop
    window.desktop = undefined
    window.localStorage.setItem("desktop.locale", "zh-CN")

    const toolItem: AssistantTraceItem = {
      ...toolStatusTraceItem("completed"),
      toolInputText: "tool input",
      toolOutputText: "tool output",
    }
    const threadColumnRef = createRef<HTMLDivElement | null>()
    const props = createThreadProps(
      [
        assistantTraceMessage("assistant-tools", [toolItem], false),
      ],
      threadColumnRef,
      {
        assistantTraceVisibility: {
          ...DEFAULT_ASSISTANT_TRACE_VISIBILITY,
          toolInputs: true,
          toolOutputs: true,
        },
      },
    )
    const view = render(
      <I18nProvider>
        <ThreadView {...props} />
      </I18nProvider>,
    )

    try {
      fireEvent.click(await screen.findByRole("button", { name: /Tool completed/ }))

      expect(screen.queryByText("\u8f93\u5165")).toBeNull()
      expect(screen.queryByText("\u8f93\u51fa")).toBeNull()
      expect(screen.queryByText("Input")).toBeNull()
      expect(screen.queryByText("Output")).toBeNull()

      expect(screen.getByRole("region", { name: "Tool completed \u8f93\u5165\u5185\u5bb9" })).toBeInTheDocument()
      expect(screen.getByRole("region", { name: "Tool completed \u8f93\u51fa\u5185\u5bb9" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "\u590d\u5236 Tool completed \u8f93\u5165\u5185\u5bb9" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "\u5c55\u5f00 Tool completed \u8f93\u51fa\u5185\u5bb9" })).toBeInTheDocument()
    } finally {
      view.unmount()
      window.localStorage.removeItem("desktop.locale")
      window.desktop = previousDesktop
    }
  })

  it("does not mount tool debug entries while disclosure content is collapsed", () => {
    const toolItem: AssistantTraceItem = {
      ...toolStatusTraceItem("completed"),
      debugEntries: [
        {
          label: "Debug payload",
          value: "Hidden until expanded",
        },
      ],
    }

    renderThread(
      [
        assistantTraceMessage("assistant-tools", [toolItem], false),
      ],
      {
        assistantTraceVisibility: {
          ...DEFAULT_ASSISTANT_TRACE_VISIBILITY,
          debugMetadata: true,
        },
      },
    )

    expect(screen.queryByText("Hidden until expanded")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /Tool completed/ }))

    expect(screen.getByText("Hidden until expanded")).toBeInTheDocument()
  })

  it("renders workflow step trace items as lightweight log rows", () => {
    const { container } = renderThread(
      [
        assistantTraceMessage(
          "assistant-step",
          [
            {
              id: "step-1",
              kind: "step",
              timestamp: 1,
              label: "Step",
              title: "Model step finished",
              section: "workflow",
              visibilityKey: "workflow",
            },
          ],
          false,
        ),
      ],
      {
        assistantTraceVisibility: {
          ...DEFAULT_ASSISTANT_TRACE_VISIBILITY,
          workflow: true,
        },
      },
    )

    const row = container.querySelector(".trace-kind-step .trace-log-row")

    expect(row).not.toBeNull()
    expect(row?.textContent).toContain("Model step finished")
    expect(row?.textContent).not.toContain("completed")
    expect(container.querySelector(".trace-kind-step .trace-item-step-row")).toBeNull()
    expect(container.querySelector(".trace-kind-step .trace-log-detail")).toBeNull()
  })
})

describe("ThreadView question prompts", () => {
  it("keeps option buttons clickable while the assistant message is waiting for an answer", () => {
    const onAskUserQuestionAnswer = vi.fn().mockResolvedValue(undefined)
    const questionItem: AssistantTraceItem = {
      id: "question-1",
      kind: "question",
      timestamp: 1,
      label: "Question",
      status: "running",
      section: "response",
      visibilityKey: "response",
      isStreaming: true,
      questionPrompt: {
        questionID: "que_target",
        question: "Where should I deploy?",
        options: [{ label: "Vercel", value: "vercel", description: "Recommended" }],
        allowFreeform: false,
        multiple: false,
        required: true,
      },
    }
    const { getByRole } = renderThread(
      [assistantTraceMessage("assistant-1", [questionItem], true)],
      { onAskUserQuestionAnswer },
    )

    const optionButton = getByRole("button", { name: "Vercel" }) as HTMLButtonElement
    expect(optionButton.disabled).toBe(false)

    fireEvent.click(optionButton)

    expect(onAskUserQuestionAnswer).toHaveBeenCalledWith({
      questionID: "que_target",
      selectedOptions: ["vercel"],
      text: "vercel",
    })
  })

  it("uses the full response width for freeform-only questions", () => {
    const questionItem: AssistantTraceItem = {
      id: "question-freeform",
      kind: "question",
      timestamp: 1,
      label: "Question",
      status: "completed",
      section: "response",
      visibilityKey: "response",
      questionPrompt: {
        questionID: "que_skill_type",
        question: "What kind of skill do you want to create?",
        options: [],
        allowFreeform: true,
        multiple: false,
        required: true,
      },
    }
    const { getByLabelText, queryByRole } = renderThread(
      [assistantTraceMessage("assistant-1", [questionItem], false)],
      { onAskUserQuestionAnswer: vi.fn().mockResolvedValue(undefined) },
    )

    expect(getByLabelText("Custom answer").closest(".ask-user-question-freeform-row")).toHaveClass("is-standalone")
    expect(queryByRole("button", { name: "Copy assistant response" })).not.toBeInTheDocument()
  })

  it("keeps custom answers separate from numbered options", () => {
    const questionItem: AssistantTraceItem = {
      id: "question-options-freeform",
      kind: "question",
      timestamp: 1,
      label: "Question",
      status: "completed",
      section: "response",
      visibilityKey: "response",
      questionPrompt: {
        questionID: "que_pet",
        header: "Pet preference",
        question: "Which pet do you prefer?",
        options: [{ label: "Cat", value: "cat" }],
        allowFreeform: true,
        multiple: false,
        required: true,
      },
    }
    const { getByLabelText, getByText } = renderThread(
      [assistantTraceMessage("assistant-1", [questionItem], false)],
      { onAskUserQuestionAnswer: vi.fn().mockResolvedValue(undefined) },
    )

    const freeformRow = getByLabelText("Custom answer").closest(".ask-user-question-freeform-row")
    expect(freeformRow).not.toBeNull()
    expect(freeformRow).not.toHaveTextContent("2.")
    expect(getByText("Needs your input")).toBeInTheDocument()
    expect(getByText("Pet preference")).toBeInTheDocument()
  })

  it("keeps a freeform draft after submission fails and allows an explicit retry", async () => {
    const onAskUserQuestionAnswer = vi.fn()
      .mockRejectedValueOnce(new Error("Answer failed"))
      .mockResolvedValueOnce(undefined)
    const questionItem: AssistantTraceItem = {
      id: "question-retry",
      kind: "question",
      timestamp: 1,
      label: "Question",
      status: "running",
      section: "response",
      visibilityKey: "response",
      isStreaming: true,
      questionPrompt: {
        questionID: "que_retry",
        question: "What should I keep?",
        options: [],
        allowFreeform: true,
        multiple: false,
        required: true,
      },
    }
    renderThread(
      [assistantTraceMessage("assistant-1", [questionItem], true)],
      { onAskUserQuestionAnswer },
    )

    const input = screen.getByLabelText("Custom answer") as HTMLInputElement
    fireEvent.change(input, { target: { value: "Keep this draft" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Answer failed")
    expect(input).toHaveValue("Keep this draft")
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled()

    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    await waitFor(() => expect(onAskUserQuestionAnswer).toHaveBeenCalledTimes(2))
    expect(input).toHaveValue("Keep this draft")
    expect(screen.getByRole("button", { name: "Sending..." })).toBeDisabled()
  })

  it("preserves a pending question through virtual unmount and prevents duplicate submission", async () => {
    let resolveAnswer: (() => void) | null = null
    const onAskUserQuestionAnswer = vi.fn(() => new Promise<void>((resolve) => {
      resolveAnswer = resolve
    }))
    const questionItem: AssistantTraceItem = {
      id: "question-virtual",
      kind: "question",
      timestamp: 1,
      label: "Question",
      status: "running",
      section: "response",
      visibilityKey: "response",
      isStreaming: true,
      questionPrompt: {
        questionID: "que_virtual",
        question: "Which value should survive?",
        options: [],
        allowFreeform: true,
        multiple: false,
        required: true,
      },
    }
    const trailingMessages = Array.from({ length: 320 }, (_, index) =>
      userMessage(`user-${index}`, `Prompt ${index}`),
    )
    const { container, threadColumn } = renderThread(
      [assistantTraceMessage("assistant-1", [questionItem], true), ...trailingMessages],
      {
        onAskUserQuestionAnswer,
        scrollStateKey: "question-virtual-session",
      },
    )
    setScrollMetrics(threadColumn, {
      clientHeight: 400,
      scrollHeight: 24000,
      scrollTop: 0,
    })

    const input = screen.getByLabelText("Custom answer") as HTMLInputElement
    fireEvent.change(input, { target: { value: "Persistent answer" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    expect(onAskUserQuestionAnswer).toHaveBeenCalledTimes(1)

    threadColumn.scrollTop = 24_000
    fireEvent.wheel(threadColumn, { deltaY: 120 })
    fireEvent.scroll(threadColumn)
    await waitFor(() => expect(screen.queryByLabelText("Custom answer")).toBeNull())

    threadColumn.scrollTop = 0
    fireEvent.wheel(threadColumn, { deltaY: -120 })
    fireEvent.scroll(threadColumn)
    const restoredInput = await screen.findByLabelText("Custom answer") as HTMLInputElement
    expect(restoredInput).toHaveValue("Persistent answer")
    expect(restoredInput).toBeDisabled()
    expect(screen.getByRole("button", { name: "Sending..." })).toBeDisabled()
    expect(onAskUserQuestionAnswer).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveAnswer?.()
      await Promise.resolve()
    })
    expect(container.querySelector('[data-thread-virtual-row-id]')).not.toBeNull()
  })
})

describe("ThreadView image trace items", () => {
  it("renders generated images as inline previews and keeps multiple images visible", () => {
    const items: AssistantTraceItem[] = [
      {
        id: "image-1",
        kind: "image",
        timestamp: 1,
        label: "Image",
        title: "first.png",
        src: "https://example.com/first.png",
        mimeType: "image/png",
        width: 512,
        height: 512,
        alt: "First preview",
        status: "completed",
      },
      {
        id: "image-2",
        kind: "image",
        timestamp: 2,
        label: "Image",
        title: "second.png",
        src: "https://example.com/second.png",
        mimeType: "image/png",
        width: 256,
        height: 128,
        alt: "Second preview",
        status: "completed",
      },
      {
        id: "patch-1",
        kind: "patch",
        timestamp: 3,
        label: "Patch",
        title: "Updated files",
        filePaths: ["src/app.tsx"],
        status: "completed",
      },
    ]

    const { container, getByAltText, getByRole } = renderThread([
      assistantTraceMessage("assistant-images", items, false),
    ])

    expect(getByAltText("First preview")).toHaveAttribute("src", "https://example.com/first.png")
    expect(getByAltText("Second preview")).toHaveAttribute("src", "https://example.com/second.png")
    expect(getByRole("button", { name: "已编辑 1 个文件" })).toBeInTheDocument()

    fireEvent.click(getByRole("button", { name: "Preview First preview" }))

    const dialog = getByRole("dialog", { name: "First preview" })
    expect(dialog).toBeInTheDocument()
    expect(document.body.contains(dialog)).toBe(true)
    expect(container.contains(dialog)).toBe(false)
  })

  it("hides generic image titles and completed status while keeping one metadata row", () => {
    const items: AssistantTraceItem[] = [
      {
        id: "image-attachment",
        kind: "image",
        timestamp: 1,
        label: "图像",
        title: "Attachment",
        src: "https://example.com/generated.jpg",
        mimeType: "image/jpeg",
        text: "image/jpeg",
        alt: "Generated preview",
        status: "completed",
      },
    ]

    const { container } = renderThread([
      assistantTraceMessage("assistant-image-attachment", items, false),
    ])

    const imageArticle = container.querySelector('[data-kind="image"]') as HTMLElement | null
    expect(imageArticle).not.toBeNull()
    expect(within(imageArticle!).queryByText("Attachment")).toBeNull()
    expect(within(imageArticle!).queryByText(/completed/i)).toBeNull()
    expect(within(imageArticle!).getByText("image/jpeg")).toBeInTheDocument()
    expect(imageArticle!.textContent?.match(/image\/jpeg/g) ?? []).toHaveLength(1)
  })

  it("keeps meaningful image titles and combines mime type with dimensions", () => {
    const items: AssistantTraceItem[] = [
      {
        id: "image-file",
        kind: "image",
        timestamp: 1,
        label: "Image",
        title: "first.png",
        src: "https://example.com/first.png",
        mimeType: "image/png",
        width: 512,
        height: 512,
        alt: "First preview",
        detail: "Generated image preview",
        status: "completed",
      },
    ]

    const { container } = renderThread([
      assistantTraceMessage("assistant-image-file", items, false),
    ])

    const imageArticle = container.querySelector('[data-kind="image"]') as HTMLElement | null
    expect(imageArticle).not.toBeNull()
    expect(within(imageArticle!).getByText("first.png")).toBeInTheDocument()
    expect(within(imageArticle!).getByText("image/png · 512 x 512")).toBeInTheDocument()
    expect(within(imageArticle!).getByText("Generated image preview")).toBeInTheDocument()
  })

  it("keeps patch file rows scoped to inline diff expansion", () => {
    const onFileChangeSelect = vi.fn()
    const patchItem: AssistantTraceItem = {
      id: "patch-action",
      kind: "patch",
      timestamp: 1,
      label: "Patch",
      title: "1 file change (+1 -1)",
      fileChanges: [
        {
          file: "src/app.tsx",
          additions: 1,
          deletions: 1,
          patch: [
            "diff --git a/src/app.tsx b/src/app.tsx",
            "--- a/src/app.tsx",
            "+++ b/src/app.tsx",
            "@@ -1 +1 @@",
            "-old",
            "+new",
          ].join("\n"),
        },
      ],
      status: "completed",
    }
    const { getByRole, queryByRole } = renderThread([
      assistantTraceMessage("assistant-patch", [patchItem], false),
    ], {
      onFileChangeSelect,
    })

    fireEvent.click(getByRole("button", { name: "已编辑 1 个文件" }))
    fireEvent.click(getByRole("button", { name: /已编辑\s*src\/app\.tsx/ }))

    expect(onFileChangeSelect).not.toHaveBeenCalled()
    expect(queryByRole("region", { name: "Diff preview for src/app.tsx" })).toBeInTheDocument()
  })

  it("renders historical patch text inline after expanding the file change summary", () => {
    const patchItem: AssistantTraceItem = {
      id: "patch-static",
      kind: "patch",
      timestamp: 1,
      label: "Model call",
      title: "1 file change (+1 -1)",
      fileChanges: [
        {
          file: "src/app.tsx",
          additions: 1,
          deletions: 1,
          patch: [
            "diff --git a/src/app.tsx b/src/app.tsx",
            "--- a/src/app.tsx",
            "+++ b/src/app.tsx",
            "@@ -10 +10 @@",
            "-const label = \"old\"",
            "+const label = \"new\"",
          ].join("\n"),
        },
      ],
      filePaths: ["src/app.tsx"],
      status: "completed",
    }

    const { container, getByRole, getByText } = renderThread([
      assistantTraceMessage("assistant-patch-static", [patchItem], false),
    ])

    expect(getByRole("button", { name: "已编辑 1 个文件" })).toHaveAttribute("aria-expanded", "false")
    expect(getByRole("button", { name: "已编辑 1 个文件" })).toBeInTheDocument()
    expect(screen.queryByText("src/app.tsx")).not.toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "Diff preview for src/app.tsx" })).not.toBeInTheDocument()

    fireEvent.click(getByRole("button", { name: "已编辑 1 个文件" }))
    expect(getByRole("button", { name: "已编辑 1 个文件" })).toHaveAttribute("aria-expanded", "true")
    expect(getByText("src/app.tsx")).toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "Diff preview for src/app.tsx" })).not.toBeInTheDocument()

    fireEvent.click(getByRole("button", { name: /已编辑\s*src\/app\.tsx/ }))
    expect(getByRole("region", { name: "Diff preview for src/app.tsx" })).toBeInTheDocument()
    expect(getByText('const label = "old"')).toBeInTheDocument()
    expect(getByText('const label = "new"')).toBeInTheDocument()
    expect(container.querySelectorAll(".right-sidebar-diff-row.is-remove")).toHaveLength(1)
    expect(container.querySelectorAll(".right-sidebar-diff-row.is-add")).toHaveLength(1)

    fireEvent.click(getByRole("button", { name: /已编辑\s*src\/app\.tsx/ }))
    expect(screen.queryByRole("region", { name: "Diff preview for src/app.tsx" })).not.toBeInTheDocument()
  })

  it("truncates large patch previews until the full diff is requested", () => {
    const hiddenTail = "FULL_PATCH_TAIL"
    const patchLines = [
      "diff --git a/src/large.ts b/src/large.ts",
      "--- a/src/large.ts",
      "+++ b/src/large.ts",
      "@@ -1,260 +1,260 @@",
      ...Array.from({ length: 260 }, (_, index) => `+export const value${index} = ${index}`),
      `+${hiddenTail}`,
    ]
    const patchItem: AssistantTraceItem = {
      id: "patch-large",
      kind: "patch",
      timestamp: 1,
      label: "Model call",
      title: "1 file change (+261 -0)",
      fileChanges: [
        {
          file: "src/large.ts",
          additions: 261,
          deletions: 0,
          patch: patchLines.join("\n"),
        },
      ],
      status: "completed",
    }

    const { container, getByRole } = renderThread([
      assistantTraceMessage("assistant-patch-large", [patchItem], false),
    ])

    fireEvent.click(getByRole("button", { name: "已编辑 1 个文件" }))
    fireEvent.click(getByRole("button", { name: /已编辑\s*src\/large\.ts/ }))

    expect(getByRole("region", { name: "Diff preview for src/large.ts" })).toBeInTheDocument()
    expect(container.textContent).not.toContain(hiddenTail)
    expect(getByRole("button", { name: "Show full diff" })).toBeInTheDocument()

    fireEvent.click(getByRole("button", { name: "Show full diff" }))

    expect(container.textContent).toContain(hiddenTail)
  })

  it("renders streamed draft patch previews without requiring git diff line numbers", () => {
    const toolItem: AssistantTraceItem = {
      id: "tool-patch-draft",
      kind: "tool",
      timestamp: 1,
      label: "Tool",
      title: "apply_patch",
      isStreaming: true,
      draftPatch: {
        detail: "Streaming apply_patch preview.",
        fileChanges: [
          {
            file: "src/app.ts",
            additions: 1,
            deletions: 1,
            operation: "add",
            previewState: "streaming",
            previewHunks: [
              {
                header: "Patch hunk",
                rows: [
                  { content: "old", tone: "remove" },
                  { content: "new", tone: "add" },
                ],
              },
            ],
          },
        ],
        filePaths: ["src/app.ts"],
        isStreaming: true,
        status: "running",
        title: "1 draft file change (+1 -1)",
      },
      section: "tools",
      status: "running",
      toolCallID: "call-live-patch",
      visibilityKey: "toolCalls",
    }

    const { container, getAllByText, getByRole, getByText } = renderThread([
      assistantTraceMessage("assistant-patch-draft", [toolItem], true),
    ])

    expect(getByRole("region", { name: "Tools" })).toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "File Changes" })).not.toBeInTheDocument()
    expect(container.querySelector(".trace-file-change-summary")).toHaveAttribute("aria-expanded", "false")
    const inlineToolName = container.querySelector(".trace-log-row.has-inline-draft-patch .trace-tool-name")
    expect(inlineToolName).not.toBeNull()
    expect(inlineToolName).toHaveTextContent("apply_patch")
    expect(inlineToolName).toHaveAttribute("title", "apply_patch")
    const inlineSummary = container.querySelector(".trace-log-row .trace-tool-inline-draft-patch-summary")
    expect(inlineSummary).not.toBeNull()
    expect(inlineSummary?.querySelector(".trace-file-change-summary-icon")).toBeNull()
    expect(container.querySelector(".trace-tool-draft-patch .trace-file-change-summary")).toBeNull()
    expect(inlineSummary?.textContent).toContain("src/app.ts")
    expect(inlineSummary?.textContent).toContain("+1-1")
    expect(inlineSummary?.textContent).toMatch(/src\/app\.ts\s*\+1-1/)
    expect(inlineSummary?.textContent).not.toContain("正在创建")
    expect(getAllByText("src/app.ts").length).toBeGreaterThan(0)
    expect(container.querySelector(".trace-tool-draft-patch")).toBeNull()

    fireEvent.click(inlineSummary!)
    expect(container.querySelector(".trace-tool-draft-patch .trace-file-change-row")).toBeNull()
    expect(container.querySelector(".trace-tool-draft-patch .trace-file-change-preview.is-single-file")).not.toBeNull()
    expect(getByRole("region", { name: "Diff preview for src/app.ts" })).toBeInTheDocument()
    expect(getByText("old")).toBeInTheDocument()
    expect(getByText("new")).toBeInTheDocument()
    expect(container.querySelectorAll(".right-sidebar-diff-row.is-inline-preview")).toHaveLength(2)
    expect(container.querySelectorAll(".right-sidebar-diff-line-number")).toHaveLength(0)
  })

  it("keeps streamed draft patch previews pinned to the bottom as rows append", () => {
    const buildToolItem = (rows: Array<{ content: string; tone: "add" | "remove" | "context" }>): AssistantTraceItem => ({
      id: "tool-patch-draft",
      kind: "tool",
      timestamp: 1,
      label: "Tool",
      title: "apply_patch",
      isStreaming: true,
      draftPatch: {
        detail: "Streaming apply_patch preview.",
        fileChanges: [
          {
            file: "src/app.ts",
            additions: rows.filter((row) => row.tone === "add").length,
            deletions: rows.filter((row) => row.tone === "remove").length,
            operation: "add",
            previewState: "streaming",
            previewHunks: [
              {
                header: "New file",
                rows,
              },
            ],
          },
        ],
        filePaths: ["src/app.ts"],
        isStreaming: true,
        status: "running",
        title: "1 draft file change",
      },
      section: "tools",
      status: "running",
      toolCallID: "call-live-patch",
      visibilityKey: "toolCalls",
    })

    const { container, props, rerender } = renderThread([
      assistantTraceMessage("assistant-patch-draft", [
        buildToolItem([
          { content: "line 1", tone: "add" },
          { content: "line 2", tone: "add" },
        ]),
      ], true),
    ])
    const inlineSummary = container.querySelector(".trace-log-row .trace-tool-inline-draft-patch-summary")
    expect(inlineSummary).not.toBeNull()
    fireEvent.click(inlineSummary!)
    const preview = container.querySelector(".trace-tool-draft-patch .right-sidebar-diff-preview") as HTMLElement | null
    expect(preview).not.toBeNull()
    setScrollMetrics(preview!, { clientHeight: 80, scrollHeight: 240, scrollTop: 0 })

    rerender(
      <ThreadView
        {...props}
        activeMessages={[
          assistantTraceMessage("assistant-patch-draft", [
            buildToolItem(Array.from({ length: 12 }, (_, index) => ({
              content: `line ${index + 1}`,
              tone: "add",
            }))),
          ], true),
        ]}
      />,
    )

    expect(preview!.scrollTop).toBe(240)
  })

  it("settles completed draft patch previews and avoids repeating the file row in the tool summary", () => {
    const toolItem: AssistantTraceItem = {
      id: "tool-patch-draft-completed",
      kind: "tool",
      timestamp: 1,
      label: "Tool",
      title: "apply_patch",
      draftPatch: {
        detail: "Patch tool completed.",
        fileChanges: [
          {
            file: "src/app.ts",
            additions: 1,
            deletions: 0,
            operation: "add",
            previewState: "complete",
            previewHunks: [
              {
                header: "Patch hunk",
                rows: [
                  { content: "new", tone: "add" },
                ],
              },
            ],
          },
        ],
        filePaths: ["src/app.ts"],
        isStreaming: false,
        status: "completed",
        title: "1 draft file change (+1 -0)",
      },
      section: "tools",
      status: "completed",
      toolCallID: "call-completed-patch",
      visibilityKey: "toolCalls",
    }

    const { container, getByRole, queryByText } = renderThread([
      assistantTraceMessage("assistant-patch-draft-completed", [toolItem], false),
    ])

    const inlineSummary = container.querySelector(".trace-log-row .trace-tool-inline-draft-patch-summary")
    expect(inlineSummary?.querySelector(".trace-file-change-summary-icon")).toBeNull()
    expect(container.querySelector(".trace-log-row .trace-log-filler")).not.toBeNull()
    expect(container.querySelector(".trace-log-row .trace-log-time")).toBeNull()
    expect(inlineSummary?.textContent).toContain("src/app.ts")
    expect(inlineSummary?.textContent).toContain("+1-0")
    expect(inlineSummary?.textContent).toMatch(/src\/app\.ts\s*\+1-0/)
    expect(inlineSummary?.textContent).not.toContain("已创建")
    expect(queryByText("正在创建")).toBeNull()
    expect(queryByText("已创建")).toBeNull()
    expect(container.querySelector(".trace-tool-draft-patch")).toBeNull()
    fireEvent.click(inlineSummary!)
    expect(getByRole("button", { name: /src\/app\.ts\s*1 additions,\s*0 deletions/ })).toBeInTheDocument()
    expect(container.querySelector(".trace-tool-draft-patch .trace-file-change-row")).toBeNull()
    expect(getByRole("region", { name: "Diff preview for src/app.ts" })).toBeInTheDocument()
  })

  it("keeps failed draft patch file changes collapsed by default", () => {
    const toolItem: AssistantTraceItem = {
      id: "tool-patch-draft-failed",
      kind: "tool",
      timestamp: 1,
      label: "Tool",
      title: "apply_patch",
      draftPatch: {
        detail: "Patch tool failed.",
        fileChanges: [
          {
            file: "spirefall.html",
            additions: 0,
            deletions: 1,
            operation: "delete",
            previewState: "complete",
            previewHunks: [
              {
                header: "Patch hunk",
                rows: [
                  { content: "<div>old</div>", tone: "remove" },
                ],
              },
            ],
          },
        ],
        filePaths: ["spirefall.html"],
        isStreaming: false,
        status: "error",
        title: "1 draft file change (+0 -1)",
      },
      section: "tools",
      status: "error",
      toolCallID: "call-failed-patch",
      visibilityKey: "toolCalls",
    }

    const { container, getByRole, getByText } = renderThread([
      assistantTraceMessage("assistant-patch-draft-failed", [toolItem], false),
    ])

    const inlineSummary = container.querySelector(".trace-tool-inline-draft-patch-summary")
    expect(inlineSummary).toHaveAttribute("aria-expanded", "false")
    expect(container.querySelector(".trace-tool-draft-patch")).toBeNull()
    fireEvent.click(inlineSummary!)
    expect(container.querySelector(".trace-tool-draft-patch .trace-file-change-row")).toBeNull()
    expect(getByRole("region", { name: "Diff preview for spirefall.html" })).toBeInTheDocument()
    expect(getByText("<div>old</div>")).toBeInTheDocument()
  })

  it("ignores malformed draft patch preview hunks instead of crashing the thread", () => {
    const toolItem = {
      id: "tool-patch-draft-malformed-hunk",
      kind: "tool",
      timestamp: 1,
      label: "Tool",
      title: "apply_patch",
      draftPatch: {
        detail: "Patch tool completed.",
        fileChanges: [
          {
            file: "src/safe.ts",
            additions: 1,
            deletions: 0,
            operation: "add",
            previewState: "complete",
            previewHunks: [
              {
                header: "Broken hunk",
              },
            ],
          },
        ],
        filePaths: ["src/safe.ts"],
        isStreaming: false,
        status: "completed",
        title: "1 draft file change (+1 -0)",
      },
      section: "tools",
      status: "completed",
      toolCallID: "call-malformed-patch",
      visibilityKey: "toolCalls",
    } as unknown as AssistantTraceItem

    const { container } = renderThread([
      assistantTraceMessage("assistant-patch-draft-malformed-hunk", [toolItem], false),
    ])

    expect(screen.getByText("src/safe.ts")).toBeInTheDocument()
    expect(container.querySelector(".trace-tool-inline-draft-patch-summary")).not.toBeNull()
    expect(screen.queryByRole("region", { name: "Diff preview for src/safe.ts" })).toBeNull()
  })

  it("falls back to the normal tool row when draft patch file changes are malformed", () => {
    const toolItem = {
      id: "tool-patch-draft-malformed-files",
      kind: "tool",
      timestamp: 1,
      label: "Tool",
      title: "apply_patch",
      draftPatch: {
        detail: "Patch tool completed.",
        fileChanges: null,
        filePaths: ["src/safe.ts"],
        isStreaming: false,
        status: "completed",
        title: "1 draft file change (+1 -0)",
      },
      section: "tools",
      status: "completed",
      toolCallID: "call-malformed-files",
      toolOutputText: "Done",
      visibilityKey: "toolCalls",
    } as unknown as AssistantTraceItem

    const { container } = renderThread([
      assistantTraceMessage("assistant-patch-draft-malformed-files", [toolItem], false),
    ])

    expect(screen.getByText("apply_patch")).toBeInTheDocument()
    expect(container.querySelector(".trace-tool-inline-draft-patch-summary")).toBeNull()
  })

  it("does not mount patch debug entries while the file change summary is collapsed", () => {
    const patchItem: AssistantTraceItem = {
      id: "patch-debug",
      kind: "patch",
      timestamp: 1,
      label: "Patch",
      title: "1 file change (+1 -0)",
      fileChanges: [
        {
          file: "src/debug.ts",
          additions: 1,
          deletions: 0,
        },
      ],
      debugEntries: [
        {
          label: "Patch debug",
          value: "Hidden patch debug",
        },
      ],
      status: "completed",
    }

    const { container } = renderThread(
      [
        assistantTraceMessage("assistant-patch-debug", [patchItem], false),
      ],
      {
        assistantTraceVisibility: {
          ...DEFAULT_ASSISTANT_TRACE_VISIBILITY,
          debugMetadata: true,
        },
      },
    )

    expect(screen.queryByText("Hidden patch debug")).toBeNull()

    fireEvent.click(container.querySelector(".trace-file-change-summary")!)

    expect(screen.getByText("Hidden patch debug")).toBeInTheDocument()
  })

  it("uses the folded file change renderer for ordinary patch items", () => {
    const patchItem: AssistantTraceItem = {
      id: "patch-ordinary",
      kind: "patch",
      timestamp: 1,
      label: "Patch",
      title: "1 file change (+2 -0)",
      fileChanges: [
        {
          file: "src/ordinary.ts",
          additions: 2,
          deletions: 0,
        },
      ],
      status: "completed",
    }

    const { getByRole, getByText, queryByText } = renderThread([
      assistantTraceMessage("assistant-patch-ordinary", [patchItem], false),
    ])

    expect(getByRole("button", { name: "已编辑 1 个文件" })).toBeInTheDocument()
    expect(queryByText("src/ordinary.ts")).not.toBeInTheDocument()

    fireEvent.click(getByRole("button", { name: "已编辑 1 个文件" }))

    expect(getByText("src/ordinary.ts")).toBeInTheDocument()
    expect(getByText("仅摘要")).toBeInTheDocument()
  })

  it("closes the lightbox with Escape and restores focus to the thumbnail trigger", () => {
    const items: AssistantTraceItem[] = [
      {
        id: "image-1",
        kind: "image",
        timestamp: 1,
        label: "Image",
        title: "first.png",
        src: "https://example.com/first.png",
        mimeType: "image/png",
        width: 512,
        height: 512,
        alt: "First preview",
        status: "completed",
      },
    ]
    const { getByRole, queryByRole } = renderThread([
      assistantTraceMessage("assistant-images", items, false),
    ])

    const previewButton = getByRole("button", { name: "Preview First preview" })
    previewButton.focus()

    fireEvent.click(previewButton)
    expect(getByRole("dialog", { name: "First preview" })).toBeInTheDocument()
    expect(document.body.classList.contains("is-image-lightbox-open")).toBe(true)

    fireEvent.keyDown(window, { key: "Escape" })

    expect(queryByRole("dialog", { name: "First preview" })).toBeNull()
    expect(document.body.classList.contains("is-image-lightbox-open")).toBe(false)
    expect(document.activeElement).toBe(previewButton)
  })

  it("uses fit-width by default for tall images and fit-contain for regular images", () => {
    const items: AssistantTraceItem[] = [
      {
        id: "image-1",
        kind: "image",
        timestamp: 1,
        label: "Image",
        title: "tall.png",
        src: "https://example.com/tall.png",
        mimeType: "image/png",
        width: 1440,
        height: 3557,
        alt: "Tall preview",
        status: "completed",
      },
      {
        id: "image-2",
        kind: "image",
        timestamp: 2,
        label: "Image",
        title: "wide.png",
        src: "https://example.com/wide.png",
        mimeType: "image/png",
        width: 1920,
        height: 1080,
        alt: "Wide preview",
        status: "completed",
      },
    ]
    const { getByRole, queryByRole } = renderThread([
      assistantTraceMessage("assistant-images", items, false),
    ])

    fireEvent.click(getByRole("button", { name: "Preview Tall preview" }))
    expect(document.querySelector(".trace-image-lightbox-canvas.is-fit-width")).not.toBeNull()
    fireEvent.keyDown(window, { key: "Escape" })
    expect(queryByRole("dialog", { name: "Tall preview" })).toBeNull()

    fireEvent.click(getByRole("button", { name: "Preview Wide preview" }))
    expect(document.querySelector(".trace-image-lightbox-canvas.is-fit-contain")).not.toBeNull()
  })

  it("supports keyboard zoom shortcuts and reset", () => {
    const items: AssistantTraceItem[] = [
      {
        id: "image-1",
        kind: "image",
        timestamp: 1,
        label: "Image",
        title: "first.png",
        src: "https://example.com/first.png",
        mimeType: "image/png",
        width: 512,
        height: 512,
        alt: "First preview",
        status: "completed",
      },
    ]
    const { getByRole } = renderThread([
      assistantTraceMessage("assistant-images", items, false),
    ])

    fireEvent.click(getByRole("button", { name: "Preview First preview" }))
    const resetZoomButton = getByRole("button", { name: "Reset zoom" })
    expect(resetZoomButton.textContent).toContain("100%")

    fireEvent.keyDown(window, { key: "+" })
    expect(resetZoomButton.textContent).toContain("110%")

    fireEvent.keyDown(window, { key: "-" })
    expect(resetZoomButton.textContent).toContain("100%")

    fireEvent.keyDown(window, { key: "=" })
    expect(resetZoomButton.textContent).toContain("110%")

    fireEvent.keyDown(window, { key: "0" })
    expect(resetZoomButton.textContent).toContain("100%")
  })

  it("closes on backdrop click and stays open when clicking inside the panel", () => {
    const items: AssistantTraceItem[] = [
      {
        id: "image-1",
        kind: "image",
        timestamp: 1,
        label: "Image",
        title: "first.png",
        src: "https://example.com/first.png",
        mimeType: "image/png",
        width: 512,
        height: 512,
        alt: "First preview",
        status: "completed",
      },
    ]
    const { getByRole, queryByRole } = renderThread([
      assistantTraceMessage("assistant-images", items, false),
    ])

    fireEvent.click(getByRole("button", { name: "Preview First preview" }))

    const panel = document.querySelector(".trace-image-lightbox-panel") as HTMLElement
    fireEvent.click(panel)
    expect(getByRole("dialog", { name: "First preview" })).toBeInTheDocument()

    const backdrop = document.querySelector(".trace-image-lightbox-backdrop") as HTMLElement
    fireEvent.click(backdrop)
    expect(queryByRole("dialog", { name: "First preview" })).toBeNull()
  })

  it("does not open the preview when image loading fails", () => {
    const items: AssistantTraceItem[] = [
      {
        id: "image-1",
        kind: "image",
        timestamp: 1,
        label: "Image",
        title: "broken.png",
        src: "https://example.com/broken.png",
        mimeType: "image/png",
        width: 512,
        height: 512,
        alt: "Broken preview",
        status: "completed",
      },
    ]
    const { getByAltText, getByRole, queryByRole } = renderThread([
      assistantTraceMessage("assistant-images", items, false),
    ])

    const thumbnail = getByAltText("Broken preview")
    fireEvent.error(thumbnail)

    const previewButton = getByRole("button", { name: "Preview Broken preview" }) as HTMLButtonElement
    expect(previewButton.disabled).toBe(true)

    fireEvent.click(previewButton)
    expect(queryByRole("dialog", { name: "Broken preview" })).toBeNull()
  })
})

describe("ThreadView trace collapse", () => {
  it("collapses completed reasoning to the first line and expands from the section", () => {
    const { container, getByText } = renderThread([
      assistantTraceMessage(
        "assistant-1",
        [
          {
            id: "reasoning-1",
            kind: "reasoning",
            timestamp: 1,
            label: "Reasoning",
            text: "Inspect files first\nThen compare the rendering states",
            status: "completed",
          },
        ],
        false,
      ),
    ])

    expect(container.textContent).toContain("Inspect files first")
    expect(container.textContent).not.toContain("Then compare the rendering states")

    const reasoningSummary = getByText("Inspect files first")
    expect(reasoningSummary).toHaveClass("trace-item-collapsed-line")

    const reasoningToggle = reasoningSummary.closest('[role="button"]')
    expect(reasoningToggle).not.toBeNull()

    fireEvent.click(reasoningToggle!)

    expect(container.textContent).toContain("Then compare the rendering states")
    expect(container.querySelector(".trace-item-subsection-label")).toBeNull()
    expect(container.querySelector(".trace-item-subsection-toggle-icon")).toBeNull()
    expect(reasoningToggle).toHaveAttribute("aria-expanded", "true")
    expect(reasoningSummary).not.toHaveClass("trace-item-collapsed-line")

    fireEvent.click(reasoningToggle!)

    expect(container.textContent).toContain("Inspect files first")
    expect(container.textContent).not.toContain("Then compare the rendering states")
    expect(reasoningToggle).toHaveAttribute("aria-expanded", "false")
    expect(reasoningSummary).toHaveClass("trace-item-collapsed-line")
  })

  it("renders expanded reasoning as plain full content", () => {
    const { container, getByRole, getByText } = renderThread([
      assistantTraceMessage(
        "assistant-1",
        [
          {
            id: "reasoning-1",
            kind: "reasoning",
            timestamp: 1,
            label: "Reasoning",
            text: "Inspect files first\nThen compare the rendering states",
            status: "completed",
          },
        ],
        false,
      ),
    ])

    fireEvent.click(getByText("Inspect files first").closest('[role="button"]')!)

    const reasoningPane = getByRole("region", { name: "Reasoning content" })
    expect(reasoningPane).toHaveClass("trace-reasoning-pane")
    expect(reasoningPane).not.toHaveClass("trace-fixed-content-pane")
    expect(reasoningPane.closest(".trace-item")).toHaveClass("is-expanded")
    expect(container.querySelector(".trace-item-reasoning-toggle")).toHaveAttribute("aria-expanded", "true")
    expect(getByText("Inspect files first")).not.toHaveClass("trace-item-collapsed-line")
    expect(reasoningPane).not.toHaveTextContent("Inspect files first")

    expect(reasoningPane).toHaveTextContent("Then compare the rendering states")
  })

  it("reveals a long single-line reasoning item when expanded", () => {
    const longReasoningLine =
      "The user wants to test the availability of all tools. Let me run a few simple test commands to verify that different tools are working."
    const { getByText, queryByRole } = renderThread([
      assistantTraceMessage(
        "assistant-1",
        [
          {
            id: "reasoning-1",
            kind: "reasoning",
            timestamp: 1,
            label: "Reasoning",
            text: longReasoningLine,
            status: "completed",
          },
        ],
        false,
      ),
    ])

    const reasoningSummary = getByText(longReasoningLine)
    const reasoningToggle = reasoningSummary.closest('[role="button"]')
    expect(reasoningToggle).not.toBeNull()
    expect(reasoningSummary).toHaveClass("trace-item-collapsed-line")

    fireEvent.click(reasoningToggle!)

    expect(reasoningToggle).toHaveAttribute("aria-expanded", "true")
    expect(reasoningToggle).not.toHaveAttribute("aria-controls")
    expect(reasoningSummary).not.toHaveClass("trace-item-collapsed-line")
    expect(queryByRole("region", { name: "Reasoning content" })).toBeNull()
  })

  it("keeps grouped reasoning open while independently closing tool content when the message completes", () => {
    vi.useFakeTimers()
    const streamingItems: AssistantTraceItem[] = [
      {
        id: "reasoning-1",
        kind: "reasoning",
        timestamp: 1,
        label: "Reasoning",
        text: "Inspect files first\nThen compare the rendering states",
        status: "running",
        isStreaming: true,
      },
      {
        id: "tool-1",
        kind: "tool",
        timestamp: 1,
        label: "Tool",
        title: "Shell",
        detail: "Get-Content ThreadView.tsx",
        status: "running",
        isStreaming: true,
      },
    ]
    const completedItems: AssistantTraceItem[] = [
      {
        ...streamingItems[0],
        status: "completed",
        isStreaming: false,
      },
      {
        ...streamingItems[1],
        detail: "Read ThreadView.tsx",
        status: "completed",
        isStreaming: false,
      },
    ]
    try {
      const { container, getByRole, props, rerender } = renderThread([
        assistantTraceMessage("assistant-1", streamingItems, true),
      ])

      expect(container.textContent).toContain("Then compare the rendering states")

      fireEvent.click(getByRole("button", { name: /Shell/ }))
      expect(container.textContent).not.toContain("Input")
      expect(getByRole("region", { name: "Shell input content" })).toBeInTheDocument()

      rerender(<ThreadView {...props} activeMessages={[assistantTraceMessage("assistant-1", completedItems, false)]} />)

      expect(container.textContent).toContain("Inspect files first")
      expect(container.textContent).toContain("Then compare the rendering states")
      expect(container.querySelector(".trace-item-reasoning-body.is-collapsing")).toBeNull()
      expect(container.querySelector(".trace-log-detail.is-collapsing")).not.toBeNull()

      act(() => {
        vi.advanceTimersByTime(250)
      })

      expect(container.textContent).toContain("Inspect files first")
      expect(container.textContent).toContain("Then compare the rendering states")
      expect(container.textContent).not.toContain("Input")
      expect(container.textContent).not.toContain("Output")
    } finally {
      vi.useRealTimers()
    }
  })

  it("collapses completed reasoning parts while the assistant message is still streaming", () => {
    const { container, getByText } = renderThread([
      assistantTraceMessage(
        "assistant-1",
        [
          {
            id: "reasoning-1",
            kind: "reasoning",
            timestamp: 1,
            label: "Reasoning",
            text: "Finished planning part\nThe completed details should be folded",
            isStreaming: false,
          },
          {
            id: "reasoning-2",
            kind: "reasoning",
            timestamp: 2,
            label: "Reasoning",
            text: "Active planning part\nThe live details should stay open",
            status: "running",
            isStreaming: true,
          },
        ],
        true,
      ),
    ])

    const completedSummary = getByText("Finished planning part")
    const activeSummary = getByText("Active planning part")

    expect(container.textContent).toContain("Finished planning part")
    expect(container.textContent).not.toContain("The completed details should be folded")
    expect(container.textContent).toContain("The live details should stay open")
    expect(completedSummary).toHaveClass("trace-item-collapsed-line")
    expect(completedSummary.closest('[role="button"]')).toHaveAttribute("aria-expanded", "false")
    expect(activeSummary).not.toHaveClass("trace-item-collapsed-line")
    expect(activeSummary.closest('[role="button"]')).toHaveAttribute("aria-expanded", "true")
  })

  it("mounts full long reasoning text only after expansion", () => {
    const hiddenTail = "FULL_REASONING_TAIL"
    const longReasoningLine = `${"Scanning context. ".repeat(50)}${hiddenTail}`
    const { container } = renderThread([
      assistantTraceMessage(
        "assistant-1",
        [
          {
            id: "reasoning-long",
            kind: "reasoning",
            timestamp: 1,
            label: "Reasoning",
            text: longReasoningLine,
            status: "completed",
          },
        ],
        false,
      ),
    ])

    const reasoningToggle = container.querySelector(".trace-item-reasoning-toggle")
    expect(reasoningToggle).not.toBeNull()
    expect(container.textContent).not.toContain(hiddenTail)

    fireEvent.click(reasoningToggle!)

    expect(reasoningToggle).toHaveAttribute("aria-expanded", "true")
    expect(container.textContent).toContain(hiddenTail)
  })

  it("keeps full tool input unmounted until the tool row expands", () => {
    const hiddenTail = "FULL_TOOL_INPUT_TAIL"
    const toolInputText = `${"input chunk ".repeat(160)}${hiddenTail}`
    const { container, getByRole, queryByText } = renderThread([
      assistantTraceMessage(
        "assistant-tool-preview",
        [
          {
            id: "tool-preview",
            kind: "tool",
            timestamp: 1,
            label: "Tool",
            title: "Shell",
            status: "running",
            isStreaming: true,
            toolInputText,
          },
        ],
        true,
      ),
    ], {
      assistantTraceVisibility: {
        ...DEFAULT_ASSISTANT_TRACE_VISIBILITY,
        toolInputs: true,
      },
    })

    expect(container.textContent).not.toContain(hiddenTail)

    fireEvent.click(getByRole("button", { name: /Shell/ }))
    expect(queryByText("Input")).toBeNull()
    expect(screen.getByRole("button", { name: "Copy Shell input content" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Expand Shell input content" })).toBeInTheDocument()
    expect(container.textContent).toContain(hiddenTail)
  })

  it("renders assistant trace items as semantic rows before the final response", () => {
    const { getByText } = renderThread([
      assistantTraceMessage(
        "assistant-1",
        [
          {
            id: "response-1",
            kind: "text",
            timestamp: 1,
            label: "Assistant",
            text: "I will inspect the project first.",
            status: "completed",
          },
          {
            id: "tool-1",
            kind: "tool",
            timestamp: 2,
            label: "Tool",
            title: "list-directory",
            status: "completed",
          },
          {
            id: "response-2",
            kind: "text",
            timestamp: 3,
            label: "Assistant",
            text: "The project is ready.",
            status: "completed",
          },
        ],
        false,
      ),
    ])

    const firstResponse = getByText("I will inspect the project first.")
    const tool = getByText("list-directory")
    const finalResponse = getByText("The project is ready.")

    expect(firstResponse.closest('[data-thread-row-kind="assistant-response-row"]')).not.toBeNull()
    expect(tool.closest('[data-thread-row-kind="assistant-tool-row"]')).not.toBeNull()
    expect(finalResponse.closest('[data-thread-row-kind="assistant-response-row"]')).not.toBeNull()
    expect(firstResponse.compareDocumentPosition(tool) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(tool.compareDocumentPosition(finalResponse) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("keeps workflow events after the final response in their backend order", () => {
    const { getByText } = renderThread(
      [
        assistantTraceMessage(
          "assistant-1",
          [
            {
              id: "step-start",
              kind: "step",
              timestamp: 1,
              label: "Step",
              title: "Model step started",
              section: "workflow",
              visibilityKey: "workflow",
            },
            {
              id: "response-1",
              kind: "text",
              timestamp: 2,
              label: "Assistant",
              text: "The model replied.",
              status: "completed",
            },
            {
              id: "step-finish",
              kind: "step",
              timestamp: 3,
              label: "Step",
              title: "Model step finished",
              section: "workflow",
              visibilityKey: "workflow",
            },
            {
              id: "response-complete",
              kind: "system",
              timestamp: 4,
              label: "Workflow",
              title: "Response complete",
              detail: "Finish reason: stop",
              status: "completed",
              section: "workflow",
              visibilityKey: "workflow",
            },
          ],
          false,
        ),
      ],
      {
        assistantTraceVisibility: {
          ...DEFAULT_ASSISTANT_TRACE_VISIBILITY,
          workflow: true,
        },
      },
    )

    const stepStartedText = getByText("Model step started")
    const responseText = getByText("The model replied.")
    const stepFinishedText = getByText("Model step finished")
    const responseCompleteText = getByText("Response complete")

    expect(stepStartedText.closest('[data-thread-row-kind="assistant-workflow-row"]')).not.toBeNull()
    expect(responseText.closest('[data-thread-row-kind="assistant-response-row"]')).not.toBeNull()
    expect(stepFinishedText.closest('[data-thread-row-kind="assistant-workflow-row"]')).not.toBeNull()
    expect(responseCompleteText.closest('[data-thread-row-kind="assistant-workflow-row"]')).not.toBeNull()
    expect(stepStartedText.compareDocumentPosition(responseText) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(responseText.compareDocumentPosition(stepFinishedText) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(stepFinishedText.compareDocumentPosition(responseCompleteText) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("renders assistant trace directly while the assistant message is not terminal", () => {
    const assistantMessage = assistantTraceMessage(
      "assistant-1",
      [
        {
          id: "response-1",
          kind: "text",
          timestamp: 1,
          label: "Assistant",
          text: "I will create the tasks first.",
          status: "completed",
        },
        {
          id: "tool-1",
          kind: "tool",
          timestamp: 2,
          label: "Tool",
          title: "task_create",
          status: "completed",
        },
        {
          id: "response-2",
          kind: "text",
          timestamp: 3,
          label: "Assistant",
          text: "Now I will start the child agents.",
          status: "completed",
        },
      ],
      false,
    )

    const { getByText } = renderThread([
      {
        ...assistantMessage,
        runtime: {
          ...assistantMessage.runtime,
          phase: "waiting_llm",
        },
        state: "waiting_llm",
      },
    ])

    expect(getByText("I will create the tasks first.")).toBeInTheDocument()
    expect(getByText("task_create")).toBeInTheDocument()
    expect(getByText("Now I will start the child agents.")).toBeInTheDocument()
  })

  it("does not duplicate unfinished task messages in the final response trace", () => {
    const taskMessage = assistantTraceMessage(
      "assistant-task",
      [
        {
          id: "tool-task-create",
          kind: "tool",
          timestamp: 100,
          label: "Tool",
          title: "task_create",
          status: "completed",
        },
      ],
      false,
    )
    taskMessage.runtime = {
      ...taskMessage.runtime,
      phase: "tool_running",
    }
    taskMessage.state = "tool_running"

    const { container, getByText } = renderThread([
      userMessage("user-1", "Create task and continue."),
      taskMessage,
      assistantTraceMessage(
        "assistant-final",
        [
          {
            id: "response-final",
            kind: "text",
            timestamp: 200,
            label: "Assistant",
            text: "The task is running.",
            status: "completed",
          },
        ],
        false,
      ),
    ])

    expect(getByText("task_create")).toBeInTheDocument()
    expect(getByText("The task is running.")).toBeInTheDocument()
    expect(container.querySelectorAll(".trace-kind-tool")).toHaveLength(1)
  })

  it("orders adjacent live assistant messages by trace time when they arrive out of sequence", () => {
    const spawnMessage = assistantTraceMessage(
      "assistant-spawn",
      [
        {
          id: "response-spawn",
          kind: "text",
          timestamp: 300,
          label: "Assistant",
          text: "Now I will start the child agents.",
          status: "completed",
        },
        {
          id: "tool-spawn",
          kind: "tool",
          timestamp: 310,
          label: "Tool",
          title: "spawn_subagent",
          status: "completed",
        },
      ],
      true,
      "turn-live-ordering",
    )
    const taskMessage = assistantTraceMessage(
      "assistant-task",
      [
        {
          id: "response-task",
          kind: "text",
          timestamp: 100,
          label: "Assistant",
          text: "I will create the task list first.",
          status: "completed",
        },
        {
          id: "tool-task",
          kind: "tool",
          timestamp: 110,
          label: "Tool",
          title: "task_create",
          status: "completed",
        },
      ],
      true,
      "turn-live-ordering",
    )

    const { getByText } = renderThread([
      userMessage("user-1", "Use multiagent."),
      spawnMessage,
      taskMessage,
    ])

    const taskText = getByText("I will create the task list first.")
    const spawnText = getByText("Now I will start the child agents.")

    expect(taskText.compareDocumentPosition(spawnText) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("preserves completed adjacent assistant message order after live ordering settles", () => {
    const spawnMessage = assistantTraceMessage(
      "assistant-spawn",
      [
        {
          id: "response-spawn",
          kind: "text",
          timestamp: 300,
          label: "Assistant",
          text: "Now I will start the child agents.",
          status: "completed",
        },
      ],
      false,
    )
    const taskMessage = assistantTraceMessage(
      "assistant-task",
      [
        {
          id: "tool-task",
          kind: "tool",
          timestamp: 100,
          label: "Tool",
          title: "task_create",
          status: "completed",
        },
      ],
      false,
    )

    const { getByText } = renderThread([
      userMessage("user-1", "Use multiagent."),
      spawnMessage,
      taskMessage,
    ])

    const spawnText = getByText("Now I will start the child agents.")
    const taskTool = getByText("task_create")

    expect(spawnText.compareDocumentPosition(taskTool) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("renders tool items in a tool row without a process header", () => {
    const { getByText } = renderThread([
      assistantTraceMessage(
        "assistant-1",
        [
          {
            id: "tool-1",
            kind: "tool",
            timestamp: 1,
            label: "Tool",
            title: "list-directory",
            status: "completed",
          },
          {
            id: "response-1",
            kind: "text",
            timestamp: 2,
            label: "Assistant",
            text: "The project is ready.",
            status: "completed",
          },
        ],
        false,
      ),
    ])

    expect(getByText("list-directory").closest('[data-thread-row-kind="assistant-tool-row"]')).not.toBeNull()
    expect(getByText("The project is ready.").closest('[data-thread-row-kind="assistant-response-row"]')).not.toBeNull()
  })

  it("folds completed intermediate assistant items into final semantic rows", () => {
    const processMessage = assistantTraceMessage(
      "assistant-folded-prefix",
      [
        {
          id: "reasoning-1",
          kind: "reasoning",
          timestamp: 100_000,
          label: "Reasoning",
          text: "Inspect files first.",
          status: "completed",
        },
        {
          id: "tool-1",
          kind: "tool",
          timestamp: 165_000,
          label: "Tool",
          title: "read-file",
          status: "completed",
        },
        {
          id: "progress-1",
          kind: "text",
          timestamp: 210_000,
          label: "Assistant",
          text: "Almost done.",
          status: "completed",
        },
      ],
      false,
    )
    processMessage.runtime = {
      phase: "completed",
      startedAt: 100_000,
      updatedAt: 220_000,
    }
    processMessage.backendTurnID = "turn-folded-assistant"
    const finalMessage = assistantTraceMessage(
      "assistant-final",
      [
        {
          id: "response-1",
          kind: "text",
          timestamp: 228_000,
          label: "Assistant",
          text: "The project is ready.",
          status: "completed",
        },
      ],
      false,
    )
    finalMessage.runtime = {
      phase: "completed",
      startedAt: 220_000,
      updatedAt: 228_000,
    }
    finalMessage.backendTurnID = "turn-folded-assistant"

    const { getByText } = renderThread([userMessage("user-1", "Prompt"), processMessage, finalMessage])

    expect(getByText("Inspect files first.").closest('[data-thread-row-kind="assistant-reasoning-row"]')).not.toBeNull()
    expect(getByText("read-file").closest('[data-thread-row-kind="assistant-tool-row"]')).not.toBeNull()
    expect(getByText("Almost done.").closest('[data-thread-row-kind="assistant-response-row"]')).not.toBeNull()
    expect(getByText("The project is ready.").closest('[data-thread-row-kind="assistant-response-row"]')).not.toBeNull()
    expect(getByText("Inspect files first.").closest("[data-thread-message-id]")).toHaveAttribute(
      "data-thread-message-id",
      "assistant-final",
    )
  })

  it("does not render a localized process trace title in Chinese mode", async () => {
    const previousDesktop = window.desktop
    window.desktop = undefined
    window.localStorage.setItem("desktop.locale", "zh-CN")

    const threadColumnRef = createRef<HTMLDivElement | null>()
    const props = createThreadProps(
      [
        assistantTraceMessage(
          "assistant-1",
          [
            {
              id: "tool-1",
              kind: "tool",
              timestamp: 1,
              label: "Tool",
              title: "list-directory",
              status: "completed",
            },
            {
              id: "response-1",
              kind: "text",
              timestamp: 2,
              label: "Assistant",
              text: "The project is ready.",
              status: "completed",
            },
          ],
          false,
        ),
      ],
      threadColumnRef,
    )
    const view = render(
      <I18nProvider>
        <ThreadView {...props} />
      </I18nProvider>,
    )

    try {
      expect(await screen.findByText("list-directory")).toBeInTheDocument()
      expect(screen.queryByText("\u5df2\u5904\u7406")).toBeNull()
    } finally {
      view.unmount()
      window.localStorage.removeItem("desktop.locale")
      window.desktop = previousDesktop
    }
  })

  it("renders a single short reasoning note before the final response as a reasoning row", () => {
    const { getByText } = renderThread([
      assistantTraceMessage(
        "assistant-1",
        [
          {
            id: "reasoning-1",
            kind: "reasoning",
            timestamp: 1,
            label: "Reasoning",
            text: "The user is greeting me in Chinese.",
            status: "completed",
          },
          {
            id: "response-1",
            kind: "text",
            timestamp: 2,
            label: "Assistant",
            text: "Hello! How can I help?",
            status: "completed",
          },
        ],
        false,
      ),
    ])

    expect(getByText("The user is greeting me in Chinese.")).toBeInTheDocument()
    expect(getByText("Hello! How can I help?")).toBeInTheDocument()
  })

  it("keeps inlined short reasoning disclosure behavior unchanged", () => {
    const { container, getByText, queryByRole } = renderThread([
      assistantTraceMessage(
        "assistant-1",
        [
          {
            id: "reasoning-1",
            kind: "reasoning",
            timestamp: 1,
            label: "Reasoning",
            text: "Inspect files first\nThen compare the rendering states",
            status: "completed",
          },
          {
            id: "response-1",
            kind: "text",
            timestamp: 2,
            label: "Assistant",
            text: "The project is ready.",
            status: "completed",
          },
        ],
        false,
      ),
    ])

    expect(container.textContent).toContain("Inspect files first")
    expect(container.textContent).not.toContain("Then compare the rendering states")

    const reasoningSummary = getByText("Inspect files first")
    const reasoningToggle = reasoningSummary.closest('[role="button"]')
    expect(reasoningSummary).toHaveClass("trace-item-collapsed-line")
    expect(reasoningToggle).toHaveAttribute("aria-expanded", "false")

    fireEvent.click(reasoningToggle!)

    expect(queryByRole("region", { name: "Reasoning content" })).toBeInTheDocument()
    expect(container.textContent).toContain("Then compare the rendering states")
    expect(reasoningToggle).toHaveAttribute("aria-expanded", "true")
  })

  it("keeps multiple reasoning notes before the final response as reasoning rows", () => {
    const { getByText } = renderThread([
      assistantTraceMessage(
        "assistant-1",
        [
          {
            id: "reasoning-1",
            kind: "reasoning",
            timestamp: 1,
            label: "Reasoning",
            text: "Inspect files first.",
            status: "completed",
          },
          {
            id: "reasoning-2",
            kind: "reasoning",
            timestamp: 2,
            label: "Reasoning",
            text: "Compare the rendering states.",
            status: "completed",
          },
          {
            id: "response-1",
            kind: "text",
            timestamp: 3,
            label: "Assistant",
            text: "The project is ready.",
            status: "completed",
          },
        ],
        false,
      ),
    ])

    const firstReasoning = getByText("Inspect files first.")
    const secondReasoning = getByText("Compare the rendering states.")
    const finalResponse = getByText("The project is ready.")
    expect(firstReasoning.closest('[data-thread-row-kind="assistant-reasoning-row"]')).not.toBeNull()
    expect(secondReasoning.closest('[data-thread-row-kind="assistant-reasoning-row"]')).not.toBeNull()
    expect(finalResponse.closest('[data-thread-row-kind="assistant-response-row"]')).not.toBeNull()
    expect(firstReasoning.compareDocumentPosition(secondReasoning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(secondReasoning.compareDocumentPosition(finalResponse) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("keeps long reasoning before the final response as a reasoning row", () => {
    const longReasoning =
      "I need to inspect the existing thread rendering behavior, compare the process trace grouping rules, update the eligibility guard, and make sure the final answer remains easy to scan without hiding meaningful work."
    const { getByText } = renderThread([
      assistantTraceMessage(
        "assistant-1",
        [
          {
            id: "reasoning-1",
            kind: "reasoning",
            timestamp: 1,
            label: "Reasoning",
            text: longReasoning,
            status: "completed",
          },
          {
            id: "response-1",
            kind: "text",
            timestamp: 2,
            label: "Assistant",
            text: "The project is ready.",
            status: "completed",
          },
        ],
        false,
      ),
    ])

    expect(getByText(longReasoning).closest('[data-thread-row-kind="assistant-reasoning-row"]')).not.toBeNull()
    expect(getByText("The project is ready.").closest('[data-thread-row-kind="assistant-response-row"]')).not.toBeNull()
  })

  it("keeps semantic assistant rows visible when a streaming message completes", () => {
    const streamingItems: AssistantTraceItem[] = [
      {
        id: "response-1",
        kind: "text",
        timestamp: 1,
        label: "Assistant",
        text: "I will inspect the project first.",
        status: "running",
        isStreaming: true,
      },
      {
        id: "tool-1",
        kind: "tool",
        timestamp: 2,
        label: "Tool",
        title: "list-directory",
        status: "running",
        isStreaming: true,
      },
      {
        id: "response-2",
        kind: "text",
        timestamp: 3,
        label: "Assistant",
        text: "The project is ready.",
        status: "running",
        isStreaming: true,
      },
    ]
    const completedItems = streamingItems.map((item) => ({
      ...item,
      status: "completed" as const,
      isStreaming: false,
    }))

    const { getByText, props, rerender } = renderThread([
      assistantTraceMessage("assistant-1", streamingItems, true),
    ])

    expect(getByText("I will inspect the project first.").closest('[data-thread-row-kind="assistant-response-row"]')).not.toBeNull()

    rerender(<ThreadView {...props} activeMessages={[assistantTraceMessage("assistant-1", completedItems, false)]} />)

    expect(getByText("I will inspect the project first.").closest('[data-thread-row-kind="assistant-response-row"]')).not.toBeNull()
    expect(getByText("list-directory").closest('[data-thread-row-kind="assistant-tool-row"]')).not.toBeNull()
    expect(getByText("The project is ready.").closest('[data-thread-row-kind="assistant-response-row"]')).not.toBeNull()
  })

  it("keeps visible semantic trace content anchored instead of following the bottom", () => {
    const originalResizeObserver = globalThis.ResizeObserver
    let triggerResize: (() => void) | null = null

    class ManualResizeObserver implements ResizeObserver {
      readonly callback: ResizeObserverCallback

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
        triggerResize = () => {
          callback([], this)
        }
      }

      observe() {}

      unobserve() {}

      disconnect() {}
    }

    globalThis.ResizeObserver = ManualResizeObserver

    try {
      const { getByText, threadColumn } = renderThread(
        [
          assistantTraceMessage(
            "assistant-1",
            [
              {
                id: "response-1",
                kind: "text",
                timestamp: 1,
                label: "Assistant",
                text: "I will inspect the project first.",
                status: "completed",
              },
              {
                id: "tool-1",
                kind: "tool",
                timestamp: 2,
                label: "Tool",
                title: "list-directory",
                status: "completed",
              },
              {
                id: "response-2",
                kind: "text",
                timestamp: 3,
                label: "Assistant",
                text: "The project is ready.",
                status: "completed",
              },
            ],
            false,
          ),
        ],
        { scrollStateKey: "session:semantic-trace-anchor" },
      )
      setScrollMetrics(threadColumn, {
        clientHeight: 400,
        scrollHeight: 800,
        scrollTop: 400,
      })

      expect(getByText("I will inspect the project first.")).toBeInTheDocument()

      setScrollMetrics(threadColumn, {
        clientHeight: 400,
        scrollHeight: 1100,
        scrollTop: threadColumn.scrollTop,
      })
      act(() => {
        triggerResize?.()
      })

      expect(threadColumn.scrollTop).toBe(400)
    } finally {
      globalThis.ResizeObserver = originalResizeObserver
    }
  })

  it("renders failed tool trace before the final response as semantic rows", () => {
    const assistantMessage = assistantTraceMessage(
      "assistant-1",
      [
        {
          id: "response-1",
          kind: "text",
          timestamp: 1,
          label: "Assistant",
          text: "Let me test the tools first.",
          status: "completed",
        },
        {
          id: "tool-1",
          kind: "tool",
          timestamp: 2,
          label: "Tool",
          title: "lsp_workspace_symbols",
          status: "error",
        },
        {
          id: "response-2",
          kind: "text",
          timestamp: 3,
          label: "Assistant",
          text: "所有工具测试结果：\n\n| 工具 | 状态 |\n| --- | --- |\n| read-file | ok |",
          status: "completed",
        },
      ],
      false,
    )

    const { getByText } = renderThread([
      {
        ...assistantMessage,
        runtime: {
          ...assistantMessage.runtime,
          phase: "failed",
        },
        state: "Backend stream failed",
      },
    ])

    expect(getByText("Let me test the tools first.").closest('[data-thread-row-kind="assistant-response-row"]')).not.toBeNull()
    expect(getByText("lsp_workspace_symbols").closest('[data-thread-row-kind="assistant-tool-row"]')).not.toBeNull()
    expect(getByText("所有工具测试结果：")).toBeInTheDocument()

  })
})

describe("ThreadView execution disclosure", () => {
  function executionFixture(status: ThreadTurn["status"] = "completed") {
    const user = userMessage("user-execution", "Inspect the project")
    const assistant = assistantTraceMessage(
      "assistant-execution",
      [
        {
          id: "reasoning-execution",
          kind: "reasoning",
          timestamp: 1_000,
          label: "Reasoning",
          text: "Inspect the existing renderer structure.",
          status: status === "running" ? "running" : "completed",
        },
        {
          id: "tool-execution",
          kind: "tool",
          timestamp: 2_000,
          label: "Tool",
          title: "read-thread-view",
          status: status === "running" ? "running" : "completed",
        },
        {
          id: "response-execution",
          kind: "text",
          timestamp: 845_000,
          label: "Assistant",
          text: "The implementation is ready.",
          status: status === "running" ? "running" : "completed",
          isStreaming: status === "running",
        },
      ],
      status === "running",
    )
    assistant.runtime = {
      phase: status === "running" ? "responding" : "completed",
      startedAt: 1_000,
      updatedAt: 845_000,
    }
    assistant.state = status === "running" ? "responding" : "completed"

    const turn = threadTurn("turn-execution", user, [user, assistant], {
      completedAt: status === "running" ? undefined : 845_000,
      finalSegmentID: assistant.segmentID,
      lastMessageID: assistant.id,
      startedAt: 1_000,
      status,
      updatedAt: 845_000,
    })
    return { activeMessages: [user, assistant], assistant, turn, user }
  }

  function cloneExecutionAssistant(
    source: AssistantThreadMessage,
    id: string,
    backendTurnID = source.backendTurnID,
  ): AssistantThreadMessage {
    return {
      ...source,
      backendTurnID,
      id,
      messageID: `${id}:message`,
      segmentID: `${id}:segment`,
      items: source.items.map((item, index) => ({
        ...item,
        id: `${id}:item:${index}`,
      })),
    }
  }

  function pendingExecutionPairFixture() {
    const running = executionFixture("running")
    const pendingTurnID = `pending:${running.user.id}`
    const firstAssistant = {
      ...running.assistant,
      backendTurnID: pendingTurnID,
    }
    const secondAssistant = cloneExecutionAssistant(
      firstAssistant,
      "assistant-execution-second",
      pendingTurnID,
    )
    const pendingTurn = {
      ...running.turn,
      finalSegmentID: secondAssistant.segmentID,
      lastMessageID: secondAssistant.id,
      messages: [running.user, firstAssistant, secondAssistant],
      turnID: pendingTurnID,
    }
    return {
      ...running,
      firstAssistant,
      pendingTurn,
      pendingTurnID,
      secondAssistant,
    }
  }

  it("renders a completed long turn collapsed with its final response outside the disclosure", () => {
    const fixture = executionFixture()
    const { queryByText } = renderThread(fixture.activeMessages, { activeTurns: [fixture.turn] })

    const summary = screen.getByRole("button", {
      name: "Expand processing details: Processed 14m 4s",
    })
    expect(summary).toHaveAttribute("aria-expanded", "false")
    expect(queryByText("Inspect the existing renderer structure.")).toBeNull()
    expect(queryByText("read-thread-view")).toBeNull()
    expect(screen.getByText("The implementation is ready.")).toBeInTheDocument()

    fireEvent.click(summary)

    expect(summary).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("Inspect the existing renderer structure.")).toBeInTheDocument()
    expect(screen.getByText("read-thread-view")).toBeInTheDocument()
  })

  it("keeps a recovered failed tool inside the completed process disclosure", () => {
    const fixture = executionFixture()
    const assistant = {
      ...fixture.assistant,
      items: fixture.assistant.items.map((item) => (
        item.id === "tool-execution"
          ? {
              ...item,
              status: "error" as const,
              title: "apply-patch-recovered",
              toolOutputText: "The first patch attempt did not match",
            }
          : item
      )),
    }
    const turn = {
      ...fixture.turn,
      messages: [fixture.user, assistant],
    }
    const { queryByText } = renderThread([fixture.user, assistant], { activeTurns: [turn] })

    const summary = screen.getByRole("button", {
      name: "Expand processing details: Processed 14m 4s",
    })
    expect(summary).toHaveAttribute("aria-expanded", "false")
    expect(queryByText("apply-patch-recovered")).toBeNull()
    expect(screen.getByText("The implementation is ready.")).toBeInTheDocument()

    fireEvent.click(summary)

    expect(summary).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("apply-patch-recovered")).toBeInTheDocument()
  })

  it("keeps an explicit disclosure preference across inactive ThreadView mounts", () => {
    const fixture = executionFixture()
    const { props, rerender } = renderThread(fixture.activeMessages, { activeTurns: [fixture.turn] })
    fireEvent.click(screen.getByRole("button", { name: /Expand processing details/ }))
    expect(screen.getByText("read-thread-view")).toBeInTheDocument()

    rerender(<ThreadView {...props} activeTurns={[fixture.turn]} isThreadVisible={false} />)
    rerender(<ThreadView {...props} activeTurns={[fixture.turn]} isThreadVisible />)

    expect(screen.getByRole("button", { name: /Collapse processing details/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    )
    expect(screen.getByText("read-thread-view")).toBeInTheDocument()
  })

  it("migrates an explicit pending-turn disclosure preference to the canonical group", () => {
    const running = executionFixture("running")
    const pendingTurnID = `pending:${running.user.id}`
    const pendingAssistant = {
      ...running.assistant,
      backendTurnID: pendingTurnID,
    }
    const pendingTurn = {
      ...running.turn,
      turnID: pendingTurnID,
      messages: [running.user, pendingAssistant],
    }
    const presentationStore = createThreadPresentationStore()
    const { props, rerender } = renderThread([running.user, pendingAssistant], {
      activeTurns: [pendingTurn],
      presentationStore,
    })

    fireEvent.click(screen.getByRole("button", { name: /Collapse processing details: Processing/ }))
    expect(screen.getByRole("button", { name: /Expand processing details: Processing/ })).toHaveAttribute(
      "data-thread-execution-group-id",
      `turn:${pendingTurnID}`,
    )
    expect(screen.queryByText("read-thread-view")).toBeNull()

    const canonicalAssistant = {
      ...pendingAssistant,
      backendTurnID: "turn-execution",
    }
    const canonicalTurn = {
      ...pendingTurn,
      turnID: "turn-execution",
      messages: [running.user, canonicalAssistant],
    }
    rerender(
      <ThreadView
        {...props}
        activeMessages={[running.user, canonicalAssistant]}
        activeTurns={[canonicalTurn]}
      />,
    )

    expect(screen.getByRole("button", { name: /Expand processing details: Processing/ })).toHaveAttribute(
      "data-thread-execution-group-id",
      "turn:turn-execution",
    )
    expect(screen.queryByText("read-thread-view")).toBeNull()
    const presentationScopeID = props.scrollStateKey ?? props.activeSession?.id ?? "thread:no-session"
    expect(presentationStore.getState().getProcessDisclosurePreference(
      presentationScopeID,
      `turn:${pendingTurnID}`,
    )).toBe("auto")
    expect(presentationStore.getState().getProcessDisclosurePreference(
      presentationScopeID,
      "turn:turn-execution",
    )).toBe("collapsed")
  })

  it("migrates an explicit real-wrapper preference when complete membership coalesces into another real group", () => {
    const running = executionFixture("running")
    const sharedBackendTurnID = "shared-backend-turn"
    const firstAssistant = {
      ...running.assistant,
      backendTurnID: sharedBackendTurnID,
    }
    const firstTurn = {
      ...running.turn,
      messages: [running.user, firstAssistant],
      turnID: "wrapper-turn-1",
    }
    const presentationStore = createThreadPresentationStore()
    const { props, rerender } = renderThread([running.user, firstAssistant], {
      activeTurns: [firstTurn],
      presentationStore,
    })

    fireEvent.click(screen.getByRole("button", { name: /Collapse processing details: Processing/ }))
    const finalAssistant = cloneExecutionAssistant(
      firstAssistant,
      "assistant-execution-final",
      sharedBackendTurnID,
    )
    const finalTurn = {
      ...running.turn,
      finalSegmentID: finalAssistant.segmentID,
      lastMessageID: finalAssistant.id,
      messages: [finalAssistant],
      turnID: "wrapper-turn-2",
    }
    rerender(
      <ThreadView
        {...props}
        activeMessages={[running.user, firstAssistant, finalAssistant]}
        activeTurns={[firstTurn, finalTurn]}
      />,
    )

    expect(screen.getByRole("button", { name: /Expand processing details: Processing/ })).toHaveAttribute(
      "data-thread-execution-group-id",
      "turn:wrapper-turn-2",
    )
    const presentationScopeID = props.scrollStateKey ?? props.activeSession?.id ?? "thread:no-session"
    expect(presentationStore.getState().getProcessDisclosurePreference(
      presentationScopeID,
      "turn:wrapper-turn-1",
    )).toBe("auto")
    expect(presentationStore.getState().getProcessDisclosurePreference(
      presentationScopeID,
      "turn:wrapper-turn-2",
    )).toBe("collapsed")
  })

  it("does not migrate a pending preference when its complete membership splits across pending and real groups", () => {
    const fixture = pendingExecutionPairFixture()
    const presentationStore = createThreadPresentationStore()
    const { props, rerender } = renderThread(
      [fixture.user, fixture.firstAssistant, fixture.secondAssistant],
      {
        activeTurns: [fixture.pendingTurn],
        presentationStore,
      },
    )

    fireEvent.click(screen.getByRole("button", { name: /Collapse processing details: Processing/ }))
    const insertedUser = userMessage("user-execution-steer", "Change direction")
    const canonicalTurnID = "turn-execution-canonical"
    const canonicalAssistant = {
      ...fixture.secondAssistant,
      backendTurnID: canonicalTurnID,
    }
    const remainingPendingTurn = {
      ...fixture.pendingTurn,
      finalSegmentID: fixture.firstAssistant.segmentID,
      lastMessageID: fixture.firstAssistant.id,
      messages: [fixture.user, fixture.firstAssistant],
    }
    const canonicalTurn = {
      ...fixture.turn,
      finalSegmentID: canonicalAssistant.segmentID,
      lastMessageID: canonicalAssistant.id,
      messages: [insertedUser, canonicalAssistant],
      turnID: canonicalTurnID,
      userMessageID: insertedUser.id,
    }
    rerender(
      <ThreadView
        {...props}
        activeMessages={[fixture.user, fixture.firstAssistant, insertedUser, canonicalAssistant]}
        activeTurns={[remainingPendingTurn, canonicalTurn]}
      />,
    )

    const presentationScopeID = props.scrollStateKey ?? props.activeSession?.id ?? "thread:no-session"
    expect(presentationStore.getState().getProcessDisclosurePreference(
      presentationScopeID,
      `turn:${fixture.pendingTurnID}`,
    )).toBe("collapsed")
    expect(presentationStore.getState().getProcessDisclosurePreference(
      presentationScopeID,
      `turn:${canonicalTurnID}`,
    )).toBe("auto")
  })

  it("does not migrate a preference when any previous group member is missing", () => {
    const fixture = pendingExecutionPairFixture()
    const presentationStore = createThreadPresentationStore()
    const { props, rerender } = renderThread(
      [fixture.user, fixture.firstAssistant, fixture.secondAssistant],
      {
        activeTurns: [fixture.pendingTurn],
        presentationStore,
      },
    )

    fireEvent.click(screen.getByRole("button", { name: /Collapse processing details: Processing/ }))
    const canonicalTurnID = "turn-execution-canonical"
    const canonicalAssistant = {
      ...fixture.secondAssistant,
      backendTurnID: canonicalTurnID,
    }
    const canonicalTurn = {
      ...fixture.turn,
      finalSegmentID: canonicalAssistant.segmentID,
      lastMessageID: canonicalAssistant.id,
      messages: [fixture.user, canonicalAssistant],
      turnID: canonicalTurnID,
    }
    rerender(
      <ThreadView
        {...props}
        activeMessages={[fixture.user, canonicalAssistant]}
        activeTurns={[canonicalTurn]}
      />,
    )

    const presentationScopeID = props.scrollStateKey ?? props.activeSession?.id ?? "thread:no-session"
    expect(presentationStore.getState().getProcessDisclosurePreference(
      presentationScopeID,
      `turn:${fixture.pendingTurnID}`,
    )).toBe("collapsed")
    expect(presentationStore.getState().getProcessDisclosurePreference(
      presentationScopeID,
      `turn:${canonicalTurnID}`,
    )).toBe("auto")
  })

  it("does not migrate a preference when the previous group id is reused by new members", () => {
    const running = executionFixture("running")
    const reusedTurnID = "reused-real-turn"
    const destinationTurnID = "destination-real-turn"
    const originalAssistant = {
      ...running.assistant,
      backendTurnID: "original-backend-turn",
    }
    const originalTurn = {
      ...running.turn,
      messages: [running.user, originalAssistant],
      turnID: reusedTurnID,
    }
    const presentationStore = createThreadPresentationStore()
    const { props, rerender } = renderThread([running.user, originalAssistant], {
      activeTurns: [originalTurn],
      presentationStore,
    })

    fireEvent.click(screen.getByRole("button", { name: /Collapse processing details: Processing/ }))
    const newUser = userMessage("user-reused-turn", "Start another task")
    const newAssistant = cloneExecutionAssistant(
      originalAssistant,
      "assistant-reused-turn",
      "new-backend-turn",
    )
    const destinationTurn = {
      ...running.turn,
      messages: [running.user, originalAssistant],
      turnID: destinationTurnID,
    }
    const reusedTurn = {
      ...running.turn,
      finalSegmentID: newAssistant.segmentID,
      lastMessageID: newAssistant.id,
      messages: [newUser, newAssistant],
      turnID: reusedTurnID,
      userMessageID: newUser.id,
    }
    rerender(
      <ThreadView
        {...props}
        activeMessages={[running.user, originalAssistant, newUser, newAssistant]}
        activeTurns={[destinationTurn, reusedTurn]}
      />,
    )

    const presentationScopeID = props.scrollStateKey ?? props.activeSession?.id ?? "thread:no-session"
    expect(presentationStore.getState().getProcessDisclosurePreference(
      presentationScopeID,
      `turn:${reusedTurnID}`,
    )).toBe("collapsed")
    expect(presentationStore.getState().getProcessDisclosurePreference(
      presentationScopeID,
      `turn:${destinationTurnID}`,
    )).toBe("auto")
  })

  it("shows a running long turn expanded and atomically collapses it at completion", async () => {
    const running = executionFixture("running")
    const { props, rerender } = renderThread(running.activeMessages, { activeTurns: [running.turn] })

    const runningSummary = screen.getByRole("button", { name: /Collapse processing details: Processing/ })
    expect(runningSummary).toHaveAttribute(
      "aria-expanded",
      "true",
    )
    expect(runningSummary.querySelector(".assistant-execution-summary-duration")).toBeNull()
    expect(screen.getByText("read-thread-view")).toBeInTheDocument()

    const completed = executionFixture("completed")
    rerender(
      <ThreadView
        {...props}
        activeMessages={completed.activeMessages}
        activeTurns={[completed.turn]}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Expand processing details: Processed/ })).toHaveAttribute(
        "aria-expanded",
        "false",
      )
    })
    expect(screen.queryByText("read-thread-view")).toBeNull()
    expect(screen.getByText("The implementation is ready.")).toBeInTheDocument()
  })

  it("uses the conservative single-message legacy fallback when canonical turns are unavailable", () => {
    const assistant = assistantTraceMessage(
      "assistant-legacy-execution",
      [
        {
          id: "reasoning-legacy-execution",
          kind: "reasoning",
          timestamp: 1,
          label: "Reasoning",
          text: "Inspect the legacy trace.",
          status: "completed",
        },
        {
          id: "tool-legacy-execution",
          kind: "tool",
          timestamp: 2,
          label: "Tool",
          title: "read-legacy-trace",
          status: "completed",
        },
        {
          id: "response-legacy-execution",
          kind: "text",
          timestamp: 3,
          label: "Assistant",
          text: "Legacy fallback complete.",
          status: "completed",
        },
      ],
      false,
    )

    renderThread([assistant], { presentationStore: createThreadPresentationStore() })

    expect(screen.getByRole("button", { name: /Expand processing details: Processed/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    )
    expect(screen.queryByText("read-legacy-trace")).toBeNull()
    expect(screen.getByText("Legacy fallback complete.")).toBeInTheDocument()
  })

  it("waits for authoritative final-message hydration before collapsing", async () => {
    const user = userMessage("user-late-final", "Inspect late metadata")
    const process = assistantTraceMessage(
      "assistant-late-process",
      [
        {
          id: "reasoning-late-process",
          kind: "reasoning",
          timestamp: 1,
          label: "Reasoning",
          text: "Waiting for final metadata.",
          status: "completed",
        },
        {
          id: "tool-late-process",
          kind: "tool",
          timestamp: 2,
          label: "Tool",
          title: "late-hydration-tool",
          status: "completed",
        },
      ],
      false,
      "turn-late-final",
    )
    const initialTurn = threadTurn("turn-late-final", user, [user, process], {
      lastMessageID: "assistant-late-final",
      status: "completed",
      updatedAt: 3,
    })
    const { props, rerender } = renderThread([user, process], { activeTurns: [initialTurn] })

    expect(screen.getByRole("button", { name: /Collapse processing details: Processed/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    )
    expect(screen.getByText("late-hydration-tool")).toBeInTheDocument()

    const final = assistantTraceMessage(
      "assistant-late-final",
      [{
        id: "response-late-final",
        kind: "text",
        timestamp: 4,
        label: "Assistant",
        text: "Late final response.",
        status: "completed",
      }],
      false,
      "turn-late-final",
    )
    const hydratedTurn = { ...initialTurn, messages: [user, process, final], updatedAt: 4 }
    rerender(
      <ThreadView
        {...props}
        activeMessages={[user, process, final]}
        activeTurns={[hydratedTurn]}
      />,
    )

    await waitFor(() => expect(
      screen.getByRole("button", { name: /Expand processing details: Processed/ }),
    ).toHaveAttribute("aria-expanded", "false"))
    expect(screen.queryByText("late-hydration-tool")).toBeNull()
    expect(screen.getByText("Late final response.")).toBeInTheDocument()
  })

  it("moves focus from a disappearing process row to the execution summary", async () => {
    const running = executionFixture("running")
    const { props, rerender } = renderThread(running.activeMessages, { activeTurns: [running.turn] })
    const reasoningToggle = screen.getByText("Inspect the existing renderer structure.").closest<HTMLElement>(
      '[role="button"]',
    )
    expect(reasoningToggle).not.toBeNull()
    reasoningToggle!.focus()
    expect(document.activeElement).toBe(reasoningToggle)

    const completed = executionFixture("completed")
    rerender(
      <ThreadView
        {...props}
        activeMessages={completed.activeMessages}
        activeTurns={[completed.turn]}
      />,
    )

    const summary = await screen.findByRole("button", { name: /Expand processing details: Processed/ })
    await waitFor(() => expect(summary).toHaveFocus())
    expect(screen.queryByText("Inspect the existing renderer structure.")).toBeNull()
  })

  it("clears a text selection only when it intersects disappearing process rows", async () => {
    const running = executionFixture("running")
    const { props, rerender } = renderThread(running.activeMessages, { activeTurns: [running.turn] })
    const processText = screen.getByText("Inspect the existing renderer structure.")
    const selection = window.getSelection()
    const processRange = document.createRange()
    processRange.selectNodeContents(processText)
    selection?.removeAllRanges()
    selection?.addRange(processRange)
    expect(selection?.rangeCount).toBe(1)

    const completed = executionFixture("completed")
    rerender(
      <ThreadView
        {...props}
        activeMessages={completed.activeMessages}
        activeTurns={[completed.turn]}
      />,
    )

    await waitFor(() => expect(selection?.rangeCount).toBe(0))

    fireEvent.click(screen.getByRole("button", { name: /Expand processing details: Processed/ }))
    const survivingResponse = screen.getByText("The implementation is ready.")
    const responseRange = document.createRange()
    responseRange.selectNodeContents(survivingResponse)
    selection?.addRange(responseRange)
    expect(selection?.rangeCount).toBe(1)

    fireEvent.click(screen.getByRole("button", { name: /Collapse processing details: Processed/ }))
    await waitFor(() => expect(
      screen.getByRole("button", { name: /Expand processing details: Processed/ }),
    ).toBeInTheDocument())
    expect(selection?.rangeCount).toBe(1)
    expect(selection?.toString()).toBe("The implementation is ready.")
    selection?.removeAllRanges()
  })

  it("binds response actions to an explicit canonical final segment even when later segments exist", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    const user = userMessage("user-canonical-owner", "Choose the canonical final")
    const finalOwner = assistantTraceMessage(
      "assistant-canonical-final",
      [
        {
          id: "reasoning-canonical-final",
          kind: "reasoning",
          timestamp: 1,
          label: "Reasoning",
          text: "Determine the canonical response.",
          status: "completed",
        },
        {
          id: "tool-canonical-final",
          kind: "tool",
          timestamp: 2,
          label: "Tool",
          title: "resolve-final-owner",
          status: "completed",
        },
        {
          id: "response-canonical-final",
          kind: "text",
          timestamp: 3,
          label: "Assistant",
          text: "Canonical final response.",
          status: "completed",
        },
      ],
      false,
      "turn-canonical-owner",
    )
    const laterSegment = assistantTraceMessage(
      "assistant-canonical-later",
      [{
        id: "response-canonical-later",
        kind: "text",
        timestamp: 4,
        label: "Assistant",
        text: "Later metadata segment.",
        status: "completed",
      }],
      false,
      "turn-canonical-owner",
    )
    const turn = threadTurn("turn-canonical-owner", user, [user, finalOwner], {
      finalSegmentID: finalOwner.segmentID,
      lastMessageID: laterSegment.id,
      status: "completed",
      updatedAt: 4,
    })

    renderThread([user, finalOwner, laterSegment], { activeTurns: [turn] })

    const copyButtons = screen.getAllByRole("button", { name: "Copy assistant response" })
    expect(copyButtons).toHaveLength(1)
    fireEvent.click(copyButtons[0]!)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Canonical final response."))
    expect(screen.getByText("Later metadata segment.")).toBeInTheDocument()
  })

  it("does not create a disclosure for one short reasoning row", () => {
    const user = userMessage("user-short-execution", "Say hello")
    const assistant = assistantTraceMessage(
      "assistant-short-execution",
      [
        {
          id: "reasoning-short-execution",
          kind: "reasoning",
          timestamp: 1,
          label: "Reasoning",
          text: "Respond briefly.",
          status: "completed",
        },
        {
          id: "response-short-execution",
          kind: "text",
          timestamp: 2,
          label: "Assistant",
          text: "Hello!",
          status: "completed",
        },
      ],
      false,
    )
    const turn = threadTurn("turn-short-execution", user, [user, assistant], {
      finalSegmentID: assistant.segmentID,
      lastMessageID: assistant.id,
    })

    renderThread([user, assistant], { activeTurns: [turn] })

    expect(screen.queryByRole("button", { name: /processing details/i })).toBeNull()
    expect(screen.getByText("Respond briefly.")).toBeInTheDocument()
    expect(screen.getByText("Hello!")).toBeInTheDocument()
  })

  it("formats execution durations at the supported boundaries", () => {
    expect(formatThreadExecutionDuration(undefined)).toBe("")
    expect(formatThreadExecutionDuration(999)).toBe("<1s")
    expect(formatThreadExecutionDuration(844_000)).toBe("14m 4s")
    expect(formatThreadExecutionDuration(7_680_000)).toBe("2h 8m")
  })
})

describe("ThreadView assistant response markdown", () => {
  it("opens external links from reasoning trace text", () => {
    window.desktop = {
      openExternalUrl: vi.fn().mockResolvedValue({
        ok: true,
        url: "https://www.baidu.com/",
      }),
    } as unknown as Window["desktop"]

    const { getByRole } = renderThread([
      assistantTraceMessage(
        "assistant-1",
        [
          {
            id: "reasoning-1",
            kind: "reasoning",
            timestamp: 1,
            label: "Reasoning",
            text: "The user asked for https://www.baidu.com",
            status: "running",
          },
        ],
        true,
      ),
    ])

    fireEvent.click(getByRole("link", { name: "https://www.baidu.com" }))

    expect(window.desktop?.openExternalUrl).toHaveBeenCalledWith({
      url: "https://www.baidu.com/",
    })
  })

  it("opens external links on pointer release and suppresses the following click", () => {
    window.desktop = {
      openExternalUrl: vi.fn().mockResolvedValue({
        ok: true,
        url: "https://www.baidu.com/",
      }),
    } as unknown as Window["desktop"]

    const { getByRole } = renderThread([
      assistantTraceMessage(
        "assistant-1",
        [
          {
            id: "response-1",
            kind: "text",
            timestamp: 1,
            label: "Assistant",
            text: "https://www.baidu.com",
            status: "running",
            isStreaming: true,
          },
        ],
        true,
      ),
    ])
    const link = getByRole("link", { name: "https://www.baidu.com" })

    fireEvent.pointerUp(link, { button: 0, clientX: 120, clientY: 80 })
    fireEvent.click(link, { button: 0, clientX: 120, clientY: 80 })

    expect(window.desktop?.openExternalUrl).toHaveBeenCalledTimes(1)
    expect(window.desktop?.openExternalUrl).toHaveBeenCalledWith({
      url: "https://www.baidu.com/",
    })
  })

  it("opens external links when an overlay receives the click above a thread link", () => {
    window.desktop = {
      openExternalUrl: vi.fn().mockResolvedValue({
        ok: true,
        url: "https://www.baidu.com/",
      }),
    } as unknown as Window["desktop"]
    const originalElementsFromPoint = document.elementsFromPoint

    const { getByRole } = renderThread([
      assistantTraceMessage(
        "assistant-1",
        [
          {
            id: "response-1",
            kind: "text",
            timestamp: 1,
            label: "Assistant",
            text: "https://www.baidu.com",
            status: "running",
            isStreaming: true,
          },
        ],
        true,
      ),
    ])
    const link = getByRole("link", { name: "https://www.baidu.com" })
    const overlay = document.createElement("div")
    document.body.appendChild(overlay)

    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: vi.fn(() => [overlay, link]),
    })

    try {
      fireEvent.click(overlay, { clientX: 12, clientY: 24 })
    } finally {
      if (originalElementsFromPoint) {
        Object.defineProperty(document, "elementsFromPoint", {
          configurable: true,
          value: originalElementsFromPoint,
        })
      } else {
        Reflect.deleteProperty(document, "elementsFromPoint")
      }
      overlay.remove()
    }

    expect(window.desktop?.openExternalUrl).toHaveBeenCalledWith({
      url: "https://www.baidu.com/",
    })
  })

  it("renders assistant response markdown as semantic elements", () => {
    const { container, getByRole } = renderThread([
      assistantTraceMessage(
        "assistant-1",
        [
          {
            id: "response-1",
            kind: "text",
            timestamp: 1,
            label: "Assistant",
            text: [
              "## Release notes",
              "",
              "**Ready** to ship.",
              "",
              "| File | Status |",
              "| --- | --- |",
              "| `ThreadView.tsx` | done |",
            ].join("\n"),
            status: "completed",
          },
        ],
        false,
      ),
    ])

    expect(getByRole("heading", { name: "Release notes" })).toBeInTheDocument()
    expect(container.querySelector("strong")?.textContent).toBe("Ready")
    expect(getByRole("table")).toBeInTheDocument()
    expect(container.querySelector(".assistant-section.is-response .thread-markdown")).not.toBeNull()
  })

  it("renders assistant response HTML when the first-line marker requests HTML", () => {
    const { container } = renderThread([
      assistantTraceMessage(
        "assistant-1",
        [
          {
            id: "response-1",
            kind: "text",
            timestamp: 1,
            label: "Assistant",
            text: [
              "<!-- anybox-response-format: html -->",
              "<section>",
              "<h2>HTML response</h2>",
              "<p><strong>Ready</strong> to ship.</p>",
              "<script>bad()</script>",
              "</section>",
            ].join("\n"),
            status: "completed",
          },
        ],
        false,
      ),
    ])
    const frame = container.querySelector(".assistant-section.is-response .thread-html-frame") as HTMLIFrameElement | null
    const srcDoc = frame?.getAttribute("srcdoc") ?? frame?.srcdoc ?? ""

    expect(frame).not.toBeNull()
    expect(container.querySelector(".assistant-section.is-response .thread-html")).not.toBeNull()
    expect(container.querySelector(".assistant-section.is-response .thread-markdown")).toBeNull()
    expect(srcDoc).toContain("HTML response")
    expect(srcDoc).toContain("<strong>Ready</strong>")
    expect(srcDoc).not.toContain("anybox-response-format")
    expect(srcDoc).not.toContain("bad()")
  })

  it("keeps assistant response Markdown when the first-line marker requests Markdown", () => {
    const { container, getByRole } = renderThread([
      assistantTraceMessage(
        "assistant-1",
        [
          {
            id: "response-1",
            kind: "text",
            timestamp: 1,
            label: "Assistant",
            text: "<!-- anybox-response-format: markdown -->\n## Markdown response\n\n**Ready**",
            status: "completed",
          },
        ],
        false,
      ),
    ])

    expect(getByRole("heading", { name: "Markdown response" })).toBeInTheDocument()
    expect(container.querySelector(".assistant-section.is-response .thread-html")).toBeNull()
    expect(container.textContent).not.toContain("anybox-response-format")
  })

  it("opens local file links from completed assistant response markdown", () => {
    const onLocalFileLinkOpen = vi.fn()
    const { getByRole } = renderThread([
      assistantTraceMessage(
        "assistant-1",
        [
          {
            id: "response-1",
            kind: "text",
            timestamp: 1,
            label: "Assistant",
            text: "[ThreadView.tsx](C:/Projects/anybox/packages/desktop/src/renderer/src/app/thread/ThreadView.tsx:42)",
            status: "completed",
          },
        ],
        false,
      ),
    ], {
      onLocalFileLinkOpen,
    })

    fireEvent.click(getByRole("link", { name: "ThreadView.tsx" }))

    expect(onLocalFileLinkOpen).toHaveBeenCalledWith({
      lineRange: {
        startLineNumber: 42,
        endLineNumber: 42,
      },
      path: "C:/Projects/anybox/packages/desktop/src/renderer/src/app/thread/ThreadView.tsx",
    })
  })

  it("opens local file links from streaming assistant response rich text", () => {
    const onLocalFileLinkOpen = vi.fn()
    const { getByRole } = renderThread([
      assistantTraceMessage(
        "assistant-1",
        [
          {
            id: "response-1",
            kind: "text",
            timestamp: 1,
            label: "Assistant",
            text: String.raw`[index.html](C:\新建文件夹 (4)\index.html)`,
            status: "running",
            isStreaming: true,
          },
        ],
        true,
      ),
    ], {
      onLocalFileLinkOpen,
    })

    fireEvent.click(getByRole("link", { name: "index.html" }))

    expect(onLocalFileLinkOpen).toHaveBeenCalledWith({
      lineRange: null,
      path: String.raw`C:\新建文件夹 (4)\index.html`,
    })
  })

  function createProposedPlan(title = "Plan Title") {
    return [
      "<proposed_plan>",
      `# ${title}`,
      "",
      "## Summary",
      "Do the work.",
      "",
      "## Implementation",
      "Change the files.",
      "",
      "## Tests",
      "Run checks.",
      "</proposed_plan>",
    ].join("\n")
  }

  it("renders the latest complete proposed plan as actionable", () => {
    const onProposedPlanConfirm = vi.fn()
    const proposedPlan = createProposedPlan()

    const { getByRole, queryByText } = renderThread([
      assistantTraceMessage("assistant-1", [
        {
          id: "response-1",
          kind: "text",
          timestamp: 1,
          label: "Assistant",
          text: proposedPlan,
          status: "completed",
        },
      ], false),
    ], {
      onProposedPlanConfirm,
    })

    expect(getByRole("article", { name: "Proposed plan" })).toBeInTheDocument()
    expect(getByRole("heading", { name: "Plan Title" })).toBeInTheDocument()
    expect(queryByText("<proposed_plan>")).not.toBeInTheDocument()
    expect(getByRole("button", { name: "取消" })).toBeEnabled()
    expect(getByRole("button", { name: "确认实施" })).toBeEnabled()
  })

  it("renders proposed plan blocks even when the model adds a preface", () => {
    const onProposedPlanConfirm = vi.fn()
    const proposedPlan = `I will draft the plan now.\n\n${createProposedPlan("Prefaced Plan")}`

    const { getByRole, queryByText } = renderThread([
      assistantTraceMessage("assistant-1", [
        {
          id: "response-1",
          kind: "text",
          timestamp: 1,
          label: "Assistant",
          text: proposedPlan,
          status: "completed",
        },
      ], false),
    ], {
      onProposedPlanConfirm,
    })

    expect(getByRole("article", { name: "Proposed plan" })).toBeInTheDocument()
    expect(getByRole("heading", { name: "Prefaced Plan" })).toBeInTheDocument()
    expect(queryByText("<proposed_plan>")).not.toBeInTheDocument()
    expect(queryByText("I will draft the plan now.")).not.toBeInTheDocument()
    expect(getByRole("button", { name: "取消" })).toBeEnabled()
    expect(getByRole("button", { name: "确认实施" })).toBeEnabled()
  })

  it("removes proposed plan actions and shows cancelled state after cancel", () => {
    const onProposedPlanConfirm = vi.fn()
    const proposedPlan = createProposedPlan()

    const { getByRole, queryByRole, getByText } = renderThread([
      assistantTraceMessage("assistant-1", [
        {
          id: "response-1",
          kind: "text",
          timestamp: 1,
          label: "Assistant",
          text: proposedPlan,
          status: "completed",
        },
      ], false),
    ], {
      onProposedPlanConfirm,
    })

    fireEvent.click(getByRole("button", { name: "取消" }))

    expect(getByText("已取消")).toBeInTheDocument()
    expect(queryByRole("button", { name: "取消" })).not.toBeInTheDocument()
    expect(queryByRole("button", { name: "确认实施" })).not.toBeInTheDocument()
    expect(onProposedPlanConfirm).not.toHaveBeenCalled()
  })

  it("removes proposed plan actions and shows confirmed state after confirm", async () => {
    const onProposedPlanConfirm = vi.fn().mockResolvedValue(undefined)
    const proposedPlan = createProposedPlan()

    const { getByRole, queryByRole, getByText } = renderThread([
      assistantTraceMessage("assistant-1", [
        {
          id: "response-1",
          kind: "text",
          timestamp: 1,
          label: "Assistant",
          text: proposedPlan,
          status: "completed",
        },
      ], false),
    ], {
      onProposedPlanConfirm,
    })

    fireEvent.click(getByRole("button", { name: "确认实施" }))

    expect(onProposedPlanConfirm).toHaveBeenCalledWith({ planMarkdown: proposedPlan })
    await waitFor(() => expect(getByText("已确认")).toBeInTheDocument())
    expect(queryByRole("button", { name: "取消" })).not.toBeInTheDocument()
    expect(queryByRole("button", { name: "确认实施" })).not.toBeInTheDocument()
  })

  it("keeps proposed plan actions available and shows an error when confirm fails", async () => {
    const onProposedPlanConfirm = vi.fn().mockRejectedValue(new Error("Approval failed"))
    const proposedPlan = createProposedPlan()

    const { getByRole, getByText } = renderThread([
      assistantTraceMessage("assistant-1", [
        {
          id: "response-1",
          kind: "text",
          timestamp: 1,
          label: "Assistant",
          text: proposedPlan,
          status: "completed",
        },
      ], false),
    ], {
      onProposedPlanConfirm,
    })

    fireEvent.click(getByRole("button", { name: "确认实施" }))

    await waitFor(() => expect(getByText("Approval failed")).toBeInTheDocument())
    expect(getByRole("button", { name: "取消" })).toBeEnabled()
    expect(getByRole("button", { name: "确认实施" })).toBeEnabled()
  })

  it("renders historical complete proposed plans without actions", () => {
    const proposedPlan = createProposedPlan("Historical Plan")

    const { getByRole, queryByRole, queryByText } = renderThread([
      assistantTraceMessage("assistant-1", [
        {
          id: "response-1",
          kind: "text",
          timestamp: 1,
          label: "Assistant",
          text: proposedPlan,
          status: "completed",
        },
      ], false),
      userMessage("user-1", "Thanks"),
    ])

    expect(getByRole("heading", { name: "Historical Plan" })).toBeInTheDocument()
    expect(queryByText("已过期")).not.toBeInTheDocument()
    expect(queryByRole("button", { name: "取消" })).not.toBeInTheDocument()
    expect(queryByRole("button", { name: "确认实施" })).not.toBeInTheDocument()
  })

  it("hides proposed plan actions once a newer message appears", () => {
    const onProposedPlanConfirm = vi.fn()
    const proposedPlan = createProposedPlan("Fresh Plan")
    const planMessage = assistantTraceMessage("assistant-1", [
      {
        id: "response-1",
        kind: "text",
        timestamp: 1,
        label: "Assistant",
        text: proposedPlan,
        status: "completed",
      },
    ], false)

    const { getByRole, props, queryByRole, queryByText, rerender } = renderThread([planMessage], {
      onProposedPlanConfirm,
    })

    expect(getByRole("button", { name: "取消" })).toBeEnabled()
    expect(getByRole("button", { name: "确认实施" })).toBeEnabled()

    rerender(<ThreadView {...props} activeMessages={[planMessage, userMessage("user-1", "Continue")]} />)

    expect(getByRole("heading", { name: "Fresh Plan" })).toBeInTheDocument()
    expect(queryByText("已过期")).not.toBeInTheDocument()
    expect(queryByRole("button", { name: "取消" })).not.toBeInTheDocument()
    expect(queryByRole("button", { name: "确认实施" })).not.toBeInTheDocument()
  })

  it("renders streaming proposed plan responses immediately with disabled actions", () => {
    const onProposedPlanConfirm = vi.fn()
    const proposedPlan = [
      "<proposed_plan>",
      "# Streaming Plan",
      "",
      "## Summary",
      "Still drafting.",
    ].join("\n")

    const { getByRole, queryByText } = renderThread([
      assistantTraceMessage(
        "assistant-1",
        [
          {
            id: "response-1",
            kind: "text",
            timestamp: 1,
            label: "Assistant",
            text: proposedPlan,
            status: "running",
            isStreaming: true,
          },
        ],
        true,
      ),
    ], {
      onProposedPlanConfirm,
    })

    expect(getByRole("article", { name: "Proposed plan" })).toBeInTheDocument()
    expect(getByRole("heading", { name: "Streaming Plan" })).toBeInTheDocument()
    expect(queryByText("<proposed_plan>")).not.toBeInTheDocument()
    expect(getByRole("button", { name: "取消" })).toBeDisabled()
    expect(getByRole("button", { name: "确认实施" })).toBeDisabled()

    fireEvent.click(getByRole("button", { name: "确认实施" }))
    expect(onProposedPlanConfirm).not.toHaveBeenCalled()
  })

  it("enables proposed plan actions when the close tag arrives during streaming", () => {
    const onProposedPlanConfirm = vi.fn()
    const partialPlan = [
      "<proposed_plan>",
      "# Streaming Plan",
      "",
      "## Summary",
      "Still drafting.",
    ].join("\n")
    const completePlan = [
      partialPlan,
      "",
      "## Tests",
      "Run checks.",
      "</proposed_plan>",
    ].join("\n")
    const buildResponseItem = (text: string): AssistantTraceItem => ({
      id: "response-1",
      kind: "text",
      timestamp: 1,
      label: "Assistant",
      text,
      status: "running",
      isStreaming: true,
    })

    const { getByRole, props, rerender } = renderThread([
      assistantTraceMessage("assistant-1", [buildResponseItem(partialPlan)], true),
    ], {
      onProposedPlanConfirm,
    })

    expect(getByRole("button", { name: "确认实施" })).toBeDisabled()

    rerender(<ThreadView {...props} activeMessages={[assistantTraceMessage("assistant-1", [buildResponseItem(completePlan)], true)]} />)

    expect(getByRole("button", { name: "取消" })).toBeEnabled()
    expect(getByRole("button", { name: "确认实施" })).toBeEnabled()

    fireEvent.click(getByRole("button", { name: "确认实施" }))
    expect(onProposedPlanConfirm).toHaveBeenCalledWith({ planMarkdown: completePlan })
  })

  it("keeps reasoning and tool markdown-like content as plain rich text", () => {
    const { container, getByRole, queryByRole } = renderThread([
      assistantTraceMessage(
        "assistant-1",
        [
          {
            id: "reasoning-1",
            kind: "reasoning",
            timestamp: 1,
            label: "Reasoning",
            text: "## Thinking\n\n**Plain reasoning**",
            status: "running",
            isStreaming: true,
          },
          {
            id: "tool-1",
            kind: "tool",
            timestamp: 1,
            label: "Tool",
            title: "Shell",
            detail: "## Tool output\n\n**Plain tool output**",
            status: "completed",
          },
        ],
        true,
      ),
    ])

    expect(queryByRole("heading", { name: "Thinking" })).toBeNull()
    expect(container.textContent).toContain("## Thinking")

    fireEvent.click(getByRole("button", { name: /Shell/ }))

    expect(getByRole("button", { name: "Expand Shell output content" })).toBeInTheDocument()
    expect(queryByRole("heading", { name: "Tool output" })).toBeNull()
    expect(container.textContent).toContain("## Tool output")
  })

  it("renders streaming responses as Markdown before completion", () => {
    const { container } = renderThread([
      assistantTraceMessage(
        "assistant-1",
        [
          {
            id: "response-1",
            kind: "text",
            timestamp: 1,
            label: "Assistant",
            text: "## Streaming\n\n**Ready** to ship.",
            status: "running",
            isStreaming: true,
          },
        ],
        true,
      ),
    ])
    const streamingResponse = container.querySelector(
      ".assistant-section.is-response .trace-item.is-streaming .trace-item-text",
    )

    expect(streamingResponse).not.toBeNull()
    expect(streamingResponse).toHaveClass("thread-markdown")
    expect(screen.getByRole("heading", { name: "Streaming" })).toBeInTheDocument()
    expect(container.querySelector(".assistant-section.is-response strong")?.textContent).toBe("Ready")
    expect(streamingResponse?.textContent).not.toContain("**Ready**")
  })

  it("bounds very large streaming Markdown while keeping the latest tail visible", () => {
    const text = `## Streaming\n\n${"middle ".repeat(4_000)}\n\nLatest live token`
    const { container } = renderThread([
      assistantTraceMessage(
        "assistant-1",
        [
          {
            id: "response-1",
            kind: "text",
            timestamp: 1,
            label: "Assistant",
            text,
            status: "running",
            isStreaming: true,
          },
        ],
        true,
      ),
    ])

    const preview = container.querySelector<HTMLElement>(
      '[data-thread-streaming-render-mode="plain-preview"]',
    )
    expect(preview).not.toBeNull()
    expect(preview).toHaveClass("thread-markdown")
    expect(preview).toHaveTextContent("Latest live token")
    expect(screen.queryByRole("heading", { name: "Streaming" })).toBeNull()
  })

  it("renders streaming Markdown-marked responses as Markdown without showing the marker", () => {
    const { container, getByRole } = renderThread([
      assistantTraceMessage(
        "assistant-1",
        [
          {
            id: "response-1",
            kind: "text",
            timestamp: 1,
            label: "Assistant",
            text: "<!-- anybox-response-format: markdown -->\n## Streaming Markdown\n\n**Ready**",
            status: "running",
            isStreaming: true,
          },
        ],
        true,
      ),
    ])
    const streamingResponse = container.querySelector(
      ".assistant-section.is-response .trace-item.is-streaming .trace-item-text",
    )

    expect(streamingResponse).not.toBeNull()
    expect(streamingResponse).toHaveClass("thread-markdown")
    expect(getByRole("heading", { name: "Streaming Markdown" })).toBeInTheDocument()
    expect(container.textContent).not.toContain("anybox-response-format")
  })

  it("hides response format markers while keeping streaming HTML-marked responses on the rich text path", () => {
    const { container } = renderThread([
      assistantTraceMessage(
        "assistant-1",
        [
          {
            id: "response-1",
            kind: "text",
            timestamp: 1,
            label: "Assistant",
            text: "<!-- anybox-response-format: html -->\n<p><strong>Streaming</strong></p>",
            status: "running",
            isStreaming: true,
          },
        ],
        true,
      ),
    ])
    const streamingResponse = container.querySelector(
      ".assistant-section.is-response .trace-item.is-streaming .trace-item-text",
    )

    expect(streamingResponse).not.toBeNull()
    expect(streamingResponse).not.toHaveClass("thread-markdown")
    expect(container.querySelector(".assistant-section.is-response .thread-html")).toBeNull()
    expect(streamingResponse?.textContent).toContain("<p><strong>Streaming</strong></p>")
    expect(streamingResponse?.textContent).not.toContain("anybox-response-format")
  })
})

describe("ThreadView message actions", () => {
  it("copies user message text from the user message action", () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })

    const { getByRole } = renderThread([userMessage("user-1", "Hello from user")])

    fireEvent.click(getByRole("button", { name: "Copy user message" }))

    expect(writeText).toHaveBeenCalledWith("Hello from user")
  })

  it("keeps short user messages expanded without a long-message control", () => {
    const { container, queryByRole } = renderThread([userMessage("user-1", "Short prompt")])

    expect(container.querySelector(".user-bubble-text-frame.is-collapsible")).toBeNull()
    expect(queryByRole("button", { name: "Show full message" })).toBeNull()
  })

  it("renders sent raster image attachments as thumbnails", () => {
    const imagePath = "C:\\Temp\\screenshot.png"

    renderThread([
      {
        ...userMessage("user-image-attachment", "Use this image"),
        attachments: [{ name: "screenshot.png", path: imagePath }],
      },
    ])

    const image = screen.getByRole("img", { name: "screenshot.png" })

    expect(image).toHaveClass("user-bubble-attachment-thumbnail")
    expect(image).toHaveAttribute(
      "src",
      `anybox-local-image://image?source=${encodeURIComponent(imagePath)}`,
    )
  })

  it("keeps sent PDF, SVG, and pathless attachments as file chips", () => {
    renderThread([
      {
        ...userMessage("user-file-attachments", "Use these files"),
        attachments: [
          { name: "brief.pdf", path: "C:\\Refs\\brief.pdf" },
          { name: "icon.svg", path: "C:\\Refs\\icon.svg" },
          { name: "missing-path.png" },
        ],
      },
    ])

    expect(screen.getByText("brief.pdf")).toHaveClass("user-bubble-chip-label")
    expect(screen.getByText("icon.svg")).toHaveClass("user-bubble-chip-label")
    expect(screen.getByText("missing-path.png")).toHaveClass("user-bubble-chip-label")
    expect(screen.queryByRole("img", { name: "brief.pdf" })).not.toBeInTheDocument()
    expect(screen.queryByRole("img", { name: "icon.svg" })).not.toBeInTheDocument()
    expect(screen.queryByRole("img", { name: "missing-path.png" })).not.toBeInTheDocument()
  })

  it("falls back to a sent file chip when a user attachment thumbnail fails to load", async () => {
    renderThread([
      {
        ...userMessage("user-broken-image-attachment", "Use this image"),
        attachments: [{ name: "screenshot.png", path: "C:\\Temp\\screenshot.png" }],
      },
    ])

    fireEvent.error(screen.getByRole("img", { name: "screenshot.png" }))

    expect(await screen.findByText("screenshot.png")).toHaveClass("user-bubble-chip-label")
    expect(screen.queryByRole("img", { name: "screenshot.png" })).not.toBeInTheDocument()
  })

  it("collapses very long user messages by default and scrolls to the end when expanded", () => {
    const scrollIntoView = vi.fn()
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    const originalRequestAnimationFrame = window.requestAnimationFrame
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    }

    try {
      const longText = Array.from({ length: 24 }, (_, index) => `Line ${index + 1}: long pasted content`).join("\n")
      const { container, getByRole } = renderThread([userMessage("user-long", longText)])
      const textFrame = container.querySelector(".user-bubble-text-frame") as HTMLElement | null
      const toggleButton = getByRole("button", { name: "Show full message" })

      expect(textFrame).not.toBeNull()
      expect(textFrame).toHaveClass("is-collapsible")
      expect(textFrame).toHaveClass("is-collapsed")
      expect(toggleButton).toHaveAttribute("aria-expanded", "false")

      fireEvent.click(toggleButton)

      expect(textFrame).toHaveClass("is-expanded")
      expect(textFrame).not.toHaveClass("is-collapsed")
      expect(getByRole("button", { name: "Collapse message" })).toHaveAttribute("aria-expanded", "true")
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "end", inline: "nearest" })
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView
      window.requestAnimationFrame = originalRequestAnimationFrame
    }
  })

  it("renders steering submission status on user messages", () => {
    const insertedMessage: UserThreadMessage = {
      ...userMessage("user-steer", "Adjust the current task"),
      submissionMode: "steer",
      streamInsertion: {
        assistantThreadMessageID: "assistant-live",
        afterItemCount: 0,
        status: "consumed",
      },
    }

    renderThread([
      assistantTraceMessage(
        "assistant-live",
        [
          {
            id: "assistant-before",
            kind: "text",
            timestamp: 1,
            label: "Assistant",
            text: "Before steer",
            status: "completed",
          },
        ],
        false,
      ),
      insertedMessage,
    ])

    expect(screen.getByText("提交，但不中断模型运行")).toBeInTheDocument()
    expect(screen.getByText("下次模型/工具调用后")).toBeInTheDocument()
  })

  it("renders active steer-marked user messages without insertion metadata as committed messages", () => {
    const steerMessage: UserThreadMessage = {
      ...userMessage("user-steer", "Adjust during tool input"),
      submissionMode: "steer",
    }

    const { container } = renderThread([
      assistantTraceMessage(
        "assistant-live",
        [
          {
            id: "assistant-tool",
            kind: "tool",
            timestamp: 1,
            label: "Tool",
            title: "load-skill",
            status: "running",
          },
        ],
        true,
      ),
      steerMessage,
    ])

    expect(container.querySelectorAll(".user-message")).toHaveLength(1)
    expect(screen.getByText("Adjust during tool input")).toBeInTheDocument()
  })

  it("renders active queued-marked user messages as committed messages", () => {
    const queuedMessage: UserThreadMessage = {
      ...userMessage("user-queued", "Adjust patch target"),
      submissionMode: "queued",
    }

    const { container } = renderThread([
      assistantTraceMessage(
        "assistant-live",
        [
          {
            id: "assistant-tool",
            kind: "tool",
            timestamp: 1,
            label: "Tool",
            title: "apply_patch",
            status: "pending",
            toolInputText: "*** Begin Patch",
          },
        ],
        true,
      ),
      queuedMessage,
    ])

    expect(container.querySelectorAll(".user-message")).toHaveLength(1)
    expect(screen.getByText("Adjust patch target")).toBeInTheDocument()
  })

  it("renders stream-inserted steer messages between live assistant trace items", () => {
    const insertedMessage: UserThreadMessage = {
      ...userMessage("user-steer", "Adjust the current task"),
      submissionMode: "steer",
      streamInsertion: {
        assistantThreadMessageID: "assistant-live",
        afterItemCount: 1,
      },
    }
    const { container } = renderThread([
      assistantTraceMessage(
        "assistant-live",
        [
          {
            id: "assistant-before",
            kind: "text",
            timestamp: 1,
            label: "Assistant",
            text: "Before steer",
            status: "completed",
          },
          {
            id: "assistant-after",
            kind: "text",
            timestamp: 2,
            label: "Assistant",
            text: "After steer",
            status: "running",
          },
        ],
        true,
      ),
      insertedMessage,
    ])

    const text = container.textContent ?? ""
    expect(text.indexOf("Before steer")).toBeLessThan(text.indexOf("Adjust the current task"))
    expect(text.indexOf("Adjust the current task")).toBeLessThan(text.indexOf("After steer"))
    expect(container.querySelectorAll(".user-message")).toHaveLength(1)
    expect(container.querySelector(".assistant-stream-insertion-user-message")).not.toBeNull()
  })

  it("places stream-inserted steer messages after the following tool call", () => {
    const insertedMessage: UserThreadMessage = {
      ...userMessage("user-steer", "Hello during tool step"),
      submissionMode: "steer",
      streamInsertion: {
        assistantThreadMessageID: "assistant-live",
        afterItemCount: 1,
      },
    }
    const { container } = renderThread([
      assistantTraceMessage(
        "assistant-live",
        [
          {
            id: "assistant-before",
            kind: "text",
            timestamp: 1,
            label: "Assistant",
            text: "I will load a skill",
            status: "completed",
          },
          {
            id: "assistant-tool",
            kind: "tool",
            timestamp: 2,
            label: "Tool",
            title: "load-skill",
            status: "completed",
          },
          {
            id: "assistant-after",
            kind: "text",
            timestamp: 3,
            label: "Assistant",
            text: "After the steer",
            status: "running",
          },
        ],
        true,
      ),
      insertedMessage,
    ])

    const text = container.textContent ?? ""
    expect(text.indexOf("I will load a skill")).toBeLessThan(text.indexOf("load-skill"))
    expect(text.indexOf("load-skill")).toBeLessThan(text.indexOf("Hello during tool step"))
    expect(text.indexOf("Hello during tool step")).toBeLessThan(text.indexOf("After the steer"))
  })

  it("renders assistant message file changes after the final assistant output and handles card actions", async () => {
    const onFileChangeSelect = vi.fn()
    const onMessageDiffReview = vi.fn().mockResolvedValue(undefined)
    const onMessageDiffRestore = vi.fn().mockResolvedValue(undefined)
    const confirmRestore = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true)
    const diffSummary = {
      diffSummary: {
        stats: {
          files: 2,
          additions: 5,
          deletions: 1,
        },
        diffs: [
          {
            file: "src/App.tsx",
            additions: 3,
            deletions: 1,
            patch: [
              "diff --git a/src/App.tsx b/src/App.tsx",
              "--- a/src/App.tsx",
              "+++ b/src/App.tsx",
              "@@ -1 +1 @@",
              "-old app",
              "+new app",
            ].join("\n"),
          },
          { file: "src/styles.css", additions: 2, deletions: 0 },
        ],
      },
    }

    const { getByRole, getByText, queryByRole } = renderThread(
      [
        userMessage("user-with-diff", "Update the app"),
        assistantTraceMessage(
          "assistant-first",
          [
            {
              id: "response-1",
              kind: "text",
              timestamp: 1,
              label: "Assistant",
              text: "First model call finished.",
              status: "completed",
            },
          ],
          false,
        ),
        {
          ...assistantTraceMessage(
            "assistant-final",
            [
              {
                id: "response-2",
                kind: "text",
                timestamp: 2,
                label: "Assistant",
                text: "Final answer after file updates.",
                status: "completed",
              },
            ],
            false,
          ),
          ...diffSummary,
        },
      ],
      { onFileChangeSelect, onMessageDiffRestore, onMessageDiffReview },
    )

    const summaryButton = getByRole("button", { name: /2 个文件已更改/i })
    const finalAssistantOutput = getByText("Final answer after file updates.")

    expect(summaryButton).toBeInTheDocument()
    expect(summaryButton).toHaveAttribute("aria-expanded", "false")
    expect(finalAssistantOutput.compareDocumentPosition(summaryButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(getByRole("button", { name: "审核" })).toBeInTheDocument()
    expect(getByRole("button", { name: "撤销" })).toBeInTheDocument()
    expect(queryByRole("button", { name: /审核\s+src\/App\.tsx/i })).toBeNull()
    expect(queryByRole("button", { name: /展开\s+src\/App\.tsx\s+变更/i })).toBeNull()

    fireEvent.click(summaryButton)
    expect(summaryButton).toHaveAttribute("aria-expanded", "true")
    expect(getByRole("button", { name: /展开\s+src\/App\.tsx\s+变更/i })).toBeInTheDocument()
    expect(queryByRole("region", { name: "Diff preview for src/App.tsx" })).not.toBeInTheDocument()

    fireEvent.click(getByRole("button", { name: "审核" }))
    fireEvent.click(getByRole("button", { name: /展开\s+src\/App\.tsx\s+变更/i }))
    expect(getByRole("region", { name: "Diff preview for src/App.tsx" })).toBeInTheDocument()
    expect(getByText("old app")).toBeInTheDocument()
    expect(getByText("new app")).toBeInTheDocument()
    expect(onFileChangeSelect).not.toHaveBeenCalled()
    fireEvent.click(getByRole("button", { name: /审核\s+src\/styles\.css/i }))
    fireEvent.click(getByRole("button", { name: "收起文件变更" }))
    expect(queryByRole("button", { name: /审核\s+src\/App\.tsx/i })).toBeNull()
    fireEvent.click(getByRole("button", { name: "展开文件变更" }))
    fireEvent.click(getByRole("button", { name: /撤销/i }))

    expect(onFileChangeSelect).toHaveBeenCalledWith("src/styles.css")
    expect(onMessageDiffReview).toHaveBeenCalledWith(["src/App.tsx", "src/styles.css"])
    expect(confirmRestore).toHaveBeenCalledTimes(1)
    expect(confirmRestore).toHaveBeenCalledWith(
      "尝试反向应用这 2 个文件的变更？不能自动撤销的文件会提示失败，已成功撤销的文件会保留结果。",
    )
    expect(onMessageDiffRestore).not.toHaveBeenCalled()

    fireEvent.click(getByRole("button", { name: /撤销/i }))

    await waitFor(() => {
      expect(onMessageDiffRestore).toHaveBeenCalledWith([
        expect.objectContaining({
          file: "src/App.tsx",
          patch: expect.stringContaining("-old app"),
        }),
        {
          file: "src/styles.css",
          additions: 2,
          deletions: 0,
        },
      ])
    })
    confirmRestore.mockRestore()
  })

  it("hydrates message file change rows from the assistant patch trace before expanding inline", () => {
    const onFileChangeSelect = vi.fn()
    renderThread(
      [
        userMessage("user-diff-summary-only", "Create a Tetris game"),
        {
          ...assistantTraceMessage(
            "assistant-tetris",
            [
              {
                id: "patch-tetris",
                kind: "patch",
                timestamp: 1,
                label: "Patch",
                title: "1 file change (+167 -0)",
                fileChanges: [
                  {
                    file: "tetris.html",
                    additions: 167,
                    deletions: 0,
                    patch: [
                      "diff --git a/tetris.html b/tetris.html",
                      "--- a/tetris.html",
                      "+++ b/tetris.html",
                      "@@ -0,0 +1,2 @@",
                      "+<canvas id=\"board\"></canvas>",
                      "+<script>startGame()</script>",
                    ].join("\n"),
                  },
                ],
                status: "completed",
              },
            ],
            false,
          ),
          diffSummary: {
            stats: {
              files: 1,
              additions: 167,
              deletions: 0,
            },
            diffs: [{ file: "tetris.html", additions: 167, deletions: 0 }],
          },
        },
      ],
      {
        onFileChangeSelect,
      },
    )

    fireEvent.click(screen.getByRole("button", { name: /1 个文件已更改/i }))
    fireEvent.click(screen.getByRole("button", { name: "展开 tetris.html 变更" }))

    expect(screen.getByRole("region", { name: "Diff preview for tetris.html" })).toBeInTheDocument()
    expect(screen.getByText("<canvas id=\"board\"></canvas>")).toBeInTheDocument()
    expect(screen.getByText("<script>startGame()</script>")).toBeInTheDocument()
    expect(onFileChangeSelect).not.toHaveBeenCalled()
  })

  it("keeps inline diffs scoped to each message when the same file changes later", () => {
    const buildDiffUserMessage = (id: string): UserThreadMessage => userMessage(id, "Update shared file")
    const buildPatchAssistantMessage = (id: string, oldValue: string, newValue: string): AssistantThreadMessage => ({
      ...assistantTraceMessage(
        id,
        [
          {
            id: `${id}-patch`,
            kind: "patch",
            timestamp: 1,
            label: "Patch",
            title: "1 file change (+1 -1)",
            fileChanges: [
              {
                file: "src/shared.ts",
                additions: 1,
                deletions: 1,
                patch: [
                  "diff --git a/src/shared.ts b/src/shared.ts",
                  "--- a/src/shared.ts",
                  "+++ b/src/shared.ts",
                  "@@ -1 +1 @@",
                  `-const value = "${oldValue}"`,
                  `+const value = "${newValue}"`,
                ].join("\n"),
              },
            ],
            status: "completed",
          },
        ],
        false,
      ),
      diffSummary: {
        stats: {
          files: 1,
          additions: 1,
          deletions: 1,
        },
        diffs: [{ file: "src/shared.ts", additions: 1, deletions: 1 }],
      },
    })

    renderThread([
      buildDiffUserMessage("user-first-diff"),
      buildPatchAssistantMessage("assistant-first-diff", "old", "first message"),
      buildDiffUserMessage("user-second-diff"),
      buildPatchAssistantMessage("assistant-second-diff", "first message", "second message"),
    ])

    screen.getAllByRole("button", { name: /1 个文件已更改/i }).forEach((button) => {
      fireEvent.click(button)
    })
    const sharedFileButtons = screen.getAllByRole("button", { name: "展开 src/shared.ts 变更" })
    fireEvent.click(sharedFileButtons[0]!)

    expect(screen.getByText('const value = "old"')).toBeInTheDocument()
    expect(screen.getByText('const value = "first message"')).toBeInTheDocument()
    expect(screen.queryByText('const value = "second message"')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "展开 src/shared.ts 变更" }))

    expect(screen.getByText('const value = "second message"')).toBeInTheDocument()
  })

  it("uses the active workspace diff only for the latest message without a saved patch", () => {
    const onMessageDiffSummaryHydrate = vi.fn()
    const buildDiffUserMessage = (id: string): UserThreadMessage => userMessage(id, "Update shared file")
    const buildDiffAssistantMessage = (id: string, text: string): AssistantThreadMessage => ({
      ...assistantTraceMessage(
        id,
        [
          {
            id: `${id}-response`,
            kind: "text",
            timestamp: 1,
            label: "Assistant",
            text,
            status: "completed",
          },
        ],
        false,
      ),
      diffSummary: {
        stats: {
          files: 1,
          additions: 1,
          deletions: 0,
        },
        diffs: [{ file: "src/shared.ts", additions: 1, deletions: 0 }],
      },
    })

    renderThread(
      [
        buildDiffUserMessage("user-old-summary"),
        buildDiffAssistantMessage("assistant-old-summary", "Old message finished."),
        buildDiffUserMessage("user-latest-summary"),
        buildDiffAssistantMessage("assistant-latest-summary", "Latest message finished."),
      ],
      {
        activeSessionDiff: {
          stats: {
            files: 1,
            additions: 1,
            deletions: 0,
          },
          diffs: [
            {
              file: "src/shared.ts",
              additions: 1,
              deletions: 0,
              patch: [
                "diff --git a/src/shared.ts b/src/shared.ts",
                "--- a/src/shared.ts",
                "+++ b/src/shared.ts",
                "@@ -0,0 +1 @@",
                "+const value = \"latest workspace\"",
              ].join("\n"),
            },
          ],
        },
        onMessageDiffSummaryHydrate,
      },
    )

    screen.getAllByRole("button", { name: /1 个文件已更改/i }).forEach((button) => {
      fireEvent.click(button)
    })
    const latestSharedPatchButtons = screen.getAllByRole("button", { name: "展开 src/shared.ts 变更" })
    expect(latestSharedPatchButtons).toHaveLength(1)
    fireEvent.click(latestSharedPatchButtons[0]!)

    expect(screen.getByRole("region", { name: "Diff preview for src/shared.ts" })).toBeInTheDocument()
    expect(screen.getByText('const value = "latest workspace"')).toBeInTheDocument()
    expect(onMessageDiffSummaryHydrate).toHaveBeenCalledWith(
      "assistant-latest-summary",
      expect.objectContaining({
        diffs: [
          expect.objectContaining({
            file: "src/shared.ts",
            patch: expect.stringContaining('const value = "latest workspace"'),
          }),
        ],
      }),
    )
  })

  it("shows user message restore progress and errors", async () => {
    const confirmRestore = vi.spyOn(window, "confirm").mockReturnValue(true)
    let rejectRestore: (error: Error) => void = () => undefined
    const onMessageDiffRestore = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectRestore = reject
        }),
    )

    renderThread([
      {
        ...userMessage("user-restore-error", "Restore changes"),
        diffSummary: {
          stats: {
            files: 1,
            additions: 1,
            deletions: 0,
          },
          diffs: [{ file: "src/App.tsx", additions: 1, deletions: 0 }],
        },
      },
    ], { onMessageDiffRestore })

    const restoreButton = screen.getByRole("button", { name: /撤销/i })
    fireEvent.click(restoreButton)

    await waitFor(() => {
      expect(restoreButton).toBeDisabled()
    })

    rejectRestore(new Error("restore failed"))

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("restore failed")
    })
    expect(restoreButton).not.toBeDisabled()
    confirmRestore.mockRestore()
  })

  it("hides the user message file change summary when the diff is empty", () => {
    renderThread([
      {
        ...userMessage("user-empty-diff", "No changes"),
        diffSummary: {
          diffs: [],
        },
      },
    ])

    expect(screen.queryByRole("button", { name: /个文件已更改/i })).toBeNull()
  })

  it("uses the latest action callback without rebuilding the memoized viewport", () => {
    const firstFork = vi.fn()
    const latestFork = vi.fn()
    const message = assistantTraceMessage(
      "assistant-1",
      [
        {
          id: "response-1",
          kind: "text",
          timestamp: 1,
          label: "Assistant",
          text: "Done",
          status: "completed",
        },
      ],
      false,
    )
    const threadColumnRef = createRef<HTMLDivElement | null>()
    const props = createThreadProps([message], threadColumnRef, {
      onForkFromMessage: firstFork,
    })
    const { rerender } = render(<ThreadView {...props} />)

    rerender(<ThreadView {...props} onForkFromMessage={latestFork} />)
    fireEvent.click(screen.getByRole("button", { name: "Open Branch Chat from here" }))

    expect(firstFork).not.toHaveBeenCalled()
    expect(latestFork).toHaveBeenCalledWith("assistant-1")
  })

  it("updates action capabilities when a callback becomes available", () => {
    const onForkFromMessage = vi.fn()
    const message = assistantTraceMessage(
      "assistant-1",
      [
        {
          id: "response-1",
          kind: "text",
          timestamp: 1,
          label: "Assistant",
          text: "Done",
          status: "completed",
        },
      ],
      false,
    )
    const threadColumnRef = createRef<HTMLDivElement | null>()
    const props = createThreadProps([message], threadColumnRef)
    const { rerender } = render(<ThreadView {...props} />)

    expect(screen.queryByRole("button", { name: "Open Branch Chat from here" })).toBeNull()

    rerender(<ThreadView {...props} onForkFromMessage={onForkFromMessage} />)
    fireEvent.click(screen.getByRole("button", { name: "Open Branch Chat from here" }))

    expect(onForkFromMessage).toHaveBeenCalledWith("assistant-1")
  })

  it("hides final response actions while the session is still running", () => {
    const onBranchSelect = vi.fn()
    const onForkFromMessage = vi.fn()
    const messageTree: SessionMessageTree = {
      activeMessageID: "message-1",
      activePathMessageIDs: ["message-1"],
      branchOptionsByParentID: {
        "message-1": [
          {
            childMessageID: "child-1",
            index: 0,
            isActive: true,
            label: "Branch 1",
            leafMessageID: "leaf-1",
            parentMessageID: "message-1",
            preview: "First branch",
            total: 2,
          },
          {
            childMessageID: "child-2",
            index: 1,
            isActive: false,
            label: "Branch 2",
            leafMessageID: "leaf-2",
            parentMessageID: "message-1",
            preview: "Second branch",
            total: 2,
          },
        ],
      },
      childIDsByParentID: {},
      nodesByID: {},
      rootMessageIDs: [],
      sessionID: "session-1",
    }
    const completedIntermediateMessage = {
      ...assistantTraceMessage(
        "assistant-1",
        [
          {
            id: "response-1",
            kind: "text",
            timestamp: 1,
            label: "Assistant",
            text: "Now I will create the tasks.",
            status: "completed",
          },
        ],
        false,
      ),
      messageID: "message-1",
    }

    const { container, queryByRole } = renderThread([userMessage("user-1", "Prompt"), completedIntermediateMessage], {
      isSessionRunning: true,
      messageTree,
      onBranchSelect,
      onForkFromMessage,
    })

    expect(queryByRole("button", { name: "Copy assistant response" })).toBeNull()
    expect(queryByRole("button", { name: "Open Branch Chat from here" })).toBeNull()
    expect(container.querySelector(".assistant-branch-switcher")).toBeNull()
    expect(container.querySelector(".assistant-response-actions")).toBeNull()
  })

  it("shows assistant response actions in the assistant message footer for the final response", () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    const { container, getAllByRole, getByRole, getByText } = renderThread(
      [
        userMessage("user-with-diff", "Please update the file."),
        {
          ...assistantTraceMessage(
            "assistant-1",
            [
              {
                id: "response-1",
                kind: "text",
                timestamp: 1,
                label: "Assistant",
                text: "I will check the directory first.",
                status: "completed",
              },
              {
                id: "tool-1",
                kind: "tool",
                timestamp: 2,
                label: "Tool",
                title: "list-directory",
                text: "index.html",
                status: "completed",
              },
              {
                id: "response-2",
                kind: "text",
                timestamp: 3,
                label: "Assistant",
                text: "Deleted. The directory is empty now.",
                status: "completed",
              },
              {
                id: "patch-1",
                kind: "patch",
                timestamp: 4,
                label: "Patch",
                title: "1 file change (+1 -0)",
                fileChanges: [
                  {
                    file: "src/index.ts",
                    additions: 1,
                    deletions: 0,
                  },
                ],
                status: "completed",
              },
            ],
            false,
          ),
          diffSummary: {
            diffs: [
              {
                file: "src/index.ts",
                additions: 1,
                deletions: 0,
              },
            ],
          },
        },
      ],
    )

    const copyButtons = getAllByRole("button", { name: "Copy assistant response" })
    expect(copyButtons).toHaveLength(1)

    const actionRow = copyButtons[0]?.closest(".assistant-actions-row")
    const firstResponseSection = getByText("I will check the directory first.").closest(".assistant-section")
    const finalResponseSection = getByText("Deleted. The directory is empty now.").closest(".assistant-section")
    const fileChangeSection = getByRole("region", { name: "File Changes" })
    const trailingDiffCard = container.querySelector(".assistant-diff-row .user-message-diff-card")

    expect(actionRow).not.toBeNull()
    expect(trailingDiffCard).not.toBeNull()
    const actionRowElement = actionRow as HTMLElement
    const trailingDiffCardElement = trailingDiffCard as HTMLElement
    expect(firstResponseSection?.contains(actionRow)).toBe(false)
    expect(finalResponseSection?.contains(actionRow)).toBe(false)
    expect(actionRow?.closest(".assistant-section")).toBeNull()
    expect(fileChangeSection.compareDocumentPosition(actionRowElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(trailingDiffCardElement.compareDocumentPosition(actionRowElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(copyButtons[0]!)
    expect(writeText).toHaveBeenCalledWith("Deleted. The directory is empty now.")
  })

  it("folds intermediate assistant messages into the final response trace", () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    const intermediateMessage = assistantTraceMessage(
      "assistant-intermediate",
      [
        {
          id: "response-1",
          kind: "text",
          timestamp: 1,
          label: "Assistant",
          text: "I will inspect the plugin first.",
          status: "completed",
        },
      ],
      false,
    )
    const finalMessage = assistantTraceMessage(
      "assistant-final",
      [
        {
          id: "response-2",
          kind: "text",
          timestamp: 2,
          label: "Assistant",
          text: "The plugin is available.",
          status: "completed",
        },
      ],
      false,
    )
    intermediateMessage.backendTurnID = "turn-folded-assistant"
    finalMessage.backendTurnID = "turn-folded-assistant"

    const { getAllByRole, getByText } = renderThread(
      [
        userMessage("user-1", "Check the setup."),
        intermediateMessage,
        finalMessage,
      ],
    )

    const copyButtons = getAllByRole("button", { name: "Copy assistant response" })
    const foldedTraceText = getByText("I will inspect the plugin first.")
    const foldedResponseRow = foldedTraceText.closest('[data-thread-row-kind="assistant-response-row"]')
    const finalResponseRow = getByText("The plugin is available.").closest('[data-thread-row-kind="assistant-response-row"]')
    const actionRow = copyButtons[0]?.closest(".assistant-actions-row")

    expect(copyButtons).toHaveLength(1)
    expect(actionRow).not.toBeNull()
    expect(foldedResponseRow).not.toBeNull()
    expect(finalResponseRow).not.toBeNull()
    expect(foldedResponseRow).not.toBe(finalResponseRow)
    expect(foldedResponseRow).toHaveAttribute("data-thread-message-id", "assistant-final")
    expect(foldedTraceText.closest(".thread-column")).toBe(finalResponseRow?.closest(".thread-column"))
    expect(foldedTraceText.compareDocumentPosition(getByText("The plugin is available.")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(finalResponseRow!.compareDocumentPosition(actionRow as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(copyButtons[0]!)
    expect(writeText).toHaveBeenCalledWith("The plugin is available.")
  })

  it("folds stale streaming intermediate assistant messages into the final response trace", () => {
    const { container, getByText } = renderThread([
      userMessage("user-1", "Build the game."),
      assistantTraceMessage(
        "assistant-stale-stream",
        [
          {
            id: "response-stale-stream",
            kind: "text",
            timestamp: 1,
            label: "Assistant",
            text: "OK, now let me create the full HTML file.",
            status: "running",
            isStreaming: true,
          },
        ],
        true,
        "turn-folded-assistant",
      ),
      assistantTraceMessage(
        "assistant-final",
        [
          {
            id: "response-final",
            kind: "text",
            timestamp: 2,
            label: "Assistant",
            text: "好的，经典横刀立马开局。",
            status: "completed",
          },
        ],
        false,
        "turn-folded-assistant",
      ),
    ])

    const finalResponse = getByText("好的，经典横刀立马开局。")
    const foldedStreamingText = getByText("OK, now let me create the full HTML file.")
    const foldedStreamingRow = foldedStreamingText.closest('[data-thread-row-kind="assistant-response-row"]') as HTMLElement | null
    const finalResponseRow = finalResponse.closest('[data-thread-row-kind="assistant-response-row"]') as HTMLElement | null

    expect(container.querySelectorAll(".assistant-message")).toHaveLength(0)
    expect(foldedStreamingRow).not.toBeNull()
    expect(finalResponseRow).not.toBeNull()
    expect(foldedStreamingRow).toHaveAttribute("data-thread-message-id", "assistant-final")
    expect(foldedStreamingRow!.compareDocumentPosition(finalResponseRow!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("copies assistant responses without the response format marker", () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    const { getByRole } = renderThread([
      assistantTraceMessage(
        "assistant-1",
        [
          {
            id: "response-1",
            kind: "text",
            timestamp: 1,
            label: "Assistant",
            text: "<!-- anybox-response-format: html -->\n<p>Copied response.</p>",
            status: "completed",
          },
        ],
        false,
      ),
    ])

    fireEvent.click(getByRole("button", { name: "Copy assistant response" }))

    expect(writeText).toHaveBeenCalledWith("<p>Copied response.</p>")
  })

  it("opens a copy context menu from an assistant response row", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    const responseText = "Copy this assistant reply from the context menu."
    const { getByText } = renderThread([
      assistantTraceMessage(
        "assistant-context-copy",
        [
          {
            id: "response-context-copy",
            kind: "text",
            timestamp: 1,
            label: "Assistant",
            text: responseText,
            status: "completed",
          },
        ],
        false,
      ),
    ])

    fireEvent.contextMenu(getByText(responseText), { clientX: 120, clientY: 80 })

    const menu = screen.getByRole("menu", { name: "Thread copy actions" })
    fireEvent.click(within(menu).getByRole("menuitem", { name: "复制" }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(responseText)
    })
  })

  it("opens a copy context menu from a user message row", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    const promptText = "Copy this user prompt from the context menu."
    const { getByText } = renderThread([userMessage("user-context-copy", promptText)])

    fireEvent.contextMenu(getByText(promptText), { clientX: 80, clientY: 40 })

    const menu = screen.getByRole("menu", { name: "Thread copy actions" })
    fireEvent.click(within(menu).getByRole("menuitem", { name: "复制" }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(promptText)
    })
  })

  it("prioritizes selected thread text in the copy context menu", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    const responseText = "Copy only the selected text."
    const { getByText } = renderThread([
      assistantTraceMessage(
        "assistant-selected-copy",
        [
          {
            id: "response-selected-copy",
            kind: "text",
            timestamp: 1,
            label: "Assistant",
            text: responseText,
            status: "completed",
          },
        ],
        false,
      ),
    ])
    const responseElement = getByText(responseText)
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(responseElement)
    selection?.removeAllRanges()
    selection?.addRange(range)

    fireEvent.contextMenu(responseElement, { clientX: 60, clientY: 30 })

    const menu = screen.getByRole("menu", { name: "Thread copy actions" })
    fireEvent.click(within(menu).getByRole("menuitem", { name: "复制" }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(responseText)
    })
    selection?.removeAllRanges()
  })

  it("opens Branch Chat for a selection using the persisted assistant message id", async () => {
    const onBranchChatFromSelection = vi.fn()
    const responseText = "Use this exact response excerpt as branch context."
    const assistant = assistantTraceMessage(
      "assistant-branch-selection",
      [
        {
          id: "response-branch-selection",
          kind: "text",
          timestamp: 1,
          label: "Assistant",
          text: responseText,
          status: "completed",
        },
      ],
      false,
    )
    assistant.messageID = "persisted-assistant-response"
    const messageTree: SessionMessageTree = {
      activeMessageID: "persisted-assistant-response",
      activePathMessageIDs: ["persisted-assistant-response"],
      branchOptionsByParentID: {},
      childIDsByParentID: {
        "persisted-assistant-response": [],
      },
      nodesByID: {
        "persisted-assistant-response": {
          id: "persisted-assistant-response",
          sessionID: "session-1",
          role: "assistant",
          created: 1,
          completed: 2,
          content: responseText,
          preview: responseText,
          parentMessageID: null,
          isCompletedResponse: true,
        },
      },
      rootMessageIDs: ["persisted-assistant-response"],
      sessionID: "session-1",
    }
    const { getByText } = renderThread([assistant], {
      messageTree,
      onBranchChatFromSelection,
    })
    const responseElement = getByText(responseText)
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(responseElement)
    selection?.removeAllRanges()
    selection?.addRange(range)

    fireEvent.contextMenu(responseElement, { clientX: 60, clientY: 30 })

    const menu = screen.getByRole("menu", { name: "Thread copy actions" })
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Branch Chat" }))

    expect(onBranchChatFromSelection).toHaveBeenCalledWith({
      messageID: "persisted-assistant-response",
      text: responseText,
    })
    selection?.removeAllRanges()
  })

  it("does not offer Branch Chat for a selection spanning assistant responses", () => {
    const onBranchChatFromSelection = vi.fn()
    const { getByText } = renderThread(
      [
        assistantTraceMessage(
          "assistant-branch-selection-a",
          [
            {
              id: "response-branch-selection-a",
              kind: "text",
              timestamp: 1,
              label: "Assistant",
              text: "First response excerpt.",
              status: "completed",
            },
          ],
          false,
        ),
        assistantTraceMessage(
          "assistant-branch-selection-b",
          [
            {
              id: "response-branch-selection-b",
              kind: "text",
              timestamp: 2,
              label: "Assistant",
              text: "Second response excerpt.",
              status: "completed",
            },
          ],
          false,
        ),
      ],
      { onBranchChatFromSelection },
    )
    const firstResponse = getByText("First response excerpt.")
    const secondResponse = getByText("Second response excerpt.")
    const selection = window.getSelection()
    const range = document.createRange()
    range.setStart(firstResponse.firstChild!, 0)
    range.setEnd(secondResponse.firstChild!, secondResponse.textContent?.length ?? 0)
    selection?.removeAllRanges()
    selection?.addRange(range)

    fireEvent.contextMenu(secondResponse, { clientX: 60, clientY: 30 })

    const menu = screen.getByRole("menu", { name: "Thread copy actions" })
    expect(within(menu).queryByRole("menuitem", { name: "Branch Chat" })).toBeNull()
    selection?.removeAllRanges()
  })

  it("adds context menu text to the composer when requested", async () => {
    const onAddToComposer = vi.fn().mockResolvedValue(undefined)
    const responseText = "Send this text into the composer."
    const { getByText } = renderThread(
      [
        assistantTraceMessage(
          "assistant-compose-copy",
          [
            {
              id: "response-compose-copy",
              kind: "text",
              timestamp: 1,
              label: "Assistant",
              text: responseText,
              status: "completed",
            },
          ],
          false,
        ),
      ],
      { onAddToComposer },
    )

    fireEvent.contextMenu(getByText(responseText), { clientX: 90, clientY: 50 })

    const menu = screen.getByRole("menu", { name: "Thread copy actions" })
    expect(within(menu).getByRole("menuitem", { name: "复制" })).toBeInTheDocument()
    fireEvent.click(within(menu).getByRole("menuitem", { name: "加入 Composer" }))

    await waitFor(() => {
      expect(onAddToComposer).toHaveBeenCalledWith(responseText)
    })
  })

  it("copies assistant response images from the image context menu", async () => {
    const previousClipboard = navigator.clipboard
    const previousClipboardItem = globalThis.ClipboardItem
    const hadClipboardItem = "ClipboardItem" in globalThis
    const previousFetch = globalThis.fetch
    const write = vi.fn().mockResolvedValue(undefined)
    const clipboardItems: Array<Record<string, Blob>> = []
    const imageBlob = new Blob(["image-bytes"], { type: "image/png" })
    const fetchMock = vi.fn(async () => new Response(imageBlob))

    class TestClipboardItem {
      constructor(items: Record<string, Blob>) {
        clipboardItems.push(items)
      }
    }

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write },
    })
    Object.defineProperty(globalThis, "ClipboardItem", {
      configurable: true,
      value: TestClipboardItem,
    })
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetchMock,
    })

    try {
      const { getByAltText } = renderThread([
        assistantTraceMessage(
          "assistant-image-context-copy",
          [
            {
              id: "response-image-context-copy",
              kind: "text",
              timestamp: 1,
              label: "Assistant",
              text: "Here is the image:\n\n![Local preview](C:/Users/19128/AppData/Local/Temp/cat.png)",
              status: "completed",
            },
          ],
          false,
        ),
      ])

      fireEvent.contextMenu(getByAltText("Local preview"), { clientX: 120, clientY: 80 })

      const menu = screen.getByRole("menu", { name: "Thread image actions" })
      expect(within(menu).queryByRole("menuitem", { name: "复制" })).not.toBeInTheDocument()
      fireEvent.click(within(menu).getByRole("menuitem", { name: "复制图片" }))

      await waitFor(() => {
        expect(write).toHaveBeenCalledTimes(1)
      })
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("anybox-local-image://image?source="))
      const copiedBlob = clipboardItems[0]?.["image/png"]
      expect(copiedBlob).toBeDefined()
      expect(copiedBlob?.type).toBe("image/png")
    } finally {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: previousClipboard,
      })
      if (hadClipboardItem) {
        Object.defineProperty(globalThis, "ClipboardItem", {
          configurable: true,
          value: previousClipboardItem,
        })
      } else {
        Reflect.deleteProperty(globalThis, "ClipboardItem")
      }
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        value: previousFetch,
      })
    }
  })

  it("copies assistant response images through the desktop clipboard bridge when available", async () => {
    const hadDesktop = "desktop" in window
    const previousDesktop = window.desktop
    const previousFetch = globalThis.fetch
    const copyImageToClipboard = vi.fn().mockResolvedValue(undefined)
    const imageBlob = new Blob(["image-bytes"], { type: "image/png" })
    const fetchMock = vi.fn(async () => new Response(imageBlob))

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        copyImageToClipboard,
      },
    })
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetchMock,
    })

    try {
      const { getByAltText } = renderThread([
        assistantTraceMessage(
          "assistant-image-desktop-copy",
          [
            {
              id: "response-image-desktop-copy",
              kind: "text",
              timestamp: 1,
              label: "Assistant",
              text: "Here is the image:\n\n![Local preview](C:/Users/19128/AppData/Local/Temp/cat.png)",
              status: "completed",
            },
          ],
          false,
        ),
      ])

      fireEvent.contextMenu(getByAltText("Local preview"), { clientX: 120, clientY: 80 })

      const menu = screen.getByRole("menu", { name: "Thread image actions" })
      fireEvent.click(within(menu).getAllByRole("menuitem")[0])

      await waitFor(() => {
        expect(copyImageToClipboard).toHaveBeenCalledWith({
          dataUrl: expect.stringMatching(/^data:image\/png;base64,/),
          mimeType: "image/png",
        })
      })
    } finally {
      if (hadDesktop) {
        Object.defineProperty(window, "desktop", {
          configurable: true,
          value: previousDesktop,
        })
      } else {
        Reflect.deleteProperty(window, "desktop")
      }
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        value: previousFetch,
      })
    }
  })

  it("saves assistant response images to a selected folder from the image context menu", async () => {
    const hadDesktop = "desktop" in window
    const previousDesktop = window.desktop
    const previousFetch = globalThis.fetch
    const saveImageToFolder = vi.fn().mockResolvedValue({
      canceled: false,
      path: "C:\\Pictures\\cat.png",
    })
    const imageBlob = new Blob(["image-bytes"], { type: "image/png" })
    const fetchMock = vi.fn(async () => new Response(imageBlob))

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        saveImageToFolder,
      },
    })
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetchMock,
    })

    try {
      const { getByAltText } = renderThread([
        assistantTraceMessage(
          "assistant-image-save",
          [
            {
              id: "response-image-save",
              kind: "text",
              timestamp: 1,
              label: "Assistant",
              text: "Save this image:\n\n![Local preview](C:/Users/19128/AppData/Local/Temp/cat.png)",
              status: "completed",
            },
          ],
          false,
        ),
      ])

      fireEvent.contextMenu(getByAltText("Local preview"), { clientX: 120, clientY: 80 })

      const menu = screen.getByRole("menu", { name: "Thread image actions" })
      expect(within(menu).getAllByRole("menuitem")).toHaveLength(2)
      fireEvent.click(within(menu).getByRole("menuitem", { name: "保存图片" }))

      await waitFor(() => {
        expect(saveImageToFolder).toHaveBeenCalledWith({
          dataUrl: expect.stringMatching(/^data:image\/png;base64,/),
          mimeType: "image/png",
          name: "cat.png",
        })
      })
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("anybox-local-image://image?source="))
    } finally {
      if (hadDesktop) {
        Object.defineProperty(window, "desktop", {
          configurable: true,
          value: previousDesktop,
        })
      } else {
        Reflect.deleteProperty(window, "desktop")
      }
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        value: previousFetch,
      })
    }
  })

  it("adds assistant response images to the composer from the image context menu", async () => {
    const previousFetch = globalThis.fetch
    const onAddImageToComposer = vi.fn().mockResolvedValue(undefined)
    const imageBlob = new Blob(["image-bytes"], { type: "image/png" })
    const fetchMock = vi.fn(async () => new Response(imageBlob))

    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetchMock,
    })

    try {
      const { getByAltText } = renderThread(
        [
          assistantTraceMessage(
            "assistant-image-compose",
            [
              {
                id: "response-image-compose",
                kind: "text",
                timestamp: 1,
                label: "Assistant",
                text: "Composer image:\n\n![Local preview](C:/Users/19128/AppData/Local/Temp/cat.png)",
                status: "completed",
              },
            ],
            false,
          ),
        ],
        { onAddImageToComposer },
      )

      fireEvent.contextMenu(getByAltText("Local preview"), { clientX: 90, clientY: 50 })

      const menu = screen.getByRole("menu", { name: "Thread image actions" })
      fireEvent.click(within(menu).getByRole("menuitem", { name: "加入 Composer" }))

      await waitFor(() => {
        expect(onAddImageToComposer).toHaveBeenCalledWith([
          expect.objectContaining({
            dataUrl: expect.stringMatching(/^data:image\/png;base64,/),
            mimeType: "image/png",
            name: "cat.png",
          }),
        ])
      })
    } finally {
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        value: previousFetch,
      })
    }
  })

  it("only exposes branch controls on the final assistant message in a user message", () => {
    const onBranchSelect = vi.fn()
    const onForkFromMessage = vi.fn()
    const messageTree: SessionMessageTree = {
      activeMessageID: "message-final",
      activePathMessageIDs: ["user-1", "message-final"],
      branchOptionsByParentID: {
        "message-reasoning": [
          {
            childMessageID: "reasoning-child-1",
            index: 0,
            isActive: true,
            label: "Branch 1",
            leafMessageID: "reasoning-leaf-1",
            parentMessageID: "message-reasoning",
            preview: "Reasoning branch one",
            total: 2,
          },
          {
            childMessageID: "reasoning-child-2",
            index: 1,
            isActive: false,
            label: "Branch 2",
            leafMessageID: "reasoning-leaf-2",
            parentMessageID: "message-reasoning",
            preview: "Reasoning branch two",
            total: 2,
          },
        ],
        "message-final": [
          {
            childMessageID: "final-child-1",
            index: 0,
            isActive: false,
            label: "Branch 1",
            leafMessageID: "final-leaf-1",
            parentMessageID: "message-final",
            preview: "Final branch one",
            total: 2,
          },
          {
            childMessageID: "final-child-2",
            index: 1,
            isActive: true,
            label: "Branch 2",
            leafMessageID: "final-leaf-2",
            parentMessageID: "message-final",
            preview: "Final branch two",
            total: 2,
          },
        ],
      },
      childIDsByParentID: {},
      nodesByID: {},
      rootMessageIDs: ["user-1"],
      sessionID: "session-1",
    }
    const reasoningMessage: AssistantThreadMessage = {
      ...assistantTraceMessage(
        "assistant-reasoning",
        [
          {
            id: "reasoning-1",
            kind: "reasoning",
            timestamp: 1,
            label: "Reasoning",
            text: "Checking the options.",
            status: "completed",
          },
        ],
        false,
      ),
      messageID: "message-reasoning",
    }
    const finalMessage: AssistantThreadMessage = {
      ...assistantTraceMessage(
        "assistant-final",
        [
          {
            id: "response-1",
            kind: "text",
            timestamp: 2,
            label: "Assistant",
            text: "Here is the final answer.",
            status: "completed",
          },
        ],
        false,
      ),
      messageID: "message-final",
    }
    reasoningMessage.backendTurnID = "turn-branch-controls"
    finalMessage.backendTurnID = "turn-branch-controls"

    const { container } = renderThread([userMessage("user-1", "Prompt"), reasoningMessage, finalMessage], {
      messageTree,
      onBranchSelect,
      onForkFromMessage,
    })

    expect(container.querySelectorAll(".assistant-branch-switcher")).toHaveLength(1)
    const forkButtons = screen.getAllByRole("button", { name: "Open Branch Chat from here" })
    expect(forkButtons).toHaveLength(1)

    fireEvent.click(forkButtons[0]!)
    expect(onForkFromMessage).toHaveBeenCalledWith("message-final")

    const branchSelect = container.querySelector(".assistant-branch-switcher-select") as HTMLSelectElement | null
    expect(branchSelect?.value).toBe("final-leaf-2")

    fireEvent.change(branchSelect!, { target: { value: "final-leaf-1" } })
    expect(onBranchSelect).toHaveBeenCalledWith("final-leaf-1")
  })
})

describe("ThreadView message motion", () => {
  it("marks initial history messages as stable", () => {
    const { container } = renderThread([
      userMessage("user-1", "Prompt"),
      assistantTraceMessage("assistant-1", [
        {
          id: "assistant-1-text",
          kind: "text",
          timestamp: 1,
          label: "Assistant",
          text: "Done",
          status: "completed",
        },
      ], false),
    ])

    expect(container.querySelector('[data-thread-message-id="user-1"]')?.getAttribute("data-thread-message-motion")).toBe("history")
    expect(container.querySelector('[data-thread-message-id="assistant-1"]')?.getAttribute("data-thread-message-motion")).toBe("history")
  })

  it("marks newly appended visible messages as new or live", () => {
    const { container, rerender, props } = renderThread([userMessage("user-1", "Prompt")])

    rerender(
      <ThreadView
        {...props}
        activeMessages={[
          userMessage("user-1", "Prompt"),
          userMessage("user-2", "Follow up"),
          assistantMessage("assistant-1", "Streaming"),
        ]}
      />,
    )

    expect(container.querySelector('[data-thread-message-id="user-2"]')?.getAttribute("data-thread-message-motion")).toBe("new")
    expect(container.querySelector('[data-thread-message-id="assistant-1"]')?.getAttribute("data-thread-message-motion")).toBe("live")
  })

  it("does not replay motion when switching back to an already rendered session", () => {
    const { container, rerender, props } = renderThread([userMessage("user-1", "Prompt")])

    rerender(
      <ThreadView
        {...props}
        activeSession={sessionB}
        activeMessages={[userMessage("user-2", "Other")]}
      />,
    )
    rerender(
      <ThreadView
        {...props}
        activeSession={session}
        activeMessages={[userMessage("user-1", "Prompt")]}
      />,
    )

    expect(container.querySelector('[data-thread-message-id="user-1"]')?.getAttribute("data-thread-message-motion")).toBe("history")
  })
})

describe("ThreadView turn navigator", () => {
  it("projects canonical turns without counting assistant or stream-inserted user rows", () => {
    const firstUser = {
      ...userMessage("user-1", "  按照文档，\n推进完成 edit   界面的开发  "),
      displayText: "按照文档，\n推进完成 edit   界面的开发",
    }
    const assistant = assistantMessage("assistant-1", "Working")
    const insertedUser: UserThreadMessage = {
      ...userMessage("user-inserted", "Temporary steering note"),
      submissionMode: "steer",
      streamInsertion: {
        assistantThreadMessageID: assistant.id,
        afterItemCount: 0,
        status: "consumed",
      },
    }
    const secondUser = userMessage("user-2", "Ship the final result")
    const activeMessages = [firstUser, assistant, insertedUser, secondUser]
    const activeTurns = [
      threadTurn("turn-1", firstUser, [firstUser, assistant, insertedUser]),
      threadTurn("turn-2", secondUser),
    ]

    renderThread(activeMessages, { activeTurns })

    const navigator = screen.getByRole("navigation", { name: "对话轮次导航" })
    const turnButtons = within(navigator).getAllByRole("button", { name: /跳转到第/ })
    expect(turnButtons).toHaveLength(2)
    expect(turnButtons[0]).toHaveAccessibleName("跳转到第 1 / 2 轮：按照文档， 推进完成 edit 界面的开发")
    expect(turnButtons[1]).toHaveAccessibleName("跳转到第 2 / 2 轮：Ship the final result")

    fireEvent.mouseEnter(turnButtons[0]!)
    expect(screen.getByRole("tooltip")).toHaveTextContent("第 1 / 2 轮 · 按照文档， 推进完成 edit 界面的开发")
  })

  it("uses virtual row offsets for unmounted turns and records a detached scroll snapshot", async () => {
    const activeMessages = Array.from({ length: 120 }, (_, index) => userMessage(`user-${index}`, `Prompt ${index}`))
    const activeTurns = activeMessages.map((message, index) => threadTurn(`turn-${index}`, message))
    const saveScrollSnapshot = vi.fn()
    const { threadColumn } = renderThread(activeMessages, {
      activeTurns,
      saveScrollSnapshot,
      scrollStateKey: "session:turn-navigation-unmounted",
    })
    setScrollMetrics(threadColumn, {
      clientHeight: 400,
      scrollHeight: 20_000,
      scrollTop: 0,
    })

    expect(screen.queryByText("Prompt 99")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "跳转到第 100 / 120 轮：Prompt 99" }))
    // jsdom does not emit the native scroll event that browsers produce for
    // the virtualizer's scrollTop assignment.
    fireEvent.scroll(threadColumn)

    await waitFor(() => expect(screen.getByText("Prompt 99")).toBeInTheDocument())
    expect(threadColumn.scrollTop).toBeGreaterThan(0)
    expect(saveScrollSnapshot).toHaveBeenLastCalledWith(
      "session:turn-navigation-unmounted",
      expect.objectContaining({ pinnedToBottom: false }),
    )
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "跳转到第 100 / 120 轮：Prompt 99" })).toHaveAttribute("aria-current", "step")
    })
  })

  it("navigates notification requests to the completed turn's user submission", async () => {
    const activeMessages = Array.from({ length: 120 }, (_, index) => userMessage(`user-${index}`, `Prompt ${index}`))
    const activeTurns = activeMessages.map((message, index) => threadTurn(`turn-${index}`, message))
    const saveScrollSnapshot = vi.fn()
    const { props, rerender, threadColumn } = renderThread(activeMessages, {
      activeTurns,
      saveScrollSnapshot,
      scrollStateKey: "session:notification-navigation",
    })
    setScrollMetrics(threadColumn, {
      clientHeight: 400,
      scrollHeight: 20_000,
      scrollTop: 0,
    })

    rerender(
      <ThreadView
        {...props}
        navigationRequest={{ requestID: 1, turnID: "turn-99" }}
      />,
    )
    fireEvent.scroll(threadColumn)

    await waitFor(() => expect(screen.getByText("Prompt 99")).toBeInTheDocument())
    expect(threadColumn.scrollTop).toBeGreaterThan(0)
    expect(saveScrollSnapshot).toHaveBeenLastCalledWith(
      "session:notification-navigation",
      expect.objectContaining({ pinnedToBottom: false }),
    )
  })

  it("updates the current turn while the user scrolls the thread", async () => {
    const activeMessages = Array.from({ length: 20 }, (_, index) => userMessage(`user-${index}`, `Prompt ${index}`))
    const activeTurns = activeMessages.map((message, index) => threadTurn(`turn-${index}`, message))
    const { threadColumn } = renderThread(activeMessages, {
      activeTurns,
      scrollStateKey: "session:turn-navigation-manual-scroll",
    })
    setScrollMetrics(threadColumn, {
      clientHeight: 400,
      scrollHeight: 20_000,
      scrollTop: 0,
    })

    const first = screen.getByRole("button", { name: "跳转到第 1 / 20 轮：Prompt 0" })
    const navigator = screen.getByRole("navigation", { name: "对话轮次导航" })
    fireEvent.scroll(threadColumn)
    expect(first).toHaveAttribute("aria-current", "step")
    await waitFor(() => {
      expect(navigator.querySelectorAll('[data-visible="true"]').length).toBeGreaterThan(1)
    })

    setScrollMetrics(threadColumn, {
      clientHeight: 400,
      scrollHeight: 20_000,
      scrollTop: 1_200,
    })
    fireEvent.scroll(threadColumn)

    await waitFor(() => expect(first).not.toHaveAttribute("aria-current"))
    expect(first).not.toHaveAttribute("data-visible")
    expect(navigator.querySelectorAll('[data-visible="true"]').length).toBeGreaterThan(0)
    expect(
      screen.getAllByRole("button", { name: /跳转到第/ }).some((button) => button.getAttribute("aria-current") === "step"),
    ).toBe(true)
  })

  it("supports arrow, Home, End, Enter, Space and Escape keyboard behavior", () => {
    const activeMessages = [
      userMessage("user-1", "First"),
      userMessage("user-2", "Second"),
      userMessage("user-3", "Third"),
    ]
    const activeTurns = activeMessages.map((message, index) => threadTurn(`turn-${index}`, message))
    const { threadColumn } = renderThread(activeMessages, {
      activeTurns,
      scrollStateKey: "session:turn-navigation-keyboard",
    })
    setScrollMetrics(threadColumn, { clientHeight: 200, scrollHeight: 1_000, scrollTop: 0 })

    const first = screen.getByRole("button", { name: "跳转到第 1 / 3 轮：First" })
    const second = screen.getByRole("button", { name: "跳转到第 2 / 3 轮：Second" })
    const third = screen.getByRole("button", { name: "跳转到第 3 / 3 轮：Third" })
    first.focus()
    fireEvent.keyDown(first, { key: "ArrowDown" })
    expect(second).toHaveFocus()
    fireEvent.keyDown(second, { key: "End" })
    expect(third).toHaveFocus()
    fireEvent.keyDown(third, { key: "Home" })
    expect(first).toHaveFocus()
    fireEvent.keyDown(first, { key: " " })
    fireEvent.keyDown(second, { key: "Enter" })
    expect(threadColumn.scrollTop).toBeGreaterThan(0)
    fireEvent.keyDown(second, { key: "Escape" })
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
  })

  it("keeps a turn-navigation jump detached while streaming content changes", async () => {
    const users = Array.from({ length: 20 }, (_, index) => userMessage(`user-${index}`, `Prompt ${index}`))
    const activeTurns = users.map((message, index) => threadTurn(`turn-${index}`, message))
    const snapshots: Array<{ pinnedToBottom: boolean; scrollTop: number }> = []
    const { props, rerender, threadColumn } = renderThread(users, {
      activeTurns,
      saveScrollSnapshot: (_key, snapshot) => snapshots.push(snapshot),
      scrollStateKey: "session:turn-navigation-streaming",
    })
    setScrollMetrics(threadColumn, { clientHeight: 300, scrollHeight: 5_000, scrollTop: 0 })

    fireEvent.click(screen.getByRole("button", { name: "跳转到第 6 / 20 轮：Prompt 5" }))
    const navigatedScrollTop = threadColumn.scrollTop
    expect(navigatedScrollTop).toBeGreaterThan(0)

    rerender(
      <ThreadView
        {...props}
        activeMessages={[...users, assistantMessage("assistant-streaming", "More streamed output") ]}
        activeTurns={activeTurns}
      />,
    )

    await waitFor(() => expect(snapshots.at(-1)?.pinnedToBottom).toBe(false))
    expect(threadColumn.scrollTop).toBe(navigatedScrollTop)
  })

  it("truncates very long labels and exposes every turn through the compact popover", () => {
    const longWord = "x".repeat(260)
    const users = Array.from({ length: 28 }, (_, index) => userMessage(`user-${index}`, index === 0 ? longWord : `Prompt ${index}`))
    const activeTurns = users.map((message, index) => threadTurn(`turn-${index}`, message))
    renderThread(users, { activeTurns })

    const first = screen.getByRole("button", { name: `跳转到第 1 / 28 轮：${longWord}` })
    fireEvent.mouseEnter(first)
    expect(screen.getByRole("tooltip").textContent?.endsWith("…")).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: "当前第 1 / 28 轮，打开对话轮次导航" }))
    const compactDialog = screen.getByRole("dialog", { name: "选择对话轮次" })
    expect(within(compactDialog).getAllByRole("button")).toHaveLength(28)
    expect(within(compactDialog).getByRole("button", { name: "跳转到第 28 / 28 轮：Prompt 27" })).toBeInTheDocument()
  })
})

describe("ThreadView virtual list", () => {
  it("uses the TanStack virtual path for medium threads", () => {
    const activeMessages = Array.from({ length: 120 }, (_, index) => userMessage(`user-${index}`, `Prompt ${index}`))
    const { container, threadColumn } = renderThread(activeMessages, {
      scrollStateKey: "medium-virtual-session",
    })

    expect(threadColumn).toHaveClass("is-virtualized")
    expect(threadColumn).not.toHaveClass("is-content-visibility")
    expect(container.querySelector(".thread-virtual-spacer")).not.toBeNull()
    expect(container.querySelectorAll("[data-thread-message-id]").length).toBeGreaterThan(0)
    expect(container.querySelectorAll("[data-thread-message-id]").length).toBeLessThan(120)
    expect(screen.getByText("Prompt 0")).toBeInTheDocument()
  })

  it("renders only the visible window for long threads and swaps rows on scroll", async () => {
    const activeMessages = Array.from({ length: 320 }, (_, index) => userMessage(`user-${index}`, `Prompt ${index}`))
    const { container, threadColumn } = renderThread(activeMessages, {
      scrollStateKey: "virtual-list-session",
    })
    setScrollMetrics(threadColumn, {
      clientHeight: 400,
      scrollHeight: 12000,
      scrollTop: threadColumn.scrollTop,
    })

    expect(threadColumn).toHaveClass("is-virtualized")
    expect(threadColumn).not.toHaveClass("is-content-visibility")
    expect(container.querySelector(".thread-virtual-spacer")).not.toBeNull()
    expect(container.querySelectorAll("[data-thread-message-id]").length).toBeLessThan(80)

    const readRenderedVirtualIndexes = () =>
      Array.from(container.querySelectorAll<HTMLElement>("[data-thread-virtual-row-id]"))
        .map((row) => Number(row.dataset.index))
        .filter(Number.isFinite)

    threadColumn.scrollTop = 0
    fireEvent.wheel(threadColumn, { deltaY: -120 })
    fireEvent.scroll(threadColumn)

    await waitFor(() => expect(screen.getByText("Prompt 0")).toBeInTheDocument())
    expect(Math.min(...readRenderedVirtualIndexes())).toBe(0)

    threadColumn.scrollTop = 12_000
    fireEvent.wheel(threadColumn, { deltaY: 120 })
    fireEvent.scroll(threadColumn)

    await waitFor(() => expect(Math.max(...readRenderedVirtualIndexes())).toBeGreaterThan(100))
    expect(screen.queryByText("Prompt 0")).not.toBeInTheDocument()
  })

  it("keeps the focused virtual row mounted while it is outside the visible range", async () => {
    const activeMessages = Array.from({ length: 320 }, (_, index) => userMessage(`user-${index}`, `Prompt ${index}`))
    const { container, threadColumn } = renderThread(activeMessages, {
      scrollStateKey: "virtual-list-focused-row-session",
    })
    setScrollMetrics(threadColumn, {
      clientHeight: 400,
      scrollHeight: 12000,
      scrollTop: 0,
    })

    const firstRow = container.querySelector<HTMLElement>('[data-thread-virtual-row-id="user:user-0"]')
    expect(firstRow).not.toBeNull()
    const copyButton = within(firstRow!).getByRole("button", { name: "Copy user message" })
    copyButton.focus()
    expect(document.activeElement).toBe(copyButton)

    threadColumn.scrollTop = 12_000
    fireEvent.wheel(threadColumn, { deltaY: 120 })
    fireEvent.scroll(threadColumn)

    await waitFor(() => {
      const renderedIndexes = Array.from(container.querySelectorAll<HTMLElement>("[data-thread-virtual-row-id]"))
        .map((row) => Number(row.dataset.index))
        .filter(Number.isFinite)
      expect(Math.max(...renderedIndexes)).toBeGreaterThan(100)
    })
    expect(container.querySelector('[data-thread-virtual-row-id="user:user-0"]')).not.toBeNull()
    expect(document.activeElement).toBe(copyButton)
  })

  it("virtualizes dense task threads before resize layout becomes expensive", () => {
    const activeMessages = Array.from({ length: 240 }, (_, index) => userMessage(`user-${index}`, `Prompt ${index}`))
    const { container, threadColumn } = renderThread(activeMessages, {
      scrollStateKey: "virtual-list-dense-task-session",
    })
    setScrollMetrics(threadColumn, {
      clientHeight: 400,
      scrollHeight: 12000,
      scrollTop: threadColumn.scrollTop,
    })

    expect(threadColumn).toHaveClass("is-virtualized")
    expect(container.querySelector(".thread-virtual-spacer")).not.toBeNull()
    expect(container.querySelectorAll("[data-thread-message-id]").length).toBeLessThan(80)
  })

  it("uses the TanStack virtual path for response-heavy threads", () => {
    const responseItems = Array.from({ length: 24 }, (_, index): AssistantTraceItem => ({
      id: `response-${index}`,
      kind: "text",
      timestamp: index,
      label: "Assistant",
      text: `Response section ${index}. ${"Detailed delivery notes. ".repeat(80)}`,
      status: "completed",
    }))
    const { container, threadColumn } = renderThread([
      assistantTraceMessage("assistant-response-heavy", responseItems, false),
    ], {
      assistantTraceVisibility: {
        ...DEFAULT_ASSISTANT_TRACE_VISIBILITY,
        approvals: false,
        files: false,
        reasoning: false,
        sources: false,
        toolCalls: false,
        toolInputs: false,
        toolOutputs: false,
        workflow: false,
      },
      scrollStateKey: "virtual-list-response-heavy-session",
    })

    expect(threadColumn).toHaveClass("is-virtualized")
    expect(threadColumn).not.toHaveClass("is-content-visibility")
    expect(container.querySelector(".thread-virtual-spacer")).not.toBeNull()
    expect(container.querySelectorAll('[data-thread-row-kind="assistant-response-row"]').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('[data-thread-row-kind="assistant-response-row"]').length).toBeLessThanOrEqual(24)
  })

  it("does not measure virtual row layouts for medium threads during sidebar resize", () => {
    const originalResizeObserver = globalThis.ResizeObserver
    let resizeCallback: ResizeObserverCallback | null = null
    let resizeObserverInstance: ResizeObserver | null = null

    class ManualResizeObserver implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
        resizeObserverInstance = this
      }

      observe() {}

      unobserve() {}

      disconnect() {}
    }

    globalThis.ResizeObserver = ManualResizeObserver

    try {
      const activeMessages = Array.from({ length: 120 }, (_, index) => userMessage(`user-${index}`, `Prompt ${index}`))
      const { container, threadColumn } = renderThread(activeMessages, {
        scrollStateKey: "medium-sidebar-resize-session",
      })
      setScrollMetrics(threadColumn, {
        clientHeight: 400,
        scrollHeight: 12000,
        scrollTop: 240,
      })

      const row = container.querySelector<HTMLElement>('[data-thread-row-kind="user-message"]')
      expect(row).not.toBeNull()
      const rowLayoutSpy = vi.spyOn(row!, "getBoundingClientRect")

      document.body.classList.add("is-resizing-sidebar")
      act(() => {
        resizeCallback?.([
          {
            borderBoxSize: [{ blockSize: 400, inlineSize: 320 }] as ResizeObserverSize[],
            contentBoxSize: [],
            contentRect: createElementRect({ width: 320, height: 400 }),
            devicePixelContentBoxSize: [],
            target: threadColumn,
          },
        ], resizeObserverInstance!)
      })

      expect(rowLayoutSpy).not.toHaveBeenCalled()
      expect(threadColumn.scrollTop).toBe(240)
      rowLayoutSpy.mockRestore()
    } finally {
      document.body.classList.remove("is-resizing-sidebar")
      globalThis.ResizeObserver = originalResizeObserver
    }
  })

  it("renders TanStack measurement attributes on virtual rows", () => {
    const activeMessages = Array.from({ length: 320 }, (_, index) => userMessage(`user-${index}`, `Prompt ${index}`))
    const { container } = renderThread(activeMessages, {
      scrollStateKey: "virtual-list-measurement-attributes-session",
    })

    const virtualRow = container.querySelector<HTMLElement>("[data-thread-virtual-row-id]")
    expect(virtualRow).not.toBeNull()
    expect(virtualRow?.dataset.index).toMatch(/^\d+$/)
    expect(virtualRow?.dataset.threadVirtualRowId).toMatch(/^user:user-/)
  })

  it("remeasures visible rows when stable-key content grows", async () => {
    let responseRowHeight = 80
    const layoutSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains("thread-column")) return createElementRect({ top: 0, height: 400 })
        if (this.classList.contains("thread-virtual-row")) {
          return createElementRect({
            height: this.dataset.index === "0" ? responseRowHeight : 48,
          })
        }

        return createElementRect()
      })
    const buildResponseMessage = (text: string) => assistantTraceMessage("assistant-1", [
      {
        id: "response-1",
        kind: "text",
        timestamp: 1,
        label: "Assistant",
        text,
        status: "running",
        isStreaming: true,
      },
    ], true)

    try {
      const { container, props, rerender } = renderThread([
        buildResponseMessage("Short response"),
        userMessage("user-after", "Next prompt"),
      ], {
        scrollStateKey: "virtual-list-stable-key-growth-session",
      })

      const readNextRowOffset = () =>
        readTransformYOffset(
          container.querySelector<HTMLElement>('[data-thread-virtual-row-id="user:user-after"]')?.style.transform,
        )

      await waitFor(() => expect(readNextRowOffset()).toBe(142))

      responseRowHeight = 220
      rerender(
        <ThreadView
          {...props}
          activeMessages={[
            buildResponseMessage("Short response\n\nAdditional streamed content that keeps the same row key."),
            userMessage("user-after", "Next prompt"),
          ]}
        />,
      )

      await waitFor(() => expect(readNextRowOffset()).toBe(282))
    } finally {
      layoutSpy.mockRestore()
    }
  })

  it("remeasures visible rows when the thread column narrows", async () => {
    const originalResizeObserver = globalThis.ResizeObserver
    const resizeObservers: Array<{
      callback: ResizeObserverCallback
      instance: ResizeObserver
      targets: Set<Element>
    }> = []

    class ManualResizeObserver implements ResizeObserver {
      readonly callback: ResizeObserverCallback
      readonly targets = new Set<Element>()

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
        resizeObservers.push({
          callback,
          instance: this,
          targets: this.targets,
        })
      }

      observe(target: Element) {
        this.targets.add(target)
      }

      unobserve(target: Element) {
        this.targets.delete(target)
      }

      disconnect() {
        this.targets.clear()
      }
    }

    globalThis.ResizeObserver = ManualResizeObserver

    let threadColumnWidth = 640
    let responseRowHeight = 80
    const layoutSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains("thread-column")) {
          return createElementRect({ width: threadColumnWidth, height: 400 })
        }
        if (this.classList.contains("thread-virtual-row")) {
          return createElementRect({
            width: threadColumnWidth,
            height: this.dataset.index === "0" ? responseRowHeight : 48,
          })
        }

        return createElementRect()
      })
    const responseMessage = assistantTraceMessage("assistant-1", [
      {
        id: "response-1",
        kind: "text",
        timestamp: 1,
        label: "Assistant",
        text: "A response that becomes taller when the pane width narrows.",
        status: "completed",
      },
    ], false)

    try {
      const { container, threadColumn } = renderThread([
        responseMessage,
        userMessage("user-after", "Next prompt"),
      ], {
        scrollStateKey: "virtual-list-column-width-session",
      })

      const readNextRowOffset = () =>
        readTransformYOffset(
          container.querySelector<HTMLElement>('[data-thread-virtual-row-id="user:user-after"]')?.style.transform,
        )

      await waitFor(() => expect(readNextRowOffset()).toBe(142))

      threadColumnWidth = 280
      responseRowHeight = 220
      act(() => {
        for (const observer of resizeObservers) {
          if (!observer.targets.has(threadColumn)) continue

          observer.callback([
            {
              borderBoxSize: [{ blockSize: 400, inlineSize: threadColumnWidth }] as ResizeObserverSize[],
              contentBoxSize: [],
              contentRect: createElementRect({ width: threadColumnWidth, height: 400 }),
              devicePixelContentBoxSize: [],
              target: threadColumn,
            },
          ], observer.instance)
        }
      })

      await waitFor(() => expect(readNextRowOffset()).toBe(282))
    } finally {
      layoutSpy.mockRestore()
      globalThis.ResizeObserver = originalResizeObserver
    }
  })

  it("keeps measured row offsets when inactive layout reports zero size", async () => {
    let isThreadLayoutVisible = true
    const layoutSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains("thread-column")) {
          return isThreadLayoutVisible
            ? createElementRect({ width: 320, height: 400 })
            : createElementRect({ width: 0, height: 0 })
        }
        if (this.classList.contains("thread-virtual-row")) {
          return isThreadLayoutVisible
            ? createElementRect({ width: 320, height: this.dataset.index === "0" ? 80 : 48 })
            : createElementRect({ width: 0, height: 0 })
        }

        return createElementRect()
      })
    const responseMessage = assistantTraceMessage("assistant-1", [
      {
        id: "response-1",
        kind: "text",
        timestamp: 1,
        label: "Assistant",
        text: "Short response",
        status: "completed",
      },
    ], false)
    const activeMessages = [
      responseMessage,
      userMessage("user-after", "Next prompt"),
    ]

    try {
      const { container, props, rerender } = renderThread(activeMessages, {
        scrollStateKey: "virtual-list-hidden-measurement-session",
      })

      const readNextRowOffset = () =>
        readTransformYOffset(
          container.querySelector<HTMLElement>('[data-thread-virtual-row-id="user:user-after"]')?.style.transform,
        )

      await waitFor(() => expect(readNextRowOffset()).toBe(142))

      isThreadLayoutVisible = false
      rerender(<ThreadView {...props} activeMessages={[...activeMessages]} />)

      expect(readNextRowOffset()).toBe(142)

      isThreadLayoutVisible = true
      rerender(<ThreadView {...props} activeMessages={[...activeMessages]} />)

      await waitFor(() => expect(readNextRowOffset()).toBe(142))
    } finally {
      layoutSpy.mockRestore()
    }
  })

  it("does not reuse measured row heights across sessions with colliding row IDs", async () => {
    let isThreadLayoutVisible = true
    const layoutSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains("thread-column")) {
          return isThreadLayoutVisible
            ? createElementRect({ width: 320, height: 400 })
            : createElementRect({ width: 0, height: 0 })
        }
        if (this.classList.contains("thread-virtual-row")) {
          return isThreadLayoutVisible
            ? createElementRect({ width: 320, height: this.dataset.index === "0" ? 80 : 48 })
            : createElementRect({ width: 0, height: 0 })
        }

        return createElementRect()
      })
    const buildResponseMessage = (text: string) => assistantTraceMessage("assistant-1", [
      {
        id: "response-1",
        kind: "text",
        timestamp: 1,
        label: "Assistant",
        text,
        status: "completed",
      },
    ], false)
    const shortSessionMessages = [
      buildResponseMessage("Short response"),
      userMessage("user-after", "Next prompt"),
    ]
    const tallSessionMessages = [
      buildResponseMessage("Long response segment. ".repeat(80)),
      userMessage("user-after", "Next prompt"),
    ]

    try {
      const { container, props, rerender } = renderThread(shortSessionMessages)

      const readNextRowOffset = () =>
        readTransformYOffset(
          container.querySelector<HTMLElement>('[data-thread-virtual-row-id="user:user-after"]')?.style.transform,
        )

      await waitFor(() => expect(readNextRowOffset()).toBe(142))

      isThreadLayoutVisible = false
      rerender(
        <ThreadView
          {...props}
          activeMessages={tallSessionMessages}
          activeSession={sessionB}
        />,
      )

      expect(readNextRowOffset()).toBeGreaterThan(300)
    } finally {
      layoutSpy.mockRestore()
    }
  })

  it("remeasures rows on activation after the layout becomes visible", async () => {
    const animationFrame = installManualAnimationFrame()
    let isThreadLayoutVisible = true
    let responseRowHeight = 80
    const layoutSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains("thread-column")) {
          return isThreadLayoutVisible
            ? createElementRect({ width: 320, height: 400 })
            : createElementRect({ width: 0, height: 0 })
        }
        if (this.classList.contains("thread-virtual-row")) {
          return isThreadLayoutVisible
            ? createElementRect({ width: 320, height: this.dataset.index === "0" ? responseRowHeight : 48 })
            : createElementRect({ width: 0, height: 0 })
        }

        return createElementRect()
      })
    const activeMessages = [
      assistantTraceMessage("assistant-1", [
        {
          id: "response-1",
          kind: "text",
          timestamp: 1,
          label: "Assistant",
          text: "Response text",
          status: "completed",
        },
      ], false),
      userMessage("user-after", "Next prompt"),
    ]

    try {
      const { container, props, rerender } = renderThread(activeMessages, {
        virtualMeasurementKey: "session-1:active-1",
      })

      const readNextRowOffset = () =>
        readTransformYOffset(
          container.querySelector<HTMLElement>('[data-thread-virtual-row-id="user:user-after"]')?.style.transform,
        )

      await waitFor(() => expect(readNextRowOffset()).toBe(142))

      isThreadLayoutVisible = false
      responseRowHeight = 220
      rerender(
        <ThreadView
          {...props}
          virtualMeasurementKey="session-1:active-2"
        />,
      )

      expect(readNextRowOffset()).toBe(142)

      isThreadLayoutVisible = true
      act(() => {
        animationFrame.flush()
      })

      await waitFor(() => expect(readNextRowOffset()).toBe(282))
    } finally {
      layoutSpy.mockRestore()
      animationFrame.restore()
    }
  })

  it("remeasures visible rows when tool disclosures expand and collapse", async () => {
    const animationFrame = installManualAnimationFrame()
    let toolRowHeight = 80
    const layoutSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains("thread-column")) {
          return createElementRect({ width: 420, height: 480 })
        }
        if (this.classList.contains("thread-virtual-row")) {
          const rowID = this.getAttribute("data-thread-virtual-row-id") ?? ""
          return createElementRect({
            width: 420,
            height: rowID.includes(":tool:") ? toolRowHeight : 48,
          })
        }

        return createElementRect()
      })
    const toolItem: AssistantTraceItem = {
      ...toolStatusTraceItem("completed"),
      toolOutputText: "tool output\n".repeat(24),
      detail: "Tool detail\n".repeat(8),
    }

    try {
      const { container } = renderThread([
        assistantTraceMessage("assistant-tools", [toolItem], false),
        userMessage("user-after", "Next prompt"),
      ], {
        assistantTraceVisibility: {
          ...DEFAULT_ASSISTANT_TRACE_VISIBILITY,
          toolOutputs: true,
        },
        scrollStateKey: "virtual-list-tool-disclosure-session",
      })

      const readNextRowOffset = () =>
        readTransformYOffset(
          container.querySelector<HTMLElement>('[data-thread-virtual-row-id="user:user-after"]')?.style.transform,
        )
      const flushScheduledMeasurements = () => {
        act(() => {
          animationFrame.flush()
        })
        act(() => {
          animationFrame.flush()
        })
      }

      await waitFor(() => expect(readNextRowOffset()).toBe(142))

      toolRowHeight = 220
      fireEvent.click(screen.getByRole("button", { name: /^Tool completed/ }))
      flushScheduledMeasurements()

      await waitFor(() => expect(readNextRowOffset()).toBe(282))

      toolRowHeight = 360
      fireEvent.click(screen.getByRole("button", { name: "Expand Tool completed output content" }))
      flushScheduledMeasurements()

      await waitFor(() => expect(readNextRowOffset()).toBe(422))

      toolRowHeight = 220
      fireEvent.click(screen.getByRole("button", { name: "Collapse Tool completed output content" }))
      flushScheduledMeasurements()

      await waitFor(() => expect(readNextRowOffset()).toBe(282))

      toolRowHeight = 80
      fireEvent.click(screen.getByRole("button", { name: /^Tool completed/ }))
      flushScheduledMeasurements()

      await waitFor(() => expect(readNextRowOffset()).toBe(142))
    } finally {
      layoutSpy.mockRestore()
      animationFrame.restore()
    }
  })
})

describe("ThreadView scroll restoration", () => {
  it("defaults a newly loaded session to the latest content", () => {
    const { rerender, props, threadColumn } = renderThread([])
    setScrollMetrics(threadColumn, {
      clientHeight: 400,
      scrollHeight: 1200,
      scrollTop: 0,
    })

    rerender(
      <ThreadView
        {...props}
        activeMessages={[userMessage("user-1", "Prompt"), assistantMessage("assistant-1", "Loaded history")]}
      />,
    )

    expect(threadColumn.scrollTop).toBe(800)
  })

  it("restores a user's detached position when switching back to a session", () => {
    const { rerender, props, threadColumn } = renderThread([userMessage("user-1", "Prompt")])
    setScrollMetrics(threadColumn, {
      clientHeight: 400,
      scrollHeight: 1200,
      scrollTop: 800,
    })

    threadColumn.scrollTop = 260
    fireEvent.wheel(threadColumn, { deltaY: -120 })
    fireEvent.scroll(threadColumn)

    setScrollMetrics(threadColumn, {
      clientHeight: 400,
      scrollHeight: 900,
      scrollTop: 0,
    })
    rerender(
      <ThreadView
        {...props}
        activeSession={sessionB}
        activeMessages={[userMessage("user-2", "Other prompt")]}
      />,
    )
    expect(threadColumn.scrollTop).toBe(500)

    setScrollMetrics(threadColumn, {
      clientHeight: 400,
      scrollHeight: 1200,
      scrollTop: 0,
    })
    rerender(<ThreadView {...props} activeMessages={[userMessage("user-1", "Prompt")]} />)

    expect(threadColumn.scrollTop).toBe(260)
  })

  it("keeps the user at the top when wheel momentum reaches the thread boundary", () => {
    const snapshots: Record<string, { scrollTop: number; pinnedToBottom: boolean; updatedAt: number }> = {}
    const readScrollSnapshot = vi.fn((key: string) => snapshots[key] ?? null)
    const saveScrollSnapshot = vi.fn((key: string, snapshot: { scrollTop: number; pinnedToBottom: boolean; updatedAt: number }) => {
      snapshots[key] = snapshot
    })
    const { rerender, props, threadColumn } = renderThread([userMessage("user-1", "Prompt")], {
      readScrollSnapshot,
      saveScrollSnapshot,
      scrollStateKey: "session:session-1",
    })
    setScrollMetrics(threadColumn, {
      clientHeight: 400,
      scrollHeight: 1200,
      scrollTop: 800,
    })

    threadColumn.scrollTop = 120
    fireEvent.wheel(threadColumn, { deltaY: -120 })
    fireEvent.scroll(threadColumn)
    expect(snapshots["session:session-1"]?.scrollTop).toBe(120)

    threadColumn.scrollTop = 0
    fireEvent.scroll(threadColumn)

    expect(snapshots["session:session-1"]?.scrollTop).toBe(0)
    expect(snapshots["session:session-1"]?.pinnedToBottom).toBe(false)

    setScrollMetrics(threadColumn, {
      clientHeight: 400,
      scrollHeight: 1200,
      scrollTop: 0,
    })
    rerender(
      <ThreadView
        {...props}
        activeMessages={[userMessage("user-1", "Prompt"), userMessage("user-2", "Another prompt")]}
        scrollStateKey="session:session-1"
      />,
    )

    expect(threadColumn.scrollTop).toBe(0)
  })

  it("uses the external tab scroll key when switching workbench tabs", () => {
    const snapshots: Record<string, { scrollTop: number; pinnedToBottom: boolean; updatedAt: number }> = {}
    const readScrollSnapshot = vi.fn((key: string) => snapshots[key] ?? null)
    const saveScrollSnapshot = vi.fn((key: string, snapshot: { scrollTop: number; pinnedToBottom: boolean; updatedAt: number }) => {
      snapshots[key] = snapshot
    })
    const { rerender, props, threadColumn } = renderThread([userMessage("user-1", "Prompt")], {
      readScrollSnapshot,
      saveScrollSnapshot,
      scrollStateKey: "session:session-1",
    })
    setScrollMetrics(threadColumn, {
      clientHeight: 400,
      scrollHeight: 1200,
      scrollTop: 800,
    })

    threadColumn.scrollTop = 260
    fireEvent.wheel(threadColumn, { deltaY: -120 })
    fireEvent.scroll(threadColumn)

    expect(snapshots["session:session-1"]?.scrollTop).toBe(260)
    expect(snapshots["session:session-1"]?.pinnedToBottom).toBe(false)

    setScrollMetrics(threadColumn, {
      clientHeight: 400,
      scrollHeight: 900,
      scrollTop: 0,
    })
    rerender(
      <ThreadView
        {...props}
        activeSession={sessionB}
        activeMessages={[userMessage("user-2", "Other prompt")]}
        scrollStateKey="session:session-2"
      />,
    )
    expect(threadColumn.scrollTop).toBe(500)

    setScrollMetrics(threadColumn, {
      clientHeight: 400,
      scrollHeight: 1200,
      scrollTop: 0,
    })
    rerender(<ThreadView {...props} activeMessages={[userMessage("user-1", "Prompt")]} scrollStateKey="session:session-1" />)

    expect(threadColumn.scrollTop).toBe(260)
  })

  it("continues following latest content while the user remains pinned to bottom", () => {
    const { rerender, props, threadColumn } = renderThread([userMessage("user-1", "Prompt")])
    setScrollMetrics(threadColumn, {
      clientHeight: 400,
      scrollHeight: 800,
      scrollTop: 400,
    })

    fireEvent.wheel(threadColumn, { deltaY: 120 })
    fireEvent.scroll(threadColumn)

    setScrollMetrics(threadColumn, {
      clientHeight: 400,
      scrollHeight: 1400,
      scrollTop: 400,
    })
    rerender(
      <ThreadView
        {...props}
        activeMessages={[userMessage("user-1", "Prompt"), assistantMessage("assistant-1", "Streaming response")]}
      />,
    )

    expect(threadColumn.scrollTop).toBe(1000)
  })

  it("keeps streaming assistant output pinned to the bottom when layout rects are available", () => {
    const layoutSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("thread-column")) return createElementRect({ top: 0, height: 400 })

      const messageID = this.getAttribute("data-thread-message-id")
      if (messageID === "assistant-1") return createElementRect({ top: 64, height: 900 })

      return createElementRect()
    })
    const buildStreamingMessage = (text: string) => assistantTraceMessage("assistant-1", [
      {
        id: "response-1",
        kind: "text",
        timestamp: 1,
        label: "Assistant",
        text,
        status: "running",
        isStreaming: true,
      },
    ], true)

    try {
      const { rerender, props, threadColumn } = renderThread([
        userMessage("user-1", "Prompt"),
        buildStreamingMessage("First chunk"),
      ], {
        scrollStateKey: "session:streaming-layout-follow",
      })
      setScrollMetrics(threadColumn, {
        clientHeight: 400,
        scrollHeight: 800,
        scrollTop: 400,
      })

      fireEvent.wheel(threadColumn, { deltaY: 120 })
      fireEvent.scroll(threadColumn)

      setScrollMetrics(threadColumn, {
        clientHeight: 400,
        scrollHeight: 1400,
        scrollTop: 400,
      })
      rerender(
        <ThreadView
          {...props}
          activeMessages={[
            userMessage("user-1", "Prompt"),
            buildStreamingMessage("First chunk\nSecond chunk"),
          ]}
        />,
      )

      expect(threadColumn.scrollTop).toBe(1000)
    } finally {
      layoutSpy.mockRestore()
    }
  })

  it("keeps following streamed content during a sidebar resize without measuring streaming response rects", () => {
    const layoutSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (document.body.classList.contains("is-resizing-sidebar") && this.getAttribute("data-trace-item-id") === "response-1") {
        throw new Error("streaming response rect should not be measured during sidebar resize")
      }
      if (this.classList.contains("thread-column")) return createElementRect({ top: 0, height: 400 })
      if (this.getAttribute("data-trace-item-id") === "response-1") return createElementRect({ top: 64, height: 960 })

      return createElementRect()
    })
    const buildStreamingMessage = (text: string) => assistantTraceMessage("assistant-1", [
      {
        id: "response-1",
        kind: "text",
        timestamp: 1,
        label: "Assistant",
        text,
        status: "running",
        isStreaming: true,
      },
      {
        id: "tool-1",
        kind: "tool",
        timestamp: 2,
        label: "Tool",
        title: "ssh_shell_command",
        detail: "completed",
        status: "completed",
      },
    ], true)

    try {
      const { rerender, props, threadColumn } = renderThread([
        userMessage("user-1", "Prompt"),
        buildStreamingMessage("First chunk"),
      ], {
        scrollStateKey: "session:streaming-sidebar-resize-follow",
      })
      setScrollMetrics(threadColumn, {
        clientHeight: 400,
        scrollHeight: 800,
        scrollTop: 400,
      })

      fireEvent.wheel(threadColumn, { deltaY: 120 })
      fireEvent.scroll(threadColumn)

      document.body.classList.add("is-resizing-sidebar")
      setScrollMetrics(threadColumn, {
        clientHeight: 400,
        scrollHeight: 1600,
        scrollTop: 400,
      })
      rerender(
        <ThreadView
          {...props}
          activeMessages={[
            userMessage("user-1", "Prompt"),
            buildStreamingMessage("First chunk\nSecond chunk"),
          ]}
        />,
      )

      expect(threadColumn.scrollTop).toBe(1200)
    } finally {
      document.body.classList.remove("is-resizing-sidebar")
      layoutSpy.mockRestore()
    }
  })

  it("keeps the active streaming response at the bottom when trailing trace rows render below it", () => {
    const layoutSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("thread-column")) return createElementRect({ top: 0, height: 400 })
      if (this.getAttribute("data-trace-item-id") === "response-1") return createElementRect({ top: 64, height: 960 })

      return createElementRect()
    })
    const buildStreamingMessage = (text: string) => assistantTraceMessage("assistant-1", [
      {
        id: "response-1",
        kind: "text",
        timestamp: 1,
        label: "Assistant",
        text,
        status: "running",
        isStreaming: true,
      },
      {
        id: "tool-1",
        kind: "tool",
        timestamp: 2,
        label: "Tool",
        title: "ssh_shell_command",
        detail: "completed",
        status: "completed",
      },
      {
        id: "backend-fallback",
        kind: "system",
        timestamp: 3,
        label: "System",
        title: "No visible output",
        detail: "The backend stored this assistant message without replayable trace items.",
        status: "completed",
        section: "response",
        visibilityKey: "response",
      },
    ], true)

    try {
      const { rerender, props, threadColumn } = renderThread([
        userMessage("user-1", "Prompt"),
        buildStreamingMessage("First chunk"),
      ], {
        scrollStateKey: "session:streaming-response-before-trace",
      })
      setScrollMetrics(threadColumn, {
        clientHeight: 400,
        scrollHeight: 800,
        scrollTop: 400,
      })

      fireEvent.wheel(threadColumn, { deltaY: 120 })
      fireEvent.scroll(threadColumn)

      setScrollMetrics(threadColumn, {
        clientHeight: 400,
        scrollHeight: 1600,
        scrollTop: 400,
      })
      rerender(
        <ThreadView
          {...props}
          activeMessages={[
            userMessage("user-1", "Prompt"),
            buildStreamingMessage("First chunk\nSecond chunk"),
          ]}
        />,
      )

      expect(threadColumn.scrollTop).toBe(1024)
    } finally {
      layoutSpy.mockRestore()
    }
  })

  it("keeps a virtualized streaming response at the bottom when trailing trace rows render below it", async () => {
    const animationFrame = installManualAnimationFrame()
    const layoutSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("thread-column")) return createElementRect({ top: 0, height: 400 })
      if (this.getAttribute("data-trace-item-id") === "response-virtual") return createElementRect({ top: 64, height: 960 })

      return createElementRect()
    })
    const historyMessages = Array.from({ length: 320 }, (_, index) => userMessage(`user-${index}`, `Prompt ${index}`))
    const buildStreamingMessage = (text: string) => assistantTraceMessage("assistant-virtual", [
      {
        id: "response-virtual",
        kind: "text",
        timestamp: 1,
        label: "Assistant",
        text,
        status: "running",
        isStreaming: true,
      },
      {
        id: "backend-fallback-virtual",
        kind: "system",
        timestamp: 2,
        label: "System",
        title: "No visible output",
        detail: "The backend stored this assistant message without replayable trace items.",
        status: "completed",
        section: "response",
        visibilityKey: "response",
      },
    ], true)

    try {
      const { rerender, props, threadColumn } = renderThread([
        ...historyMessages,
        buildStreamingMessage("First chunk"),
      ], {
        scrollStateKey: "session:virtual-streaming-response-before-trace",
      })
      setScrollMetrics(threadColumn, {
        clientHeight: 400,
        scrollHeight: 30000,
        scrollTop: 29600,
      })

      fireEvent.wheel(threadColumn, { deltaY: 120 })
      fireEvent.scroll(threadColumn)
      act(() => animationFrame.flush())
      await waitFor(() => expect(screen.getByText("First chunk")).toBeInTheDocument())

      setScrollMetrics(threadColumn, {
        clientHeight: 400,
        scrollHeight: 31000,
        scrollTop: 29600,
      })
      rerender(
        <ThreadView
          {...props}
          activeMessages={[
            ...historyMessages,
            buildStreamingMessage("First chunk\nSecond chunk"),
          ]}
        />,
      )

      expect(threadColumn.scrollTop).toBe(30224)
    } finally {
      layoutSpy.mockRestore()
      animationFrame.restore()
    }
  })

  it("smoothly follows small streaming height changes while pinned to the bottom", () => {
    const originalRequestAnimationFrame = window.requestAnimationFrame
    const originalCancelAnimationFrame = window.cancelAnimationFrame
    let nextFrameID = 0
    const pendingFrames = new Map<number, FrameRequestCallback>()
    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      nextFrameID += 1
      pendingFrames.set(nextFrameID, callback)
      return nextFrameID
    })
    window.cancelAnimationFrame = vi.fn((frameID: number) => {
      pendingFrames.delete(frameID)
    })
    const flushAnimationFrame = (timestamp: number) => {
      const callbacks = Array.from(pendingFrames.values())
      pendingFrames.clear()
      for (const callback of callbacks) {
        callback(timestamp)
      }
    }
    const buildStreamingMessage = (text: string) => assistantTraceMessage("assistant-1", [
      {
        id: "response-1",
        kind: "text",
        timestamp: 1,
        label: "Assistant",
        text,
        status: "running",
        isStreaming: true,
      },
    ], true)

    try {
      const { rerender, props, threadColumn } = renderThread([
        userMessage("user-1", "Prompt"),
        buildStreamingMessage("First chunk"),
      ], {
        scrollStateKey: "session:streaming-smooth-follow",
      })
      setScrollMetrics(threadColumn, {
        clientHeight: 400,
        scrollHeight: 800,
        scrollTop: 400,
      })

      setScrollMetrics(threadColumn, {
        clientHeight: 400,
        scrollHeight: 830,
        scrollTop: 400,
      })
      rerender(
        <ThreadView
          {...props}
          activeMessages={[
            userMessage("user-1", "Prompt"),
            buildStreamingMessage("First chunk\nSecond chunk"),
          ]}
        />,
      )

      expect(threadColumn.scrollTop).toBe(400)
      act(() => flushAnimationFrame(10_000))
      expect(threadColumn.scrollTop).toBeCloseTo(430, 2)
    } finally {
      pendingFrames.clear()
      window.requestAnimationFrame = originalRequestAnimationFrame
      window.cancelAnimationFrame = originalCancelAnimationFrame
    }
  })

  it("does not follow new streamed content after an upward wheel intent before the scroll event fires", () => {
    const buildStreamingMessage = (text: string) => assistantTraceMessage("assistant-1", [
      {
        id: "response-1",
        kind: "text",
        timestamp: 1,
        label: "Assistant",
        text,
        status: "running",
        isStreaming: true,
      },
    ], true)
    const { rerender, props, threadColumn } = renderThread([
      userMessage("user-1", "Prompt"),
      buildStreamingMessage("First chunk"),
    ], {
      scrollStateKey: "session:wheel-detached-race",
    })
    setScrollMetrics(threadColumn, {
      clientHeight: 400,
      scrollHeight: 800,
      scrollTop: 400,
    })

    fireEvent.wheel(threadColumn, { deltaY: -120 })

    setScrollMetrics(threadColumn, {
      clientHeight: 400,
      scrollHeight: 1400,
      scrollTop: 400,
    })
    rerender(
      <ThreadView
        {...props}
        activeMessages={[
          userMessage("user-1", "Prompt"),
          buildStreamingMessage("First chunk\nSecond chunk"),
        ]}
      />,
    )

    expect(threadColumn.scrollTop).toBe(400)
  })

  it("scrolls to the bottom when a stream-inserted user message becomes visible", () => {
    const layoutSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("thread-column")) return createElementRect({ top: 0, height: 400 })

      const messageID = this.getAttribute("data-thread-message-id")
      if (messageID === "assistant-1") return createElementRect({ top: 64, height: 700 })
      if (messageID === "user-steer") return createElementRect({ top: 430, height: 80 })

      return createElementRect()
    })
    const assistantItems: AssistantTraceItem[] = [
      {
        id: "assistant-before",
        kind: "text",
        timestamp: 1,
        label: "Assistant",
        text: "Before steer",
        status: "running",
        isStreaming: true,
      },
      {
        id: "assistant-after",
        kind: "text",
        timestamp: 2,
        label: "Assistant",
        text: "After steer",
        status: "running",
        isStreaming: true,
      },
    ]
    const steerMessage: UserThreadMessage = {
      ...userMessage("user-steer", "Adjust the current task"),
      submissionMode: "steer",
      streamInsertion: {
        assistantThreadMessageID: "assistant-1",
        afterItemCount: 1,
      },
    }

    try {
      const { rerender, props, threadColumn } = renderThread([
        userMessage("user-1", "Prompt"),
        assistantTraceMessage("assistant-1", assistantItems, true),
      ])
      setScrollMetrics(threadColumn, {
        clientHeight: 400,
        scrollHeight: 1400,
        scrollTop: 800,
      })

      rerender(
        <ThreadView
          {...props}
          activeMessages={[
            userMessage("user-1", "Prompt"),
            assistantTraceMessage("assistant-1", assistantItems, true),
            steerMessage,
          ]}
        />,
      )

      expect(threadColumn.scrollTop).toBe(1000)
    } finally {
      layoutSpy.mockRestore()
    }
  })

  it("does not realign to the latest assistant message when streaming completes", () => {
    const streamingItems: AssistantTraceItem[] = [
      {
        id: "reasoning-1",
        kind: "reasoning",
        timestamp: 1,
        label: "Reasoning",
        text: "Inspect files first",
        status: "running",
        isStreaming: true,
      },
      {
        id: "response-1",
        kind: "text",
        timestamp: 2,
        label: "Assistant",
        text: "Drafting",
        status: "running",
        isStreaming: true,
      },
    ]
    const completedItems: AssistantTraceItem[] = streamingItems.map((item) => ({
      ...item,
      status: "completed",
      isStreaming: false,
      text: item.id === "response-1" ? "Done" : item.text,
    }))
    const { rerender, props, threadColumn } = renderThread([
      userMessage("user-1", "Prompt"),
      assistantTraceMessage("assistant-1", streamingItems, true),
    ])
    setScrollMetrics(threadColumn, {
      clientHeight: 400,
      scrollHeight: 1200,
      scrollTop: 360,
    })

    rerender(
      <ThreadView
        {...props}
        activeMessages={[userMessage("user-1", "Prompt"), assistantTraceMessage("assistant-1", completedItems, false)]}
      />,
    )

    expect(threadColumn.scrollTop).toBe(360)
  })

  it("defers observed content scroll sync while a sidebar resize is active", () => {
    const originalResizeObserver = globalThis.ResizeObserver
    let triggerResize: (() => void) | null = null

    class ManualResizeObserver implements ResizeObserver {
      readonly callback: ResizeObserverCallback

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
        triggerResize = () => {
          callback([], this)
        }
      }

      observe() {}

      unobserve() {}

      disconnect() {}
    }

    globalThis.ResizeObserver = ManualResizeObserver

    try {
      const { threadColumn } = renderThread([userMessage("user-1", "Prompt"), assistantMessage("assistant-1", "Loaded history")])
      setScrollMetrics(threadColumn, {
        clientHeight: 400,
        scrollHeight: 800,
        scrollTop: 400,
      })

      document.body.classList.add("is-resizing-sidebar")
      setScrollMetrics(threadColumn, {
        clientHeight: 400,
        scrollHeight: 1400,
        scrollTop: 400,
      })

      act(() => {
        triggerResize?.()
      })

      expect(threadColumn.scrollTop).toBe(400)

      document.body.classList.remove("is-resizing-sidebar")
      act(() => {
        window.dispatchEvent(new Event(SIDEBAR_RESIZE_END_EVENT))
      })

      expect(threadColumn.scrollTop).toBe(1000)
    } finally {
      document.body.classList.remove("is-resizing-sidebar")
      globalThis.ResizeObserver = originalResizeObserver
    }
  })
})
