import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SessionSummary, SessionTaskListView, SessionTaskSummary, ToolPermissionMode } from "../types"
import { SessionCanvasTopMenu } from "./SessionCanvasTopMenu"

const session: SessionSummary = {
  id: "session-1",
  title: "Main session",
  branch: "main",
  status: "Live",
  updated: 1,
  focus: "",
  summary: "",
}

function createTask(
  id: string,
  subject: string,
  status: SessionTaskSummary["status"],
  overrides: Partial<SessionTaskSummary> = {},
): SessionTaskSummary {
  return {
    id,
    sessionID: session.id,
    subject,
    description: "",
    activeForm: "",
    owner: "codex",
    status,
    sortIndex: Number(id.replace(/\D/g, "")) || 0,
    blocks: [],
    blockedBy: [],
    metadata: {},
    createdAt: 1,
    updatedAt: 1,
    isBlocked: false,
    blockingTasks: [],
    blockedTasks: [],
    ...overrides,
  }
}

function createTaskList(
  tasks: SessionTaskSummary[],
  teammateActivity: SessionTaskListView["teammateActivity"] = [],
): SessionTaskListView {
  const completed = tasks.filter((task) => task.status === "completed").length
  const inProgress = tasks.filter((task) => task.status === "in_progress").length
  const pending = tasks.filter((task) => task.status === "pending").length
  const blocked = tasks.filter((task) => task.isBlocked).length

  return {
    sessionID: session.id,
    generatedAt: 1,
    tasks,
    current: tasks.filter((task) => task.status === "in_progress"),
    next: tasks.filter((task) => task.status === "pending" && !task.isBlocked),
    blocked: tasks.filter((task) => task.isBlocked),
    owners: [],
    teammateActivity,
    summary: {
      total: tasks.length,
      completed,
      pending,
      inProgress,
      blocked,
    },
  }
}

function createRect(input: Partial<DOMRect>): DOMRect {
  const left = input.left ?? 0
  const top = input.top ?? 0
  const width = input.width ?? ((input.right ?? left) - left)
  const height = input.height ?? ((input.bottom ?? top) - top)
  const right = input.right ?? left + width
  const bottom = input.bottom ?? top + height

  return {
    x: input.x ?? left,
    y: input.y ?? top,
    left,
    top,
    width,
    height,
    right,
    bottom,
    toJSON: () => ({}),
  } as DOMRect
}

function createTopMenuProps(
  overrides: Partial<Parameters<typeof SessionCanvasTopMenu>[0]> = {},
) {
  return {
    activeSession: session,
    gitProjectID: "project-1",
    gitDirectory: null,
    isSavingToolPermissionMode: false,
    mcpOptions: [],
    pluginOptions: [],
    pendingPermissionRequests: [],
    selectedMcpServerIDs: [],
    selectedMcpServerLabel: "MCP",
    onMcpServerToggle: vi.fn(),
    selectedPluginIDs: [],
    selectedPluginLabel: "Plugins",
    onPluginToggle: vi.fn(),
    toolPermissionMode: "default",
    toolPermissionModeError: null,
    onToolPermissionModeChange: vi.fn(),
    skillOptions: [],
    selectedSkillIDs: [],
    selectedSkillLabel: "Skills",
    onSkillToggle: vi.fn(),
    ...overrides,
  } satisfies Parameters<typeof SessionCanvasTopMenu>[0]
}

function renderTopMenu(
  overrides: Partial<Parameters<typeof SessionCanvasTopMenu>[0]> = {},
) {
  const props = createTopMenuProps(overrides)

  return {
    props,
    ...render(<SessionCanvasTopMenu {...props} />),
  }
}

function setDesktopApi(api: Partial<NonNullable<typeof window.desktop>>) {
  Object.defineProperty(window, "desktop", {
    configurable: true,
    value: api,
  })
}

beforeEach(() => {
  setDesktopApi({})
})

describe("SessionCanvasTopMenu session view mode", () => {
  it("does not repeat the active session title below the pane tab", () => {
    renderTopMenu({
      sessionViewMode: "linear",
      onSessionViewModeChange: vi.fn(),
    })

    const topMenu = screen.getByLabelText("Session canvas top menu")
    expect(within(topMenu).queryByText(session.title)).not.toBeInTheDocument()
    expect(within(topMenu).getByRole("button", { name: "Session view: Linear" })).toBeInTheDocument()
  })

  it("renders linear and branch as the shared top-menu dropdown style", async () => {
    const onSessionViewModeChange = vi.fn()
    const { container } = renderTopMenu({
      sessionViewMode: "linear",
      onSessionViewModeChange,
    })

    const trigger = screen.getByRole("button", { name: "Session view: Linear" })
    expect(trigger).toHaveClass("canvas-top-menu-selection-trigger")
    fireEvent.click(trigger)

    const menu = screen.getByRole("menu", { name: "Session view" })
    expect(menu).toHaveClass("canvas-top-menu-selection-panel")
    expect(menu).toHaveClass("is-portal")
    expect(container.querySelector('[role="menu"]')).toBeNull()
    const linearOption = within(menu).getByRole("menuitemradio", { name: "Linear" })
    const branchOption = within(menu).getByRole("menuitemradio", { name: "Branches" })
    expect(linearOption).toHaveAttribute(
      "aria-checked",
      "true",
    )
    expect(branchOption).toHaveAttribute(
      "aria-checked",
      "false",
    )
    await waitFor(() => expect(linearOption).toHaveFocus())

    fireEvent.keyDown(menu, { key: "ArrowDown" })
    expect(branchOption).toHaveFocus()

    fireEvent.click(branchOption)
    expect(onSessionViewModeChange).toHaveBeenCalledWith("branch")
    expect(screen.queryByRole("menu", { name: "Session view" })).not.toBeInTheDocument()
  })

  it("does not expose the view switch when the parent has not opted in", () => {
    renderTopMenu()
    expect(screen.queryByRole("button", { name: /Session view:/ })).not.toBeInTheDocument()
  })

  it("keeps the dropdown inside the owning workbench pane", async () => {
    const getRect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("workbench-pane")) {
        return createRect({ left: 154, right: 1000, width: 846, top: 0, bottom: 700, height: 700 })
      }
      if (this.classList.contains("canvas-top-menu-view-mode-trigger")) {
        return createRect({ left: 214, right: 303, width: 89, top: 52, bottom: 93, height: 41 })
      }
      if (this.classList.contains("canvas-top-menu-view-mode-panel")) {
        return createRect({ left: 0, right: 230, width: 230, top: 0, bottom: 98, height: 98 })
      }
      return createRect({})
    })

    try {
      render(
        <section className="workbench-pane">
          <SessionCanvasTopMenu
            {...createTopMenuProps({
              sessionViewMode: "linear",
              onSessionViewModeChange: vi.fn(),
            })}
          />
        </section>,
      )

      fireEvent.click(screen.getByRole("button", { name: "Session view: Linear" }))
      const menu = screen.getByRole("menu", { name: "Session view" })

      await waitFor(() => expect(menu).toHaveStyle({ left: "162px" }))
    } finally {
      getRect.mockRestore()
    }
  })
})

describe("SessionCanvasTopMenu project skills", () => {
  const skillOptions = [
    {
      value: "skill-layout-review",
      label: "layout-review",
      description: "Review the current layout against the desktop shell spec.",
    },
    {
      value: "skill-code-review",
      label: "code-review",
      description: "Review code changes before sending them.",
    },
    {
      value: "skill-browser-use",
      label: "browser-use",
      description: "Automate browser checks for local targets.",
    },
  ]

  it("renders skill names only and keeps selected skills first", () => {
    const onSkillToggle = vi.fn()
    renderTopMenu({
      onSkillToggle,
      selectedSkillIDs: ["skill-code-review"],
      selectedSkillLabel: "code-review",
      skillOptions,
    })

    const trigger = screen.getByRole("button", { name: "Select project skills: code-review" })
    expect(trigger).toHaveClass("canvas-top-menu-selection-trigger")
    fireEvent.click(trigger)

    const menu = screen.getByRole("dialog", { name: "Project skill selection" })
    expect(menu).toHaveClass("canvas-top-menu-selection-panel")
    expect(within(menu).getByRole("searchbox", { name: "Search skills" })).toHaveFocus()

    const options = within(menu).getAllByRole("option")
    expect(options.map((option) => option.textContent)).toEqual(["code-review", "layout-review", "browser-use"])
    expect(options[0]).toHaveAttribute("aria-selected", "true")
    expect(within(menu).queryByText("Review code changes before sending them.")).not.toBeInTheDocument()
    expect(within(menu).queryByText("Selected")).not.toBeInTheDocument()
    expect(within(menu).queryByText("Add")).not.toBeInTheDocument()

    fireEvent.click(options[1]!)
    expect(onSkillToggle).toHaveBeenCalledWith("skill-layout-review")
  })

  it("filters skills by name while keeping selected matches first", () => {
    renderTopMenu({
      selectedSkillIDs: ["skill-code-review"],
      selectedSkillLabel: "code-review",
      skillOptions,
    })

    fireEvent.click(screen.getByRole("button", { name: "Select project skills: code-review" }))
    const menu = screen.getByRole("dialog", { name: "Project skill selection" })
    fireEvent.change(within(menu).getByRole("searchbox", { name: "Search skills" }), {
      target: { value: "review" },
    })

    expect(within(menu).getAllByRole("option").map((option) => option.textContent)).toEqual(["code-review", "layout-review"])
    expect(within(menu).queryByRole("option", { name: "browser-use" })).not.toBeInTheDocument()
  })
})

describe("SessionCanvasTopMenu project MCP servers", () => {
  const mcpOptions = [
    {
      value: "filesystem",
      label: "Filesystem",
      description: "Access project files.",
    },
    {
      value: "browser",
      label: "Browser",
      description: "Inspect local browser targets.",
    },
  ]

  it("renders compact MCP rows with descriptions exposed as titles", () => {
    const onMcpServerToggle = vi.fn()
    renderTopMenu({
      mcpOptions,
      onMcpServerToggle,
      selectedMcpServerIDs: ["filesystem"],
      selectedMcpServerLabel: "Filesystem",
    })

    const trigger = screen.getByRole("button", { name: "Select project MCP servers: Filesystem" })
    expect(trigger).toHaveClass("canvas-top-menu-selection-trigger")
    fireEvent.click(trigger)

    const menu = screen.getByRole("menu", { name: "Project MCP server selection" })
    expect(menu).toHaveClass("canvas-top-menu-selection-panel")
    const filesystemOption = within(menu).getByRole("menuitemcheckbox", { name: /Filesystem/ })
    expect(filesystemOption).toHaveAttribute("aria-checked", "true")
    expect(filesystemOption).toHaveAttribute("title", "Access project files.")
    expect(filesystemOption.querySelector(".canvas-top-menu-context-option-status")).not.toBeInTheDocument()
    expect(within(menu).queryByText("Access project files.")).not.toBeInTheDocument()

    const browserOption = within(menu).getByRole("menuitemcheckbox", { name: /Browser/ })
    expect(browserOption.querySelector(".canvas-top-menu-context-option-status")).not.toBeInTheDocument()
    fireEvent.click(browserOption)

    expect(onMcpServerToggle).toHaveBeenCalledWith("browser")
  })
})

describe("SessionCanvasTopMenu project plugins", () => {
  const pluginOptions = [
    {
      value: "build-web-apps",
      label: "Build Web Apps",
      description: "Frontend workflows - 1 MCP, 3 skills",
      icon: "BWA",
    },
    {
      value: "chrome",
      label: "Chrome",
      description: "Chrome automation - 1 MCP",
      iconUrl: "https://example.test/chrome.png",
    },
  ]

  it("renders installed plugin rows and toggles project plugin selection", () => {
    const onPluginToggle = vi.fn()
    renderTopMenu({
      onPluginToggle,
      pluginOptions,
      selectedPluginIDs: ["build-web-apps"],
      selectedPluginLabel: "Build Web Apps",
    })

    const trigger = screen.getByRole("button", { name: "Select project plugins: Build Web Apps" })
    expect(trigger).toHaveClass("canvas-top-menu-selection-trigger")
    fireEvent.click(trigger)

    const menu = screen.getByRole("menu", { name: "Project plugin selection" })
    expect(menu).toHaveClass("canvas-top-menu-selection-panel")
    const selectedOption = within(menu).getByRole("menuitemcheckbox", { name: /Build Web Apps/ })
    expect(selectedOption).toHaveAttribute("aria-checked", "true")
    expect(selectedOption).toHaveAttribute("title", "Frontend workflows - 1 MCP, 3 skills")
    expect(selectedOption.querySelector(".canvas-top-menu-plugin-mark-glyph")).toHaveTextContent("BWA")
    expect(selectedOption.querySelector(".canvas-top-menu-context-option-status")).not.toBeInTheDocument()

    const chromeOption = within(menu).getByRole("menuitemcheckbox", { name: /Chrome/ })
    expect(chromeOption.querySelector(".canvas-top-menu-plugin-mark img")).toHaveAttribute("src", "https://example.test/chrome.png")
    expect(chromeOption.querySelector(".canvas-top-menu-context-option-status")).not.toBeInTheDocument()

    fireEvent.click(chromeOption)

    expect(onPluginToggle).toHaveBeenCalledWith("chrome")
  })
})

describe("SessionCanvasTopMenu trace export", () => {
  it("copies safe trace JSON for the active session", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const getSessionTraceExport = vi.fn().mockResolvedValue({
      schemaVersion: 2,
      mode: "safe",
      session: {
        id: "session-1",
        missing: false,
      },
      messages: [],
      events: [],
      runtime: {},
      toolCalls: [],
      stats: {
        messageCount: 0,
        eventCount: 0,
        turnCount: 0,
        toolCallCount: 0,
        redactedCount: 0,
        truncatedCount: 0,
      },
      redaction: {
        enabled: true,
        maxStringLength: 20000,
        redactedKeyPattern: "token",
      },
    })
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText,
      },
    })
    setDesktopApi({ getSessionTraceExport })

    renderTopMenu()

    fireEvent.click(screen.getByRole("button", { name: "Export session trace" }))
    const menu = screen.getByRole("menu", { name: "Session trace export" })
    expect(menu).toHaveClass("canvas-top-menu-context-panel", "canvas-top-menu-fit-panel")
    const copyOption = within(menu).getByRole("menuitem", { name: "Copy trace JSON" })
    expect(copyOption).toHaveClass("canvas-top-menu-context-option", "canvas-top-menu-trace-option")
    expect(copyOption.querySelector(".ui-context-menu__icon")).not.toBeNull()
    expect(copyOption.querySelector(".ui-context-menu__label")).toHaveTextContent("Copy trace JSON")
    expect(copyOption.querySelector("strong")).toBeNull()
    expect(copyOption.querySelector(".canvas-top-menu-context-option-status")).toBeNull()
    fireEvent.click(copyOption)

    await waitFor(() => {
      expect(getSessionTraceExport).toHaveBeenCalledWith({ sessionID: "session-1" })
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"schemaVersion": 2'))
    })
  })

  it("saves safe trace JSON and displays save status", async () => {
    const saveSessionTraceExport = vi.fn().mockResolvedValue({
      canceled: false,
      path: "C:\\Temp\\trace.json",
    })
    setDesktopApi({ saveSessionTraceExport })

    renderTopMenu()

    fireEvent.click(screen.getByRole("button", { name: "Export session trace" }))
    fireEvent.click(screen.getByRole("menuitem", { name: /Save trace JSON/ }))

    await waitFor(() => {
      expect(saveSessionTraceExport).toHaveBeenCalledWith({ sessionID: "session-1" })
      expect(screen.getByText("Trace JSON saved.")).toBeInTheDocument()
    })
  })

  it("saves split trace folder and displays save status", async () => {
    const exportedPath = "C:\\Temp\\trace-folder"
    const openPath = vi.fn().mockResolvedValue({
      ok: true,
      targetPath: exportedPath,
    })
    const saveSessionTraceExportDirectory = vi.fn().mockResolvedValue({
      canceled: false,
      path: exportedPath,
      fileCount: 11,
      recordCount: 1,
    })
    setDesktopApi({ openPath, saveSessionTraceExportDirectory })

    renderTopMenu()

    fireEvent.click(screen.getByRole("button", { name: "Export session trace" }))
    fireEvent.click(screen.getByRole("menuitem", { name: /Save split trace folder/ }))

    await waitFor(() => {
      expect(saveSessionTraceExportDirectory).toHaveBeenCalledWith({ sessionID: "session-1" })
      expect(openPath).toHaveBeenCalledWith({ targetPath: exportedPath })
      expect(screen.getByText("Split trace folder saved.")).toBeInTheDocument()
    })
  })

  it("uses the dedicated raw trace export action", async () => {
    const exportedPath = "C:\\Temp\\raw-trace-folder"
    const openPath = vi.fn().mockResolvedValue({ ok: true, targetPath: exportedPath })
    const saveSessionTraceExportRawDirectory = vi.fn().mockResolvedValue({
      canceled: false,
      path: exportedPath,
      fileCount: 4,
      recordCount: 1,
    })
    setDesktopApi({ openPath, saveSessionTraceExportRawDirectory })

    renderTopMenu()
    fireEvent.click(screen.getByRole("button", { name: "Export session trace" }))
    fireEvent.click(screen.getByRole("menuitem", { name: /Save split trace with raw payloads/ }))

    await waitFor(() => {
      expect(saveSessionTraceExportRawDirectory).toHaveBeenCalledWith({ sessionID: "session-1" })
      expect(openPath).toHaveBeenCalledWith({ targetPath: exportedPath })
      expect(screen.getByText("Raw split trace folder saved.")).toBeInTheDocument()
    })
  })

  it("saves split trace folder to the project default location", async () => {
    const exportedPath = "C:\\Users\\Demo\\AppData\\Roaming\\Anybox\\session-traces\\project-1\\trace-folder"
    const openPath = vi.fn().mockResolvedValue({
      ok: true,
      targetPath: exportedPath,
    })
    const saveSessionTraceExportToProject = vi.fn().mockResolvedValue({
      canceled: false,
      path: exportedPath,
      fileCount: 11,
      recordCount: 1,
    })
    setDesktopApi({ openPath, saveSessionTraceExportToProject })

    renderTopMenu({
      gitDirectory: "C:\\Projects\\Demo",
    })

    fireEvent.click(screen.getByRole("button", { name: "Export session trace" }))
    fireEvent.click(screen.getByRole("menuitem", { name: /Save to project default/ }))

    await waitFor(() => {
      expect(saveSessionTraceExportToProject).toHaveBeenCalledWith({
        sessionID: "session-1",
        directory: "C:\\Projects\\Demo",
        projectID: "project-1",
      })
      expect(openPath).toHaveBeenCalledWith({ targetPath: exportedPath })
      expect(screen.getByText("Trace saved to project default.")).toBeInTheDocument()
    })
  })

  it("does not show trace export actions without an active session", () => {
    renderTopMenu({ activeSession: null })

    expect(screen.queryByRole("button", { name: "Export session trace" })).not.toBeInTheDocument()
  })
})

describe("SessionCanvasTopMenu task progress", () => {
  it("opens a compact task progress card from the canvas toolbar", () => {
    renderTopMenu({
      sessionTasks: createTaskList([
        createTask("task-1", "Inspect current task tools", "completed"),
        createTask("task-2", "Run tests", "in_progress", {
          activeForm: "Running tests",
          owner: "desktop",
        }),
        createTask("task-3", "Wait for review", "pending", {
          isBlocked: true,
        }),
      ]),
    })

    fireEvent.click(screen.getByRole("button", { name: "Session information: 2 active tasks" }))

    const menu = screen.getByRole("dialog", { name: "Session information" })
    expect(within(menu).getByRole("button", { name: "收起进度" })).toBeInTheDocument()
    expect(within(menu).getByText("进度")).toBeInTheDocument()
    expect(within(menu).getByText("Inspect current task tools")).toBeInTheDocument()
    expect(within(menu).getByText("Running tests")).toBeInTheDocument()
    expect(within(menu).getByText("Wait for review")).toBeInTheDocument()
    expect(within(menu).queryByText("desktop")).not.toBeInTheDocument()
    expect(within(menu).queryByText("Blocked")).not.toBeInTheDocument()
  })

  it("keeps progress collapsed by default when no task is running", () => {
    renderTopMenu({
      sessionTasks: createTaskList([
        createTask("task-1", "Inspect current task tools", "completed"),
        createTask("task-2", "Wait for review", "pending"),
      ]),
    })

    fireEvent.click(screen.getByRole("button", { name: "Session information: 1 active task" }))

    const menu = screen.getByRole("dialog", { name: "Session information" })
    expect(within(menu).getByRole("button", { name: "展开进度" })).toBeInTheDocument()
    expect(within(menu).queryByText("Inspect current task tools")).not.toBeInTheDocument()
    expect(within(menu).queryByText("Wait for review")).not.toBeInTheDocument()

    fireEvent.click(within(menu).getByRole("button", { name: "展开进度" }))

    expect(within(menu).getByRole("button", { name: "收起进度" })).toBeInTheDocument()
    expect(within(menu).getByText("Inspect current task tools")).toBeInTheDocument()
    expect(within(menu).getByText("Wait for review")).toBeInTheDocument()
  })

  it("auto-expands the information panel when it fits beside the thread column", () => {
    const getRect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const element = this as HTMLElement
      if (element.classList.contains("workbench-pane")) return createRect({ left: 0, right: 900, width: 900, top: 0, bottom: 700, height: 700 })
      if (element.classList.contains("thread-column")) return createRect({ left: 80, right: 520, width: 440, top: 90, bottom: 700, height: 610 })
      if (element.classList.contains("canvas-top-menu-info-trigger")) return createRect({ left: 852, right: 884, width: 32, top: 40, bottom: 72, height: 32 })
      return createRect({})
    })

    try {
      render(
        <section className="workbench-pane">
          <div className="thread-column" />
          <SessionCanvasTopMenu
            {...createTopMenuProps({
              sessionTasks: createTaskList([
                createTask("task-1", "Inspect current task tools", "completed"),
                createTask("task-2", "Run tests", "in_progress"),
              ]),
            })}
          />
        </section>,
      )

      expect(screen.getByRole("dialog", { name: "Session information" })).toBeInTheDocument()
    } finally {
      getRect.mockRestore()
    }
  })

  it("keeps the information panel collapsed when it would overlap the thread column", () => {
    const getRect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const element = this as HTMLElement
      if (element.classList.contains("workbench-pane")) return createRect({ left: 0, right: 900, width: 900, top: 0, bottom: 700, height: 700 })
      if (element.classList.contains("thread-column")) return createRect({ left: 80, right: 760, width: 680, top: 90, bottom: 700, height: 610 })
      if (element.classList.contains("canvas-top-menu-info-trigger")) return createRect({ left: 852, right: 884, width: 32, top: 40, bottom: 72, height: 32 })
      return createRect({})
    })

    try {
      render(
        <section className="workbench-pane">
          <div className="thread-column" />
          <SessionCanvasTopMenu
            {...createTopMenuProps({
              sessionTasks: createTaskList([
                createTask("task-1", "Inspect current task tools", "completed"),
                createTask("task-2", "Run tests", "in_progress"),
              ]),
            })}
          />
        </section>,
      )

      expect(screen.queryByRole("dialog", { name: "Session information" })).not.toBeInTheDocument()
    } finally {
      getRect.mockRestore()
    }
  })

  it("keeps the task trigger as the rightmost session action", () => {
    renderTopMenu({ sessionTasks: null })

    const topMenu = screen.getByLabelText("Session canvas top menu")
    const buttons = within(topMenu).getAllByRole("button")
    expect(buttons.at(-1)).toHaveAccessibleName("Session information: task data not loaded")
  })

  it("keeps the task trigger available before a task snapshot is loaded", () => {
    renderTopMenu({ sessionTasks: null })

    fireEvent.click(screen.getByRole("button", { name: "Session information: task data not loaded" }))

    const menu = screen.getByRole("dialog", { name: "Session information" })
    expect(within(menu).getByRole("button", { name: "展开进度" })).toBeInTheDocument()
    expect(within(menu).queryByText("Task data not loaded")).not.toBeInTheDocument()

    fireEvent.click(within(menu).getByRole("button", { name: "展开进度" }))

    expect(within(menu).getByText("Task data not loaded")).toBeInTheDocument()
    expect(within(menu).getByText("Task progress will appear here once the session reports it.")).toBeInTheDocument()
  })

  it("opens child subagent sessions from the information panel", () => {
    const onOpenSubagentSession = vi.fn()
    renderTopMenu({
      onOpenSubagentSession,
      sessionTasks: createTaskList([], [
        {
          id: "subagent-1",
          owner: "codex",
          title: "Write intro doc",
          status: "running",
          active: true,
          childSessionID: "child-session",
          updatedAt: 2,
        },
      ]),
    })

    fireEvent.click(screen.getByRole("button", { name: "Session information: no tasks" }))

    const menu = screen.getByRole("dialog", { name: "Session information" })
    expect(within(menu).getByText("子 Agent")).toBeInTheDocument()
    expect(within(menu).getByRole("button", { name: "收起子 Agent" }).querySelector(".task-progress-menu-icon")).toBeNull()

    const subagentRow = within(menu).getByRole("button", { name: "打开子 Agent: Write intro doc" })
    expect(subagentRow.querySelector(".task-progress-menu-row-icon")).not.toBeNull()

    fireEvent.click(subagentRow)

    expect(onOpenSubagentSession).toHaveBeenCalledWith("child-session", "Write intro doc")
  })

  it("hides the task trigger without an active session", () => {
    renderTopMenu({ activeSession: null, sessionTasks: null })

    expect(screen.queryByRole("button", { name: /Session information:/ })).not.toBeInTheDocument()
  })
})

describe("SessionCanvasTopMenu tool permission mode", () => {
  it("renders both permission modes and emits mode changes", () => {
    const onToolPermissionModeChange = vi.fn()
    renderTopMenu({ onToolPermissionModeChange })

    const trigger = screen.getByRole("button", { name: "工具权限：默认权限" })
    expect(trigger).toHaveClass("canvas-top-menu-selection-trigger")
    fireEvent.click(trigger)

    const menu = screen.getByRole("menu", { name: "工具权限模式选择" })
    expect(menu).toHaveClass("canvas-top-menu-selection-panel")
    expect(within(menu).getByText("默认权限")).toBeInTheDocument()
    expect(within(menu).getByText("完全访问权限")).toBeInTheDocument()
    expect(within(menu).queryByText("ask 进入审批，allow 直接执行，deny 拒绝。")).not.toBeInTheDocument()
    const defaultOption = within(menu).getByRole("menuitemradio", { name: /默认权限/ })
    expect(defaultOption).toHaveAttribute("aria-checked", "true")
    expect(defaultOption.querySelector(".canvas-top-menu-context-option-status")).not.toBeInTheDocument()
    expect(defaultOption).toHaveAttribute(
      "title",
      "ask 进入审批，allow 直接执行，deny 拒绝。",
    )

    const fullAccessOption = within(menu).getByRole("menuitemradio", { name: /完全访问权限/ })
    expect(fullAccessOption).toHaveAttribute("aria-checked", "false")
    expect(fullAccessOption.querySelector(".canvas-top-menu-context-option-status")).not.toBeInTheDocument()
    fireEvent.click(fullAccessOption)

    expect(onToolPermissionModeChange).toHaveBeenCalledWith("full_access")
  })

  it("disables the permission mode control while saving and exposes save errors", () => {
    renderTopMenu({
      isSavingToolPermissionMode: true,
      toolPermissionModeError: "Could not save mode",
    })

    const trigger = screen.getByRole("button", { name: "工具权限：默认权限" })
    expect(trigger).toBeDisabled()
    expect(trigger).toHaveAttribute("title", expect.stringContaining("Could not save mode"))
  })

  it("uses shared mode state across multiple session top menus", () => {
    function Harness() {
      const [mode, setMode] = useState<ToolPermissionMode>("default")

      return (
        <>
          <SessionCanvasTopMenu
            {...createTopMenuProps()}
            activeSession={{ ...session, id: "session-1", title: "Session 1" }}
            toolPermissionMode={mode}
            onToolPermissionModeChange={setMode}
          />
          <SessionCanvasTopMenu
            {...createTopMenuProps()}
            activeSession={{ ...session, id: "session-2", title: "Session 2" }}
            toolPermissionMode={mode}
            onToolPermissionModeChange={setMode}
          />
        </>
      )
    }

    render(<Harness />)

    expect(screen.getAllByRole("button", { name: "工具权限：默认权限" })).toHaveLength(2)
    fireEvent.click(screen.getAllByRole("button", { name: "工具权限：默认权限" })[0]!)
    fireEvent.click(screen.getByRole("menuitemradio", { name: /完全访问权限/ }))

    expect(screen.getAllByRole("button", { name: "工具权限：完全访问权限" })).toHaveLength(2)
  })
})
