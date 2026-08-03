import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react"
import { ChevronRightIcon, FileTextIcon, FolderIcon, FolderOpenIcon, SessionRunningIcon } from "../icons"
import { useI18n } from "../i18n/I18nProvider"
import { joinClassNames } from "../shared-ui"

export interface SkillFileNavigationItem {
  label: string
  path: string
  sizeLabel?: string
}

interface SkillFileTreeNode {
  children: SkillFileTreeNode[]
  id: string
  kind: "directory" | "file"
  name: string
  parentID: string | null
  relativePath: string
  item?: SkillFileNavigationItem
}

interface SkillFileTree {
  ancestorDirectoryIDsByFilePath: Map<string, string[]>
  fileNodeIDsByPath: Map<string, string>
  roots: SkillFileTreeNode[]
}

interface VisibleSkillFileTreeNode extends SkillFileTreeNode {
  depth: number
}

interface SkillFileListProps {
  className?: string
  isLoading?: boolean
  items: SkillFileNavigationItem[]
  selectedPath: string | null
  onSelect: (path: string) => void
}

const SKILL_FILE_LOADING_DELAY_MS = 160

export function SkillFileLoadingOverlay({ isLoading }: { isLoading: boolean }) {
  const { t } = useI18n()
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    if (!isLoading) {
      setIsVisible(false)
      return
    }

    const timeoutID = window.setTimeout(() => setIsVisible(true), SKILL_FILE_LOADING_DELAY_MS)
    return () => window.clearTimeout(timeoutID)
  }, [isLoading])

  if (!isLoading || !isVisible) return null

  return (
    <div className="skill-library-file-loading-overlay" role="status">
      <SessionRunningIcon className="skill-library-spinner" aria-hidden="true" />
      <span>{t("app.loadingData")}</span>
    </div>
  )
}

const skillFileNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
})

function sortSkillFileTree(nodes: SkillFileTreeNode[]) {
  nodes.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1
    return skillFileNameCollator.compare(left.name, right.name)
  })
  nodes.forEach((node) => sortSkillFileTree(node.children))
}

function buildSkillFileTree(items: SkillFileNavigationItem[]): SkillFileTree {
  const roots: SkillFileTreeNode[] = []
  const directoryNodes = new Map<string, SkillFileTreeNode>()
  const fileNodeIDsByPath = new Map<string, string>()
  const ancestorDirectoryIDsByFilePath = new Map<string, string[]>()
  const addedFilePaths = new Set<string>()

  items.forEach((item) => {
    if (addedFilePaths.has(item.path)) return
    addedFilePaths.add(item.path)

    const fallbackName = item.path.split(/[\\/]/).filter(Boolean).at(-1) ?? item.path
    const segments = item.label.split(/[\\/]/).filter(Boolean)
    if (segments.length === 0) segments.push(fallbackName)

    let children = roots
    let parentID: string | null = null
    const relativeSegments: string[] = []
    const ancestorDirectoryIDs: string[] = []

    segments.forEach((segment, index) => {
      relativeSegments.push(segment)
      const relativePath = relativeSegments.join("/")
      const isFile = index === segments.length - 1

      if (isFile) {
        const id = `file:${item.path}`
        children.push({
          children: [],
          id,
          item,
          kind: "file",
          name: segment,
          parentID,
          relativePath,
        })
        fileNodeIDsByPath.set(item.path, id)
        ancestorDirectoryIDsByFilePath.set(item.path, ancestorDirectoryIDs)
        return
      }

      const directoryID = `directory:${relativePath}`
      let directory = directoryNodes.get(directoryID)
      if (!directory) {
        directory = {
          children: [],
          id: directoryID,
          kind: "directory",
          name: segment,
          parentID,
          relativePath,
        }
        directoryNodes.set(directoryID, directory)
        children.push(directory)
      }

      ancestorDirectoryIDs.push(directoryID)
      parentID = directoryID
      children = directory.children
    })
  })

  sortSkillFileTree(roots)
  return {
    ancestorDirectoryIDsByFilePath,
    fileNodeIDsByPath,
    roots,
  }
}

function flattenVisibleSkillFileTree(
  nodes: SkillFileTreeNode[],
  expandedDirectoryIDs: Set<string>,
  depth = 0,
): VisibleSkillFileTreeNode[] {
  return nodes.flatMap((node) => [
    { ...node, depth },
    ...(node.kind === "directory" && expandedDirectoryIDs.has(node.id)
      ? flattenVisibleSkillFileTree(node.children, expandedDirectoryIDs, depth + 1)
      : []),
  ])
}

function setsAreEqual(left: Set<string>, right: Set<string>) {
  return left.size === right.size && [...left].every((value) => right.has(value))
}

export function SkillFileList({
  className,
  isLoading = false,
  items,
  selectedPath,
  onSelect,
}: SkillFileListProps) {
  const { t } = useI18n()
  const tree = useMemo(() => buildSkillFileTree(items), [items])
  const itemsSignature = useMemo(
    () => items.map((item) => `${item.label}\u0000${item.path}`).join("\u0001"),
    [items],
  )
  const selectedAncestorDirectoryIDs = selectedPath
    ? tree.ancestorDirectoryIDsByFilePath.get(selectedPath) ?? []
    : []
  const selectedAncestorSignature = selectedAncestorDirectoryIDs.join("\u0000")
  const [expansionState, setExpansionState] = useState(() => ({
    itemsSignature,
    expandedDirectoryIDs: new Set(selectedAncestorDirectoryIDs),
  }))
  const [focusedNodeID, setFocusedNodeID] = useState<string | null>(null)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const expandedDirectoryIDs = expansionState.itemsSignature === itemsSignature
    ? expansionState.expandedDirectoryIDs
    : new Set(selectedAncestorDirectoryIDs)
  const visibleNodes = useMemo(
    () => flattenVisibleSkillFileTree(tree.roots, expandedDirectoryIDs),
    [expandedDirectoryIDs, tree.roots],
  )
  const visibleNodeIDs = new Set(visibleNodes.map((node) => node.id))
  const selectedNodeID = selectedPath ? tree.fileNodeIDsByPath.get(selectedPath) ?? null : null
  const tabStopNodeID = focusedNodeID && visibleNodeIDs.has(focusedNodeID)
    ? focusedNodeID
    : selectedNodeID && visibleNodeIDs.has(selectedNodeID)
      ? selectedNodeID
      : visibleNodes[0]?.id ?? null
  const isInitialLoading = isLoading && items.length === 0

  useEffect(() => {
    setExpansionState((current) => {
      const nextExpandedDirectoryIDs = current.itemsSignature === itemsSignature
        ? new Set(current.expandedDirectoryIDs)
        : new Set<string>()
      selectedAncestorDirectoryIDs.forEach((id) => nextExpandedDirectoryIDs.add(id))
      if (
        current.itemsSignature === itemsSignature
        && setsAreEqual(current.expandedDirectoryIDs, nextExpandedDirectoryIDs)
      ) return current
      return { itemsSignature, expandedDirectoryIDs: nextExpandedDirectoryIDs }
    })
  }, [itemsSignature, selectedAncestorSignature])

  useEffect(() => {
    setFocusedNodeID(null)
  }, [itemsSignature])

  function toggleDirectory(node: VisibleSkillFileTreeNode) {
    setExpansionState((current) => {
      const nextExpandedDirectoryIDs = current.itemsSignature === itemsSignature
        ? new Set(current.expandedDirectoryIDs)
        : new Set(selectedAncestorDirectoryIDs)
      if (nextExpandedDirectoryIDs.has(node.id)) {
        nextExpandedDirectoryIDs.delete(node.id)
      } else {
        nextExpandedDirectoryIDs.add(node.id)
      }
      return { itemsSignature, expandedDirectoryIDs: nextExpandedDirectoryIDs }
    })
  }

  function activateNode(node: VisibleSkillFileTreeNode) {
    if (node.kind === "directory") {
      toggleDirectory(node)
      return
    }
    if (node.item) onSelect(node.item.path)
  }

  function focusNode(node: VisibleSkillFileTreeNode | undefined) {
    if (!node) return
    setFocusedNodeID(node.id)
    rowRefs.current.get(node.id)?.focus({ preventScroll: true })
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const node = visibleNodes[index]
    if (!node) return

    if (event.key === "ArrowDown") {
      event.preventDefault()
      focusNode(visibleNodes[Math.min(visibleNodes.length - 1, index + 1)])
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      focusNode(visibleNodes[Math.max(0, index - 1)])
      return
    }
    if (event.key === "Home") {
      event.preventDefault()
      focusNode(visibleNodes[0])
      return
    }
    if (event.key === "End") {
      event.preventDefault()
      focusNode(visibleNodes.at(-1))
      return
    }
    if (event.key === "ArrowRight" && node.kind === "directory") {
      event.preventDefault()
      if (!expandedDirectoryIDs.has(node.id)) {
        toggleDirectory(node)
      } else {
        const firstChild = visibleNodes[index + 1]
        if (firstChild?.parentID === node.id) focusNode(firstChild)
      }
      return
    }
    if (event.key === "ArrowLeft") {
      if (node.kind === "directory" && expandedDirectoryIDs.has(node.id)) {
        event.preventDefault()
        toggleDirectory(node)
        return
      }
      if (node.parentID) {
        event.preventDefault()
        focusNode(visibleNodes.find((candidate) => candidate.id === node.parentID))
      }
      return
    }
    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault()
      activateNode(node)
    }
  }

  return (
    <div
      className={joinClassNames("skill-library-file-list is-tree", className)}
      role="tree"
      aria-busy={isInitialLoading}
      aria-label={t("skillLibrary.files.aria")}
    >
      {items.length === 0 ? (
        isInitialLoading
          ? <p className="skill-library-files-sidebar-empty" role="status">{t("app.loadingData")}</p>
          : <p className="skill-library-files-sidebar-empty">{t("skillLibrary.files.unavailable")}</p>
      ) : visibleNodes.map((node, index) => {
        const isDirectory = node.kind === "directory"
        const isExpanded = isDirectory && expandedDirectoryIDs.has(node.id)
        const isSelected = !isDirectory && node.item?.path === selectedPath
        const rowStyle = {
          "--skill-library-file-tree-indent": `${node.depth * 14}px`,
        } as CSSProperties

        return (
          <button
            key={node.id}
            ref={(element) => {
              if (element) rowRefs.current.set(node.id, element)
              else rowRefs.current.delete(node.id)
            }}
            className={joinClassNames(
              "skill-library-file-row",
              isDirectory ? "is-directory" : "is-file",
              isSelected ? "is-selected" : null,
            )}
            type="button"
            role="treeitem"
            aria-expanded={isDirectory ? isExpanded : undefined}
            aria-label={node.name}
            aria-level={node.depth + 1}
            aria-selected={isDirectory ? undefined : isSelected}
            tabIndex={node.id === tabStopNodeID ? 0 : -1}
            title={node.item?.path ?? node.relativePath}
            style={rowStyle}
            onClick={() => {
              setFocusedNodeID(node.id)
              activateNode(node)
            }}
            onFocus={() => setFocusedNodeID(node.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <span className="skill-library-file-row-chevron" aria-hidden="true">
              {isDirectory ? <ChevronRightIcon /> : null}
            </span>
            <span className="skill-library-file-row-icon" aria-hidden="true">
              {isDirectory
                ? isExpanded ? <FolderOpenIcon /> : <FolderIcon />
                : <FileTextIcon />}
            </span>
            <span className="skill-library-file-row-label">{node.name}</span>
            {!isDirectory && node.item?.sizeLabel ? <small>{node.item.sizeLabel}</small> : null}
          </button>
        )
      })}
    </div>
  )
}

export function SkillFilesSidebar({
  id,
  isLoading = false,
  items,
  selectedPath,
  onSelect,
}: {
  id: string
  isLoading?: boolean
  items: SkillFileNavigationItem[]
  selectedPath: string | null
  onSelect: (path: string) => void
}) {
  const { t } = useI18n()

  return (
    <aside id={id} className="skill-library-files-sidebar" aria-label={t("skillLibrary.files.aria")}>
      <header className="skill-library-files-sidebar-header">
        <strong>{t("skillLibrary.detail.files")}</strong>
        <span>{items.length}</span>
      </header>
      <SkillFileList
        isLoading={isLoading}
        items={items}
        selectedPath={selectedPath}
        onSelect={onSelect}
      />
    </aside>
  )
}
