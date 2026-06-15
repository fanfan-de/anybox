import { type KeyboardEvent, type PointerEvent, useEffect, useId, useRef, useState } from "react"
import { FolderIcon } from "../icons"
import { joinClassNames } from "../shared-ui"
import { ThreadMarkdown } from "../thread-markdown"
import type { WorkspaceGroup } from "../types"

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
  selectedSkillDirectoryName: string | null
  onChange: (value: string) => void
  onDelete: () => void | Promise<void>
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

function SkillMarkdownPreview({ text }: { text: string }) {
  const { body, metadata } = parseSkillMarkdownPreview(text)

  return (
    <div className="global-skills-markdown-preview">
      <SkillMetadataPanel metadata={metadata} />
      <ThreadMarkdown
        className="thread-markdown global-skills-markdown-body"
        text={body}
      />
    </div>
  )
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
  selectedSkillDirectoryName,
  onChange,
  onDelete,
  onSave,
}: GlobalSkillsCanvasProps) {
  const [viewMode, setViewMode] = useState<"edit" | "preview">("edit")
  const editorRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (!selectedFilePath || isLoadingFile || viewMode !== "edit") return
    editorRef.current?.focus({ preventScroll: true })
  }, [isLoadingFile, selectedFilePath, viewMode])

  function handleEditorShellPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || isLoadingFile || viewMode !== "edit") return
    editorRef.current?.focus({ preventScroll: true })
  }

  if (!selectedFilePath) {
    return (
      <section className="global-skills-canvas">
        <div className="global-skills-editor-shell">
          <div className="global-skills-empty-state global-skills-editor-empty-state">
            <span className="label">Skills</span>
            <h3>No skill file selected</h3>
            <p>{globalSkillsRoot ? "Select a skill file or create a new skill." : "Loading the skills folder..."}</p>
          </div>
        </div>
      </section>
    )
  }

  const editorShellClassName = viewMode === "preview"
    ? `global-skills-editor-shell is-preview${selectedFileReadOnly ? " is-read-only" : ""}`
    : `global-skills-editor-shell${selectedFileReadOnly ? " is-read-only" : ""}`

  return (
    <section className="global-skills-canvas">
      <div className="global-skills-toolbar">
        <div className="global-skills-toolbar-spacer" aria-hidden="true" />
        <div className="global-skills-toolbar-actions">
          <div className="global-skills-mode-toggle" role="group" aria-label="Skill markdown view mode">
            <button
              className={viewMode === "edit" ? "global-skills-mode-button is-active" : "global-skills-mode-button"}
              aria-pressed={viewMode === "edit"}
              type="button"
              onClick={() => setViewMode("edit")}
            >
              Edit
            </button>
            <button
              className={viewMode === "preview" ? "global-skills-mode-button is-active" : "global-skills-mode-button"}
              aria-pressed={viewMode === "preview"}
              type="button"
              onClick={() => setViewMode("preview")}
            >
              Preview
            </button>
          </div>
          {selectedFileReadOnly ? <span className="global-skills-readonly-badge">Read-only</span> : null}
          {!selectedFileReadOnly ? (
            <>
              <button className="secondary-button" disabled={!selectedSkillDirectoryName || deletingGlobalSkillDirectory !== null} type="button" onClick={() => void onDelete()}>
                {deletingGlobalSkillDirectory ? "Deleting..." : "Delete"}
              </button>
              <button className="primary-button" disabled={!isDirty || isSavingFile} type="button" onClick={() => void onSave()}>
                {isSavingFile ? "Saving..." : "Save"}
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className={editorShellClassName} onPointerDown={handleEditorShellPointerDown}>
        {isLoadingFile ? (
          <div className="global-skills-empty-state global-skills-editor-empty-state">
            <span className="label">Loading</span>
            <h3>Opening skill file</h3>
            <p>Reading the current file from the global skills directory.</p>
          </div>
        ) : viewMode === "edit" ? (
          <textarea
            ref={editorRef}
            aria-label={selectedFileReadOnly ? "Read-only skill viewer" : "Global skill editor"}
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
    </section>
  )
}

interface CreateSessionCanvasProps {
  isCreatingSession: boolean
  selectedWorkspaceID: string | null
  workspaces: WorkspaceGroup[]
  onOpenProjectFolder: () => void | Promise<void>
  onPromptExampleSelect: (text: string) => void
  onWorkspaceChange: (workspaceID: string) => void
}

export const CREATE_SESSION_PROMPT_EXAMPLES = [
  "Fix a bug in the selected area and run the relevant tests.",
  "Implement a focused feature, then verify it works.",
  "Review the recent changes and list risks before editing.",
  "Explain how this project is structured and where to start.",
] as const

function CreateSessionLogo() {
  return <span className="create-session-logo" role="img" aria-label="Anybox logo" />
}

function getWorkspaceLabel(workspace: WorkspaceGroup) {
  return `${workspace.project.name} / ${workspace.name}`
}

function getSelectedCreateSessionWorkspace(workspaces: WorkspaceGroup[], selectedWorkspaceID: string | null) {
  return workspaces.find((workspace) => workspace.id === selectedWorkspaceID) ?? null
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

function CreateSessionPromptExamples({ onPromptExampleSelect }: { onPromptExampleSelect: (text: string) => void }) {
  return (
    <div className="create-session-guide-examples" aria-label="Prompt examples">
      {CREATE_SESSION_PROMPT_EXAMPLES.map((example) => (
        <button
          key={example}
          type="button"
          className="create-session-guide-example"
          onClick={() => onPromptExampleSelect(example)}
        >
          {example}
        </button>
      ))}
    </div>
  )
}

function CreateSessionGuide({
  selectedWorkspace,
  workspaces,
  onOpenProjectFolder,
  onPromptExampleSelect,
}: {
  selectedWorkspace: WorkspaceGroup | null
  workspaces: WorkspaceGroup[]
  onOpenProjectFolder: () => void | Promise<void>
  onPromptExampleSelect: (text: string) => void
}) {
  if (workspaces.length === 0) {
    return (
      <div className="create-session-guide is-no-project">
        <div className="create-session-guide-copy">
          <p className="create-session-guide-kicker">No project selected</p>
          <h2>Open a project folder to start</h2>
          <p>
            Anybox needs a local project folder before this composer can create a real session, read files, or run
            tools in context.
          </p>
        </div>
        <button
          className="create-session-guide-primary"
          type="button"
          aria-label="Open project folder"
          onClick={() => void onOpenProjectFolder()}
        >
          <FolderIcon />
          <span>Open folder</span>
        </button>
        <p className="create-session-guide-note">After a project is open, send a concrete task from the composer below.</p>
      </div>
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
        <CreateSessionPromptExamples onPromptExampleSelect={onPromptExampleSelect} />
      </div>
    )
  }

  return (
    <div className="create-session-guide">
      <div className="create-session-guide-copy">
        <p className="create-session-guide-kicker">Project context</p>
        <h2>Start with a concrete task</h2>
        <p>
          This session will start in <strong>{getWorkspaceLabel(selectedWorkspace)}</strong>. Include the goal, relevant
          files or area, constraints, and how you want the result verified.
        </p>
      </div>
      <CreateSessionPromptExamples onPromptExampleSelect={onPromptExampleSelect} />
    </div>
  )
}

export function CreateSessionCanvas({
  isCreatingSession,
  selectedWorkspaceID,
  workspaces,
  onOpenProjectFolder,
  onPromptExampleSelect,
  onWorkspaceChange,
}: CreateSessionCanvasProps) {
  const selectedWorkspace = getSelectedCreateSessionWorkspace(workspaces, selectedWorkspaceID)

  return (
    <section className="thread-shell create-session-shell">
      <article className="create-session-card">
        <CreateSessionLogo />
        <CreateSessionWorkspaceSelect
          disabled={isCreatingSession || workspaces.length === 0}
          selectedWorkspaceID={selectedWorkspaceID}
          workspaces={workspaces}
          onWorkspaceChange={onWorkspaceChange}
        />
        <CreateSessionGuide
          selectedWorkspace={selectedWorkspace}
          workspaces={workspaces}
          onOpenProjectFolder={onOpenProjectFolder}
          onPromptExampleSelect={onPromptExampleSelect}
        />
      </article>
    </section>
  )
}
