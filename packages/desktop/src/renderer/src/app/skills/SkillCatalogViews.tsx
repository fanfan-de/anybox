import type {
  DownloadedRegistrySkill,
  RegistryFile,
  RegistryLocalScanReport,
  RegistryProviderDescriptor,
  RegistryProviderError,
  RegistrySearchSort,
  RegistrySecuritySnapshot,
  RegistrySkillDetail,
  RegistrySkillSummary,
  RegistryVersion,
} from "@anybox/shared"
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import {
  CopyIcon,
  DeleteIcon,
  DownloadIcon,
  FileTextIcon,
  ForkIcon,
  FolderIcon,
  KeyIcon,
  OpenExternalIcon,
  ResetIcon,
  SearchIcon,
  SessionRunningIcon,
  SkillDefaultLogo,
  StarIcon,
  VerifiedIcon,
} from "../icons"
import { useI18n } from "../i18n/I18nProvider"
import { joinClassNames, writeTextToClipboard } from "../shared-ui"
import { SkillFileList, SkillFileLoadingOverlay, SkillFilesSidebar } from "./SkillFileNavigation"
import { SkillDocumentPreview } from "./SkillDocumentPreview"

export type SkillCatalogDetailTab = "readme" | "files" | "security" | "versions"
export type DownloadedSkillDetailTab = "overview" | "security" | "versions"
type DownloadedSkillDetailView = DownloadedSkillDetailTab | "file"

function formatCount(value: number | undefined) {
  if (value === undefined) return null
  return new Intl.NumberFormat(undefined, { notation: "compact" }).format(value)
}

function formatDate(value: number | undefined) {
  if (!value) return null
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(value)
}

function openExternalUrl(url: string) {
  void window.desktop?.openExternalUrl?.({ url })
}

function supportsCurrentPlatform(item: RegistrySkillSummary) {
  if (!item.os?.length) return true
  const platform = window.desktop?.platform?.toLowerCase() ?? ""
  const aliases = platform === "win32"
    ? ["win32", "windows"]
    : platform === "darwin"
      ? ["darwin", "macos", "mac", "osx"]
      : platform === "linux"
        ? ["linux"]
        : [platform]
  return item.os.some((value) => aliases.includes(value.toLowerCase()))
}

function hasLowRisk(item: RegistrySkillSummary) {
  const security = item.security
  return security?.status === "clean"
    && !security.blocked
    && !security.hasWarnings
}

function getProviderDisplayName(providerID: string, skillHubName: string, fallback?: string) {
  const normalizedProviderID = providerID.toLowerCase()
  if (normalizedProviderID === "skillhub") return skillHubName
  if (normalizedProviderID === "clawhub") return fallback ?? "ClawHub"
  return fallback ?? providerID
}

function securityStatusKey(security: RegistrySecuritySnapshot) {
  return security.blocked ? "blocked" as const : security.status
}

function localRiskStatusKey(report: RegistryLocalScanReport) {
  if (report.blocked) return "blocked" as const
  if (report.risk === "none" || report.risk === "low") return "clean" as const
  if (report.risk === "critical") return "malicious" as const
  return "suspicious" as const
}

function resolveProductIconSource(iconUrl: string | undefined, allowRemote: boolean) {
  const source = iconUrl?.trim()
  if (!source) return null
  if (/^data:image\//i.test(source)) return source
  if (allowRemote && /^https:\/\//i.test(source)) return source
  return null
}

function resolveCatalogProductIcon(item: RegistrySkillSummary) {
  const explicitIcon = item.iconUrl?.trim() || item.author.avatarUrl?.trim()
  if (explicitIcon) return explicitIcon
  if (item.provider.toLowerCase() !== "clawhub") return undefined

  const handle = item.author.handle.trim().replace(/^@/, "")
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(handle)) return undefined
  return `https://github.com/${handle}.png?size=80`
}

export function SkillProductIcon({
  iconUrl,
  name,
  allowRemote = false,
  decorative = false,
}: {
  iconUrl?: string
  name: string
  allowRemote?: boolean
  decorative?: boolean
}) {
  const { t } = useI18n()
  const source = resolveProductIconSource(iconUrl, allowRemote)
  const [hasImageError, setHasImageError] = useState(false)
  const accessibleName = t("skillLibrary.productIconAlt", { name })

  useEffect(() => {
    setHasImageError(false)
  }, [source])

  if (source && !hasImageError) {
    return (
      <span className="skill-library-product-icon" aria-hidden={decorative || undefined}>
        <img
          src={source}
          alt={decorative ? "" : accessibleName}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setHasImageError(true)}
        />
      </span>
    )
  }

  return (
    <span
      className="skill-library-product-icon is-fallback is-skill-default"
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : accessibleName}
      aria-hidden={decorative || undefined}
    >
      <SkillDefaultLogo />
    </span>
  )
}

function ProviderFilter({
  providers,
  value,
  onChange,
}: {
  providers: RegistryProviderDescriptor[]
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useI18n()
  const options = [
    { id: "all", label: t("skillLibrary.provider.all"), disabled: false },
    ...providers.map((provider) => ({
      id: provider.id,
      label: getProviderDisplayName(provider.id, t("skillLibrary.provider.skillhub"), provider.name),
      disabled: !provider.enabled,
    })),
  ]

  return (
    <div className="skill-library-provider-filter" role="group" aria-label={t("skillLibrary.provider.filterAria")}>
      {options.map((option) => (
        <button
          key={option.id}
          className={joinClassNames("skill-library-filter-button", value === option.id ? "is-active" : null)}
          type="button"
          aria-pressed={value === option.id}
          disabled={option.disabled}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function CatalogResultRow({
  item,
  selected,
  onSelect,
}: {
  item: RegistrySkillSummary
  selected: boolean
  onSelect: () => void
}) {
  const { t } = useI18n()
  const downloads = formatCount(item.stats?.downloads ?? item.stats?.installs)
  const stars = formatCount(item.stats?.stars)
  const primaryTopic = item.topics.find((topic) => topic.trim().length > 0)
  const securityClass = item.security?.blocked
    ? "is-blocked"
    : item.security?.hasWarnings
      ? "has-warning"
      : item.security?.status === "clean"
        ? "is-clean"
        : ""
  const securityStatus = item.security?.blocked ? "blocked" : item.security?.status ?? "unknown"
  const securityLabel = t(`skillLibrary.security.status.${securityStatus}`)
  const sourceLabel = getProviderDisplayName(item.provider, t("skillLibrary.provider.skillhub"))

  return (
    <button
      className={joinClassNames("skill-library-result-row", selected ? "is-selected" : null)}
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
    >
      <SkillProductIcon iconUrl={resolveCatalogProductIcon(item)} name={item.displayName} allowRemote />
      <span className="skill-library-result-main">
        <span className="skill-library-result-title-line">
          <span className="skill-library-result-name">{item.displayName}</span>
          {primaryTopic ? <span className="skill-library-topic-badge" title={primaryTopic}>{primaryTopic}</span> : null}
          {item.verified ? (
            <span
              className="skill-library-verified-badge"
              role="img"
              aria-label={t("skillLibrary.badge.verified")}
              title={t("skillLibrary.badge.verified")}
            >
              <VerifiedIcon />
            </span>
          ) : null}
          {item.requiresApiKey ? (
            <span className="skill-library-api-key-badge">
              <KeyIcon />
              <span>{t("skillLibrary.badge.requiresApiKey")}</span>
            </span>
          ) : null}
        </span>
        <span className="skill-library-result-summary">{item.summary}</span>
        <span className="skill-library-result-meta">
          <span>{item.author.displayName || item.author.handle}</span>
          <span className="skill-library-result-security">
            <span className={joinClassNames("skill-library-security-dot", securityClass)} aria-hidden="true" />
            <span>{securityLabel}</span>
          </span>
          {item.version ? <span>{item.version}</span> : null}
        </span>
      </span>
      <span className="skill-library-result-trailing">
        <span className="skill-library-result-metrics">
          {item.stats?.stars !== undefined && stars ? (
            <span
              className="skill-library-result-metric"
              role="img"
              aria-label={t("skillLibrary.metric.stars", { count: item.stats.stars })}
              title={t("skillLibrary.metric.stars", { count: item.stats.stars })}
            >
              <StarIcon />
              <span aria-hidden="true">{stars}</span>
            </span>
          ) : null}
          {(item.stats?.downloads !== undefined || item.stats?.installs !== undefined) && downloads ? (
            <span
              className="skill-library-result-metric"
              role="img"
              aria-label={t("skillLibrary.metric.downloads", { count: item.stats.downloads ?? item.stats.installs ?? 0 })}
              title={t("skillLibrary.metric.downloads", { count: item.stats.downloads ?? item.stats.installs ?? 0 })}
            >
              <DownloadIcon />
              <span aria-hidden="true">{downloads}</span>
            </span>
          ) : null}
        </span>
        <span className="skill-library-result-source">{sourceLabel}</span>
      </span>
    </button>
  )
}

function ProviderErrors({ errors }: { errors: RegistryProviderError[] }) {
  const { t } = useI18n()
  if (errors.length === 0) return null

  return (
    <div className="skill-library-provider-errors" role="status">
      {errors.map((error) => (
        <p key={`${error.provider}:${error.code}`}>
          <strong>{getProviderDisplayName(error.provider, t("skillLibrary.provider.skillhub"))}</strong>: {error.message}
        </p>
      ))}
    </div>
  )
}

function SecurityPanel({ security }: { security: RegistrySecuritySnapshot | null }) {
  const { t } = useI18n()
  if (!security) {
    return <div className="skill-library-detail-empty">{t("skillLibrary.security.unavailable")}</div>
  }

  return (
    <div className="skill-library-security-panel">
      <div className={joinClassNames("skill-library-security-summary", security.blocked ? "is-blocked" : security.hasWarnings ? "has-warning" : "is-clean")}>
        <span className="skill-library-security-dot" aria-hidden="true" />
        <strong>{t(`skillLibrary.security.status.${securityStatusKey(security)}`)}</strong>
        <span>{security.summary || t("skillLibrary.security.signalDisclaimer")}</span>
      </div>
      {security.reasons.length > 0 ? (
        <section>
          <h3>{t("skillLibrary.security.reasons")}</h3>
          <ul>{security.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </section>
      ) : null}
      {security.signals?.length ? (
        <section>
          <h3>{t("skillLibrary.security.signals")}</h3>
          <div className="skill-library-security-signals">
            {security.signals.map((signal) => (
              <div key={`${signal.scanner}:${signal.checkedAt ?? "latest"}`}>
                <strong>{signal.scanner}</strong>
                <span>{t(`skillLibrary.security.status.${signal.status}`)}</span>
                <p>{signal.summary}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function LocalScanPanel({ report }: { report: RegistryLocalScanReport | null }) {
  const { t } = useI18n()
  if (!report) {
    return <div className="skill-library-detail-empty">{t("skillLibrary.security.localUnavailable")}</div>
  }

  return (
    <div className="skill-library-security-panel">
      <div className={joinClassNames("skill-library-security-summary", report.blocked ? "is-blocked" : report.risk === "none" || report.risk === "low" ? "is-clean" : "has-warning")}>
        <span className="skill-library-security-dot" aria-hidden="true" />
        <strong>{t(`skillLibrary.security.status.${localRiskStatusKey(report)}`)}</strong>
        <span>{t("skillLibrary.security.localSummary")}</span>
      </div>
      {report.findings.length > 0 ? (
        <section>
          <h3>{t("skillLibrary.security.findings")}</h3>
          <div className="skill-library-security-signals">
            {report.findings.map((finding, index) => (
              <div key={`${finding.code}:${finding.file ?? "skill"}:${finding.line ?? index}`}>
                <strong>{finding.code}</strong>
                <span>{finding.risk}</span>
                <p>{finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ""} — ${finding.message}` : finding.message}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function SkillFileContent({
  content,
  renderMarkdown = false,
}: {
  content: string | null
  renderMarkdown?: boolean
}) {
  const { t } = useI18n()

  return content && renderMarkdown ? (
    <div className="skill-library-file-content skill-library-file-markdown">
      <SkillDocumentPreview content={content} />
    </div>
  ) : (
    <pre className="skill-library-file-content" data-i18n-skip>{content ?? t("skillLibrary.files.select")}</pre>
  )
}

function FilesPanel({
  files,
  selectedPath,
  content,
  renderMarkdown = false,
  onSelect,
}: {
  files: RegistryFile[]
  selectedPath: string | null
  content: string | null
  renderMarkdown?: boolean
  onSelect: (path: string) => void
}) {
  const { t } = useI18n()
  if (files.length === 0) {
    return <div className="skill-library-detail-empty">{t("skillLibrary.files.unavailable")}</div>
  }

  return (
    <div className="skill-library-files-layout">
      <SkillFileList
        items={files.map((file) => ({
          label: file.path,
          path: file.path,
          sizeLabel: file.size !== undefined ? `${file.size} B` : undefined,
        }))}
        selectedPath={selectedPath}
        onSelect={onSelect}
      />
      <SkillFileContent content={content} renderMarkdown={renderMarkdown} />
    </div>
  )
}

function VersionsPanel({
  versions,
  selectedVersion,
  onSelect,
}: {
  versions: RegistryVersion[]
  selectedVersion: string | null
  onSelect: (version: string) => void
}) {
  const { t } = useI18n()
  if (versions.length === 0) {
    return <div className="skill-library-detail-empty">{t("skillLibrary.versions.unavailable")}</div>
  }

  return (
    <div className="skill-library-version-list">
      {versions.map((version) => (
        <button className={joinClassNames("skill-library-version-row", selectedVersion === version.version ? "is-selected" : null)} type="button" aria-pressed={selectedVersion === version.version} key={version.version} onClick={() => onSelect(version.version)}>
          <strong>{version.version}</strong>
          <span>{formatDate(version.createdAt)}</span>
          <p>{version.changelog}</p>
        </button>
      ))}
    </div>
  )
}

function CatalogDetail({
  detail,
  selected,
  activeTab,
  fileContent,
  files,
  security,
  versions,
  selectedVersion,
  selectedFilePath,
  isDownloading,
  isLoading,
  downloadedSkill,
  providerCanDownload,
  onDownload,
  onManageDownloaded,
  onFileSelect,
  onTabChange,
  onVersionSelect,
}: {
  detail: RegistrySkillDetail | null
  selected: RegistrySkillSummary | null
  activeTab: SkillCatalogDetailTab
  fileContent: string | null
  files: RegistryFile[]
  security: RegistrySecuritySnapshot | null
  versions: RegistryVersion[]
  selectedVersion: string | null
  selectedFilePath: string | null
  isDownloading: boolean
  isLoading: boolean
  downloadedSkill: DownloadedRegistrySkill | null
  providerCanDownload: boolean
  onDownload: () => void
  onManageDownloaded: (id: string) => void
  onFileSelect: (path: string) => void
  onTabChange: (tab: SkillCatalogDetailTab) => void
  onVersionSelect: (version: string) => void
}) {
  const { t } = useI18n()
  const tabsID = useId()
  const tabRefs = useRef<Partial<Record<SkillCatalogDetailTab, HTMLButtonElement | null>>>({})
  const detailContentRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    if (!selected) return
    const content = detailContentRef.current
    if (!content) return
    content.scrollTop = 0
    content.scrollLeft = 0
  }, [activeTab, selected?.provider, selected?.remoteId, selectedVersion])

  if (!selected) {
    return <div className="skill-library-detail-empty">{t("skillLibrary.detail.empty")}</div>
  }

  const tabs: Array<{ id: SkillCatalogDetailTab; label: string }> = [
    { id: "readme", label: t("skillLibrary.detail.readme") },
    { id: "files", label: t("skillLibrary.detail.files") },
    { id: "security", label: t("skillLibrary.detail.security") },
    { id: "versions", label: t("skillLibrary.detail.versions") },
  ]
  const latestVersion = detail?.latestVersion?.version ?? detail?.version ?? selected.version
  const hasDownloadedUpdate = Boolean(downloadedSkill && latestVersion && downloadedSkill.activeVersion !== latestVersion)
  const actionDisabled = isDownloading
    || Boolean(!downloadedSkill && (security?.blocked || !providerCanDownload))
  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, tab: SkillCatalogDetailTab) => {
    const index = tabs.findIndex((item) => item.id === tab)
    const nextIndex = event.key === "ArrowRight"
      ? (index + 1) % tabs.length
      : event.key === "ArrowLeft"
        ? (index - 1 + tabs.length) % tabs.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : -1
    if (nextIndex < 0) return
    event.preventDefault()
    const next = tabs[nextIndex].id
    onTabChange(next)
    tabRefs.current[next]?.focus()
  }

  return (
    <article className="skill-library-detail-panel">
      <header className="skill-library-detail-header">
        <div className="skill-library-detail-heading">
          <h2>{detail?.displayName ?? selected.displayName}</h2>
          <p>{detail?.summary ?? selected.summary}</p>
          <div className="skill-library-detail-meta">
            <span>{detail?.author.displayName || detail?.author.handle || selected.author.displayName || selected.author.handle}</span>
            <span>{getProviderDisplayName(detail?.provider ?? selected.provider, t("skillLibrary.provider.skillhub"))}</span>
            {(selectedVersion ?? latestVersion) ? (
              <span>{selectedVersion ?? latestVersion}</span>
            ) : null}
          </div>
        </div>
        <div className="skill-library-detail-actions">
          <button
            className="icon-button"
            type="button"
            aria-label={t("skillLibrary.openSource")}
            title={t("skillLibrary.openSource")}
            onClick={() => openExternalUrl(detail?.canonicalUrl ?? selected.canonicalUrl)}
          >
            <OpenExternalIcon />
          </button>
          <button
            className={joinClassNames(downloadedSkill ? "secondary-button" : "primary-button", "skill-library-download-button")}
            type="button"
            disabled={actionDisabled}
            title={downloadedSkill
              ? downloadedSkill.enabled
                ? t("app.enabled")
                : t("skillLibrary.marketplace.downloadedManaged")
              : !providerCanDownload
                ? t("skillLibrary.downloadUnavailable")
                : undefined}
            onClick={() => downloadedSkill ? onManageDownloaded(downloadedSkill.id) : onDownload()}
          >
            {isDownloading ? <SessionRunningIcon /> : downloadedSkill ? null : <DownloadIcon />}
            <span>{isDownloading
              ? t("skillLibrary.downloading")
              : hasDownloadedUpdate
                ? t("skillLibrary.marketplace.updateInDownloaded")
                : downloadedSkill
                  ? t("skillLibrary.marketplace.manageDownloaded")
                  : providerCanDownload
                    ? t("skillLibrary.marketplace.downloadToLocal")
                    : t("skillLibrary.downloadUnavailable")}</span>
          </button>
        </div>
      </header>
      {security?.blocked ? <p className="skill-library-blocked-message">{t("skillLibrary.security.blocked")}</p> : null}
      {!providerCanDownload ? <p className="skill-library-provider-capability-note">{t("skillLibrary.downloadCapabilityNotice")}</p> : null}
      <nav className="skill-library-detail-tabs" role="tablist" aria-label={t("skillLibrary.detail.tabsAria")}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            ref={(node) => { tabRefs.current[tab.id] = node }}
            id={`${tabsID}-tab-${tab.id}`}
            aria-controls={`${tabsID}-panel`}
            className={joinClassNames("skill-library-detail-tab", activeTab === tab.id ? "is-active" : null)}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div ref={detailContentRef} id={`${tabsID}-panel`} className="skill-library-detail-content" role="tabpanel" aria-labelledby={`${tabsID}-tab-${activeTab}`}>
        {isLoading ? <div className="skill-library-detail-empty">{t("app.loadingData")}</div> : null}
        {!isLoading && activeTab === "readme" ? (
          fileContent
            ? <SkillDocumentPreview content={fileContent} />
            : <div className="skill-library-description"><p>{detail?.description || detail?.summary || selected.summary}</p></div>
        ) : null}
        {!isLoading && activeTab === "files" ? (
          <FilesPanel files={files} selectedPath={selectedFilePath} content={fileContent} onSelect={onFileSelect} />
        ) : null}
        {!isLoading && activeTab === "security" ? <SecurityPanel security={security} /> : null}
        {!isLoading && activeTab === "versions" ? <VersionsPanel versions={versions} selectedVersion={selectedVersion} onSelect={onVersionSelect} /> : null}
      </div>
    </article>
  )
}

export interface SkillMarketplaceViewProps {
  activeTab: SkillCatalogDetailTab
  detail: RegistrySkillDetail | null
  downloadedSkills: DownloadedRegistrySkill[]
  errors: RegistryProviderError[]
  fileContent: string | null
  files: RegistryFile[]
  isDownloading: boolean
  isLoadingDetail: boolean
  isLoadingProviders: boolean
  isLoadingMore: boolean
  isSearching: boolean
  loadError: string | null
  providerFilter: string
  providers: RegistryProviderDescriptor[]
  query: string
  results: RegistrySkillSummary[]
  security: RegistrySecuritySnapshot | null
  selectedVersion: string | null
  selectedFilePath: string | null
  selectedSkill: RegistrySkillSummary | null
  sort: RegistrySearchSort
  versions: RegistryVersion[]
  hasMore: boolean
  onDownload: () => void
  onManageDownloaded: (id: string) => void
  onFileSelect: (path: string) => void
  onProviderFilterChange: (provider: string) => void
  onQueryChange: (query: string) => void
  onRefresh: () => void
  onLoadMore: () => void
  onSelectSkill: (skill: RegistrySkillSummary | null) => void
  onSortChange: (sort: RegistrySearchSort) => void
  onTabChange: (tab: SkillCatalogDetailTab) => void
  onVersionSelect: (version: string) => void
}

export function SkillMarketplaceView(props: SkillMarketplaceViewProps) {
  const { t } = useI18n()
  const [compatibleOnly, setCompatibleOnly] = useState(false)
  const [lowRiskOnly, setLowRiskOnly] = useState(false)
  const [notDownloadedOnly, setNotDownloadedOnly] = useState(false)
  const selectedDownloaded = props.selectedSkill
    ? props.downloadedSkills.find((item) => item.provider === props.selectedSkill!.provider && item.remoteId === props.selectedSkill!.remoteId) ?? null
    : null
  const visibleResults = useMemo(() => props.results.filter((item) => {
    if (compatibleOnly && !supportsCurrentPlatform(item)) return false
    if (lowRiskOnly && !hasLowRisk(item)) return false
    if (notDownloadedOnly && props.downloadedSkills.some((downloaded) => downloaded.provider === item.provider && downloaded.remoteId === item.remoteId)) return false
    return true
  }), [compatibleOnly, lowRiskOnly, notDownloadedOnly, props.downloadedSkills, props.results])

  useEffect(() => {
    if (props.selectedSkill && visibleResults.some((item) => item.provider === props.selectedSkill!.provider && item.remoteId === props.selectedSkill!.remoteId)) return
    props.onSelectSkill(visibleResults[0] ?? null)
  }, [props.onSelectSkill, props.selectedSkill, visibleResults])

  const selectedProvider = props.selectedSkill
    ? props.providers.find((provider) => provider.id === props.selectedSkill!.provider)
    : undefined

  return (
    <div className="skill-library-list-detail">
      <aside className="skill-library-list-panel">
        <div className="skill-library-list-toolbar">
          <label className="skill-library-search-field">
            <SearchIcon aria-hidden="true" />
            <input
              type="search"
              aria-label={t("skillLibrary.searchAria")}
              placeholder={t("skillLibrary.searchPlaceholder")}
              value={props.query}
              onChange={(event) => props.onQueryChange(event.target.value)}
            />
            {props.isSearching ? <SessionRunningIcon className="skill-library-spinner" aria-label={t("app.loadingData")} /> : null}
          </label>
          <div className="skill-library-filter-row">
            <ProviderFilter providers={props.providers} value={props.providerFilter} onChange={props.onProviderFilterChange} />
            <select
              className="skill-library-sort-select"
              aria-label={t("skillLibrary.sortAria")}
              value={props.sort}
              onChange={(event) => props.onSortChange(event.target.value as RegistrySearchSort)}
            >
              <option value="relevance">{t("skillLibrary.sort.relevance")}</option>
              <option value="updated">{t("skillLibrary.sort.updated")}</option>
              <option value="downloads">{t("skillLibrary.sort.downloads")}</option>
            </select>
            <button className="icon-button skill-library-refresh-button" type="button" aria-label={t("app.refresh")} title={t("app.refresh")} onClick={props.onRefresh}>
              <ResetIcon />
            </button>
          </div>
          <div className="skill-library-secondary-filters" role="group" aria-label={t("skillLibrary.filters.aria")}>
            <button className={joinClassNames("skill-library-filter-button", compatibleOnly ? "is-active" : null)} type="button" aria-pressed={compatibleOnly} onClick={() => setCompatibleOnly((value) => !value)}>
              {t("skillLibrary.filters.compatible")}
            </button>
            <button className={joinClassNames("skill-library-filter-button", lowRiskOnly ? "is-active" : null)} type="button" aria-pressed={lowRiskOnly} onClick={() => setLowRiskOnly((value) => !value)}>
              {t("skillLibrary.filters.lowRisk")}
            </button>
            <button className={joinClassNames("skill-library-filter-button", notDownloadedOnly ? "is-active" : null)} type="button" aria-pressed={notDownloadedOnly} onClick={() => setNotDownloadedOnly((value) => !value)}>
              {t("skillLibrary.filters.notDownloaded")}
            </button>
          </div>
        </div>
        <ProviderErrors errors={props.errors} />
        {props.loadError ? <p className="skill-library-load-error" role="alert">{props.loadError}</p> : null}
        <div className="skill-library-result-list" aria-label={t("skillLibrary.resultsAria")}>
          {props.isLoadingProviders || (props.isSearching && props.results.length === 0) ? (
            <div className="skill-library-list-empty">{t("app.loadingData")}</div>
          ) : visibleResults.length === 0 ? (
            <div className="skill-library-list-empty">{t("skillLibrary.resultsEmpty")}</div>
          ) : visibleResults.map((item) => (
            <CatalogResultRow
              key={item.id}
              item={item}
              selected={props.selectedSkill?.provider === item.provider && props.selectedSkill.remoteId === item.remoteId}
              onSelect={() => props.onSelectSkill(item)}
            />
          ))}
          {props.hasMore ? (
            <button className="secondary-button skill-library-load-more" type="button" disabled={props.isLoadingMore} onClick={props.onLoadMore}>
              {props.isLoadingMore ? t("app.loadingData") : t("skillLibrary.loadMore")}
            </button>
          ) : null}
        </div>
      </aside>
      <CatalogDetail
        activeTab={props.activeTab}
        detail={props.detail}
        selected={props.selectedSkill}
        fileContent={props.fileContent}
        files={props.files}
        security={props.security}
        versions={props.versions}
        selectedVersion={props.selectedVersion}
        selectedFilePath={props.selectedFilePath}
        isDownloading={props.isDownloading}
        isLoading={props.isLoadingDetail}
        downloadedSkill={selectedDownloaded}
        providerCanDownload={Boolean(selectedProvider?.enabled && selectedProvider.capabilities.download)}
        onDownload={props.onDownload}
        onManageDownloaded={props.onManageDownloaded}
        onFileSelect={props.onFileSelect}
        onTabChange={props.onTabChange}
        onVersionSelect={props.onVersionSelect}
      />
    </div>
  )
}

export function DownloadedSkillDetail({
  skill,
  files,
  selectedFilePath,
  fileContent,
  isLoadingFile,
  pendingID,
  statusMessage,
  emptyMessage,
  onOpenSource,
  onDelete,
  onFileSelect,
  onFork,
  onToggleEnabled,
  onUpdate,
  onRollback,
}: {
  skill: DownloadedRegistrySkill | null
  files: RegistryFile[]
  selectedFilePath: string | null
  fileContent: string | null
  isLoadingFile: boolean
  pendingID: string | null
  statusMessage: string | null
  emptyMessage?: string
  onOpenSource: (url: string) => void
  onDelete?: (id: string) => void
  onFileSelect: (path: string) => void
  onFork?: (id: string) => void
  onToggleEnabled?: (id: string, enabled: boolean) => void
  onUpdate?: (id: string) => void
  onRollback?: (id: string, version: string) => void
}) {
  const { t } = useI18n()
  const selectedVersion = skill?.versions.find((version) => version.version === skill.activeVersion)
  const [activeView, setActiveView] = useState<DownloadedSkillDetailView>("overview")
  const [isFileSidebarOpen, setIsFileSidebarOpen] = useState(false)
  const tabsID = useId()
  const filesSidebarID = `${tabsID}-files-sidebar`
  const tabRefs = useRef<Partial<Record<DownloadedSkillDetailTab, HTMLButtonElement | null>>>({})
  const fileItems = useMemo(() => files.map((file) => ({
    label: file.path,
    path: file.path,
    sizeLabel: file.size !== undefined ? `${file.size} B` : undefined,
  })), [files])
  const selectedFileLabel = files.find((file) => file.path === selectedFilePath)?.path
    ?? selectedFilePath
    ?? t("skillLibrary.local.skillFileName")
  const currentFileLabelID = `${tabsID}-current-file`

  useEffect(() => {
    setActiveView("overview")
    setIsFileSidebarOpen(false)
  }, [skill?.id])

  if (!skill) return <div className="skill-library-downloaded-empty">{emptyMessage ?? t("skillLibrary.downloadedEmpty")}</div>

  const security = skill.upstreamSecurity ?? skill.security ?? null
  const securityState = security
    ? securityStatusKey(security)
    : "unknown"
  const securityClass = security?.blocked
    ? "is-blocked"
    : security?.hasWarnings || security?.status === "suspicious"
      ? "has-warning"
      : security?.status === "clean"
        ? "is-clean"
        : null
  const enableDisabled = pendingID === skill.id || security?.blocked || skill.localScan?.blocked
  const tabs: Array<{ id: DownloadedSkillDetailTab; label: string }> = [
    { id: "overview", label: t("skillLibrary.detail.overview") },
    { id: "security", label: t("skillLibrary.detail.security") },
    { id: "versions", label: t("skillLibrary.detail.versions") },
  ]
  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, tab: DownloadedSkillDetailTab) => {
    const index = tabs.findIndex((item) => item.id === tab)
    const nextIndex = event.key === "ArrowRight"
      ? (index + 1) % tabs.length
      : event.key === "ArrowLeft"
        ? (index - 1 + tabs.length) % tabs.length
        : null
    if (nextIndex === null) return
    event.preventDefault()
    const next = tabs[nextIndex]!.id
    setActiveView(next)
    tabRefs.current[next]?.focus()
  }
  const copyHash = (value: string) => {
    void writeTextToClipboard(value).catch(() => undefined)
  }
  const handleFileSelect = (path: string) => {
    setActiveView("file")
    if (path === selectedFilePath && fileContent !== null) return
    onFileSelect(path)
  }

  return (
    <article className={joinClassNames(
      "skill-library-detail-panel skill-library-downloaded-detail",
      isFileSidebarOpen ? "is-files-sidebar-open" : null,
    )}>
      <div className="skill-library-detail-center">
        <div className="skill-library-downloaded-chrome">
        <header className="skill-library-detail-header">
          <div className="skill-library-downloaded-identity">
            <SkillProductIcon iconUrl={skill.iconUrl} name={skill.displayName} decorative />
            <div className="skill-library-detail-heading">
              <div className="skill-library-downloaded-title-line">
                <h2>{skill.displayName}</h2>
                <span className={joinClassNames("skill-library-state-badge", skill.enabled ? "is-enabled" : null)}>
                  {skill.enabled ? t("app.enabled") : t("app.disabled")}
                </span>
                <span className={joinClassNames("skill-library-state-badge", securityClass)}>
                  <span className="skill-library-security-dot" aria-hidden="true" />
                  {t(`skillLibrary.security.status.${securityState}`)}
                </span>
              </div>
              <p>{skill.description || t("skillLibrary.downloadedDisabled")}</p>
              <div className="skill-library-detail-meta">
                <span>{skill.author.displayName || skill.author.handle}</span>
                <span>{getProviderDisplayName(skill.provider, t("skillLibrary.provider.skillhub"))}</span>
                <span>v{skill.activeVersion}</span>
              </div>
            </div>
          </div>
          <div className="skill-library-detail-actions skill-library-downloaded-actions">
            {onToggleEnabled ? (
              <button
                className="skill-library-enable-compact"
                type="button"
                role="switch"
                aria-checked={skill.enabled}
                disabled={enableDisabled}
                onClick={() => onToggleEnabled(skill.id, !skill.enabled)}
              >
                <span>{t("skillLibrary.enable.title")}</span>
                <span className={joinClassNames("skill-library-enable-track", skill.enabled ? "is-active" : null)} aria-hidden="true">
                  <span />
                </span>
              </button>
            ) : null}
            <button className="icon-button" type="button" aria-label={t("skillLibrary.openSource")} title={t("skillLibrary.openSource")} onClick={() => onOpenSource(skill.canonicalUrl)}>
              <OpenExternalIcon />
            </button>
            {onUpdate ? (
              <button className="icon-button" type="button" aria-label={t("skillLibrary.update.check")} title={t("skillLibrary.update.check")} data-skill-update-trigger disabled={pendingID === skill.id} onClick={() => onUpdate(skill.id)}>
                <ResetIcon />
              </button>
            ) : null}
            {onFork ? (
              <button className="icon-button" type="button" aria-label={t("skillLibrary.fork")} title={t("skillLibrary.fork")} disabled={pendingID === skill.id} onClick={() => onFork(skill.id)}>
                <ForkIcon />
              </button>
            ) : null}
            <button
              className={joinClassNames("icon-button", "skill-library-files-sidebar-toggle", isFileSidebarOpen ? "is-active" : null)}
              type="button"
              aria-controls={filesSidebarID}
              aria-expanded={isFileSidebarOpen}
              aria-label={t("skillLibrary.files.aria")}
              title={t("skillLibrary.detail.files")}
              onClick={() => setIsFileSidebarOpen((current) => !current)}
            >
              <FolderIcon />
            </button>
          </div>
        </header>
        {statusMessage ? <p className="skill-library-download-status" role="status">{statusMessage}</p> : null}
        <nav className="skill-library-detail-tabs skill-library-downloaded-tabs" role="tablist" aria-label={t("skillLibrary.detail.tabsAria")}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              ref={(node) => { tabRefs.current[tab.id] = node }}
              id={`${tabsID}-tab-${tab.id}`}
              aria-controls={`${tabsID}-panel`}
              className={joinClassNames("skill-library-detail-tab", activeView === tab.id ? "is-active" : null)}
              type="button"
              role="tab"
              aria-selected={activeView === tab.id}
              tabIndex={(activeView === "file" ? tab.id === "overview" : activeView === tab.id) ? 0 : -1}
              onClick={() => setActiveView(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        </div>
        <div
          id={`${tabsID}-panel`}
          className={joinClassNames("skill-library-detail-content skill-library-downloaded-tabpanel", activeView === "file" ? "is-file-view" : null)}
          role={activeView === "file" ? "region" : "tabpanel"}
          aria-labelledby={activeView === "file" ? currentFileLabelID : `${tabsID}-tab-${activeView}`}
        >
        {activeView === "overview" ? (
          <div className="skill-library-downloaded-overview">
            {!skill.enabled ? (
              <div className="skill-library-overview-state has-warning">
                <span className="skill-library-security-dot" aria-hidden="true" />
                <span><strong>{t("app.disabled")}</strong><small>{t("skillLibrary.downloadedDisabled")}</small></span>
              </div>
            ) : null}
            <dl className="skill-library-overview-grid">
              <div><dt>{t("skillLibrary.metadata.source")}</dt><dd>{getProviderDisplayName(skill.provider, t("skillLibrary.provider.skillhub"))}</dd></div>
              <div><dt>{t("skillLibrary.metadata.version")}</dt><dd>{skill.activeVersion}</dd></div>
              <div><dt>{t("skillLibrary.metadata.os")}</dt><dd>{skill.os?.join(", ") || t("skillLibrary.metadata.any")}</dd></div>
              <div><dt>{t("skillLibrary.metadata.systems")}</dt><dd>{skill.systems?.join(", ") || t("skillLibrary.metadata.none")}</dd></div>
              <div><dt>{t("skillLibrary.metadata.downloadedAt")}</dt><dd>{formatDate(skill.downloadedAt)}</dd></div>
              <div><dt>{t("skillLibrary.metadata.state")}</dt><dd>{skill.enabled ? t("app.enabled") : t("app.disabled")}</dd></div>
            </dl>
            <details className="skill-library-technical-details">
              <summary>{t("skillLibrary.metadata.technical")}</summary>
              <dl>
                <div>
                  <dt>SHA-256</dt>
                  <dd><code title={skill.artifactSha256}>{skill.artifactSha256}</code><button className="icon-button" type="button" aria-label={`${t("app.copy")} SHA-256`} title={`${t("app.copy")} SHA-256`} onClick={() => copyHash(skill.artifactSha256)}><CopyIcon /></button></dd>
                </div>
                <div>
                  <dt>{t("skillLibrary.metadata.treeHash")}</dt>
                  <dd><code title={skill.treeHash}>{skill.treeHash}</code><button className="icon-button" type="button" aria-label={`${t("app.copy")} ${t("skillLibrary.metadata.treeHash")}`} title={`${t("app.copy")} ${t("skillLibrary.metadata.treeHash")}`} onClick={() => copyHash(skill.treeHash)}><CopyIcon /></button></dd>
                </div>
              </dl>
            </details>
            {onDelete ? (
              <div className="skill-library-danger-zone">
                <p>{t("skillLibrary.deleteDescription")}</p>
                <button className="secondary-button is-danger" type="button" onClick={() => onDelete(skill.id)}><DeleteIcon /><span>{t("app.delete")}</span></button>
              </div>
            ) : null}
          </div>
        ) : null}
        {activeView === "security" ? (
          <div className="skill-library-downloaded-security-view">
            <section>
              <h3>{t("skillLibrary.security.upstream")}</h3>
              <SecurityPanel security={security} />
            </section>
            {selectedVersion?.source.signatureVerified ? (
              <section>
                <h3>{t("skillLibrary.security.integrity")}</h3>
                <div className="skill-library-security-panel">
                  <div className="skill-library-security-summary is-clean">
                    <span className="skill-library-security-dot" aria-hidden="true" />
                    <strong>{t("skillLibrary.security.signatureVerified")}</strong>
                    <span>{t("skillLibrary.security.signatureKey")}: {selectedVersion.source.signatureKeyId ?? "-"}</span>
                  </div>
                </div>
              </section>
            ) : null}
            <section>
              <h3>{t("skillLibrary.security.local")}</h3>
              <LocalScanPanel report={skill.localScan ?? null} />
            </section>
          </div>
        ) : null}
        {activeView === "file" ? (
          <div className="skill-library-downloaded-file-view">
            <div className="skill-library-current-file-toolbar">
              <div id={currentFileLabelID} className="skill-library-current-file" title={selectedFileLabel}>
                <FileTextIcon aria-hidden="true" />
                <span>{selectedFileLabel}</span>
              </div>
            </div>
            <div className="skill-library-file-content-stage" aria-busy={isLoadingFile}>
              <SkillFileContent content={fileContent} renderMarkdown={Boolean(selectedFilePath?.toLowerCase().endsWith(".md"))} />
              <SkillFileLoadingOverlay isLoading={isLoadingFile} />
            </div>
          </div>
        ) : null}
        {activeView === "versions" ? (
          <div className="skill-library-downloaded-versions-view">
            <h3>{t("skillLibrary.installedVersions")}</h3>
            <div className="skill-library-installed-version-list">
              {[...skill.versions].sort((left, right) => right.installedAt - left.installedAt).map((version) => {
                const isCurrent = version.version === skill.activeVersion
                return (
                  <div className="skill-library-installed-version-row" key={version.version}>
                    <span><strong>{version.version}</strong><small>{formatDate(version.installedAt)}</small></span>
                    {isCurrent ? (
                      <span className="skill-library-current-version">{t("skillLibrary.currentVersion")}</span>
                    ) : onRollback ? (
                      <button className="secondary-button" type="button" disabled={pendingID === skill.id} onClick={() => onRollback(skill.id, version.version)}>
                        {t("skillLibrary.rollback")}
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}
        </div>
      </div>
      <SkillFilesSidebar
        id={filesSidebarID}
        isLoading={isLoadingFile}
        items={fileItems}
        selectedPath={activeView === "file" ? selectedFilePath : null}
        onSelect={handleFileSelect}
      />
    </article>
  )
}

export function DownloadedSkillsView({
  skills,
  selectedID,
  files,
  selectedFilePath,
  fileContent,
  isLoadingFile,
  pendingID,
  statusMessage,
  onSelect,
  onOpenSource,
  onDelete,
  onFileSelect,
  onFork,
  onToggleEnabled,
  onUpdate,
  onRollback,
}: {
  skills: DownloadedRegistrySkill[]
  selectedID: string | null
  files: RegistryFile[]
  selectedFilePath: string | null
  fileContent: string | null
  isLoadingFile: boolean
  pendingID: string | null
  statusMessage: string | null
  onSelect: (id: string) => void
  onOpenSource: (url: string) => void
  onDelete?: (id: string) => void
  onFileSelect: (path: string) => void
  onFork?: (id: string) => void
  onToggleEnabled?: (id: string, enabled: boolean) => void
  onUpdate?: (id: string) => void
  onRollback?: (id: string, version: string) => void
}) {
  const { t } = useI18n()
  const selected = skills.find((item) => item.id === selectedID) ?? skills[0] ?? null

  if (skills.length === 0) {
    return <div className="skill-library-downloaded-empty">{t("skillLibrary.downloadedEmpty")}</div>
  }

  return (
    <div className="skill-library-list-detail is-downloaded">
      <aside className="skill-library-list-panel">
        <div className="skill-library-result-list">
          {skills.map((skill) => (
            <button
              key={skill.id}
              className={joinClassNames("skill-library-result-row", "is-downloaded", selected?.id === skill.id ? "is-selected" : null)}
              type="button"
              aria-pressed={selected?.id === skill.id}
              onClick={() => onSelect(skill.id)}
            >
              <SkillProductIcon iconUrl={skill.iconUrl} name={skill.displayName} />
              <span className="skill-library-result-main">
                <span className="skill-library-result-title-line">
                  <span className="skill-library-result-name">{skill.displayName}</span>
                </span>
                <span className="skill-library-result-summary">{skill.slug}</span>
                <span className="skill-library-result-meta"><span>{getProviderDisplayName(skill.provider, t("skillLibrary.provider.skillhub"))}</span><span>{skill.activeVersion}</span><span>{skill.enabled ? t("app.enabled") : t("app.disabled")}</span></span>
              </span>
            </button>
          ))}
        </div>
      </aside>
      <DownloadedSkillDetail
        skill={selected}
        files={files}
        selectedFilePath={selectedFilePath}
        fileContent={fileContent}
        isLoadingFile={isLoadingFile}
        pendingID={pendingID}
        statusMessage={statusMessage}
        onOpenSource={onOpenSource}
        onDelete={onDelete}
        onFileSelect={onFileSelect}
        onFork={onFork}
        onToggleEnabled={onToggleEnabled}
        onUpdate={onUpdate}
        onRollback={onRollback}
      />
    </div>
  )
}
