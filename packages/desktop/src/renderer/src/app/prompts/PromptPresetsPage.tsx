import { type ChangeEvent, type FormEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  CloseIcon,
  DeleteIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  PlusIcon,
  SearchIcon,
} from "../icons"
import { SettingsSelect } from "../settings/SettingsSelect"
import { ShellTopMenu } from "../shared-ui"
import { ThreadMarkdown } from "../thread-markdown"
import { useI18n } from "../i18n/I18nProvider"
import type { TranslationKey } from "../i18n/translations"
import type {
  PromptPresetDocument,
  PromptPresetSelection,
  PromptPresetSummary,
  PromptTranslationLanguageID,
  PromptUrlInstallPreview,
  ProviderModel,
} from "../types"

type PromptEditorMode = "edit" | "preview"
type PromptPresetFolderID = PromptPresetSummary["source"]
type PromptTranslate = (key: TranslationKey, params?: Record<string, string | number>) => string

const PROMPT_TRANSLATION_LANGUAGES: Array<{
  value: PromptTranslationLanguageID
  labelKey: TranslationKey
}> = [
  { value: "en", labelKey: "prompts.language.english" },
  { value: "zh-Hans", labelKey: "prompts.language.simplifiedChinese" },
  { value: "zh-Hant", labelKey: "prompts.language.traditionalChinese" },
  { value: "es", labelKey: "prompts.language.spanish" },
  { value: "fr", labelKey: "prompts.language.french" },
  { value: "de", labelKey: "prompts.language.german" },
  { value: "pt", labelKey: "prompts.language.portuguese" },
  { value: "it", labelKey: "prompts.language.italian" },
  { value: "ja", labelKey: "prompts.language.japanese" },
  { value: "ko", labelKey: "prompts.language.korean" },
  { value: "nl", labelKey: "prompts.language.dutch" },
  { value: "ru", labelKey: "prompts.language.russian" },
]

const BUILTIN_PROMPT_LABEL_KEYS = {
  "System prompt": "prompts.builtin.systemPrompt",
  "Plan mode prompt": "prompts.builtin.planModePrompt",
  "Git commit message prompt": "prompts.builtin.gitCommitMessagePrompt",
  "Anthropic Provider Prompt": "prompts.builtin.anthropicProviderPrompt",
  "Beast Provider Prompt": "prompts.builtin.beastProviderPrompt",
  "Gemini Provider Prompt": "prompts.builtin.geminiProviderPrompt",
  "GPT Provider Prompt": "prompts.builtin.gptProviderPrompt",
  "Kimi Provider Prompt": "prompts.builtin.kimiProviderPrompt",
  "Codex Provider Prompt": "prompts.builtin.codexProviderPrompt",
  "Trinity Provider Prompt": "prompts.builtin.trinityProviderPrompt",
  "Anthropic Plan Reminder": "prompts.builtin.anthropicPlanReminder",
} as const satisfies Record<string, TranslationKey>

function getPromptTranslationModelValue(model: ProviderModel) {
  return `${model.providerID}/${model.id}`
}

function getPromptTranslationModelLabel(model: ProviderModel) {
  const providerLabel = model.providerName || model.providerID
  return `${model.name} · ${providerLabel}`
}

interface PromptEditorMessage {
  tone: "success" | "error"
  text: string
}

export interface PromptPresetCreateOptions {
  label?: string
  content?: string
  description?: string
  replaceAssignmentsFromPresetID?: string
}

interface PromptPresetsPageProps {
  deletingPromptPresetID: string | null
  isCreatingPromptPreset: boolean
  isInstallingPromptUrlPrompts: boolean
  isLoadingPromptPreset: boolean
  isLoadingPrompts: boolean
  isPreviewingPromptUrlInstall: boolean
  isPromptDirty: boolean
  isPromptUrlInstallDialogOpen: boolean
  isSavingPromptPresetSelection: boolean
  isTranslatingPromptPreset: boolean
  models: ProviderModel[]
  promptDraftContent: string
  promptDraftLabel: string
  promptLoadError: string | null
  promptPresets: PromptPresetSummary[]
  promptPresetSelection: PromptPresetSelection | null
  promptUrlInstallMessage: PromptEditorMessage | null
  promptUrlInstallPreview: PromptUrlInstallPreview | null
  promptUrlInstallSource: string
  resettingPromptPresetID: string | null
  savingPromptPresetID: string | null
  selectedPromptPreset: PromptPresetDocument | null
  selectedPromptUrlInstallIDs: string[]
  hideTopMenu?: boolean
  hideNavigator?: boolean
  windowControls?: ReactNode
  onCreatePromptPreset: (options?: PromptPresetCreateOptions) => boolean | Promise<boolean>
  onDeletePromptPreset: (presetID?: string) => boolean | Promise<boolean>
  onInstallPromptsFromUrl: () => boolean | Promise<boolean>
  onPromptDraftChange: (value: string) => void
  onPromptDraftLabelChange: (value: string) => void
  onPromptPresetSelect: (presetID: string) => boolean | Promise<boolean>
  onPromptPresetSelectionChange: (field: keyof PromptPresetSelection, value: string) => boolean | Promise<boolean>
  onPromptUrlInstallDialogClose: () => void
  onPromptUrlInstallPromptToggle: (promptID: string) => void
  onPromptUrlInstallSourceChange: (value: string) => void
  onPreviewPromptUrlInstall: () => boolean | Promise<boolean>
  onOpenPromptFile: (filePath: string) => boolean | Promise<boolean>
  onResetPromptPreset: () => boolean | Promise<boolean>
  onSavePromptPreset: () => boolean | Promise<boolean>
  onTranslatePromptPreset: (input: {
    languageID: PromptTranslationLanguageID
    model: string
  }) => boolean | Promise<boolean>
}

export interface PromptPresetsSidebarViewProps {
  deletingPromptPresetID: string | null
  isCreatingPromptPreset: boolean
  isPromptDirty: boolean
  promptPresets: PromptPresetSummary[]
  selectedPromptPreset: PromptPresetDocument | null
  onCreatePromptPreset: (options?: PromptPresetCreateOptions) => boolean | Promise<boolean>
  onDeletePromptPreset: (presetID?: string) => boolean | Promise<boolean>
  onOpenPromptFile: (filePath: string) => boolean | Promise<boolean>
  onPromptPresetSelect: (presetID: string) => boolean | Promise<boolean>
}

function getPromptPresetDisplayLabel(
  preset: Pick<PromptPresetSummary, "label" | "source">,
  t: PromptTranslate,
) {
  if (preset.source !== "bundled") return preset.label

  const labelKey = BUILTIN_PROMPT_LABEL_KEYS[preset.label as keyof typeof BUILTIN_PROMPT_LABEL_KEYS]
  return labelKey ? t(labelKey) : preset.label
}

function getPromptPresetSourceLabel(source: PromptPresetSummary["source"], t: PromptTranslate) {
  return source === "custom" ? t("prompts.source.custom") : t("prompts.source.bundled")
}

function getPromptPresetFolderLabel(source: PromptPresetSummary["source"], t: PromptTranslate) {
  return source === "custom" ? t("prompts.folder.custom") : t("prompts.folder.bundled")
}

function getPromptPresetPathLabel(preset: PromptPresetSummary, t: PromptTranslate) {
  return preset.filePath ?? preset.sourcePath ?? (
    preset.source === "custom" ? t("prompts.path.customPreset") : t("prompts.path.bundledPreset")
  )
}

function getPromptPresetUsageLabels(
  presetID: string,
  selection: PromptPresetSelection | null,
  t: PromptTranslate,
) {
  if (!selection) return []

  const labels: string[] = []
  if (selection.systemPromptPresetID === presetID) {
    labels.push(t("prompts.usage.system"))
  }
  if (selection.planModePromptPresetID === presetID) {
    labels.push(t("prompts.usage.plan"))
  }
  if (selection.gitCommitPromptPresetID === presetID) {
    labels.push(t("prompts.usage.gitCommit"))
  }
  return labels
}

function getPromptMarkdownPreviewText(value: string) {
  return value.replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function normalizePromptSearchTerm(value: string) {
  return value.trim().toLowerCase()
}

function resizePromptNameTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return
  textarea.style.height = "0px"
  textarea.style.height = `${textarea.scrollHeight}px`
}

function doesPromptPresetMatchSearch(
  preset: PromptPresetSummary,
  normalizedSearchTerm: string,
  t: PromptTranslate,
) {
  if (!normalizedSearchTerm) return true

  return [
    getPromptPresetDisplayLabel(preset, t),
    preset.label,
    preset.description,
    preset.id,
    preset.filePath ?? "",
    preset.sourcePath ?? "",
    preset.root ?? "",
    getPromptPresetSourceLabel(preset.source, t),
  ].some((value) => value.toLowerCase().includes(normalizedSearchTerm))
}

type PromptPresetContextMenuState = {
  displayLabel: string
  preset: PromptPresetSummary
  trigger: HTMLButtonElement
  x: number
  y: number
} | null

function clampPromptPresetContextMenuPosition(x: number, y: number, width: number, height: number) {
  const margin = 8
  if (typeof window === "undefined") return { x, y }

  return {
    x: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
    y: Math.max(margin, Math.min(y, window.innerHeight - height - margin)),
  }
}

interface PromptPresetContextMenuProps {
  deletingPromptPresetID: string | null
  menu: PromptPresetContextMenuState
  onClose: (restoreFocus?: boolean) => void
  onDelete: (presetID: string) => boolean | Promise<boolean>
  onOpen: (filePath: string) => boolean | Promise<boolean>
  t: PromptTranslate
}

function PromptPresetContextMenu({
  deletingPromptPresetID,
  menu,
  onClose,
  onDelete,
  onOpen,
  t,
}: PromptPresetContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ x: 0, y: 0 })

  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return
    const bounds = menuRef.current.getBoundingClientRect()
    setPosition(clampPromptPresetContextMenuPosition(menu.x, menu.y, bounds.width, bounds.height))
  }, [menu])

  useEffect(() => {
    if (!menu) return

    menuRef.current?.querySelector<HTMLButtonElement>(".ui-context-menu__item:not(:disabled)")?.focus()

    function handlePointerDown(event: globalThis.PointerEvent) {
      if (menuRef.current?.contains(event.target as Node | null)) return
      onClose()
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return
      event.preventDefault()
      onClose(true)
    }

    function handleViewportChange() {
      onClose()
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

  const filePath = menu.preset.filePath?.trim() ?? ""
  const isDeleting = deletingPromptPresetID === menu.preset.id

  return createPortal(
    <div
      ref={menuRef}
      className="ui-context-menu prompt-preset-context-menu"
      role="menu"
      aria-label={menu.displayLabel}
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Tab") {
          event.preventDefault()
          onClose(true)
          return
        }

        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
        const items = Array.from(
          menuRef.current?.querySelectorAll<HTMLButtonElement>(".ui-context-menu__item:not(:disabled)") ?? [],
        )
        if (items.length === 0) return

        event.preventDefault()
        const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
        const nextIndex = event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : event.key === "ArrowDown"
              ? (currentIndex + 1 + items.length) % items.length
              : (currentIndex - 1 + items.length) % items.length
        items[nextIndex]?.focus()
      }}
    >
      <button
        className="ui-context-menu__item"
        role="menuitem"
        type="button"
        disabled={!filePath}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
          if (filePath) void onOpen(filePath)
        }}
      >
        <span className="ui-context-menu__icon" aria-hidden="true"><FolderOpenIcon /></span>
        <span className="ui-context-menu__label">{t("prompts.openFolder")}</span>
      </button>
      {menu.preset.source === "custom" ? (
        <>
          <div className="ui-context-menu__divider" role="separator" />
          <button
            className="ui-context-menu__item"
            role="menuitem"
            type="button"
            data-variant="danger"
            disabled={deletingPromptPresetID !== null}
            onClick={(event) => {
              event.stopPropagation()
              onClose()
              void onDelete(menu.preset.id)
            }}
          >
            <span className="ui-context-menu__icon" aria-hidden="true"><DeleteIcon /></span>
            <span className="ui-context-menu__label">{isDeleting ? t("prompts.deleting") : t("app.delete")}</span>
          </button>
        </>
      ) : null}
    </div>,
    document.body,
  )
}

interface PromptUrlInstallDialogProps {
  installMessage: PromptEditorMessage | null
  installPreview: PromptUrlInstallPreview | null
  installSource: string
  isInstalling: boolean
  isPreviewing: boolean
  selectedPromptIDs: string[]
  onClose: () => void
  onInstall: () => boolean | Promise<boolean>
  onPreview: () => boolean | Promise<boolean>
  onSourceChange: (value: string) => void
  onTogglePrompt: (promptID: string) => void
}

function PromptUrlInstallDialog({
  installMessage,
  installPreview,
  installSource,
  isInstalling,
  isPreviewing,
  selectedPromptIDs,
  onClose,
  onInstall,
  onPreview,
  onSourceChange,
  onTogglePrompt,
}: PromptUrlInstallDialogProps) {
  const { t } = useI18n()
  const isBusy = isPreviewing || isInstalling
  const selectedCount = selectedPromptIDs.length

  function handlePreviewSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void onPreview()
  }

  return (
    <div className="global-skills-git-install-overlay">
      <section className="global-skills-git-install-modal" role="dialog" aria-modal="true" aria-label={t("prompts.install.dialogAria")}>
        <header className="global-skills-git-install-header">
          <div>
            <h3>{t("prompts.install.dialogTitle")}</h3>
            <p>{t("prompts.install.dialogCopy")}</p>
          </div>
          <button
            className="row-action global-skills-git-install-close"
            aria-label={t("prompts.install.closeAria")}
            disabled={isBusy}
            title={t("app.close")}
            type="button"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <form className="global-skills-git-install-form" onSubmit={handlePreviewSubmit}>
          <label className="global-skills-git-install-label" htmlFor="prompt-url-install-source">
            URL
          </label>
          <input
            id="prompt-url-install-source"
            className="global-skills-git-install-input"
            aria-label={t("prompts.install.sourceAria")}
            autoComplete="off"
            disabled={isBusy}
            placeholder={t("prompts.install.sourcePlaceholder")}
            type="text"
            value={installSource}
            onChange={(event) => onSourceChange(event.target.value)}
          />
          <div className="global-skills-git-install-help">
            <span>{t("prompts.install.supportedFormats")}</span>
            <code>github.com/user/repo</code>
            <code>https://github.com/user/repo/tree/main/prompts</code>
            <code>https://github.com/user/repo/blob/main/prompts/system.md</code>
            <code>https://example.com/prompts/system.md</code>
          </div>
          <div className="global-skills-git-install-actions">
            <button className="secondary-button" disabled={isBusy || !installSource.trim()} type="submit">
              {isPreviewing ? t("prompts.install.previewing") : t("prompts.install.preview")}
            </button>
          </div>
        </form>

        {installMessage ? (
          <p className={`global-skills-git-install-message is-${installMessage.tone}`} role={installMessage.tone === "error" ? "alert" : "status"}>
            {installMessage.text}
          </p>
        ) : null}

        {installPreview ? (
          <section className="global-skills-git-install-preview" aria-label={t("prompts.install.previewAria")}>
            <div className="global-skills-git-install-preview-meta">
              <span>{installPreview.source}</span>
            </div>
            <div className="global-skills-git-install-list">
              {installPreview.prompts.map((prompt) => {
                const checked = selectedPromptIDs.includes(prompt.id)
                return (
                  <label
                    key={prompt.id}
                    className={prompt.available ? "global-skills-git-install-skill" : "global-skills-git-install-skill is-disabled"}
                  >
                    <input
                      checked={checked}
                      disabled={!prompt.available || isBusy}
                      type="checkbox"
                      onChange={() => onTogglePrompt(prompt.id)}
                    />
                    <span className="global-skills-git-install-skill-body">
                      <strong>{prompt.label}</strong>
                      <span>{prompt.description}</span>
                      <code>{prompt.sourcePath}</code>
                      {prompt.reason ? <em>{prompt.reason}</em> : null}
                    </span>
                  </label>
                )
              })}
            </div>
          </section>
        ) : null}

        <footer className="global-skills-git-install-footer">
          <button className="secondary-button" disabled={isBusy} type="button" onClick={onClose}>
            {t("app.cancel")}
          </button>
          <button
            className="primary-button"
            disabled={!installPreview || selectedCount === 0 || isBusy}
            type="button"
            onClick={() => void onInstall()}
          >
            {isInstalling
              ? t("prompts.install.installing")
              : selectedCount > 0
                ? t("prompts.install.count", { count: selectedCount })
                : t("prompts.install.button")}
          </button>
        </footer>
      </section>
    </div>
  )
}

interface PromptTranslateDialogProps {
  languageID: PromptTranslationLanguageID
  model: string
  models: ProviderModel[]
  isTranslating: boolean
  onClose: () => void
  onLanguageChange: (value: PromptTranslationLanguageID) => void
  onModelChange: (value: string) => void
  onSubmit: () => boolean | Promise<boolean>
}

function PromptTranslateDialog({
  languageID,
  model,
  models,
  isTranslating,
  onClose,
  onLanguageChange,
  onModelChange,
  onSubmit,
}: PromptTranslateDialogProps) {
  const { t } = useI18n()
  const languageOptions = PROMPT_TRANSLATION_LANGUAGES.map((item) => ({
    value: item.value,
    label: t(item.labelKey),
  }))
  const availableModelOptions = models
    .filter((item) => item.available && item.capabilities.input.text && item.capabilities.output.text)
    .map((item) => ({
      value: getPromptTranslationModelValue(item),
      label: getPromptTranslationModelLabel(item),
    }))
  const modelOptions = availableModelOptions.length > 0
    ? [
        { value: "", label: t("prompts.translate.selectModel"), disabled: true },
        ...availableModelOptions,
      ]
    : [{ value: "", label: t("prompts.translate.noTextModels"), disabled: true }]
  const canSubmit = Boolean(model.trim()) && !isTranslating

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return
    void onSubmit()
  }

  return (
    <div className="global-skills-git-install-overlay">
      <section className="global-skills-git-install-modal prompt-translate-modal" role="dialog" aria-modal="true" aria-label={t("prompts.translate.dialogAria")}>
        <header className="global-skills-git-install-header">
          <div>
            <h3>{t("prompts.translate.dialogTitle")}</h3>
          </div>
          <button
            className="row-action global-skills-git-install-close"
            aria-label={t("prompts.translate.closeAria")}
            disabled={isTranslating}
            title={t("app.close")}
            type="button"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <form className="global-skills-git-install-form prompt-translate-form" onSubmit={handleSubmit}>
          <label className="global-skills-git-install-label">
            {t("prompts.translate.language")}
          </label>
          <SettingsSelect<PromptTranslationLanguageID>
            ariaLabel={t("prompts.translate.languageAria")}
            className="prompt-translate-select"
            disabled={isTranslating}
            options={languageOptions}
            value={languageID}
            onChange={onLanguageChange}
          />

          <label className="global-skills-git-install-label">
            {t("prompts.translate.model")}
          </label>
          <SettingsSelect
            ariaLabel={t("prompts.translate.modelAria")}
            className="prompt-translate-select"
            disabled={isTranslating || availableModelOptions.length === 0}
            options={modelOptions}
            value={model}
            onChange={onModelChange}
          />

        </form>

        <footer className="global-skills-git-install-footer">
          <button className="secondary-button" disabled={isTranslating} type="button" onClick={onClose}>
            {t("app.cancel")}
          </button>
          <button className="primary-button" disabled={!canSubmit} type="button" onClick={() => void onSubmit()}>
            {isTranslating ? t("prompts.translate.translating") : t("prompts.translate.button")}
          </button>
        </footer>
      </section>
    </div>
  )
}

export function PromptPresetsSidebarView({
  deletingPromptPresetID,
  isCreatingPromptPreset,
  isPromptDirty,
  promptPresets,
  selectedPromptPreset,
  onCreatePromptPreset,
  onDeletePromptPreset,
  onOpenPromptFile,
  onPromptPresetSelect,
}: PromptPresetsSidebarViewProps) {
  const { t } = useI18n()
  const [promptSearchTerm, setPromptSearchTerm] = useState("")
  const [promptPresetContextMenu, setPromptPresetContextMenu] = useState<PromptPresetContextMenuState>(null)
  const [expandedPromptPresetFolders, setExpandedPromptPresetFolders] = useState<PromptPresetFolderID[]>([
    "bundled",
    "custom",
  ])
  const promptPresetOptions = [...promptPresets].sort((left, right) => {
    if (left.source !== right.source) {
      return left.source === "bundled" ? -1 : 1
    }

    return left.label.localeCompare(right.label)
  })
  const normalizedPromptSearchTerm = normalizePromptSearchTerm(promptSearchTerm)
  const promptPresetFolderDefinitions: Array<{
    id: PromptPresetFolderID
    label: string
    presets: PromptPresetSummary[]
  }> = [
    {
      id: "bundled",
      label: getPromptPresetFolderLabel("bundled", t),
      presets: promptPresetOptions.filter((preset) => preset.source === "bundled"),
    },
    {
      id: "custom",
      label: getPromptPresetFolderLabel("custom", t),
      presets: promptPresetOptions.filter((preset) => preset.source === "custom"),
    },
  ]
  const promptPresetFolders = promptPresetFolderDefinitions.map((folder) => ({
    ...folder,
    presets: folder.presets.filter((preset) =>
      doesPromptPresetMatchSearch(preset, normalizedPromptSearchTerm, t),
    ),
  }))
  const visiblePromptPresetFolders = promptPresetFolders.filter((folder) =>
    normalizedPromptSearchTerm ? folder.presets.length > 0 : true,
  )
  const isPromptSearchActive = normalizedPromptSearchTerm.length > 0

  function closePromptPresetContextMenu(restoreFocus = false) {
    const trigger = promptPresetContextMenu?.trigger
    setPromptPresetContextMenu(null)
    if (restoreFocus) trigger?.focus()
  }

  function openPromptPresetContextMenu(
    preset: PromptPresetSummary,
    displayLabel: string,
    trigger: HTMLButtonElement,
    x: number,
    y: number,
  ) {
    setPromptPresetContextMenu({ displayLabel, preset, trigger, x, y })
  }

  function handlePromptPresetSelection(presetID: string) {
    if (presetID === selectedPromptPreset?.id) return
    if (
      isPromptDirty &&
      typeof window.confirm === "function" &&
      !window.confirm(t("prompts.confirm.discardSwitch"))
    ) {
      return
    }

    void onPromptPresetSelect(presetID)
  }

  function handlePromptPresetCreate() {
    if (
      isPromptDirty &&
      typeof window.confirm === "function" &&
      !window.confirm(t("prompts.confirm.discardCreate"))
    ) {
      return
    }

    void onCreatePromptPreset()
  }

  function handlePromptFolderToggle(folderID: PromptPresetFolderID) {
    if (isPromptSearchActive) return
    setExpandedPromptPresetFolders((current) =>
      current.includes(folderID)
        ? current.filter((item) => item !== folderID)
        : [...current, folderID],
    )
  }

  return (
    <section className="sidebar-view sidebar-view-prompts" aria-label={t("prompts.sidebarAria")}>
      <div className="skills-tree-search-row prompt-presets-search-row" aria-label={t("prompts.searchAria")} role="search">
        <SearchIcon />
        <input
          aria-label={t("prompts.searchInputAria")}
          placeholder={t("prompts.searchPlaceholder")}
          type="search"
          value={promptSearchTerm}
          onChange={(event) => setPromptSearchTerm(event.target.value)}
        />
        {promptSearchTerm.trim() ? (
          <button
            aria-label={t("prompts.clearSearchAria")}
            title={t("prompts.clearSearchTitle")}
            type="button"
            onClick={() => setPromptSearchTerm("")}
          >
            <CloseIcon />
          </button>
        ) : null}
      </div>

      <div className="skills-tree-root prompt-presets-tree" role="list" aria-label={t("prompts.listAria")}>
        {visiblePromptPresetFolders.length > 0 ? (
          visiblePromptPresetFolders.map((folder) => {
            const isExpanded = isPromptSearchActive || expandedPromptPresetFolders.includes(folder.id)

            return (
              <div key={folder.id} className="skill-tree-item prompt-tree-folder">
                <div className="skill-tree-row-shell">
                  <button
                    className="skill-tree-row"
                    aria-expanded={isExpanded}
                    aria-label={t("prompts.folderAria", { folder: folder.label })}
                    type="button"
                    onClick={() => handlePromptFolderToggle(folder.id)}
                  >
                    <span className="skill-tree-role-icon is-folder" aria-hidden="true">
                      {isExpanded ? <FolderOpenIcon /> : <FolderIcon />}
                    </span>
                    <span className="skill-tree-label">{folder.label}</span>
                    <span className="prompt-tree-count">{folder.presets.length}</span>
                  </button>
                </div>

                {isExpanded ? (
                  <div className="skill-tree-children">
                    {folder.presets.length > 0 ? (
                      folder.presets.map((preset) => {
                        const isActive = preset.id === selectedPromptPreset?.id
                        const displayLabel = getPromptPresetDisplayLabel(preset, t)
                        const isDeleting = deletingPromptPresetID === preset.id

                        return (
                          <div key={preset.id} className="skill-tree-item skill-tree-item-file prompt-tree-file">
                            <div
                              className="skill-tree-row-shell"
                              onContextMenu={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                const trigger = event.currentTarget.querySelector<HTMLButtonElement>(".skill-tree-row")
                                if (!trigger) return
                                openPromptPresetContextMenu(preset, displayLabel, trigger, event.clientX, event.clientY)
                              }}
                            >
                              <button
                                className={isActive ? "skill-tree-row is-active" : "skill-tree-row"}
                                aria-label={displayLabel}
                                aria-pressed={isActive}
                                title={getPromptPresetPathLabel(preset, t)}
                                type="button"
                                onClick={() => handlePromptPresetSelection(preset.id)}
                                onKeyDown={(event) => {
                                  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return
                                  event.preventDefault()
                                  const bounds = event.currentTarget.getBoundingClientRect()
                                  openPromptPresetContextMenu(
                                    preset,
                                    displayLabel,
                                    event.currentTarget,
                                    bounds.left + 12,
                                    bounds.top + 12,
                                  )
                                }}
                              >
                                <span className="skill-tree-label">{displayLabel}</span>
                              </button>
                              {preset.source === "custom" ? (
                                <button
                                  className="row-action skill-tree-row-action prompt-tree-delete-button"
                                  aria-label={t("prompts.deletePromptAria", { label: displayLabel })}
                                  disabled={deletingPromptPresetID !== null}
                                  title={isDeleting
                                    ? t("prompts.deletingPromptTitle", { label: displayLabel })
                                    : t("prompts.deletePromptTitle", { label: displayLabel })}
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    void onDeletePromptPreset(preset.id)
                                  }}
                                >
                                  <DeleteIcon />
                                </button>
                              ) : null}
                            </div>
                          </div>
                        )
                      })
                    ) : (
                      <p className="skills-tree-empty prompt-tree-empty">
                        {folder.id === "custom" ? t("prompts.emptyCustom") : t("prompts.emptyBundled")}
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            )
          })
        ) : promptPresetOptions.length > 0 ? (
          <p className="skills-tree-empty">{t("prompts.noSearchResults")}</p>
        ) : (
          <p className="skills-tree-empty">{t("prompts.noFiles")}</p>
        )}

        <div className="global-skills-new-menu-shell prompt-presets-new-menu-shell">
          <button
            className="global-skills-new-button prompt-presets-new-button"
            type="button"
            aria-label={t("app.new")}
            disabled={isCreatingPromptPreset}
            title={isCreatingPromptPreset ? t("prompts.creating") : t("prompts.newPrompt")}
            onClick={handlePromptPresetCreate}
          >
            <PlusIcon />
          </button>
        </div>
      </div>
      <PromptPresetContextMenu
        deletingPromptPresetID={deletingPromptPresetID}
        menu={promptPresetContextMenu}
        t={t}
        onClose={closePromptPresetContextMenu}
        onDelete={onDeletePromptPreset}
        onOpen={onOpenPromptFile}
      />
    </section>
  )
}

export function PromptPresetsPage({
  deletingPromptPresetID,
  isCreatingPromptPreset,
  isInstallingPromptUrlPrompts,
  isLoadingPromptPreset,
  isLoadingPrompts,
  isPreviewingPromptUrlInstall,
  isPromptDirty,
  isPromptUrlInstallDialogOpen,
  isSavingPromptPresetSelection,
  isTranslatingPromptPreset,
  models,
  promptDraftContent,
  promptDraftLabel,
  promptLoadError,
  promptPresets,
  promptPresetSelection,
  promptUrlInstallMessage,
  promptUrlInstallPreview,
  promptUrlInstallSource,
  resettingPromptPresetID,
  savingPromptPresetID,
  selectedPromptPreset,
  selectedPromptUrlInstallIDs,
  hideTopMenu = false,
  hideNavigator = false,
  windowControls,
  onCreatePromptPreset,
  onDeletePromptPreset,
  onInstallPromptsFromUrl,
  onPromptDraftChange,
  onPromptDraftLabelChange,
  onPromptPresetSelect,
  onPromptPresetSelectionChange,
  onPromptUrlInstallDialogClose,
  onPromptUrlInstallPromptToggle,
  onPromptUrlInstallSourceChange,
  onPreviewPromptUrlInstall,
  onOpenPromptFile,
  onResetPromptPreset,
  onSavePromptPreset,
  onTranslatePromptPreset,
}: PromptPresetsPageProps) {
  const { t } = useI18n()
  const [promptEditorMode, setPromptEditorMode] = useState<PromptEditorMode>("edit")
  const [isPromptTranslateDialogOpen, setIsPromptTranslateDialogOpen] = useState(false)
  const [promptTranslationLanguageID, setPromptTranslationLanguageID] =
    useState<PromptTranslationLanguageID>("zh-Hans")
  const [promptTranslationModel, setPromptTranslationModel] = useState("")
  const promptNameTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const promptPresetOptions = [...promptPresets].sort((left, right) => {
    if (left.source !== right.source) {
      return left.source === "bundled" ? -1 : 1
    }

    return left.label.localeCompare(right.label)
  })
  const selectedPromptPresetBusy =
    selectedPromptPreset !== null &&
    (
      savingPromptPresetID === selectedPromptPreset.id ||
      resettingPromptPresetID === selectedPromptPreset.id ||
      deletingPromptPresetID === selectedPromptPreset.id
    )
  const selectedPromptPresetUsageLabels = selectedPromptPreset
    ? getPromptPresetUsageLabels(selectedPromptPreset.id, promptPresetSelection, t)
    : []
  const selectedPromptPresetDisplayLabel = selectedPromptPreset
    ? getPromptPresetDisplayLabel(selectedPromptPreset, t)
    : ""
  const selectedPromptPresetIsBundled = selectedPromptPreset?.source === "bundled"
  const promptPresetSelectOptions = promptPresetOptions.map((preset) => ({
    value: preset.id,
    label: getPromptPresetDisplayLabel(preset, t),
  }))
  const isPromptTranslateDisabled =
    !selectedPromptPreset ||
    isLoadingPromptPreset ||
    isTranslatingPromptPreset ||
    !promptDraftContent.trim()

  useLayoutEffect(() => {
    resizePromptNameTextarea(promptNameTextareaRef.current)
  }, [promptDraftLabel, selectedPromptPreset?.id])

  useLayoutEffect(() => {
    const textarea = promptNameTextareaRef.current
    const resizeTarget = textarea?.parentElement
    if (!textarea || !resizeTarget || typeof ResizeObserver === "undefined") return

    const resizeObserver = new ResizeObserver(() => {
      resizePromptNameTextarea(textarea)
    })
    resizeObserver.observe(resizeTarget)
    return () => resizeObserver.disconnect()
  }, [selectedPromptPreset?.id])

  function openPromptTranslateDialog() {
    if (isPromptTranslateDisabled) return
    setPromptTranslationLanguageID("zh-Hans")
    setPromptTranslationModel("")
    setIsPromptTranslateDialogOpen(true)
  }

  function closePromptTranslateDialog() {
    if (isTranslatingPromptPreset) return
    setIsPromptTranslateDialogOpen(false)
  }

  async function submitPromptTranslation() {
    const translated = await onTranslatePromptPreset({
      languageID: promptTranslationLanguageID,
      model: promptTranslationModel,
    })
    if (translated) {
      setIsPromptTranslateDialogOpen(false)
    }
    return translated
  }

  function handlePromptDraftLabelChange(event: ChangeEvent<HTMLTextAreaElement>) {
    onPromptDraftLabelChange(event.target.value.replace(/[\r\n]+/g, " "))
    resizePromptNameTextarea(event.target)
  }

  async function createCustomPromptCopy() {
    if (!selectedPromptPreset || !selectedPromptPresetIsBundled) return false

    const created = await onCreatePromptPreset({
      label: `${selectedPromptPresetDisplayLabel} (${t("prompts.source.custom")})`,
      content: promptDraftContent,
      description: selectedPromptPreset.description,
      replaceAssignmentsFromPresetID: selectedPromptPreset.id,
    })
    if (created) {
      setPromptEditorMode("edit")
    }
    return created
  }

  return (
    <section className={hideTopMenu ? "prompt-presets-page is-embedded" : "prompt-presets-page"} aria-label={t("prompts.pageAria")}>
      {hideTopMenu ? null : (
        <ShellTopMenu
          as="header"
          ariaLabel={t("prompts.topMenuAria")}
          className="canvas-region-top-menu prompt-presets-top-menu"
          contentClassName="canvas-region-top-menu-tabs-shell"
          content={(
            <div className="prompt-presets-top-menu-label">
              <FileTextIcon />
              <span>{t("prompts.title")}</span>
            </div>
          )}
          dragRegion
          layout="three-column"
          trailing={windowControls}
          trailingClassName="prompt-presets-top-menu-window-controls"
        />
      )}

      <div className="settings-page-main is-services prompt-presets-page-main">
        {promptLoadError ? (
          <div className="settings-banner is-error">{promptLoadError}</div>
        ) : null}

        {isLoadingPrompts ? (
          <article className="settings-empty-state">
            <span className="label">{t("app.loading")}</span>
            <h3>{t("prompts.loadingTitle")}</h3>
            <p>{t("prompts.loadingCopy")}</p>
          </article>
        ) : (
          <section className={hideNavigator ? "settings-prompts-shell is-sidebar-hosted" : "settings-prompts-shell"} aria-label={t("prompts.layoutAria")}>
            <section className="settings-panel settings-prompt-slots-panel">
              <div className="settings-prompt-assignment-list" role="list" aria-label={t("prompts.slotsTitle")}>
                <div className="settings-prompt-assignment-row" role="listitem">
                  <div className="settings-prompt-assignment-copy">
                    <span className="settings-prompt-assignment-title">{t("prompts.slot.system")}</span>
                  </div>

                  <div className="settings-prompt-assignment-control">
                    <div className="settings-prompt-assignment-actions">
                      <SettingsSelect
                        ariaLabel={t("prompts.slot.systemSelectAria")}
                        className="settings-prompt-assignment-select"
                        options={promptPresetSelectOptions}
                        value={promptPresetSelection?.systemPromptPresetID ?? ""}
                        disabled={!promptPresetSelection || isSavingPromptPresetSelection}
                        onChange={(value) =>
                          void onPromptPresetSelectionChange("systemPromptPresetID", value)
                        }
                      />
                    </div>
                  </div>
                </div>

                <div className="settings-prompt-assignment-row" role="listitem">
                  <div className="settings-prompt-assignment-copy">
                    <span className="settings-prompt-assignment-title">{t("prompts.slot.planMode")}</span>
                  </div>

                  <div className="settings-prompt-assignment-control">
                    <div className="settings-prompt-assignment-actions">
                      <SettingsSelect
                        ariaLabel={t("prompts.slot.planModeSelectAria")}
                        className="settings-prompt-assignment-select"
                        options={promptPresetSelectOptions}
                        value={promptPresetSelection?.planModePromptPresetID ?? ""}
                        disabled={!promptPresetSelection || isSavingPromptPresetSelection}
                        onChange={(value) =>
                          void onPromptPresetSelectionChange("planModePromptPresetID", value)
                        }
                      />
                    </div>
                  </div>
                </div>

                <div className="settings-prompt-assignment-row" role="listitem">
                  <div className="settings-prompt-assignment-copy">
                    <span className="settings-prompt-assignment-title">{t("prompts.slot.gitCommit")}</span>
                  </div>

                  <div className="settings-prompt-assignment-control">
                    <div className="settings-prompt-assignment-actions">
                      <SettingsSelect
                        ariaLabel={t("prompts.slot.gitCommitSelectAria")}
                        className="settings-prompt-assignment-select"
                        options={promptPresetSelectOptions}
                        value={promptPresetSelection?.gitCommitPromptPresetID ?? ""}
                        disabled={!promptPresetSelection || isSavingPromptPresetSelection}
                        onChange={(value) =>
                          void onPromptPresetSelectionChange("gitCommitPromptPresetID", value)
                        }
                      />
                    </div>
                  </div>
                </div>

              </div>
            </section>

            <div className={hideNavigator ? "settings-services-layout settings-prompts-layout is-sidebar-hosted" : "settings-services-layout settings-prompts-layout"}>
              {!hideNavigator ? (
                <div className="settings-service-list-panel settings-prompt-library-panel">
                  <PromptPresetsSidebarView
                    deletingPromptPresetID={deletingPromptPresetID}
                    isCreatingPromptPreset={isCreatingPromptPreset}
                    isPromptDirty={isPromptDirty}
                    promptPresets={promptPresets}
                    selectedPromptPreset={selectedPromptPreset}
                    onCreatePromptPreset={onCreatePromptPreset}
                    onDeletePromptPreset={onDeletePromptPreset}
                    onOpenPromptFile={onOpenPromptFile}
                    onPromptPresetSelect={onPromptPresetSelect}
                  />
                </div>
              ) : null}

              <div className="settings-service-detail-panel settings-prompt-detail-panel">
                {selectedPromptPreset ? (
                  <section className="settings-panel settings-prompt-editor-panel">
                    <div className="settings-prompt-editor-header">
                      <div className="settings-prompt-editor-meta">
                        {selectedPromptPreset.source === "custom" ? (
                          <textarea
                            ref={promptNameTextareaRef}
                            className="settings-prompt-name-input"
                            aria-label={t("prompts.presetNameAria")}
                            value={promptDraftLabel}
                            rows={1}
                            readOnly={isLoadingPromptPreset}
                            onChange={handlePromptDraftLabelChange}
                          />
                        ) : (
                          <h3>{selectedPromptPresetDisplayLabel}</h3>
                        )}

                        <div className="settings-prompt-item-statuses">
                          <span className="settings-badge">{getPromptPresetSourceLabel(selectedPromptPreset.source, t)}</span>
                          {selectedPromptPresetUsageLabels.map((label) => (
                            <span key={`${selectedPromptPreset.id}-${label}`} className="settings-badge is-highlight">
                              {label}
                            </span>
                          ))}
                          {selectedPromptPreset.hasOverride ? (
                            <span className="settings-badge is-warning">{t("prompts.status.edited")}</span>
                          ) : null}
                          {isLoadingPromptPreset ? <span className="settings-badge">{t("app.loading")}</span> : null}
                        </div>
                      </div>

                      <div className="settings-prompt-editor-toolbar">
                        <div className="settings-prompt-editor-mode-switch" aria-label={t("prompts.editorModeAria")}>
                          <button
                            className={
                              promptEditorMode === "edit"
                                ? "settings-prompt-editor-mode-button is-active"
                                : "settings-prompt-editor-mode-button"
                            }
                            type="button"
                            aria-pressed={promptEditorMode === "edit"}
                            onClick={() => setPromptEditorMode("edit")}
                          >
                            {t("prompts.edit")}
                          </button>
                          <button
                            className={
                              promptEditorMode === "preview"
                                ? "settings-prompt-editor-mode-button is-active"
                                : "settings-prompt-editor-mode-button"
                            }
                            type="button"
                            aria-pressed={promptEditorMode === "preview"}
                            onClick={() => setPromptEditorMode("preview")}
                          >
                            {t("prompts.preview")}
                          </button>
                        </div>

                        <div className="settings-inline-actions">
                          <button
                            className="secondary-button"
                            type="button"
                            disabled={isPromptTranslateDisabled || selectedPromptPresetBusy}
                            onClick={openPromptTranslateDialog}
                          >
                            {isTranslatingPromptPreset ? t("prompts.translate.translating") : t("prompts.translate.button")}
                          </button>
                          {selectedPromptPreset.source === "custom" ? (
                            <button
                              className="secondary-button is-danger"
                              type="button"
                              disabled={selectedPromptPresetBusy || isLoadingPromptPreset}
                              onClick={() => void onDeletePromptPreset()}
                            >
                              {deletingPromptPresetID === selectedPromptPreset.id ? t("prompts.deleting") : t("app.delete")}
                            </button>
                          ) : selectedPromptPreset.hasOverride ? (
                            <button
                              className="secondary-button"
                              type="button"
                              disabled={selectedPromptPresetBusy || isLoadingPromptPreset}
                              onClick={() => void onResetPromptPreset()}
                            >
                              {resettingPromptPresetID === selectedPromptPreset.id ? t("app.resetting") : t("app.reset")}
                            </button>
                          ) : null}
                          {selectedPromptPreset.source === "custom" ? (
                            <button
                              className="primary-button"
                              type="button"
                              disabled={!isPromptDirty || selectedPromptPresetBusy || isLoadingPromptPreset}
                              onClick={() => void onSavePromptPreset()}
                            >
                              {savingPromptPresetID === selectedPromptPreset.id ? t("app.saving") : t("app.save")}
                            </button>
                          ) : (
                            <button
                              className="primary-button"
                              type="button"
                              disabled={isCreatingPromptPreset || selectedPromptPresetBusy || isLoadingPromptPreset}
                              onClick={() => void createCustomPromptCopy()}
                            >
                              {isCreatingPromptPreset ? t("prompts.creating") : t("prompts.createCustomCopy")}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="settings-field settings-prompt-editor-field">
                      {promptEditorMode === "edit" ? (
                        <textarea
                          className="settings-prompt-editor"
                          aria-label={t("prompts.contentAria", { label: selectedPromptPresetDisplayLabel })}
                          value={promptDraftContent}
                          readOnly={selectedPromptPresetIsBundled || !selectedPromptPreset.editable || isLoadingPromptPreset}
                          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onPromptDraftChange(event.target.value)}
                        />
                      ) : (
                        <div
                          className="settings-prompt-preview-surface"
                          role="region"
                          aria-label={t("prompts.previewAria", { label: selectedPromptPresetDisplayLabel })}
                        >
                          {promptDraftContent.trim() ? (
                            <ThreadMarkdown
                              className="thread-markdown settings-prompt-markdown-preview"
                              text={getPromptMarkdownPreviewText(promptDraftContent)}
                            />
                          ) : (
                            <p className="settings-prompt-preview-empty">{t("prompts.noContent")}</p>
                          )}
                        </div>
                      )}
                    </div>

                    {selectedPromptPresetIsBundled ? (
                      <p className="settings-helper-text settings-prompt-read-only-note">
                        {t("prompts.bundledReadOnly")}
                      </p>
                    ) : null}

                    {selectedPromptPreset.sourcePath ? (
                      <p className="settings-helper-text settings-prompt-source-path">
                        <code>{selectedPromptPreset.sourcePath}</code>
                      </p>
                    ) : null}
                  </section>
                ) : (
                  <article className="settings-empty-state settings-detail-empty-state">
                    <h3>{t("prompts.selectPreset")}</h3>
                  </article>
                )}
              </div>
            </div>
          </section>
        )}
      </div>

      {isPromptTranslateDialogOpen ? (
        <PromptTranslateDialog
          languageID={promptTranslationLanguageID}
          model={promptTranslationModel}
          models={models}
          isTranslating={isTranslatingPromptPreset}
          onClose={closePromptTranslateDialog}
          onLanguageChange={setPromptTranslationLanguageID}
          onModelChange={setPromptTranslationModel}
          onSubmit={submitPromptTranslation}
        />
      ) : null}

      {isPromptUrlInstallDialogOpen ? (
        <PromptUrlInstallDialog
          installMessage={promptUrlInstallMessage}
          installPreview={promptUrlInstallPreview}
          installSource={promptUrlInstallSource}
          isInstalling={isInstallingPromptUrlPrompts}
          isPreviewing={isPreviewingPromptUrlInstall}
          selectedPromptIDs={selectedPromptUrlInstallIDs}
          onClose={onPromptUrlInstallDialogClose}
          onInstall={onInstallPromptsFromUrl}
          onPreview={onPreviewPromptUrlInstall}
          onSourceChange={onPromptUrlInstallSourceChange}
          onTogglePrompt={onPromptUrlInstallPromptToggle}
        />
      ) : null}
    </section>
  )
}
