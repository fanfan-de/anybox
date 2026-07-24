import { type KeyboardEvent, type PointerEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { DeleteIcon, FileTextIcon, FolderIcon } from "../icons"
import { useI18n } from "../i18n/I18nProvider"
import { joinClassNames } from "../shared-ui"
import { ThreadMarkdown } from "../thread-markdown"
import type { GlobalSkillTreeNode, WorkspaceGroup } from "../types"
import { CREATE_SESSION_USAGE_TIPS, pickCreateSessionUsageTipIndex } from "./create-session-tips"
import { CreateSessionPixelLogo } from "./CreateSessionPixelLogo"

interface SkillMetadataField {
  key: string
  value: string | string[]
}

interface GlobalSkillsCanvasProps {
  deletingGlobalSkillDirectory: string | null
  globalSkillsRoot: string
  isDirty: boolean
  isLoadingFile: boolean
  isSavingFile: boolean
  selectedFileContent: string
  selectedFilePath: string | null
  selectedFileReadOnly: boolean
  selectedSkillDirectoryPath: string | null
  selectedSkillDirectoryName: string | null
  selectedSkillFiles: GlobalSkillTreeNode[]
  onChange: (value: string) => void
  onDelete: () => void | Promise<void>
  onFileSelect: (path: string) => void | Promise<void>
  onSave: () => void | Promise<void>
}

function stripYamlValueQuotes(value: string) {
  const trimmed = value.trim()
  if (trimmed.length < 2) return trimmed

  const first = trimmed[0]
  const last = trimmed[trimmed.length - 1]
  if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

function parseSkillMetadata(rawMetadata: string) {
  const metadata: SkillMetadataField[] = []
  let currentField: SkillMetadataField | null = null
  let isCollectingBlockScalar = false

  for (const line of rawMetadata.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue

    const fieldMatch = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (fieldMatch) {
      const value = stripYamlValueQuotes(fieldMatch[2])
      currentField = {
        key: fieldMatch[1],
        value: value === ">" || value === "|" ? "" : value,
      }
      isCollectingBlockScalar = value === ">" || value === "|"
      metadata.push(currentField)
      continue
    }

    const listItemMatch = /^\s*-\s+(.+)$/.exec(line)
    if (listItemMatch && currentField) {
      const nextValue = stripYamlValueQuotes(listItemMatch[1])
      currentField.value = Array.isArray(currentField.value)
        ? [...currentField.value, nextValue]
        : currentField.value
          ? [currentField.value, nextValue]
          : [nextValue]
      isCollectingBlockScalar = false
      continue
    }

    const continuationMatch = /^\s+(.+)$/.exec(line)
    if (continuationMatch && currentField && typeof currentField.value === "string") {
      const separator = isCollectingBlockScalar ? "\n" : " "
      currentField.value = currentField.value
        ? `${currentField.value}${separator}${continuationMatch[1].trim()}`
        : continuationMatch[1].trim()
    }
  }

  return metadata.filter((field) => Array.isArray(field.value) ? field.value.length > 0 : field.value.trim().length > 0)
}

function parseSkillMarkdownPreview(markdown: string) {
  const content = markdown.startsWith("\ufeff") ? markdown.slice(1) : markdown
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(content)

  if (!match) {
    return {
      body: markdown,
      metadata: [] as SkillMetadataField[],
    }
  }

  return {
    body: content.slice(match[0].length),
    metadata: parseSkillMetadata(match[1]),
  }
}

function getSkillMetadataValue(metadata: SkillMetadataField[], key: string) {
  const field = metadata.find((item) => item.key.toLowerCase() === key)
  if (!field) return null

  if (Array.isArray(field.value)) {
    return field.value.join(", ")
  }

  return field.value
}

function getSkillMetadataList(metadata: SkillMetadataField[], key: string) {
  const field = metadata.find((item) => item.key.toLowerCase() === key)
  if (!field) return []

  if (Array.isArray(field.value)) {
    return field.value
  }

  return field.value.split(",").map((item) => item.trim()).filter(Boolean)
}

function isTruthyMetadataValue(value: string | null) {
  return value ? ["1", "true", "yes"].includes(value.trim().toLowerCase()) : false
}

function SkillMetadataPanel({ metadata }: { metadata: SkillMetadataField[] }) {
  if (metadata.length === 0) return null

  const name = getSkillMetadataValue(metadata, "name")
  const description = getSkillMetadataValue(metadata, "description")
  const allowedTools = getSkillMetadataList(metadata, "allowed-tools")
  const hidden = isTruthyMetadataValue(getSkillMetadataValue(metadata, "hidden"))
  const reservedKeys = new Set(["name", "description", "allowed-tools", "hidden"])
  const extraMetadata = metadata.filter((field) => !reservedKeys.has(field.key.toLowerCase()))

  return (
    <section className="global-skills-metadata-panel" aria-label="Skill metadata">
      <div className="global-skills-metadata-summary">
        <div className="global-skills-metadata-copy">
          <span className="label">Skill Metadata</span>
          {name ? <strong>{name}</strong> : null}
          {description ? <p title={description}>{description}</p> : null}
        </div>
        {hidden ? <span className="global-skills-metadata-badge">Hidden</span> : null}
      </div>

      {allowedTools.length > 0 ? (
        <div className="global-skills-metadata-tools" aria-label="Allowed tools">
          <span>Tools</span>
          <div>
            {allowedTools.map((tool) => (
              <code key={tool}>{tool}</code>
            ))}
          </div>
        </div>
      ) : null}

      {extraMetadata.length > 0 ? (
        <details className="global-skills-metadata-details">
          <summary>More metadata</summary>
          <dl>
            {extraMetadata.map((field) => (
              <div key={field.key}>
                <dt>{field.key}</dt>
                <dd>{Array.isArray(field.value) ? field.value.join(", ") : field.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </section>
  )
}

function SkillMarkdownPreview({ text, showMetadata = true }: { text: string; showMetadata?: boolean }) {
  const { body, metadata } = parseSkillMarkdownPreview(text)

  return (
    <div className="global-skills-markdown-preview">
      {showMetadata ? <SkillMetadataPanel metadata={metadata} /> : null}
      <ThreadMarkdown
        className="thread-markdown global-skills-markdown-body"
        text={body}
      />
    </div>
  )
}

interface LocalSkillFileEntry {
  name: string
  path: string
  relativePath: string
}

function collectLocalSkillFiles(nodes: GlobalSkillTreeNode[], trail: string[] = []): LocalSkillFileEntry[] {
  return nodes.flatMap((node) => {
    const nextTrail = [...trail, node.name]
    if (node.kind === "file") {
      return [{
        name: node.name,
        path: node.path,
        relativePath: nextTrail.join("/"),
      }]
    }

    return collectLocalSkillFiles(node.children ?? [], nextTrail)
  })
}

export function GlobalSkillsCanvas({
  deletingGlobalSkillDirectory,
  globalSkillsRoot,
  isDirty,
  isLoadingFile,
  isSavingFile,
  selectedFileContent,
  selectedFilePath,
  selectedFileReadOnly,
  selectedSkillDirectoryPath,
  selectedSkillDirectoryName,
  selectedSkillFiles,
  onChange,
  onDelete,
  onFileSelect,
  onSave,
}: GlobalSkillsCanvasProps) {
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState<"overview" | "files">("overview")
  const [viewMode, setViewMode] = useState<"edit" | "preview">("preview")
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  const tabsID = useId()
  const tabRefs = useRef<Partial<Record<"overview" | "files", HTMLButtonElement | null>>>({})
  const localFiles = useMemo(() => collectLocalSkillFiles(selectedSkillFiles), [selectedSkillFiles])
  const skillDocument = localFiles.find((file) => file.relativePath.toLowerCase() === "skill.md")
    ?? localFiles.find((file) => file.name.toLowerCase() === "skill.md")
    ?? null
  const isSkillDocumentSelected = Boolean(
    skillDocument && selectedFilePath && skillDocument.path.toLowerCase() === selectedFilePath.toLowerCase(),
  )
  const parsedSkillDocument = useMemo(
    () => isSkillDocumentSelected && !isLoadingFile
      ? parseSkillMarkdownPreview(selectedFileContent)
      : { body: "", metadata: [] as SkillMetadataField[] },
    [isLoadingFile, isSkillDocumentSelected, selectedFileContent],
  )
  const metadataName = getSkillMetadataValue(parsedSkillDocument.metadata, "name")
  const metadataDescription = getSkillMetadataValue(parsedSkillDocument.metadata, "description")
  const displayName = metadataName || selectedSkillDirectoryName || "Skill"
  const sourceLabel = t("skillLibrary.mode.local")
  const accessLabel = selectedFileReadOnly ? t("skillLibrary.local.readOnly") : t("skillLibrary.local.editable")
  const tabs = [
    { id: "overview" as const, label: t("skillLibrary.detail.overview") },
    { id: "files" as const, label: t("skillLibrary.detail.files") },
  ]

  useEffect(() => {
    setActiveTab("overview")
    setViewMode("preview")
  }, [selectedSkillDirectoryPath])

  useEffect(() => {
    if (!selectedFilePath || isLoadingFile || activeTab !== "files" || viewMode !== "edit") return
    editorRef.current?.focus({ preventScroll: true })
  }, [activeTab, isLoadingFile, selectedFilePath, viewMode])

  function handleEditorShellPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || isLoadingFile || activeTab !== "files" || viewMode !== "edit") return
    editorRef.current?.focus({ preventScroll: true })
  }

  function selectDetailTab(tab: "overview" | "files") {
    setActiveTab(tab)
    if (tab === "overview" && skillDocument && selectedFilePath !== skillDocument.path) {
      setViewMode("preview")
      void onFileSelect(skillDocument.path)
    }
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentTab: "overview" | "files") {
    const currentIndex = tabs.findIndex((tab) => tab.id === currentTab)
    const nextIndex = event.key === "ArrowRight"
      ? (currentIndex + 1) % tabs.length
      : event.key === "ArrowLeft"
        ? (currentIndex - 1 + tabs.length) % tabs.length
        : -1
    if (nextIndex < 0) return
    event.preventDefault()
    const nextTab = tabs[nextIndex]!.id
    selectDetailTab(nextTab)
    tabRefs.current[nextTab]?.focus()
  }

  if (!selectedFilePath || !selectedSkillDirectoryPath) {
    return (
      <section className="global-skills-canvas skill-library-local-detail">
        <div className="skill-library-downloaded-empty">
          {globalSkillsRoot ? t("skillLibrary.detail.empty") : t("app.loadingData")}
        </div>
      </section>
    )
  }

  const editorShellClassName = viewMode === "preview"
    ? `global-skills-editor-shell is-preview${selectedFileReadOnly ? " is-read-only" : ""}`
    : `global-skills-editor-shell${selectedFileReadOnly ? " is-read-only" : ""}`

  return (
    <article className="global-skills-canvas skill-library-detail-panel skill-library-downloaded-detail skill-library-local-detail">
      <div className="skill-library-downloaded-chrome">
        <header className="skill-library-detail-header">
          <div className="skill-library-downloaded-identity">
            <span className="skill-library-product-icon is-local" aria-hidden="true">
              <FileTextIcon />
            </span>
            <div className="skill-library-detail-heading">
              <div className="skill-library-downloaded-title-line">
                <h2>{displayName}</h2>
                <span className="skill-library-state-badge">{sourceLabel}</span>
                <span className="skill-library-state-badge">{accessLabel}</span>
              </div>
              {metadataDescription ? <p>{metadataDescription}</p> : null}
              <div className="skill-library-detail-meta">
                <span>{selectedSkillDirectoryName}</span>
                <span>{t("skillLibrary.local.skillFileName")}</span>
              </div>
            </div>
          </div>
        </header>
        <nav className="skill-library-detail-tabs skill-library-downloaded-tabs" role="tablist" aria-label={t("skillLibrary.detail.tabsAria")}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              ref={(node) => { tabRefs.current[tab.id] = node }}
              id={`${tabsID}-tab-${tab.id}`}
              className={joinClassNames("skill-library-detail-tab", activeTab === tab.id ? "is-active" : null)}
              type="button"
              role="tab"
              aria-controls={`${tabsID}-panel`}
              aria-selected={activeTab === tab.id}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => selectDetailTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div
        id={`${tabsID}-panel`}
        className="skill-library-detail-content skill-library-downloaded-tabpanel"
        role="tabpanel"
        aria-labelledby={`${tabsID}-tab-${activeTab}`}
      >
        {activeTab === "overview" ? (
          <div className="skill-library-downloaded-overview skill-library-local-overview">
            {isLoadingFile ? (
              <div className="skill-library-detail-empty">{t("app.loadingData")}</div>
            ) : (
              <>
                <dl className="skill-library-overview-grid">
                  <div><dt>{t("skillLibrary.metadata.source")}</dt><dd>{sourceLabel}</dd></div>
                  <div><dt>{t("skillLibrary.metadata.state")}</dt><dd>{accessLabel}</dd></div>
                  <div><dt>{t("skillLibrary.metadata.path")}</dt><dd>{selectedSkillDirectoryPath}</dd></div>
                  <div><dt>{t("skillLibrary.detail.files")}</dt><dd>{localFiles.length}</dd></div>
                </dl>
                <section className="skill-library-local-instructions">
                  <h3>{t("skillLibrary.local.instructions")}</h3>
                  <SkillMarkdownPreview text={selectedFileContent} showMetadata={false} />
                </section>
                {!selectedFileReadOnly ? (
                  <div className="skill-library-danger-zone">
                    <p>{t("skillLibrary.local.deleteDescription")}</p>
                    <button
                      className="secondary-button is-danger"
                      disabled={!selectedSkillDirectoryName || deletingGlobalSkillDirectory !== null}
                      type="button"
                      onClick={() => void onDelete()}
                    >
                      <DeleteIcon />
                      <span>{deletingGlobalSkillDirectory ? t("app.removing") : t("app.delete")}</span>
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : (
          <div className="skill-library-files-layout skill-library-local-files-layout">
            <div className="skill-library-file-list" aria-label={t("skillLibrary.files.aria")}>
              {localFiles.map((file) => (
                <button
                  key={file.path}
                  className={joinClassNames("skill-library-file-row", file.path === selectedFilePath ? "is-selected" : null)}
                  type="button"
                  aria-label={file.relativePath}
                  onClick={() => {
                    setViewMode(file.name.toLowerCase().endsWith(".md") ? "preview" : "edit")
                    void onFileSelect(file.path)
                  }}
                >
                  <FileTextIcon />
                  <span>{file.relativePath}</span>
                </button>
              ))}
            </div>
            <div className="skill-library-local-file-editor">
              <div className="global-skills-toolbar">
                <div className="global-skills-toolbar-spacer" aria-hidden="true" />
                <div className="global-skills-toolbar-actions">
                  <div
                    className="global-skills-mode-toggle"
                    role="group"
                    aria-label={t("skillLibrary.local.viewModeAria")}
                  >
                    <button
                      className={viewMode === "edit" ? "global-skills-mode-button is-active" : "global-skills-mode-button"}
                      aria-pressed={viewMode === "edit"}
                      type="button"
                      onClick={() => setViewMode("edit")}
                    >
                      {t("skillLibrary.local.edit")}
                    </button>
                    <button
                      className={viewMode === "preview" ? "global-skills-mode-button is-active" : "global-skills-mode-button"}
                      aria-pressed={viewMode === "preview"}
                      disabled={!selectedFilePath.toLowerCase().endsWith(".md")}
                      type="button"
                      onClick={() => setViewMode("preview")}
                    >
                      {t("skillLibrary.local.preview")}
                    </button>
                  </div>
                  {selectedFileReadOnly ? <span className="global-skills-readonly-badge">{accessLabel}</span> : null}
                  {!selectedFileReadOnly ? (
                    <button className="primary-button" disabled={!isDirty || isSavingFile} type="button" onClick={() => void onSave()}>
                      {isSavingFile ? t("app.saving") : t("app.save")}
                    </button>
                  ) : null}
                </div>
              </div>
              <div className={editorShellClassName} onPointerDown={handleEditorShellPointerDown}>
                {isLoadingFile ? (
                  <div className="global-skills-empty-state global-skills-editor-empty-state">
                    <p>{t("app.loadingData")}</p>
                  </div>
                ) : viewMode === "edit" ? (
                  <textarea
                    ref={editorRef}
                    aria-label={selectedFileReadOnly ? t("skillLibrary.local.readOnly") : t("skillLibrary.local.editor")}
                    className="global-skills-editor"
                    readOnly={selectedFileReadOnly}
                    spellCheck={false}
                    value={selectedFileContent}
                    onChange={(event) => {
                      if (selectedFileReadOnly) return
                      onChange(event.target.value)
                    }}
                  />
                ) : (
                  <SkillMarkdownPreview text={selectedFileContent} />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </article>
  )
}

interface CreateSessionCanvasProps {
  conversationWorkspaceID?: string | null
  isCreatingSession: boolean
  selectedWorkspaceID: string | null
  workspaces: WorkspaceGroup[]
  onOpenProjectFolder: () => void | Promise<void>
  onWorkspaceChange: (workspaceID: string) => void
}

const CREATE_SESSION_TIP_ROTATION_MS = 8_000
const CREATE_SESSION_TIP_EXIT_MS = 120
const CREATE_SESSION_TIP_ENTER_MS = 180

type CreateSessionTipTransitionPhase = "idle" | "exiting" | "entering"

function CreateSessionUsageTipView() {
  const { t } = useI18n()
  const [tipIndex, setTipIndex] = useState(() =>
    pickCreateSessionUsageTipIndex(-1, CREATE_SESSION_USAGE_TIPS.length),
  )
  const [transitionPhase, setTransitionPhase] = useState<CreateSessionTipTransitionPhase>("idle")
  const tip = CREATE_SESSION_USAGE_TIPS[tipIndex] ?? CREATE_SESSION_USAGE_TIPS[0]

  const showNextTip = useCallback(() => {
    if (CREATE_SESSION_USAGE_TIPS.length <= 1) return

    setTransitionPhase((currentPhase) =>
      currentPhase === "idle" ? "exiting" : currentPhase,
    )
  }, [])

  useEffect(() => {
    if (transitionPhase === "idle") return

    const timeoutID = window.setTimeout(() => {
      if (transitionPhase === "exiting") {
        setTipIndex((currentIndex) =>
          pickCreateSessionUsageTipIndex(currentIndex, CREATE_SESSION_USAGE_TIPS.length),
        )
        setTransitionPhase("entering")
        return
      }

      setTransitionPhase("idle")
    }, transitionPhase === "exiting" ? CREATE_SESSION_TIP_EXIT_MS : CREATE_SESSION_TIP_ENTER_MS)

    return () => window.clearTimeout(timeoutID)
  }, [transitionPhase])

  useEffect(() => {
    if (CREATE_SESSION_USAGE_TIPS.length <= 1 || transitionPhase !== "idle") return

    const timeoutID = window.setTimeout(showNextTip, CREATE_SESSION_TIP_ROTATION_MS)
    return () => window.clearTimeout(timeoutID)
  }, [showNextTip, tipIndex, transitionPhase])

  if (!tip) return null

  const tipText = t(tip.messageKey)

  return (
    <button
      className={joinClassNames("create-session-tip", `is-${transitionPhase}`)}
      type="button"
      aria-label={t("createSession.tip.nextAria", { tip: tipText })}
      title={t("createSession.tip.nextTitle")}
      onClick={showNextTip}
    >
      <span key={tip.id} className="create-session-tip-text">
        {tipText}
      </span>
    </button>
  )
}

function getWorkspaceLabel(workspace: WorkspaceGroup) {
  const projectName = workspace.project.name.trim()
  const workspaceName = workspace.name.trim()

  if (!projectName || projectName === workspaceName) return workspaceName
  if (!workspaceName) return projectName

  return `${projectName} / ${workspaceName}`
}

function getSelectedCreateSessionWorkspace(workspaces: WorkspaceGroup[], selectedWorkspaceID: string | null) {
  return workspaces.find((workspace) => workspace.id === selectedWorkspaceID) ?? null
}

export function getCreateSessionProjectWorkspaces(
  workspaces: WorkspaceGroup[],
  conversationWorkspaceID?: string | null,
) {
  return conversationWorkspaceID && workspaces.length === 1 && workspaces[0]?.id === conversationWorkspaceID
    ? []
    : workspaces
}

function CreateSessionWorkspaceSelect({
  disabled,
  selectedWorkspaceID,
  workspaces,
  onWorkspaceChange,
}: {
  disabled: boolean
  selectedWorkspaceID: string | null
  workspaces: WorkspaceGroup[]
  onWorkspaceChange: (workspaceID: string) => void
}) {
  const menuID = useId()
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const selectedIndex = workspaces.findIndex((workspace) => workspace.id === selectedWorkspaceID)
  const selectedOptionIndex = selectedIndex >= 0 ? selectedIndex : workspaces.length > 0 ? 0 : -1
  const selectedWorkspace = selectedOptionIndex >= 0 ? workspaces[selectedOptionIndex] : null
  const selectedLabel = selectedWorkspace ? getWorkspaceLabel(selectedWorkspace) : "No project available"
  const isDisabled = disabled || workspaces.length === 0
  const [activeIndex, setActiveIndex] = useState(selectedOptionIndex >= 0 ? selectedOptionIndex : 0)

  useEffect(() => {
    setActiveIndex(selectedOptionIndex >= 0 ? selectedOptionIndex : 0)
  }, [selectedOptionIndex])

  useEffect(() => {
    if (!isMenuOpen) return

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setIsMenuOpen(false)
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return
      setIsMenuOpen(false)
      buttonRef.current?.focus({ preventScroll: true })
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [isMenuOpen])

  function focusOption(index: number) {
    if (index < 0 || index >= workspaces.length) return
    setActiveIndex(index)
    window.requestAnimationFrame(() => {
      optionRefs.current[index]?.focus({ preventScroll: true })
    })
  }

  function openMenu(index = selectedOptionIndex >= 0 ? selectedOptionIndex : 0) {
    if (isDisabled) return
    setIsMenuOpen(true)
    focusOption(index)
  }

  function closeMenu(focusTrigger = false) {
    setIsMenuOpen(false)
    if (focusTrigger) {
      window.requestAnimationFrame(() => {
        buttonRef.current?.focus({ preventScroll: true })
      })
    }
  }

  function selectWorkspace(index: number) {
    const workspace = workspaces[index]
    if (!workspace || isDisabled) return

    closeMenu(true)
    if (workspace.id !== selectedWorkspaceID) {
      onWorkspaceChange(workspace.id)
    }
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (isDisabled) return

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      openMenu(selectedOptionIndex >= 0 ? selectedOptionIndex : 0)
      return
    }

    if (event.key === "Home") {
      event.preventDefault()
      openMenu(0)
      return
    }

    if (event.key === "End") {
      event.preventDefault()
      openMenu(workspaces.length - 1)
    }
  }

  function handleOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      focusOption((index + 1) % workspaces.length)
      return
    }

    if (event.key === "ArrowUp") {
      event.preventDefault()
      focusOption((index - 1 + workspaces.length) % workspaces.length)
      return
    }

    if (event.key === "Home") {
      event.preventDefault()
      focusOption(0)
      return
    }

    if (event.key === "End") {
      event.preventDefault()
      focusOption(workspaces.length - 1)
      return
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      selectWorkspace(index)
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      closeMenu(true)
      return
    }

    if (event.key === "Tab") {
      setIsMenuOpen(false)
    }
  }

  return (
    <div className="create-session-workspace-select">
      <button
        ref={buttonRef}
        type="button"
        className={joinClassNames("create-session-select-trigger", isMenuOpen && "is-active")}
        aria-controls={isMenuOpen ? menuID : undefined}
        aria-expanded={isMenuOpen}
        aria-haspopup="listbox"
        aria-label="Session project"
        disabled={isDisabled}
        role="combobox"
        title={selectedLabel}
        onClick={() => {
          if (isMenuOpen) {
            closeMenu()
            return
          }
          openMenu()
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span>{selectedLabel}</span>
      </button>

      {isMenuOpen ? (
        <div
          ref={menuRef}
          id={menuID}
          className="create-session-select-panel"
          role="listbox"
          aria-label="Session project"
        >
          {workspaces.map((workspace, index) => {
            const isSelected = index === selectedOptionIndex

            return (
              <button
                key={workspace.id}
                ref={(node) => {
                  optionRefs.current[index] = node
                }}
                type="button"
                className={joinClassNames(
                  "create-session-select-option",
                  isSelected && "is-selected",
                  index === activeIndex && "is-active",
                )}
                aria-selected={isSelected}
                role="option"
                title={getWorkspaceLabel(workspace)}
                onClick={() => selectWorkspace(index)}
                onFocus={() => setActiveIndex(index)}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span>{getWorkspaceLabel(workspace)}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function CreateSessionGuide({
  selectedWorkspace,
  workspaces,
  onOpenProjectFolder,
}: {
  selectedWorkspace: WorkspaceGroup | null
  workspaces: WorkspaceGroup[]
  onOpenProjectFolder: () => void | Promise<void>
}) {
  if (workspaces.length === 0) {
    return (
      <button
        className="create-session-guide-primary"
        type="button"
        aria-label="Open project folder"
        onClick={() => void onOpenProjectFolder()}
      >
        <FolderIcon />
        <span>Open folder</span>
      </button>
    )
  }

  if (!selectedWorkspace) {
    return (
      <div className="create-session-guide is-missing-selection">
        <div className="create-session-guide-copy">
          <p className="create-session-guide-kicker">Project required</p>
          <h2>Select a project before sending</h2>
          <p>Choose a project from the selector above, or open another folder if the target project is not listed.</p>
        </div>
        <button
          className="create-session-guide-secondary"
          type="button"
          aria-label="Open project folder"
          onClick={() => void onOpenProjectFolder()}
        >
          <FolderIcon />
          <span>Open folder</span>
        </button>
      </div>
    )
  }

  return null
}

export function CreateSessionCanvas({
  conversationWorkspaceID = null,
  isCreatingSession,
  selectedWorkspaceID,
  workspaces,
  onOpenProjectFolder,
  onWorkspaceChange,
}: CreateSessionCanvasProps) {
  const projectWorkspaces = getCreateSessionProjectWorkspaces(workspaces, conversationWorkspaceID)
  const selectedWorkspace = getSelectedCreateSessionWorkspace(projectWorkspaces, selectedWorkspaceID)

  return (
    <section className="thread-shell create-session-shell">
      <article className="create-session-card">
        <CreateSessionPixelLogo />
        <CreateSessionWorkspaceSelect
          disabled={isCreatingSession || projectWorkspaces.length === 0}
          selectedWorkspaceID={selectedWorkspaceID}
          workspaces={projectWorkspaces}
          onWorkspaceChange={onWorkspaceChange}
        />
        {selectedWorkspace ? <CreateSessionUsageTipView /> : null}
        <CreateSessionGuide
          selectedWorkspace={selectedWorkspace}
          workspaces={projectWorkspaces}
          onOpenProjectFolder={onOpenProjectFolder}
        />
      </article>
    </section>
  )
}
