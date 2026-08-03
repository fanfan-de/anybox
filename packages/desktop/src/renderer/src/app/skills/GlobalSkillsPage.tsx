import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react"
import type { DownloadedRegistrySkill } from "@anybox/shared"
import { GlobalSkillsCanvas } from "../canvas/CreateSessionCanvas"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  MoreIcon,
  PlusIcon,
  SearchIcon,
} from "../icons"
import { useI18n } from "../i18n/I18nProvider"
import { joinClassNames, ShellTopMenu } from "../shared-ui"
import type { GlobalSkillTreeNode, SkillGitInstallPreview } from "../types"
import type { GlobalSkillFolderOption } from "../use-global-skills"

export type CreateGlobalSkillDraftKind = "skill" | "folder"
export type SkillLibrarySourceFilter = "all" | "local" | "downloaded"
export type SkillLibraryStatusFilter = "all" | "enabled" | "disabled"

interface GlobalSkillsPageProps {
  creatingGlobalSkillName: string
  creatingGlobalSkillDraftKind: CreateGlobalSkillDraftKind
  creatingGlobalSkillParentDirectory: string | null
  deletingGlobalSkillDirectory: string | null
  expandedSkillPaths: string[]
  globalSkillFolderOptions: GlobalSkillFolderOption[]
  globalSkillsRoot: string
  globalSkillsTree: GlobalSkillTreeNode[]
  gitInstallTargetDirectory: string | null
  gitInstallPreview: SkillGitInstallPreview | null
  gitInstallSource: string
  isCreateGlobalSkillDraftVisible: boolean
  isCreatingGlobalSkill: boolean
  isDirty: boolean
  isGitInstallDialogOpen: boolean
  isInstallingGitSkills: boolean
  isInstallingLocalSkill: boolean
  isLocalInstallDialogOpen: boolean
  isLoadingFile: boolean
  isLoadingSkillsTree: boolean
  isMoveGlobalSkillDialogOpen: boolean
  isMovingGlobalSkillDirectory: boolean
  isPreviewingGitInstall: boolean
  isSavingFile: boolean
  localInstallTargetDirectory: string | null
  moveGlobalSkillTargetOptions: GlobalSkillFolderOption[]
  movingGlobalSkillDirectory: string | null
  movingGlobalSkillTargetDirectory: string | null
  renamingGlobalSkillDirectory: string | null
  renamingGlobalSkillDraftDirectory: string | null
  renamingGlobalSkillName: string
  selectedFileContent: string
  selectedFilePath: string | null
  selectedFileReadOnly: boolean
  selectedGitInstallSkillIDs: string[]
  selectedSkillDirectoryName: string | null
  hideTopMenu?: boolean
  hideNavigator?: boolean
  windowControls?: ReactNode
  onChange: (value: string) => void
  onCreateGlobalSkill: () => void | Promise<void>
  onCreateGlobalSkillDraftCancel: () => void
  onCreateGlobalSkillDraftChange: (value: string) => void
  onCreateGlobalSkillDraftStart: (kind?: CreateGlobalSkillDraftKind, parentDirectory?: string | null) => void
  onDeleteGlobalSkill: (directoryPath?: string) => void | Promise<void>
  onGitInstallDialogClose: () => void
  onGitInstallDialogOpen: () => void
  onGitInstallSkillToggle: (skillID: string) => void
  onGitInstallSourceChange: (value: string) => void
  onGitInstallTargetDirectoryChange: (value: string | null) => void
  onGlobalSkillDirectoryToggle: (path: string) => void
  onGlobalSkillFileSelect: (path: string) => void | Promise<void>
  onInstallGitSkills: () => void | Promise<void>
  onInstallLocalSkillFile: () => void | Promise<void>
  onLocalInstallDialogClose: () => void
  onLocalInstallDialogOpen: () => void
  onLocalInstallTargetDirectoryChange: (value: string | null) => void
  onMoveGlobalSkillDirectory: () => void | Promise<void>
  onMoveGlobalSkillDirectoryCancel: () => void
  onMoveGlobalSkillDirectoryStart: (directoryPath: string) => void
  onMoveGlobalSkillTargetDirectoryChange: (value: string | null) => void
  onOpenGlobalSkillsFolder: (targetPath?: string) => void | Promise<void>
  onPreviewGitSkillInstall: () => void | Promise<void>
  onRenameGlobalSkill: () => void | Promise<void>
  onRenameGlobalSkillDraftCancel: () => void
  onRenameGlobalSkillDraftChange: (value: string) => void
  onRenameGlobalSkillDraftStart: (directoryPath: string) => void
  onSave: () => void | Promise<void>
}

export interface GlobalSkillsNavigatorProps {
  creatingGlobalSkillName: string
  creatingGlobalSkillDraftKind: CreateGlobalSkillDraftKind
  creatingGlobalSkillParentDirectory: string | null
  deletingGlobalSkillDirectory: string | null
  expandedSkillPaths: string[]
  globalSkillsRoot: string
  globalSkillsTree: GlobalSkillTreeNode[]
  isCreateGlobalSkillDraftVisible: boolean
  isCreatingGlobalSkill: boolean
  isInstallingLocalSkill: boolean
  isLoadingSkillsTree: boolean
  renamingGlobalSkillDirectory: string | null
  renamingGlobalSkillDraftDirectory: string | null
  renamingGlobalSkillName: string
  selectedGlobalSkillFilePath: string | null
  onCreateGlobalSkill: () => void | Promise<void>
  onCreateGlobalSkillDraftCancel: () => void
  onCreateGlobalSkillDraftChange: (value: string) => void
  onCreateGlobalSkillDraftStart: (kind?: CreateGlobalSkillDraftKind, parentDirectory?: string | null) => void
  onDeleteGlobalSkill: (directoryPath?: string) => void | Promise<void>
  onGitInstallDialogOpen: () => void
  onGlobalSkillDirectoryToggle: (path: string) => void
  onGlobalSkillFileSelect: (path: string) => void | Promise<void>
  onOpenGlobalSkillsFolder: (targetPath?: string) => void | Promise<void>
  onLocalInstallDialogOpen: () => void
  onMoveGlobalSkillDirectoryStart: (directoryPath: string) => void
  onRenameGlobalSkill: () => void | Promise<void>
  onRenameGlobalSkillDraftCancel: () => void
  onRenameGlobalSkillDraftChange: (value: string) => void
  onRenameGlobalSkillDraftStart: (directoryPath: string) => void
  downloadedSkills?: DownloadedRegistrySkill[]
  selectedDownloadedSkillID?: string | null
  selectedSkillSource?: "local" | "downloaded"
  sourceFilter?: SkillLibrarySourceFilter
  statusFilter?: SkillLibraryStatusFilter
  searchTerm?: string
  unified?: boolean
  onDownloadedSkillSelect?: (id: string) => void
  onLocalSkillSelect?: () => void
  onSearchTermChange?: (value: string) => void
}

interface GlobalSkillGitInstallDialogProps {
  folderOptions: GlobalSkillFolderOption[]
  gitInstallPreview: SkillGitInstallPreview | null
  gitInstallSource: string
  gitInstallTargetDirectory: string | null
  isInstallingGitSkills: boolean
  isPreviewingGitInstall: boolean
  selectedGitInstallSkillIDs: string[]
  onClose: () => void
  onInstall: () => void | Promise<void>
  onPreview: () => void | Promise<void>
  onSourceChange: (value: string) => void
  onTargetDirectoryChange: (value: string | null) => void
  onToggleSkill: (skillID: string) => void
}

interface GlobalSkillLocalInstallDialogProps {
  folderOptions: GlobalSkillFolderOption[]
  isInstallingLocalSkill: boolean
  targetDirectory: string | null
  onClose: () => void
  onInstall: () => void | Promise<void>
  onTargetDirectoryChange: (value: string | null) => void
}

interface GlobalSkillMoveDialogProps {
  isMoving: boolean
  sourceName: string
  targetDirectory: string | null
  targetOptions: GlobalSkillFolderOption[]
  onClose: () => void
  onMove: () => void | Promise<void>
  onTargetDirectoryChange: (value: string | null) => void
}

function containsSkillTreePath(node: GlobalSkillTreeNode, targetPath: string | null): boolean {
  if (!targetPath) return false
  if (node.path === targetPath) return true
  if (node.kind !== "directory") return false

  return (node.children ?? []).some((child) => containsSkillTreePath(child, targetPath))
}

function findVisibleActiveSkillTreePath(
  nodes: GlobalSkillTreeNode[],
  targetPath: string | null,
  expandedSkillPaths: string[],
): string | null {
  if (!targetPath) return null

  for (const node of nodes) {
    if (!containsSkillTreePath(node, targetPath)) continue
    if (node.kind !== "directory") return node.path
    if (node.path === targetPath || !expandedSkillPaths.includes(node.path)) return node.path

    return findVisibleActiveSkillTreePath(node.children ?? [], targetPath, expandedSkillPaths) ?? node.path
  }

  return null
}

function getDirectoryRole(node: GlobalSkillTreeNode): "folder" | "skill" | "resource" {
  if (node.kind !== "directory") return "resource"
  if (node.role) return node.role
  return (node.children ?? []).some((child) => child.kind === "file" && child.name.toLowerCase() === "skill.md")
    ? "skill"
    : "folder"
}

interface GlobalSkillListEntry {
  groupLabel: string
  node: GlobalSkillTreeNode
}

function getSkillDocumentPath(node: GlobalSkillTreeNode): string | null {
  if (node.kind !== "directory") return null
  const directSkillDocument = (node.children ?? []).find(
    (child) => child.kind === "file" && child.name.toLowerCase() === "skill.md",
  )
  if (directSkillDocument) return directSkillDocument.path

  for (const child of node.children ?? []) {
    if (child.kind !== "directory") continue
    const nestedSkillDocument = getSkillDocumentPath(child)
    if (nestedSkillDocument) return nestedSkillDocument
  }

  return null
}

function collectGlobalSkillListEntries(
  nodes: GlobalSkillTreeNode[],
  trail: string[] = [],
): GlobalSkillListEntry[] {
  const entries: GlobalSkillListEntry[] = []

  for (const node of nodes) {
    if (node.kind !== "directory") continue
    if (getDirectoryRole(node) === "skill") {
      entries.push({
        groupLabel: trail.join(" / "),
        node,
      })
      continue
    }

    entries.push(...collectGlobalSkillListEntries(node.children ?? [], [...trail, node.name]))
  }

  return entries
}

function findSelectedSkillTreeDirectory(
  nodes: GlobalSkillTreeNode[],
  targetPath: string | null,
): GlobalSkillTreeNode | null {
  if (!targetPath) return null

  for (const node of nodes) {
    if (node.kind !== "directory" || !containsSkillTreePath(node, targetPath)) continue
    if (getDirectoryRole(node) === "skill") return node

    const nested = findSelectedSkillTreeDirectory(node.children ?? [], targetPath)
    if (nested) return nested
  }

  return null
}

function findDirectoryName(nodes: GlobalSkillTreeNode[], targetPath: string | null): string {
  if (!targetPath) return "item"

  for (const node of nodes) {
    if (node.kind !== "directory") continue
    if (node.path === targetPath) return node.name
    const nested = findDirectoryName(node.children ?? [], targetPath)
    if (nested !== "item") return nested
  }

  return targetPath.split(/[\\/]/).filter(Boolean).pop() ?? "item"
}

function normalizeSkillSearchTerm(value: string) {
  return value.trim().toLowerCase()
}

function doesSkillTreeNodeMatchSearch(node: GlobalSkillTreeNode, normalizedSearchTerm: string) {
  return node.name.toLowerCase().includes(normalizedSearchTerm)
}

function filterGlobalSkillTree(nodes: GlobalSkillTreeNode[], normalizedSearchTerm: string): GlobalSkillTreeNode[] {
  if (!normalizedSearchTerm) return nodes

  return nodes.flatMap((node) => {
    if (doesSkillTreeNodeMatchSearch(node, normalizedSearchTerm)) {
      return [node]
    }

    if (node.kind !== "directory") {
      return []
    }

    const filteredChildren = filterGlobalSkillTree(node.children ?? [], normalizedSearchTerm)
    if (filteredChildren.length === 0) {
      return []
    }

    return [
      {
        ...node,
        children: filteredChildren,
      },
    ]
  })
}

function filterGlobalSkillTreeByLibraryFilters(
  nodes: GlobalSkillTreeNode[],
  sourceFilter: SkillLibrarySourceFilter,
  statusFilter: SkillLibraryStatusFilter,
  inheritedEnabled: boolean | undefined = undefined,
): GlobalSkillTreeNode[] {
  if (sourceFilter === "downloaded") return []

  return nodes.flatMap((node) => {
    if (node.scope === "plugin") return []

    const enabled = node.enabled ?? inheritedEnabled ?? true
    const filteredChildren = node.kind === "directory"
      ? filterGlobalSkillTreeByLibraryFilters(node.children ?? [], sourceFilter, statusFilter, enabled)
      : []
    const statusMatches = statusFilter === "all"
      || enabled === (statusFilter === "enabled")

    if (node.kind === "file") return statusMatches ? [node] : []

    const role = getDirectoryRole(node)
    if (role === "folder") {
      if (filteredChildren.length > 0) return [{ ...node, children: filteredChildren }]
      return statusFilter === "all" && (node.children ?? []).length === 0
        ? [node]
        : []
    }

    return statusMatches
      ? [{ ...node, children: filteredChildren }]
      : []
  })
}

function getSkillTreeNodeSortRank(node: GlobalSkillTreeNode) {
  if (node.kind === "file") return node.name.toLowerCase() === "skill.md" ? 3 : 4
  const role = getDirectoryRole(node)
  if (role === "folder") return 0
  if (role === "skill") return 1
  return 2
}

function sortGlobalSkillTree(nodes: GlobalSkillTreeNode[]): GlobalSkillTreeNode[] {
  const sortedNodes = nodes.map((node) => {
    if (node.kind !== "directory") return node
    return {
      ...node,
      children: sortGlobalSkillTree(node.children ?? []),
    }
  })

  sortedNodes.sort((left, right) => {
    const leftRank = getSkillTreeNodeSortRank(left)
    const rightRank = getSkillTreeNodeSortRank(right)
    if (leftRank !== rightRank) return leftRank - rightRank
    return left.name.localeCompare(right.name)
  })

  return sortedNodes
}

function collectDirectorySkillTreePaths(nodes: GlobalSkillTreeNode[]): string[] {
  return nodes.flatMap((node) => {
    if (node.kind !== "directory") return []
    return [node.path, ...collectDirectorySkillTreePaths(node.children ?? [])]
  })
}

function getFolderOptionValue(option: GlobalSkillFolderOption) {
  return option.path ?? ""
}

function readFolderOptionValue(value: string) {
  return value ? value : null
}

function CreateGlobalSkillForm({
  creatingGlobalSkillName,
  draftKind,
  isCreatingGlobalSkill,
  onCancel,
  onChange,
  onSubmit,
}: {
  creatingGlobalSkillName: string
  draftKind: CreateGlobalSkillDraftKind
  isCreatingGlobalSkill: boolean
  onCancel: () => void
  onChange: (value: string) => void
  onSubmit: () => void | Promise<void>
}) {
  function handleCreateSkillSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void onSubmit()
  }

  function handleCreateSkillKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Escape") return
    event.preventDefault()
    onCancel()
  }

  return (
    <form className="skills-create-form" aria-label="Create global skill form" onSubmit={handleCreateSkillSubmit}>
      <input
        autoFocus
        className="skills-create-input"
        aria-label="New global skill name"
        disabled={isCreatingGlobalSkill}
        placeholder={draftKind === "folder" ? "new-folder" : "new-skill"}
        type="text"
        value={creatingGlobalSkillName}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleCreateSkillKeyDown}
      />
      <div className="skills-create-actions">
        <button disabled={isCreatingGlobalSkill} type="submit">
          Create
        </button>
        <button disabled={isCreatingGlobalSkill} type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function GlobalSkillListRow({
  activeFilePath,
  deletingGlobalSkillDirectory,
  entry,
  renamingGlobalSkillDirectory,
  renamingGlobalSkillDraftDirectory,
  renamingGlobalSkillName,
  onDeleteGlobalSkill,
  onFileSelect,
  onLocalSkillSelect,
  onMoveGlobalSkillDirectoryStart,
  onOpenGlobalSkillsFolder,
  onRenameGlobalSkill,
  onRenameGlobalSkillDraftCancel,
  onRenameGlobalSkillDraftChange,
  onRenameGlobalSkillDraftStart,
}: {
  activeFilePath: string | null
  deletingGlobalSkillDirectory: string | null
  entry: GlobalSkillListEntry
  renamingGlobalSkillDirectory: string | null
  renamingGlobalSkillDraftDirectory: string | null
  renamingGlobalSkillName: string
  onDeleteGlobalSkill: (directoryPath?: string) => void | Promise<void>
  onFileSelect: (path: string) => void | Promise<void>
  onLocalSkillSelect?: () => void
  onMoveGlobalSkillDirectoryStart: (directoryPath: string) => void
  onOpenGlobalSkillsFolder: (targetPath?: string) => void | Promise<void>
  onRenameGlobalSkill: () => void | Promise<void>
  onRenameGlobalSkillDraftCancel: () => void
  onRenameGlobalSkillDraftChange: (value: string) => void
  onRenameGlobalSkillDraftStart: (directoryPath: string) => void
}) {
  const { t } = useI18n()
  const { node, groupLabel } = entry
  const [isRowMenuOpen, setIsRowMenuOpen] = useState(false)
  const rowMenuRef = useRef<HTMLDivElement | null>(null)
  const skillDocumentPath = getSkillDocumentPath(node)
  const isEnabled = node.enabled ?? true
  const isSelected = containsSkillTreePath(node, activeFilePath)
  const isManaged = !node.readOnly
  const isRenameDraftVisible = isManaged && renamingGlobalSkillDraftDirectory === node.path
  const isPending =
    deletingGlobalSkillDirectory === node.path ||
    renamingGlobalSkillDirectory === node.path ||
    isRenameDraftVisible

  useEffect(() => {
    if (!isRowMenuOpen) return

    function handlePointerDown(event: globalThis.PointerEvent) {
      if (rowMenuRef.current?.contains(event.target as Node | null)) return
      setIsRowMenuOpen(false)
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return
      setIsRowMenuOpen(false)
    }

    window.addEventListener("pointerdown", handlePointerDown)
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown)
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [isRowMenuOpen])

  function handleSelect() {
    if (!skillDocumentPath) return
    onLocalSkillSelect?.()
    void onFileSelect(skillDocumentPath)
  }

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
    <div className="skills-workspace-local-row-shell">
      {isRenameDraftVisible ? (
        <form className="skill-tree-rename-form" aria-label={`Rename skill ${node.name}`} onSubmit={handleRenameSubmit}>
          <input
            autoFocus
            className="skill-tree-rename-input"
            aria-label={`Rename global skill ${node.name}`}
            disabled={renamingGlobalSkillDirectory === node.path}
            type="text"
            value={renamingGlobalSkillName}
            onBlur={handleRenameInputBlur}
            onChange={(event) => onRenameGlobalSkillDraftChange(event.target.value)}
            onKeyDown={handleRenameInputKeyDown}
          />
        </form>
      ) : (
        <button
          className={joinClassNames("skill-library-result-row", "is-navigation", "is-local", isSelected ? "is-selected" : null)}
          type="button"
          aria-label={node.name}
          aria-pressed={isSelected}
          disabled={!skillDocumentPath}
          title={node.path}
          onClick={handleSelect}
        >
          <span className="skill-library-result-main">
            <span className="skill-library-result-title-line">
              <span className="skill-library-result-name">{node.name}</span>
              <span
                className={joinClassNames("skills-workspace-status-dot", isEnabled ? "is-enabled" : "is-disabled")}
                aria-hidden="true"
              />
            </span>
            {groupLabel || node.readOnly ? (
              <span className="skill-library-result-summary">
                {groupLabel || t("skillLibrary.local.readOnly")}
              </span>
            ) : null}
          </span>
        </button>
      )}
      {isManaged ? (
        <div className="skill-tree-menu-shell skills-workspace-local-row-menu" ref={rowMenuRef}>
          <button
            className={isRowMenuOpen ? "row-action skill-tree-row-action is-open" : "row-action skill-tree-row-action"}
            type="button"
            aria-expanded={isRowMenuOpen}
            aria-haspopup="menu"
            aria-label={`Actions for ${node.name}`}
            disabled={isPending}
            title={`Actions for ${node.name}`}
            onClick={() => setIsRowMenuOpen((current) => !current)}
          >
            <MoreIcon />
          </button>
          {isRowMenuOpen ? (
            <div className="global-skills-install-menu skill-tree-row-menu" role="menu" aria-label={`${node.name} actions`}>
              <button
                className="global-skills-install-menu-item"
                role="menuitem"
                type="button"
                onClick={() => {
                  setIsRowMenuOpen(false)
                  void onOpenGlobalSkillsFolder(node.path)
                }}
              >
                {t("skillLibrary.local.openFileLocation")}
              </button>
              <button
                className="global-skills-install-menu-item"
                role="menuitem"
                type="button"
                onClick={() => {
                  setIsRowMenuOpen(false)
                  onRenameGlobalSkillDraftStart(node.path)
                }}
              >
                {t("skillLibrary.local.rename")}
              </button>
              <button
                className="global-skills-install-menu-item"
                role="menuitem"
                type="button"
                onClick={() => {
                  setIsRowMenuOpen(false)
                  onMoveGlobalSkillDirectoryStart(node.path)
                }}
              >
                {t("skillLibrary.local.moveToFolder")}
              </button>
              <button
                className="global-skills-install-menu-item"
                role="menuitem"
                type="button"
                onClick={() => {
                  setIsRowMenuOpen(false)
                  void onDeleteGlobalSkill(node.path)
                }}
              >
                {t("skillLibrary.local.deleteSkill")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function GlobalSkillsTreeNodeRow({
  creatingGlobalSkillDraftKind,
  creatingGlobalSkillName,
  creatingGlobalSkillParentDirectory,
  deletingGlobalSkillDirectory,
  expandedSkillPaths,
  isCreateGlobalSkillDraftVisible,
  isCreatingGlobalSkill,
  node,
  renamingGlobalSkillDirectory,
  renamingGlobalSkillDraftDirectory,
  renamingGlobalSkillName,
  activeSkillTreePath,
  onCreateGlobalSkill,
  onCreateGlobalSkillDraftCancel,
  onCreateGlobalSkillDraftChange,
  onCreateGlobalSkillDraftStart,
  onDeleteGlobalSkill,
  onDirectoryToggle,
  onFileSelect,
  onMoveGlobalSkillDirectoryStart,
  onOpenGlobalSkillsFolder,
  onRenameGlobalSkill,
  onRenameGlobalSkillDraftCancel,
  onRenameGlobalSkillDraftChange,
  onRenameGlobalSkillDraftStart,
  onLocalSkillSelect,
}: {
  creatingGlobalSkillDraftKind: CreateGlobalSkillDraftKind
  creatingGlobalSkillName: string
  creatingGlobalSkillParentDirectory: string | null
  deletingGlobalSkillDirectory: string | null
  expandedSkillPaths: string[]
  isCreateGlobalSkillDraftVisible: boolean
  isCreatingGlobalSkill: boolean
  node: GlobalSkillTreeNode
  renamingGlobalSkillDirectory: string | null
  renamingGlobalSkillDraftDirectory: string | null
  renamingGlobalSkillName: string
  activeSkillTreePath: string | null
  onCreateGlobalSkill: () => void | Promise<void>
  onCreateGlobalSkillDraftCancel: () => void
  onCreateGlobalSkillDraftChange: (value: string) => void
  onCreateGlobalSkillDraftStart: (kind?: CreateGlobalSkillDraftKind, parentDirectory?: string | null) => void
  onDeleteGlobalSkill: (directoryPath?: string) => void | Promise<void>
  onDirectoryToggle: (path: string) => void
  onFileSelect: (path: string) => void | Promise<void>
  onMoveGlobalSkillDirectoryStart: (directoryPath: string) => void
  onOpenGlobalSkillsFolder: (targetPath?: string) => void | Promise<void>
  onRenameGlobalSkill: () => void | Promise<void>
  onRenameGlobalSkillDraftCancel: () => void
  onRenameGlobalSkillDraftChange: (value: string) => void
  onRenameGlobalSkillDraftStart: (directoryPath: string) => void
  onLocalSkillSelect?: () => void
}) {
  const { t } = useI18n()
  const [isRowMenuOpen, setIsRowMenuOpen] = useState(false)
  const rowMenuRef = useRef<HTMLDivElement | null>(null)
  const role = node.kind === "directory" ? getDirectoryRole(node) : "resource"
  const isReadOnlyNode = Boolean(node.readOnly)
  const isManagedDirectory = !isReadOnlyNode && (role === "folder" || role === "skill")

  useEffect(() => {
    if (!isRowMenuOpen) return

    function handlePointerDown(event: globalThis.PointerEvent) {
      if (rowMenuRef.current?.contains(event.target as Node | null)) return
      setIsRowMenuOpen(false)
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return
      setIsRowMenuOpen(false)
    }

    window.addEventListener("pointerdown", handlePointerDown)
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown)
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [isRowMenuOpen])

  if (node.kind === "file") {
    const isActive = node.path === activeSkillTreePath

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
          onClick={() => {
            onLocalSkillSelect?.()
            void onFileSelect(node.path)
          }}
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
  const isActiveDirectory = node.path === activeSkillTreePath
  const isRenameDraftVisible = isManagedDirectory && renamingGlobalSkillDraftDirectory === node.path
  const isRenamePending = renamingGlobalSkillDirectory === node.path
  const showLeadingDisclosure = role !== "folder"
  const showRoleIcon = role === "folder"
  const showCreateInDirectory = !isReadOnlyNode && isCreateGlobalSkillDraftVisible && creatingGlobalSkillParentDirectory === node.path
  const showChildren = isExpanded && (Boolean(node.children?.length) || showCreateInDirectory)

  function handleDirectoryContextMenu(event: MouseEvent<HTMLButtonElement>) {
    if (isReadOnlyNode || !isManagedDirectory || isRenameDraftVisible || isRenamePending) return
    event.preventDefault()
    event.stopPropagation()
    setIsRowMenuOpen(true)
  }

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

  function handleRowMenuToggle() {
    if (isReadOnlyNode || isRenameDraftVisible || isRenamePending) return
    setIsRowMenuOpen((current) => !current)
  }

  function handleNewSkillHere() {
    setIsRowMenuOpen(false)
    onCreateGlobalSkillDraftStart("skill", node.path)
  }

  function handleNewFolderHere() {
    setIsRowMenuOpen(false)
    onCreateGlobalSkillDraftStart("folder", node.path)
  }

  function handleRenameDirectory() {
    setIsRowMenuOpen(false)
    onRenameGlobalSkillDraftStart(node.path)
  }

  function handleDeleteDirectory() {
    setIsRowMenuOpen(false)
    void onDeleteGlobalSkill(node.path)
  }

  function handleMoveDirectory() {
    setIsRowMenuOpen(false)
    onMoveGlobalSkillDirectoryStart(node.path)
  }

  function handleOpenFileLocation() {
    setIsRowMenuOpen(false)
    void onOpenGlobalSkillsFolder(node.path)
  }

  return (
    <div className="skill-tree-item">
      <div className="skill-tree-row-shell">
        {isRenameDraftVisible ? (
          <form className="skill-tree-rename-form" aria-label={`Rename ${role} ${node.name}`} onSubmit={handleRenameSubmit}>
            {showLeadingDisclosure ? (
              <span className="skill-tree-leading" aria-hidden="true">
                {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
              </span>
            ) : (
              <span className={`skill-tree-role-icon is-${role}`} aria-hidden="true">
                {isExpanded ? <FolderOpenIcon /> : <FolderIcon />}
              </span>
            )}
            <input
              autoFocus
              className="skill-tree-rename-input"
              aria-label={`Rename global ${role} ${node.name}`}
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
              showLeadingDisclosure ? "has-leading-disclosure" : "",
              isActiveDirectory ? "is-active" : "",
              isReadOnlyNode ? "is-read-only" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-expanded={isExpanded}
            title={node.path}
            type="button"
            onClick={() => {
              onLocalSkillSelect?.()
              onDirectoryToggle(node.path)
            }}
            onContextMenu={handleDirectoryContextMenu}
          >
            {showLeadingDisclosure ? (
              <span className="skill-tree-leading" aria-hidden="true">
                {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
              </span>
            ) : null}
            {showRoleIcon ? (
              <span className={`skill-tree-role-icon is-${role}`} aria-hidden="true">
                {isExpanded ? <FolderOpenIcon /> : <FolderIcon />}
              </span>
            ) : null}
            <span className="skill-tree-label">{node.name}</span>
          </button>
        )}
        {isManagedDirectory ? (
          <div className="skill-tree-menu-shell" ref={rowMenuRef}>
            <button
              className={isRowMenuOpen ? "row-action skill-tree-row-action is-open" : "row-action skill-tree-row-action"}
              aria-expanded={isRowMenuOpen}
              aria-haspopup="menu"
              aria-label={`Actions for ${node.name}`}
              disabled={deletingGlobalSkillDirectory === node.path || isRenameDraftVisible || isRenamePending}
              title={`Actions for ${node.name}`}
              type="button"
              onClick={handleRowMenuToggle}
            >
              <MoreIcon />
            </button>
            {isRowMenuOpen ? (
              <div className="global-skills-install-menu skill-tree-row-menu" role="menu" aria-label={`${node.name} actions`}>
                {role === "folder" ? (
                  <>
                    <button className="global-skills-install-menu-item" role="menuitem" type="button" onClick={handleNewSkillHere}>
                      New skill here
                    </button>
                    <button className="global-skills-install-menu-item" role="menuitem" type="button" onClick={handleNewFolderHere}>
                      New folder here
                    </button>
                  </>
                ) : null}
                <button className="global-skills-install-menu-item" role="menuitem" type="button" onClick={handleOpenFileLocation}>
                  {t("skillLibrary.local.openFileLocation")}
                </button>
                <button className="global-skills-install-menu-item" role="menuitem" type="button" onClick={handleRenameDirectory}>
                  {t("skillLibrary.local.rename")}
                </button>
                <button className="global-skills-install-menu-item" role="menuitem" type="button" onClick={handleMoveDirectory}>
                  {role === "folder"
                    ? t("skillLibrary.local.moveTo")
                    : t("skillLibrary.local.moveToFolder")}
                </button>
                <button className="global-skills-install-menu-item" role="menuitem" type="button" onClick={handleDeleteDirectory}>
                  {role === "folder"
                    ? t("skillLibrary.local.deleteEmptyFolder")
                    : t("skillLibrary.local.deleteSkill")}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {showChildren ? (
        <div className="skill-tree-children">
          {(node.children ?? []).map((child) => (
            <GlobalSkillsTreeNodeRow
              key={child.path}
              creatingGlobalSkillDraftKind={creatingGlobalSkillDraftKind}
              creatingGlobalSkillName={creatingGlobalSkillName}
              creatingGlobalSkillParentDirectory={creatingGlobalSkillParentDirectory}
              deletingGlobalSkillDirectory={deletingGlobalSkillDirectory}
              expandedSkillPaths={expandedSkillPaths}
              isCreateGlobalSkillDraftVisible={isCreateGlobalSkillDraftVisible}
              isCreatingGlobalSkill={isCreatingGlobalSkill}
              node={child}
              renamingGlobalSkillDirectory={renamingGlobalSkillDirectory}
              renamingGlobalSkillDraftDirectory={renamingGlobalSkillDraftDirectory}
              renamingGlobalSkillName={renamingGlobalSkillName}
              activeSkillTreePath={activeSkillTreePath}
              onCreateGlobalSkill={onCreateGlobalSkill}
              onCreateGlobalSkillDraftCancel={onCreateGlobalSkillDraftCancel}
              onCreateGlobalSkillDraftChange={onCreateGlobalSkillDraftChange}
              onCreateGlobalSkillDraftStart={onCreateGlobalSkillDraftStart}
              onDeleteGlobalSkill={onDeleteGlobalSkill}
              onDirectoryToggle={onDirectoryToggle}
              onFileSelect={onFileSelect}
              onMoveGlobalSkillDirectoryStart={onMoveGlobalSkillDirectoryStart}
              onOpenGlobalSkillsFolder={onOpenGlobalSkillsFolder}
              onRenameGlobalSkill={onRenameGlobalSkill}
              onRenameGlobalSkillDraftCancel={onRenameGlobalSkillDraftCancel}
              onRenameGlobalSkillDraftChange={onRenameGlobalSkillDraftChange}
              onRenameGlobalSkillDraftStart={onRenameGlobalSkillDraftStart}
              onLocalSkillSelect={onLocalSkillSelect}
            />
          ))}
          {showCreateInDirectory ? (
            <CreateGlobalSkillForm
              creatingGlobalSkillName={creatingGlobalSkillName}
              draftKind={creatingGlobalSkillDraftKind}
              isCreatingGlobalSkill={isCreatingGlobalSkill}
              onCancel={onCreateGlobalSkillDraftCancel}
              onChange={onCreateGlobalSkillDraftChange}
              onSubmit={onCreateGlobalSkill}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function GlobalSkillsNavigator({
  creatingGlobalSkillName,
  creatingGlobalSkillDraftKind,
  creatingGlobalSkillParentDirectory,
  deletingGlobalSkillDirectory,
  expandedSkillPaths,
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
  onMoveGlobalSkillDirectoryStart,
  onOpenGlobalSkillsFolder,
  onRenameGlobalSkill,
  onRenameGlobalSkillDraftCancel,
  onRenameGlobalSkillDraftChange,
  onRenameGlobalSkillDraftStart,
  downloadedSkills = [],
  selectedDownloadedSkillID = null,
  selectedSkillSource = "local",
  sourceFilter = "local",
  statusFilter = "all",
  searchTerm,
  unified = false,
  onDownloadedSkillSelect,
  onLocalSkillSelect,
  onSearchTermChange,
}: GlobalSkillsNavigatorProps) {
  const { t } = useI18n()
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false)
  const [internalSkillSearchTerm, setInternalSkillSearchTerm] = useState("")
  const createMenuRef = useRef<HTMLDivElement | null>(null)
  const skillSearchTerm = searchTerm ?? internalSkillSearchTerm
  const setSkillSearchTerm = onSearchTermChange ?? setInternalSkillSearchTerm
  const normalizedSkillSearchTerm = normalizeSkillSearchTerm(skillSearchTerm)
  const isSkillSearchActive = normalizedSkillSearchTerm.length > 0
  const sortedGlobalSkillsTree = useMemo(() => sortGlobalSkillTree(globalSkillsTree), [globalSkillsTree])
  const sourceFilteredGlobalSkillsTree = useMemo(
    () => filterGlobalSkillTreeByLibraryFilters(sortedGlobalSkillsTree, sourceFilter, statusFilter),
    [sortedGlobalSkillsTree, sourceFilter, statusFilter],
  )
  const visibleGlobalSkillsTree = isSkillSearchActive
    ? filterGlobalSkillTree(sourceFilteredGlobalSkillsTree, normalizedSkillSearchTerm)
    : sourceFilteredGlobalSkillsTree
  const visibleLocalSkillEntries = useMemo(() => {
    const entries = collectGlobalSkillListEntries(sourceFilteredGlobalSkillsTree)
    if (!normalizedSkillSearchTerm) return entries

    return entries.filter(({ groupLabel, node }) => [node.name, groupLabel, node.pluginID]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(normalizedSkillSearchTerm)))
  }, [normalizedSkillSearchTerm, sourceFilteredGlobalSkillsTree])
  const visibleDownloadedSkills = useMemo(() => {
    if (sourceFilter !== "all" && sourceFilter !== "downloaded") return []
    return downloadedSkills.filter((skill) => {
      if (statusFilter !== "all" && skill.enabled !== (statusFilter === "enabled")) return false
      if (!normalizedSkillSearchTerm) return true
      return [skill.displayName, skill.slug, skill.description, skill.author.displayName, skill.author.handle]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalizedSkillSearchTerm))
    })
  }, [downloadedSkills, normalizedSkillSearchTerm, sourceFilter, statusFilter])
  const effectiveExpandedSkillPaths = isSkillSearchActive
    ? collectDirectorySkillTreePaths(visibleGlobalSkillsTree)
    : expandedSkillPaths
  const activeSkillTreePath = findVisibleActiveSkillTreePath(
    visibleGlobalSkillsTree,
    selectedSkillSource === "local" ? selectedGlobalSkillFilePath : null,
    effectiveExpandedSkillPaths,
  )
  const isCreateButtonDisabled =
    isCreatingGlobalSkill ||
    isCreateGlobalSkillDraftVisible ||
    Boolean(renamingGlobalSkillDraftDirectory || renamingGlobalSkillDirectory)

  useEffect(() => {
    if (!isCreateMenuOpen) return

    function handlePointerDown(event: globalThis.PointerEvent) {
      if (createMenuRef.current?.contains(event.target as Node | null)) return
      setIsCreateMenuOpen(false)
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return
      setIsCreateMenuOpen(false)
    }

    window.addEventListener("pointerdown", handlePointerDown)
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown)
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [isCreateMenuOpen])

  function handleCreateMenuToggle() {
    if (isCreateButtonDisabled) return
    setIsCreateMenuOpen((current) => !current)
  }

  function handleCreateSkillAtRoot() {
    setIsCreateMenuOpen(false)
    onCreateGlobalSkillDraftStart("skill", null)
  }

  function handleCreateFolderAtRoot() {
    setIsCreateMenuOpen(false)
    onCreateGlobalSkillDraftStart("folder", null)
  }

  return (
    <section className={unified ? "global-skills-navigator is-unified" : "global-skills-navigator"} aria-label="Global skills library">
      <div className="skills-tree-root">
        {!unified ? <div className="skills-tree-search-row" aria-label="Global skills search" role="search">
          <SearchIcon />
          <input
            aria-label="Search skills"
            autoComplete="off"
            placeholder="搜索 skills"
            type="search"
            value={skillSearchTerm}
            onChange={(event) => setSkillSearchTerm(event.target.value)}
          />
          {skillSearchTerm ? (
            <button
              aria-label="Clear skills search"
              title="Clear search"
              type="button"
              onClick={() => setSkillSearchTerm("")}
            >
              <CloseIcon />
            </button>
          ) : null}
        </div> : null}
        {isLoadingSkillsTree && globalSkillsTree.length === 0 ? (
          <p className="skills-tree-empty">Loading skills...</p>
        ) : unified && visibleLocalSkillEntries.length > 0 ? (
          <section className="skills-workspace-local-skill-list" aria-label={t("skillLibrary.mode.local")}>
            {visibleLocalSkillEntries.map((entry) => (
              <GlobalSkillListRow
                key={entry.node.path}
                activeFilePath={selectedSkillSource === "local" ? selectedGlobalSkillFilePath : null}
                deletingGlobalSkillDirectory={deletingGlobalSkillDirectory}
                entry={entry}
                renamingGlobalSkillDirectory={renamingGlobalSkillDirectory}
                renamingGlobalSkillDraftDirectory={renamingGlobalSkillDraftDirectory}
                renamingGlobalSkillName={renamingGlobalSkillName}
                onDeleteGlobalSkill={onDeleteGlobalSkill}
                onFileSelect={onGlobalSkillFileSelect}
                onLocalSkillSelect={onLocalSkillSelect}
                onMoveGlobalSkillDirectoryStart={onMoveGlobalSkillDirectoryStart}
                onOpenGlobalSkillsFolder={onOpenGlobalSkillsFolder}
                onRenameGlobalSkill={onRenameGlobalSkill}
                onRenameGlobalSkillDraftCancel={onRenameGlobalSkillDraftCancel}
                onRenameGlobalSkillDraftChange={onRenameGlobalSkillDraftChange}
                onRenameGlobalSkillDraftStart={onRenameGlobalSkillDraftStart}
              />
            ))}
          </section>
        ) : !unified && visibleGlobalSkillsTree.length > 0 ? (
          visibleGlobalSkillsTree.map((node) => (
            <GlobalSkillsTreeNodeRow
              key={node.path}
              creatingGlobalSkillDraftKind={creatingGlobalSkillDraftKind}
              creatingGlobalSkillName={creatingGlobalSkillName}
              creatingGlobalSkillParentDirectory={creatingGlobalSkillParentDirectory}
              deletingGlobalSkillDirectory={deletingGlobalSkillDirectory}
              expandedSkillPaths={effectiveExpandedSkillPaths}
              isCreateGlobalSkillDraftVisible={isCreateGlobalSkillDraftVisible}
              isCreatingGlobalSkill={isCreatingGlobalSkill}
              node={node}
              renamingGlobalSkillDirectory={renamingGlobalSkillDirectory}
              renamingGlobalSkillDraftDirectory={renamingGlobalSkillDraftDirectory}
              renamingGlobalSkillName={renamingGlobalSkillName}
              activeSkillTreePath={activeSkillTreePath}
              onCreateGlobalSkill={onCreateGlobalSkill}
              onCreateGlobalSkillDraftCancel={onCreateGlobalSkillDraftCancel}
              onCreateGlobalSkillDraftChange={onCreateGlobalSkillDraftChange}
              onCreateGlobalSkillDraftStart={onCreateGlobalSkillDraftStart}
              onDeleteGlobalSkill={onDeleteGlobalSkill}
              onDirectoryToggle={onGlobalSkillDirectoryToggle}
              onFileSelect={onGlobalSkillFileSelect}
              onMoveGlobalSkillDirectoryStart={onMoveGlobalSkillDirectoryStart}
              onOpenGlobalSkillsFolder={onOpenGlobalSkillsFolder}
              onRenameGlobalSkill={onRenameGlobalSkill}
              onRenameGlobalSkillDraftCancel={onRenameGlobalSkillDraftCancel}
              onRenameGlobalSkillDraftChange={onRenameGlobalSkillDraftChange}
              onRenameGlobalSkillDraftStart={onRenameGlobalSkillDraftStart}
              onLocalSkillSelect={onLocalSkillSelect}
            />
          ))
        ) : sourceFilter !== "downloaded" && (!unified || visibleDownloadedSkills.length === 0) && isSkillSearchActive && globalSkillsTree.length > 0 ? (
          <p className="skills-tree-empty">No skills match your search.</p>
        ) : sourceFilter !== "downloaded" && (!unified || visibleDownloadedSkills.length === 0) ? (
          <p className="skills-tree-empty">No skills exist yet. Use + to create the first one.</p>
        ) : null}

        {visibleDownloadedSkills.length > 0 ? (
          <section className="skills-workspace-downloaded-group" aria-label={t("skillLibrary.downloadedAria")}>
            <div className="skills-workspace-list-heading">
              <span>Downloaded</span>
              <span>{visibleDownloadedSkills.length}</span>
            </div>
            {visibleDownloadedSkills.map((skill) => (
              <button
                key={skill.id}
                className={joinClassNames(
                  "skill-library-result-row",
                  "is-navigation",
                  "is-downloaded",
                  selectedSkillSource === "downloaded" && selectedDownloadedSkillID === skill.id ? "is-selected" : null,
                )}
                type="button"
                aria-pressed={selectedSkillSource === "downloaded" && selectedDownloadedSkillID === skill.id}
                onClick={() => onDownloadedSkillSelect?.(skill.id)}
              >
                <span className="skill-library-result-main">
                  <span className="skill-library-result-title-line">
                    <span className="skill-library-result-name">{skill.displayName}</span>
                    <span className={joinClassNames("skills-workspace-status-dot", skill.enabled ? "is-enabled" : "is-disabled")} aria-label={skill.enabled ? "Enabled" : "Disabled"} />
                  </span>
                  <span className="skill-library-result-summary">{skill.description || skill.slug}</span>
                </span>
              </button>
            ))}
          </section>
        ) : sourceFilter === "downloaded" ? (
          <p className="skills-tree-empty">{t("skillLibrary.downloadedFilteredEmpty")}</p>
        ) : null}

        {sourceFilter !== "downloaded" && isCreateGlobalSkillDraftVisible && creatingGlobalSkillParentDirectory === null ? (
          <CreateGlobalSkillForm
            creatingGlobalSkillName={creatingGlobalSkillName}
            draftKind={creatingGlobalSkillDraftKind}
            isCreatingGlobalSkill={isCreatingGlobalSkill}
            onCancel={onCreateGlobalSkillDraftCancel}
            onChange={onCreateGlobalSkillDraftChange}
            onSubmit={onCreateGlobalSkill}
          />
        ) : sourceFilter !== "downloaded" ? (
          <div className="global-skills-new-menu-shell" ref={createMenuRef}>
            <button
              className={isCreateMenuOpen ? "secondary-button global-skills-new-button is-open" : "secondary-button global-skills-new-button"}
              aria-expanded={isCreateMenuOpen}
              aria-haspopup="menu"
              aria-label="Create global skill or folder"
              disabled={isCreateButtonDisabled}
              title="Create global skill or folder"
              type="button"
              onClick={handleCreateMenuToggle}
            >
              <PlusIcon />
            </button>
            {isCreateMenuOpen ? (
              <div className="global-skills-install-menu global-skills-new-menu" role="menu" aria-label="Create options">
                <button className="global-skills-install-menu-item" role="menuitem" type="button" onClick={handleCreateSkillAtRoot}>
                  New skill
                </button>
                <button className="global-skills-install-menu-item" role="menuitem" type="button" onClick={handleCreateFolderAtRoot}>
                  New folder
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}

function GlobalSkillGitInstallDialog({
  folderOptions,
  gitInstallPreview,
  gitInstallSource,
  gitInstallTargetDirectory,
  isInstallingGitSkills,
  isPreviewingGitInstall,
  selectedGitInstallSkillIDs,
  onClose,
  onInstall,
  onPreview,
  onSourceChange,
  onTargetDirectoryChange,
  onToggleSkill,
}: GlobalSkillGitInstallDialogProps) {
  const isBusy = isPreviewingGitInstall || isInstallingGitSkills
  const selectedCount = selectedGitInstallSkillIDs.length

  function handlePreviewSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void onPreview()
  }

  return (
    <div className="global-skills-git-install-overlay">
      <section className="global-skills-git-install-modal" role="dialog" aria-modal="true" aria-label="Install skills from Git">
        <header className="global-skills-git-install-header">
          <div>
            <h3>Install Skills from Git</h3>
            <p>Preview the repository, then select the skills to install.</p>
          </div>
          <button
            className="row-action global-skills-git-install-close"
            aria-label="Close Git skill install"
            disabled={isBusy}
            title="Close"
            type="button"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <form className="global-skills-git-install-form" onSubmit={handlePreviewSubmit}>
          <label className="global-skills-git-install-label" htmlFor="global-skills-git-source">
            Repository
          </label>
          <input
            id="global-skills-git-source"
            className="global-skills-git-install-input"
            aria-label="Git skill repository"
            disabled={isBusy}
            placeholder="user/repo, github.com/user/repo, or Git clone URL"
            type="text"
            value={gitInstallSource}
            onChange={(event) => onSourceChange(event.target.value)}
          />
          <div className="global-skills-git-install-help">
            <span>Supported formats:</span>
            <code>user/repo</code>
            <code>github.com/user/repo</code>
            <code>https://github.com/user/repo</code>
            <code>https://github.com/user/repo/tree/main/skills/my-skill</code>
            <code>https://github.com/user/repo/blob/main/skills/my-skill/SKILL.md</code>
            <code>git@github.com:user/repo.git</code>
            <code>https://git.example.com/user/repo.git</code>
          </div>
          <label className="global-skills-git-install-label" htmlFor="global-skills-git-target">
            Destination
          </label>
          <select
            id="global-skills-git-target"
            className="global-skills-target-select"
            aria-label="Git skill install destination"
            disabled={isBusy}
            value={gitInstallTargetDirectory ?? ""}
            onChange={(event) => onTargetDirectoryChange(readFolderOptionValue(event.target.value))}
          >
            {folderOptions.map((option) => (
              <option key={getFolderOptionValue(option)} value={getFolderOptionValue(option)}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="global-skills-git-install-actions">
            <button className="secondary-button" disabled={isBusy || !gitInstallSource.trim()} type="submit">
              {isPreviewingGitInstall ? "Previewing..." : "Preview"}
            </button>
          </div>
        </form>

        {gitInstallPreview ? (
          <section className="global-skills-git-install-preview" aria-label="Git skill install preview">
            <div className="global-skills-git-install-preview-meta">
              <span>{gitInstallPreview.cloneUrl}</span>
              {gitInstallPreview.ref ? <span>branch: {gitInstallPreview.ref}</span> : null}
              {gitInstallPreview.subpath ? <span>path: {gitInstallPreview.subpath}</span> : null}
            </div>
            <div className="global-skills-git-install-list">
              {gitInstallPreview.skills.map((skill) => {
                const checked = selectedGitInstallSkillIDs.includes(skill.id)
                return (
                  <label
                    key={skill.id}
                    className={skill.available ? "global-skills-git-install-skill" : "global-skills-git-install-skill is-disabled"}
                  >
                    <input
                      checked={checked}
                      disabled={!skill.available || isBusy}
                      type="checkbox"
                      onChange={() => onToggleSkill(skill.id)}
                    />
                    <span className="global-skills-git-install-skill-body">
                      <strong>{skill.name}</strong>
                      <span>{skill.description}</span>
                      <code>{skill.relativePath}</code>
                      {skill.reason ? <em>{skill.reason}</em> : null}
                    </span>
                  </label>
                )
              })}
            </div>
          </section>
        ) : null}

        <footer className="global-skills-git-install-footer">
          <button className="secondary-button" disabled={isBusy} type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={!gitInstallPreview || selectedCount === 0 || isBusy}
            type="button"
            onClick={() => void onInstall()}
          >
            {isInstallingGitSkills ? "Installing..." : `Install${selectedCount > 0 ? ` (${selectedCount})` : ""}`}
          </button>
        </footer>
      </section>
    </div>
  )
}

function GlobalSkillLocalInstallDialog({
  folderOptions,
  isInstallingLocalSkill,
  targetDirectory,
  onClose,
  onInstall,
  onTargetDirectoryChange,
}: GlobalSkillLocalInstallDialogProps) {
  return (
    <div className="global-skills-git-install-overlay">
      <section className="global-skills-git-install-modal is-compact" role="dialog" aria-modal="true" aria-label="Install local skill">
        <header className="global-skills-git-install-header">
          <div>
            <h3>Install Local Skill</h3>
            <p>Select the destination folder, then choose a SKILL.md file.</p>
          </div>
          <button
            className="row-action global-skills-git-install-close"
            aria-label="Close local skill install"
            disabled={isInstallingLocalSkill}
            title="Close"
            type="button"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <label className="global-skills-git-install-label" htmlFor="global-skills-local-target">
          Destination
        </label>
        <select
          id="global-skills-local-target"
          className="global-skills-target-select"
          aria-label="Local skill install destination"
          disabled={isInstallingLocalSkill}
          value={targetDirectory ?? ""}
          onChange={(event) => onTargetDirectoryChange(readFolderOptionValue(event.target.value))}
        >
          {folderOptions.map((option) => (
            <option key={getFolderOptionValue(option)} value={getFolderOptionValue(option)}>
              {option.label}
            </option>
          ))}
        </select>

        <footer className="global-skills-git-install-footer">
          <button className="secondary-button" disabled={isInstallingLocalSkill} type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={isInstallingLocalSkill} type="button" onClick={() => void onInstall()}>
            {isInstallingLocalSkill ? "Installing..." : "Choose SKILL.md"}
          </button>
        </footer>
      </section>
    </div>
  )
}

function GlobalSkillMoveDialog({
  isMoving,
  sourceName,
  targetDirectory,
  targetOptions,
  onClose,
  onMove,
  onTargetDirectoryChange,
}: GlobalSkillMoveDialogProps) {
  return (
    <div className="global-skills-git-install-overlay">
      <section className="global-skills-git-install-modal is-compact" role="dialog" aria-modal="true" aria-label="Move skill or folder">
        <header className="global-skills-git-install-header">
          <div>
            <h3>Move {sourceName}</h3>
            <p>Select a destination folder.</p>
          </div>
          <button
            className="row-action global-skills-git-install-close"
            aria-label="Close move dialog"
            disabled={isMoving}
            title="Close"
            type="button"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <label className="global-skills-git-install-label" htmlFor="global-skills-move-target">
          Destination
        </label>
        <select
          id="global-skills-move-target"
          className="global-skills-target-select"
          aria-label="Move destination"
          disabled={isMoving}
          value={targetDirectory ?? ""}
          onChange={(event) => onTargetDirectoryChange(readFolderOptionValue(event.target.value))}
        >
          {targetOptions.map((option) => (
            <option key={getFolderOptionValue(option)} value={getFolderOptionValue(option)}>
              {option.label}
            </option>
          ))}
        </select>

        <footer className="global-skills-git-install-footer">
          <button className="secondary-button" disabled={isMoving} type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={isMoving} type="button" onClick={() => void onMove()}>
            {isMoving ? "Moving..." : "Move"}
          </button>
        </footer>
      </section>
    </div>
  )
}

export function GlobalSkillsPage({
  creatingGlobalSkillName,
  creatingGlobalSkillDraftKind,
  creatingGlobalSkillParentDirectory,
  deletingGlobalSkillDirectory,
  expandedSkillPaths,
  globalSkillFolderOptions,
  globalSkillsRoot,
  globalSkillsTree,
  gitInstallTargetDirectory,
  gitInstallPreview,
  gitInstallSource,
  isCreateGlobalSkillDraftVisible,
  isCreatingGlobalSkill,
  isDirty,
  isGitInstallDialogOpen,
  isInstallingGitSkills,
  isInstallingLocalSkill,
  isLocalInstallDialogOpen,
  isLoadingFile,
  isLoadingSkillsTree,
  isMoveGlobalSkillDialogOpen,
  isMovingGlobalSkillDirectory,
  isPreviewingGitInstall,
  isSavingFile,
  localInstallTargetDirectory,
  moveGlobalSkillTargetOptions,
  movingGlobalSkillDirectory,
  movingGlobalSkillTargetDirectory,
  renamingGlobalSkillDirectory,
  renamingGlobalSkillDraftDirectory,
  renamingGlobalSkillName,
  selectedFileContent,
  selectedFilePath,
  selectedFileReadOnly,
  selectedGitInstallSkillIDs,
  selectedSkillDirectoryName,
  hideTopMenu = false,
  hideNavigator = false,
  windowControls,
  onChange,
  onCreateGlobalSkill,
  onCreateGlobalSkillDraftCancel,
  onCreateGlobalSkillDraftChange,
  onCreateGlobalSkillDraftStart,
  onDeleteGlobalSkill,
  onGitInstallDialogClose,
  onGitInstallDialogOpen,
  onGitInstallSkillToggle,
  onGitInstallSourceChange,
  onGitInstallTargetDirectoryChange,
  onGlobalSkillDirectoryToggle,
  onGlobalSkillFileSelect,
  onInstallGitSkills,
  onInstallLocalSkillFile,
  onLocalInstallDialogClose,
  onLocalInstallDialogOpen,
  onLocalInstallTargetDirectoryChange,
  onMoveGlobalSkillDirectory,
  onMoveGlobalSkillDirectoryCancel,
  onMoveGlobalSkillDirectoryStart,
  onMoveGlobalSkillTargetDirectoryChange,
  onOpenGlobalSkillsFolder,
  onPreviewGitSkillInstall,
  onRenameGlobalSkill,
  onRenameGlobalSkillDraftCancel,
  onRenameGlobalSkillDraftChange,
  onRenameGlobalSkillDraftStart,
  onSave,
}: GlobalSkillsPageProps) {
  const selectedSkillDirectory = findSelectedSkillTreeDirectory(globalSkillsTree, selectedFilePath)

  return (
    <section className={hideTopMenu ? "global-skills-page is-embedded" : "global-skills-page"} aria-label="Global skills">
      {hideTopMenu ? null : (
        <ShellTopMenu
          as="header"
          ariaLabel="Skills top menu"
          className="canvas-region-top-menu global-skills-top-menu"
          contentClassName="canvas-region-top-menu-tabs-shell"
          content={(
            <div className="prompt-presets-top-menu-label">
              <FileTextIcon />
              <span>Skills</span>
            </div>
          )}
          dragRegion
          layout="three-column"
          trailing={windowControls}
          trailingClassName="prompt-presets-top-menu-window-controls"
        />
      )}

      <div className={hideNavigator ? "settings-page-main is-services global-skills-page-main is-sidebar-hosted" : "settings-page-main is-services global-skills-page-main"}>
        <section
          className={hideNavigator ? "settings-services-layout global-skills-page-layout is-sidebar-hosted" : "settings-services-layout global-skills-page-layout"}
          aria-label="Global skill layout"
        >
          {!hideNavigator ? (
            <div className="settings-service-list-panel global-skills-library-panel">
              <GlobalSkillsNavigator
                creatingGlobalSkillName={creatingGlobalSkillName}
                creatingGlobalSkillDraftKind={creatingGlobalSkillDraftKind}
                creatingGlobalSkillParentDirectory={creatingGlobalSkillParentDirectory}
                deletingGlobalSkillDirectory={deletingGlobalSkillDirectory}
                expandedSkillPaths={expandedSkillPaths}
                globalSkillsRoot={globalSkillsRoot}
                globalSkillsTree={globalSkillsTree}
                isCreateGlobalSkillDraftVisible={isCreateGlobalSkillDraftVisible}
                isCreatingGlobalSkill={isCreatingGlobalSkill}
                isInstallingLocalSkill={isInstallingLocalSkill}
                isLoadingSkillsTree={isLoadingSkillsTree}
                renamingGlobalSkillDirectory={renamingGlobalSkillDirectory}
                renamingGlobalSkillDraftDirectory={renamingGlobalSkillDraftDirectory}
                renamingGlobalSkillName={renamingGlobalSkillName}
                selectedGlobalSkillFilePath={selectedFilePath}
                onCreateGlobalSkill={onCreateGlobalSkill}
                onCreateGlobalSkillDraftCancel={onCreateGlobalSkillDraftCancel}
                onCreateGlobalSkillDraftChange={onCreateGlobalSkillDraftChange}
                onCreateGlobalSkillDraftStart={onCreateGlobalSkillDraftStart}
                onDeleteGlobalSkill={onDeleteGlobalSkill}
                onGitInstallDialogOpen={onGitInstallDialogOpen}
                onGlobalSkillDirectoryToggle={onGlobalSkillDirectoryToggle}
                onGlobalSkillFileSelect={onGlobalSkillFileSelect}
                onLocalInstallDialogOpen={onLocalInstallDialogOpen}
                onMoveGlobalSkillDirectoryStart={onMoveGlobalSkillDirectoryStart}
                onOpenGlobalSkillsFolder={onOpenGlobalSkillsFolder}
                onRenameGlobalSkill={onRenameGlobalSkill}
                onRenameGlobalSkillDraftCancel={onRenameGlobalSkillDraftCancel}
                onRenameGlobalSkillDraftChange={onRenameGlobalSkillDraftChange}
                onRenameGlobalSkillDraftStart={onRenameGlobalSkillDraftStart}
              />
            </div>
          ) : null}

          <div className="settings-service-detail-panel global-skills-detail-panel">
            <GlobalSkillsCanvas
              globalSkillsRoot={globalSkillsRoot}
              isDirty={isDirty}
              isLoadingFile={isLoadingFile}
              isSavingFile={isSavingFile}
              selectedFileContent={selectedFileContent}
              selectedFilePath={selectedFilePath}
              selectedFileReadOnly={selectedFileReadOnly}
              selectedSkillDirectoryPath={selectedSkillDirectory?.path ?? null}
              selectedSkillDirectoryName={selectedSkillDirectoryName}
              selectedSkillFiles={selectedSkillDirectory?.children ?? []}
              onChange={onChange}
              onFileSelect={onGlobalSkillFileSelect}
              onSave={onSave}
            />
          </div>
        </section>
      </div>

      {isGitInstallDialogOpen ? (
        <GlobalSkillGitInstallDialog
          folderOptions={globalSkillFolderOptions}
          gitInstallPreview={gitInstallPreview}
          gitInstallSource={gitInstallSource}
          gitInstallTargetDirectory={gitInstallTargetDirectory}
          isInstallingGitSkills={isInstallingGitSkills}
          isPreviewingGitInstall={isPreviewingGitInstall}
          selectedGitInstallSkillIDs={selectedGitInstallSkillIDs}
          onClose={onGitInstallDialogClose}
          onInstall={onInstallGitSkills}
          onPreview={onPreviewGitSkillInstall}
          onSourceChange={onGitInstallSourceChange}
          onTargetDirectoryChange={onGitInstallTargetDirectoryChange}
          onToggleSkill={onGitInstallSkillToggle}
        />
      ) : null}
      {isLocalInstallDialogOpen ? (
        <GlobalSkillLocalInstallDialog
          folderOptions={globalSkillFolderOptions}
          isInstallingLocalSkill={isInstallingLocalSkill}
          targetDirectory={localInstallTargetDirectory}
          onClose={onLocalInstallDialogClose}
          onInstall={onInstallLocalSkillFile}
          onTargetDirectoryChange={onLocalInstallTargetDirectoryChange}
        />
      ) : null}
      {isMoveGlobalSkillDialogOpen ? (
        <GlobalSkillMoveDialog
          isMoving={isMovingGlobalSkillDirectory}
          sourceName={findDirectoryName(globalSkillsTree, movingGlobalSkillDirectory)}
          targetDirectory={movingGlobalSkillTargetDirectory}
          targetOptions={moveGlobalSkillTargetOptions}
          onClose={onMoveGlobalSkillDirectoryCancel}
          onMove={onMoveGlobalSkillDirectory}
          onTargetDirectoryChange={onMoveGlobalSkillTargetDirectoryChange}
        />
      ) : null}
    </section>
  )
}
