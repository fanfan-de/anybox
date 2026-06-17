import { useEffect, useRef, useState, type CSSProperties, type Dispatch, type FocusEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type MutableRefObject, type ReactNode, type SetStateAction } from "react"
import { createPortal } from "react-dom"
import { sidebarActions } from "../constants"
import {
  ArchiveIcon,
  AutomationIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  DeleteIcon,
  FileTextIcon,
  ForkIcon,
  FolderIcon,
  FolderOpenIcon,
  NewItemIcon,
  PinIcon,
  ProviderSettingsIcon,
  SessionRunningIcon,
  SettingsIcon
} from "../icons"
import { useI18n } from "../i18n/I18nProvider"
import { PromptPresetsSidebarView, type PromptPresetsSidebarViewProps } from "../prompts/PromptPresetsPage"
import type { PromptSkillMode } from "../prompts/PromptSkillsPage"
import { joinClassNames, ShellTopMenu, SidebarToggleButton } from "../shared-ui"
import { GlobalSkillsNavigator, type GlobalSkillsNavigatorProps } from "../skills/GlobalSkillsPage"
import { BuiltinToolsSidebarView, type BuiltinToolsSidebarViewProps } from "../tools/BuiltinToolsPage"
import type {
  GlobalSkillTreeNode,
  LeftSidebarView,
  ProjectWorktreeCreateRequest,
  SessionSummary,
  SidebarActionKey,
  WorkspaceGroup
} from "../types"
import { isGitWorkspaceProject, isSideChatSession } from "../workspace"

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

function formatSessionCreatedAge(timestamp: number, now: number) {
  const age = Math.max(0, now - timestamp)
  if (age < MINUTE_MS) return "\u521a\u521a"
  if (age < HOUR_MS) return `${Math.max(1, Math.floor(age / MINUTE_MS))} \u5206`
  if (age < DAY_MS) return `${Math.max(1, Math.floor(age / HOUR_MS))} \u5c0f\u65f6`
  return `${Math.max(1, Math.floor(age / DAY_MS))} \u5929`
}

function formatSessionCreatedTitle(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp)
}

function useSessionTimeNow() {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const intervalID = window.setInterval(() => setNow(Date.now()), MINUTE_MS)
    return () => window.clearInterval(intervalID)
  }, [])

  return now
}

interface SidebarProps {
  activeSessionID: string | null
  activeView: LeftSidebarView
  deletingSessionID: string | null
  expandedFolderIDs: string[]
  globalSkillsNavigatorProps: GlobalSkillsNavigatorProps
  hoveredFolderID: string | null
  isCreatingProject: boolean
  isCreatingSession: boolean
  creatingWorktreeProjectID: string | null
  isSettingsOpen: boolean
  promptSkillMode: PromptSkillMode
  promptPresetsSidebarProps: PromptPresetsSidebarViewProps
  showSettingsButton?: boolean
  showSidebarToggleButton: boolean
  builtinToolsSidebarProps: BuiltinToolsSidebarViewProps
  projectRowRefs: MutableRefObject<Record<string, HTMLButtonElement | null>>
  conversationWorkspaceID: string | null
  protectedWorkspaceIDs: string[]
  runningSessionIDs: string[]
  selectedFolderID: string | null
  sessionCanvasUnreadBySession: Record<string, boolean>
  visibleCanvasSessionIDs: string[]
  workspaces: WorkspaceGroup[]
  pinnedWorkspaceIDs: string[]
  onHoveredFolderChange: Dispatch<SetStateAction<string | null>>
  onOpenSettings: () => void
  onOpenRemoteFolderConfig?: () => void
  onProjectArchiveSessions: (workspace: WorkspaceGroup) => void | Promise<void>
  onProjectClick: (workspace: WorkspaceGroup) => void
  onProjectCreateSession: (workspace: WorkspaceGroup, event: MouseEvent<HTMLButtonElement>) => void | Promise<void>
  onProjectCreateWorktree: (workspace: WorkspaceGroup, input: ProjectWorktreeCreateRequest) => boolean | void | Promise<boolean | void>
  onProjectOpenInExplorer: (workspace: WorkspaceGroup) => void | Promise<void>
  onProjectPin: (workspace: WorkspaceGroup) => void
  onProjectRemove: (workspace: WorkspaceGroup, event: MouseEvent<HTMLButtonElement>) => void
  onConversationClick: () => void | Promise<void>
  onSessionDelete: (workspace: WorkspaceGroup, session: SessionSummary, event: MouseEvent<HTMLButtonElement>) => void
  onSessionSelect: (workspaceID: string, sessionID: string) => void
  onSidebarAction: (action: SidebarActionKey) => void | Promise<void>
  onToggleSidebar: () => void
}

interface LeftSidebarTopMenuProps {
  activeView: LeftSidebarView
  isCreatingProject: boolean
  onOpenRemoteFolderConfig?: () => void
  showSidebarToggleButton: boolean
  onSidebarAction: (action: SidebarActionKey) => void | Promise<void>
  onToggleSidebar: () => void
}

function containsSkillTreePath(node: GlobalSkillTreeNode, targetPath: string | null): boolean {
  if (!targetPath) return false
  if (node.path === targetPath) return true
  if (node.kind !== "directory") return false

  return (node.children ?? []).some((child) => containsSkillTreePath(child, targetPath))
}

function LeftSidebarTopMenu({
  activeView,
  isCreatingProject,
  onOpenRemoteFolderConfig,
  showSidebarToggleButton,
  onSidebarAction,
  onToggleSidebar,
}: LeftSidebarTopMenuProps) {
  return (
    <ShellTopMenu
      as="header"
      ariaLabel="Left sidebar top menu"
      className="left-sidebar-top-menu"
      contentClassName="left-sidebar-top-menu-content"
      content={(
        activeView === "workspace" ? (
          <div className="panel-toolbar-actions left-sidebar-top-menu-buttons" aria-label="Workspace view actions">
            {sidebarActions.map((action) => (
              <button
                key={action.key}
                className="sidebar-action"
                aria-label={action.label}
                title={action.label}
                disabled={isCreatingProject}
                type="button"
                onClick={() => void onSidebarAction(action.key)}
              >
                <FolderIcon />
              </button>
            ))}
            {onOpenRemoteFolderConfig ? (
              <button
                className="sidebar-action"
                aria-label="Open remote folder"
                title="Open remote folder"
                type="button"
                onClick={() => onOpenRemoteFolderConfig()}
              >
                <ProviderSettingsIcon />
              </button>
            ) : null}
          </div>
        ) : null
      )}
      dragRegion
      trailing={showSidebarToggleButton ? (
        <SidebarToggleButton isSidebarCollapsed={false} onToggleSidebar={onToggleSidebar} side="left" variant="top-menu" />
      ) : null}
      trailingClassName="left-sidebar-top-menu-trailing"
    />
  )
}

interface FolderWorkspaceViewProps {
  activeSessionID: string | null
  deletingSessionID: string | null
  expandedFolderIDs: string[]
  hoveredFolderID: string | null
  isCreatingSession: boolean
  creatingWorktreeProjectID: string | null
  projectRowRefs: MutableRefObject<Record<string, HTMLButtonElement | null>>
  conversationWorkspaceID: string | null
  protectedWorkspaceIDs: string[]
  runningSessionIDs: string[]
  selectedFolderID: string | null
  sessionCanvasUnreadBySession: Record<string, boolean>
  visibleCanvasSessionIDs: string[]
  workspaces: WorkspaceGroup[]
  pinnedWorkspaceIDs: string[]
  onHoveredFolderChange: Dispatch<SetStateAction<string | null>>
  onProjectArchiveSessions: (workspace: WorkspaceGroup) => void | Promise<void>
  onProjectClick: (workspace: WorkspaceGroup) => void
  onProjectCreateSession: (workspace: WorkspaceGroup, event: MouseEvent<HTMLButtonElement>) => void | Promise<void>
  onProjectCreateWorktree: (workspace: WorkspaceGroup, input: ProjectWorktreeCreateRequest) => boolean | void | Promise<boolean | void>
  onProjectOpenInExplorer: (workspace: WorkspaceGroup) => void | Promise<void>
  onProjectPin: (workspace: WorkspaceGroup) => void
  onProjectRemove: (workspace: WorkspaceGroup, event: MouseEvent<HTMLButtonElement>) => void
  onConversationClick: () => void | Promise<void>
  onSessionDelete: (workspace: WorkspaceGroup, session: SessionSummary, event: MouseEvent<HTMLButtonElement>) => void
  onSessionSelect: (workspaceID: string, sessionID: string) => void
}

type ProjectContextMenuState = {
  workspace: WorkspaceGroup
  x: number
  y: number
} | null

function getWorkspaceBaseName(workspace: WorkspaceGroup) {
  const root = workspace.project.repositoryRoot ?? workspace.project.worktree ?? workspace.directory
  const trimmed = root.replace(/[\\/]+$/, "")
  return trimmed.split(/[\\/]/).filter(Boolean).pop() || "worktree"
}

function normalizeSidebarWorkspacePath(value: string) {
  const trimmed = value.trim().replace(/\\/g, "/").replace(/\/+$/, "")
  if (!trimmed) return ""
  if (trimmed.includes("://")) return trimmed

  const normalized = trimmed.replace(/\/+/g, "/")
  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized
}

function sameSidebarWorkspacePath(left: string, right: string) {
  return normalizeSidebarWorkspacePath(left) === normalizeSidebarWorkspacePath(right)
}

function sidebarWorkspacePathContains(root: string, candidate: string) {
  const normalizedRoot = normalizeSidebarWorkspacePath(root)
  const normalizedCandidate = normalizeSidebarWorkspacePath(candidate)
  if (!normalizedRoot || !normalizedCandidate) return false
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`)
}

function getLinkedWorktreeRoot(workspace: WorkspaceGroup) {
  if (!isGitWorkspaceProject(workspace)) return null

  const primaryRoots = [workspace.project.worktree, workspace.project.repositoryRoot]
    .filter((root): root is string => Boolean(root?.trim()))
  const workspaceRoots = workspace.project.workspaceRoots ?? []
  const linkedRoot = workspaceRoots.find((root) => (
    !primaryRoots.some((primaryRoot) => sameSidebarWorkspacePath(root, primaryRoot)) &&
    sidebarWorkspacePathContains(root, workspace.directory)
  ))
  if (linkedRoot) return linkedRoot

  if (workspaceRoots.length > 0 || primaryRoots.length === 0) return null
  return primaryRoots.some((primaryRoot) => sidebarWorkspacePathContains(primaryRoot, workspace.directory))
    ? null
    : workspace.directory
}

function normalizeDefaultBranchName(value: string) {
  return value
    .trim()
    .replace(/[\s~^:?*\[\\\x00-\x1f\x7f]+/g, "-")
    .replace(/\.\.+/g, ".")
    .replace(/\/+/g, "/")
    .replace(/@{/g, "-")
    .replace(/(^[./-]+|[./-]+$)/g, "")
    || "worktree"
}

function createWorktreeBranchName(workspace: WorkspaceGroup, workspaces: WorkspaceGroup[]) {
  const projectWorkspaceCount = workspaces.filter((item) => item.project.id === workspace.project.id).length
  return `${normalizeDefaultBranchName(getWorkspaceBaseName(workspace))}-${Math.max(1, projectWorkspaceCount + 1)}`
}

const PROJECT_CONTEXT_MENU_WIDTH = 240
const PROJECT_CONTEXT_MENU_HEIGHT = 188

interface WorkspaceSessionTreeNode {
  children: WorkspaceSessionTreeNode[]
  session: SessionSummary
}

function buildWorkspaceSessionTree(sessions: SessionSummary[]): WorkspaceSessionTreeNode[] {
  const primarySessions = sessions.filter((session) => !isSideChatSession(session) && !session.subagent)
  const sessionsByID = new Map(primarySessions.map((session) => [session.id, session]))
  const childrenByParentID = new Map<string, SessionSummary[]>()
  const attachedChildIDs = new Set<string>()

  for (const session of primarySessions) {
    const parentSessionID = session.subagent?.parentSessionID
    if (!parentSessionID || parentSessionID === session.id || !sessionsByID.has(parentSessionID)) continue

    const children = childrenByParentID.get(parentSessionID) ?? []
    children.push(session)
    childrenByParentID.set(parentSessionID, children)
    attachedChildIDs.add(session.id)
  }

  const renderedSessionIDs = new Set<string>()

  function materialize(session: SessionSummary, ancestorIDs: Set<string>): WorkspaceSessionTreeNode {
    renderedSessionIDs.add(session.id)
    const nextAncestorIDs = new Set(ancestorIDs)
    nextAncestorIDs.add(session.id)

    return {
      session,
      children: (childrenByParentID.get(session.id) ?? [])
        .filter((child) => !nextAncestorIDs.has(child.id))
        .map((child) => materialize(child, nextAncestorIDs)),
    }
  }

  const roots = primarySessions.filter((session) => !attachedChildIDs.has(session.id))
  const tree = roots.map((session) => materialize(session, new Set()))

  for (const session of primarySessions) {
    if (!renderedSessionIDs.has(session.id)) {
      tree.push(materialize(session, new Set()))
    }
  }

  return tree
}

function clampProjectContextMenuPosition(x: number, y: number) {
  const margin = 8
  if (typeof window === "undefined") {
    return { x, y }
  }

  return {
    x: Math.max(margin, Math.min(x, window.innerWidth - PROJECT_CONTEXT_MENU_WIDTH - margin)),
    y: Math.max(margin, Math.min(y, window.innerHeight - PROJECT_CONTEXT_MENU_HEIGHT - margin)),
  }
}

interface ProjectContextMenuProps {
  deletingSessionID: string | null
  creatingWorktreeProjectID: string | null
  menu: ProjectContextMenuState
  pinnedWorkspaceIDs: string[]
  protectedWorkspaceIDs: string[]
  onClose: () => void
  onProjectArchiveSessions: (workspace: WorkspaceGroup) => void | Promise<void>
  onProjectCreateWorktree: (workspace: WorkspaceGroup) => void | Promise<void>
  onProjectOpenInExplorer: (workspace: WorkspaceGroup) => void | Promise<void>
  onProjectPin: (workspace: WorkspaceGroup) => void
  onProjectRemove: (workspace: WorkspaceGroup, event: MouseEvent<HTMLButtonElement>) => void
}

function ProjectContextMenu({
  deletingSessionID,
  creatingWorktreeProjectID,
  menu,
  pinnedWorkspaceIDs,
  protectedWorkspaceIDs,
  onClose,
  onProjectArchiveSessions,
  onProjectCreateWorktree,
  onProjectOpenInExplorer,
  onProjectPin,
  onProjectRemove,
}: ProjectContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menu) return

    function handlePointerDown(event: globalThis.PointerEvent) {
      const target = event.target as Node | null
      if (!target) return
      if (menuRef.current?.contains(target)) return
      onClose()
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        onClose()
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    window.addEventListener("resize", onClose)
    window.addEventListener("scroll", onClose, true)

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("resize", onClose)
      window.removeEventListener("scroll", onClose, true)
    }
  }, [menu, onClose])

  if (!menu) return null

  const { workspace } = menu
  const position = clampProjectContextMenuPosition(menu.x, menu.y)
  const isMissingWorkspace = workspace.exists === false
  const hasArchivableSessions = workspace.sessions.some((session) => !isSideChatSession(session)) || workspace.sessions.length > 0
  const isArchiveDisabled = deletingSessionID !== null || !hasArchivableSessions
  const isProtectedWorkspace = protectedWorkspaceIDs.includes(workspace.id)
  const isPinnedFirst = isProtectedWorkspace || pinnedWorkspaceIDs[0] === workspace.id
  const isGitProject = isGitWorkspaceProject(workspace)
  const isCreatingWorktree = creatingWorktreeProjectID === workspace.project.id

  return createPortal(
    <div
      ref={menuRef}
      className="ui-context-menu project-context-menu"
      role="menu"
      aria-label={`${workspace.name} actions`}
      style={{ left: position.x, top: position.y }}
    >
      <button
        className="ui-context-menu__item"
        role="menuitem"
        type="button"
        disabled={isPinnedFirst}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
          onProjectPin(workspace)
        }}
      >
        <span className="ui-context-menu__icon" aria-hidden="true"><PinIcon /></span>
        <span className="ui-context-menu__label">{isPinnedFirst ? "已置顶" : "置顶项目"}</span>
      </button>
      <button
        className="ui-context-menu__item"
        role="menuitem"
        type="button"
        disabled={isMissingWorkspace}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
          void onProjectOpenInExplorer(workspace)
        }}
      >
        <span className="ui-context-menu__icon" aria-hidden="true"><FolderOpenIcon /></span>
        <span className="ui-context-menu__label">在资源管理器中打开</span>
      </button>
      {isGitProject ? (
        <button
          className="ui-context-menu__item"
          role="menuitem"
          type="button"
          disabled={isMissingWorkspace || isCreatingWorktree}
          onClick={(event) => {
            event.stopPropagation()
            onClose()
            void onProjectCreateWorktree(workspace)
          }}
        >
          <span className="ui-context-menu__icon" aria-hidden="true"><ForkIcon /></span>
          <span className="ui-context-menu__label">{isCreatingWorktree ? "正在创建工作树" : "创建工作树"}</span>
        </button>
      ) : null}
      <button
        className="ui-context-menu__item"
        role="menuitem"
        type="button"
        disabled={isArchiveDisabled}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
          void onProjectArchiveSessions(workspace)
        }}
      >
        <span className="ui-context-menu__icon" aria-hidden="true"><ArchiveIcon /></span>
        <span className="ui-context-menu__label">归档所有对话</span>
      </button>
      {!isProtectedWorkspace ? (
        <>
          <div className="ui-context-menu__divider" role="separator" />
          <button
            className="ui-context-menu__item"
            role="menuitem"
            type="button"
            data-variant="danger"
            onClick={(event) => {
              onClose()
              onProjectRemove(workspace, event)
            }}
          >
            <span className="ui-context-menu__icon" aria-hidden="true"><DeleteIcon /></span>
        <span className="ui-context-menu__label">移除</span>
          </button>
        </>
      ) : null}
    </div>,
    document.body,
  )
}

interface ProjectWorktreeCreateDialogProps {
  defaultName: string
  isCreating: boolean
  workspace: WorkspaceGroup
  onClose: () => void
  onCreate: (workspace: WorkspaceGroup, input: ProjectWorktreeCreateRequest) => boolean | void | Promise<boolean | void>
}

function ProjectWorktreeCreateDialog({
  defaultName,
  isCreating,
  workspace,
  onClose,
  onCreate,
}: ProjectWorktreeCreateDialogProps) {
  const [draftName, setDraftName] = useState(defaultName)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const isSubmittingRef = useRef(false)
  const branchName = draftName.trim()
  const isBusy = isCreating || isSubmitting
  const canSubmit = Boolean(branchName) && !isBusy

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmittingRef.current) return
    if (!canSubmit) {
      setErrorMessage("请输入有效的分支名称。")
      return
    }

    setErrorMessage(null)
    isSubmittingRef.current = true
    setIsSubmitting(true)
    try {
      const result = await onCreate(workspace, {
        name: branchName,
        branchName,
      })
      if (result !== false) {
        onClose()
      } else {
        isSubmittingRef.current = false
        setIsSubmitting(false)
      }
    } catch (error) {
      isSubmittingRef.current = false
      setIsSubmitting(false)
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  return createPortal(
    <div
      className="project-worktree-create-overlay"
      role="presentation"
    >
      <form
        className="project-worktree-create-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-worktree-create-title"
        onSubmit={handleSubmit}
      >
        <header className="project-worktree-create-header">
          <div>
            <h2 id="project-worktree-create-title">创建工作树并切换分支</h2>
            <p>创建新的 Git 工作树并检出这个分支；分支不存在时会从 HEAD 创建，文件夹名将沿用原项目文件夹名</p>
          </div>
          <button
            className="project-worktree-create-close"
            type="button"
            aria-label="关闭"
            title="关闭"
            disabled={isBusy}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <input
          ref={inputRef}
          className="project-worktree-create-input"
          type="text"
          aria-label="分支名称"
          value={draftName}
          disabled={isBusy}
          onChange={(event) => {
            setDraftName(event.target.value)
            setErrorMessage(null)
          }}
        />

        {errorMessage ? (
          <p className="project-worktree-create-error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <footer className="project-worktree-create-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={isBusy}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="primary-button"
            type="submit"
            disabled={!canSubmit}
          >
            {isBusy ? "创建中" : "创建"}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  )
}

function FolderWorkspaceView({
  activeSessionID,
  deletingSessionID,
  expandedFolderIDs,
  hoveredFolderID,
  isCreatingSession,
  creatingWorktreeProjectID,
  projectRowRefs,
  conversationWorkspaceID,
  protectedWorkspaceIDs,
  runningSessionIDs,
  selectedFolderID,
  sessionCanvasUnreadBySession,
  visibleCanvasSessionIDs,
  workspaces,
  pinnedWorkspaceIDs,
  onHoveredFolderChange,
  onProjectArchiveSessions,
  onProjectClick,
  onProjectCreateSession,
  onProjectCreateWorktree,
  onProjectOpenInExplorer,
  onProjectPin,
  onProjectRemove,
  onConversationClick,
  onSessionDelete,
  onSessionSelect,
}: FolderWorkspaceViewProps) {
  const runningSessionIDSet = new Set(runningSessionIDs)
  const visibleSessionIDSet = new Set(visibleCanvasSessionIDs)
  const [projectContextMenu, setProjectContextMenu] = useState<ProjectContextMenuState>(null)
  const [worktreeCreateWorkspace, setWorktreeCreateWorkspace] = useState<WorkspaceGroup | null>(null)
  const sessionTimeNow = useSessionTimeNow()

  function closeProjectContextMenu() {
    setProjectContextMenu(null)
  }

  function openWorktreeCreateDialog(workspace: WorkspaceGroup) {
    closeProjectContextMenu()
    setWorktreeCreateWorkspace(workspace)
  }

  function renderSessionNode(workspace: WorkspaceGroup, node: WorkspaceSessionTreeNode, depth = 0): ReactNode {
    const { session } = node
    const active = session.id === activeSessionID
    const isRunning = runningSessionIDSet.has(session.id)
    const hasUnreadCanvas =
      Boolean(sessionCanvasUnreadBySession[session.id]) && !visibleSessionIDSet.has(session.id)
    const sessionCreatedAt = session.created ?? session.updated
    const isSubagent = depth > 0
    const shellStyle: CSSProperties | undefined = isSubagent
      ? { paddingLeft: `${Math.min(depth, 4) * 18}px` }
      : undefined

    return (
      <div key={session.id} className="session-tree-node">
        <div
          className={joinClassNames("session-row-shell", isSubagent && "is-subagent")}
          style={shellStyle}
        >
          <button
            className={joinClassNames("session-row", active && "is-active", isSubagent && "is-subagent")}
            onClick={() => onSessionSelect(workspace.id, session.id)}
          >
            <span className="session-row-copy">
              <span className="session-row-label">{session.title}</span>
            </span>
            {isRunning || hasUnreadCanvas || session.automation ? (
              <span className="session-row-icons">
                {isRunning || hasUnreadCanvas ? (
                  <span
                    className={isRunning ? "session-row-status-icon is-running" : "session-row-status-icon is-unread"}
                    aria-hidden="true"
                  >
                    {isRunning ? (
                      <SessionRunningIcon />
                    ) : (
                      <span className="session-row-status-dot" />
                    )}
                  </span>
                ) : null}
                {session.automation ? (
                  <span
                    className="session-row-source-badge is-automation"
                    title={`Automation: ${session.automation.name}`}
                    aria-label={`Automation: ${session.automation.name}`}
                  >
                    <AutomationIcon />
                  </span>
                ) : null}
              </span>
            ) : null}
          </button>
          <span className="session-row-trailing">
            <time
              className="session-row-created-at"
              dateTime={new Date(sessionCreatedAt).toISOString()}
              title={formatSessionCreatedTitle(sessionCreatedAt)}
            >
              {formatSessionCreatedAge(sessionCreatedAt, sessionTimeNow)}
            </time>
            <button
              className="row-action"
              aria-label={`Archive session ${session.title}`}
              title={`Archive session ${session.title}`}
              disabled={deletingSessionID === session.id}
              onClick={(event) => onSessionDelete(workspace, session, event)}
            >
              <ArchiveIcon />
            </button>
          </span>
        </div>

        {node.children.length > 0 ? (
          <div className="session-tree-children">
            {node.children.map((child) => renderSessionNode(workspace, child, depth + 1))}
          </div>
        ) : null}
      </div>
    )
  }

  const conversationWorkspace = conversationWorkspaceID
    ? workspaces.find((workspace) => workspace.id === conversationWorkspaceID) ?? null
    : null
  const orderedWorkspaces = conversationWorkspace
    ? [conversationWorkspace, ...workspaces.filter((workspace) => workspace.id !== conversationWorkspace.id)]
    : workspaces

  return (
    <section className="sidebar-view sidebar-view-workspace" aria-label="Workspace sidebar view">
      <div className="sidebar-projects">
        {!conversationWorkspace ? (
          <section className="project-block conversation-entry-block">
            <div className="project-row-shell conversation-entry-shell">
              <button
                className={joinClassNames(
                  "project-row",
                  "conversation-entry-row",
                  conversationWorkspaceID && selectedFolderID === conversationWorkspaceID ? "is-active" : "",
                )}
                aria-label={"\u5bf9\u8bdd"}
                type="button"
                onClick={() => void onConversationClick()}
              >
                <span className="project-row-leading" aria-hidden="true">
                  <FolderIcon />
                </span>
                <span className="project-row-text">
                  <span className="project-row-label">{"\u5bf9\u8bdd"}</span>
                  <span className="project-row-meta" title={"\u65e0\u9700\u9009\u62e9\u9879\u76ee\u6587\u4ef6\u5939\u4e5f\u53ef\u4ee5\u4f7f\u7528 Agent \u5bf9\u8bdd"}>
                    <span className="project-row-meta-label">{"\u9ed8\u8ba4 Agent \u5bf9\u8bdd"}</span>
                  </span>
                </span>
              </button>
            </div>
          </section>
        ) : null}
        {orderedWorkspaces.map((workspace) => {
          const isConversationWorkspace = workspace.id === conversationWorkspaceID
          const isActiveWorkspace = workspace.id === selectedFolderID
          const isExpanded = expandedFolderIDs.includes(workspace.id)
          const isMissingWorkspace = workspace.exists === false
          const showStateIcon = workspace.id === hoveredFolderID
          const leadingIcon = showStateIcon ? (isExpanded ? "expanded" : "collapsed") : "folder"
          const linkedWorktreeRoot = getLinkedWorktreeRoot(workspace)
          const workspaceLabel = isConversationWorkspace ? "\u5bf9\u8bdd" : workspace.name
          const workspaceMeta = isConversationWorkspace
            ? workspace.directory
            : workspace.project.repositoryRoot ?? workspace.project.worktree
          const createSessionLabel = `Create session for ${workspaceLabel}`
          const createSessionTitle = isMissingWorkspace
            ? `${workspaceLabel} has been deleted and cannot create new sessions.`
            : createSessionLabel

          function handleProjectBlur(event: FocusEvent<HTMLDivElement>) {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
            onHoveredFolderChange((current) => (current === workspace.id ? null : current))
          }

          function handleProjectContextMenu(event: MouseEvent<HTMLDivElement>) {
            const target = event.target
            if (target instanceof HTMLElement) {
              const editable = target.closest("input, textarea, [contenteditable='true'], webview")
              if (editable) return
            }

            event.preventDefault()
            event.stopPropagation()
            onHoveredFolderChange(workspace.id)
            setProjectContextMenu({
              workspace,
              x: event.clientX,
              y: event.clientY,
            })
          }

          return (
            <section
              key={workspace.id}
              className={joinClassNames("project-block", isConversationWorkspace ? "conversation-entry-block" : "")}
            >
              <div
                className="project-row-shell"
                onMouseEnter={() => onHoveredFolderChange(workspace.id)}
                onMouseLeave={() => onHoveredFolderChange((current) => (current === workspace.id ? null : current))}
                onFocus={() => onHoveredFolderChange(workspace.id)}
                onBlur={handleProjectBlur}
                onContextMenu={handleProjectContextMenu}
              >
                <button
                  ref={(node) => {
                    projectRowRefs.current[workspace.id] = node
                  }}
                  className={joinClassNames(
                    "project-row",
                    isConversationWorkspace ? "conversation-entry-row" : "",
                    isActiveWorkspace ? "is-active" : "",
                    linkedWorktreeRoot ? "is-linked-worktree" : "",
                  )}
                  aria-label={workspaceLabel}
                  aria-expanded={isExpanded}
                  data-folder-id={workspace.id}
                  onClick={() => onProjectClick(workspace)}
                >
                  <span
                    className="project-row-leading"
                    data-icon={leadingIcon}
                    data-testid={`project-leading-${workspace.id}`}
                    aria-hidden="true"
                  >
                    {showStateIcon ? (
                      isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />
                    ) : (
                      <FolderIcon />
                    )}
                  </span>
                  <span className="project-row-text">
                    <span className="project-row-label">{workspaceLabel}</span>
                    {linkedWorktreeRoot ? (
                      <span
                        className="project-row-worktree-icon"
                        title={`Linked worktree: ${linkedWorktreeRoot}`}
                        data-testid={`project-linked-worktree-${workspace.id}`}
                        aria-hidden="true"
                      >
                        <ForkIcon />
                      </span>
                    ) : null}
                    <span className="project-row-meta" title={workspaceMeta}>
                      <span className="project-row-meta-label">{workspaceMeta}</span>
                      {isMissingWorkspace ? (
                        <span className="project-row-status is-missing">{"\u5df2\u5220\u9664"}</span>
                      ) : null}
                    </span>
                  </span>
                </button>
                <div className="project-row-actions" aria-label={`${workspaceLabel} actions`}>
                  <button
                    className="row-action project-row-action"
                    aria-label={createSessionLabel}
                    title={createSessionTitle}
                    disabled={isCreatingSession || isMissingWorkspace}
                    onClick={(event) => void onProjectCreateSession(workspace, event)}
                  >
                    <NewItemIcon />
                  </button>
                </div>
              </div>

              {isExpanded ? (
                <div className="session-tree">
                  {buildWorkspaceSessionTree(workspace.sessions).map((node) => renderSessionNode(workspace, node))}
                </div>
              ) : null}
            </section>
          )
        })}
      </div>
      <ProjectContextMenu
        deletingSessionID={deletingSessionID}
        creatingWorktreeProjectID={creatingWorktreeProjectID}
        menu={projectContextMenu}
        pinnedWorkspaceIDs={pinnedWorkspaceIDs}
        protectedWorkspaceIDs={protectedWorkspaceIDs}
        onClose={closeProjectContextMenu}
        onProjectArchiveSessions={onProjectArchiveSessions}
        onProjectCreateWorktree={openWorktreeCreateDialog}
        onProjectOpenInExplorer={onProjectOpenInExplorer}
        onProjectPin={onProjectPin}
        onProjectRemove={onProjectRemove}
      />
      {worktreeCreateWorkspace ? (
        <ProjectWorktreeCreateDialog
          defaultName={createWorktreeBranchName(worktreeCreateWorkspace, workspaces)}
          isCreating={creatingWorktreeProjectID === worktreeCreateWorkspace.project.id}
          workspace={worktreeCreateWorkspace}
          onClose={() => setWorktreeCreateWorkspace(null)}
          onCreate={onProjectCreateWorktree}
        />
      ) : null}
    </section>
  )
}

function SkillsTreeNodeRow({
  deletingGlobalSkillDirectory,
  depth = 0,
  expandedSkillPaths,
  node,
  renamingGlobalSkillDirectory,
  renamingGlobalSkillDraftDirectory,
  renamingGlobalSkillName,
  selectedGlobalSkillFilePath,
  onDeleteGlobalSkill,
  onDirectoryToggle,
  onFileSelect,
  onRenameGlobalSkill,
  onRenameGlobalSkillDraftCancel,
  onRenameGlobalSkillDraftChange,
  onRenameGlobalSkillDraftStart,
}: {
  deletingGlobalSkillDirectory: string | null
  depth?: number
  expandedSkillPaths: string[]
  node: GlobalSkillTreeNode
  renamingGlobalSkillDirectory: string | null
  renamingGlobalSkillDraftDirectory: string | null
  renamingGlobalSkillName: string
  selectedGlobalSkillFilePath: string | null
  onDeleteGlobalSkill: (directoryPath?: string) => void | Promise<void>
  onDirectoryToggle: (path: string) => void
  onFileSelect: (path: string) => void | Promise<void>
  onRenameGlobalSkill: () => void | Promise<void>
  onRenameGlobalSkillDraftCancel: () => void
  onRenameGlobalSkillDraftChange: (value: string) => void
  onRenameGlobalSkillDraftStart: (directoryPath: string) => void
}) {
  const isReadOnlyNode = Boolean(node.readOnly)
  const showPluginBadge = node.scope === "plugin" && node.path.startsWith("plugin-skills://")

  if (node.kind === "file") {
    const isActive = node.path === selectedGlobalSkillFilePath

    return (
      <div className="skill-tree-item skill-tree-item-file">
        <button
          className={[
            "skill-tree-row",
            isActive ? "is-active" : "",
            isReadOnlyNode ? "is-read-only" : "",
          ].filter(Boolean).join(" ")}
          title={node.path}
          type="button"
          onClick={() => void onFileSelect(node.path)}
        >
          <span className="skill-tree-leading" aria-hidden="true">
            <FileTextIcon />
          </span>
          <span className="skill-tree-label">{node.name}</span>
          {showPluginBadge ? <span className="skill-tree-source-badge">Plugin</span> : null}
        </button>
      </div>
    )
  }

  const isExpanded = expandedSkillPaths.includes(node.path)
  const isActiveDirectory = containsSkillTreePath(node, selectedGlobalSkillFilePath)
  const showDeleteAction = depth === 0 && !isReadOnlyNode
  const isRenameDraftVisible = !isReadOnlyNode && depth === 0 && renamingGlobalSkillDraftDirectory === node.path
  const isRenamePending = renamingGlobalSkillDirectory === node.path

  function handleRenameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void onRenameGlobalSkill()
  }

  function handleRenameInputBlur(event: FocusEvent<HTMLInputElement>) {
    if (event.currentTarget.form?.contains(event.relatedTarget as Node | null)) return
    onRenameGlobalSkillDraftCancel()
  }

  function handleRenameInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault()
      void onRenameGlobalSkill()
      return
    }

    if (event.key !== "Escape") return
    event.preventDefault()
    onRenameGlobalSkillDraftCancel()
  }

  return (
    <div className="skill-tree-item">
      <div className="skill-tree-row-shell">
        {isRenameDraftVisible ? (
          <form className="skill-tree-rename-form" aria-label={`Rename skill ${node.name}`} onSubmit={handleRenameSubmit}>
            <span className="skill-tree-leading" aria-hidden="true">
              {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
            </span>
            <input
              autoFocus
              className="skill-tree-rename-input"
              aria-label={`Rename global skill ${node.name}`}
              disabled={isRenamePending}
              type="text"
              value={renamingGlobalSkillName}
              onBlur={handleRenameInputBlur}
              onChange={(event) => onRenameGlobalSkillDraftChange(event.target.value)}
              onKeyDown={handleRenameInputKeyDown}
            />
          </form>
        ) : (
          <button
            className={[
              "skill-tree-row",
              isActiveDirectory ? "is-active" : "",
              isReadOnlyNode ? "is-read-only" : "",
            ].filter(Boolean).join(" ")}
            aria-expanded={isExpanded}
            title={node.path}
            type="button"
            onClick={() => onDirectoryToggle(node.path)}
          >
            <span className="skill-tree-leading" aria-hidden="true">
              {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
            </span>
            <span className="skill-tree-label">{node.name}</span>
            {showPluginBadge ? <span className="skill-tree-source-badge">Plugin</span> : null}
          </button>
        )}
        {showDeleteAction ? (
          <button
            className="row-action skill-tree-row-action"
            aria-label={`Delete skill ${node.name}`}
            disabled={deletingGlobalSkillDirectory === node.path || isRenameDraftVisible || isRenamePending}
            title={`Delete skill ${node.name}`}
            type="button"
            onClick={() => void onDeleteGlobalSkill(node.path)}
          >
            <DeleteIcon />
          </button>
        ) : null}
      </div>

      {isExpanded && node.children?.length ? (
        <div className="skill-tree-children">
          {node.children.map((child) => (
            <SkillsTreeNodeRow
              key={child.path}
              deletingGlobalSkillDirectory={deletingGlobalSkillDirectory}
              depth={depth + 1}
              expandedSkillPaths={expandedSkillPaths}
              node={child}
              renamingGlobalSkillDirectory={renamingGlobalSkillDirectory}
              renamingGlobalSkillDraftDirectory={renamingGlobalSkillDraftDirectory}
              renamingGlobalSkillName={renamingGlobalSkillName}
              selectedGlobalSkillFilePath={selectedGlobalSkillFilePath}
              onDeleteGlobalSkill={onDeleteGlobalSkill}
              onDirectoryToggle={onDirectoryToggle}
              onFileSelect={onFileSelect}
              onRenameGlobalSkill={onRenameGlobalSkill}
              onRenameGlobalSkillDraftCancel={onRenameGlobalSkillDraftCancel}
              onRenameGlobalSkillDraftChange={onRenameGlobalSkillDraftChange}
              onRenameGlobalSkillDraftStart={onRenameGlobalSkillDraftStart}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

interface SkillsSidebarViewProps {
  deletingGlobalSkillDirectory: string | null
  expandedSkillPaths: string[]
  creatingGlobalSkillName: string
  globalSkillsRoot: string
  globalSkillsTree: GlobalSkillTreeNode[]
  isCreateGlobalSkillDraftVisible: boolean
  isCreatingGlobalSkill: boolean
  isLoadingSkillsTree: boolean
  renamingGlobalSkillDirectory: string | null
  renamingGlobalSkillDraftDirectory: string | null
  renamingGlobalSkillName: string
  selectedGlobalSkillFilePath: string | null
  onCreateGlobalSkill: () => void | Promise<void>
  onCreateGlobalSkillDraftCancel: () => void
  onCreateGlobalSkillDraftChange: (value: string) => void
  onCreateGlobalSkillDraftStart: () => void
  onDeleteGlobalSkill: (directoryPath?: string) => void | Promise<void>
  onGlobalSkillDirectoryToggle: (path: string) => void
  onGlobalSkillFileSelect: (path: string) => void | Promise<void>
  onRenameGlobalSkill: () => void | Promise<void>
  onRenameGlobalSkillDraftCancel: () => void
  onRenameGlobalSkillDraftChange: (value: string) => void
  onRenameGlobalSkillDraftStart: (directoryPath: string) => void
}

export function SkillsSidebarView({
  deletingGlobalSkillDirectory,
  expandedSkillPaths,
  creatingGlobalSkillName,
  globalSkillsRoot,
  globalSkillsTree,
  isCreateGlobalSkillDraftVisible,
  isCreatingGlobalSkill,
  isLoadingSkillsTree,
  renamingGlobalSkillDirectory,
  renamingGlobalSkillDraftDirectory,
  renamingGlobalSkillName,
  selectedGlobalSkillFilePath,
  onCreateGlobalSkill,
  onCreateGlobalSkillDraftCancel,
  onCreateGlobalSkillDraftChange,
  onCreateGlobalSkillDraftStart,
  onDeleteGlobalSkill,
  onGlobalSkillDirectoryToggle,
  onGlobalSkillFileSelect,
  onRenameGlobalSkill,
  onRenameGlobalSkillDraftCancel,
  onRenameGlobalSkillDraftChange,
  onRenameGlobalSkillDraftStart,
}: SkillsSidebarViewProps) {
  function handleCreateSkillSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void onCreateGlobalSkill()
  }

  function handleCreateSkillKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Escape") return
    event.preventDefault()
    onCreateGlobalSkillDraftCancel()
  }

  return (
    <section className="sidebar-view sidebar-view-skills" aria-label="Skills sidebar view">
      <div className="sidebar-actions view-toolbar" aria-label="Skills view actions">
        <div className="panel-toolbar-copy sidebar-path-copy">
          <span className="label">Global</span>
          <strong>Skills</strong>
          <small title={globalSkillsRoot}>{globalSkillsRoot || "Loading global skills root..."}</small>
        </div>
        <div className="panel-toolbar-actions sidebar-actions-buttons">
          <button
            className="sidebar-action"
            aria-label="Create global skill"
            disabled={isCreatingGlobalSkill || isCreateGlobalSkillDraftVisible || Boolean(renamingGlobalSkillDraftDirectory || renamingGlobalSkillDirectory)}
            title="Create global skill"
            type="button"
            onClick={onCreateGlobalSkillDraftStart}
          >
            <NewItemIcon />
          </button>
        </div>
      </div>

      {isCreateGlobalSkillDraftVisible ? (
        <form className="skills-create-form" aria-label="Create global skill form" onSubmit={handleCreateSkillSubmit}>
          <input
            autoFocus
            className="skills-create-input"
            aria-label="New global skill name"
            disabled={isCreatingGlobalSkill}
            placeholder="new-skill"
            type="text"
            value={creatingGlobalSkillName}
            onChange={(event) => onCreateGlobalSkillDraftChange(event.target.value)}
            onKeyDown={handleCreateSkillKeyDown}
          />
          <div className="skills-create-actions">
            <button disabled={isCreatingGlobalSkill} type="submit">
              Create
            </button>
            <button disabled={isCreatingGlobalSkill} type="button" onClick={onCreateGlobalSkillDraftCancel}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <div className="skills-tree-root">
        {isLoadingSkillsTree && globalSkillsTree.length === 0 ? (
          <p className="skills-tree-empty">Loading global skills...</p>
        ) : globalSkillsTree.length > 0 ? (
          globalSkillsTree.map((node) => (
            <SkillsTreeNodeRow
              key={node.path}
              deletingGlobalSkillDirectory={deletingGlobalSkillDirectory}
              expandedSkillPaths={expandedSkillPaths}
              node={node}
              renamingGlobalSkillDirectory={renamingGlobalSkillDirectory}
              renamingGlobalSkillDraftDirectory={renamingGlobalSkillDraftDirectory}
              renamingGlobalSkillName={renamingGlobalSkillName}
              selectedGlobalSkillFilePath={selectedGlobalSkillFilePath}
              onDeleteGlobalSkill={onDeleteGlobalSkill}
              onDirectoryToggle={onGlobalSkillDirectoryToggle}
              onFileSelect={onGlobalSkillFileSelect}
              onRenameGlobalSkill={onRenameGlobalSkill}
              onRenameGlobalSkillDraftCancel={onRenameGlobalSkillDraftCancel}
              onRenameGlobalSkillDraftChange={onRenameGlobalSkillDraftChange}
              onRenameGlobalSkillDraftStart={onRenameGlobalSkillDraftStart}
            />
          ))
        ) : (
          <p className="skills-tree-empty">No global skills exist yet. Use the add button to create the first one.</p>
        )}
      </div>
    </section>
  )
}

export function Sidebar({
  activeSessionID,
  activeView,
  deletingSessionID,
  expandedFolderIDs,
  globalSkillsNavigatorProps,
  hoveredFolderID,
  isCreatingProject,
  isCreatingSession,
  creatingWorktreeProjectID,
  isSettingsOpen,
  onOpenRemoteFolderConfig,
  promptSkillMode,
  promptPresetsSidebarProps,
  showSettingsButton = true,
  showSidebarToggleButton,
  builtinToolsSidebarProps,
  projectRowRefs,
  conversationWorkspaceID,
  protectedWorkspaceIDs,
  runningSessionIDs,
  selectedFolderID,
  sessionCanvasUnreadBySession,
  visibleCanvasSessionIDs,
  workspaces,
  pinnedWorkspaceIDs,
  onHoveredFolderChange,
  onOpenSettings,
  onProjectArchiveSessions,
  onProjectClick,
  onProjectCreateSession,
  onProjectCreateWorktree,
  onProjectOpenInExplorer,
  onProjectPin,
  onProjectRemove,
  onConversationClick,
  onSessionDelete,
  onSessionSelect,
  onSidebarAction,
  onToggleSidebar,
}: SidebarProps) {
  const { t } = useI18n()

  return (
    <aside id="app-sidebar" className="sidebar" aria-label="Primary sidebar">
      <LeftSidebarTopMenu
        activeView={activeView}
        isCreatingProject={isCreatingProject}
        onOpenRemoteFolderConfig={onOpenRemoteFolderConfig}
        showSidebarToggleButton={showSidebarToggleButton}
        onSidebarAction={onSidebarAction}
        onToggleSidebar={onToggleSidebar}
      />

      <div className="sidebar-view-host">
        {activeView === "workspace" ? (
          <FolderWorkspaceView
            activeSessionID={activeSessionID}
            deletingSessionID={deletingSessionID}
            expandedFolderIDs={expandedFolderIDs}
            hoveredFolderID={hoveredFolderID}
            isCreatingSession={isCreatingSession}
            creatingWorktreeProjectID={creatingWorktreeProjectID}
            projectRowRefs={projectRowRefs}
            conversationWorkspaceID={conversationWorkspaceID}
            protectedWorkspaceIDs={protectedWorkspaceIDs}
            runningSessionIDs={runningSessionIDs}
            selectedFolderID={selectedFolderID}
            sessionCanvasUnreadBySession={sessionCanvasUnreadBySession}
            visibleCanvasSessionIDs={visibleCanvasSessionIDs}
            workspaces={workspaces}
            pinnedWorkspaceIDs={pinnedWorkspaceIDs}
            onHoveredFolderChange={onHoveredFolderChange}
            onProjectArchiveSessions={onProjectArchiveSessions}
            onProjectClick={onProjectClick}
            onProjectCreateSession={onProjectCreateSession}
            onProjectCreateWorktree={onProjectCreateWorktree}
            onProjectOpenInExplorer={onProjectOpenInExplorer}
            onProjectPin={onProjectPin}
            onProjectRemove={onProjectRemove}
            onConversationClick={onConversationClick}
            onSessionDelete={onSessionDelete}
            onSessionSelect={onSessionSelect}
          />
        ) : null}
        {activeView === "resources" ? (
          promptSkillMode === "skills"
            ? <GlobalSkillsNavigator {...globalSkillsNavigatorProps} />
            : <PromptPresetsSidebarView {...promptPresetsSidebarProps} />
        ) : null}
        {activeView === "tools" ? (
          <BuiltinToolsSidebarView {...builtinToolsSidebarProps} />
        ) : null}
      </div>

      {showSettingsButton ? (
        <button
          className={isSettingsOpen ? "sidebar-settings is-active" : "sidebar-settings"}
          aria-label={t("shell.openSettings")}
          aria-pressed={isSettingsOpen}
          title={t("shell.openSettings")}
          onClick={onOpenSettings}
        >
          <SettingsIcon />
        </button>
      ) : null}
    </aside>
  )
}
