import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import {
  ChevronRightIcon,
  CloseIcon,
  CodeModeIcon,
  EyeIcon,
  FileImageIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
} from "../icons"
import { useI18n } from "../i18n/I18nProvider"
import { joinClassNames } from "../shared-ui"
import { SkillDocumentPreview } from "../skills/SkillDocumentPreview"
import type {
  PluginSkillDirectory,
  PluginSkillEntry,
  PluginSkillFile,
  PluginSkillPreview,
} from "../types"

interface PluginSkillBrowserPanelProps {
  pluginID: string
  pluginName: string
  skill: PluginSkillPreview
  onClose: () => void
}

type DirectoryLoadErrors = Record<string, string>

function formatFileSize(size: number) {
  const units = ["B", "KB", "MB", "GB"] as const
  let value = Math.max(0, size)
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const formatted = unitIndex === 0 ? String(value) : value.toFixed(value >= 10 ? 1 : 2)
  return `${formatted} ${units[unitIndex]}`
}

function isMarkdownFile(file: PluginSkillFile) {
  return file.mimeType === "text/markdown" || /\.(?:md|markdown)$/i.test(file.name)
}

function stripSkillFrontmatter(content: string) {
  if (!content.startsWith("---")) return content
  const match = content.match(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/)
  return match ? content.slice(match[0].length) : content
}

function focusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(
    "button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex='-1'])",
  )).filter((element) => !element.hasAttribute("hidden"))
}

interface SkillTreeEntriesProps {
  depth: number
  directoryPath: string
  directories: Record<string, PluginSkillDirectory>
  directoryErrors: DirectoryLoadErrors
  expandedPaths: Set<string>
  loadingPaths: Set<string>
  selectedFilePath: string | null
  onDirectoryToggle: (entry: PluginSkillEntry) => void
  onFileSelect: (path: string) => void
}

function SkillTreeEntries({
  depth,
  directoryPath,
  directories,
  directoryErrors,
  expandedPaths,
  loadingPaths,
  selectedFilePath,
  onDirectoryToggle,
  onFileSelect,
}: SkillTreeEntriesProps) {
  const { t } = useI18n()
  const directory = directories[directoryPath]
  if (!directory) {
    if (loadingPaths.has(directoryPath)) {
      return <div className="plugins-skill-tree-message" role="status">{t("plugins.skill.loading")}</div>
    }
    if (directoryErrors[directoryPath]) {
      return <div className="plugins-skill-tree-message is-error" role="alert">{directoryErrors[directoryPath]}</div>
    }
    return null
  }

  return (
    <>
      {directory.entries.map((entry) => {
        const isDirectory = entry.kind === "directory"
        const isExpanded = isDirectory && expandedPaths.has(entry.path)
        const isSelected = !isDirectory && selectedFilePath === entry.path
        const rowStyle = {
          "--plugins-skill-tree-indent": `${depth * 16}px`,
        } as CSSProperties

        return (
          <div key={`${entry.kind}:${entry.path}`} role="none">
            <button
              className={joinClassNames(
                "plugins-skill-tree-row",
                isSelected ? "is-selected" : null,
              )}
              type="button"
              role="treeitem"
              aria-expanded={isDirectory ? isExpanded : undefined}
              aria-selected={isDirectory ? undefined : isSelected}
              data-entry-kind={entry.kind}
              data-entry-path={entry.path}
              style={rowStyle}
              title={entry.path}
              onClick={() => {
                if (isDirectory) {
                  onDirectoryToggle(entry)
                } else {
                  onFileSelect(entry.path)
                }
              }}
            >
              <span className="plugins-skill-tree-chevron" aria-hidden="true">
                {isDirectory && entry.hasChildren !== false ? <ChevronRightIcon /> : null}
              </span>
              <span className="plugins-skill-tree-icon" aria-hidden="true">
                {isDirectory
                  ? isExpanded ? <FolderOpenIcon /> : <FolderIcon />
                  : entry.mimeType?.startsWith("image/") ? <FileImageIcon /> : <FileTextIcon />}
              </span>
              <span className="plugins-skill-tree-label">{entry.name}</span>
            </button>
            {isDirectory && isExpanded ? (
              <SkillTreeEntries
                depth={depth + 1}
                directoryPath={entry.path}
                directories={directories}
                directoryErrors={directoryErrors}
                expandedPaths={expandedPaths}
                loadingPaths={loadingPaths}
                selectedFilePath={selectedFilePath}
                onDirectoryToggle={onDirectoryToggle}
                onFileSelect={onFileSelect}
              />
            ) : null}
          </div>
        )
      })}
      {directory.entries.length === 0 ? (
        <div className="plugins-skill-tree-message">{t("plugins.skill.empty")}</div>
      ) : null}
    </>
  )
}

function ReaderEmptyState({
  icon,
  title,
  copy,
}: {
  icon: ReactNode
  title: string
  copy?: string
}) {
  return (
    <div className="plugins-skill-reader-empty">
      <span aria-hidden="true">{icon}</span>
      <strong>{title}</strong>
      {copy ? <p>{copy}</p> : null}
    </div>
  )
}

export function PluginSkillBrowserPanel({
  pluginID,
  pluginName,
  skill,
  onClose,
}: PluginSkillBrowserPanelProps) {
  const { t } = useI18n()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const treeRef = useRef<HTMLDivElement | null>(null)
  const fileRequestIDRef = useRef(0)
  const [directories, setDirectories] = useState<Record<string, PluginSkillDirectory>>({})
  const [directoryErrors, setDirectoryErrors] = useState<DirectoryLoadErrors>({})
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set([""]))
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set())
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<PluginSkillFile | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [isFileLoading, setIsFileLoading] = useState(false)
  const [markdownMode, setMarkdownMode] = useState<"preview" | "source">("preview")

  const loadDirectory = useCallback(async (path: string) => {
    const client = window.desktop?.listInstalledPluginSkillEntries
    if (!client) {
      setDirectoryErrors((current) => ({
        ...current,
        [path]: t("plugins.skill.loadFailed"),
      }))
      return null
    }

    setLoadingPaths((current) => new Set(current).add(path))
    setDirectoryErrors((current) => {
      const next = { ...current }
      delete next[path]
      return next
    })

    try {
      const directory = await client({
        pluginID,
        skillID: skill.id,
        path,
      })
      setDirectories((current) => ({
        ...current,
        [path]: directory,
      }))
      return directory
    } catch (error) {
      setDirectoryErrors((current) => ({
        ...current,
        [path]: error instanceof Error ? error.message : t("plugins.skill.loadFailed"),
      }))
      return null
    } finally {
      setLoadingPaths((current) => {
        const next = new Set(current)
        next.delete(path)
        return next
      })
    }
  }, [pluginID, skill.id, t])

  useEffect(() => {
    setDirectories({})
    setDirectoryErrors({})
    setExpandedPaths(new Set([""]))
    setLoadingPaths(new Set())
    setSelectedFilePath(null)
    setSelectedFile(null)
    setFileError(null)
    setMarkdownMode("preview")

    void loadDirectory("").then((root) => {
      const defaultFile = root?.entries.find((entry) => entry.kind === "file" && entry.name === "SKILL.md")
      if (defaultFile) setSelectedFilePath(defaultFile.path)
    })
  }, [loadDirectory])

  useEffect(() => {
    if (!selectedFilePath) {
      setSelectedFile(null)
      setFileError(null)
      setIsFileLoading(false)
      return
    }

    const requestID = fileRequestIDRef.current + 1
    fileRequestIDRef.current = requestID
    const client = window.desktop?.readInstalledPluginSkillFile
    setSelectedFile(null)
    setFileError(null)
    setIsFileLoading(true)
    setMarkdownMode("preview")

    if (!client) {
      setFileError(t("plugins.skill.fileFailed"))
      setIsFileLoading(false)
      return
    }

    void client({
      pluginID,
      skillID: skill.id,
      path: selectedFilePath,
    }).then((file) => {
      if (fileRequestIDRef.current !== requestID) return
      setSelectedFile(file)
    }).catch((error) => {
      if (fileRequestIDRef.current !== requestID) return
      setFileError(error instanceof Error ? error.message : t("plugins.skill.fileFailed"))
    }).finally(() => {
      if (fileRequestIDRef.current === requestID) setIsFileLoading(false)
    })
  }, [pluginID, selectedFilePath, skill.id, t])

  useEffect(() => {
    dialogRef.current?.focus()

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  const rootLoading = loadingPaths.has("") && !directories[""]
  const browserTitle = t("plugins.skill.browserTitle", { skill: skill.name })
  const selectedFileSize = selectedFile ? formatFileSize(selectedFile.size) : null
  const renderedMarkdown = useMemo(
    () => selectedFile?.content ? stripSkillFrontmatter(selectedFile.content) : "",
    [selectedFile],
  )

  function toggleDirectory(entry: PluginSkillEntry) {
    const isExpanded = expandedPaths.has(entry.path)
    setExpandedPaths((current) => {
      const next = new Set(current)
      if (isExpanded) {
        next.delete(entry.path)
      } else {
        next.add(entry.path)
      }
      return next
    })

    if (!isExpanded && entry.hasChildren !== false && !directories[entry.path] && !loadingPaths.has(entry.path)) {
      void loadDirectory(entry.path)
    }
  }

  function handleTreeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const current = event.target instanceof HTMLElement
      ? event.target.closest<HTMLButtonElement>("[role='treeitem']")
      : null
    if (!current || !treeRef.current) return

    const items = Array.from(treeRef.current.querySelectorAll<HTMLButtonElement>("[role='treeitem']"))
    const index = items.indexOf(current)
    if (event.key === "ArrowDown" && index >= 0) {
      event.preventDefault()
      items[Math.min(items.length - 1, index + 1)]?.focus()
      return
    }
    if (event.key === "ArrowUp" && index >= 0) {
      event.preventDefault()
      items[Math.max(0, index - 1)]?.focus()
      return
    }
    if (event.key === "Home") {
      event.preventDefault()
      items[0]?.focus()
      return
    }
    if (event.key === "End") {
      event.preventDefault()
      items.at(-1)?.focus()
      return
    }

    if (current.dataset.entryKind !== "directory") return
    const path = current.dataset.entryPath
    if (!path) return
    const directoryEntry = Object.values(directories)
      .flatMap((directory) => directory.entries)
      .find((entry) => entry.kind === "directory" && entry.path === path)
    if (!directoryEntry) return

    if (event.key === "ArrowRight" && !expandedPaths.has(path)) {
      event.preventDefault()
      toggleDirectory(directoryEntry)
    } else if (event.key === "ArrowLeft" && expandedPaths.has(path)) {
      event.preventDefault()
      toggleDirectory(directoryEntry)
    }
  }

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab" || !dialogRef.current) return
    const focusable = focusableElements(dialogRef.current)
    if (focusable.length === 0) {
      event.preventDefault()
      dialogRef.current.focus()
      return
    }

    const first = focusable[0]!
    const last = focusable.at(-1)!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function handleMarkdownTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    const tabs = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='tab']") ?? [],
    )
    const currentIndex = tabs.indexOf(event.currentTarget)
    if (currentIndex < 0) return

    event.preventDefault()
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : event.key === "ArrowLeft"
          ? (currentIndex - 1 + tabs.length) % tabs.length
          : (currentIndex + 1) % tabs.length
    const nextTab = tabs[nextIndex]
    nextTab?.focus()
    nextTab?.click()
  }

  function renderReader() {
    if (isFileLoading) {
      return (
        <ReaderEmptyState
          icon={<FileTextIcon />}
          title={t("plugins.skill.fileLoading")}
        />
      )
    }
    if (fileError) {
      return (
        <ReaderEmptyState
          icon={<FileTextIcon />}
          title={t("plugins.skill.fileFailed")}
          copy={fileError}
        />
      )
    }
    if (!selectedFile) {
      return (
        <ReaderEmptyState
          icon={<FileTextIcon />}
          title={t("plugins.skill.selectFile")}
        />
      )
    }

    const markdown = isMarkdownFile(selectedFile)
    const readerHeader = (
      <header className="plugins-skill-reader-header">
        <div className="plugins-skill-reader-heading">
          <strong title={selectedFile.path}>{selectedFile.path}</strong>
          <span>{selectedFile.mimeType} · {selectedFileSize}</span>
        </div>
        {markdown && selectedFile.content ? (
          <div className="plugins-skill-view-tabs" role="tablist" aria-label={t("plugins.skill.viewAria")}>
            <button
              type="button"
              role="tab"
              aria-selected={markdownMode === "preview"}
              tabIndex={markdownMode === "preview" ? 0 : -1}
              className={markdownMode === "preview" ? "is-active" : undefined}
              onClick={() => setMarkdownMode("preview")}
              onKeyDown={handleMarkdownTabKeyDown}
            >
              <EyeIcon />
              <span>{t("plugins.skill.preview")}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={markdownMode === "source"}
              tabIndex={markdownMode === "source" ? 0 : -1}
              className={markdownMode === "source" ? "is-active" : undefined}
              onClick={() => setMarkdownMode("source")}
              onKeyDown={handleMarkdownTabKeyDown}
            >
              <CodeModeIcon />
              <span>{t("plugins.skill.source")}</span>
            </button>
          </div>
        ) : null}
      </header>
    )

    if (selectedFile.tooLarge) {
      return (
        <>
          {readerHeader}
          <ReaderEmptyState
            icon={<FileTextIcon />}
            title={t("plugins.skill.tooLargeTitle")}
            copy={t("plugins.skill.tooLargeCopy")}
          />
        </>
      )
    }
    if (selectedFile.kind === "image" && selectedFile.previewUrl) {
      return (
        <>
          {readerHeader}
          <div className="plugins-skill-image-stage">
            <img src={selectedFile.previewUrl} alt={selectedFile.name} />
          </div>
        </>
      )
    }
    if (selectedFile.kind === "text" && selectedFile.content !== undefined) {
      return (
        <>
          {readerHeader}
          {markdown && markdownMode === "preview" ? (
            <div className="plugins-skill-markdown-stage" role="tabpanel">
              <SkillDocumentPreview content={renderedMarkdown} />
            </div>
          ) : (
            <pre className="plugins-skill-source-stage" role={markdown ? "tabpanel" : undefined} data-i18n-skip>
              <code>{selectedFile.content}</code>
            </pre>
          )}
        </>
      )
    }

    return (
      <>
        {readerHeader}
        <ReaderEmptyState
          icon={<FileTextIcon />}
          title={t("plugins.skill.binaryTitle")}
          copy={t("plugins.skill.binaryCopy")}
        />
      </>
    )
  }

  return createPortal(
    <div
      className="plugins-skill-browser-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className="plugins-skill-browser-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={browserTitle}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
      >
        <header className="plugins-skill-browser-header">
          <div className="plugins-skill-browser-title">
            <span>{pluginName} / {skill.directory}</span>
            <h2>{skill.name}</h2>
          </div>
          <span className="plugins-skill-readonly-label">{t("plugins.skill.readOnly")}</span>
          <button
            className="plugins-skill-browser-close"
            type="button"
            aria-label={t("plugins.skill.close")}
            title={t("app.close")}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <div className="plugins-skill-browser-content">
          <aside className="plugins-skill-tree-pane" aria-label={t("plugins.skill.files")}>
            <div className="plugins-skill-tree-heading">
              <FolderOpenIcon />
              <strong>{skill.directory}</strong>
            </div>
            <div
              ref={treeRef}
              className="plugins-skill-tree"
              role="tree"
              aria-label={t("plugins.skill.files")}
              aria-busy={rootLoading}
              onKeyDown={handleTreeKeyDown}
            >
              {rootLoading ? (
                <div className="plugins-skill-tree-message" role="status">{t("plugins.skill.loading")}</div>
              ) : (
                <SkillTreeEntries
                  depth={0}
                  directoryPath=""
                  directories={directories}
                  directoryErrors={directoryErrors}
                  expandedPaths={expandedPaths}
                  loadingPaths={loadingPaths}
                  selectedFilePath={selectedFilePath}
                  onDirectoryToggle={toggleDirectory}
                  onFileSelect={setSelectedFilePath}
                />
              )}
            </div>
          </aside>
          <section className="plugins-skill-reader" aria-label={t("plugins.skill.previewPane")}>
            {renderReader()}
          </section>
        </div>
      </div>
    </div>,
    document.body,
  )
}
