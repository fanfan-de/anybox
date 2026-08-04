import { useCallback, useEffect, useRef, useState, type CSSProperties, type Dispatch, type FocusEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type MutableRefObject, type ReactNode, type SetStateAction } from "react"
import { createPortal } from "react-dom"
import { sidebarActions } from "../constants"
import {
  ArchiveIcon,
  AutomationIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  DeleteIcon,
  EditIcon,
  FileTextIcon,
  ForkIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  NewItemIcon,
  OpenExternalIcon,
  PinIcon,
  ProviderSettingsIcon,
  RightSidebarIcon,
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
import { isGitWorkspaceProject } from "../workspace"
import type {
  AgentEnvironmentCandidate,
  AgentEnvironmentListResult,
} from "../../../../shared/desktop-ipc-contract"

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
  onProjectCreateAutomation: (workspace: WorkspaceGroup) => void
  onProjectCreateSession: (workspace: WorkspaceGroup, event: MouseEvent<HTMLButtonElement>) => void | Promise<void>
  onProjectCreateWorktree: (workspace: WorkspaceGroup, input: ProjectWorktreeCreateRequest) => boolean | void | Promise<boolean | void>
  onProjectOpenCinema: (workspace: WorkspaceGroup) => void | Promise<void>
  onProjectOpenInExplorer: (workspace: WorkspaceGroup) => void | Promise<void>
  onProjectPin: (workspace: WorkspaceGroup) => void
  onProjectRemove: (workspace: WorkspaceGroup, event: MouseEvent<HTMLButtonElement>) => void
  onConversationClick: () => void | Promise<void>
  onSessionDelete: (workspace: WorkspaceGroup, session: SessionSummary, event: MouseEvent<HTMLButtonElement>) => void
  onSessionPin: (workspaceID: string, sessionID: string, pinned: boolean) => void | Promise<void>
  onSessionPopout: (sessionID: string) => void | Promise<void>
  onSessionRename: (workspaceID: string, sessionID: string, title: string) => void | Promise<void>
  onSessionSelect: (workspaceID: string, sessionID: string) => void
  onSessionSplitRight: (workspaceID: string, sessionID: string) => void | Promise<void>
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
  isCreatingProject: boolean
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
  onAddProjectFolder: () => void | Promise<void>
  onHoveredFolderChange: Dispatch<SetStateAction<string | null>>
  onProjectArchiveSessions: (workspace: WorkspaceGroup) => void | Promise<void>
  onProjectClick: (workspace: WorkspaceGroup) => void
  onProjectCreateAutomation: (workspace: WorkspaceGroup) => void
  onProjectCreateSession: (workspace: WorkspaceGroup, event: MouseEvent<HTMLButtonElement>) => void | Promise<void>
  onProjectCreateWorktree: (workspace: WorkspaceGroup, input: ProjectWorktreeCreateRequest) => boolean | void | Promise<boolean | void>
  onProjectOpenCinema: (workspace: WorkspaceGroup) => void | Promise<void>
  onProjectOpenInExplorer: (workspace: WorkspaceGroup) => void | Promise<void>
  onProjectPin: (workspace: WorkspaceGroup) => void
  onProjectRemove: (workspace: WorkspaceGroup, event: MouseEvent<HTMLButtonElement>) => void
  onConversationClick: () => void | Promise<void>
  onSessionDelete: (workspace: WorkspaceGroup, session: SessionSummary, event: MouseEvent<HTMLButtonElement>) => void
  onSessionPin: (workspaceID: string, sessionID: string, pinned: boolean) => void | Promise<void>
  onSessionPopout: (sessionID: string) => void | Promise<void>
  onSessionRename: (workspaceID: string, sessionID: string, title: string) => void | Promise<void>
  onSessionSelect: (workspaceID: string, sessionID: string) => void
  onSessionSplitRight: (workspaceID: string, sessionID: string) => void | Promise<void>
}

type WorkspaceContextMenuState =
  | {
      kind: "project"
      workspace: WorkspaceGroup
      x: number
      y: number
    }
  | {
      kind: "background"
      x: number
      y: number
    }
  | null

interface SessionContextMenuState {
  hasRunningActivity: boolean
  session: SessionSummary
  trigger: HTMLButtonElement
  workspace: WorkspaceGroup
  x: number
  y: number
}

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
const PROJECT_CONTEXT_MENU_HEIGHT = 262
const WORKSPACE_BACKGROUND_CONTEXT_MENU_WIDTH = 184
const WORKSPACE_BACKGROUND_CONTEXT_MENU_HEIGHT = 46
const SESSION_CONTEXT_MENU_WIDTH = 224
const SESSION_CONTEXT_MENU_HEIGHT = 204

interface WorkspaceSessionTreeNode {
  children: WorkspaceSessionTreeNode[]
  session: SessionSummary
}

function buildWorkspaceSessionTree(sessions: SessionSummary[]): WorkspaceSessionTreeNode[] {
  const primarySessions = sessions.filter((session) => !session.subagent)
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

function clampContextMenuPosition(x: number, y: number, width: number, height: number) {
  const margin = 8
  if (typeof window === "undefined") {
    return { x, y }
  }

  return {
    x: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
    y: Math.max(margin, Math.min(y, window.innerHeight - height - margin)),
  }
}

interface WorkspaceContextMenuProps {
  deletingSessionID: string | null
  creatingWorktreeProjectID: string | null
  isCreatingProject: boolean
  menu: WorkspaceContextMenuState
  pinnedWorkspaceIDs: string[]
  protectedWorkspaceIDs: string[]
  onAddProjectFolder: () => void | Promise<void>
  onClose: () => void
  onProjectArchiveSessions: (workspace: WorkspaceGroup) => void | Promise<void>
  onProjectCreateAutomation: (workspace: WorkspaceGroup) => void
  onProjectCreateWorktree: (workspace: WorkspaceGroup) => void | Promise<void>
  onProjectOpenCinema: (workspace: WorkspaceGroup) => void | Promise<void>
  onProjectOpenInExplorer: (workspace: WorkspaceGroup) => void | Promise<void>
  onProjectPin: (workspace: WorkspaceGroup) => void
  onProjectRemove: (workspace: WorkspaceGroup, event: MouseEvent<HTMLButtonElement>) => void
}

function WorkspaceContextMenu({
  deletingSessionID,
  creatingWorktreeProjectID,
  isCreatingProject,
  menu,
  pinnedWorkspaceIDs,
  protectedWorkspaceIDs,
  onAddProjectFolder,
  onClose,
  onProjectArchiveSessions,
  onProjectCreateAutomation,
  onProjectCreateWorktree,
  onProjectOpenCinema,
  onProjectOpenInExplorer,
  onProjectPin,
  onProjectRemove,
}: WorkspaceContextMenuProps) {
  const { t } = useI18n()
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

  const isBackgroundMenu = menu.kind === "background"
  const position = clampContextMenuPosition(
    menu.x,
    menu.y,
    isBackgroundMenu ? WORKSPACE_BACKGROUND_CONTEXT_MENU_WIDTH : PROJECT_CONTEXT_MENU_WIDTH,
    isBackgroundMenu ? WORKSPACE_BACKGROUND_CONTEXT_MENU_HEIGHT : PROJECT_CONTEXT_MENU_HEIGHT,
  )

  if (isBackgroundMenu) {
    return createPortal(
      <div
        ref={menuRef}
        className="ui-context-menu workspace-background-context-menu"
        role="menu"
        aria-label={t("sidebar.workspaceActions")}
        style={{ left: position.x, top: position.y }}
      >
        <button
          className="ui-context-menu__item"
          role="menuitem"
          type="button"
          disabled={isCreatingProject}
          onClick={(event) => {
            event.stopPropagation()
            onClose()
            void onAddProjectFolder()
          }}
        >
          <span className="ui-context-menu__icon" aria-hidden="true"><FolderPlusIcon /></span>
          <span className="ui-context-menu__label">添加项目文件夹…</span>
        </button>
      </div>,
      document.body,
    )
  }

  const { workspace } = menu
  const isMissingWorkspace = workspace.exists === false
  const hasArchivableSessions = workspace.sessions.length > 0
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
      <button
        className="ui-context-menu__item"
        role="menuitem"
        type="button"
        disabled={isMissingWorkspace}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
          void onProjectOpenCinema(workspace)
        }}
      >
        <span className="ui-context-menu__icon" aria-hidden="true"><FileTextIcon /></span>
        <span className="ui-context-menu__label">{t("sidebar.openCinema")}</span>
      </button>
      <button
        className="ui-context-menu__item"
        role="menuitem"
        type="button"
        disabled={isMissingWorkspace}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
          onProjectCreateAutomation(workspace)
        }}
      >
        <span className="ui-context-menu__icon" aria-hidden="true"><AutomationIcon /></span>
        <span className="ui-context-menu__label">创建自动化</span>
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

interface SessionContextMenuProps {
  deletingSessionID: string | null
  isBusy: boolean
  menu: SessionContextMenuState | null
  onArchive: (event: MouseEvent<HTMLButtonElement>) => void
  onClose: (restoreFocus?: boolean) => void
  onPin: () => void
  onPopout: () => void
  onRename: () => void
  onSplitRight: () => void
}

function SessionContextMenu({
  deletingSessionID,
  isBusy,
  menu,
  onArchive,
  onClose,
  onPin,
  onPopout,
  onRename,
  onSplitRight,
}: SessionContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menu) return

    menuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']:not(:disabled)")?.focus()

    function handlePointerDown(event: globalThis.PointerEvent) {
      const target = event.target as Node | null
      if (!target || menuRef.current?.contains(target)) return
      onClose(true)
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose(true)
      }
    }

    function handleViewportChange() {
      onClose(true)
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    window.addEventListener("resize", handleViewportChange)
    window.addEventListener("scroll", handleViewportChange, true)

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("resize", handleViewportChange)
      window.removeEventListener("scroll", handleViewportChange, true)
    }
  }, [menu, onClose])

  if (!menu) return null

  const position = clampContextMenuPosition(
    menu.x,
    menu.y,
    SESSION_CONTEXT_MENU_WIDTH,
    SESSION_CONTEXT_MENU_HEIGHT,
  )
  const archiveDisabled = isBusy || deletingSessionID !== null || menu.hasRunningActivity

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") ?? [])]
    if (items.length === 0) return

    event.preventDefault()
    const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === "Home") {
      items[0]?.focus()
      return
    }
    if (event.key === "End") {
      items[items.length - 1]?.focus()
      return
    }

    const direction = event.key === "ArrowDown" ? 1 : -1
    const nextIndex = activeIndex < 0
      ? (direction > 0 ? 0 : items.length - 1)
      : (activeIndex + direction + items.length) % items.length
    items[nextIndex]?.focus()
  }

  return createPortal(
    <div
      ref={menuRef}
      className="ui-context-menu session-context-menu"
      role="menu"
      aria-label={`${menu.session.title} 会话操作`}
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={handleMenuKeyDown}
    >
      <button className="ui-context-menu__item" role="menuitem" type="button" disabled={isBusy} onClick={onRename}>
        <span className="ui-context-menu__icon" aria-hidden="true"><EditIcon /></span>
        <span className="ui-context-menu__label">重命名</span>
      </button>
      <button className="ui-context-menu__item" role="menuitem" type="button" disabled={isBusy} onClick={onPin}>
        <span className="ui-context-menu__icon" aria-hidden="true"><PinIcon /></span>
        <span className="ui-context-menu__label">{menu.session.pinned ? "取消置顶" : "置顶会话"}</span>
      </button>
      <div className="ui-context-menu__divider" role="separator" />
      <button className="ui-context-menu__item" role="menuitem" type="button" disabled={isBusy} onClick={onSplitRight}>
        <span className="ui-context-menu__icon" aria-hidden="true"><RightSidebarIcon /></span>
        <span className="ui-context-menu__label">在右侧窗格中打开</span>
      </button>
      <button className="ui-context-menu__item" role="menuitem" type="button" disabled={isBusy} onClick={onPopout}>
        <span className="ui-context-menu__icon" aria-hidden="true"><OpenExternalIcon /></span>
        <span className="ui-context-menu__label">在新窗口中打开</span>
      </button>
      <div className="ui-context-menu__divider" role="separator" />
      <button
        className="ui-context-menu__item"
        role="menuitem"
        type="button"
        disabled={archiveDisabled}
        title={menu.hasRunningActivity ? "请先停止任务后再归档" : "归档会话"}
        onClick={onArchive}
      >
        <span className="ui-context-menu__icon" aria-hidden="true"><ArchiveIcon /></span>
        <span className="ui-context-menu__label">归档会话</span>
      </button>
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
  const { t } = useI18n()
  const [draftName, setDraftName] = useState(defaultName)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [environmentResult, setEnvironmentResult] = useState<AgentEnvironmentListResult | null>(null)
  const [selectedEnvironmentKey, setSelectedEnvironmentKey] = useState("")
  const [runSetup, setRunSetup] = useState(true)
  const [isLoadingEnvironments, setIsLoadingEnvironments] = useState(true)
  const [isTrustingEnvironment, setIsTrustingEnvironment] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const isSubmittingRef = useRef(false)
  const branchName = draftName.trim()
  const isBusy = isCreating || isSubmitting
  const selectedEnvironment =
    environmentResult?.items.find((candidate) => candidate.key === selectedEnvironmentKey) ?? null
  const canSubmit =
    Boolean(branchName) &&
    !isBusy &&
    !isLoadingEnvironments &&
    (!selectedEnvironment || (
      selectedEnvironment.trusted &&
      Boolean(selectedEnvironment.definition) &&
      !selectedEnvironment.issues.some((issue) => issue.severity === "error")
    ))

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    let cancelled = false
    const listEnvironments = window.desktop?.listProjectEnvironments
    if (!listEnvironments) {
      setIsLoadingEnvironments(false)
      return
    }

    setIsLoadingEnvironments(true)
    listEnvironments({
      projectID: workspace.project.id,
      directory: workspace.directory,
    })
      .then((result) => {
        if (cancelled) return
        setEnvironmentResult(result)
        const candidate =
          result.items.find((item) => item.key === result.selectedKey) ??
          result.items[0] ??
          null
        setSelectedEnvironmentKey(candidate?.key ?? "")
        setRunSetup(Boolean(candidate?.definition?.setup) && result.autoSetup)
      })
      .catch((error) => {
        if (!cancelled) setErrorMessage(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!cancelled) setIsLoadingEnvironments(false)
      })

    return () => {
      cancelled = true
    }
  }, [workspace.directory, workspace.project.id])

  function getEnvironmentScripts(candidate: AgentEnvironmentCandidate) {
    const scripts: string[] = []
    const definition = candidate.definition
    if (!definition) return scripts
    for (const script of Object.values(definition.setup?.scripts ?? {})) {
      if (script?.trim()) scripts.push(script.trim())
    }
    for (const action of definition.actions) {
      for (const script of Object.values(action.scripts)) {
        if (script?.trim()) scripts.push(script.trim())
      }
    }
    return scripts
  }

  async function handleTrustEnvironment() {
    if (!selectedEnvironment || selectedEnvironment.trusted || isTrustingEnvironment) return
    const scripts = getEnvironmentScripts(selectedEnvironment)
    const summary = [
      t("environment.worktree.trustPrompt"),
      "",
      selectedEnvironment.configPath,
      `SHA-256 ${selectedEnvironment.contentHash.slice(0, 16)}…`,
      "",
      ...scripts.map((script) => `• ${script}`),
    ].join("\n")
    if (typeof window.confirm === "function" && !window.confirm(summary)) return

    setIsTrustingEnvironment(true)
    setErrorMessage(null)
    try {
      const trusted = await window.desktop?.trustProjectEnvironment?.({
        projectID: workspace.project.id,
        directory: workspace.directory,
        key: selectedEnvironment.key,
        expectedHash: selectedEnvironment.contentHash,
      })
      if (!trusted) throw new Error(t("environment.worktree.trustUnavailable"))
      setEnvironmentResult((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) => item.key === trusted.key ? trusted : item),
            }
          : current,
      )
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsTrustingEnvironment(false)
    }
  }

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
        environment: selectedEnvironment
          ? {
              key: selectedEnvironment.key,
              expectedHash: selectedEnvironment.contentHash,
              runSetup: Boolean(selectedEnvironment.definition?.setup) && runSetup,
            }
          : undefined,
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

        {environmentResult?.items.length ? (
        <section className="project-worktree-environment">
          <div className="project-worktree-environment-heading">
            <div>
              <strong>{t("environment.worktree.title")}</strong>
              <span>{t("environment.worktree.description")}</span>
            </div>
            {selectedEnvironment ? (
              <span className={selectedEnvironment.trusted ? "is-trusted" : "is-untrusted"}>
                {selectedEnvironment.trusted
                  ? t("environment.worktree.trusted")
                  : t("environment.worktree.untrusted")}
              </span>
            ) : null}
          </div>
          <select
            aria-label={t("environment.worktree.selectAria")}
            value={selectedEnvironmentKey}
            disabled={isBusy || isLoadingEnvironments}
            onChange={(event) => {
              const key = event.target.value
              const candidate = environmentResult?.items.find((item) => item.key === key)
              setSelectedEnvironmentKey(key)
              setRunSetup(Boolean(candidate?.definition?.setup) && (environmentResult?.autoSetup ?? true))
              setErrorMessage(null)
            }}
          >
            <option value="">{t("environment.worktree.none")}</option>
            {environmentResult?.items.map((candidate) => (
              <option
                key={candidate.key}
                value={candidate.key}
                disabled={!candidate.definition || candidate.issues.some((issue) => issue.severity === "error")}
              >
                {candidate.definition?.name || candidate.configPath} · {candidate.source === "codex-toml" ? "Codex" : "Anybox"}
              </option>
            ))}
          </select>
          {selectedEnvironment ? (
            <div className="project-worktree-environment-options">
              <label>
                <input
                  type="checkbox"
                  checked={runSetup}
                  disabled={isBusy || !selectedEnvironment.definition?.setup}
                  onChange={(event) => setRunSetup(event.target.checked)}
                />
                <span>{t("environment.worktree.initialize")}</span>
              </label>
              {!selectedEnvironment.trusted ? (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={isBusy || isTrustingEnvironment || !selectedEnvironment.definition}
                  onClick={() => void handleTrustEnvironment()}
                >
                  {isTrustingEnvironment
                    ? t("environment.worktree.trusting")
                    : t("environment.worktree.reviewTrust")}
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
        ) : null}

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
  isCreatingProject,
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
  onAddProjectFolder,
  onHoveredFolderChange,
  onProjectArchiveSessions,
  onProjectClick,
  onProjectCreateAutomation,
  onProjectCreateSession,
  onProjectCreateWorktree,
  onProjectOpenCinema,
  onProjectOpenInExplorer,
  onProjectPin,
  onProjectRemove,
  onConversationClick,
  onSessionDelete,
  onSessionPin,
  onSessionPopout,
  onSessionRename,
  onSessionSelect,
  onSessionSplitRight,
}: FolderWorkspaceViewProps) {
  const runningSessionIDSet = new Set(runningSessionIDs)
  const visibleSessionIDSet = new Set(visibleCanvasSessionIDs)
  const [workspaceContextMenu, setWorkspaceContextMenu] = useState<WorkspaceContextMenuState>(null)
  const [sessionContextMenu, setSessionContextMenu] = useState<SessionContextMenuState | null>(null)
  const [sessionActionBusyID, setSessionActionBusyID] = useState<string | null>(null)
  const [renamingSession, setRenamingSession] = useState<{ sessionID: string; workspaceID: string } | null>(null)
  const [renameDraft, setRenameDraft] = useState("")
  const [renameInvalid, setRenameInvalid] = useState(false)
  const [isRenameSaving, setIsRenameSaving] = useState(false)
  const [worktreeCreateWorkspace, setWorktreeCreateWorkspace] = useState<WorkspaceGroup | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const renameRequestPendingRef = useRef(false)
  const renameCancelRef = useRef(false)
  const sessionTimeNow = useSessionTimeNow()

  function closeWorkspaceContextMenu() {
    setWorkspaceContextMenu(null)
  }

  const closeSessionContextMenu = useCallback((restoreFocus = true) => {
    const trigger = sessionContextMenu?.trigger
    setSessionContextMenu(null)
    if (restoreFocus && trigger) {
      window.setTimeout(() => trigger.focus(), 0)
    }
  }, [sessionContextMenu])

  useEffect(() => {
    if (!renamingSession) return
    renameInputRef.current?.focus()
    renameInputRef.current?.select()
  }, [renamingSession])

  function startSessionRename() {
    const target = sessionContextMenu
    if (!target) return
    closeSessionContextMenu(false)
    renameCancelRef.current = false
    renameRequestPendingRef.current = false
    setRenameDraft(target.session.title)
    setRenameInvalid(false)
    setIsRenameSaving(false)
    setRenamingSession({
      sessionID: target.session.id,
      workspaceID: target.workspace.id,
    })
  }

  async function commitSessionRename(workspace: WorkspaceGroup, session: SessionSummary) {
    if (renameRequestPendingRef.current) return
    const title = renameDraft.trim()
    if (!title) {
      setRenameInvalid(true)
      window.setTimeout(() => renameInputRef.current?.focus(), 0)
      return
    }
    if (title === session.title) {
      setRenamingSession(null)
      setRenameInvalid(false)
      return
    }

    renameRequestPendingRef.current = true
    setIsRenameSaving(true)
    setRenameInvalid(false)
    try {
      await onSessionRename(workspace.id, session.id, title)
      setRenamingSession(null)
    } catch {
      setRenameInvalid(true)
      window.setTimeout(() => renameInputRef.current?.focus(), 0)
    } finally {
      renameRequestPendingRef.current = false
      setIsRenameSaving(false)
    }
  }

  function cancelSessionRename() {
    renameCancelRef.current = true
    setRenamingSession(null)
    setRenameInvalid(false)
  }

  async function runSessionAction(action: (target: SessionContextMenuState) => void | Promise<void>) {
    const target = sessionContextMenu
    if (!target || sessionActionBusyID) return
    closeSessionContextMenu(false)
    setSessionActionBusyID(target.session.id)
    try {
      await action(target)
    } catch {
      // Action handlers surface errors through the shared toast system.
    } finally {
      setSessionActionBusyID(null)
    }
  }

  function openWorktreeCreateDialog(workspace: WorkspaceGroup) {
    closeWorkspaceContextMenu()
    setWorktreeCreateWorkspace(workspace)
  }

  function handleWorkspaceContextMenu(event: MouseEvent<HTMLElement>) {
    const target = event.target
    if (!(target instanceof Element)) return

    const interactiveTarget = target.closest(
      ".project-block, a, button, input, textarea, select, [contenteditable='true'], webview",
    )
    if (interactiveTarget) return

    event.preventDefault()
    event.stopPropagation()
    closeSessionContextMenu(false)
    setWorkspaceContextMenu({
      kind: "background",
      x: event.clientX,
      y: event.clientY,
    })
  }

  function sessionTreeHasRunningActivity(workspace: WorkspaceGroup, node: WorkspaceSessionTreeNode): boolean {
    const pendingSessionIDs = [node.session.id]
    const visitedSessionIDs = new Set<string>()
    while (pendingSessionIDs.length > 0) {
      const sessionID = pendingSessionIDs.pop()
      if (!sessionID || visitedSessionIDs.has(sessionID)) continue
      visitedSessionIDs.add(sessionID)
      if (runningSessionIDSet.has(sessionID)) return true

      for (const candidate of workspace.sessions) {
        if (candidate.subagent?.parentSessionID === sessionID) {
          pendingSessionIDs.push(candidate.id)
        }
      }
    }
    return false
  }

  function renderSessionNode(workspace: WorkspaceGroup, node: WorkspaceSessionTreeNode, depth = 0): ReactNode {
    const { session } = node
    const active = session.id === activeSessionID
    const isRunning = runningSessionIDSet.has(session.id)
    const hasUnreadCanvas =
      Boolean(sessionCanvasUnreadBySession[session.id]) && !visibleSessionIDSet.has(session.id)
    const sessionCreatedAt = session.created ?? session.updated
    const isSubagent = depth > 0
    const hasRunningActivity = sessionTreeHasRunningActivity(workspace, node)
    const isRenaming = renamingSession?.sessionID === session.id && renamingSession.workspaceID === workspace.id
    const shellStyle: CSSProperties | undefined = isSubagent
      ? { paddingLeft: `${Math.min(depth, 4) * 18}px` }
      : undefined

    function openSessionContextMenu(trigger: HTMLButtonElement, x: number, y: number) {
      closeWorkspaceContextMenu()
      setSessionContextMenu({
        hasRunningActivity,
        session,
        trigger,
        workspace,
        x,
        y,
      })
    }

    function handleSessionContextMenu(event: MouseEvent<HTMLButtonElement>) {
      event.preventDefault()
      event.stopPropagation()
      openSessionContextMenu(event.currentTarget, event.clientX, event.clientY)
    }

    function handleSessionRowKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return
      event.preventDefault()
      event.stopPropagation()
      const rect = event.currentTarget.getBoundingClientRect()
      openSessionContextMenu(event.currentTarget, rect.left + 12, rect.top + 12)
    }

    return (
      <div key={session.id} className="session-tree-node">
        <div
          className={joinClassNames("session-row-shell", isSubagent && "is-subagent")}
          style={shellStyle}
        >
          {isRenaming ? (
            <div className={joinClassNames("session-row", "is-editing", active && "is-active", isSubagent && "is-subagent")}>
              <input
                ref={renameInputRef}
                className="session-row-rename-input"
                aria-label={`重命名会话 ${session.title}`}
                aria-invalid={renameInvalid}
                disabled={isRenameSaving}
                maxLength={160}
                value={renameDraft}
                onBlur={() => {
                  if (renameCancelRef.current) {
                    renameCancelRef.current = false
                    return
                  }
                  void commitSessionRename(workspace, session)
                }}
                onChange={(event) => {
                  setRenameDraft(event.target.value)
                  setRenameInvalid(false)
                }}
                onContextMenu={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault()
                    cancelSessionRename()
                    return
                  }
                  if (event.key === "Enter") {
                    event.preventDefault()
                    void commitSessionRename(workspace, session)
                  }
                }}
              />
              {isRenameSaving ? (
                <span className="session-row-rename-status" aria-label="正在保存">
                  <SessionRunningIcon />
                </span>
              ) : null}
            </div>
          ) : (
            <button
              className={joinClassNames("session-row", active && "is-active", isSubagent && "is-subagent")}
              onClick={() => onSessionSelect(workspace.id, session.id)}
              onContextMenu={handleSessionContextMenu}
              onKeyDown={handleSessionRowKeyDown}
            >
              <span className="session-row-copy">
                <span className="session-row-label">{session.title}</span>
              </span>
              {isRunning || hasUnreadCanvas || session.automation || session.pinned ? (
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
                  {session.pinned ? (
                    <span className="session-row-source-badge is-pinned" title="已置顶" aria-label="已置顶">
                      <PinIcon />
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
          )}
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
              title={hasRunningActivity ? "请先停止任务后再归档" : `Archive session ${session.title}`}
              disabled={deletingSessionID !== null || hasRunningActivity}
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
    <section
      className="sidebar-view sidebar-view-workspace"
      aria-label="Workspace sidebar view"
      onContextMenu={handleWorkspaceContextMenu}
    >
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
            closeSessionContextMenu(false)
            onHoveredFolderChange(workspace.id)
            setWorkspaceContextMenu({
              kind: "project",
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
                    {isMissingWorkspace ? (
                      <span className="project-row-status is-missing">{"\u5df2\u5220\u9664"}</span>
                    ) : null}
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
      <WorkspaceContextMenu
        deletingSessionID={deletingSessionID}
        creatingWorktreeProjectID={creatingWorktreeProjectID}
        isCreatingProject={isCreatingProject}
        menu={workspaceContextMenu}
        pinnedWorkspaceIDs={pinnedWorkspaceIDs}
        protectedWorkspaceIDs={protectedWorkspaceIDs}
        onAddProjectFolder={onAddProjectFolder}
        onClose={closeWorkspaceContextMenu}
        onProjectArchiveSessions={onProjectArchiveSessions}
        onProjectCreateAutomation={onProjectCreateAutomation}
        onProjectCreateWorktree={openWorktreeCreateDialog}
        onProjectOpenCinema={onProjectOpenCinema}
        onProjectOpenInExplorer={onProjectOpenInExplorer}
        onProjectPin={onProjectPin}
        onProjectRemove={onProjectRemove}
      />
      <SessionContextMenu
        deletingSessionID={deletingSessionID}
        isBusy={sessionActionBusyID === sessionContextMenu?.session.id}
        menu={sessionContextMenu}
        onArchive={(event) => {
          const target = sessionContextMenu
          if (!target) return
          closeSessionContextMenu(false)
          onSessionDelete(target.workspace, target.session, event)
        }}
        onClose={closeSessionContextMenu}
        onPin={() => void runSessionAction((target) => (
          onSessionPin(target.workspace.id, target.session.id, !target.session.pinned)
        ))}
        onPopout={() => void runSessionAction((target) => onSessionPopout(target.session.id))}
        onRename={startSessionRename}
        onSplitRight={() => void runSessionAction((target) => (
          onSessionSplitRight(target.workspace.id, target.session.id)
        ))}
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
  onProjectCreateAutomation,
  onProjectCreateSession,
  onProjectCreateWorktree,
  onProjectOpenCinema,
  onProjectOpenInExplorer,
  onProjectPin,
  onProjectRemove,
  onConversationClick,
  onSessionDelete,
  onSessionPin,
  onSessionPopout,
  onSessionRename,
  onSessionSelect,
  onSessionSplitRight,
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
            isCreatingProject={isCreatingProject}
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
            onAddProjectFolder={() => onSidebarAction("project")}
            onHoveredFolderChange={onHoveredFolderChange}
            onProjectArchiveSessions={onProjectArchiveSessions}
            onProjectClick={onProjectClick}
            onProjectCreateAutomation={onProjectCreateAutomation}
            onProjectCreateSession={onProjectCreateSession}
            onProjectCreateWorktree={onProjectCreateWorktree}
            onProjectOpenCinema={onProjectOpenCinema}
            onProjectOpenInExplorer={onProjectOpenInExplorer}
            onProjectPin={onProjectPin}
            onProjectRemove={onProjectRemove}
            onConversationClick={onConversationClick}
            onSessionDelete={onSessionDelete}
            onSessionPin={onSessionPin}
            onSessionPopout={onSessionPopout}
            onSessionRename={onSessionRename}
            onSessionSelect={onSessionSelect}
            onSessionSplitRight={onSessionSplitRight}
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
