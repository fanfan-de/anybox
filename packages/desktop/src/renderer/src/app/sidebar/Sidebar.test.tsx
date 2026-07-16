import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"
import type { SessionSummary, WorkspaceGroup } from "../types"
import { Sidebar } from "./Sidebar"

function createSession(id: string, title: string): SessionSummary {
  return {
    id,
    title,
    branch: "main",
    status: "Ready",
    created: 1,
    updated: 1,
    focus: "",
    summary: "",
  }
}

function createWorkspace(id = "workspace-1", name = "Workspace", sessionPrefix = ""): WorkspaceGroup {
  return {
    id,
    name,
    directory: `C:/work/${id}`,
    created: 1,
    updated: 1,
    project: {
      id: `project-${id}`,
      name: `Project ${id}`,
      worktree: `C:/work/${id}`,
    },
    sessions: [
      createSession(`${id}-session-unread`, `${sessionPrefix}Unread`),
      createSession(`${id}-session-visible`, `${sessionPrefix}Visible`),
      createSession(`${id}-session-read`, `${sessionPrefix}Read`),
    ],
  }
}

function renderSidebar(overrides: Partial<ComponentProps<typeof Sidebar>> = {}) {
  const props: ComponentProps<typeof Sidebar> = {
    activeSessionID: null,
    activeView: "workspace",
    deletingSessionID: null,
    expandedFolderIDs: ["workspace-1"],
    globalSkillsNavigatorProps: {
      creatingGlobalSkillName: "",
      creatingGlobalSkillDraftKind: "skill",
      creatingGlobalSkillParentDirectory: null,
      deletingGlobalSkillDirectory: null,
      expandedSkillPaths: [],
      globalSkillsRoot: "",
      globalSkillsTree: [],
      isCreateGlobalSkillDraftVisible: false,
      isCreatingGlobalSkill: false,
      isInstallingLocalSkill: false,
      isLoadingSkillsTree: false,
      renamingGlobalSkillDirectory: null,
      renamingGlobalSkillDraftDirectory: null,
      renamingGlobalSkillName: "",
      selectedGlobalSkillFilePath: null,
      onCreateGlobalSkill: vi.fn(),
      onCreateGlobalSkillDraftCancel: vi.fn(),
      onCreateGlobalSkillDraftChange: vi.fn(),
      onCreateGlobalSkillDraftStart: vi.fn(),
      onDeleteGlobalSkill: vi.fn(),
      onGitInstallDialogOpen: vi.fn(),
      onGlobalSkillDirectoryToggle: vi.fn(),
      onGlobalSkillFileSelect: vi.fn(),
      onLocalInstallDialogOpen: vi.fn(),
      onMoveGlobalSkillDirectoryStart: vi.fn(),
      onOpenGlobalSkillsFolder: vi.fn(),
      onRenameGlobalSkill: vi.fn(),
      onRenameGlobalSkillDraftCancel: vi.fn(),
      onRenameGlobalSkillDraftChange: vi.fn(),
      onRenameGlobalSkillDraftStart: vi.fn(),
    },
    hoveredFolderID: null,
    isCreatingProject: false,
    isCreatingSession: false,
    creatingWorktreeProjectID: null,
    isSettingsOpen: false,
    promptSkillMode: "prompts",
    promptPresetsSidebarProps: {
      deletingPromptPresetID: null,
      isCreatingPromptPreset: false,
      isInstallingPromptUrlPrompts: false,
      isPreviewingPromptUrlInstall: false,
      isPromptDirty: false,
      promptRoot: "",
      promptPresets: [],
      promptPresetSelection: null,
      selectedPromptPreset: null,
      onCreatePromptPreset: vi.fn(),
      onDeletePromptPreset: vi.fn(),
      onOpenPromptFolder: vi.fn(),
      onPromptPresetSelect: vi.fn(),
      onPromptUrlInstallDialogOpen: vi.fn(),
    },
    projectRowRefs: { current: {} },
    runningSessionIDs: [],
    selectedFolderID: "workspace-1",
    sessionCanvasUnreadBySession: {},
    showSidebarToggleButton: false,
    builtinToolsSidebarProps: {
      activeToolKind: null,
      builtinTools: [],
      onActiveToolKindChange: vi.fn(),
    },
    visibleCanvasSessionIDs: [],
    conversationWorkspaceID: null,
    protectedWorkspaceIDs: [],
    workspaces: [createWorkspace()],
    pinnedWorkspaceIDs: [],
    onHoveredFolderChange: vi.fn(),
    onOpenSettings: vi.fn(),
    onProjectArchiveSessions: vi.fn(),
    onProjectClick: vi.fn(),
    onProjectCreateAutomation: vi.fn(),
    onProjectCreateSession: vi.fn(),
    onProjectCreateWorktree: vi.fn(),
    onProjectOpenCinema: vi.fn(),
    onProjectOpenInExplorer: vi.fn(),
    onProjectPin: vi.fn(),
    onProjectRemove: vi.fn(),
    onConversationClick: vi.fn(),
    onSessionDelete: vi.fn(),
    onSessionPin: vi.fn(),
    onSessionPopout: vi.fn(),
    onSessionRename: vi.fn(),
    onSessionSelect: vi.fn(),
    onSessionSplitRight: vi.fn(),
    onSidebarAction: vi.fn(),
    onToggleSidebar: vi.fn(),
    ...overrides,
  }

  return render(<Sidebar {...props} />)
}

describe("Sidebar", () => {
  it("uses the workspace actions as the left sidebar top menu", () => {
    renderSidebar()

    const leftSidebarTopMenu = screen.getByLabelText("Left sidebar top menu")

    expect(within(leftSidebarTopMenu).getByRole("button", { name: "Open folder" })).toBeInTheDocument()
    expect(within(leftSidebarTopMenu).queryByRole("button", { name: "Sort sessions" })).not.toBeInTheDocument()
    expect(within(leftSidebarTopMenu).queryByRole("button", { name: "Create session" })).not.toBeInTheDocument()
    expect(screen.queryByRole("group", { name: "Workspace mode" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Chat" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Code" })).not.toBeInTheDocument()
  })

  it("places the local folder action before the SSH folder action", () => {
    renderSidebar({ onOpenRemoteFolderConfig: vi.fn() })

    const leftSidebarTopMenu = screen.getByLabelText("Left sidebar top menu")
    const actionLabels = within(leftSidebarTopMenu)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"))

    expect(actionLabels).toEqual(["Open folder", "Open remote folder"])
  })

  it("requests workspace actions from the top menu", () => {
    const onSidebarAction = vi.fn()
    renderSidebar({ onSidebarAction })

    fireEvent.click(screen.getByRole("button", { name: "Open folder" }))

    expect(onSidebarAction).toHaveBeenNthCalledWith(1, "project")
    expect(onSidebarAction).toHaveBeenCalledTimes(1)
  })

  it("renders the workspace tree", () => {
    renderSidebar()

    const conversationRow = screen.getByRole("button", { name: "\u5bf9\u8bdd" })
    expect(conversationRow).toBeInTheDocument()
    expect(conversationRow.querySelector(".lucide-folder")).toBeInTheDocument()
    expect(conversationRow.querySelector(".lucide-message-square")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Workspace" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Unread" })).toBeInTheDocument()
  })

  it("opens the default conversation entry from the workspace sidebar", () => {
    const onConversationClick = vi.fn()
    renderSidebar({ onConversationClick })

    fireEvent.click(screen.getByRole("button", { name: "\u5bf9\u8bdd" }))

    expect(onConversationClick).toHaveBeenCalledTimes(1)
  })

  it("renders the loaded default conversation workspace as a protected project row", () => {
    const onProjectClick = vi.fn()
    const onProjectRemove = vi.fn()
    renderSidebar({
      conversationWorkspaceID: "workspace-1",
      protectedWorkspaceIDs: ["workspace-1"],
      onProjectClick,
      onProjectRemove,
    })

    const conversationRows = screen.getAllByRole("button", { name: "\u5bf9\u8bdd" })

    expect(conversationRows).toHaveLength(1)
    expect(conversationRows[0].querySelector(".lucide-folder")).toBeInTheDocument()
    expect(conversationRows[0].querySelector(".lucide-message-square")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Workspace" })).not.toBeInTheDocument()
    fireEvent.click(conversationRows[0])
    expect(onProjectClick).toHaveBeenCalledWith(expect.objectContaining({ id: "workspace-1" }))

    fireEvent.contextMenu(conversationRows[0], {
      clientX: 120,
      clientY: 140,
    })
    expect(screen.queryByRole("menuitem", { name: "绉婚櫎" })).not.toBeInTheDocument()
    expect(onProjectRemove).not.toHaveBeenCalled()
  })

  it("marks linked worktree folders with a worktree icon", () => {
    const primaryWorkspace = createWorkspace("workspace-primary", "Primary")
    primaryWorkspace.directory = "C:/repo/app/client"
    primaryWorkspace.project = {
      ...primaryWorkspace.project,
      kind: "git",
      repositoryRoot: "C:/repo/app",
      workspaceRoots: ["C:/repo/app", "C:/worktrees/app-feature"],
      worktree: "C:/repo/app",
      vcs: "git",
    }

    const linkedWorkspace = createWorkspace("workspace-linked", "Feature")
    linkedWorkspace.directory = "C:/worktrees/app-feature"
    linkedWorkspace.project = {
      ...linkedWorkspace.project,
      id: primaryWorkspace.project.id,
      kind: "git",
      repositoryRoot: "C:/repo/app",
      workspaceRoots: ["C:/repo/app", "C:/worktrees/app-feature"],
      worktree: "C:/repo/app",
      vcs: "git",
    }

    renderSidebar({
      expandedFolderIDs: [],
      selectedFolderID: "workspace-linked",
      workspaces: [primaryWorkspace, linkedWorkspace],
    })

    const primaryRow = screen.getByRole("button", { name: "Primary" })
    const linkedRow = screen.getByRole("button", { name: "Feature" })

    expect(primaryRow).not.toHaveClass("is-linked-worktree")
    expect(within(primaryRow).queryByTestId("project-linked-worktree-workspace-primary")).not.toBeInTheDocument()
    expect(linkedRow).toHaveClass("is-linked-worktree")
    expect(within(linkedRow).getByTestId("project-linked-worktree-workspace-linked")).toHaveAttribute(
      "title",
      "Linked worktree: C:/worktrees/app-feature",
    )
    expect(linkedRow.querySelector(".lucide-git-fork")).toBeInTheDocument()
  })

  it("marks automation-created sessions", () => {
    const workspace = createWorkspace()
    workspace.sessions = [
      {
        ...createSession("automation-session", "Automation run"),
        automation: {
          automationID: "aut_1",
          runID: "arn_1",
          name: "Daily review",
          trigger: "manual",
        },
      },
    ]

    renderSidebar({ workspaces: [workspace] })

    expect(screen.getByLabelText("Automation: Daily review")).toBeInTheDocument()
    const row = screen.getByText("Automation run").closest("button")
    if (!(row instanceof HTMLButtonElement)) {
      throw new Error("Expected automation session row to render as a button.")
    }
    expect(row.firstElementChild).toHaveClass("session-row-copy")
    expect(row.lastElementChild).toHaveClass("session-row-icons")
    expect(row.lastElementChild).toContainElement(screen.getByLabelText("Automation: Daily review"))
  })

  it("shows the green dot only for unread session canvases that are not visible", () => {
    renderSidebar({
      activeSessionID: "workspace-1-session-visible",
      sessionCanvasUnreadBySession: {
        "workspace-1-session-unread": true,
        "workspace-1-session-visible": true,
      },
      visibleCanvasSessionIDs: ["workspace-1-session-visible"],
    })

    const unreadRow = screen.getByRole("button", { name: "Unread" })
    expect(unreadRow.lastElementChild).toHaveClass("session-row-icons")
    expect(unreadRow.lastElementChild?.querySelector(".session-row-status-dot")).not.toBeNull()
    expect(screen.getByRole("button", { name: "Visible" }).querySelector(".session-row-status-dot")).toBeNull()
    expect(screen.getByRole("button", { name: "Read" }).querySelector(".session-row-status-dot")).toBeNull()
  })

  it("shows a session creation age in the trailing slot", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-13T12:00:00+08:00"))
    const created = new Date("2026-05-13T11:32:00+08:00").getTime()

    try {
      renderSidebar({
        workspaces: [
          {
            ...createWorkspace(),
            sessions: [
              {
                ...createSession("workspace-1-session-recent", "Recent"),
                created,
                updated: new Date("2026-05-13T11:59:00+08:00").getTime(),
              },
            ],
          },
        ],
      })

      expect(screen.getByText("28 \u5206")).toHaveClass("session-row-created-at")
      expect(screen.getByRole("button", { name: "Recent" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Archive session Recent" })).toBeInTheDocument()
    } finally {
      cleanup()
      vi.useRealTimers()
    }
  })

  it("renders session rows for every expanded workspace", () => {
    renderSidebar({
      expandedFolderIDs: ["workspace-1", "workspace-2"],
      selectedFolderID: "workspace-2",
      workspaces: [
        createWorkspace("workspace-1", "Workspace 1", "One "),
        createWorkspace("workspace-2", "Workspace 2", "Two "),
        createWorkspace("workspace-3", "Workspace 3", "Three "),
      ],
    })

    expect(screen.getByRole("button", { name: "Workspace 1" })).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("button", { name: "Workspace 2" })).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("button", { name: "Workspace 3" })).toHaveAttribute("aria-expanded", "false")
    expect(screen.getByRole("button", { name: "One Unread" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Two Unread" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Three Unread" })).not.toBeInTheDocument()
  })

  it("hides subagent sessions from the left sidebar tree", () => {
    const onSessionSelect = vi.fn()
    const parent = createSession("parent-session", "Parent session")
    const child = {
      ...createSession("child-session", "Child subagent"),
      subagent: {
        taskID: "task-child",
        parentSessionID: parent.id,
        parentMessageID: "msg-parent",
        agent: "default",
        status: "completed" as const,
        active: false,
        updatedAt: 2,
      },
    }
    const sibling = createSession("sibling-session", "Sibling session")
    const { container } = renderSidebar({
      onSessionSelect,
      workspaces: [
        {
          ...createWorkspace(),
          sessions: [parent, child, sibling],
        },
      ],
    })

    const sessionTree = container.querySelector(".session-tree")
    expect(sessionTree).not.toBeNull()
    const topLevelNodes = Array.from(sessionTree?.children ?? [])

    expect(topLevelNodes).toHaveLength(2)
    expect(within(topLevelNodes[0] as HTMLElement).getByRole("button", { name: "Parent session" })).toBeInTheDocument()
    expect(within(topLevelNodes[1] as HTMLElement).getByRole("button", { name: "Sibling session" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Child subagent" })).not.toBeInTheDocument()
    expect(onSessionSelect).not.toHaveBeenCalled()
  })

  it("shows the project root path inline with the folder name", () => {
    renderSidebar()

    const workspaceRow = screen.getByRole("button", { name: "Workspace" })
    expect(workspaceRow.querySelector(".project-row-label")).toHaveTextContent("Workspace")
    expect(workspaceRow.querySelector(".project-row-meta")).toHaveAttribute("title", "C:/work/workspace-1")
    expect(workspaceRow.querySelector(".project-row-meta-label")).toHaveTextContent("C:/work/workspace-1")
  })

  it("adds a project folder from the workspace background context menu", () => {
    const onSidebarAction = vi.fn()
    renderSidebar({ onSidebarAction })

    fireEvent.contextMenu(screen.getByLabelText("Workspace sidebar view"), {
      clientX: window.innerWidth,
      clientY: window.innerHeight,
    })

    const menu = screen.getByRole("menu", { name: "Workspace sidebar actions" })
    const menuItems = within(menu).getAllByRole("menuitem")
    const addProjectFolderItem = within(menu).getByRole("menuitem", { name: "添加项目文件夹…" })

    expect(menuItems).toHaveLength(1)
    expect(addProjectFolderItem.querySelector(".lucide-folder-plus")).toBeInTheDocument()
    expect(menu).toHaveStyle({
      left: `${window.innerWidth - 184 - 8}px`,
      top: `${window.innerHeight - 46 - 8}px`,
    })

    fireEvent.click(addProjectFolderItem)

    expect(onSidebarAction).toHaveBeenCalledTimes(1)
    expect(onSidebarAction).toHaveBeenCalledWith("project")
    expect(screen.queryByRole("menu", { name: "Workspace sidebar actions" })).not.toBeInTheDocument()
  })

  it("disables the background folder action while a project is being created", () => {
    const onSidebarAction = vi.fn()
    renderSidebar({ isCreatingProject: true, onSidebarAction })

    fireEvent.contextMenu(screen.getByLabelText("Workspace sidebar view"), {
      clientX: 120,
      clientY: 140,
    })

    const addProjectFolderItem = screen.getByRole("menuitem", { name: "添加项目文件夹…" })
    expect(addProjectFolderItem).toBeDisabled()

    fireEvent.click(addProjectFolderItem)
    expect(onSidebarAction).not.toHaveBeenCalled()
  })

  it("opens the background menu only from non-interactive workspace space", () => {
    renderSidebar()

    fireEvent.contextMenu(screen.getByRole("button", { name: "\u5bf9\u8bdd" }), {
      clientX: 120,
      clientY: 140,
    })
    expect(screen.queryByRole("menu", { name: "Workspace sidebar actions" })).not.toBeInTheDocument()

    fireEvent.contextMenu(screen.getByRole("button", { name: "Unread" }), {
      clientX: 120,
      clientY: 140,
    })
    expect(screen.queryByRole("menu", { name: "Workspace sidebar actions" })).not.toBeInTheDocument()

    const workspaceView = screen.getByLabelText("Workspace sidebar view")
    fireEvent.contextMenu(workspaceView, { clientX: 120, clientY: 140 })
    expect(screen.getByRole("menu", { name: "Workspace sidebar actions" })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("menu", { name: "Workspace sidebar actions" })).not.toBeInTheDocument()

    fireEvent.contextMenu(workspaceView, { clientX: 120, clientY: 140 })
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole("menu", { name: "Workspace sidebar actions" })).not.toBeInTheDocument()
  })

  it("opens session actions without selecting the session or opening project actions", () => {
    const onSessionSelect = vi.fn()
    renderSidebar({ onSessionSelect })

    fireEvent.contextMenu(screen.getByRole("button", { name: "Unread" }), {
      clientX: window.innerWidth,
      clientY: window.innerHeight,
    })

    const menu = screen.getByRole("menu", { name: "Unread 会话操作" })
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "重命名",
      "置顶会话",
      "在右侧窗格中打开",
      "在新窗口中打开",
      "归档会话",
    ])
    expect(menu).toHaveStyle({
      left: `${window.innerWidth - 224 - 8}px`,
      top: `${window.innerHeight - 204 - 8}px`,
    })
    expect(screen.queryByRole("menuitem", { name: "置顶项目" })).not.toBeInTheDocument()
    expect(onSessionSelect).not.toHaveBeenCalled()
  })

  it("runs pin, split, and popout session actions", async () => {
    const onSessionPin = vi.fn()
    const onSessionPopout = vi.fn()
    const onSessionSplitRight = vi.fn()
    renderSidebar({ onSessionPin, onSessionPopout, onSessionSplitRight })
    const row = screen.getByRole("button", { name: "Unread" })

    fireEvent.contextMenu(row)
    fireEvent.click(screen.getByRole("menuitem", { name: "置顶会话" }))
    expect(onSessionPin).toHaveBeenCalledWith("workspace-1", "workspace-1-session-unread", true)

    await waitFor(() => expect(screen.queryByRole("menu", { name: "Unread 会话操作" })).not.toBeInTheDocument())
    fireEvent.contextMenu(row)
    fireEvent.click(screen.getByRole("menuitem", { name: "在右侧窗格中打开" }))
    expect(onSessionSplitRight).toHaveBeenCalledWith("workspace-1", "workspace-1-session-unread")

    await waitFor(() => expect(screen.queryByRole("menu", { name: "Unread 会话操作" })).not.toBeInTheDocument())
    fireEvent.contextMenu(row)
    fireEvent.click(screen.getByRole("menuitem", { name: "在新窗口中打开" }))
    expect(onSessionPopout).toHaveBeenCalledWith("workspace-1-session-unread")
  })

  it("supports keyboard session menus and inline rename validation", async () => {
    const onSessionRename = vi.fn()
    renderSidebar({ onSessionRename })
    const row = screen.getByRole("button", { name: "Unread" })

    row.focus()
    fireEvent.keyDown(row, { key: "F10", shiftKey: true })
    expect(screen.getByRole("menuitem", { name: "重命名" })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole("menu", { name: "Unread 会话操作" }), { key: "ArrowDown" })
    expect(screen.getByRole("menuitem", { name: "置顶会话" })).toHaveFocus()
    fireEvent.keyDown(document, { key: "Escape" })
    await waitFor(() => expect(row).toHaveFocus())

    fireEvent.contextMenu(row)
    fireEvent.click(screen.getByRole("menuitem", { name: "重命名" }))
    const input = screen.getByRole("textbox", { name: "重命名会话 Unread" })
    expect(input).toHaveValue("Unread")
    fireEvent.change(input, { target: { value: "  " } })
    fireEvent.blur(input)
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(onSessionRename).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: "Renamed session" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onSessionRename).toHaveBeenCalledWith(
      "workspace-1",
      "workspace-1-session-unread",
      "Renamed session",
    )
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "重命名会话 Unread" })).not.toBeInTheDocument())
  })

  it("keeps inline rename active when saving fails", async () => {
    const onSessionRename = vi.fn().mockRejectedValue(new Error("offline"))
    renderSidebar({ onSessionRename })

    fireEvent.contextMenu(screen.getByRole("button", { name: "Unread" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "重命名" }))
    const input = screen.getByRole("textbox", { name: "重命名会话 Unread" })
    fireEvent.change(input, { target: { value: "Failed rename" } })
    fireEvent.keyDown(input, { key: "Enter" })

    await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"))
    expect(input).toBeInTheDocument()
  })

  it("disables archive actions while the session is running", () => {
    renderSidebar({ runningSessionIDs: ["workspace-1-session-unread"] })

    const row = screen.getByRole("button", { name: "Unread" })
    fireEvent.contextMenu(row)

    expect(screen.getByRole("menuitem", { name: "归档会话" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Archive session Unread" })).toBeDisabled()
  })

  it("disables parent archive while a hidden subagent session is running", () => {
    const workspace = createWorkspace()
    const parent = createSession("parent-session", "Parent session")
    workspace.sessions = [
      parent,
      {
        ...createSession("child-session", "Hidden child"),
        subagent: {
          taskID: "task-1",
          parentSessionID: parent.id,
          parentMessageID: "message-1",
          agent: "worker",
          status: "running",
          active: true,
          updatedAt: 2,
        },
      },
    ]
    renderSidebar({ runningSessionIDs: ["child-session"], workspaces: [workspace] })

    fireEvent.contextMenu(screen.getByRole("button", { name: "Parent session" }))
    expect(screen.getByRole("menuitem", { name: "归档会话" })).toBeDisabled()
  })

  it("opens workspace row actions from the context menu", () => {
    const onProjectArchiveSessions = vi.fn()
    const onProjectCreateAutomation = vi.fn()
    const onProjectOpenCinema = vi.fn()
    const onProjectOpenInExplorer = vi.fn()
    const onProjectPin = vi.fn()
    const onProjectRemove = vi.fn()
    renderSidebar({
      onProjectArchiveSessions,
      onProjectCreateAutomation,
      onProjectOpenCinema,
      onProjectOpenInExplorer,
      onProjectPin,
      onProjectRemove,
    })

    expect(screen.queryByRole("button", { name: "移除 Workspace" })).not.toBeInTheDocument()

    fireEvent.contextMenu(screen.getByRole("button", { name: "Workspace" }), {
      clientX: 120,
      clientY: 140,
    })
    expect(screen.queryByRole("menuitem", { name: "添加项目文件夹…" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("menuitem", { name: "置顶项目" }))
    expect(onProjectPin).toHaveBeenCalledWith(expect.objectContaining({ id: "workspace-1" }))

    fireEvent.contextMenu(screen.getByRole("button", { name: "Workspace" }), {
      clientX: 120,
      clientY: 140,
    })
    fireEvent.click(screen.getByRole("menuitem", { name: "在资源管理器中打开" }))
    expect(onProjectOpenInExplorer).toHaveBeenCalledWith(expect.objectContaining({ id: "workspace-1" }))

    fireEvent.contextMenu(screen.getByRole("button", { name: "Workspace" }), {
      clientX: 120,
      clientY: 140,
    })
    fireEvent.click(screen.getByRole("menuitem", { name: "Open Cinema" }))
    expect(onProjectOpenCinema).toHaveBeenCalledWith(expect.objectContaining({ id: "workspace-1" }))

    fireEvent.contextMenu(screen.getByRole("button", { name: "Workspace" }), {
      clientX: 120,
      clientY: 140,
    })
    fireEvent.click(screen.getByRole("menuitem", { name: "创建自动化" }))
    expect(onProjectCreateAutomation).toHaveBeenCalledWith(expect.objectContaining({ id: "workspace-1" }))

    fireEvent.contextMenu(screen.getByRole("button", { name: "Workspace" }), {
      clientX: 120,
      clientY: 140,
    })
    fireEvent.click(screen.getByRole("menuitem", { name: "归档所有对话" }))
    expect(onProjectArchiveSessions).toHaveBeenCalledWith(expect.objectContaining({ id: "workspace-1" }))

    fireEvent.contextMenu(screen.getByRole("button", { name: "Workspace" }), {
      clientX: 120,
      clientY: 140,
    })
    fireEvent.click(screen.getByRole("menuitem", { name: "移除" }))
    expect(onProjectRemove).toHaveBeenCalledWith(expect.objectContaining({ id: "workspace-1" }), expect.anything())
  })

  it("shows the create worktree action only for git projects", () => {
    const onProjectCreateWorktree = vi.fn()
    const gitWorkspace = createWorkspace("workspace-git", "Git Workspace")
    gitWorkspace.project = {
      ...gitWorkspace.project,
      kind: "git",
      repositoryRoot: gitWorkspace.project.worktree,
      vcs: "git",
    }
    const plainWorkspace = createWorkspace("workspace-plain", "Plain Workspace")

    renderSidebar({
      expandedFolderIDs: [],
      selectedFolderID: "workspace-git",
      workspaces: [gitWorkspace, plainWorkspace],
      onProjectCreateWorktree,
    })

    fireEvent.contextMenu(screen.getByRole("button", { name: "Plain Workspace" }), {
      clientX: 120,
      clientY: 140,
    })
    expect(screen.queryByRole("menuitem", { name: "创建工作树" })).not.toBeInTheDocument()

    fireEvent.contextMenu(screen.getByRole("button", { name: "Git Workspace" }), {
      clientX: 120,
      clientY: 140,
    })
    fireEvent.click(screen.getByRole("menuitem", { name: "创建工作树" }))

    const nameInput = screen.getByLabelText("分支名称")
    expect(nameInput).toHaveValue("workspace-git-2")

    fireEvent.change(nameInput, {
      target: { value: "功能开发" },
    })
    fireEvent.click(screen.getByRole("button", { name: "创建" }))

    expect(onProjectCreateWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ id: "workspace-git" }),
      {
        name: "功能开发",
        branchName: "功能开发",
      },
    )
  })

  it("keeps the create worktree dialog open when clicking outside it", () => {
    const gitWorkspace = createWorkspace("workspace-git", "Git Workspace")
    gitWorkspace.project = {
      ...gitWorkspace.project,
      kind: "git",
      repositoryRoot: gitWorkspace.project.worktree,
      vcs: "git",
    }

    renderSidebar({
      expandedFolderIDs: [],
      selectedFolderID: "workspace-git",
      workspaces: [gitWorkspace],
    })

    fireEvent.contextMenu(screen.getByRole("button", { name: "Git Workspace" }), {
      clientX: 120,
      clientY: 140,
    })
    fireEvent.click(screen.getByRole("menuitem", { name: "创建工作树" }))

    const dialog = screen.getByRole("dialog", { name: "创建工作树并切换分支" })
    const overlay = dialog.closest(".project-worktree-create-overlay")
    expect(overlay).toBeInstanceOf(HTMLElement)

    fireEvent.click(overlay as HTMLElement)
    expect(screen.getByRole("dialog", { name: "创建工作树并切换分支" })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.getByRole("dialog", { name: "创建工作树并切换分支" })).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }))
    expect(screen.queryByRole("dialog", { name: "创建工作树并切换分支" })).not.toBeInTheDocument()

    fireEvent.contextMenu(screen.getByRole("button", { name: "Git Workspace" }), {
      clientX: 120,
      clientY: 140,
    })
    fireEvent.click(screen.getByRole("menuitem", { name: "创建工作树" }))
    fireEvent.click(screen.getByRole("button", { name: "关闭" }))
    expect(screen.queryByRole("dialog", { name: "创建工作树并切换分支" })).not.toBeInTheDocument()
  })

  it("submits the create worktree dialog only once while creation is pending", () => {
    const onProjectCreateWorktree = vi.fn(() => new Promise<boolean>(() => undefined))
    const gitWorkspace = createWorkspace("workspace-git", "Git Workspace")
    gitWorkspace.project = {
      ...gitWorkspace.project,
      kind: "git",
      repositoryRoot: gitWorkspace.project.worktree,
      vcs: "git",
    }

    renderSidebar({
      expandedFolderIDs: [],
      selectedFolderID: "workspace-git",
      workspaces: [gitWorkspace],
      onProjectCreateWorktree,
    })

    fireEvent.contextMenu(screen.getByRole("button", { name: "Git Workspace" }), {
      clientX: 120,
      clientY: 140,
    })
    fireEvent.click(screen.getByRole("menuitem", { name: "创建工作树" }))

    const createButton = screen.getByRole("button", { name: "创建" })
    fireEvent.click(createButton)

    expect(screen.getByRole("button", { name: "创建中" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "创建中" }))
    expect(onProjectCreateWorktree).toHaveBeenCalledTimes(1)
  })
})
