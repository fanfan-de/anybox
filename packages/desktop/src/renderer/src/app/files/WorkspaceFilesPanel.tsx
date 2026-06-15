import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CodeModeIcon,
  EyeIcon,
  ExpandIcon,
  FileImageIcon,
  FileTextIcon,
  FileVideoIcon,
  FolderIcon,
  FolderOpenIcon,
  MinimizeIcon,
  PlusIcon,
  SearchIcon,
} from "../icons"
import { useI18n } from "../i18n/I18nProvider"
import type {
  WorkspaceDirectoryEntry,
  WorkspaceFileLineRange,
  WorkspaceFileReviewState,
} from "../types"
import { formatTime } from "../utils"
import {
  ThreadMarkdown,
  type MarkdownLinkTarget,
  type MarkdownLocalFileLinkTarget,
} from "../thread-markdown"
import { formatWorkspaceFileLineRangeLabel, normalizeWorkspaceFileLineRange } from "./utils"
import { toLocalImageProtocolUrl } from "../../../../shared/local-image-protocol"
import { HighlightedCodeLine, inferCodeLanguage, useHighlightedCode } from "../code-highlight"
import type { CodeHighlightTheme } from "../code-theme"

const ROOT_DIRECTORY_PATH = ""
const MARKDOWN_FILE_EXTENSIONS = new Set(["md", "markdown"])
const HASH_LINE_RANGE_PATTERN = /#L(\d+)(?:-L?(\d+))?$/i
const COLON_LINE_RANGE_PATTERN = /:(\d+)(?:-(\d+))?$/
const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i
const URI_WITH_AUTHORITY_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i
const WINDOWS_DRIVE_PATH_PATTERN = /^[A-Za-z]:[\\/]/

interface WorkspaceFilesPanelProps {
  canInsertCommentsIntoDraft: boolean
  codeTheme: CodeHighlightTheme
  scopeDirectory: string | null
  scopeName: string | null
  state: WorkspaceFileReviewState
  onDirectoryLoad: (path: string) => void
  onDirectoryToggle: (path: string) => void
  onPendingCommentCancel: () => void
  onPendingCommentChange: (text: string) => void
  onPendingCommentConfirm: () => void
  onPendingCommentStart: (startLineNumber: number, endLineNumber?: number) => void
  onQueryChange: (value: string) => void
  onSelectFile: (path: string, options?: { linkedLineRange?: WorkspaceFileLineRange | null }) => void
  onTreeInvalidate: (paths: string[]) => void
}

function normalizePathForCompare(path: string) {
  return path.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "").toLowerCase()
}

function normalizeTreePath(path: string | null | undefined) {
  const normalized = path?.trim().replace(/\\/g, "/").replace(/\/+/g, "/") ?? ""
  if (!normalized || normalized === "." || normalized === "/") return ROOT_DIRECTORY_PATH
  return normalized.replace(/^\/+/, "").replace(/\/+$/, "")
}

function normalizeFileExtension(extension: string | null | undefined) {
  const normalized = extension?.trim().replace(/^\./, "").toLowerCase() ?? ""
  return normalized || null
}

function isMarkdownExtension(extension: string | null | undefined) {
  const normalized = normalizeFileExtension(extension)
  return normalized ? MARKDOWN_FILE_EXTENSIONS.has(normalized) : false
}

function formatFileSize(size: number | null | undefined) {
  if (!Number.isFinite(size) || size == null || size < 0) return null
  const units = ["B", "KB", "MB", "GB"] as const
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const formatted = unitIndex === 0 ? String(value) : value.toFixed(value >= 10 ? 1 : 2)
  return `${formatted} ${units[unitIndex]}`
}

function isRemoteWorkspaceDirectory(scopeDirectory: string | null | undefined) {
  const directory = scopeDirectory?.trim() ?? ""
  return URI_WITH_AUTHORITY_PATTERN.test(directory) && !WINDOWS_DRIVE_PATH_PATTERN.test(directory)
}

function hasNonFilePathUriScheme(value: string) {
  return URI_SCHEME_PATTERN.test(value) && !WINDOWS_DRIVE_PATH_PATTERN.test(value)
}

function decodeMarkdownResource(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function normalizeMarkdownLineRange(startLineNumber: number, endLineNumber = startLineNumber): WorkspaceFileLineRange | null {
  if (!Number.isSafeInteger(startLineNumber) || !Number.isSafeInteger(endLineNumber)) return null
  if (startLineNumber < 1 || endLineNumber < 1) return null
  return startLineNumber <= endLineNumber
    ? { startLineNumber, endLineNumber }
    : { startLineNumber: endLineNumber, endLineNumber: startLineNumber }
}

function splitMarkdownResourcePath(value: string) {
  const trimmed = decodeMarkdownResource(value).trim()
  const hashLineMatch = trimmed.match(HASH_LINE_RANGE_PATTERN)
  if (hashLineMatch?.index !== undefined) {
    return {
      lineRange: normalizeMarkdownLineRange(Number(hashLineMatch[1]), Number(hashLineMatch[2] ?? hashLineMatch[1])),
      path: trimmed.slice(0, hashLineMatch.index),
    }
  }

  const colonMatch = trimmed.match(COLON_LINE_RANGE_PATTERN)
  if (colonMatch?.index !== undefined) {
    const pathValue = trimmed.slice(0, colonMatch.index)
    if (!/^[A-Za-z]:$/.test(pathValue)) {
      return {
        lineRange: normalizeMarkdownLineRange(Number(colonMatch[1]), Number(colonMatch[2] ?? colonMatch[1])),
        path: pathValue,
      }
    }
  }

  const hashIndex = trimmed.indexOf("#")
  return {
    lineRange: null,
    path: hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed,
  }
}

function getWorkspaceFileDirectoryPath(filePath: string | null | undefined) {
  const normalized = normalizeTreePath(filePath)
  const segments = normalized.split("/").filter(Boolean)
  segments.pop()
  return segments.join("/")
}

function normalizeWorkspaceRelativeResourcePath(baseDirectory: string, targetPath: string) {
  const trimmedTarget = targetPath.trim().replace(/\\/g, "/")
  if (!trimmedTarget || trimmedTarget.startsWith("#") || hasNonFilePathUriScheme(trimmedTarget)) return null

  const sourceSegments = trimmedTarget.startsWith("/")
    ? []
    : baseDirectory.split("/").filter(Boolean)
  const targetSegments = trimmedTarget.replace(/^\/+/, "").split("/").filter(Boolean)
  const resolvedSegments = [...sourceSegments]

  for (const segment of targetSegments) {
    if (segment === ".") continue
    if (segment === "..") {
      if (resolvedSegments.length === 0) return null
      resolvedSegments.pop()
      continue
    }
    resolvedSegments.push(segment)
  }

  return resolvedSegments.join("/")
}

function joinLocalWorkspacePath(workspaceRoot: string, workspaceRelativePath: string) {
  const trimmedRoot = workspaceRoot.trim().replace(/[\\/]+$/, "")
  const separator = trimmedRoot.includes("\\") ? "\\" : "/"
  return `${trimmedRoot}${separator}${workspaceRelativePath.split("/").filter(Boolean).join(separator)}`
}

function resolveWorkspaceRelativePath(scopeDirectory: string, changedPath: string) {
  const normalizedScope = normalizePathForCompare(scopeDirectory)
  const normalizedChangedPath = normalizePathForCompare(changedPath)
  if (normalizedChangedPath === normalizedScope) return ROOT_DIRECTORY_PATH
  if (!normalizedChangedPath.startsWith(`${normalizedScope}/`)) return null

  const normalizedOriginalScope = scopeDirectory.replace(/\\/g, "/").replace(/\/$/, "")
  const normalizedOriginalPath = changedPath.replace(/\\/g, "/")
  return normalizeTreePath(normalizedOriginalPath.slice(normalizedOriginalScope.length + 1))
}

function changedPathsIncludeSelectedFile(scopeDirectory: string, selectedFilePath: string, changedPaths: string[]) {
  const normalizedSelectedFilePath = normalizePathForCompare(selectedFilePath)
  return changedPaths.some((changedPath) => {
    const relativePath = resolveWorkspaceRelativePath(scopeDirectory, changedPath)
    if (relativePath === null) return false
    const normalizedRelativePath = normalizePathForCompare(relativePath)
    return (
      normalizedRelativePath === normalizedSelectedFilePath ||
      (normalizedRelativePath.length > 0 && normalizedSelectedFilePath.startsWith(`${normalizedRelativePath}/`))
    )
  })
}

function getReaderEmptyStateCopy(state: WorkspaceFileReviewState, scopeDirectory: string | null) {
  if (!scopeDirectory) return "Select a workspace to browse files."
  if (state.status === "reading") return "Loading file preview."
  if (state.status === "error" && state.errorMessage) return state.errorMessage
  if (state.selectedFilePath && state.status === "unsupported") {
    return state.errorMessage ?? "This file type is not supported in the Files panel yet."
  }
  return "从工作区目录树中选择文件"
}

function getReaderEmptyStateTitle(state: WorkspaceFileReviewState) {
  if (state.status === "reading") return "正在加载文件"
  return state.selectedFilePath ? "无法打开文件" : "打开文件"
}

function getCurrentPathLabel(filePath: string | null) {
  const normalizedPath = normalizeTreePath(filePath)
  if (!normalizedPath) return "/"
  const segments = normalizedPath.split("/").filter(Boolean)
  if (segments.length <= 1) return "/"
  segments.pop()
  return `/${segments.join("/")}`
}

function isLineWithinRange(range: WorkspaceFileLineRange | null, lineNumber: number) {
  if (!range) return false
  return lineNumber >= range.startLineNumber && lineNumber <= range.endLineNumber
}

function entryMatchesFilter(entry: WorkspaceDirectoryEntry, normalizedFilter: string) {
  if (!normalizedFilter) return true
  return `${entry.name} ${entry.path}`.toLowerCase().includes(normalizedFilter)
}

function getVisibleDirectoryEntries(
  directoryPath: string,
  state: WorkspaceFileReviewState,
  normalizedFilter: string,
): WorkspaceDirectoryEntry[] {
  const entries = state.treeEntriesByDirectoryPath[directoryPath] ?? []
  if (!normalizedFilter) return entries

  return entries.filter((entry) => {
    if (entryMatchesFilter(entry, normalizedFilter)) return true
    if (entry.kind !== "directory") return false
    return getVisibleDirectoryEntries(entry.path, state, normalizedFilter).length > 0
  })
}

function getFileBadgeLabel(extension: string | null) {
  switch (extension?.toLowerCase()) {
    case "ts":
      return "TS"
    case "tsx":
      return "TS"
    case "js":
    case "mjs":
    case "cjs":
      return "JS"
    case "jsx":
      return "JS"
    case "py":
      return "PY"
    case "json":
      return "{}"
    case "md":
      return "M"
    case "css":
      return "#"
    case "html":
      return "<>"
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
      return "IMG"
    case "m4v":
    case "mov":
    case "mp4":
    case "ogg":
    case "ogv":
    case "webm":
      return "VID"
    default:
      return null
  }
}

function WorkspaceFileTreeIcon({ entry, isExpanded }: { entry: WorkspaceDirectoryEntry; isExpanded: boolean }) {
  if (entry.kind === "directory") {
    return isExpanded ? <FolderOpenIcon /> : <FolderIcon />
  }

  const badgeLabel = getFileBadgeLabel(entry.extension)
  if (badgeLabel) {
    return (
      <span className="workspace-files-tree-file-badge" data-extension={entry.extension ?? "file"} aria-hidden="true">
        {badgeLabel}
      </span>
    )
  }

  return <FileTextIcon />
}

interface WorkspaceFileTreeNodeProps {
  depth: number
  entry: WorkspaceDirectoryEntry
  normalizedFilter: string
  selectedFilePath: string | null
  state: WorkspaceFileReviewState
  onDirectoryLoad: (path: string) => void
  onDirectoryToggle: (path: string) => void
  onSelectFile: (path: string, options?: { linkedLineRange?: WorkspaceFileLineRange | null }) => void
}

function WorkspaceFileTreeNode({
  depth,
  entry,
  normalizedFilter,
  selectedFilePath,
  state,
  onDirectoryLoad,
  onDirectoryToggle,
  onSelectFile,
}: WorkspaceFileTreeNodeProps) {
  const isDirectory = entry.kind === "directory"
  const isExpanded = isDirectory && state.treeExpandedDirectoryPaths.includes(entry.path)
  const isLoading = isDirectory && state.treeLoadingDirectoryPaths.includes(entry.path)
  const errorMessage = isDirectory ? state.treeErrorByDirectoryPath[entry.path] ?? null : null
  const hasLoadedChildren = isDirectory && Boolean(state.treeEntriesByDirectoryPath[entry.path])
  const visibleChildren = isDirectory
    ? getVisibleDirectoryEntries(entry.path, state, normalizedFilter)
    : []
  const shouldShowChildren = isDirectory && (isExpanded || Boolean(normalizedFilter))
  const isActive = entry.kind === "file" && selectedFilePath === entry.path

  useEffect(() => {
    if (!isDirectory || !isExpanded || isLoading || errorMessage || hasLoadedChildren) return
    onDirectoryLoad(entry.path)
  }, [entry.path, errorMessage, hasLoadedChildren, isDirectory, isExpanded, isLoading, onDirectoryLoad])

  return (
    <div className="workspace-files-tree-node">
      <button
        type="button"
        className={[
          "workspace-files-tree-row",
          isActive ? "is-active" : "",
          isDirectory ? "is-directory" : "is-file",
        ].filter(Boolean).join(" ")}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        aria-expanded={isDirectory ? isExpanded : undefined}
        aria-pressed={entry.kind === "file" ? isActive : undefined}
        title={entry.path || entry.name}
        onClick={() => {
          if (isDirectory) {
            onDirectoryToggle(entry.path)
            return
          }
          onSelectFile(entry.path)
        }}
      >
        <span className="workspace-files-tree-chevron" aria-hidden="true">
          {isDirectory ? isExpanded || normalizedFilter ? <ChevronDownIcon /> : <ChevronRightIcon /> : null}
        </span>
        <span className="workspace-files-tree-icon" aria-hidden="true">
          <WorkspaceFileTreeIcon entry={entry} isExpanded={isExpanded || Boolean(normalizedFilter)} />
        </span>
        <span className="workspace-files-tree-name">{entry.name}</span>
      </button>

      {errorMessage ? <div className="workspace-files-tree-message">{errorMessage}</div> : null}
      {isLoading ? <div className="workspace-files-tree-message">Loading...</div> : null}
      {shouldShowChildren && visibleChildren.length > 0 ? (
        <div className="workspace-files-tree-children">
          {visibleChildren.map((child) => (
            <WorkspaceFileTreeNode
              key={`${child.kind}:${child.path}`}
              depth={depth + 1}
              entry={child}
              normalizedFilter={normalizedFilter}
              selectedFilePath={selectedFilePath}
              state={state}
              onDirectoryLoad={onDirectoryLoad}
              onDirectoryToggle={onDirectoryToggle}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function WorkspaceFilesPanel({
  canInsertCommentsIntoDraft,
  codeTheme,
  scopeDirectory,
  scopeName,
  state,
  onDirectoryLoad,
  onDirectoryToggle,
  onPendingCommentCancel,
  onPendingCommentChange,
  onPendingCommentConfirm,
  onPendingCommentStart,
  onQueryChange,
  onSelectFile,
  onTreeInvalidate,
}: WorkspaceFilesPanelProps) {
  const { t } = useI18n()
  const [dragSelection, setDragSelection] = useState<WorkspaceFileLineRange | null>(null)
  const [markdownViewMode, setMarkdownViewMode] = useState<"preview" | "source">("preview")
  const [imageViewMode, setImageViewMode] = useState<"fit" | "actual">("fit")
  const [imageScale, setImageScale] = useState(1)
  const [isTreeCollapsed, setIsTreeCollapsed] = useState(false)
  const dragSelectionRef = useRef<WorkspaceFileLineRange | null>(null)
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const fileLines = state.selectedFileContent?.split(/\r?\n/) ?? []
  const commentsByEndLine = new Map<number, typeof state.comments>()
  const pendingRange = state.pendingComment
    ? normalizeWorkspaceFileLineRange(state.pendingComment.startLineNumber, state.pendingComment.endLineNumber)
    : null
  const linkedRange = state.linkedLineRange
    ? normalizeWorkspaceFileLineRange(state.linkedLineRange.startLineNumber, state.linkedLineRange.endLineNumber)
    : null
  const highlightedRange = dragSelection ?? pendingRange ?? linkedRange
  const normalizedFilter = state.query.trim().toLowerCase()
  const rootEntries = getVisibleDirectoryEntries(ROOT_DIRECTORY_PATH, state, normalizedFilter)
  const isRootLoading = state.treeLoadingDirectoryPaths.includes(ROOT_DIRECTORY_PATH)
  const rootErrorMessage = state.treeErrorByDirectoryPath[ROOT_DIRECTORY_PATH] ?? null
  const selectedFileExtension = normalizeFileExtension(state.selectedFileExtension)
  const isSelectedMarkdown = state.selectedFileKind === "text" && isMarkdownExtension(selectedFileExtension)
  const shouldRenderMarkdownPreview =
    Boolean(state.selectedFilePath) &&
    state.selectedFileContent !== null &&
    isSelectedMarkdown &&
    markdownViewMode === "preview"
  const shouldRenderSourceReader =
    Boolean(state.selectedFilePath) &&
    state.selectedFileContent !== null &&
    state.selectedFileKind === "text" &&
    (!isSelectedMarkdown || markdownViewMode === "source")
  const shouldRenderImagePreview =
    Boolean(state.selectedFilePath) &&
    state.selectedFileKind === "image" &&
    Boolean(state.selectedFilePreviewUrl)
  const shouldRenderVideoPreview =
    Boolean(state.selectedFilePath) &&
    state.selectedFileKind === "video" &&
    Boolean(state.selectedFilePreviewUrl)
  const selectedFileSizeLabel = formatFileSize(state.selectedFileSize)
  const selectedFileDirectoryPath = getWorkspaceFileDirectoryPath(state.selectedFilePath)
  const imageZoomLabel = imageViewMode === "fit" ? "Fit" : `${Math.round(imageScale * 100)}%`
  const selectedCodeLanguage = inferCodeLanguage({
    extension: selectedFileExtension,
    mime: state.selectedFileMimeType,
    path: state.selectedFilePath,
  })
  const sourceHighlight = useHighlightedCode({
    content: shouldRenderSourceReader ? state.selectedFileContent ?? "" : "",
    language: selectedCodeLanguage,
    theme: codeTheme,
  })
  const sourceHighlightStyle = {
    "--code-highlight-bg": sourceHighlight.backgroundColor ?? undefined,
    "--code-highlight-fg": sourceHighlight.foregroundColor ?? undefined,
  } as CSSProperties

  for (const comment of state.comments) {
    const currentComments = commentsByEndLine.get(comment.endLineNumber) ?? []
    commentsByEndLine.set(comment.endLineNumber, [...currentComments, comment])
  }

  useEffect(() => {
    if (!scopeDirectory) return
    if (state.treeEntriesByDirectoryPath[ROOT_DIRECTORY_PATH]) return
    if (state.treeLoadingDirectoryPaths.includes(ROOT_DIRECTORY_PATH)) return
    if (state.treeErrorByDirectoryPath[ROOT_DIRECTORY_PATH]) return
    onDirectoryLoad(ROOT_DIRECTORY_PATH)
  }, [
    onDirectoryLoad,
    scopeDirectory,
    state.treeEntriesByDirectoryPath,
    state.treeErrorByDirectoryPath,
    state.treeLoadingDirectoryPaths,
  ])

  useEffect(() => {
    const unsubscribe = window.desktop?.onWorkspaceFileChange?.((workspaceEvent) => {
      if (!scopeDirectory) return
      if (normalizePathForCompare(workspaceEvent.directory) !== normalizePathForCompare(scopeDirectory)) return

      onTreeInvalidate(workspaceEvent.paths)
      if (
        state.selectedFilePath &&
        changedPathsIncludeSelectedFile(scopeDirectory, state.selectedFilePath, workspaceEvent.paths)
      ) {
        onSelectFile(state.selectedFilePath)
      }
    })

    return () => {
      unsubscribe?.()
    }
  }, [onSelectFile, onTreeInvalidate, scopeDirectory, state.selectedFilePath])

  useEffect(() => {
    dragSelectionRef.current = null
    setDragSelection(null)
  }, [state.selectedFilePath, state.pendingComment?.startLineNumber, state.pendingComment?.endLineNumber])

  useEffect(() => {
    if (!isSelectedMarkdown) {
      setMarkdownViewMode("preview")
      return
    }
    setMarkdownViewMode(linkedRange ? "source" : "preview")
  }, [isSelectedMarkdown, linkedRange?.startLineNumber, linkedRange?.endLineNumber, state.selectedFilePath])

  useEffect(() => {
    setImageViewMode("fit")
    setImageScale(1)
  }, [state.selectedFilePath, state.selectedFilePreviewUrl])

  useEffect(() => {
    if (!linkedRange || state.selectedFileContent === null) return
    lineRefs.current.get(linkedRange.startLineNumber)?.scrollIntoView?.({
      block: "center",
      inline: "nearest",
    })
  }, [
    linkedRange?.startLineNumber,
    linkedRange?.endLineNumber,
    shouldRenderSourceReader,
    state.selectedFileContent,
    state.selectedFilePath,
  ])

  useEffect(() => {
    function finalizeDragSelection() {
      const selection = dragSelectionRef.current
      if (!selection) return

      const nextRange = normalizeWorkspaceFileLineRange(selection.startLineNumber, selection.endLineNumber)
      dragSelectionRef.current = null
      setDragSelection(null)
      if (nextRange.startLineNumber === nextRange.endLineNumber) return
      onPendingCommentStart(nextRange.startLineNumber, nextRange.endLineNumber)
    }

    window.addEventListener("mouseup", finalizeDragSelection)
    window.addEventListener("pointerup", finalizeDragSelection)
    return () => {
      window.removeEventListener("mouseup", finalizeDragSelection)
      window.removeEventListener("pointerup", finalizeDragSelection)
    }
  }, [onPendingCommentStart])

  function handleLineSelectionStart(lineNumber: number, event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    const nextSelection = {
      startLineNumber: lineNumber,
      endLineNumber: lineNumber,
    }
    dragSelectionRef.current = nextSelection
    setDragSelection(nextSelection)
  }

  function handleLineSelectionMove(lineNumber: number) {
    const currentSelection = dragSelectionRef.current
    if (!currentSelection) return

    const nextSelection = {
      ...currentSelection,
      endLineNumber: lineNumber,
    }
    dragSelectionRef.current = nextSelection
    setDragSelection(nextSelection)
  }

  function handleLineSelectionEnd() {
    const selection = dragSelectionRef.current
    if (!selection) return

    const nextRange = normalizeWorkspaceFileLineRange(selection.startLineNumber, selection.endLineNumber)
    dragSelectionRef.current = null
    setDragSelection(null)
    if (nextRange.startLineNumber === nextRange.endLineNumber) return
    onPendingCommentStart(nextRange.startLineNumber, nextRange.endLineNumber)
  }

  function handleSearchChange(event: ChangeEvent<HTMLInputElement>) {
    onQueryChange(event.target.value)
  }

  function registerLineRef(lineNumber: number) {
    return (node: HTMLDivElement | null) => {
      if (node) {
        lineRefs.current.set(lineNumber, node)
      } else {
        lineRefs.current.delete(lineNumber)
      }
    }
  }

  function resolveWorkspaceMarkdownRelativeTarget(value: string): MarkdownLocalFileLinkTarget | null {
    if (!state.selectedFilePath) return null

    const resource = splitMarkdownResourcePath(value)
    const workspaceRelativePath = normalizeWorkspaceRelativeResourcePath(selectedFileDirectoryPath, resource.path)
    if (!workspaceRelativePath) return null

    return {
      lineRange: resource.lineRange,
      path: workspaceRelativePath,
    }
  }

  function resolveWorkspaceMarkdownLinkTarget(value: string): MarkdownLinkTarget | null {
    const target = resolveWorkspaceMarkdownRelativeTarget(value)
    if (!target) return null

    return {
      href: value.trim(),
      kind: "local-file",
      target,
    }
  }

  function resolveWorkspaceMarkdownImageSrc(value: string) {
    const target = resolveWorkspaceMarkdownRelativeTarget(value)
    if (!target || !scopeDirectory || isRemoteWorkspaceDirectory(scopeDirectory)) return null

    return toLocalImageProtocolUrl(joinLocalWorkspacePath(scopeDirectory, target.path))
  }

  function handleMarkdownLocalFileOpen(target: MarkdownLocalFileLinkTarget) {
    onSelectFile(target.path, {
      linkedLineRange: target.lineRange ?? null,
    })
  }

  function setActualImageScale(nextScale: number) {
    setImageViewMode("actual")
    setImageScale(Math.min(4, Math.max(0.25, nextScale)))
  }

  function zoomImage(direction: "in" | "out") {
    setActualImageScale(imageScale + (direction === "in" ? 0.25 : -0.25))
  }

  function renderTreeContent() {
    if (!scopeDirectory) {
      return <div className="workspace-files-tree-empty">Select a workspace to browse files.</div>
    }
    if (rootErrorMessage) {
      return <div className="workspace-files-tree-empty">{rootErrorMessage}</div>
    }
    if (isRootLoading && rootEntries.length === 0) {
      return <div className="workspace-files-tree-empty">Loading files...</div>
    }
    if (rootEntries.length === 0) {
      return (
        <div className="workspace-files-tree-empty">
          {normalizedFilter ? "No loaded files match the filter." : "No files found."}
        </div>
      )
    }

    return (
      <div className="workspace-files-tree-list" role="tree" aria-label="Workspace files">
        {rootEntries.map((entry) => (
          <WorkspaceFileTreeNode
            key={`${entry.kind}:${entry.path}`}
            depth={0}
            entry={entry}
            normalizedFilter={normalizedFilter}
            selectedFilePath={state.selectedFilePath}
            state={state}
            onDirectoryLoad={onDirectoryLoad}
            onDirectoryToggle={onDirectoryToggle}
            onSelectFile={onSelectFile}
          />
        ))}
      </div>
    )
  }

  function renderReaderHeader() {
    if (!state.selectedFilePath) return null

    return (
      <div className="workspace-files-panel-header">
        <div className="workspace-files-reader-title">
          <span className="label">Reader</span>
          <strong>{state.selectedFilePath}</strong>
          {state.selectedFileKind === "image" || state.selectedFileKind === "video" ? (
            <span className="workspace-files-reader-meta">
              {state.selectedFileMimeType ? <span>{state.selectedFileMimeType}</span> : null}
              {selectedFileSizeLabel ? <span>{selectedFileSizeLabel}</span> : null}
            </span>
          ) : null}
        </div>

        <div className="workspace-files-reader-actions">
          {state.comments.length > 0 ? (
            <span className="settings-badge">{String(state.comments.length)} comments</span>
          ) : null}
          {isSelectedMarkdown ? (
            <div className="workspace-files-view-toggle" role="group" aria-label="Markdown view mode">
              <button
                type="button"
                className={markdownViewMode === "preview" ? "is-active" : ""}
                aria-pressed={markdownViewMode === "preview"}
                onClick={() => setMarkdownViewMode("preview")}
              >
                <EyeIcon />
                <span>Rendered</span>
              </button>
              <button
                type="button"
                className={markdownViewMode === "source" ? "is-active" : ""}
                aria-pressed={markdownViewMode === "source"}
                onClick={() => setMarkdownViewMode("source")}
              >
                <CodeModeIcon />
                <span>Source</span>
              </button>
            </div>
          ) : null}
          {shouldRenderImagePreview ? (
            <div className="workspace-files-image-toolbar" role="group" aria-label="Image zoom controls">
              <button
                type="button"
                className={imageViewMode === "fit" ? "is-active" : ""}
                aria-pressed={imageViewMode === "fit"}
                title="Fit image"
                onClick={() => {
                  setImageViewMode("fit")
                  setImageScale(1)
                }}
              >
                <ExpandIcon />
                <span>Fit</span>
              </button>
              <button
                type="button"
                className={imageViewMode === "actual" && imageScale === 1 ? "is-active" : ""}
                aria-pressed={imageViewMode === "actual" && imageScale === 1}
                title="Actual size"
                onClick={() => setActualImageScale(1)}
              >
                <span>100%</span>
              </button>
              <button
                type="button"
                aria-label="Zoom out image"
                title="Zoom out"
                disabled={imageViewMode === "actual" && imageScale <= 0.25}
                onClick={() => zoomImage("out")}
              >
                <MinimizeIcon />
              </button>
              <span className="workspace-files-image-zoom-label">{imageZoomLabel}</span>
              <button
                type="button"
                aria-label="Zoom in image"
                title="Zoom in"
                disabled={imageViewMode === "actual" && imageScale >= 4}
                onClick={() => zoomImage("in")}
              >
                <PlusIcon />
              </button>
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  function renderSourceReader() {
    return (
      <div
        className={dragSelection ? "workspace-files-code is-selecting-lines" : "workspace-files-code"}
        data-theme={sourceHighlight.themeName ?? codeTheme}
        role="presentation"
        style={sourceHighlightStyle}
      >
        {fileLines.map((line, index) => {
          const lineNumber = index + 1
          const isCommenting = isLineWithinRange(pendingRange, lineNumber)
          const lineComments = commentsByEndLine.get(lineNumber) ?? []
          const lineLabel = pendingRange && isCommenting
            ? formatWorkspaceFileLineRangeLabel(pendingRange.startLineNumber, pendingRange.endLineNumber)
            : formatWorkspaceFileLineRangeLabel(lineNumber)
          const commentTargetLabel = pendingRange && isCommenting
            ? pendingRange.startLineNumber === pendingRange.endLineNumber
              ? `对第 L${String(pendingRange.startLineNumber)} 行发表评论`
              : `对第 L${String(pendingRange.startLineNumber)} 至第 L${String(pendingRange.endLineNumber)} 行发表评论`
            : ""
          const isSelectionHighlighted = isLineWithinRange(highlightedRange, lineNumber)
          const isLinkedLine = isLineWithinRange(linkedRange, lineNumber)

          return (
            <div key={`${state.selectedFilePath}:${lineNumber}`} className="workspace-files-code-block">
              <div
                ref={registerLineRef(lineNumber)}
                className={[
                  "workspace-files-line",
                  isCommenting ? "is-commenting" : "",
                  isSelectionHighlighted ? "is-selected" : "",
                  isLinkedLine ? "is-linked" : "",
                ].filter(Boolean).join(" ")}
                data-testid={`workspace-file-line-${lineNumber}`}
              >
                <div
                  className="workspace-files-line-gutter"
                  data-testid={`workspace-file-line-gutter-${lineNumber}`}
                  onMouseDown={(event) => handleLineSelectionStart(lineNumber, event)}
                  onMouseOver={() => handleLineSelectionMove(lineNumber)}
                  onMouseUp={() => handleLineSelectionEnd()}
                >
                  <span className="workspace-files-line-number">{String(lineNumber)}</span>
                  <button
                    type="button"
                    className="workspace-files-line-comment-button"
                    aria-label={t("files.addCommentOnLine", { line: lineNumber })}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={() => onPendingCommentStart(lineNumber)}
                  >
                    <PlusIcon />
                  </button>
                </div>
                <pre className="workspace-files-line-content code-highlight">
                  <code>
                    <HighlightedCodeLine line={line} tokens={sourceHighlight.tokenLines?.[index] ?? null} />
                  </code>
                </pre>
              </div>

              {pendingRange?.endLineNumber === lineNumber ? (
                <div className="workspace-files-comment-composer">
                  <div className="workspace-files-comment-editor">
                    <div className="workspace-files-comment-header">
                      <strong>本地评论</strong>
                      <span>{commentTargetLabel}</span>
                    </div>
                    <textarea
                      aria-label={t("files.fileCommentOn", { label: lineLabel.toLowerCase() })}
                      rows={3}
                      placeholder="请求更改"
                      value={state.pendingComment?.text ?? ""}
                      onChange={(event) => onPendingCommentChange(event.target.value)}
                    />
                    <div className="workspace-files-comment-actions">
                      <button
                        type="button"
                        className="workspace-files-comment-cancel"
                        onClick={() => onPendingCommentCancel()}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        className="workspace-files-comment-confirm"
                        disabled={!state.pendingComment?.text.trim() || !canInsertCommentsIntoDraft}
                        onClick={() => onPendingCommentConfirm()}
                      >
                        确认
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {lineComments.length > 0 ? (
                <div className="workspace-files-line-comments">
                  {lineComments.map((comment) => (
                    <article key={comment.id} className="workspace-files-line-comment">
                      <div className="workspace-files-line-comment-meta">
                        <strong>{formatWorkspaceFileLineRangeLabel(comment.startLineNumber, comment.endLineNumber)}</strong>
                        <time>{formatTime(comment.createdAt)}</time>
                      </div>
                      <p>{comment.text}</p>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    )
  }

  function renderMarkdownPreview() {
    return (
      <div className="workspace-files-markdown-stage">
        <ThreadMarkdown
          className="workspace-files-markdown thread-markdown"
          onLocalFileLinkOpen={handleMarkdownLocalFileOpen}
          resolveImageSrc={resolveWorkspaceMarkdownImageSrc}
          resolveLinkTarget={resolveWorkspaceMarkdownLinkTarget}
          text={state.selectedFileContent ?? ""}
        />
      </div>
    )
  }

  function renderImagePreview() {
    if (!state.selectedFilePreviewUrl) return null

    return (
      <div className="workspace-files-image-stage">
        <div
          className={[
            "workspace-files-image-frame",
            imageViewMode === "actual" ? "is-actual-size" : "is-fit",
          ].join(" ")}
          style={{ "--workspace-files-image-scale": String(imageScale) } as Record<string, string>}
        >
          <img
            className="workspace-files-image"
            src={state.selectedFilePreviewUrl}
            alt={state.selectedFilePath ?? "Workspace image preview"}
          />
        </div>
      </div>
    )
  }

  function renderVideoPreview() {
    if (!state.selectedFilePreviewUrl) return null

    return (
      <div className="workspace-files-video-stage">
        <video
          className="workspace-files-video"
          controls
          preload="metadata"
          src={state.selectedFilePreviewUrl}
          title={state.selectedFilePath ?? "Workspace video preview"}
        />
      </div>
    )
  }

  function renderReaderContent() {
    if (shouldRenderSourceReader || shouldRenderMarkdownPreview || shouldRenderImagePreview || shouldRenderVideoPreview) {
      return (
        <>
          {renderReaderHeader()}
          {shouldRenderMarkdownPreview ? renderMarkdownPreview() : null}
          {shouldRenderSourceReader ? renderSourceReader() : null}
          {shouldRenderImagePreview ? renderImagePreview() : null}
          {shouldRenderVideoPreview ? renderVideoPreview() : null}
        </>
      )
    }

    return (
      <div className="workspace-files-open-empty">
        {state.selectedFileKind === "image" ? <FileImageIcon /> : state.selectedFileKind === "video" ? <FileVideoIcon /> : <FileTextIcon />}
        <strong>{getReaderEmptyStateTitle(state)}</strong>
        <p>{getReaderEmptyStateCopy(state, scopeDirectory)}</p>
      </div>
    )
  }

  return (
    <section className="right-sidebar-section workspace-files-panel">
      <div className="workspace-files-pathbar" title={scopeDirectory ?? undefined}>
        <span className="workspace-files-pathbar-path">{getCurrentPathLabel(state.selectedFilePath)}</span>
        {scopeName ? <span className="workspace-files-pathbar-scope">{scopeName}</span> : null}
        <button
          type="button"
          className="workspace-files-tree-toggle"
          aria-controls="workspace-files-tree"
          aria-expanded={!isTreeCollapsed}
          aria-label={isTreeCollapsed ? "Expand file tree" : "Collapse file tree"}
          title={isTreeCollapsed ? "Expand file tree" : "Collapse file tree"}
          onClick={() => setIsTreeCollapsed((current) => !current)}
        >
          <FolderIcon />
        </button>
      </div>

      <div className={isTreeCollapsed ? "workspace-files-split is-tree-collapsed" : "workspace-files-split"}>
        <section className="workspace-files-reader" aria-label="Workspace file reader">
          {renderReaderContent()}
        </section>

        {isTreeCollapsed ? null : (
          <aside id="workspace-files-tree" className="workspace-files-tree" aria-label="Workspace file tree">
            <label className="workspace-files-tree-search">
              <SearchIcon />
              <input
                aria-label="Filter workspace files"
                type="search"
                value={state.query}
                placeholder="筛选文件..."
                onChange={handleSearchChange}
              />
            </label>
            <div className="workspace-files-tree-scroll">
              {renderTreeContent()}
            </div>
          </aside>
        )}
      </div>
    </section>
  )
}
