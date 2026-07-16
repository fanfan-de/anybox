import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react"
import type { RegistryFile } from "@anybox/shared"
import type {
  DesktopRegistrySkillForkResult,
  DesktopRegistrySkillUpdatePreview,
} from "../../../../shared/desktop-ipc-contract"
import { useI18n } from "../i18n/I18nProvider"
import { ChevronDownIcon, CloseIcon, SearchIcon } from "../icons"
import { joinClassNames } from "../shared-ui"
import {
  DownloadedSkillDetail,
  SkillProductIcon,
  SkillMarketplaceView,
  type SkillCatalogDetailTab,
} from "./SkillCatalogViews"
import {
  GlobalSkillsNavigator,
  type GlobalSkillsNavigatorProps,
  type SkillLibrarySourceFilter,
  type SkillLibraryStatusFilter,
} from "./GlobalSkillsPage"
import { SkillMarketplaceDialog } from "./SkillMarketplaceDialog"
import { useSkillCatalog } from "./use-skill-catalog"

export type SkillLibraryMode = SkillLibrarySourceFilter

const UPDATE_DIALOG_FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",")

interface SkillsWorkspacePageProps {
  children: ReactNode
  isMarketplaceOpen: boolean
  localNavigatorProps?: GlobalSkillsNavigatorProps
  mode: SkillLibraryMode
  onMarketplaceClose: () => void
  onMarketplaceOpen: () => void
  onModeChange: (mode: SkillLibraryMode) => boolean
  onBeforeForkToLocal?: () => boolean
  onBeforeSelectDownloaded?: () => boolean
  onForkedToLocal?: (result: DesktopRegistrySkillForkResult) => void | Promise<void>
}

export function SkillsWorkspacePage({
  children,
  isMarketplaceOpen,
  localNavigatorProps,
  mode,
  onMarketplaceClose,
  onMarketplaceOpen,
  onModeChange,
  onBeforeForkToLocal,
  onBeforeSelectDownloaded,
  onForkedToLocal,
}: SkillsWorkspacePageProps) {
  const { t } = useI18n()
  const catalog = useSkillCatalog({
    catalogEnabled: isMarketplaceOpen,
    downloadsEnabled: true,
  })
  const [detailTab, setDetailTab] = useState<SkillCatalogDetailTab>("readme")
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState<SkillLibraryStatusFilter>("all")
  const [selectedSkillSource, setSelectedSkillSource] = useState<"local" | "downloaded">("local")
  const [selectedDownloadedID, setSelectedDownloadedID] = useState<string | null>(null)
  const [downloadedFiles, setDownloadedFiles] = useState<RegistryFile[]>([])
  const [selectedDownloadedFilePath, setSelectedDownloadedFilePath] = useState<string | null>(null)
  const [downloadedFileContent, setDownloadedFileContent] = useState<string | null>(null)
  const [isLoadingDownloadedFile, setIsLoadingDownloadedFile] = useState(false)
  const [pendingDownloadedID, setPendingDownloadedID] = useState<string | null>(null)
  const [downloadedStatus, setDownloadedStatus] = useState<string | null>(null)
  const [updatePreview, setUpdatePreview] = useState<DesktopRegistrySkillUpdatePreview | null>(null)
  const [isAddSkillMenuOpen, setIsAddSkillMenuOpen] = useState(false)
  const tabsID = useId()
  const modeTabRefs = useRef<Partial<Record<SkillLibraryMode, HTMLButtonElement | null>>>({})
  const addSkillMenuRef = useRef<HTMLDivElement | null>(null)
  const addSkillTriggerRef = useRef<HTMLButtonElement | null>(null)
  const pendingModeFocusRef = useRef<SkillLibraryMode | null>(null)
  const downloadedFileRevisionRef = useRef(0)
  const updateReturnFocusRef = useRef<HTMLElement | null>(null)
  const updateDialogRef = useRef<HTMLElement | null>(null)
  const updateDialogInitialFocusRef = useRef<HTMLButtonElement | null>(null)

  const visibleDownloadedSkills = useMemo(() => catalog.downloadedSkills.filter((skill) => {
    if (mode !== "all" && mode !== "downloaded") return false
    if (statusFilter !== "all" && skill.enabled !== (statusFilter === "enabled")) return false
    const query = searchTerm.trim().toLowerCase()
    if (!query) return true
    return [skill.displayName, skill.slug, skill.description, skill.author.displayName, skill.author.handle]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(query))
  }), [catalog.downloadedSkills, mode, searchTerm, statusFilter])
  const selectedDownloadedSkill = visibleDownloadedSkills.find((item) => item.id === selectedDownloadedID)
    ?? visibleDownloadedSkills[0]
    ?? null
  const selectedDownloadedVersion = selectedDownloadedSkill?.activeVersion
  const isLocalAddActionDisabled = Boolean(localNavigatorProps && (
    localNavigatorProps.isCreatingGlobalSkill ||
    localNavigatorProps.isCreateGlobalSkillDraftVisible ||
    localNavigatorProps.isInstallingLocalSkill ||
    localNavigatorProps.renamingGlobalSkillDraftDirectory ||
    localNavigatorProps.renamingGlobalSkillDirectory
  ))

  useEffect(() => {
    if (!isAddSkillMenuOpen) return

    function handlePointerDown(event: globalThis.PointerEvent) {
      if (addSkillMenuRef.current?.contains(event.target as Node | null)) return
      setIsAddSkillMenuOpen(false)
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return
      setIsAddSkillMenuOpen(false)
      addSkillTriggerRef.current?.focus()
    }

    window.addEventListener("pointerdown", handlePointerDown)
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown)
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [isAddSkillMenuOpen])

  useEffect(() => {
    if (isMarketplaceOpen) setIsAddSkillMenuOpen(false)
  }, [isMarketplaceOpen])

  function handleMarketplaceOpen() {
    addSkillTriggerRef.current?.focus()
    setIsAddSkillMenuOpen(false)
    onMarketplaceOpen()
  }

  function handleInstallFromUrl() {
    setIsAddSkillMenuOpen(false)
    localNavigatorProps?.onGitInstallDialogOpen()
  }

  function handleInstallFromLocalFile() {
    setIsAddSkillMenuOpen(false)
    localNavigatorProps?.onLocalInstallDialogOpen()
  }

  function restoreFocus(target: HTMLElement | null) {
    if (target?.isConnected && target !== document.body && target !== document.documentElement) target.focus()
    else document.querySelector<HTMLElement>("[data-skill-update-trigger]")?.focus()
  }

  function closeUpdatePreview() {
    restoreFocus(updateReturnFocusRef.current)
    setUpdatePreview(null)
  }

  useEffect(() => {
    if (selectedDownloadedID || catalog.downloadedSkills.length === 0) return
    setSelectedDownloadedID(catalog.downloadedSkills[0].id)
  }, [catalog.downloadedSkills, selectedDownloadedID])

  useEffect(() => {
    if (selectedSkillSource !== "downloaded" || visibleDownloadedSkills.length === 0) return
    if (visibleDownloadedSkills.some((skill) => skill.id === selectedDownloadedID)) return
    setSelectedDownloadedID(visibleDownloadedSkills[0].id)
  }, [selectedDownloadedID, selectedSkillSource, visibleDownloadedSkills])

  useEffect(() => {
    if (mode === "downloaded") setSelectedSkillSource("downloaded")
    if (mode === "local" || mode === "plugin") setSelectedSkillSource("local")
  }, [mode])

  useEffect(() => {
    const requestRevision = ++downloadedFileRevisionRef.current
    if (selectedSkillSource !== "downloaded" || !selectedDownloadedID) {
      setDownloadedFiles([])
      setSelectedDownloadedFilePath(null)
      setDownloadedFileContent(null)
      setIsLoadingDownloadedFile(false)
      return
    }

    let mounted = true
    setIsLoadingDownloadedFile(true)
    setDownloadedFiles([])
    setSelectedDownloadedFilePath(null)
    setDownloadedFileContent(null)
    void catalog.listDownloadedFiles(selectedDownloadedID, selectedDownloadedVersion)
      .then(async (files) => {
        if (!mounted || downloadedFileRevisionRef.current !== requestRevision) return
        setDownloadedFiles(files)
        const skillFile = files.find((file) => file.path.toLowerCase() === "skill.md")
          ?? files.find((file) => file.name.toLowerCase() === "skill.md")
          ?? files[0]
        if (!skillFile) return
        setSelectedDownloadedFilePath(skillFile.path)
        const content = await catalog.readDownloadedFile(selectedDownloadedID, skillFile.path, selectedDownloadedVersion)
        if (mounted && downloadedFileRevisionRef.current === requestRevision) {
          setDownloadedFileContent(content?.content ?? null)
        }
      })
      .finally(() => {
        if (mounted && downloadedFileRevisionRef.current === requestRevision) {
          setIsLoadingDownloadedFile(false)
        }
      })

    return () => {
      mounted = false
    }
  }, [catalog.listDownloadedFiles, catalog.readDownloadedFile, selectedDownloadedID, selectedDownloadedVersion, selectedSkillSource])

  useEffect(() => {
    if (!updatePreview) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (updatePreview && pendingDownloadedID !== updatePreview.id) closeUpdatePreview()
        return
      }
      if (event.key !== "Tab") return

      const dialog = updateDialogRef.current
      if (!dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(UPDATE_DIALOG_FOCUSABLE_SELECTOR))
        .filter((element) => element.tabIndex >= 0 && !element.hidden)
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const activeElement = document.activeElement
      const focusIsInsideDialog = activeElement instanceof Node && dialog.contains(activeElement)
      if (event.shiftKey ? !focusIsInsideDialog || activeElement === first : !focusIsInsideDialog || activeElement === last) {
        event.preventDefault()
        const nextElement = event.shiftKey ? last : first
        nextElement.focus()
      }
    }
    window.addEventListener("keydown", handleKeyDown, true)
    return () => window.removeEventListener("keydown", handleKeyDown, true)
  }, [pendingDownloadedID, updatePreview])

  useEffect(() => {
    if (updatePreview) updateDialogInitialFocusRef.current?.focus()
  }, [updatePreview])

  useEffect(() => {
    const pendingMode = pendingModeFocusRef.current
    if (!pendingMode) return
    modeTabRefs.current[mode === pendingMode ? pendingMode : mode]?.focus()
    pendingModeFocusRef.current = null
  }, [mode])

  async function handleDownloadedFileSelect(path: string) {
    if (!selectedDownloadedID) return
    const requestRevision = ++downloadedFileRevisionRef.current
    setSelectedDownloadedFilePath(path)
    setDownloadedFileContent(null)
    setIsLoadingDownloadedFile(true)
    const file = await catalog.readDownloadedFile(selectedDownloadedID, path, selectedDownloadedVersion)
    if (downloadedFileRevisionRef.current !== requestRevision) return
    setDownloadedFileContent(file?.content ?? null)
    setIsLoadingDownloadedFile(false)
  }

  async function handleDownloadedDelete(id: string) {
    if (typeof window.confirm === "function" && !window.confirm(t("skillLibrary.deleteConfirm"))) return
    setPendingDownloadedID(id)
    setDownloadedStatus(null)
    const removed = await catalog.deleteDownloaded(id)
    if (removed) {
      setSelectedDownloadedID(null)
      setDownloadedStatus(removed.affectedProjectCount > 0
        ? t("skillLibrary.deletedAffected", { count: removed.affectedProjectCount })
        : t("skillLibrary.deleted"))
    }
    setPendingDownloadedID(null)
  }

  async function handleDownloadedEnabledChange(id: string, enabled: boolean) {
    if (!enabled && typeof window.confirm === "function" && !window.confirm(t("skillLibrary.disableConfirm"))) return
    setPendingDownloadedID(id)
    setDownloadedStatus(null)
    const updated = await catalog.setDownloadedEnabled(id, enabled)
    if (updated) {
      setDownloadedStatus(enabled
        ? t("skillLibrary.enabledNotice")
        : updated.affectedProjectCount > 0
          ? t("skillLibrary.disabledNoticeAffected", { count: updated.affectedProjectCount })
          : t("skillLibrary.disabledNotice"))
    }
    setPendingDownloadedID(null)
  }

  async function handleDownloadedUpdate(id: string) {
    updateReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setPendingDownloadedID(id)
    setDownloadedStatus(t("skillLibrary.update.checking"))
    try {
      const previewRequest = catalog.previewDownloadedUpdate(id)
      if (!previewRequest) {
        setDownloadedStatus(t("skillLibrary.update.unavailable"))
        return
      }
      const preview = await previewRequest
      if (preview.blocked) {
        setDownloadedStatus(t("skillLibrary.update.blocked"))
        return
      }
      if (!preview.updateAvailable) {
        setDownloadedStatus(t("skillLibrary.update.current"))
        return
      }
      setDownloadedStatus(null)
      setUpdatePreview(preview)
    } catch {
      setUpdatePreview(null)
      setDownloadedStatus(t("skillLibrary.update.previewFailed"))
      restoreFocus(updateReturnFocusRef.current)
    } finally {
      setPendingDownloadedID(null)
    }
  }

  async function handleConfirmDownloadedUpdate() {
    if (!updatePreview) return
    const preview = updatePreview
    setPendingDownloadedID(preview.id)
    setDownloadedStatus(t("skillLibrary.update.updating"))
    const updated = await catalog.updateDownloaded(preview.id, preview.targetVersion)
    setDownloadedStatus(updated ? t("skillLibrary.update.complete") : t("skillLibrary.update.failed"))
    setPendingDownloadedID(null)
    if (updated) closeUpdatePreview()
  }

  async function handleDownloadedRollback(id: string, version: string) {
    if (typeof window.confirm === "function" && !window.confirm(t("skillLibrary.rollbackConfirmVersion", { version }))) return
    setPendingDownloadedID(id)
    setDownloadedStatus(t("skillLibrary.rollbacking"))
    const updated = await catalog.rollbackDownloaded(id, version)
    setDownloadedStatus(updated
      ? updated.affectedProjectCount > 0
        ? t("skillLibrary.rollbackCompleteAffected", { count: updated.affectedProjectCount })
        : t("skillLibrary.rollbackComplete")
      : t("skillLibrary.rollbackFailed"))
    setPendingDownloadedID(null)
  }

  async function handleDownloadedFork(id: string) {
    if (onBeforeForkToLocal && !onBeforeForkToLocal()) return
    if (typeof window.confirm === "function" && !window.confirm(t("skillLibrary.forkConfirm"))) return
    setPendingDownloadedID(id)
    setDownloadedStatus(t("skillLibrary.forking"))
    const result = await catalog.forkDownloaded(id)
    if (!result) {
      setDownloadedStatus(t("skillLibrary.forkFailed"))
      setPendingDownloadedID(null)
      return
    }
    setDownloadedStatus(t("skillLibrary.forkComplete"))
    await onForkedToLocal?.(result)
    setSelectedSkillSource("local")
    setPendingDownloadedID(null)
  }

  function handleDownloadedSkillSelect(id: string) {
    if (selectedSkillSource === "local" && onBeforeSelectDownloaded && !onBeforeSelectDownloaded()) return
    setDownloadedStatus(null)
    setSelectedDownloadedID(id)
    setSelectedSkillSource("downloaded")
  }

  function handleLocalSkillSelect() {
    setSelectedSkillSource("local")
  }

  const modes: Array<{ id: SkillLibraryMode; label: string }> = [
    { id: "all", label: t("skillLibrary.provider.all") },
    { id: "local", label: t("skillLibrary.mode.local") },
    { id: "downloaded", label: t("skillLibrary.mode.downloaded") },
    { id: "plugin", label: t("shell.plugins") },
  ]

  function handleModeTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, currentMode: SkillLibraryMode) {
    const index = modes.findIndex((item) => item.id === currentMode)
    const nextIndex = event.key === "ArrowRight"
      ? (index + 1) % modes.length
      : event.key === "ArrowLeft"
        ? (index - 1 + modes.length) % modes.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? modes.length - 1
            : -1
    if (nextIndex < 0) return
    event.preventDefault()
    const nextMode = modes[nextIndex].id
    if (onModeChange(nextMode)) pendingModeFocusRef.current = nextMode
  }

  return (
    <section className={joinClassNames("skills-workspace-page", `is-${mode}`)} aria-label={t("skillLibrary.pageAria")}>
      <header className="skills-workspace-toolbar">
        <label className="skills-workspace-search-field">
          <SearchIcon aria-hidden="true" />
          <input
            type="search"
            aria-label={t("skillLibrary.searchAria")}
            placeholder={t("skillLibrary.searchPlaceholder")}
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
          {searchTerm ? (
            <button type="button" aria-label="Clear skills search" onClick={() => setSearchTerm("")}>
              <CloseIcon />
            </button>
          ) : null}
        </label>
        <div className="skills-workspace-filter-bar">
          <nav className="skills-workspace-tabs" role="tablist" aria-label={t("skillLibrary.modeAria")}>
            {modes.map((item) => (
              <button
                key={item.id}
                ref={(node) => { modeTabRefs.current[item.id] = node }}
                id={`${tabsID}-tab-${item.id}`}
                className={joinClassNames("skills-workspace-tab", mode === item.id ? "is-active" : null)}
                type="button"
                role="tab"
                aria-label={item.label}
                aria-selected={mode === item.id}
                aria-controls={`${tabsID}-panel`}
                tabIndex={mode === item.id ? 0 : -1}
                onClick={() => onModeChange(item.id)}
                onKeyDown={(event) => handleModeTabKeyDown(event, item.id)}
              >
                {item.label}
                {item.id === "downloaded" && catalog.downloadedSkills.length > 0 ? (
                  <span className="skills-workspace-tab-count">{catalog.downloadedSkills.length}</span>
                ) : null}
              </button>
            ))}
          </nav>
          <select
            className="skills-workspace-status-filter"
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as SkillLibraryStatusFilter)}
          >
            <option value="all">{t("skillLibrary.provider.all")}</option>
            <option value="enabled">{t("app.enabled")}</option>
            <option value="disabled">{t("app.disabled")}</option>
          </select>
        </div>
        <div className="skills-workspace-add-menu-shell" ref={addSkillMenuRef}>
          <button
            ref={addSkillTriggerRef}
            className={joinClassNames("primary-button", "skills-workspace-marketplace-button", isAddSkillMenuOpen ? "is-open" : null)}
            type="button"
            aria-haspopup="menu"
            aria-expanded={isAddSkillMenuOpen}
            aria-label={t("skillLibrary.add.open")}
            title={t("skillLibrary.add.open")}
            onClick={() => setIsAddSkillMenuOpen((current) => !current)}
          >
            <span>{t("skillLibrary.add.open")}</span>
            <ChevronDownIcon />
          </button>
          {isAddSkillMenuOpen ? (
            <div className="global-skills-install-menu skills-workspace-add-menu" role="menu" aria-label={t("skillLibrary.add.menuAria")}>
              <button className="global-skills-install-menu-item" role="menuitem" type="button" onClick={handleMarketplaceOpen}>
                {t("skillLibrary.marketplace.open")}
              </button>
              {localNavigatorProps ? (
                <>
                  <button
                    className="global-skills-install-menu-item"
                    role="menuitem"
                    type="button"
                    disabled={isLocalAddActionDisabled}
                    onClick={handleInstallFromUrl}
                  >
                    {t("skillLibrary.add.fromUrl")}
                  </button>
                  <button
                    className="global-skills-install-menu-item"
                    role="menuitem"
                    type="button"
                    disabled={isLocalAddActionDisabled}
                    onClick={handleInstallFromLocalFile}
                  >
                    {t("skillLibrary.add.fromLocalFile")}
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      <div
        id={`${tabsID}-panel`}
        className="skills-workspace-content"
        role="tabpanel"
        aria-labelledby={`${tabsID}-tab-${mode}`}
      >
        <aside className="skills-workspace-list-panel">
          {localNavigatorProps ? (
            <GlobalSkillsNavigator
              {...localNavigatorProps}
              downloadedSkills={catalog.downloadedSkills}
              selectedDownloadedSkillID={selectedDownloadedID}
              selectedSkillSource={selectedSkillSource}
              sourceFilter={mode}
              statusFilter={statusFilter}
              searchTerm={searchTerm}
              unified
              onDownloadedSkillSelect={handleDownloadedSkillSelect}
              onLocalSkillSelect={handleLocalSkillSelect}
              onSearchTermChange={setSearchTerm}
            />
          ) : (
            <div className="skills-workspace-fallback-list" aria-label="Downloaded skills">
              {visibleDownloadedSkills.map((skill) => (
                  <button
                    key={skill.id}
                    className={joinClassNames("skill-library-result-row", "is-downloaded", selectedSkillSource === "downloaded" && selectedDownloadedID === skill.id ? "is-selected" : null)}
                    type="button"
                    onClick={() => handleDownloadedSkillSelect(skill.id)}
                  >
                    <SkillProductIcon iconUrl={skill.iconUrl} name={skill.displayName} />
                    <span className="skill-library-result-main">
                      <span className="skill-library-result-name">{skill.displayName}</span>
                      <span className="skill-library-result-summary">{skill.slug}</span>
                    </span>
                  </button>
                ))}
            </div>
          )}
        </aside>
        <main className="skills-workspace-detail-panel">
          {selectedSkillSource === "downloaded" ? (
            <DownloadedSkillDetail
              skill={selectedDownloadedSkill}
              files={downloadedFiles}
              selectedFilePath={selectedDownloadedFilePath}
              fileContent={downloadedFileContent}
              isLoadingFile={isLoadingDownloadedFile || catalog.isLoadingDownloads}
              pendingID={pendingDownloadedID}
              statusMessage={downloadedStatus || catalog.downloadsError}
              emptyMessage={catalog.downloadedSkills.length === 0 ? t("skillLibrary.downloadedEmpty") : t("skillLibrary.resultsEmpty")}
              onOpenSource={(url) => void window.desktop?.openExternalUrl?.({ url })}
              onDelete={window.desktop?.deleteDownloadedRegistrySkill ? (id) => void handleDownloadedDelete(id) : undefined}
              onFileSelect={(path) => void handleDownloadedFileSelect(path)}
              onFork={window.desktop?.forkDownloadedRegistrySkill ? (id) => void handleDownloadedFork(id) : undefined}
              onToggleEnabled={window.desktop?.setDownloadedRegistrySkillEnabled ? (id, enabled) => void handleDownloadedEnabledChange(id, enabled) : undefined}
              onUpdate={window.desktop?.previewDownloadedRegistrySkillUpdate && window.desktop?.updateDownloadedRegistrySkill ? (id) => void handleDownloadedUpdate(id) : undefined}
              onRollback={window.desktop?.rollbackDownloadedRegistrySkill ? (id, version) => void handleDownloadedRollback(id, version) : undefined}
            />
          ) : children}
        </main>
      </div>

      <SkillMarketplaceDialog open={isMarketplaceOpen} onClose={onMarketplaceClose}>
        <SkillMarketplaceView
          activeTab={detailTab}
          detail={catalog.detail}
          downloadedSkills={catalog.downloadedSkills}
          errors={catalog.errors}
          fileContent={catalog.fileContent?.content ?? null}
          files={catalog.files}
          isDownloading={catalog.isDownloading}
          isLoadingDetail={catalog.isLoadingDetail}
          isLoadingMore={catalog.isLoadingMore}
          isLoadingProviders={catalog.isLoadingProviders}
          isSearching={catalog.isSearching}
          loadError={catalog.catalogError}
          providerFilter={catalog.providerFilter}
          providers={catalog.providers}
          query={catalog.query}
          results={catalog.results}
          security={catalog.security}
          selectedVersion={catalog.selectedVersion}
          selectedFilePath={catalog.selectedFilePath}
          selectedSkill={catalog.selectedSkill}
          sort={catalog.sort}
          versions={catalog.versions}
          hasMore={catalog.hasMore}
          onDownload={() => void catalog.downloadSelected()}
          onManageDownloaded={(id) => {
            if (!onModeChange("downloaded")) return
            setSelectedDownloadedID(id)
            setSelectedSkillSource("downloaded")
            onMarketplaceClose()
          }}
          onFileSelect={(path) => void catalog.readFile(path)}
          onProviderFilterChange={catalog.setProviderFilter}
          onQueryChange={catalog.setQuery}
          onRefresh={catalog.refresh}
          onLoadMore={() => void catalog.loadMore()}
          onSelectSkill={(skill) => {
            setDetailTab("readme")
            catalog.selectSkill(skill)
          }}
          onSortChange={catalog.setSort}
          onTabChange={setDetailTab}
          onVersionSelect={(version) => void catalog.selectVersion(version)}
        />
      </SkillMarketplaceDialog>
      {updatePreview ? (
        <div
          className="skill-library-config-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && pendingDownloadedID !== updatePreview.id) closeUpdatePreview()
          }}
        >
          <section ref={updateDialogRef} className="skill-library-config-dialog skill-library-update-dialog" role="dialog" aria-modal="true" aria-labelledby="skill-library-update-title" tabIndex={-1}>
            <header>
              <h2 id="skill-library-update-title">{t("skillLibrary.update.previewTitle")}</h2>
              <p>{t("skillLibrary.update.previewDescription", { current: updatePreview.currentVersion, target: updatePreview.targetVersion })}</p>
            </header>
            {updatePreview.upstreamSecurity ? (
              <div className={joinClassNames("skill-library-update-security", updatePreview.upstreamSecurity.blocked || updatePreview.upstreamSecurity.hasWarnings ? "has-warning" : "is-clean")}>
                <strong>{t("skillLibrary.security.upstream")}</strong>
                <span>{updatePreview.upstreamSecurity.status}</span>
                <p>{updatePreview.upstreamSecurity.summary || t("skillLibrary.security.signalDisclaimer")}</p>
              </div>
            ) : null}
            <div className="skill-library-update-diff-summary">
              <span>{t("skillLibrary.update.added", { count: updatePreview.fileChanges?.filter((change) => change.status === "added").length ?? 0 })}</span>
              <span>{t("skillLibrary.update.changed", { count: updatePreview.fileChanges?.filter((change) => change.status === "changed").length ?? 0 })}</span>
              <span>{t("skillLibrary.update.removed", { count: updatePreview.fileChanges?.filter((change) => change.status === "removed").length ?? 0 })}</span>
            </div>
            {updatePreview.fileChanges === undefined ? (
              <p className="skill-library-update-diff-unavailable">{t("skillLibrary.update.diffUnavailable")}</p>
            ) : updatePreview.fileChanges.length === 0 ? (
              <p className="skill-library-update-diff-unavailable">{t("skillLibrary.update.noFileChanges")}</p>
            ) : (
              <div className="skill-library-update-file-list" aria-label={t("skillLibrary.update.filesAria")}>
                {updatePreview.fileChanges.map((change) => (
                  <div key={`${change.status}:${change.path}`}>
                    <span className={joinClassNames("skill-library-update-file-status", `is-${change.status}`)}>{t(`skillLibrary.update.status.${change.status}`)}</span>
                    <code>{change.path}</code>
                  </div>
                ))}
              </div>
            )}
            <footer>
              <button ref={updateDialogInitialFocusRef} className="secondary-button" type="button" disabled={pendingDownloadedID === updatePreview.id} onClick={closeUpdatePreview}>
                {t("app.cancel")}
              </button>
              <button className="primary-button" type="button" disabled={pendingDownloadedID === updatePreview.id || updatePreview.blocked} onClick={() => void handleConfirmDownloadedUpdate()}>
                {pendingDownloadedID === updatePreview.id ? t("skillLibrary.update.updating") : t("skillLibrary.update.confirmAction")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  )
}
