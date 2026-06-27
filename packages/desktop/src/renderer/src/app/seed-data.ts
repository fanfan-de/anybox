import type { AssistantTraceItem, AssistantTraceItemKind, AssistantThreadMessageRuntime, ThreadMessage, WorkspaceGroup } from "./types"

const timestamp = (value: string) => new Date(value).getTime()

function traceItem(
  id: string,
  kind: AssistantTraceItemKind,
  time: string,
  label: string,
  details: Omit<AssistantTraceItem, "id" | "kind" | "timestamp" | "label"> = {},
): AssistantTraceItem {
  return {
    id,
    kind,
    timestamp: timestamp(time),
    label,
    ...details,
  }
}

function completedRuntime(time: string): AssistantThreadMessageRuntime {
  const value = timestamp(time)
  return {
    phase: "completed",
    startedAt: value,
    updatedAt: value,
    firstVisibleAt: value,
  }
}

export const seedWorkspaces: WorkspaceGroup[] = [
  {
    id: "C:\\Projects\\Project 1\\src",
    name: "src",
    directory: "C:\\Projects\\Project 1\\src",
    created: timestamp("2026-03-31T09:24:00+08:00"),
    updated: timestamp("2026-03-31T09:24:00+08:00"),
    project: {
      id: "project-1",
      name: "Project 1",
      worktree: "C:\\Projects\\Project 1",
    },
    sessions: [
      {
        id: "session-layout-pass",
        title: "Layout pass",
        branch: "feature/layout-pass",
        status: "Ready",
        updated: timestamp("2026-03-31T09:24:00+08:00"),
        focus: "Polish",
        summary: "Tighten the shell layout and reduce visual noise around the message lane.",
      },
    ],
  },
  {
    id: "C:\\Projects\\Project 2\\app",
    name: "app",
    directory: "C:\\Projects\\Project 2\\app",
    created: timestamp("2026-03-31T10:12:00+08:00"),
    updated: timestamp("2026-03-31T10:12:00+08:00"),
    project: {
      id: "project-2",
      name: "Project 2",
      worktree: "C:\\Projects\\Project 2",
    },
    sessions: [
      {
        id: "session-chat-1",
        title: "Chat 1",
        branch: "feature/anybox-sidebar",
        status: "Live",
        updated: timestamp("2026-03-31T10:12:00+08:00"),
        focus: "Ship",
        summary: "Rebuild the left rail so it behaves like a lightweight project tree.",
      },
      {
        id: "session-chat-2",
        title: "Chat 2",
        branch: "feature/review-lane",
        status: "Review",
        updated: timestamp("2026-03-31T08:42:00+08:00"),
        focus: "Review",
        summary: "ThreadMessage the assistant output into a review-first stream with stronger scanability.",
      },
    ],
  },
  {
    id: "C:\\Projects\\Project 3\\docs",
    name: "docs",
    directory: "C:\\Projects\\Project 3\\docs",
    created: timestamp("2026-03-30T18:06:00+08:00"),
    updated: timestamp("2026-03-30T18:06:00+08:00"),
    project: {
      id: "project-3",
      name: "Project 3",
      worktree: "C:\\Projects\\Project 3",
    },
    sessions: [
      {
        id: "session-delivery-plan",
        title: "Delivery plan",
        branch: "feature/delivery-plan",
        status: "Ready",
        updated: timestamp("2026-03-30T18:06:00+08:00"),
        focus: "Plan",
        summary: "Break the request into milestones and keep approval points explicit.",
      },
    ],
  },
]

export const initialConversations: Record<string, ThreadMessage[]> = {
  "session-layout-pass": [
    {
      id: "layout-user-1",
      kind: "user",
      text: "Keep the shell quiet and let the center column stay dominant.",
      timestamp: timestamp("2026-03-31T09:12:00+08:00"),
    },
    {
      id: "layout-agent-1",
      kind: "assistant",
      backendTurnID: "layout-turn-1",
      segmentID: "layout-agent-1",
      timestamp: timestamp("2026-03-31T09:13:00+08:00"),
      runtime: completedRuntime("2026-03-31T09:13:00+08:00"),
      state: "Shell structure aligned",
      items: [
        traceItem("layout-trace-1", "system", "2026-03-31T09:13:00+08:00", "Prompt", {
          title: "Prompt captured",
          detail: "Keep the shell quiet and let the center column stay dominant.",
          status: "completed",
        }),
        traceItem("layout-trace-2", "reasoning", "2026-03-31T09:13:01+08:00", "Reasoning", {
          text: "The window chrome should read as a frame, not a feature.",
        }),
        traceItem("layout-trace-3", "reasoning", "2026-03-31T09:13:02+08:00", "Reasoning", {
          text: "The sidebar should support project navigation without competing with the active thread.",
        }),
        traceItem("layout-trace-4", "text", "2026-03-31T09:13:04+08:00", "Response", {
          text: "I kept the desktop frame restrained, moved the emphasis back to the center lane, and left space for the composer to stay visually anchored at the bottom.",
        }),
        traceItem("layout-trace-5", "patch", "2026-03-31T09:13:05+08:00", "Patch", {
          title: "Desktop shell pass",
          detail: "Balanced the window chrome, workspace rail, thread lane, and composer spacing.",
          status: "completed",
        }),
        traceItem("layout-trace-6", "system", "2026-03-31T09:13:06+08:00", "System", {
          title: "Next direction",
          detail: "Use the same restraint when the sidebar switches between projects and expanded conversations.",
          status: "completed",
        }),
      ],
    },
  ],
  "session-chat-1": [
    {
      id: "chat-user-1",
      kind: "user",
      text: "Make the left rail feel closer to Anybox and less like a dashboard.",
      timestamp: timestamp("2026-03-31T10:06:00+08:00"),
    },
    {
      id: "chat-agent-1",
      messageID: "chat-agent-message-1",
      kind: "assistant",
      backendTurnID: "chat-turn-1",
      segmentID: "chat-agent-message-1:1",
      timestamp: timestamp("2026-03-31T10:08:00+08:00"),
      runtime: completedRuntime("2026-03-31T10:08:00+08:00"),
      state: "Sidebar direction corrected",
      items: [
        traceItem("chat-trace-1", "system", "2026-03-31T10:08:00+08:00", "Prompt", {
          title: "Prompt captured",
          detail: "Make the left rail feel closer to Anybox and less like a dashboard.",
          status: "completed",
        }),
        traceItem("chat-trace-2", "reasoning", "2026-03-31T10:08:01+08:00", "Reasoning", {
          text: "The active project should own the only expanded conversation list.",
        }),
        traceItem("chat-trace-3", "reasoning", "2026-03-31T10:08:02+08:00", "Reasoning", {
          text: "Project rows need state through icon, weight, and background rather than through stacked metadata.",
        }),
        traceItem("chat-trace-4", "text", "2026-03-31T10:08:04+08:00", "Response", {
          text: "I am collapsing the information-heavy workspace cards into a project tree so the rail behaves like navigation, not like a second content surface.",
        }),
        traceItem("chat-trace-5", "patch", "2026-03-31T10:08:05+08:00", "Patch", {
          title: "Tree navigation model",
          detail: "Top actions, project rows, nested conversations, and a single bottom settings action.",
          status: "completed",
        }),
        traceItem("chat-trace-6", "step", "2026-03-31T10:08:06+08:00", "Step", {
          title: "Active row treatment",
          detail: "Used background, icon swap, indentation, and text weight instead of extra cards.",
          status: "completed",
        }),
      ],
    },
  ],
  "session-chat-2": [
    {
      id: "chat-review-1",
      kind: "assistant",
      backendTurnID: "chat-review-turn-1",
      segmentID: "chat-review-1",
      timestamp: timestamp("2026-03-31T08:36:00+08:00"),
      runtime: completedRuntime("2026-03-31T08:36:00+08:00"),
      state: "Review lane scoped",
      items: [
        traceItem("review-trace-1", "reasoning", "2026-03-31T08:36:00+08:00", "Reasoning", {
          text: "Review mode should privilege conclusion over chronology.",
        }),
        traceItem("review-trace-2", "reasoning", "2026-03-31T08:36:01+08:00", "Reasoning", {
          text: "Artifacts need enough structure to attach logs or file changes later.",
        }),
        traceItem("review-trace-3", "text", "2026-03-31T08:36:03+08:00", "Response", {
          text: "The thread is now organized as an event trace so the agent's reasoning, output, and tool activity stay visible in the order they happened.",
        }),
        traceItem("review-trace-4", "patch", "2026-03-31T08:36:04+08:00", "Patch", {
          title: "Trace-first response",
          detail: "The response exposes reasoning, response text, and structured events without collapsing them into a summary-first card.",
          status: "completed",
        }),
      ],
    },
  ],
  "session-delivery-plan": [
    {
      id: "delivery-agent-1",
      kind: "assistant",
      backendTurnID: "delivery-turn-1",
      segmentID: "delivery-agent-1",
      timestamp: timestamp("2026-03-30T18:06:00+08:00"),
      runtime: completedRuntime("2026-03-30T18:06:00+08:00"),
      state: "Plan ready",
      items: [
        traceItem("plan-trace-1", "system", "2026-03-30T18:06:00+08:00", "System", {
          title: "Plan staged",
          detail: "The request is split into checkpoints so implementation can move without losing approval points.",
          status: "completed",
        }),
        traceItem("plan-trace-2", "reasoning", "2026-03-30T18:06:01+08:00", "Reasoning", {
          text: "Capture the shell changes before introducing real backend state.",
        }),
        traceItem("plan-trace-3", "reasoning", "2026-03-30T18:06:02+08:00", "Reasoning", {
          text: "Keep the component boundaries obvious so the desktop view can evolve safely.",
        }),
        traceItem("plan-trace-4", "step", "2026-03-30T18:06:04+08:00", "Step", {
          title: "Milestone outline",
          detail: "Defines a path from shell cleanup to data-backed agent sessions.",
          status: "completed",
        }),
        traceItem("plan-trace-5", "text", "2026-03-30T18:06:05+08:00", "Response", {
          text: "Feed in the next task and I will expand it into implementation-sized steps.",
        }),
      ],
    },
  ],
}

const initialSeedWorkspace = seedWorkspaces[1] ?? seedWorkspaces[0] ?? null

export const initialSelection = {
  workspace: initialSeedWorkspace,
  session: initialSeedWorkspace?.sessions[0] ?? null,
}
