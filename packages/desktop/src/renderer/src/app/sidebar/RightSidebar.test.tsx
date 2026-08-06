import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"
import type { AgentSessionBridgeEvent } from "../agent-session/client"
import {
  type RightSidebarState,
  type RightSidebarTab,
  type SessionRuntimeDebugSnapshot,
  type WorkspaceGroup,
  DEFAULT_ASSISTANT_TRACE_VISIBILITY,
} from "../types"
import { DEFAULT_WORKSPACE_FILE_REVIEW_STATE, DEFAULT_WORKSPACE_PREVIEW_STATE } from "../agent-workspace/review-preview-state"
import { I18nProvider } from "../i18n/I18nProvider"
import type { SessionMessageTree } from "../session-message-tree"
import { ToastProvider } from "../toast"
import { RightSidebar } from "./RightSidebar"

const workspace: WorkspaceGroup = {
  id: "workspace-1",
  name: "Workspace",
  directory: "C:/work/workspace-1",
  created: 1,
  updated: 1,
  project: {
    id: "project-1",
    name: "Project",
    worktree: "C:/work/workspace-1",
  },
  sessions: [
    {
      id: "session-1",
      title: "Session",
      branch: "main",
      focus: "Build",
      summary: "",
      status: "Ready",
      updated: 1,
    },
  ],
}

function createFilesTab(): RightSidebarTab {
  return {
    id: "files-tab",
    kind: "files",
    title: "Files",
    targetKey: "files:workspace",
    createdAt: 1,
    scopeDirectory: workspace.directory,
    scopeName: workspace.name,
    state: {
      ...DEFAULT_WORKSPACE_FILE_REVIEW_STATE,
      scopeDirectory: workspace.directory,
    },
  }
}

function createBrowserTab(): RightSidebarTab {
  return {
    id: "browser-tab",
    kind: "browser",
    title: "Browser",
    targetKey: "browser:workspace",
    createdAt: 2,
    workspaceID: workspace.id,
    workspaceRoot: workspace.directory,
    state: DEFAULT_WORKSPACE_PREVIEW_STATE,
  }
}

function createTerminalTab(): RightSidebarTab {
  return {
    id: "terminal-tab",
    kind: "terminal",
    title: "Terminal",
    targetKey: "terminal:session-1",
    createdAt: 4,
    sessionID: "session-1",
  }
}

function createMessageInspectorTab(messageID = "assistant-2"): RightSidebarTab {
  return {
    id: "message-inspector-tab",
    kind: "message-inspector",
    title: "Conversation",
    targetKey: "message-inspector",
    createdAt: 4,
    messageID,
    sessionID: "session-1",
  }
}

function createBranchChatTab(): Extract<RightSidebarTab, { kind: "branch-thread" }> {
  return {
    id: "branch-chat-tab",
    kind: "branch-thread",
    title: "Branch Chat",
    targetKey: "branch-thread:session-1:assistant-anchor",
    createdAt: 5,
    sessionID: "session-1",
    originMessageID: "assistant-anchor",
    headMessageID: "assistant-anchor",
    executionID: "branch-chat-tab",
    anchorStrategy: "selected",
    phase: "draft",
    initialQuotes: [],
  }
}

function createMessageTree(input?: {
  activeMessageID?: string
  activePathMessageIDs?: string[]
}): SessionMessageTree {
  return {
    activeMessageID: input?.activeMessageID ?? "assistant-1",
    activePathMessageIDs: input?.activePathMessageIDs ?? ["user-1", "assistant-1"],
    branchOptionsByParentID: {},
    childIDsByParentID: {
      "__root__": ["user-1"],
      "user-1": ["assistant-1", "assistant-2"],
      "assistant-1": ["user-2"],
    },
    nodesByID: {
      "user-1": {
        content: "Root prompt",
        id: "user-1",
        sessionID: "session-1",
        role: "user",
        created: 1,
        parentMessageID: null,
        preview: "Root prompt",
      },
      "assistant-1": {
        content: "Active answer\n\nThis is the complete response content shown when the response node expands in place.",
        id: "assistant-1",
        sessionID: "session-1",
        role: "assistant",
        created: 2,
        parentMessageID: "user-1",
        preview: "Active answer",
      },
      "user-2": {
        content: "Follow up",
        id: "user-2",
        sessionID: "session-1",
        role: "user",
        created: 3,
        parentMessageID: "assistant-1",
        preview: "Follow up",
      },
      "assistant-2": {
        content: "Alternative answer\n\nThis is the second complete response content.",
        id: "assistant-2",
        sessionID: "session-1",
        role: "assistant",
        created: 4,
        parentMessageID: "user-1",
        preview: "Alternative answer",
      },
    },
    rootMessageIDs: ["user-1"],
    sessionID: "session-1",
  }
}

function createBranchChatTree(): SessionMessageTree {
  return {
    activeMessageID: "assistant-main",
    activePathMessageIDs: [
      "user-root",
      "assistant-anchor",
      "user-main",
      "assistant-main",
    ],
    branchOptionsByParentID: {},
    childIDsByParentID: {
      "__root__": ["user-root"],
      "user-root": ["assistant-anchor"],
      "assistant-anchor": ["user-main", "user-branch"],
      "user-main": ["assistant-main"],
      "user-branch": ["assistant-branch"],
    },
    nodesByID: {
      "user-root": {
        content: "Root prompt",
        id: "user-root",
        sessionID: "session-1",
        role: "user",
        created: 1,
        parentMessageID: null,
        preview: "Root prompt",
      },
      "assistant-anchor": {
        content: "Shared answer",
        id: "assistant-anchor",
        sessionID: "session-1",
        role: "assistant",
        created: 2,
        completed: 2,
        isCompletedResponse: true,
        parentMessageID: "user-root",
        preview: "Shared answer",
        turnStatus: "completed",
      },
      "user-main": {
        content: "Continue main",
        id: "user-main",
        sessionID: "session-1",
        role: "user",
        created: 3,
        parentMessageID: "assistant-anchor",
        preview: "Continue main",
      },
      "assistant-main": {
        content: "Main result",
        id: "assistant-main",
        sessionID: "session-1",
        role: "assistant",
        created: 4,
        completed: 4,
        isCompletedResponse: true,
        parentMessageID: "user-main",
        preview: "Main result",
        turnStatus: "completed",
      },
      "user-branch": {
        content: "Explore branch",
        id: "user-branch",
        sessionID: "session-1",
        role: "user",
        created: 5,
        parentMessageID: "assistant-anchor",
        preview: "Explore branch",
      },
      "assistant-branch": {
        content: "Branch result",
        id: "assistant-branch",
        sessionID: "session-1",
        role: "assistant",
        created: 6,
        completed: 6,
        isCompletedResponse: true,
        parentMessageID: "user-branch",
        preview: "Branch result",
        turnStatus: "completed",
      },
    },
    rootMessageIDs: ["user-root"],
    sessionID: "session-1",
  }
}

type RenderRightSidebarInput = {
  activeSession?: WorkspaceGroup["sessions"][number] | null
  activeSessionRuntimeDebug?: SessionRuntimeDebugSnapshot | null
  canOpenReview?: boolean
  canOpenTerminal?: boolean
  messageTreeBySession?: Record<string, SessionMessageTree>
  rightSidebar: RightSidebarState
  workspaces?: WorkspaceGroup[]
  onActivateTab?: (tabID: string) => void
  onCloseTab?: (tabID: string) => void
  onOpenBrowserTab?: () => void
  onOpenFilesTab?: () => void
  onOpenReviewTab?: () => void
  onOpenTerminalTab?: () => void
  onOpenBranchChat?: ComponentProps<typeof RightSidebar>["onOpenBranchChat"]
  onLocateBranchAnchor?: ComponentProps<typeof RightSidebar>["onLocateBranchAnchor"]
  onUpdateTab?: ComponentProps<typeof RightSidebar>["onUpdateTab"]
  renderTerminalTab?: ComponentProps<typeof RightSidebar>["renderTerminalTab"]
  threadPaneContext?: ComponentProps<typeof RightSidebar>["threadPaneContext"]
  withI18n?: boolean
}

function createRightSidebarUI(input: RenderRightSidebarInput) {
  const ui = (
    <ToastProvider>
      <RightSidebar
        assistantTraceVisibility={DEFAULT_ASSISTANT_TRACE_VISIBILITY}
        activeSession={input.activeSession === undefined ? workspace.sessions[0] ?? null : input.activeSession}
        activeSessionRuntimeDebug={input.activeSessionRuntimeDebug}
        activeSessionDirectory={workspace.directory}
        activeWorkspaceFileScopeDirectory={workspace.directory}
        activeWorkspaceFileScopeName={workspace.name}
        canInsertWorkspaceFileCommentsIntoDraft={true}
        canOpenReview={input.canOpenReview ?? true}
        canOpenTerminal={input.canOpenTerminal ?? true}
        codeTheme="github-light"
        rightSidebar={input.rightSidebar}
        threadPaneContext={input.threadPaneContext}
        selectedDiffFileBySession={{}}
        sessionDiffBySession={{}}
        sessionDiffStateBySession={{}}
        messageTreeBySession={input.messageTreeBySession ?? {}}
        workspaces={input.workspaces ?? [workspace]}
        onActivateTab={input.onActivateTab ?? vi.fn()}
        onCloseTab={input.onCloseTab ?? vi.fn()}
        onUpdateTab={input.onUpdateTab ?? vi.fn()}
        onArtifactLinkOpen={vi.fn()}
        onDiffFileRestore={vi.fn()}
        onDiffFileSelect={vi.fn()}
        onLocalFileLinkOpen={vi.fn()}
        onOpenBrowserTab={input.onOpenBrowserTab ?? vi.fn()}
        onOpenFilesTab={input.onOpenFilesTab ?? vi.fn()}
        onOpenReviewTab={input.onOpenReviewTab ?? vi.fn()}
        onOpenTerminalTab={input.onOpenTerminalTab ?? vi.fn()}
        onOpenBranchChat={input.onOpenBranchChat ?? vi.fn()}
        onLocateBranchAnchor={input.onLocateBranchAnchor}
        onPreviewActiveInteractionChange={vi.fn()}
        onPreviewBack={vi.fn()}
        onPreviewCommitInteraction={vi.fn()}
        onPreviewDraftUrlChange={vi.fn()}
        onPreviewForward={vi.fn()}
        onPreviewOpen={vi.fn()}
        onPreviewOpenExternal={vi.fn()}
        onPreviewOpenUrl={vi.fn()}
        onPreviewReload={vi.fn()}
        onWorkspaceFileCommentCancel={vi.fn()}
        onWorkspaceFileCommentChange={vi.fn()}
        onWorkspaceFileCommentConfirm={vi.fn()}
        onWorkspaceFileCommentStart={vi.fn()}
        onWorkspaceDirectoryLoad={vi.fn()}
        onWorkspaceDirectoryToggle={vi.fn()}
        onWorkspaceFileTreeInvalidate={vi.fn()}
        onWorkspaceFileQueryChange={vi.fn()}
        onWorkspaceFileSelect={vi.fn()}
        renderTerminalTab={input.renderTerminalTab ?? (() => <div role="region" aria-label="Terminal tab" />)}
      />
    </ToastProvider>
  )

  return input.withI18n ? <I18nProvider>{ui}</I18nProvider> : ui
}

function renderRightSidebar(input: RenderRightSidebarInput) {
  return render(createRightSidebarUI(input))
}

describe("RightSidebar", () => {
  it("lets the active terminal sync its live tab title without reserving outer-header actions", () => {
    const onUpdateTab = vi.fn()
    const renderTerminalTab: ComponentProps<typeof RightSidebar>["renderTerminalTab"] = (input) => (
      <div role="region" aria-label="Terminal tab">
        <button type="button" onClick={() => input.onTitleChange("Terminal · test")}>Sync terminal title</button>
      </div>
    )

    renderRightSidebar({
      rightSidebar: {
        activeTabID: "terminal-tab",
        tabs: [createTerminalTab()],
      },
      onUpdateTab,
      renderTerminalTab,
    })

    fireEvent.click(screen.getByRole("button", { name: "Sync terminal title" }))

    expect(onUpdateTab).toHaveBeenCalledWith("terminal-tab", { title: "Terminal · test" })
    expect(document.querySelector(".right-sidebar-terminal-actions-slot")).toBeNull()
  })

  it("shows the launcher when there are no right sidebar tabs", () => {
    const onOpenFilesTab = vi.fn()
    const onOpenTerminalTab = vi.fn()

    renderRightSidebar({
      canOpenTerminal: false,
      rightSidebar: {
        activeTabID: null,
        tabs: [],
      },
      onOpenFilesTab,
      onOpenTerminalTab,
    })

    fireEvent.click(screen.getByRole("button", { name: /^Files/ }))
    expect(onOpenFilesTab).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("button", { name: /^Tree/ })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Terminal/ })).toBeDisabled()
    expect(onOpenTerminalTab).not.toHaveBeenCalled()
  })

  it("keeps recent branches out of the right sidebar launcher", () => {
    renderRightSidebar({
      messageTreeBySession: {
        "session-1": createBranchChatTree(),
      },
      rightSidebar: {
        activeTabID: null,
        tabs: [],
      },
    })

    expect(screen.queryByRole("button", { name: "Open recent branches" })).not.toBeInTheDocument()
    expect(screen.queryByText("Recent branches")).not.toBeInTheDocument()
  })

  it("shows queued detached execution state in the Branch Chat recent menu", async () => {
    const onOpenBranchChat = vi.fn()
    const tab = {
      ...createBranchChatTab(),
      headMessageID: "assistant-branch",
      phase: "committed" as const,
    }
    renderRightSidebar({
      activeSessionRuntimeDebug: {
        generatedAt: 1,
        logging: {},
        session: {
          id: "session-1",
          missing: false,
        },
        status: { type: "busy" },
        running: {
          sessionID: "session-1",
          startedAt: 1,
          activeForMs: 1,
        },
        executions: [{
          sessionID: "session-1",
          executionID: "branch-execution",
          targetKind: "detached-branch",
          headMessageID: "assistant-branch",
          status: "running",
          startedAt: 1,
          activeForMs: 1,
          activeTurnID: "turn-branch",
          queueLength: 1,
          queuedOpCount: 1,
          pendingSteerCount: 0,
        }],
        activeTurnID: "turn-branch",
        latestTurn: null,
        turns: [],
        recentEvents: [],
        diagnostics: {
          blockedOnApproval: false,
          activeToolCount: 0,
          failedToolCount: 0,
          llmFailureCount: 0,
        },
      },
      messageTreeBySession: {
        "session-1": createBranchChatTree(),
      },
      rightSidebar: {
        activeTabID: tab.id,
        tabs: [tab],
      },
      onOpenBranchChat,
    })

    const recentTrigger = screen.getByRole("button", { name: "Open recent branches" })
    expect(recentTrigger.closest(".branch-chat-toolbar")).not.toBeNull()
    fireEvent.click(recentTrigger)

    const recentListbox = await screen.findByRole("listbox", { name: "Recent branches" })
    const recentOption = within(recentListbox).getByRole("option", { name: /Explore branch/ })
    expect(recentOption).toHaveAttribute("aria-selected", "true")
    expect(recentOption).toHaveTextContent("Branch result")
    expect(recentOption).toHaveTextContent("queued")

    fireEvent.click(recentOption)
    expect(onOpenBranchChat).toHaveBeenCalledWith({
      anchorStrategy: "selected",
      sessionID: "session-1",
      originMessageID: "assistant-anchor",
      headMessageID: "assistant-branch",
      phase: "committed",
      title: "Explore branch",
    })
  })

  it("keeps the Branch Chat recent menu trigger disabled without derived branches", () => {
    const tab = createBranchChatTab()
    renderRightSidebar({
      messageTreeBySession: {},
      rightSidebar: {
        activeTabID: tab.id,
        tabs: [tab],
      },
    })

    const recentTrigger = screen.getByRole("button", { name: "Open recent branches" })
    expect(recentTrigger).toBeDisabled()
    expect(recentTrigger).toHaveAttribute("title", "No recent branches yet")
    fireEvent.click(recentTrigger)
    expect(screen.queryByRole("listbox", { name: "Recent branches" })).not.toBeInTheDocument()
  })

  it("opens a generic Branch Chat with a send-time latest-response strategy", () => {
    const onOpenBranchChat = vi.fn()

    renderRightSidebar({
      messageTreeBySession: {
        "session-1": createBranchChatTree(),
      },
      rightSidebar: {
        activeTabID: null,
        tabs: [],
      },
      onOpenBranchChat,
    })

    fireEvent.click(screen.getByRole("button", { name: /^Branch Chat/ }))

    expect(onOpenBranchChat).toHaveBeenCalledWith({
      anchorStrategy: "latest-at-send",
      originMessageID: "assistant-main",
      sessionID: "session-1",
    })
  })

  it("localizes the remaining launcher cards in Chinese", () => {
    window.localStorage.removeItem("desktop.locale")

    renderRightSidebar({
      withI18n: true,
      rightSidebar: {
        activeTabID: null,
        tabs: [],
      },
    })

    expect(screen.getByText("分支对话")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "分支对话" })).toBeDisabled()
    expect(screen.queryByText(/完成一条助手回复后/)).not.toBeInTheDocument()
    expect(screen.getByText("文件")).toBeInTheDocument()
    expect(screen.getByText("浏览器")).toBeInTheDocument()
    expect(screen.queryByText("消息树")).not.toBeInTheDocument()
    expect(screen.getByText("代码审查")).toBeInTheDocument()
    expect(screen.getByText("终端")).toBeInTheDocument()
  })

  it("renders dynamic tabs and exposes the plus launcher entry", () => {
    const onActivateTab = vi.fn()
    const onCloseTab = vi.fn()
    renderRightSidebar({
      rightSidebar: {
        activeTabID: "browser-tab",
        tabs: [createFilesTab(), createBrowserTab()],
      },
      onActivateTab,
      onCloseTab,
    })

    fireEvent.click(screen.getByRole("tab", { name: /Files/ }))
    expect(onActivateTab).toHaveBeenCalledWith("files-tab")

    fireEvent.click(screen.getByRole("button", { name: "Close Browser" }))
    expect(onCloseTab).toHaveBeenCalledWith("browser-tab")

    fireEvent.click(screen.getByRole("button", { name: "Open right sidebar launcher" }))
    expect(screen.getByRole("button", { name: /^Review/ })).toBeInTheDocument()
  })

  it("keeps the default Branch Chat surface minimal and chooses a start from Advanced options", async () => {
    const previousDesktop = window.desktop
    const onLocateBranchAnchor = vi.fn()
    const onUpdateTab = vi.fn()
    window.desktop = {
      ...previousDesktop,
      agentSession: {
        loadHistory: vi.fn().mockResolvedValue([
          {
            info: {
              id: "user-root",
              sessionID: "session-1",
              role: "user",
              created: 1,
              parentMessageID: null,
            },
            parts: [{ id: "part-user-root", type: "text", text: "Root prompt" }],
          },
          {
            info: {
              id: "assistant-anchor",
              sessionID: "session-1",
              role: "assistant",
              created: 2,
              completed: 2,
              parentMessageID: "user-root",
              finishReason: "stop",
            },
            parts: [{ id: "part-assistant-anchor", type: "text", text: "Shared answer" }],
          },
        ]),
        sendTurn: vi.fn(),
        resumeTurn: vi.fn(),
        cancelTurn: vi.fn(),
        interrupt: vi.fn(),
        answerQuestion: vi.fn(),
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        loadPermissionRequests: vi.fn().mockResolvedValue([]),
        respondPermissionRequest: vi.fn(),
        onEvent: vi.fn(() => () => undefined),
      },
    } as typeof window.desktop

    try {
      renderRightSidebar({
        messageTreeBySession: {
          "session-1": createBranchChatTree(),
        },
        rightSidebar: {
          activeTabID: "branch-chat-tab",
          tabs: [createBranchChatTab()],
        },
        threadPaneContext: {
          paneID: "pane-1",
          sessionID: "session-1",
        },
        onLocateBranchAnchor,
        onUpdateTab,
      })

      const branchChat = await screen.findByRole("region", { name: "Branch Chat" })
      expect(branchChat.firstElementChild).toHaveAttribute("aria-label", "Branch Chat tools")
      expect(screen.queryByRole("heading", { name: "Branch Chat" })).not.toBeInTheDocument()
      expect(screen.getByText("Tool read-only")).toBeInTheDocument()
      expect(screen.queryByRole("dialog", { name: "Branch starting point" })).not.toBeInTheDocument()
      expect(screen.queryByRole("listbox", { name: "Choose where this branch starts" })).not.toBeInTheDocument()

      const advancedButton = screen.getByRole("button", { name: "Advanced Branch Chat options" })
      const defaultTriggerClass = advancedButton.className
      fireEvent.click(advancedButton)

      const dialog = await screen.findByRole("dialog", { name: "Branch starting point" })
      expect(dialog).toHaveTextContent("From which response should this branch start?")
      const listbox = screen.getByRole("listbox", { name: "Choose where this branch starts" })
      const options = [...listbox.querySelectorAll<HTMLElement>('[role="option"]')]
      expect(options).toHaveLength(2)
      expect(options[0]).toHaveTextContent("Shared answer")
      expect(options[1]).toHaveTextContent("Main result")
      expect(options[0]).toHaveAttribute("aria-selected", "true")

      fireEvent.click(options[1]!)
      expect(onUpdateTab).toHaveBeenCalledWith("branch-chat-tab", {
        anchorStrategy: "selected",
        headMessageID: "assistant-main",
        originMessageID: "assistant-main",
      })
      expect(onLocateBranchAnchor).toHaveBeenCalledWith({
        messageID: "assistant-main",
        paneID: "pane-1",
        sessionID: "session-1",
      })
      expect(screen.getByRole("dialog", { name: "Branch starting point" })).toBeInTheDocument()
      expect(advancedButton.className).not.toBe(defaultTriggerClass)
      expect(branchChat.firstElementChild).not.toHaveTextContent("Main result")
      expect(screen.getByText("Ask about this branch…")).toBeInTheDocument()
      const contextButton = within(branchChat).getByRole("button", { name: /^Context pressure/ })
      expect(contextButton.closest(".composer")).not.toBeNull()
      expect(within(branchChat).queryByLabelText("Composer utility bar")).not.toBeInTheDocument()

      const editor = screen.getByRole("textbox", { name: "Task draft" })
      fireEvent.pointerDown(editor)
      editor.focus()
      expect(screen.queryByRole("dialog", { name: "Branch starting point" })).not.toBeInTheDocument()
      expect(editor).toHaveFocus()
    } finally {
      window.desktop = previousDesktop
    }
  })

  it("folds answered AskUserQuestion cards with processing in Branch Chat", async () => {
    const previousDesktop = window.desktop
    const tab = {
      ...createBranchChatTab(),
      headMessageID: "assistant-question",
      phase: "committed" as const,
    }
    window.desktop = {
      ...previousDesktop,
      agentSession: {
        loadHistory: vi.fn().mockResolvedValue([
          {
            info: {
              id: "user-root",
              sessionID: "session-1",
              role: "user",
              created: 1,
              parentMessageID: null,
            },
            parts: [{ id: "part-user-root", type: "text", text: "Root prompt" }],
          },
          {
            info: {
              id: "assistant-anchor",
              sessionID: "session-1",
              role: "assistant",
              created: 2,
              completed: 2,
              parentMessageID: "user-root",
              finishReason: "stop",
            },
            parts: [{ id: "part-assistant-anchor", type: "text", text: "Shared answer" }],
          },
          {
            info: {
              id: "user-question",
              sessionID: "session-1",
              role: "user",
              created: 3,
              parentMessageID: "assistant-anchor",
            },
            parts: [{ id: "part-user-question", type: "text", text: "Choose a target" }],
          },
          {
            info: {
              id: "assistant-question",
              sessionID: "session-1",
              role: "assistant",
              created: 4,
              completed: 4,
              parentMessageID: "user-question",
              finishReason: "stop",
            },
            parts: [{
              id: "tool-question",
              type: "tool",
              tool: "AskUserQuestion",
              state: {
                status: "completed",
                metadata: {
                  kind: "ask-user-question",
                  questionID: "que_branch_target",
                  header: "Branch target",
                  question: "Where should this branch deploy?",
                  options: [
                    { label: "Vercel", value: "vercel", description: "Selected branch target" },
                    { label: "Cloudflare", value: "cloudflare" },
                  ],
                  allowFreeform: false,
                  multiple: false,
                  required: true,
                  answered: true,
                  answerText: "vercel",
                  selectedOptions: ["vercel"],
                },
              },
            }],
          },
        ]),
        sendTurn: vi.fn(),
        resumeTurn: vi.fn(),
        cancelTurn: vi.fn(),
        interrupt: vi.fn(),
        answerQuestion: vi.fn(),
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        loadPermissionRequests: vi.fn().mockResolvedValue([]),
        respondPermissionRequest: vi.fn(),
        onEvent: vi.fn(() => () => undefined),
      },
    } as typeof window.desktop

    try {
      renderRightSidebar({
        messageTreeBySession: {
          "session-1": createBranchChatTree(),
        },
        rightSidebar: {
          activeTabID: tab.id,
          tabs: [tab],
        },
      })

      const branchChat = await screen.findByRole("region", { name: "Branch Chat" })
      const processSummary = await waitFor(() => {
        const element = branchChat.querySelector(".assistant-execution-summary-button") as HTMLButtonElement | null
        expect(element).not.toBeNull()
        return element!
      })
      expect(processSummary).toHaveAttribute("aria-expanded", "false")
      expect(within(branchChat).queryByText("Where should this branch deploy?")).not.toBeInTheDocument()

      fireEvent.click(processSummary)
      expect(processSummary).toHaveAttribute("aria-expanded", "true")
      const question = await within(branchChat).findByText("Where should this branch deploy?")
      const card = question.closest(".ask-user-question-card") as HTMLElement
      expect(card).toHaveAttribute("data-question-state", "answered")
      expect(card.querySelector(".ask-user-question-header")).toBeNull()
      expect(card.querySelectorAll(".ask-user-question-summary-label")).toHaveLength(2)
      expect(within(card).getByText("Question:")).toBeInTheDocument()
      expect(within(card).getByText("Answer:")).toBeInTheDocument()
      expect(within(card).queryByText("Answered")).not.toBeInTheDocument()
      expect(within(card).getByText("Vercel")).toBeInTheDocument()
      expect(within(card).getByText("Selected branch target")).toBeInTheDocument()
      expect(within(card).queryByText("Cloudflare")).not.toBeInTheDocument()
      expect(within(card).queryByRole("button")).not.toBeInTheDocument()
      expect(within(card).queryByRole("textbox")).not.toBeInTheDocument()
    } finally {
      window.desktop = previousDesktop
    }
  })

  it("supports keyboard selection, Escape, outside close, and focus return in Advanced options", async () => {
    const onUpdateTab = vi.fn()
    renderRightSidebar({
      messageTreeBySession: {
        "session-1": createBranchChatTree(),
      },
      rightSidebar: {
        activeTabID: "branch-chat-tab",
        tabs: [createBranchChatTab()],
      },
      onUpdateTab,
    })

    const advancedButton = screen.getByRole("button", { name: "Advanced Branch Chat options" })
    advancedButton.focus()
    fireEvent.keyDown(advancedButton, { key: "ArrowDown" })
    const listbox = await screen.findByRole("listbox", { name: "Choose where this branch starts" })
    expect(listbox).toHaveFocus()
    fireEvent.keyDown(listbox, { key: "End" })
    fireEvent.keyDown(listbox, { key: "Enter" })
    expect(onUpdateTab).toHaveBeenCalledWith("branch-chat-tab", {
      anchorStrategy: "selected",
      headMessageID: "assistant-main",
      originMessageID: "assistant-main",
    })
    expect(screen.getByRole("dialog", { name: "Branch starting point" })).toBeInTheDocument()
    expect(listbox).toHaveFocus()

    fireEvent.keyDown(listbox, { key: "Escape" })
    expect(screen.queryByRole("dialog", { name: "Branch starting point" })).not.toBeInTheDocument()
    expect(advancedButton).toHaveFocus()

    fireEvent.click(advancedButton)
    await screen.findByRole("dialog", { name: "Branch starting point" })
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole("dialog", { name: "Branch starting point" })).not.toBeInTheDocument()
  })

  it("supports keyboard access and keeps recent and advanced Branch Chat popovers exclusive", async () => {
    renderRightSidebar({
      messageTreeBySession: {
        "session-1": createBranchChatTree(),
      },
      rightSidebar: {
        activeTabID: "branch-chat-tab",
        tabs: [createBranchChatTab()],
      },
    })

    const recentTrigger = screen.getByRole("button", { name: "Open recent branches" })
    const advancedButton = screen.getByRole("button", { name: "Advanced Branch Chat options" })
    recentTrigger.focus()
    fireEvent.keyDown(recentTrigger, { key: "ArrowDown" })

    const recentListbox = await screen.findByRole("listbox", { name: "Recent branches" })
    expect(recentListbox).toHaveFocus()

    fireEvent.click(advancedButton)
    expect(screen.queryByRole("listbox", { name: "Recent branches" })).not.toBeInTheDocument()
    expect(await screen.findByRole("dialog", { name: "Branch starting point" })).toBeInTheDocument()

    fireEvent.click(recentTrigger)
    expect(screen.queryByRole("dialog", { name: "Branch starting point" })).not.toBeInTheDocument()
    const reopenedRecentListbox = await screen.findByRole("listbox", { name: "Recent branches" })
    fireEvent.keyDown(reopenedRecentListbox, { key: "Escape" })
    expect(screen.queryByRole("listbox", { name: "Recent branches" })).not.toBeInTheDocument()
    expect(recentTrigger).toHaveFocus()
  })

  it("shows the committed starting point as read-only and locates it in the main thread", async () => {
    const onLocateBranchAnchor = vi.fn()
    const tab = {
      ...createBranchChatTab(),
      headMessageID: "assistant-branch",
      phase: "committed" as const,
    }

    renderRightSidebar({
      messageTreeBySession: {
        "session-1": createBranchChatTree(),
      },
      rightSidebar: {
        activeTabID: tab.id,
        tabs: [tab],
      },
      threadPaneContext: {
        paneID: "pane-1",
        sessionID: "session-1",
      },
      onLocateBranchAnchor,
    })

    fireEvent.click(screen.getByRole("button", { name: "Advanced Branch Chat options" }))
    const dialog = await screen.findByRole("dialog", { name: "Branch starting point" })
    expect(dialog).toHaveTextContent("This starting point is fixed for the current branch.")
    expect(screen.queryByRole("listbox", { name: "Choose where this branch starts" })).not.toBeInTheDocument()
    expect(dialog).toHaveTextContent("Shared answer")
    fireEvent.click(screen.getByRole("button", { name: "Locate in main thread" }))
    expect(onLocateBranchAnchor).toHaveBeenCalledWith({
      messageID: "assistant-anchor",
      paneID: "pane-1",
      sessionID: "session-1",
    })
    expect(screen.getByRole("dialog", { name: "Branch starting point" })).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole("dialog", { name: "Branch starting point" })).not.toBeInTheDocument()
  })

  it("resolves the newest completed response when the first draft is sent", async () => {
    const previousDesktop = window.desktop
    const sendTurn = vi.fn().mockResolvedValue(undefined)
    const onUpdateTab = vi.fn()
    window.desktop = {
      ...previousDesktop,
      agentSession: {
        loadHistory: vi.fn().mockResolvedValue([
          {
            info: {
              id: "user-root",
              sessionID: "session-1",
              role: "user",
              created: 1,
              parentMessageID: null,
            },
            parts: [{ id: "part-user-root", type: "text", text: "Root prompt" }],
          },
          {
            info: {
              id: "assistant-anchor",
              sessionID: "session-1",
              role: "assistant",
              created: 2,
              completed: 2,
              parentMessageID: "user-root",
              finishReason: "stop",
            },
            parts: [{ id: "part-assistant-anchor", type: "text", text: "Shared answer" }],
          },
        ]),
        sendTurn,
        resumeTurn: vi.fn(),
        cancelTurn: vi.fn(),
        interrupt: vi.fn(),
        answerQuestion: vi.fn(),
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        loadPermissionRequests: vi.fn().mockResolvedValue([]),
        respondPermissionRequest: vi.fn(),
        onEvent: vi.fn(() => () => undefined),
      },
    } as typeof window.desktop

    const initialTree = {
      ...createBranchChatTree(),
      activeMessageID: "assistant-anchor",
      activePathMessageIDs: ["user-root", "assistant-anchor"],
    }
    const tab = {
      ...createBranchChatTab(),
      anchorStrategy: "latest-at-send" as const,
    }
    const initialInput: RenderRightSidebarInput = {
      messageTreeBySession: {
        "session-1": initialTree,
      },
      rightSidebar: {
        activeTabID: tab.id,
        tabs: [tab],
      },
      onUpdateTab,
    }

    try {
      const { rerender } = renderRightSidebar(initialInput)
      await screen.findByRole("region", { name: "Branch Chat" })

      rerender(createRightSidebarUI({
        ...initialInput,
        messageTreeBySession: {
          "session-1": createBranchChatTree(),
        },
      }))

      const editor = screen.getByRole("textbox", { name: "Task draft" })
      act(() => {
        editor.dispatchEvent(new CustomEvent("desktop-composer-change", {
          bubbles: true,
          detail: { value: "Use the latest response" },
        }))
      })
      fireEvent.click(await screen.findByRole("button", { name: "Send task" }))

      await waitFor(() => {
        expect(sendTurn).toHaveBeenCalledWith(expect.objectContaining({
          text: "Use the latest response",
          threadTarget: {
            kind: "detached-branch",
            parentMessageID: "assistant-main",
          },
        }))
      })
      expect(onUpdateTab).toHaveBeenCalledWith(tab.id, {
        headMessageID: "assistant-main",
        originMessageID: "assistant-main",
      })
      await waitFor(() => {
        expect(onUpdateTab).toHaveBeenCalledWith(tab.id, {
          anchorStrategy: "selected",
        })
      })
    } finally {
      window.desktop = previousDesktop
    }
  })

  it("shows a Branch Chat user message before the send request resolves", async () => {
    const previousDesktop = window.desktop
    let resolveSendTurn: (() => void) | undefined
    const sendTurn = vi.fn((input: { clientTurnID: string }) => new Promise<{
      clientTurnID: string
    }>((resolve) => {
      resolveSendTurn = () => resolve({ clientTurnID: input.clientTurnID })
    }))
    window.desktop = {
      ...previousDesktop,
      agentSession: {
        loadHistory: vi.fn().mockResolvedValue([]),
        sendTurn,
        resumeTurn: vi.fn(),
        cancelTurn: vi.fn(),
        interrupt: vi.fn(),
        answerQuestion: vi.fn(),
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        loadPermissionRequests: vi.fn().mockResolvedValue([]),
        respondPermissionRequest: vi.fn(),
        onEvent: vi.fn(() => () => undefined),
      },
    } as typeof window.desktop

    try {
      renderRightSidebar({
        messageTreeBySession: {
          "session-1": createBranchChatTree(),
        },
        rightSidebar: {
          activeTabID: "branch-chat-tab",
          tabs: [createBranchChatTab()],
        },
      })

      const editor = screen.getByRole("textbox", { name: "Task draft" })
      act(() => {
        editor.dispatchEvent(new CustomEvent("desktop-composer-change", {
          bubbles: true,
          detail: { value: "Optimistic branch request" },
        }))
      })
      fireEvent.click(screen.getByRole("button", { name: "Send task" }))

      expect(await screen.findByText("Optimistic branch request")).toBeInTheDocument()
      expect(
        screen.getByRole("status", { name: "Sending message" }),
      ).toBeInTheDocument()
      expect(sendTurn).toHaveBeenCalledTimes(1)

      await act(async () => {
        resolveSendTurn?.()
      })
    } finally {
      window.desktop = previousDesktop
    }
  })

  it("confirms a Branch Chat user row from message.recorded without duplicating it", async () => {
    const previousDesktop = window.desktop
    let eventListener: ((event: AgentSessionBridgeEvent) => void) | null = null
    const loadHistory = vi.fn().mockResolvedValue([])
    const sendTurn = vi.fn().mockResolvedValue(undefined)
    const onUpdateTab = vi.fn()
    window.desktop = {
      ...previousDesktop,
      agentSession: {
        loadHistory,
        sendTurn,
        resumeTurn: vi.fn(),
        cancelTurn: vi.fn(),
        interrupt: vi.fn(),
        answerQuestion: vi.fn(),
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        loadPermissionRequests: vi.fn().mockResolvedValue([]),
        respondPermissionRequest: vi.fn(),
        onEvent: vi.fn((listener: (event: AgentSessionBridgeEvent) => void) => {
          eventListener = listener
          return () => undefined
        }),
      },
    } as typeof window.desktop

    try {
      const view = renderRightSidebar({
        messageTreeBySession: {
          "session-1": createBranchChatTree(),
        },
        rightSidebar: {
          activeTabID: "branch-chat-tab",
          tabs: [createBranchChatTab()],
        },
        onUpdateTab,
      })

      const editor = screen.getByRole("textbox", { name: "Task draft" })
      act(() => {
        editor.dispatchEvent(new CustomEvent("desktop-composer-change", {
          bubbles: true,
          detail: { value: "Record this branch request" },
        }))
      })
      fireEvent.click(screen.getByRole("button", { name: "Send task" }))
      await waitFor(() => expect(sendTurn).toHaveBeenCalledTimes(1))

      const request = sendTurn.mock.calls[0]?.[0]
      if (!request) throw new Error("Expected a Branch Chat turn request")
      view.rerender(createRightSidebarUI({
        messageTreeBySession: {
          "session-1": createBranchChatTree(),
        },
        rightSidebar: {
          activeTabID: "branch-chat-tab",
          tabs: [{
            ...createBranchChatTab(),
            executionID: request.executionID ?? request.clientTurnID,
          }],
        },
        onUpdateTab,
      }))

      act(() => {
        eventListener?.({
          kind: "stream",
          source: "request",
          backendSessionID: "session-1",
          clientTurnID: request.clientTurnID,
          event: "execution.mode",
          data: {
            executionID: request.executionID,
            headMessageID: "assistant-anchor",
            targetKind: "detached-branch",
            turnID: "turn-branch-recorded",
          },
          receivedAt: 3,
        })
        eventListener?.({
          kind: "stream",
          source: "request",
          backendSessionID: "session-1",
          clientTurnID: request.clientTurnID,
          event: "runtime",
          data: {
            eventID: "event-user-recorded",
            executionID: request.executionID,
            payload: {
              message: {
                id: "message-user-backend",
                role: "user",
              },
            },
            targetKind: "detached-branch",
            turnID: "turn-branch-recorded",
            type: "message.recorded",
          },
          receivedAt: 4,
        })
      })

      expect(onUpdateTab).toHaveBeenCalledWith("branch-chat-tab", {
        anchorStrategy: "selected",
        headMessageID: "assistant-anchor",
        phase: "committed",
      })
      await waitFor(() => {
        expect(
          screen.queryByRole("status", { name: "Sending message" }),
        ).not.toBeInTheDocument()
      })
      expect(screen.getAllByText("Record this branch request")).toHaveLength(1)
      expect(
        screen.queryByRole("button", { name: "Retry sending message" }),
      ).not.toBeInTheDocument()
      expect(loadHistory).toHaveBeenCalled()
    } finally {
      window.desktop = previousDesktop
    }
  })

  it("keeps a failed Branch Chat message in place and retries its exact request", async () => {
    const previousDesktop = window.desktop
    const sendTurn = vi.fn()
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValueOnce(undefined)
    const onUpdateTab = vi.fn()
    window.desktop = {
      ...previousDesktop,
      agentSession: {
        loadHistory: vi.fn().mockResolvedValue([]),
        sendTurn,
        resumeTurn: vi.fn(),
        cancelTurn: vi.fn(),
        interrupt: vi.fn(),
        answerQuestion: vi.fn(),
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        loadPermissionRequests: vi.fn().mockResolvedValue([]),
        respondPermissionRequest: vi.fn(),
        onEvent: vi.fn(() => () => undefined),
      },
    } as typeof window.desktop
    const tab = {
      ...createBranchChatTab(),
      anchorStrategy: "latest-at-send" as const,
    }

    try {
      renderRightSidebar({
        messageTreeBySession: {
          "session-1": createBranchChatTree(),
        },
        rightSidebar: {
          activeTabID: tab.id,
          tabs: [tab],
        },
        onUpdateTab,
      })

      const editor = screen.getByRole("textbox", { name: "Task draft" })
      act(() => {
        editor.dispatchEvent(new CustomEvent("desktop-composer-change", {
          bubbles: true,
          detail: { value: "Retry this unchanged" },
        }))
      })
      fireEvent.click(screen.getByRole("button", { name: "Send task" }))

      expect(await screen.findByText("Retry this unchanged")).toBeInTheDocument()
      expect(
        screen.getByRole("group", {
          name: "Message failed to send: Network unavailable",
        }),
      ).toBeInTheDocument()
      expect(editor.textContent ?? "").toBe("")
      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
      expect(onUpdateTab).not.toHaveBeenCalledWith(tab.id, {
        anchorStrategy: "selected",
      })

      fireEvent.click(
        screen.getByRole("button", { name: "Retry sending message" }),
      )
      await waitFor(() => expect(sendTurn).toHaveBeenCalledTimes(2))

      const firstRequest = sendTurn.mock.calls[0]?.[0]
      const retryRequest = sendTurn.mock.calls[1]?.[0]
      if (!firstRequest || !retryRequest) {
        throw new Error("Expected initial and retry Branch Chat requests")
      }
      const {
        clientTurnID: firstClientTurnID,
        executionID: firstExecutionID,
        ...firstSnapshot
      } = firstRequest
      const {
        clientTurnID: retryClientTurnID,
        executionID: retryExecutionID,
        ...retrySnapshot
      } = retryRequest
      expect(retryClientTurnID).not.toBe(firstClientTurnID)
      expect(retryExecutionID).not.toBe(firstExecutionID)
      expect(retrySnapshot).toEqual(firstSnapshot)
      expect(screen.getAllByText("Retry this unchanged")).toHaveLength(1)
      expect(
        screen.getByRole("status", { name: "Sending message" }),
      ).toBeInTheDocument()
    } finally {
      window.desktop = previousDesktop
    }
  })

  it("submits quote-only Branch Chat input against the detached branch head", async () => {
    const previousDesktop = window.desktop
    const sendTurn = vi.fn().mockResolvedValue(undefined)
    window.desktop = {
      ...previousDesktop,
      agentSession: {
        loadHistory: vi.fn().mockResolvedValue([
          {
            info: {
              id: "user-root",
              sessionID: "session-1",
              role: "user",
              created: 1,
              parentMessageID: null,
            },
            parts: [{ id: "part-user-root", type: "text", text: "Root prompt" }],
          },
          {
            info: {
              id: "assistant-anchor",
              sessionID: "session-1",
              role: "assistant",
              created: 2,
              completed: 2,
              parentMessageID: "user-root",
              finishReason: "stop",
            },
            parts: [{ id: "part-assistant-anchor", type: "text", text: "Shared answer" }],
          },
        ]),
        sendTurn,
        resumeTurn: vi.fn(),
        cancelTurn: vi.fn(),
        interrupt: vi.fn(),
        answerQuestion: vi.fn(),
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        loadPermissionRequests: vi.fn().mockResolvedValue([]),
        respondPermissionRequest: vi.fn(),
        onEvent: vi.fn(() => () => undefined),
      },
    } as typeof window.desktop

    const tab = {
      ...createBranchChatTab(),
      initialQuotes: [{
        sourceMessageID: "assistant-anchor",
        text: "The selected response text",
      }],
    }

    try {
      renderRightSidebar({
        messageTreeBySession: {
          "session-1": createBranchChatTree(),
        },
        rightSidebar: {
          activeTabID: tab.id,
          tabs: [tab],
        },
      })

      fireEvent.click(await screen.findByRole("button", { name: "Send task" }))

      await waitFor(() => {
        expect(sendTurn).toHaveBeenCalledWith(expect.objectContaining({
          backendSessionID: "session-1",
          clientTurnID: expect.any(String),
          executionID: expect.any(String),
          quotes: [{
            sourceMessageID: "assistant-anchor",
            text: "The selected response text",
          }],
          text: undefined,
          threadTarget: {
            kind: "detached-branch",
            parentMessageID: "assistant-anchor",
          },
        }))
      })
    } finally {
      window.desktop = previousDesktop
    }
  })

  it("commits a draft Branch Chat as soon as its detached execution is accepted", async () => {
    const previousDesktop = window.desktop
    const onUpdateTab = vi.fn()
    let eventListener: ((event: AgentSessionBridgeEvent) => void) | null = null
    window.desktop = {
      ...previousDesktop,
      agentSession: {
        loadHistory: vi.fn().mockResolvedValue([
          {
            info: {
              id: "user-root",
              sessionID: "session-1",
              role: "user",
              created: 1,
              parentMessageID: null,
            },
            parts: [{ id: "part-user-root", type: "text", text: "Root prompt" }],
          },
          {
            info: {
              id: "assistant-anchor",
              sessionID: "session-1",
              role: "assistant",
              created: 2,
              completed: 2,
              parentMessageID: "user-root",
              finishReason: "stop",
            },
            parts: [{ id: "part-assistant-anchor", type: "text", text: "Shared answer" }],
          },
        ]),
        sendTurn: vi.fn(),
        resumeTurn: vi.fn(),
        cancelTurn: vi.fn(),
        interrupt: vi.fn(),
        answerQuestion: vi.fn(),
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        loadPermissionRequests: vi.fn().mockResolvedValue([]),
        respondPermissionRequest: vi.fn(),
        onEvent: vi.fn((listener: (event: AgentSessionBridgeEvent) => void) => {
          eventListener = listener
          return () => undefined
        }),
      },
    } as typeof window.desktop

    try {
      renderRightSidebar({
        messageTreeBySession: {
          "session-1": createBranchChatTree(),
        },
        rightSidebar: {
          activeTabID: "branch-chat-tab",
          tabs: [createBranchChatTab()],
        },
        onUpdateTab,
      })

      expect(await screen.findByRole("region", { name: "Branch Chat" })).toBeInTheDocument()

      act(() => {
        eventListener?.({
          kind: "stream",
          source: "request",
          backendSessionID: "session-1",
          clientTurnID: "client-turn-1",
          event: "execution.mode",
          data: {
            sessionID: "session-1",
            turnID: "turn-accepted",
            executionID: "branch-chat-tab",
            targetKind: "detached-branch",
            headMessageID: "assistant-anchor",
            mode: "queued",
          },
          receivedAt: 3,
        })
      })

      expect(onUpdateTab).toHaveBeenCalledWith("branch-chat-tab", {
        anchorStrategy: "selected",
        headMessageID: "assistant-anchor",
        phase: "committed",
      })
    } finally {
      window.desktop = previousDesktop
    }
  })

  it("renders a message inspector tab with the paired user prompt and assistant response", () => {
    renderRightSidebar({
      messageTreeBySession: {
        "session-1": createMessageTree(),
      },
      rightSidebar: {
        activeTabID: "message-inspector-tab",
        tabs: [createMessageInspectorTab()],
      },
    })

    expect(screen.getByRole("tab", { name: /Conversation/ })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("heading", { name: "Alternative answer" })).toBeInTheDocument()
    expect(screen.getByText("Root prompt")).toBeInTheDocument()
    expect(screen.getByText("This is the second complete response content.")).toBeInTheDocument()
    expect(document.querySelector(".right-sidebar-view-host")).toHaveClass("is-message-inspector")
  })
})
