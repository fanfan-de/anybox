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
import { GlobalSkillsCanvas } from "../canvas/CreateSessionCanvas"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  DownloadIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  MoreIcon,
  PlusIcon,
  SearchIcon,
} from "../icons"
import { ShellTopMenu } from "../shared-ui"
import type { GlobalSkillTreeNode, SkillGitInstallPreview } from "../types"
import type { GlobalSkillFolderOption } from "../use-global-skills"

export type CreateGlobalSkillDraftKind = "skill" | "folder"

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
  onDelete: () => void | Promise<void>
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
  onOpenGlobalSkillsFolder: () => void | Promise<void>
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
  onOpenGlobalSkillsFolder: () => void | Promise<void>
  onLocalInstallDialogOpen: () => void
  onMoveGlobalSkillDirectoryStart: (directoryPath: string) => void
  onRenameGlobalSkill: () => void | Promise<void>
  onRenameGlobalSkillDraftCancel: () => void
  onRenameGlobalSkillDraftChange: (value: string) => void
  onRenameGlobalSkillDraftStart: (directoryPath: string) => void
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
  onRenameGlobalSkill,
  onRenameGlobalSkillDraftCancel,
  onRenameGlobalSkillDraftChange,
  onRenameGlobalSkillDraftStart,
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
  onRenameGlobalSkill: () => void | Promise<void>
  onRenameGlobalSkillDraftCancel: () => void
  onRenameGlobalSkillDraftChange: (value: string) => void
  onRenameGlobalSkillDraftStart: (directoryPath: string) => void
}) {
  const [isRowMenuOpen, setIsRowMenuOpen] = useState(false)
  const rowMenuRef = useRef<HTMLDivElement | null>(null)
  const role = node.kind === "directory" ? getDirectoryRole(node) : "resource"
  const isReadOnlyNode = Boolean(node.readOnly)
  const showPluginBadge = node.scope === "plugin" && node.path.startsWith("plugin-skills://")
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
            onClick={() => onDirectoryToggle(node.path)}
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
            {showPluginBadge ? <span className="skill-tree-source-badge">Plugin</span> : null}
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
                <button className="global-skills-install-menu-item" role="menuitem" type="button" onClick={handleRenameDirectory}>
                  Rename
                </button>
                <button className="global-skills-install-menu-item" role="menuitem" type="button" onClick={handleMoveDirectory}>
                  {role === "folder" ? "Move to..." : "Move to folder..."}
                </button>
                <button className="global-skills-install-menu-item" role="menuitem" type="button" onClick={handleDeleteDirectory}>
                  {role === "folder" ? "Delete empty folder" : "Delete skill"}
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
              onRenameGlobalSkill={onRenameGlobalSkill}
              onRenameGlobalSkillDraftCancel={onRenameGlobalSkillDraftCancel}
              onRenameGlobalSkillDraftChange={onRenameGlobalSkillDraftChange}
              onRenameGlobalSkillDraftStart={onRenameGlobalSkillDraftStart}
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
  globalSkillsRoot,
  globalSkillsTree,
  isCreateGlobalSkillDraftVisible,
  isCreatingGlobalSkill,
  isInstallingLocalSkill,
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
  onGitInstallDialogOpen,
  onGlobalSkillDirectoryToggle,
  onGlobalSkillFileSelect,
  onLocalInstallDialogOpen,
  onMoveGlobalSkillDirectoryStart,
  onOpenGlobalSkillsFolder,
  onRenameGlobalSkill,
  onRenameGlobalSkillDraftCancel,
  onRenameGlobalSkillDraftChange,
  onRenameGlobalSkillDraftStart,
}: GlobalSkillsNavigatorProps) {
  const [isInstallMenuOpen, setIsInstallMenuOpen] = useState(false)
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false)
  const [skillSearchTerm, setSkillSearchTerm] = useState("")
  const installMenuRef = useRef<HTMLDivElement | null>(null)
  const createMenuRef = useRef<HTMLDivElement | null>(null)
  const normalizedSkillSearchTerm = normalizeSkillSearchTerm(skillSearchTerm)
  const isSkillSearchActive = normalizedSkillSearchTerm.length > 0
  const sortedGlobalSkillsTree = useMemo(() => sortGlobalSkillTree(globalSkillsTree), [globalSkillsTree])
  const visibleGlobalSkillsTree = isSkillSearchActive
    ? filterGlobalSkillTree(sortedGlobalSkillsTree, normalizedSkillSearchTerm)
    : sortedGlobalSkillsTree
  const effectiveExpandedSkillPaths = isSkillSearchActive
    ? collectDirectorySkillTreePaths(visibleGlobalSkillsTree)
    : expandedSkillPaths
  const activeSkillTreePath = findVisibleActiveSkillTreePath(
    visibleGlobalSkillsTree,
    selectedGlobalSkillFilePath,
    effectiveExpandedSkillPaths,
  )
  const isInstallButtonDisabled =
    isCreatingGlobalSkill ||
    isCreateGlobalSkillDraftVisible ||
    isInstallingLocalSkill ||
    Boolean(renamingGlobalSkillDraftDirectory || renamingGlobalSkillDirectory)
  const isCreateButtonDisabled =
    isCreatingGlobalSkill ||
    isCreateGlobalSkillDraftVisible ||
    Boolean(renamingGlobalSkillDraftDirectory || renamingGlobalSkillDirectory)

  useEffect(() => {
    if (!isInstallMenuOpen) return

    function handlePointerDown(event: globalThis.PointerEvent) {
      if (installMenuRef.current?.contains(event.target as Node | null)) return
      setIsInstallMenuOpen(false)
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return
      setIsInstallMenuOpen(false)
    }

    window.addEventListener("pointerdown", handlePointerDown)
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown)
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [isInstallMenuOpen])

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

  function handleInstallMenuToggle() {
    if (isInstallButtonDisabled) return
    setIsInstallMenuOpen((current) => !current)
  }

  function handleInstallFromUrl() {
    setIsInstallMenuOpen(false)
    onGitInstallDialogOpen()
  }

  function handleInstallFromLocalFile() {
    setIsInstallMenuOpen(false)
    onLocalInstallDialogOpen()
  }

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
    <section className="global-skills-navigator" aria-label="Global skills library">
      <div className="settings-prompt-section-bar global-skills-section-bar">
        <div className="global-skills-section-actions">
          <button
            className="secondary-button global-skills-open-folder-button"
            aria-label="打开文件位置"
            disabled={!globalSkillsRoot}
            title={globalSkillsRoot ? `打开文件位置: ${globalSkillsRoot}` : "Skills folder is loading"}
            type="button"
            onClick={() => void onOpenGlobalSkillsFolder()}
          >
            <FolderIcon />
            <span>打开文件位置</span>
          </button>
          <div className="global-skills-install-menu-shell" ref={installMenuRef}>
            <button
              className={isInstallMenuOpen ? "secondary-button global-skills-install-button is-open" : "secondary-button global-skills-install-button"}
              aria-expanded={isInstallMenuOpen}
              aria-haspopup="menu"
              aria-label="Install skill"
              disabled={isInstallButtonDisabled}
              title="Install skill"
              type="button"
              onClick={handleInstallMenuToggle}
            >
              <DownloadIcon />
              <span>{isInstallingLocalSkill ? "Installing..." : "Install"}</span>
              <ChevronDownIcon />
            </button>
            {isInstallMenuOpen ? (
              <div className="global-skills-install-menu" role="menu" aria-label="Install skill options">
                <button className="global-skills-install-menu-item" role="menuitem" type="button" onClick={handleInstallFromUrl}>
                  From URL
                </button>
                <button className="global-skills-install-menu-item" role="menuitem" type="button" onClick={handleInstallFromLocalFile}>
                  From local file
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="skills-tree-root">
        <div className="skills-tree-search-row" aria-label="Global skills search" role="search">
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
        </div>
        {isLoadingSkillsTree && globalSkillsTree.length === 0 ? (
          <p className="skills-tree-empty">Loading skills...</p>
        ) : visibleGlobalSkillsTree.length > 0 ? (
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
              onRenameGlobalSkill={onRenameGlobalSkill}
              onRenameGlobalSkillDraftCancel={onRenameGlobalSkillDraftCancel}
              onRenameGlobalSkillDraftChange={onRenameGlobalSkillDraftChange}
              onRenameGlobalSkillDraftStart={onRenameGlobalSkillDraftStart}
            />
          ))
        ) : isSkillSearchActive && globalSkillsTree.length > 0 ? (
          <p className="skills-tree-empty">No skills match your search.</p>
        ) : (
          <p className="skills-tree-empty">No skills exist yet. Use + to create the first one.</p>
        )}

        {isCreateGlobalSkillDraftVisible && creatingGlobalSkillParentDirectory === null ? (
          <CreateGlobalSkillForm
            creatingGlobalSkillName={creatingGlobalSkillName}
            draftKind={creatingGlobalSkillDraftKind}
            isCreatingGlobalSkill={isCreatingGlobalSkill}
            onCancel={onCreateGlobalSkillDraftCancel}
            onChange={onCreateGlobalSkillDraftChange}
            onSubmit={onCreateGlobalSkill}
          />
        ) : (
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
        )}
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
  onDelete,
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
              deletingGlobalSkillDirectory={deletingGlobalSkillDirectory}
              globalSkillsRoot={globalSkillsRoot}
              isDirty={isDirty}
              isLoadingFile={isLoadingFile}
              isSavingFile={isSavingFile}
              selectedFileContent={selectedFileContent}
              selectedFilePath={selectedFilePath}
              selectedFileReadOnly={selectedFileReadOnly}
              selectedSkillDirectoryName={selectedSkillDirectoryName}
              onChange={onChange}
              onDelete={onDelete}
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
