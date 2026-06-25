import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ExternalEditorMenuButton } from "../external-editor/ExternalEditorMenuButton"
import { GitQuickMenuButton } from "../git/GitQuickMenuButton"
import { CheckIcon, ChevronDownIcon, CopyIcon, DownloadIcon, FolderIcon, InfoIcon, SessionRunningIcon, SessionTreeIcon } from "../icons"
import { ShellTopMenu, SideChatBadge, writeTextToClipboard } from "../shared-ui"
import type {
  ComposerMcpOption,
  ComposerPluginOption,
  ComposerSkillOption,
  PermissionRequest,
  SessionTaskListView,
  SessionTaskSummary,
  SessionTaskTeammateActivity,
  SessionSummary,
  ToolPermissionMode,
} from "../types"
import { isSideChatSession } from "../workspace"

const TOOL_PERMISSION_MODE_OPTIONS: Array<{
  value: ToolPermissionMode
  label: string
  description: string
}> = [
  {
    value: "default",
    label: "默认权限",
    description: "ask 进入审批，allow 直接执行，deny 拒绝。",
  },
  {
    value: "full_access",
    label: "完全访问权限",
    description: "ask 自动通过，deny 仍然拒绝。",
  },
]

const SESSION_INFO_PANEL_WIDTH = 320
const SESSION_INFO_PANEL_THREAD_MARGIN = 16

function getToolPermissionModeLabel(mode: ToolPermissionMode) {
  return TOOL_PERMISSION_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? "默认权限"
}

interface SessionCanvasTopMenuProps {
  activeSession: SessionSummary | null
  sessionTasks?: SessionTaskListView | null
  gitProjectID: string | null
  gitDirectory: string | null
  showGitControls?: boolean
  isSavingToolPermissionMode: boolean
  mcpOptions: ComposerMcpOption[]
  pluginOptions: ComposerPluginOption[]
  pendingPermissionRequests: PermissionRequest[]
  selectedMcpServerIDs: string[]
  selectedMcpServerLabel: string
  onMcpServerToggle: (value: string) => void | Promise<void>
  selectedPluginIDs: string[]
  selectedPluginLabel: string
  onPluginToggle: (value: string) => void | Promise<void>
  toolPermissionMode: ToolPermissionMode
  toolPermissionModeError: string | null
  onToolPermissionModeChange: (mode: ToolPermissionMode) => void | Promise<void>
  onOpenReview?: (() => void | Promise<void>) | null
  onOpenSubagentSession?: (sessionID: string, title?: string) => void | Promise<void>
  skillOptions: ComposerSkillOption[]
  selectedSkillIDs: string[]
  selectedSkillLabel: string
  onSkillToggle: (value: string) => void
}

function ToolPermissionModeMenuButton({
  isSaving,
  mode,
  error,
  onModeChange,
}: {
  isSaving: boolean
  mode: ToolPermissionMode
  error: string | null
  onModeChange: (mode: ToolPermissionMode) => void | Promise<void>
}) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const selectedLabel = getToolPermissionModeLabel(mode)
  const title = error
    ? `工具权限：${selectedLabel}。保存失败：${error}`
    : `工具权限：${selectedLabel}`

  useEffect(() => {
    if (!isMenuOpen) return

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setIsMenuOpen(false)
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false)
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [isMenuOpen])

  function handleOptionClick(nextMode: ToolPermissionMode) {
    if (nextMode === mode || isSaving) return
    setIsMenuOpen(false)
    void onModeChange(nextMode)
  }

  return (
    <div className="canvas-top-menu-selector-anchor">
      <button
        ref={buttonRef}
        type="button"
        className={isMenuOpen ? "canvas-top-menu-button canvas-top-menu-permission-trigger is-active" : "canvas-top-menu-button canvas-top-menu-permission-trigger"}
        aria-controls="canvas-top-menu-permission-menu"
        aria-expanded={isMenuOpen}
        aria-haspopup="menu"
        aria-label={`工具权限：${selectedLabel}`}
        title={title}
        disabled={isSaving}
        onClick={() => setIsMenuOpen((current) => !current)}
      >
        <span>{selectedLabel}</span>
        <ChevronDownIcon />
      </button>

      {isMenuOpen ? (
        <div
          ref={menuRef}
          id="canvas-top-menu-permission-menu"
          className="canvas-top-menu-selector-panel canvas-top-menu-action-selector-panel canvas-top-menu-context-panel canvas-top-menu-permission-panel"
          role="menu"
          aria-label="工具权限模式选择"
        >
          {TOOL_PERMISSION_MODE_OPTIONS.map((option) => {
            const isSelected = option.value === mode

            return (
              <button
                key={option.value}
                className={isSelected ? "canvas-top-menu-context-option canvas-top-menu-permission-option is-selected" : "canvas-top-menu-context-option canvas-top-menu-permission-option"}
                disabled={isSaving}
                onClick={() => handleOptionClick(option.value)}
                role="menuitem"
                title={option.description}
                type="button"
              >
                <span className="canvas-top-menu-context-option-label canvas-top-menu-permission-option-label">
                  <strong>{option.label}</strong>
                </span>
                <span className="canvas-top-menu-context-option-status canvas-top-menu-permission-option-status">{isSelected ? "已选择" : "切换"}</span>
              </button>
            )
          })}
          {error ? <p className="canvas-top-menu-quick-status is-error">{error}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

function ProjectMcpMenuButton({
  mcpOptions,
  selectedMcpServerIDs,
  selectedMcpServerLabel,
  onMcpServerToggle,
}: {
  mcpOptions: ComposerMcpOption[]
  selectedMcpServerIDs: string[]
  selectedMcpServerLabel: string
  onMcpServerToggle: (value: string) => void | Promise<void>
}) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  useEffect(() => {
    if (!isMenuOpen) return

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setIsMenuOpen(false)
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false)
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [isMenuOpen])

  return (
    <div className="canvas-top-menu-selector-anchor">
      <button
        ref={buttonRef}
        type="button"
        className={isMenuOpen ? "canvas-top-menu-button canvas-top-menu-mcp-trigger is-active" : "canvas-top-menu-button canvas-top-menu-mcp-trigger"}
        aria-controls="canvas-top-menu-mcp-menu"
        aria-expanded={isMenuOpen}
        aria-haspopup="menu"
        aria-label={`Select project MCP servers: ${selectedMcpServerLabel}`}
        title={`Project MCP servers: ${selectedMcpServerLabel}`}
        onClick={() => setIsMenuOpen((current) => !current)}
      >
        <span>{selectedMcpServerLabel}</span>
        <ChevronDownIcon />
      </button>

      {isMenuOpen ? (
        <div
          ref={menuRef}
          id="canvas-top-menu-mcp-menu"
          className="canvas-top-menu-selector-panel canvas-top-menu-action-selector-panel canvas-top-menu-context-panel canvas-top-menu-mcp-panel"
          role="menu"
          aria-label="Project MCP server selection"
        >
          {mcpOptions.length > 0 ? (
            mcpOptions.map((option) => {
              const isSelected = selectedMcpServerIDs.includes(option.value)

              return (
                <button
                  key={option.value}
                  aria-checked={isSelected}
                  className={isSelected ? "canvas-top-menu-context-option canvas-top-menu-mcp-option is-selected" : "canvas-top-menu-context-option canvas-top-menu-mcp-option"}
                  onClick={() => void onMcpServerToggle(option.value)}
                  role="menuitemcheckbox"
                  title={option.description}
                  type="button"
                >
                  <span className="canvas-top-menu-context-option-label">
                    <strong>{option.label}</strong>
                  </span>
                  <span className="canvas-top-menu-context-option-status">{isSelected ? "Enabled" : "Enable"}</span>
                </button>
              )
            })
          ) : (
            <p className="composer-menu-empty">No global MCP servers are available yet.</p>
          )}
        </div>
      ) : null}
    </div>
  )
}

function isComposerPluginImageIcon(icon: string) {
  return /^(https?:\/\/|data:image\/)/.test(icon)
}

function composerPluginInitials(label: string) {
  const words = label.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return "P"
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase()
}

function ComposerPluginMark({ option }: { option: ComposerPluginOption }) {
  const rawIcon = option.icon?.trim()
  const imageIcon = option.iconUrl ?? (rawIcon && isComposerPluginImageIcon(rawIcon) ? rawIcon : undefined)

  return (
    <span className="canvas-top-menu-plugin-mark" aria-hidden="true">
      {imageIcon ? (
        <img src={imageIcon} alt="" />
      ) : rawIcon && rawIcon.length <= 4 ? (
        <span className="canvas-top-menu-plugin-mark-glyph">{rawIcon}</span>
      ) : (
        <span className="canvas-top-menu-plugin-mark-glyph">{composerPluginInitials(option.label)}</span>
      )}
    </span>
  )
}

function ProjectPluginsMenuButton({
  pluginOptions,
  selectedPluginIDs,
  selectedPluginLabel,
  onPluginToggle,
}: {
  pluginOptions: ComposerPluginOption[]
  selectedPluginIDs: string[]
  selectedPluginLabel: string
  onPluginToggle: (value: string) => void | Promise<void>
}) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  useEffect(() => {
    if (!isMenuOpen) return

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setIsMenuOpen(false)
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false)
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [isMenuOpen])

  return (
    <div className="canvas-top-menu-selector-anchor">
      <button
        ref={buttonRef}
        type="button"
        className={isMenuOpen ? "canvas-top-menu-button canvas-top-menu-plugin-trigger is-active" : "canvas-top-menu-button canvas-top-menu-plugin-trigger"}
        aria-controls="canvas-top-menu-plugin-menu"
        aria-expanded={isMenuOpen}
        aria-haspopup="menu"
        aria-label={`Select project plugins: ${selectedPluginLabel}`}
        title={`Project plugins: ${selectedPluginLabel}`}
        onClick={() => setIsMenuOpen((current) => !current)}
      >
        <span>{selectedPluginLabel}</span>
        <ChevronDownIcon />
      </button>

      {isMenuOpen ? (
        <div
          ref={menuRef}
          id="canvas-top-menu-plugin-menu"
          className="canvas-top-menu-selector-panel canvas-top-menu-action-selector-panel canvas-top-menu-context-panel canvas-top-menu-plugin-panel"
          role="menu"
          aria-label="Project plugin selection"
        >
          {pluginOptions.length > 0 ? (
            pluginOptions.map((option) => {
              const isSelected = selectedPluginIDs.includes(option.value)

              return (
                <button
                  key={option.value}
                  aria-checked={isSelected}
                  className={isSelected ? "canvas-top-menu-context-option canvas-top-menu-plugin-option is-selected" : "canvas-top-menu-context-option canvas-top-menu-plugin-option"}
                  onClick={() => void onPluginToggle(option.value)}
                  role="menuitemcheckbox"
                  title={option.description}
                  type="button"
                >
                  <span className="canvas-top-menu-plugin-option-main">
                    <ComposerPluginMark option={option} />
                    <span className="canvas-top-menu-context-option-label">
                      <strong>{option.label}</strong>
                    </span>
                  </span>
                  <span className="canvas-top-menu-context-option-status">{isSelected ? "Enabled" : "Enable"}</span>
                </button>
              )
            })
          ) : (
            <p className="composer-menu-empty">No installed plugins are enabled yet.</p>
          )}
        </div>
      ) : null}
    </div>
  )
}

function ProjectSkillsMenuButton({
  skillOptions,
  selectedSkillIDs,
  selectedSkillLabel,
  onSkillToggle,
}: {
  skillOptions: ComposerSkillOption[]
  selectedSkillIDs: string[]
  selectedSkillLabel: string
  onSkillToggle: (value: string) => void
}) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [skillSearchQuery, setSkillSearchQuery] = useState("")
  const visibleSkillOptions = useMemo(() => {
    const normalizedQuery = skillSearchQuery.trim().toLocaleLowerCase()
    const selectedSkillIDSet = new Set(selectedSkillIDs)
    const matchingOptions = normalizedQuery
      ? skillOptions.filter((option) => option.label.toLocaleLowerCase().includes(normalizedQuery))
      : skillOptions
    const selectedOptions = matchingOptions.filter((option) => selectedSkillIDSet.has(option.value))
    const unselectedOptions = matchingOptions.filter((option) => !selectedSkillIDSet.has(option.value))

    return [...selectedOptions, ...unselectedOptions]
  }, [selectedSkillIDs, skillOptions, skillSearchQuery])

  useEffect(() => {
    if (!isMenuOpen) return

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setIsMenuOpen(false)
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false)
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [isMenuOpen])

  return (
    <div className="canvas-top-menu-selector-anchor">
      <button
        ref={buttonRef}
        type="button"
        className={isMenuOpen ? "canvas-top-menu-button canvas-top-menu-skill-trigger is-active" : "canvas-top-menu-button canvas-top-menu-skill-trigger"}
        aria-controls="canvas-top-menu-skill-menu"
        aria-expanded={isMenuOpen}
        aria-haspopup="dialog"
        aria-label={`Select project skills: ${selectedSkillLabel}`}
        title={`Project skills: ${selectedSkillLabel}`}
        onClick={() => setIsMenuOpen((current) => !current)}
      >
        <span>{selectedSkillLabel}</span>
        <ChevronDownIcon />
      </button>

      {isMenuOpen ? (
        <div
          ref={menuRef}
          id="canvas-top-menu-skill-menu"
          className="canvas-top-menu-selector-panel canvas-top-menu-action-selector-panel canvas-top-menu-context-panel canvas-top-menu-searchable-panel canvas-top-menu-skill-selector-panel"
          role="dialog"
          aria-label="Project skill selection"
        >
          <div className="composer-menu-search" role="presentation">
            <input
              aria-label="Search skills"
              autoFocus
              className="composer-menu-search-input"
              onChange={(event) => setSkillSearchQuery(event.currentTarget.value)}
              placeholder="Search skills"
              type="search"
              value={skillSearchQuery}
            />
          </div>
          <div className="composer-menu-options" role="listbox" aria-label="Skill selection" aria-multiselectable="true">
            {visibleSkillOptions.length > 0 ? (
              visibleSkillOptions.map((option) => {
                const isSelected = selectedSkillIDs.includes(option.value)

                return (
                  <button
                    key={option.value}
                    aria-selected={isSelected}
                    className={isSelected ? "canvas-top-menu-context-option canvas-top-menu-skill-option is-selected" : "canvas-top-menu-context-option canvas-top-menu-skill-option"}
                    onClick={() => onSkillToggle(option.value)}
                    role="option"
                    type="button"
                  >
                    <span className="canvas-top-menu-context-option-label">{option.label}</span>
                  </button>
                )
              })
            ) : (
              <p className="composer-menu-empty">{skillOptions.length > 0 ? "No skills match your search." : "No project skills are available yet."}</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function getTaskDisplayText(task: SessionTaskSummary) {
  if (task.status === "in_progress") return task.activeForm || task.subject
  return task.subject
}

function getTaskStatusClassName(task: SessionTaskSummary) {
  if (task.status === "completed") return "is-completed"
  if (task.status === "in_progress") return "is-running"
  if (task.isBlocked) return "is-blocked"
  return "is-pending"
}

function getTaskButtonLabel(tasks?: SessionTaskListView | null) {
  if (!tasks) return "task data not loaded"
  if (tasks.summary.total === 0) return "no tasks"

  const openCount = tasks.summary.inProgress + tasks.summary.pending
  if (openCount > 0) {
    return `${openCount} active task${openCount === 1 ? "" : "s"}`
  }
  return `${tasks.summary.completed}/${tasks.summary.total} tasks complete`
}

function TaskStatusIcon({ task }: { task: SessionTaskSummary }) {
  if (task.status === "in_progress") {
    return <SessionRunningIcon />
  }
  if (task.status === "completed") {
    return <CheckIcon />
  }
  return <span className="task-progress-menu-pending-dot" aria-hidden="true" />
}

function getSubagentDisplayText(activity: SessionTaskTeammateActivity) {
  return activity.title.trim() || activity.owner.trim() || "Sub Agent"
}

function getSubagentStatusLabel(activity: SessionTaskTeammateActivity) {
  if (activity.active) return "Running"

  switch (activity.status) {
    case "completed":
      return "Completed"
    case "failed":
      return "Failed"
    case "cancelled":
      return "Cancelled"
    case "blocked":
      return "Blocked"
    case "stopped":
      return "Stopped"
    default:
      return activity.status.trim() || "Pending"
  }
}

function getSubagentStatusClassName(activity: SessionTaskTeammateActivity) {
  if (activity.active || activity.status === "running") return "is-running"
  if (activity.status === "completed") return "is-completed"
  if (activity.status === "blocked" || activity.status === "failed") return "is-blocked"
  return "is-pending"
}

function SubagentStatusIcon({ activity }: { activity: SessionTaskTeammateActivity }) {
  if (activity.active || activity.status === "running") {
    return <SessionRunningIcon />
  }
  if (activity.status === "completed") {
    return <CheckIcon />
  }
  return <span className="task-progress-menu-pending-dot" aria-hidden="true" />
}

function sessionInfoPanelCanAutoOpen(button: HTMLButtonElement | null) {
  if (!button) return false

  const pane = button.closest<HTMLElement>(".workbench-pane")
  const threadColumn = pane?.querySelector<HTMLElement>(".thread-column")
  if (!pane || !threadColumn) return false

  const buttonRect = button.getBoundingClientRect()
  const paneRect = pane.getBoundingClientRect()
  const threadRect = threadColumn.getBoundingClientRect()
  const panelWidth = Math.min(SESSION_INFO_PANEL_WIDTH, Math.max(0, paneRect.width - 32))
  const panelLeft = buttonRect.right - panelWidth

  return panelLeft >= threadRect.right + SESSION_INFO_PANEL_THREAD_MARGIN
}

function SessionInfoMenuButton({
  onOpenSubagentSession,
  sessionID,
  tasks,
}: {
  onOpenSubagentSession?: (sessionID: string, title?: string) => void | Promise<void>
  sessionID: string
  tasks?: SessionTaskListView | null
}) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const lastSessionIDRef = useRef(sessionID)
  const userToggledRef = useRef(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  useLayoutEffect(() => {
    if (lastSessionIDRef.current !== sessionID) {
      lastSessionIDRef.current = sessionID
      userToggledRef.current = false
    }
    if (userToggledRef.current) return

    const updateAutoOpen = () => {
      setIsMenuOpen(sessionInfoPanelCanAutoOpen(buttonRef.current))
    }

    updateAutoOpen()
    window.addEventListener("resize", updateAutoOpen)

    const pane = buttonRef.current?.closest<HTMLElement>(".workbench-pane")
    const threadColumn = pane?.querySelector<HTMLElement>(".thread-column")
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateAutoOpen)

    if (resizeObserver) {
      if (pane) resizeObserver.observe(pane)
      if (threadColumn) resizeObserver.observe(threadColumn)
    }

    return () => {
      window.removeEventListener("resize", updateAutoOpen)
      resizeObserver?.disconnect()
    }
  }, [sessionID, tasks])

  useEffect(() => {
    if (!isMenuOpen) return

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      userToggledRef.current = true
      setIsMenuOpen(false)
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        userToggledRef.current = true
        setIsMenuOpen(false)
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [isMenuOpen])

  const hasTasks = Boolean(tasks && tasks.summary.total > 0)
  const subagents = useMemo(
    () => tasks?.teammateActivity.filter((activity) => Boolean(activity.childSessionID?.trim())) ?? [],
    [tasks],
  )
  const openCount = tasks ? tasks.summary.inProgress + tasks.summary.pending : 0
  const hasRunningTasks = Boolean(tasks && tasks.summary.inProgress > 0)
  const hasSubagents = subagents.length > 0
  const [isProgressOpen, setIsProgressOpen] = useState(hasRunningTasks)
  const [isSubagentsOpen, setIsSubagentsOpen] = useState(hasSubagents)
  const emptyTitle = tasks ? "No tasks yet" : "Task data not loaded"
  const emptyText = tasks
    ? "Tasks created by the agent will appear here."
    : "Task progress will appear here once the session reports it."

  useEffect(() => {
    setIsProgressOpen(hasRunningTasks)
  }, [hasRunningTasks, sessionID])

  useEffect(() => {
    setIsSubagentsOpen(hasSubagents)
  }, [hasSubagents, sessionID])

  return (
    <div className="canvas-top-menu-quick-anchor canvas-top-menu-info-anchor">
      <button
        ref={buttonRef}
        type="button"
        className={isMenuOpen ? "canvas-top-menu-button canvas-top-menu-info-trigger is-active" : "canvas-top-menu-button canvas-top-menu-info-trigger"}
        aria-controls="canvas-top-menu-info-menu"
        aria-expanded={isMenuOpen}
        aria-haspopup="dialog"
        aria-label={`Session information: ${getTaskButtonLabel(tasks)}`}
        title={`Session information: ${getTaskButtonLabel(tasks)}`}
        onClick={() => {
          userToggledRef.current = true
          setIsMenuOpen((current) => !current)
        }}
      >
        <InfoIcon />
        {openCount > 0 ? <span className="canvas-top-menu-info-badge">{openCount}</span> : null}
      </button>

      {isMenuOpen ? (
        <div ref={menuRef} id="canvas-top-menu-info-menu" className="canvas-top-menu-quick-panel session-info-menu-panel" role="dialog" aria-label="Session information">
          <button
            type="button"
            className="task-progress-menu-header"
            aria-expanded={isProgressOpen}
            aria-label={isProgressOpen ? "收起进度" : "展开进度"}
            onClick={() => setIsProgressOpen((current) => !current)}
          >
            <span className="task-progress-menu-title-row">
              <span className="task-progress-menu-icon" aria-hidden="true">
                <SessionTreeIcon />
              </span>
              <span className="task-progress-menu-title">进度</span>
            </span>
            <span className={isProgressOpen ? "task-progress-menu-chevron is-open" : "task-progress-menu-chevron"} aria-hidden="true">
              <ChevronDownIcon />
            </span>
          </button>

          {isProgressOpen ? (
            hasTasks && tasks ? (
              <ol className="task-progress-menu-list">
                {tasks.tasks.map((task) => (
                  <li key={task.id} className={`task-progress-menu-row ${getTaskStatusClassName(task)}`}>
                    <span className="task-progress-menu-row-icon" aria-hidden="true">
                      <TaskStatusIcon task={task} />
                    </span>
                    <span className="task-progress-menu-task-title" title={getTaskDisplayText(task)}>{getTaskDisplayText(task)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="task-progress-menu-empty">
                <strong>{emptyTitle}</strong>
                <span>{emptyText}</span>
              </div>
            )
          ) : null}
          <div className="task-progress-menu-divider" />
          {hasSubagents ? (
            <>
              <button
                type="button"
                className="task-progress-menu-header"
                aria-expanded={isSubagentsOpen}
                aria-label={isSubagentsOpen ? "收起子 Agent" : "展开子 Agent"}
                onClick={() => setIsSubagentsOpen((current) => !current)}
              >
                <span className="task-progress-menu-title-row">
                  <span className="task-progress-menu-title">子 Agent</span>
                </span>
                <span className={isSubagentsOpen ? "task-progress-menu-chevron is-open" : "task-progress-menu-chevron"} aria-hidden="true">
                  <ChevronDownIcon />
                </span>
              </button>

              {isSubagentsOpen ? (
                <ol className="task-progress-menu-list session-info-subagent-list">
                  {subagents.map((activity) => {
                    const childSessionID = activity.childSessionID?.trim() ?? ""
                    const title = getSubagentDisplayText(activity)
                    const statusLabel = getSubagentStatusLabel(activity)

                    return (
                      <li key={activity.id} className="session-info-subagent-list-item">
                        <button
                          type="button"
                          className={`session-info-subagent-row ${getSubagentStatusClassName(activity)}`}
                          disabled={!childSessionID}
                          aria-label={`打开子 Agent: ${title}`}
                          title={`${title} · ${statusLabel}`}
                          onClick={() => {
                            if (!childSessionID) return
                            void onOpenSubagentSession?.(childSessionID, title)
                          }}
                        >
                          <span className="task-progress-menu-row-icon" aria-hidden="true">
                            <SubagentStatusIcon activity={activity} />
                          </span>
                          <span className="task-progress-menu-task-title">{title}</span>
                          <span className="session-info-subagent-meta">{statusLabel}</span>
                        </button>
                      </li>
                    )
                  })}
                </ol>
              ) : null}
              <div className="task-progress-menu-divider" />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function SessionTraceExportMenuButton({
  projectDirectory,
  projectID,
  sessionID,
}: {
  projectDirectory: string | null
  projectID: string | null
  sessionID: string
}) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [busyAction, setBusyAction] = useState<"copy" | "save" | "saveDirectory" | "saveProject" | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const trimmedProjectDirectory = projectDirectory?.trim() ?? ""

  useEffect(() => {
    if (!isMenuOpen) return

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setIsMenuOpen(false)
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false)
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [isMenuOpen])

  function resetStatus() {
    setStatusMessage(null)
    setErrorMessage(null)
  }

  function readErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }

  async function openSavedTraceFolder(folderPath: string | undefined) {
    if (!folderPath || !window.desktop?.openPath) return
    await window.desktop.openPath({ targetPath: folderPath })
  }

  async function loadTraceJSON() {
    if (!window.desktop?.getSessionTraceExport) {
      throw new Error("Trace export is unavailable.")
    }

    const trace = await window.desktop.getSessionTraceExport({ sessionID })
    return JSON.stringify(trace, null, 2)
  }

  async function handleCopyClick() {
    resetStatus()
    setBusyAction("copy")

    try {
      await writeTextToClipboard(await loadTraceJSON())
      setStatusMessage("Trace JSON copied.")
    } catch (error) {
      setErrorMessage(readErrorMessage(error))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleSaveClick() {
    resetStatus()
    setBusyAction("save")

    try {
      if (!window.desktop?.saveSessionTraceExport) {
        throw new Error("Trace export save is unavailable.")
      }

      const result = await window.desktop.saveSessionTraceExport({ sessionID })
      if (!result.canceled) {
        setStatusMessage("Trace JSON saved.")
      }
    } catch (error) {
      setErrorMessage(readErrorMessage(error))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleSaveDirectoryClick() {
    resetStatus()
    setBusyAction("saveDirectory")

    try {
      if (!window.desktop?.saveSessionTraceExportDirectory) {
        throw new Error("Split trace export save is unavailable.")
      }

      const result = await window.desktop.saveSessionTraceExportDirectory({ sessionID })
      if (!result.canceled) {
        await openSavedTraceFolder(result.path)
        setStatusMessage("Split trace folder saved.")
      }
    } catch (error) {
      setErrorMessage(readErrorMessage(error))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleSaveProjectClick() {
    resetStatus()
    setBusyAction("saveProject")

    try {
      if (!trimmedProjectDirectory) {
        throw new Error("Project directory is unavailable.")
      }
      if (!window.desktop?.saveSessionTraceExportToProject) {
        throw new Error("Project trace export save is unavailable.")
      }

      const result = await window.desktop.saveSessionTraceExportToProject({
        sessionID,
        directory: trimmedProjectDirectory,
        projectID,
      })
      if (!result.canceled) {
        await openSavedTraceFolder(result.path)
        setStatusMessage("Trace saved to project default.")
      }
    } catch (error) {
      setErrorMessage(readErrorMessage(error))
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <div className="canvas-top-menu-selector-anchor">
      <button
        ref={buttonRef}
        type="button"
        className={isMenuOpen ? "canvas-top-menu-button canvas-top-menu-trace-trigger is-active" : "canvas-top-menu-button canvas-top-menu-trace-trigger"}
        aria-controls="canvas-top-menu-trace-menu"
        aria-expanded={isMenuOpen}
        aria-haspopup="menu"
        aria-label="Export session trace"
        title="Export session trace"
        disabled={busyAction !== null}
        onClick={() => {
          resetStatus()
          setIsMenuOpen((current) => !current)
        }}
      >
        <DownloadIcon />
      </button>

      {isMenuOpen ? (
        <div
          ref={menuRef}
          id="canvas-top-menu-trace-menu"
          className="canvas-top-menu-selector-panel canvas-top-menu-action-selector-panel canvas-top-menu-context-panel canvas-top-menu-trace-panel"
          role="menu"
          aria-label="Session trace export"
        >
          <button
            className="canvas-top-menu-context-option canvas-top-menu-trace-option"
            disabled={busyAction !== null}
            onClick={() => void handleCopyClick()}
            role="menuitem"
            type="button"
          >
            <span className="canvas-top-menu-context-option-label">
              <CopyIcon />
              <strong>Copy trace JSON</strong>
            </span>
            <span className="canvas-top-menu-context-option-status">{busyAction === "copy" ? "Copying" : "Copy"}</span>
          </button>
          <button
            className="canvas-top-menu-context-option canvas-top-menu-trace-option"
            disabled={busyAction !== null}
            onClick={() => void handleSaveClick()}
            role="menuitem"
            type="button"
          >
            <span className="canvas-top-menu-context-option-label">
              <DownloadIcon />
              <strong>Save trace JSON</strong>
            </span>
            <span className="canvas-top-menu-context-option-status">{busyAction === "save" ? "Saving" : "Save"}</span>
          </button>
          <button
            className="canvas-top-menu-context-option canvas-top-menu-trace-option"
            disabled={busyAction !== null}
            onClick={() => void handleSaveDirectoryClick()}
            role="menuitem"
            type="button"
          >
            <span className="canvas-top-menu-context-option-label">
              <DownloadIcon />
              <strong>Save split trace folder</strong>
            </span>
            <span className="canvas-top-menu-context-option-status">{busyAction === "saveDirectory" ? "Saving" : "Folder"}</span>
          </button>
          <button
            className="canvas-top-menu-context-option canvas-top-menu-trace-option"
            disabled={busyAction !== null || !trimmedProjectDirectory}
            onClick={() => void handleSaveProjectClick()}
            role="menuitem"
            title={trimmedProjectDirectory ? "Save under the app data trace folder for this project" : "No project directory available"}
            type="button"
          >
            <span className="canvas-top-menu-context-option-label">
              <FolderIcon />
              <strong>Save to project default</strong>
            </span>
            <span className="canvas-top-menu-context-option-status">{busyAction === "saveProject" ? "Saving" : "Project"}</span>
          </button>
          {statusMessage ? <p className="canvas-top-menu-quick-status">{statusMessage}</p> : null}
          {errorMessage ? <p className="canvas-top-menu-quick-status is-error">{errorMessage}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

export function SessionCanvasTopMenu({
  activeSession,
  sessionTasks,
  gitProjectID,
  gitDirectory,
  showGitControls = true,
  isSavingToolPermissionMode,
  mcpOptions,
  pluginOptions,
  selectedMcpServerIDs,
  selectedMcpServerLabel,
  onMcpServerToggle,
  selectedPluginIDs,
  selectedPluginLabel,
  onPluginToggle,
  toolPermissionMode,
  toolPermissionModeError,
  onToolPermissionModeChange,
  onOpenReview,
  onOpenSubagentSession,
  skillOptions,
  selectedSkillIDs,
  selectedSkillLabel,
  onSkillToggle,
}: SessionCanvasTopMenuProps) {
  const readOnlySideChat = isSideChatSession(activeSession)
  const sessionTitle = activeSession?.title ?? ""

  return (
    <ShellTopMenu
      ariaLabel="Session canvas top menu"
      as="div"
      className="session-canvas-top-menu"
      contentClassName="panel-toolbar-copy session-canvas-top-menu-copy"
      content={sessionTitle || readOnlySideChat ? (
        <div className="session-canvas-top-menu-copy-main">
          {sessionTitle ? <span className="label" title={sessionTitle}>{sessionTitle}</span> : null}
          {readOnlySideChat ? (
            <div className="session-canvas-top-menu-copy-status">
              {readOnlySideChat ? <SideChatBadge /> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      controlsSpacerVariant="canvas"
      dragRegion
      trailing={(
        <>
          <ExternalEditorMenuButton directory={gitDirectory} />
          {activeSession ? (
            <SessionTraceExportMenuButton
              sessionID={activeSession.id}
              projectDirectory={gitDirectory}
              projectID={gitProjectID}
            />
          ) : null}
          {!readOnlySideChat ? (
            <>
              <ToolPermissionModeMenuButton
                error={toolPermissionModeError}
                isSaving={isSavingToolPermissionMode}
                mode={toolPermissionMode}
                onModeChange={onToolPermissionModeChange}
              />
              <ProjectPluginsMenuButton
                pluginOptions={pluginOptions}
                selectedPluginIDs={selectedPluginIDs}
                selectedPluginLabel={selectedPluginLabel}
                onPluginToggle={onPluginToggle}
              />
              <ProjectMcpMenuButton
                mcpOptions={mcpOptions}
                selectedMcpServerIDs={selectedMcpServerIDs}
                selectedMcpServerLabel={selectedMcpServerLabel}
                onMcpServerToggle={onMcpServerToggle}
              />
              <ProjectSkillsMenuButton
                skillOptions={skillOptions}
                selectedSkillIDs={selectedSkillIDs}
                selectedSkillLabel={selectedSkillLabel}
                onSkillToggle={onSkillToggle}
              />
              {showGitControls ? (
                <GitQuickMenuButton
                  projectID={gitProjectID}
                  directory={gitDirectory}
                  sessionID={activeSession?.id ?? null}
                  onOpenReview={onOpenReview}
                />
              ) : null}
            </>
          ) : null}
          {activeSession ? (
            <SessionInfoMenuButton
              sessionID={activeSession.id}
              tasks={sessionTasks}
              onOpenSubagentSession={onOpenSubagentSession}
            />
          ) : null}
        </>
      )}
      trailingClassName="session-canvas-top-menu-actions"
    />
  )
}
