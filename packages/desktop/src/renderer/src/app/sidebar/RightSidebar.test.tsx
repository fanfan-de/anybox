import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import {
  DEFAULT_ASSISTANT_TRACE_VISIBILITY,
  type RightSidebarState,
  type RightSidebarTab,
  type WorkspaceGroup,
} from "../types"
import { DEFAULT_WORKSPACE_FILE_REVIEW_STATE, DEFAULT_WORKSPACE_PREVIEW_STATE } from "../agent-workspace/review-preview-state"
import { I18nProvider } from "../i18n/I18nProvider"
import type { SessionMessageTree } from "../session-message-tree"
import { ToastProvider } from "../toast"
import { RightSidebar } from "./RightSidebar"
import { SessionMessageTreePanel } from "./SessionMessageTreePanel"

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

function createMessageTreeTab(): RightSidebarTab {
  return {
    id: "message-tree-tab",
    kind: "message-tree",
    title: "Tree",
    targetKey: "message-tree:session-1",
    createdAt: 3,
    sessionID: "session-1",
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

function createNestedResponseMessageTree(input?: {
  activeMessageID?: string
  activePathMessageIDs?: string[]
}): SessionMessageTree {
  return {
    activeMessageID: input?.activeMessageID ?? "assistant-parent",
    activePathMessageIDs: input?.activePathMessageIDs ?? ["user-1", "assistant-parent"],
    branchOptionsByParentID: {
      "assistant-parent": [
        {
          childMessageID: "user-child-1",
          index: 0,
          isActive: false,
          label: "Branch 1",
          leafMessageID: "assistant-child-1",
          parentMessageID: "assistant-parent",
          preview: "First follow up",
          total: 3,
        },
        {
          childMessageID: "user-child-2",
          index: 1,
          isActive: input?.activeMessageID === "assistant-child-2",
          label: "Branch 2",
          leafMessageID: "assistant-child-2",
          parentMessageID: "assistant-parent",
          preview: "Second follow up",
          total: 3,
        },
        {
          childMessageID: "user-child-3",
          index: 2,
          isActive: false,
          label: "Branch 3",
          leafMessageID: "assistant-child-3",
          parentMessageID: "assistant-parent",
          preview: "Third follow up",
          total: 3,
        },
      ],
    },
    childIDsByParentID: {
      "__root__": ["user-1"],
      "user-1": ["assistant-parent"],
      "assistant-parent": ["user-child-1", "user-child-2", "user-child-3"],
      "user-child-1": ["assistant-child-1"],
      "user-child-2": ["assistant-child-2"],
      "user-child-3": ["assistant-child-3"],
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
      "assistant-parent": {
        content: "Parent response\n\nA complete parent response with child branches.",
        id: "assistant-parent",
        sessionID: "session-1",
        role: "assistant",
        created: 2,
        parentMessageID: "user-1",
        preview: "Parent response",
      },
      "user-child-1": {
        content: "First follow up",
        id: "user-child-1",
        sessionID: "session-1",
        role: "user",
        created: 3,
        parentMessageID: "assistant-parent",
        preview: "First follow up",
      },
      "assistant-child-1": {
        content: "First child response\n\nExpanded child response one.",
        id: "assistant-child-1",
        sessionID: "session-1",
        role: "assistant",
        created: 4,
        parentMessageID: "user-child-1",
        preview: "First child response",
      },
      "user-child-2": {
        content: "Second follow up",
        id: "user-child-2",
        sessionID: "session-1",
        role: "user",
        created: 5,
        parentMessageID: "assistant-parent",
        preview: "Second follow up",
      },
      "assistant-child-2": {
        content: "Second child response\n\nExpanded child response two.",
        id: "assistant-child-2",
        sessionID: "session-1",
        role: "assistant",
        created: 6,
        parentMessageID: "user-child-2",
        preview: "Second child response",
      },
      "user-child-3": {
        content: "Third follow up",
        id: "user-child-3",
        sessionID: "session-1",
        role: "user",
        created: 7,
        parentMessageID: "assistant-parent",
        preview: "Third follow up",
      },
      "assistant-child-3": {
        content: "Third child response\n\nExpanded child response three.",
        id: "assistant-child-3",
        sessionID: "session-1",
        role: "assistant",
        created: 8,
        parentMessageID: "user-child-3",
        preview: "Third child response",
      },
    },
    rootMessageIDs: ["user-1"],
    sessionID: "session-1",
  }
}

function mockMessageTreeCanvasSize(width: number, height: number) {
  const widthSpy = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("session-message-tree-canvas") ? width : 0
  })
  const heightSpy = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("session-message-tree-canvas") ? height : 0
  })

  return () => {
    widthSpy.mockRestore()
    heightSpy.mockRestore()
  }
}

function queryMessageTreeNode(messageID: string) {
  return document.querySelector<HTMLElement>(`[data-message-tree-node-id="${messageID}"]`)
}

function readMessageTreeGraphTransform() {
  const graph = document.querySelector<HTMLDivElement>(".session-message-tree-graph")
  const transform = graph?.style.transform ?? ""
  const match = transform.match(/^matrix\(([^,]+),\s*[^,]+,\s*[^,]+,\s*([^,]+),\s*([^,]+),\s*([^)]+)\)$/)
  if (!match) {
    throw new Error(`Unable to parse message tree graph transform: ${transform}`)
  }

  return {
    scaleX: Number.parseFloat(match[1] ?? "1"),
    scaleY: Number.parseFloat(match[2] ?? "1"),
    x: Number.parseFloat(match[3] ?? "0"),
    y: Number.parseFloat(match[4] ?? "0"),
  }
}

function readMessageTreeNodeScreenAnchor(node: Element) {
  const graphNode = node as HTMLElement
  const transform = readMessageTreeGraphTransform()
  return {
    x: transform.x + Number.parseFloat(graphNode.style.left) * transform.scaleX,
    y: transform.y + Number.parseFloat(graphNode.style.top) * transform.scaleY,
  }
}

function renderRightSidebar(input: {
  activeSession?: WorkspaceGroup["sessions"][number] | null
  canOpenReview?: boolean
  canOpenTerminal?: boolean
  messageTreeBySession?: Record<string, SessionMessageTree>
  rightSidebar: RightSidebarState
  workspaces?: WorkspaceGroup[]
  onActivateTab?: (tabID: string) => void
  onCloseTab?: (tabID: string) => void
  onOpenBrowserTab?: () => void
  onOpenFilesTab?: () => void
  onOpenMessageTreeTab?: () => void
  onOpenReviewTab?: () => void
  onOpenTerminalTab?: () => void
  onMessageTreeNodeSelect?: (sessionID: string, messageID: string) => void
  withI18n?: boolean
}) {
  const ui = (
    <ToastProvider>
      <RightSidebar
        activeSession={input.activeSession === undefined ? workspace.sessions[0] ?? null : input.activeSession}
        activeSessionDirectory={workspace.directory}
        activeWorkspaceFileScopeDirectory={workspace.directory}
        activeWorkspaceFileScopeName={workspace.name}
        assistantTraceVisibility={DEFAULT_ASSISTANT_TRACE_VISIBILITY}
        canInsertWorkspaceFileCommentsIntoDraft={true}
        canOpenReview={input.canOpenReview ?? true}
        canOpenTerminal={input.canOpenTerminal ?? true}
        codeTheme="github-light"
        composerRefreshVersion={0}
        isAgentDebugTraceEnabled={false}
        isResolvingPermissionRequest={false}
        permissionRequestActionError={null}
        permissionRequestActionRequestID={null}
        rightSidebar={input.rightSidebar}
        selectedDiffFileBySession={{}}
        sessionDiffBySession={{}}
        sessionDiffStateBySession={{}}
        messageTreeBySession={input.messageTreeBySession ?? {}}
        sideChatPanelState={null}
        workspaces={input.workspaces ?? [workspace]}
        onActivateTab={input.onActivateTab ?? vi.fn()}
        onCloseTab={input.onCloseTab ?? vi.fn()}
        onAskUserQuestionAnswer={vi.fn()}
        onArtifactLinkOpen={vi.fn()}
        onDiffFileRestore={vi.fn()}
        onDiffFileSelect={vi.fn()}
        onLocalFileLinkOpen={vi.fn()}
        onOpenBrowserTab={input.onOpenBrowserTab ?? vi.fn()}
        onOpenFilesTab={input.onOpenFilesTab ?? vi.fn()}
        onOpenMessageTreeTab={input.onOpenMessageTreeTab ?? vi.fn()}
        onOpenReviewTab={input.onOpenReviewTab ?? vi.fn()}
        onOpenTerminalTab={input.onOpenTerminalTab ?? vi.fn()}
        onMessageTreeNodeSelect={input.onMessageTreeNodeSelect ?? vi.fn()}
        onPreviewActiveInteractionChange={vi.fn()}
        onPreviewBack={vi.fn()}
        onPreviewCommitInteraction={vi.fn()}
        onPreviewDraftUrlChange={vi.fn()}
        onPreviewForward={vi.fn()}
        onPreviewOpen={vi.fn()}
        onPreviewOpenExternal={vi.fn()}
        onPreviewOpenUrl={vi.fn()}
        onPreviewReload={vi.fn()}
        onPermissionRequestResponse={vi.fn()}
        onSideChatCreate={vi.fn()}
        onSideChatDelete={vi.fn()}
        onSideChatDraftStateChange={vi.fn()}
        onSideChatPickAttachments={vi.fn()}
        onSideChatRemoveAttachment={vi.fn()}
        onSideChatSelect={vi.fn()}
        onSideChatSend={vi.fn()}
        onSessionModelSelectionChange={vi.fn()}
        onWorkspaceFileCommentCancel={vi.fn()}
        onWorkspaceFileCommentChange={vi.fn()}
        onWorkspaceFileCommentConfirm={vi.fn()}
        onWorkspaceFileCommentStart={vi.fn()}
        onWorkspaceDirectoryLoad={vi.fn()}
        onWorkspaceDirectoryToggle={vi.fn()}
        onWorkspaceFileTreeInvalidate={vi.fn()}
        onWorkspaceFileQueryChange={vi.fn()}
        onWorkspaceFileSelect={vi.fn()}
        renderTerminalTab={() => <div role="region" aria-label="Terminal tab" />}
      />
    </ToastProvider>
  )

  return render(input.withI18n ? <I18nProvider>{ui}</I18nProvider> : ui)
}

describe("RightSidebar", () => {
  it("shows the launcher when there are no right sidebar tabs", () => {
    const onOpenFilesTab = vi.fn()
    const onOpenMessageTreeTab = vi.fn()
    const onOpenTerminalTab = vi.fn()

    renderRightSidebar({
      canOpenTerminal: false,
      rightSidebar: {
        activeTabID: null,
        tabs: [],
      },
      onOpenFilesTab,
      onOpenMessageTreeTab,
      onOpenTerminalTab,
    })

    fireEvent.click(screen.getByRole("button", { name: /^Files/ }))
    expect(onOpenFilesTab).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole("button", { name: /^Tree/ }))
    expect(onOpenMessageTreeTab).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: /^Terminal/ })).toBeDisabled()
    expect(onOpenTerminalTab).not.toHaveBeenCalled()
  })

  it("localizes launcher cards in Chinese", () => {
    window.localStorage.removeItem("desktop.locale")

    renderRightSidebar({
      withI18n: true,
      rightSidebar: {
        activeTabID: null,
        tabs: [],
      },
    })

    expect(screen.getByText("文件")).toBeInTheDocument()
    expect(screen.getByText("浏览器")).toBeInTheDocument()
    expect(screen.getByText("消息树")).toBeInTheDocument()
    expect(screen.getByText("代码审查")).toBeInTheDocument()
    expect(screen.getByText("终端")).toBeInTheDocument()
  })

  it("disables the tree launcher card without an active session", () => {
    const onOpenMessageTreeTab = vi.fn()

    renderRightSidebar({
      activeSession: null,
      rightSidebar: {
        activeTabID: null,
        tabs: [],
      },
      onOpenMessageTreeTab,
    })

    const treeLauncher = screen.getByRole("button", { name: /^Tree/ })
    expect(treeLauncher).toBeDisabled()
    fireEvent.click(treeLauncher)
    expect(onOpenMessageTreeTab).not.toHaveBeenCalled()
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
    expect(screen.getByRole("button", { name: /^Tree/ })).toBeInTheDocument()
  })

  it("renders message tree tabs and selects non-active nodes", () => {
    const onMessageTreeNodeSelect = vi.fn()

    renderRightSidebar({
      messageTreeBySession: {
        "session-1": createMessageTree(),
      },
      rightSidebar: {
        activeTabID: "message-tree-tab",
        tabs: [createMessageTreeTab()],
      },
      onMessageTreeNodeSelect,
    })

    expect(screen.getByText("Session tree")).toBeInTheDocument()
    expect(screen.getByText("4 messages")).toBeInTheDocument()
    expect(screen.getByText("Active answer").closest(".session-message-tree-row")).toHaveClass("is-active")
    expect(screen.getByText("Root prompt").closest(".session-message-tree-row")).toHaveClass("is-active-path")

    fireEvent.click(screen.getByRole("treeitem", { name: /Alternative answer/ }))
    expect(onMessageTreeNodeSelect).toHaveBeenCalledWith("session-1", "assistant-2")
  })

  it("does not expose rollback controls in the message tree", () => {
    renderRightSidebar({
      messageTreeBySession: {
        "session-1": createMessageTree(),
      },
      rightSidebar: {
        activeTabID: "message-tree-tab",
        tabs: [createMessageTreeTab()],
      },
    })

    expect(screen.queryByRole("button", { name: /Rollback from/ })).toBeNull()

    fireEvent.click(screen.getByText("Active answer"))
    expect(screen.queryByRole("button", { name: /Rollback from/ })).toBeNull()
    expect(screen.queryByRole("dialog", { name: "Active answer" })).toBeNull()
  })

  it("does not render side chat controls in message tree nodes", () => {
    const onMessageTreeNodeSelect = vi.fn()
    const sideChatWorkspace: WorkspaceGroup = {
      ...workspace,
      sessions: [
        ...workspace.sessions,
        {
          id: "side-chat-1",
          title: "Side chat 1",
          branch: "main",
          focus: "Side chat",
          summary: "Active answer",
          status: "Ready",
          kind: "side-chat",
          origin: {
            parentSessionID: "session-1",
            anchorMessageID: "assistant-1",
            anchorPreview: "Active answer",
          },
          created: 10,
          updated: 10,
        },
        {
          id: "side-chat-2",
          title: "Side chat 2",
          branch: "main",
          focus: "Side chat",
          summary: "Active answer",
          status: "Ready",
          kind: "side-chat",
          origin: {
            parentSessionID: "session-1",
            anchorMessageID: "assistant-1",
            anchorPreview: "Active answer",
          },
          created: 11,
          updated: 11,
        },
      ],
    }

    renderRightSidebar({
      messageTreeBySession: {
        "session-1": createMessageTree(),
      },
      rightSidebar: {
        activeTabID: "message-tree-tab",
        tabs: [createMessageTreeTab()],
      },
      workspaces: [sideChatWorkspace],
      onMessageTreeNodeSelect,
    })

    const activeNode = queryMessageTreeNode("assistant-1")
    const userNode = queryMessageTreeNode("user-1")
    expect(activeNode).not.toBeNull()
    expect(userNode).not.toBeNull()
    if (!activeNode || !userNode) return

    expect(within(activeNode).queryByRole("button", { name: /Open side chat/ })).toBeNull()
    expect(within(userNode).queryByRole("button", { name: /Open side chat/ })).toBeNull()

    fireEvent.click(activeNode)
    expect(onMessageTreeNodeSelect).not.toHaveBeenCalled()
  })

  it("toggles full expansion from the message tree panel header", () => {
    renderRightSidebar({
      messageTreeBySession: {
        "session-1": createMessageTree(),
      },
      rightSidebar: {
        activeTabID: "message-tree-tab",
        tabs: [createMessageTreeTab()],
      },
    })

    const firstResponseNode = queryMessageTreeNode("assistant-1")
    const secondResponseNode = queryMessageTreeNode("assistant-2")
    expect(firstResponseNode).not.toBeNull()
    expect(secondResponseNode).not.toBeNull()
    if (!firstResponseNode || !secondResponseNode) return

    expect(firstResponseNode).not.toHaveClass("is-expanded-response")
    expect(secondResponseNode).not.toHaveClass("is-expanded-response")

    const expandAllButton = screen.getByRole("button", { name: "Expand all tree nodes" })
    expect(expandAllButton.closest(".session-message-tree-header")).not.toBeNull()
    expect(expandAllButton.closest(".right-sidebar-tab-strip")).toBeNull()

    fireEvent.click(expandAllButton)

    expect(firstResponseNode).toHaveClass("is-expanded-response")
    expect(secondResponseNode).toHaveClass("is-expanded-response")
    expect(screen.getByText(/complete response content shown/)).toBeInTheDocument()
    expect(screen.getByText(/second complete response content/)).toBeInTheDocument()
    expect(screen.getByText("Fully expanded")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Collapse all tree nodes" }))

    expect(firstResponseNode).not.toHaveClass("is-expanded-response")
    expect(secondResponseNode).not.toHaveClass("is-expanded-response")
    expect(screen.queryByText(/complete response content shown/)).not.toBeInTheDocument()
    expect(screen.queryByText(/second complete response content/)).not.toBeInTheDocument()
  })

  it("renders expanded message tree responses as markdown", () => {
    const messageTree = createMessageTree()
    messageTree.nodesByID["assistant-1"]!.content = [
      "## Markdown answer",
      "",
      "- **Strong** item",
      "",
      "| Area | Status |",
      "| --- | --- |",
      "| Tree | Rendered |",
    ].join("\n")
    messageTree.nodesByID["assistant-1"]!.preview = "Markdown answer"

    const { container } = render(
      <SessionMessageTreePanel
        session={workspace.sessions[0] ?? null}
        messageTree={messageTree}
        onSelectMessage={vi.fn()}
      />,
    )

    const activeNode = screen.getByText("Markdown answer").closest(".session-message-tree-graph-node")
    expect(activeNode).not.toBeNull()
    if (!activeNode) return

    fireEvent.doubleClick(activeNode)

    expect(container.querySelector(".session-message-tree-response-card-body.thread-markdown")).not.toBeNull()
    expect(screen.getByRole("heading", { level: 2, name: "Markdown answer" })).toBeInTheDocument()
    expect(screen.getByText("Strong").closest("strong")).not.toBeNull()
    expect(screen.getByRole("table")).toBeInTheDocument()
  })

  it("renders message tree nodes as a directed graph and updates the active path", async () => {
    const restoreCanvasSize = mockMessageTreeCanvasSize(900, 680)
    const session = workspace.sessions[0] ?? null
    const rootActiveTree = createMessageTree({
      activeMessageID: "user-1",
      activePathMessageIDs: ["user-1"],
    })
    const childActiveTree = createMessageTree({
      activeMessageID: "assistant-1",
      activePathMessageIDs: ["user-1", "assistant-1"],
    })
    const onSelectMessage = vi.fn()
    const { rerender } = render(
      <SessionMessageTreePanel
        session={session}
        messageTree={rootActiveTree}
        onSelectMessage={onSelectMessage}
      />,
    )

    expect(screen.getByText("Root prompt").closest(".session-message-tree-graph-node")).toHaveClass("is-active")
    expect(screen.getByText("Active answer").closest(".session-message-tree-graph-node")).not.toHaveClass("is-active-path")
    const graph = document.querySelector(".session-message-tree-graph") as HTMLDivElement | null
    expect(graph).not.toBeNull()
    expect(graph?.style.transform).toBe("matrix(1, 0, 0, 1, 264, 171)")
    expect(document.querySelector(".session-message-tree-edge")).not.toBeNull()

    rerender(
      <SessionMessageTreePanel
        session={session}
        messageTree={childActiveTree}
        onSelectMessage={onSelectMessage}
      />,
    )

    expect(await screen.findByText("Active answer")).toBeInTheDocument()
    expect(screen.getByText("Root prompt").closest(".session-message-tree-graph-node")).toHaveClass("is-active-path")
    expect(screen.getByText("Active answer").closest(".session-message-tree-graph-node")).toHaveClass("is-active")
    restoreCanvasSize()
  })

  it("pans the message tree canvas with right mouse drag and hides role labels", () => {
    render(
      <SessionMessageTreePanel
        session={workspace.sessions[0] ?? null}
        messageTree={createMessageTree()}
        onSelectMessage={vi.fn()}
      />,
    )

    expect(screen.queryByText("user")).not.toBeInTheDocument()
    expect(screen.queryByText("response")).not.toBeInTheDocument()

    const canvas = document.querySelector(".session-message-tree-canvas") as HTMLDivElement | null
    const graph = document.querySelector(".session-message-tree-graph") as HTMLDivElement | null
    expect(canvas).not.toBeNull()
    expect(graph).not.toBeNull()
    if (!canvas || !graph) return

    const initialTransform = graph.style.transform
    const rootNode = screen.getByText("Root prompt").closest(".session-message-tree-graph-node")
    expect(rootNode).not.toBeNull()
    if (!rootNode) return

    fireEvent.pointerDown(rootNode, {
      pointerId: 7,
      button: 2,
      buttons: 2,
      clientX: 120,
      clientY: 90,
    })
    expect(canvas).toHaveClass("is-panning")

    fireEvent.pointerMove(window, {
      pointerId: 7,
      buttons: 2,
      clientX: 80,
      clientY: 60,
    })

    expect(graph.style.transform).not.toBe(initialTransform)
    expect(graph.style.transform).toMatch(/matrix\(1,\s*0,\s*0,\s*1,\s*-?\d+,\s*-?\d+\)/)

    fireEvent.pointerUp(window, {
      pointerId: 7,
      button: 2,
      buttons: 0,
    })
    expect(canvas).not.toHaveClass("is-panning")

    const transformAfterNodePan = graph.style.transform
    fireEvent.pointerDown(canvas, {
      pointerId: 8,
      button: 2,
      buttons: 2,
      clientX: 200,
      clientY: 140,
    })
    fireEvent.pointerMove(window, {
      pointerId: 8,
      buttons: 2,
      clientX: 250,
      clientY: 180,
    })
    expect(graph.style.transform).not.toBe(transformAfterNodePan)
    fireEvent.pointerUp(window, {
      pointerId: 8,
      button: 2,
      buttons: 0,
    })

    const contextMenuEvent = new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
    canvas.dispatchEvent(contextMenuEvent)
    expect(contextMenuEvent.defaultPrevented).toBe(true)
  })

  it("zooms the message tree canvas with ctrl wheel", () => {
    const restoreCanvasSize = mockMessageTreeCanvasSize(900, 680)
    render(
      <SessionMessageTreePanel
        session={workspace.sessions[0] ?? null}
        messageTree={createMessageTree()}
        onSelectMessage={vi.fn()}
      />,
    )

    const canvas = document.querySelector(".session-message-tree-canvas") as HTMLDivElement | null
    const graph = document.querySelector(".session-message-tree-graph") as HTMLDivElement | null
    expect(canvas).not.toBeNull()
    expect(graph).not.toBeNull()
    if (!canvas || !graph) return

    const initialTransform = graph.style.transform
    fireEvent.wheel(canvas, {
      ctrlKey: false,
      deltaY: -160,
      clientX: 300,
      clientY: 240,
    })
    expect(graph.style.transform).toBe(initialTransform)

    fireEvent.wheel(canvas, {
      ctrlKey: true,
      deltaY: -160,
      clientX: 300,
      clientY: 240,
    })

    expect(graph.style.transform).not.toBe(initialTransform)
    expect(graph.style.transform).toMatch(/matrix\(1\.\d+,\s*0,\s*0,\s*1\.\d+,\s*-?\d+,\s*-?\d+\)/)
    restoreCanvasSize()
  })

  it("expands one assistant response node in place on double click without recentering it", () => {
    const restoreCanvasSize = mockMessageTreeCanvasSize(900, 680)
    render(
      <SessionMessageTreePanel
        session={workspace.sessions[0] ?? null}
        messageTree={createMessageTree()}
        onSelectMessage={vi.fn()}
      />,
    )

    const activeNode = screen.getByText("Active answer").closest(".session-message-tree-graph-node")
    expect(activeNode).not.toBeNull()
    if (!activeNode) return

    const initialAnchor = readMessageTreeNodeScreenAnchor(activeNode)
    const initialTransform = document.querySelector<HTMLDivElement>(".session-message-tree-graph")?.style.transform

    fireEvent.doubleClick(activeNode)

    expect(activeNode).toHaveClass("is-expanded-response")
    expect(activeNode).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText(/complete response content shown/)).toBeInTheDocument()
    expect(readMessageTreeNodeScreenAnchor(activeNode)).toEqual(initialAnchor)
    expect(document.querySelector<HTMLDivElement>(".session-message-tree-graph")?.style.transform).not.toBe(
      "matrix(1, 0, 0, 1, 298, 93)",
    )

    fireEvent.click(screen.getByRole("button", { name: "Collapse response" }))

    expect(activeNode).not.toHaveClass("is-expanded-response")
    expect(screen.queryByText(/complete response content shown/)).not.toBeInTheDocument()
    expect(readMessageTreeNodeScreenAnchor(activeNode)).toEqual(initialAnchor)
    expect(document.querySelector<HTMLDivElement>(".session-message-tree-graph")?.style.transform).toBe(
      initialTransform,
    )
    restoreCanvasSize()
  })

  it("does not run a position animation on the anchored response while expanding it", async () => {
    const restoreCanvasSize = mockMessageTreeCanvasSize(900, 680)
    const originalAnimate = HTMLElement.prototype.animate
    const animateSpy = vi.fn(function (this: HTMLElement) {
      return { cancel: vi.fn() } as unknown as Animation
    })
    HTMLElement.prototype.animate = animateSpy as Element["animate"]

    try {
      render(
        <SessionMessageTreePanel
          session={workspace.sessions[0] ?? null}
          messageTree={createMessageTree()}
          onSelectMessage={vi.fn()}
        />,
      )

      const activeNode = screen.getByText("Active answer").closest(".session-message-tree-graph-node")
      expect(activeNode).not.toBeNull()
      if (!activeNode) return

      const initialAnchor = readMessageTreeNodeScreenAnchor(activeNode)
      fireEvent.doubleClick(activeNode)
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))

      expect(readMessageTreeNodeScreenAnchor(activeNode)).toEqual(initialAnchor)
      expect(animateSpy).toHaveBeenCalled()
      expect(
        animateSpy.mock.contexts.map((context) => (context as HTMLElement).dataset.messageTreeNodeId),
      ).not.toContain("assistant-1")
    } finally {
      if (originalAnimate) {
        HTMLElement.prototype.animate = originalAnimate
      } else {
        delete (HTMLElement.prototype as unknown as { animate?: Element["animate"] }).animate
      }
      restoreCanvasSize()
    }
  })

  it("caps expanded response card height and lays out descendants below the capped card", () => {
    const messageTree = createMessageTree()
    messageTree.nodesByID["assistant-1"]!.content = [
      "Long answer",
      ...Array.from(
        { length: 80 },
        (_, index) => `Expanded response line ${index + 1} with enough detail to wrap inside the response tree card.`,
      ),
      "Final line stays reachable inside the response card scroll area.",
    ].join("\n")
    messageTree.nodesByID["assistant-1"]!.preview = "Long answer"

    render(
      <SessionMessageTreePanel
        session={workspace.sessions[0] ?? null}
        messageTree={messageTree}
        onSelectMessage={vi.fn()}
      />,
    )

    const activeNode = screen.getByText("Long answer").closest(".session-message-tree-graph-node") as HTMLElement | null
    const childNode = queryMessageTreeNode("user-2")
    expect(activeNode).not.toBeNull()
    expect(childNode).not.toBeNull()
    if (!activeNode || !childNode) return

    fireEvent.doubleClick(activeNode)

    const expandedNodeHeight = Number.parseFloat(
      activeNode.style.getPropertyValue("--session-message-tree-expanded-node-height"),
    )
    const responseCardHeight = Number.parseFloat(
      activeNode.style.getPropertyValue("--session-message-tree-response-card-height"),
    )
    const responseCardMinHeight = Number.parseFloat(
      activeNode.style.getPropertyValue("--session-message-tree-response-card-min-height"),
    )
    const activeNodeTop = Number.parseFloat(activeNode.style.top)
    const childNodeTop = Number.parseFloat(childNode.style.top)

    expect(expandedNodeHeight).toBe(458)
    expect(responseCardHeight).toBe(420)
    expect(responseCardMinHeight).toBe(420)
    expect(childNodeTop - activeNodeTop).toBeCloseTo(expandedNodeHeight + 36, 5)
    expect(activeNode.querySelector(".session-message-tree-response-card-body-wrap")).not.toBeNull()
    expect(screen.getByText(/Final line stays reachable/)).toBeInTheDocument()
  })

  it("shrinks expanded response cards when the content does not need the maximum width", () => {
    const messageTree = createMessageTree()
    messageTree.nodesByID["assistant-1"]!.content = [
      "Compact answer",
      "C# is a strongly typed language on .NET.",
      "- Clear types",
      "- Garbage collection",
      "- Async support",
      "Summary: concise and practical.",
    ].join("\n")
    messageTree.nodesByID["assistant-1"]!.preview = "Compact answer"

    render(
      <SessionMessageTreePanel
        session={workspace.sessions[0] ?? null}
        messageTree={messageTree}
        onSelectMessage={vi.fn()}
      />,
    )

    const activeNode = screen.getByText("Compact answer").closest(".session-message-tree-graph-node") as HTMLElement | null
    expect(activeNode).not.toBeNull()
    if (!activeNode) return

    fireEvent.doubleClick(activeNode)

    const expandedNodeWidth = Number.parseFloat(
      activeNode.style.getPropertyValue("--session-message-tree-expanded-node-width"),
    )
    const responseCardWidth = Number.parseFloat(
      activeNode.style.getPropertyValue("--session-message-tree-response-card-width"),
    )

    expect(responseCardWidth).toBeGreaterThanOrEqual(360)
    expect(responseCardWidth).toBeLessThan(560)
    expect(expandedNodeWidth).toBeCloseTo(responseCardWidth + 16, 5)
  })

  it("expands a focused response together with its child responses on click", () => {
    render(
      <SessionMessageTreePanel
        session={workspace.sessions[0] ?? null}
        messageTree={createNestedResponseMessageTree()}
        onSelectMessage={vi.fn()}
      />,
    )

    const parentNode = queryMessageTreeNode("assistant-parent")
    const firstChildResponseNode = queryMessageTreeNode("assistant-child-1")
    const secondChildResponseNode = queryMessageTreeNode("assistant-child-2")
    const thirdChildResponseNode = queryMessageTreeNode("assistant-child-3")
    expect(parentNode).not.toBeNull()
    expect(firstChildResponseNode).not.toBeNull()
    expect(secondChildResponseNode).not.toBeNull()
    expect(thirdChildResponseNode).not.toBeNull()
    if (!parentNode || !firstChildResponseNode || !secondChildResponseNode || !thirdChildResponseNode) return

    fireEvent.click(parentNode)

    expect(parentNode).toHaveClass("is-expanded-response")
    expect(firstChildResponseNode).toHaveClass("is-expanded-response")
    expect(secondChildResponseNode).toHaveClass("is-expanded-response")
    expect(thirdChildResponseNode).toHaveClass("is-expanded-response")
    expect(firstChildResponseNode).toHaveClass("is-sibling-wheel-target")
    expect(firstChildResponseNode.style.left).toBe(parentNode.style.left)
    expect(screen.getByText(/Expanded child response one/)).toBeInTheDocument()
    expect(screen.getByText(/Expanded child response two/)).toBeInTheDocument()
    expect(screen.getByText(/Expanded child response three/)).toBeInTheDocument()
  })

  it("cycles expanded child responses with the mouse wheel under the focused response", () => {
    const onSelectMessage = vi.fn()
    render(
      <SessionMessageTreePanel
        session={workspace.sessions[0] ?? null}
        messageTree={createNestedResponseMessageTree({
          activeMessageID: "assistant-child-2",
          activePathMessageIDs: ["user-1", "assistant-parent", "user-child-2", "assistant-child-2"],
        })}
        onSelectMessage={onSelectMessage}
      />,
    )

    const parentNode = queryMessageTreeNode("assistant-parent")
    const firstChildResponseNode = queryMessageTreeNode("assistant-child-1")
    const secondChildResponseNode = queryMessageTreeNode("assistant-child-2")
    expect(parentNode).not.toBeNull()
    expect(firstChildResponseNode).not.toBeNull()
    expect(secondChildResponseNode).not.toBeNull()
    if (!parentNode || !firstChildResponseNode || !secondChildResponseNode) return

    fireEvent.click(parentNode)
    expect(secondChildResponseNode).toHaveClass("is-sibling-wheel-target")
    expect(secondChildResponseNode.style.left).toBe(parentNode.style.left)
    const parentNodeLeftAfterExpand = parentNode.style.left
    const parentNodeTopAfterExpand = parentNode.style.top
    const graphTransformAfterExpand = document.querySelector<HTMLDivElement>(".session-message-tree-graph")?.style.transform
    onSelectMessage.mockClear()

    fireEvent.wheel(secondChildResponseNode, {
      deltaY: -40,
    })

    expect(secondChildResponseNode).toHaveClass("is-sibling-wheel-target")
    expect(onSelectMessage).not.toHaveBeenCalled()

    fireEvent.wheel(secondChildResponseNode, {
      deltaY: -70,
    })

    expect(firstChildResponseNode).toHaveClass("is-sibling-wheel-target")
    expect(firstChildResponseNode.style.left).toBe(parentNode.style.left)
    expect(parentNode.style.left).toBe(parentNodeLeftAfterExpand)
    expect(parentNode.style.top).toBe(parentNodeTopAfterExpand)
    expect(document.querySelector<HTMLDivElement>(".session-message-tree-graph")?.style.transform).toBe(
      graphTransformAfterExpand,
    )
    expect(secondChildResponseNode).not.toHaveClass("is-sibling-wheel-target")
    expect(onSelectMessage).toHaveBeenLastCalledWith("session-1", "assistant-child-1")
  })

  it("normalizes line-mode wheel deltas when switching child responses", () => {
    const onSelectMessage = vi.fn()
    render(
      <SessionMessageTreePanel
        session={workspace.sessions[0] ?? null}
        messageTree={createNestedResponseMessageTree({
          activeMessageID: "assistant-child-2",
          activePathMessageIDs: ["user-1", "assistant-parent", "user-child-2", "assistant-child-2"],
        })}
        onSelectMessage={onSelectMessage}
      />,
    )

    const parentNode = queryMessageTreeNode("assistant-parent")
    const firstChildResponseNode = queryMessageTreeNode("assistant-child-1")
    const secondChildResponseNode = queryMessageTreeNode("assistant-child-2")
    expect(parentNode).not.toBeNull()
    expect(firstChildResponseNode).not.toBeNull()
    expect(secondChildResponseNode).not.toBeNull()
    if (!parentNode || !firstChildResponseNode || !secondChildResponseNode) return

    fireEvent.click(parentNode)
    expect(secondChildResponseNode).toHaveClass("is-sibling-wheel-target")
    onSelectMessage.mockClear()

    fireEvent.wheel(secondChildResponseNode, {
      deltaMode: 1,
      deltaY: -3,
    })

    expect(firstChildResponseNode).toHaveClass("is-sibling-wheel-target")
    expect(onSelectMessage).toHaveBeenCalledTimes(1)
    expect(onSelectMessage).toHaveBeenLastCalledWith("session-1", "assistant-child-1")
  })

  it("ignores same-gesture wheel momentum after one child response switch", () => {
    const onSelectMessage = vi.fn()
    render(
      <SessionMessageTreePanel
        session={workspace.sessions[0] ?? null}
        messageTree={createNestedResponseMessageTree({
          activeMessageID: "assistant-child-2",
          activePathMessageIDs: ["user-1", "assistant-parent", "user-child-2", "assistant-child-2"],
        })}
        onSelectMessage={onSelectMessage}
      />,
    )

    const parentNode = queryMessageTreeNode("assistant-parent")
    const firstChildResponseNode = queryMessageTreeNode("assistant-child-1")
    const secondChildResponseNode = queryMessageTreeNode("assistant-child-2")
    const thirdChildResponseNode = queryMessageTreeNode("assistant-child-3")
    expect(parentNode).not.toBeNull()
    expect(firstChildResponseNode).not.toBeNull()
    expect(secondChildResponseNode).not.toBeNull()
    expect(thirdChildResponseNode).not.toBeNull()
    if (!parentNode || !firstChildResponseNode || !secondChildResponseNode || !thirdChildResponseNode) return

    fireEvent.click(parentNode)
    expect(secondChildResponseNode).toHaveClass("is-sibling-wheel-target")
    onSelectMessage.mockClear()

    fireEvent.wheel(secondChildResponseNode, {
      deltaY: -120,
    })

    expect(firstChildResponseNode).toHaveClass("is-sibling-wheel-target")
    expect(onSelectMessage).toHaveBeenCalledTimes(1)

    fireEvent.wheel(firstChildResponseNode, {
      deltaY: -120,
    })

    expect(firstChildResponseNode).toHaveClass("is-sibling-wheel-target")
    expect(thirdChildResponseNode).not.toHaveClass("is-sibling-wheel-target")
    expect(onSelectMessage).toHaveBeenCalledTimes(1)
  })

  it("collapses an expanded assistant response when double clicking anywhere in the tree panel", () => {
    render(
      <SessionMessageTreePanel
        session={workspace.sessions[0] ?? null}
        messageTree={createMessageTree()}
        onSelectMessage={vi.fn()}
      />,
    )

    const activeNode = screen.getByText("Active answer").closest(".session-message-tree-graph-node")
    const panel = document.querySelector(".session-message-tree-panel") as HTMLElement | null
    expect(activeNode).not.toBeNull()
    expect(panel).not.toBeNull()
    if (!activeNode || !panel) return

    fireEvent.doubleClick(activeNode)
    expect(activeNode).toHaveClass("is-expanded-response")

    fireEvent.doubleClick(panel)

    expect(activeNode).not.toHaveClass("is-expanded-response")
    expect(screen.queryByText(/complete response content shown/)).not.toBeInTheDocument()
  })

  it("switches the expanded response when double clicking another assistant response", () => {
    const restoreCanvasSize = mockMessageTreeCanvasSize(900, 680)
    render(
      <SessionMessageTreePanel
        session={workspace.sessions[0] ?? null}
        messageTree={createMessageTree()}
        onSelectMessage={vi.fn()}
      />,
    )

    const activeNode = screen.getByText("Active answer").closest(".session-message-tree-graph-node")
    const alternativeNode = screen.getByText("Alternative answer").closest(".session-message-tree-graph-node")
    expect(activeNode).not.toBeNull()
    expect(alternativeNode).not.toBeNull()
    if (!activeNode || !alternativeNode) return

    fireEvent.doubleClick(activeNode)
    expect(activeNode).toHaveClass("is-expanded-response")

    const alternativeAnchor = readMessageTreeNodeScreenAnchor(alternativeNode)
    fireEvent.doubleClick(alternativeNode)

    expect(activeNode).not.toHaveClass("is-expanded-response")
    expect(alternativeNode).toHaveClass("is-expanded-response")
    expect(screen.queryByText(/complete response content shown/)).not.toBeInTheDocument()
    expect(screen.getByText(/second complete response content/)).toBeInTheDocument()
    expect(readMessageTreeNodeScreenAnchor(alternativeNode)).toEqual(alternativeAnchor)
    restoreCanvasSize()
  })
})
