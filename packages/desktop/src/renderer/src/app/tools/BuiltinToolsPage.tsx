import { useEffect, useId, useMemo, useState, type ReactNode } from "react"
import type { AppLocale } from "../../../../shared/locale"
import { ChevronDownIcon, ChevronRightIcon, ToolsIcon } from "../icons"
import { useI18n } from "../i18n/I18nProvider"
import {
  getBuiltinToolCopyKeys,
  getBuiltinToolModuleCopyKeys,
} from "../i18n/tool-module-translations"
import type { TranslationKey } from "../i18n/translations"
import { ShellTopMenu } from "../shared-ui"
import type {
  BuiltinToolModuleSummary,
  BuiltinToolSummary,
  OnDemandToolSummary,
  ToolModuleInspectionFailure,
} from "../types"

export type BuiltinToolModuleID = BuiltinToolModuleSummary["id"]

interface BuiltinToolsPageProps {
  activeModuleID?: BuiltinToolModuleID | null
  builtinToolModules: BuiltinToolModuleSummary[]
  builtinTools: BuiltinToolSummary[]
  builtinToolsError: string | null
  hideNavigator?: boolean
  isBuiltinToolSelectionDirty: boolean
  isLoadingBuiltinTools: boolean
  isSavingBuiltinTools: boolean
  onDemandToolFailures: ToolModuleInspectionFailure[]
  onDemandToolModules: BuiltinToolModuleSummary[]
  onDemandTools: OnDemandToolSummary[]
  windowControls?: ReactNode
  onActiveModuleChange?: (moduleID: BuiltinToolModuleID | null) => void
  onBuiltinToolModuleToggle: (toolIDs: string[], enabled: boolean) => void
  onBuiltinToolToggle: (toolID: string, enabled: boolean) => void
  onResetBuiltinTools: () => boolean | Promise<boolean>
  onSaveBuiltinTools: () => boolean | Promise<boolean>
}

export interface BuiltinToolsSidebarViewProps {
  activeModuleID: BuiltinToolModuleID | null
  builtinToolModules: BuiltinToolModuleSummary[]
  builtinTools: BuiltinToolSummary[]
  onDemandToolModules: BuiltinToolModuleSummary[]
  onDemandTools: OnDemandToolSummary[]
  onActiveModuleChange: (moduleID: BuiltinToolModuleID) => void
}

interface BuiltinToolModuleGroup {
  kind: "builtin"
  module: BuiltinToolModuleSummary
  items: BuiltinToolSummary[]
  enabledCount: number
}

interface OnDemandToolModuleGroup {
  kind: "on-demand"
  module: BuiltinToolModuleSummary
  items: OnDemandToolSummary[]
}

type ToolModuleGroup = BuiltinToolModuleGroup | OnDemandToolModuleGroup
type ToolSummary = BuiltinToolSummary | OnDemandToolSummary

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string

function formatJson(value: unknown) {
  if (value === undefined) return "{}"

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function getBuiltinToolKindLabelForKind(
  kind: ToolSummary["capabilities"]["kind"] | "other",
  t: Translate,
) {
  switch (kind) {
    case "exec":
      return t("tools.shell")
    case "write":
      return t("tools.write")
    case "search":
      return t("tools.search")
    case "read":
      return t("tools.read")
    case "workflow":
      return t("tools.workflow")
    case "interaction":
      return t("tools.interaction")
    case "delegation":
      return t("tools.delegation")
    default:
      return t("tools.other")
  }
}

function getBuiltinToolKindLabel(tool: ToolSummary, t: Translate) {
  return getBuiltinToolKindLabelForKind(tool.capabilities.kind ?? "other", t)
}

function getBuiltinToolRiskLabel(tool: ToolSummary, t: Translate) {
  if (tool.capabilities.needsShell || tool.capabilities.kind === "exec") return t("tools.shellAccess")
  if (tool.capabilities.kind === "delegation") {
    return tool.capabilities.readOnly ? t("tools.delegationStatus") : t("tools.delegatesWork")
  }
  if (tool.capabilities.kind === "workflow") return t("tools.workflowControl")
  if (tool.capabilities.kind === "interaction") return t("tools.userInteraction")
  if (tool.capabilities.destructive) return t("tools.highRisk")
  if (tool.capabilities.readOnly) return t("tools.readOnly")
  return t("tools.moderate")
}

function getBuiltinToolRiskBadgeClassName(tool: ToolSummary) {
  if (
    tool.capabilities.needsShell ||
    tool.capabilities.kind === "exec" ||
    tool.capabilities.destructive ||
    (tool.capabilities.kind === "delegation" && !tool.capabilities.readOnly) ||
    (tool.capabilities.kind === "workflow" && !tool.capabilities.readOnly)
  ) {
    return "tools-badge is-warning"
  }
  if (tool.capabilities.readOnly) {
    return "tools-badge is-highlight"
  }
  return "tools-badge"
}

function getModuleActivationLabel(module: BuiltinToolModuleSummary, t: Translate) {
  switch (module.activation.mode) {
    case "always":
      return t("tools.modules.activation.always")
    case "configured":
      return t("tools.modules.activation.configured")
    case "search-or-explicit":
      return t("tools.modules.activation.searchOrExplicit")
    case "explicit-only":
      return t("tools.modules.activation.explicitOnly")
  }
}

function getModuleScopeLabel(module: BuiltinToolModuleSummary, t: Translate) {
  switch (module.activation.scope) {
    case "global":
      return t("tools.modules.scope.global")
    case "project":
      return t("tools.modules.scope.project")
    case "session":
      return t("tools.modules.scope.session")
    case "turn":
      return t("tools.modules.scope.turn")
  }
}

function getModuleProviderLabel(module: BuiltinToolModuleSummary, t: Translate) {
  const providerName = module.provider.name ?? module.provider.id
  const providerKind = t(`tools.modules.provider.${module.provider.kind}`)
  return t("tools.modules.providerLabel", { kind: providerKind, name: providerName })
}

function getLocalizedModuleCopy(module: BuiltinToolModuleSummary, locale: AppLocale, t: Translate) {
  if (locale === "en-US") {
    return { title: module.title, description: module.description }
  }

  const keys = getBuiltinToolModuleCopyKeys(module.id)
  return keys
    ? { title: t(keys.title), description: t(keys.description) }
    : { title: module.title, description: module.description }
}

function getLocalizedToolCopy(tool: ToolSummary, locale: AppLocale, t: Translate) {
  if (locale === "en-US") {
    return { title: tool.title, description: tool.description }
  }

  const keys = getBuiltinToolCopyKeys(tool.id)
  return keys
    ? { title: t(keys.title), description: t(keys.description) }
    : { title: tool.title, description: tool.description }
}

export function buildBuiltinToolModuleGroups(
  builtinToolModules: BuiltinToolModuleSummary[],
  builtinTools: BuiltinToolSummary[],
): BuiltinToolModuleGroup[] {
  const itemsByModuleID = new Map<string, BuiltinToolSummary[]>()
  for (const tool of builtinTools) {
    const items = itemsByModuleID.get(tool.moduleID) ?? []
    items.push(tool)
    itemsByModuleID.set(tool.moduleID, items)
  }

  return builtinToolModules.flatMap((module) => {
    const items = itemsByModuleID.get(module.id) ?? []
    if (items.length === 0) return []
    return [{
      kind: "builtin" as const,
      module,
      items,
      enabledCount: items.filter((tool) => tool.enabled).length,
    }]
  })
}

export function buildOnDemandToolModuleGroups(
  onDemandToolModules: BuiltinToolModuleSummary[],
  onDemandTools: OnDemandToolSummary[],
): OnDemandToolModuleGroup[] {
  const itemsByModuleID = new Map<string, OnDemandToolSummary[]>()
  for (const tool of onDemandTools) {
    const items = itemsByModuleID.get(tool.moduleID) ?? []
    items.push(tool)
    itemsByModuleID.set(tool.moduleID, items)
  }

  return onDemandToolModules.flatMap((module) => {
    const items = itemsByModuleID.get(module.id) ?? []
    if (items.length === 0) return []
    return [{ kind: "on-demand" as const, module, items }]
  })
}

export function BuiltinToolsSidebarView({
  activeModuleID,
  builtinToolModules,
  builtinTools,
  onDemandToolModules,
  onDemandTools,
  onActiveModuleChange,
}: BuiltinToolsSidebarViewProps) {
  const { locale, t } = useI18n()
  const headingIDPrefix = useId()
  const builtinHeadingID = `${headingIDPrefix}-builtin`
  const onDemandHeadingID = `${headingIDPrefix}-on-demand`
  const builtinModuleGroups = useMemo(
    () => buildBuiltinToolModuleGroups(builtinToolModules, builtinTools),
    [builtinToolModules, builtinTools],
  )
  const onDemandModuleGroups = useMemo(
    () => buildOnDemandToolModuleGroups(onDemandToolModules, onDemandTools),
    [onDemandToolModules, onDemandTools],
  )

  const renderModuleButton = (group: ToolModuleGroup) => {
    const isActive = group.module.id === activeModuleID
    const moduleTitle = getLocalizedModuleCopy(group.module, locale, t).title
    const ariaLabel = group.kind === "builtin"
      ? t("tools.modules.rowAria", {
          title: moduleTitle,
          enabled: group.enabledCount,
          total: group.items.length,
        })
      : t("tools.modules.onDemandRowAria", {
          title: moduleTitle,
          total: group.items.length,
        })

    return (
      <div className="tools-category-module-item" key={group.module.id} role="listitem">
        <button
          className={isActive ? "skill-tree-row tools-category-item is-active" : "skill-tree-row tools-category-item"}
          aria-label={ariaLabel}
          aria-pressed={isActive}
          type="button"
          onClick={() => onActiveModuleChange(group.module.id)}
        >
          <span className="skill-tree-label">{moduleTitle}</span>
          <span className="prompt-tree-row-badges" aria-hidden="true">
            <span className="tools-badge">{group.items.length}</span>
            <span className="tools-badge">
              {group.kind === "builtin"
                ? `${group.enabledCount}/${group.items.length}`
                : t("tools.modules.onDemandBadge")}
            </span>
          </span>
        </button>
      </div>
    )
  }

  return (
    <section className="sidebar-view sidebar-view-tools" aria-label={t("tools.modules.sidebarAria")}>
      <div className="skills-tree-root tools-category-list" aria-label={t("tools.modules.listAria")}>
        {builtinModuleGroups.length > 0 ? (
          <section className="tools-category-section" aria-labelledby={builtinHeadingID}>
            <h2 className="tools-category-section-title" id={builtinHeadingID}>
              {t("tools.modules.sections.builtin")}
            </h2>
            <div className="tools-category-section-list" role="list" aria-labelledby={builtinHeadingID}>
              {builtinModuleGroups.map(renderModuleButton)}
            </div>
          </section>
        ) : null}
        {onDemandModuleGroups.length > 0 ? (
          <section className="tools-category-section" aria-labelledby={onDemandHeadingID}>
            <h2 className="tools-category-section-title" id={onDemandHeadingID}>
              {t("tools.modules.sections.onDemand")}
            </h2>
            <div className="tools-category-section-list" role="list" aria-labelledby={onDemandHeadingID}>
              {onDemandModuleGroups.map(renderModuleButton)}
            </div>
          </section>
        ) : null}
      </div>
    </section>
  )
}

export function BuiltinToolsPage({
  activeModuleID: controlledActiveModuleID,
  builtinToolModules,
  builtinTools,
  builtinToolsError,
  hideNavigator = false,
  isBuiltinToolSelectionDirty,
  isLoadingBuiltinTools,
  isSavingBuiltinTools,
  onDemandToolFailures,
  onDemandToolModules,
  onDemandTools,
  windowControls,
  onActiveModuleChange,
  onBuiltinToolModuleToggle,
  onBuiltinToolToggle,
  onResetBuiltinTools,
  onSaveBuiltinTools,
}: BuiltinToolsPageProps) {
  const { locale, t } = useI18n()
  const [internalActiveModuleID, setInternalActiveModuleID] = useState<BuiltinToolModuleID | null>(null)
  const [expandedToolIDs, setExpandedToolIDs] = useState<Set<string>>(() => new Set())
  const enabledBuiltinToolCount = builtinTools.filter((tool) => tool.enabled).length
  const builtinModuleGroups = useMemo(
    () => buildBuiltinToolModuleGroups(builtinToolModules, builtinTools),
    [builtinToolModules, builtinTools],
  )
  const onDemandModuleGroups = useMemo(
    () => buildOnDemandToolModuleGroups(onDemandToolModules, onDemandTools),
    [onDemandToolModules, onDemandTools],
  )
  const moduleGroups: ToolModuleGroup[] = useMemo(
    () => [...builtinModuleGroups, ...onDemandModuleGroups],
    [builtinModuleGroups, onDemandModuleGroups],
  )
  const activeModuleID = controlledActiveModuleID !== undefined
    ? controlledActiveModuleID
    : internalActiveModuleID
  const activeModuleGroup = moduleGroups.find((group) => group.module.id === activeModuleID) ?? moduleGroups[0] ?? null
  const activeModuleCopy = activeModuleGroup
    ? getLocalizedModuleCopy(activeModuleGroup.module, locale, t)
    : null
  function setActiveModuleID(nextModuleID: BuiltinToolModuleID | null) {
    if (onActiveModuleChange) {
      onActiveModuleChange(nextModuleID)
      return
    }

    setInternalActiveModuleID(nextModuleID)
  }

  useEffect(() => {
    const firstModuleID = moduleGroups[0]?.module.id ?? null
    if (!firstModuleID) {
      if (activeModuleID !== null) {
        setActiveModuleID(null)
      }
      return
    }

    if (!activeModuleID || !moduleGroups.some((group) => group.module.id === activeModuleID)) {
      setActiveModuleID(firstModuleID)
    }
  }, [activeModuleID, moduleGroups])

  const toggleExpandedTool = (toolID: string) => {
    setExpandedToolIDs((currentToolIDs) => {
      const nextToolIDs = new Set(currentToolIDs)
      if (nextToolIDs.has(toolID)) {
        nextToolIDs.delete(toolID)
      } else {
        nextToolIDs.add(toolID)
      }
      return nextToolIDs
    })
  }

  return (
    <section className="builtin-tools-page tools-page" aria-label={t("tools.modules.pageAria")}>
      <ShellTopMenu
        as="header"
        ariaLabel={t("tools.topMenu")}
        className="canvas-region-top-menu tools-top-menu"
        contentClassName="canvas-region-top-menu-tabs-shell"
        content={(
          <div className="tools-top-menu-label">
            <ToolsIcon />
            <span>{t("tools.title")}</span>
          </div>
        )}
        dragRegion
        layout="three-column"
        trailing={windowControls}
        trailingClassName="tools-top-menu-window-controls"
      />

      <div className="tools-page-main">
        {builtinToolsError ? <div className="tools-banner is-error">{builtinToolsError}</div> : null}
        {onDemandToolFailures.length > 0 ? (
          <div className="tools-banner is-warning" role="status">
            <div className="tools-banner-text">
              <strong>{t("tools.modules.onDemandFailureTitle")}</strong>
              <p>
                {onDemandToolFailures
                  .map((failure) => `${failure.moduleID}: ${failure.message}`)
                  .join("; ")}
              </p>
            </div>
          </div>
        ) : null}

        {isLoadingBuiltinTools ? (
          <article className="tools-empty-state">
            <span className="label">{t("app.loading")}</span>
            <h3>{t("tools.modules.fetchingTitle")}</h3>
            <p>{t("tools.modules.fetchingCopy")}</p>
          </article>
        ) : (
          <section
            className={hideNavigator ? "tools-layout is-sidebar-hosted" : "tools-layout"}
            aria-label={t("tools.modules.pageAria")}
          >
            {!hideNavigator ? (
              <div className="tools-category-panel">
                <div className="tools-category-body">
                  <BuiltinToolsSidebarView
                    activeModuleID={activeModuleGroup?.module.id ?? null}
                    builtinToolModules={builtinToolModules}
                    builtinTools={builtinTools}
                    onDemandToolModules={onDemandToolModules}
                    onDemandTools={onDemandTools}
                    onActiveModuleChange={setActiveModuleID}
                  />
                </div>
              </div>
            ) : null}

            <div className="tools-detail-panel">
              {activeModuleGroup ? (
                <>
                  <div className="tools-detail-hero">
                    <div>
                      <span className="label">{t("tools.modules.label")}</span>
                      <h3>{activeModuleCopy?.title}</h3>
                      <code className="tools-module-id">{activeModuleGroup.module.id}</code>
                      <p className="tools-page-copy">{activeModuleCopy?.description}</p>
                    </div>

                    <div className="tools-detail-statuses" aria-label={t("tools.modules.metadataAria")}>
                      <span className="tools-badge">{getModuleProviderLabel(activeModuleGroup.module, t)}</span>
                      <span className="tools-badge">{t("tools.modules.activationPolicy", {
                        mode: getModuleActivationLabel(activeModuleGroup.module, t),
                      })}</span>
                      <span className="tools-badge">{getModuleScopeLabel(activeModuleGroup.module, t)}</span>
                    </div>
                  </div>

                  <section
                    className="tools-panel tools-detail-section"
                    aria-label={t("tools.modules.toolsAria", { title: activeModuleCopy?.title ?? activeModuleGroup.module.title })}
                  >
                    {activeModuleGroup.kind === "builtin" ? (
                      <>
                        <div
                          className="tools-availability-toolbar"
                          role="group"
                          aria-label={t("tools.availability")}
                        >
                          <div className="tools-availability-summary">
                            <strong>{t("tools.availability")}</strong>
                            <span>{t("tools.modules.globalEnabledCount", {
                              enabled: enabledBuiltinToolCount,
                              total: builtinTools.length,
                            })}</span>
                            <span className="tools-availability-separator" aria-hidden="true">·</span>
                            <span>{t("tools.modules.currentEnabledCount", {
                              enabled: activeModuleGroup.enabledCount,
                              total: activeModuleGroup.items.length,
                            })}</span>
                          </div>

                          <div className="tools-availability-controls">
                            <button
                              className="tools-module-availability"
                              type="button"
                              role="switch"
                              aria-checked={activeModuleGroup.enabledCount === activeModuleGroup.items.length}
                              aria-label={t("tools.modules.toggleAria", {
                                title: activeModuleCopy?.title ?? activeModuleGroup.module.title,
                              })}
                              disabled={isSavingBuiltinTools}
                              onClick={() => onBuiltinToolModuleToggle(
                                activeModuleGroup.items.map((tool) => tool.id),
                                activeModuleGroup.enabledCount !== activeModuleGroup.items.length,
                              )}
                            >
                              <span className="tools-module-availability-label">
                                {t("tools.modules.enableAll")}
                              </span>
                              <span className="tools-toggle-control" aria-hidden="true">
                                <span className="tools-toggle-thumb" />
                              </span>
                            </button>

                            <div className="tools-availability-actions">
                              <button
                                className="secondary-button"
                                type="button"
                                disabled={isSavingBuiltinTools}
                                onClick={() => void onResetBuiltinTools()}
                              >
                                {isSavingBuiltinTools ? t("app.resetting") : t("tools.modules.resetAll")}
                              </button>
                              <button
                                className="primary-button"
                                type="button"
                                disabled={!isBuiltinToolSelectionDirty || isSavingBuiltinTools}
                                onClick={() => void onSaveBuiltinTools()}
                              >
                                {isSavingBuiltinTools ? t("app.saving") : t("app.saveChanges")}
                              </button>
                            </div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div
                        className="tools-on-demand-toolbar"
                        role="note"
                        aria-label={t("tools.modules.onDemand.contentsTitle")}
                      >
                        <div className="tools-on-demand-summary">
                          <strong>{t("tools.modules.onDemand.contentsTitle")}</strong>
                          <span>{t("tools.modules.onDemand.contentsSummary", {
                            total: activeModuleGroup.items.length,
                          })}</span>
                        </div>
                        <span
                          className="tools-on-demand-guidance"
                          title={t("tools.modules.onDemand.noticeCopy")}
                        >
                          {t("tools.modules.onDemand.noticeCopy")}
                        </span>
                      </div>
                    )}

                    <div className="tools-card-list">
                      {activeModuleGroup.items.map((tool) => {
                        const isExpanded = expandedToolIDs.has(tool.id)
                        const isConfigurable = "enabled" in tool
                        const detailsID = `tool-module-details-${tool.id}`
                        const toolCopy = getLocalizedToolCopy(tool, locale, t)

                        return (
                          <article
                            key={tool.id}
                            className={[
                              "tools-toggle-card",
                              "tools-card",
                              "tools-card-accordion",
                              isConfigurable && tool.enabled ? "is-active" : "",
                              !isConfigurable ? "is-read-only" : "",
                              isExpanded ? "is-expanded" : "",
                            ].filter(Boolean).join(" ")}
                          >
                            <div className="tools-card-row">
                              <button
                                className="tools-card-expander"
                                type="button"
                                aria-expanded={isExpanded}
                                aria-controls={detailsID}
                                aria-label={t(
                                  isExpanded ? "tools.modules.hideDetails" : "tools.modules.showDetails",
                                  { title: toolCopy.title },
                                )}
                                onClick={() => toggleExpandedTool(tool.id)}
                              >
                                <span className="tools-card-expander-icon" aria-hidden="true">
                                  {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                                </span>
                                <strong className="tools-card-title">{toolCopy.title}</strong>
                                <span className="tools-card-id">{tool.id}</span>
                              </button>
                              <div className="tools-card-row-actions">
                                <span className="tools-card-meta tools-card-meta-inline">
                                  <span className="tools-badge">{getBuiltinToolKindLabel(tool, t)}</span>
                                  <span className={getBuiltinToolRiskBadgeClassName(tool)}>
                                    {getBuiltinToolRiskLabel(tool, t)}
                                  </span>
                                  {tool.aliases.length > 0 ? (
                                    <span className="tools-badge">{t("tools.modules.aliasCount", { count: tool.aliases.length })}</span>
                                  ) : null}
                                </span>
                                {isConfigurable ? (
                                  <button
                                    className="tools-card-toggle-button"
                                    type="button"
                                    role="switch"
                                    aria-checked={tool.enabled}
                                    aria-label={toolCopy.title}
                                    disabled={isSavingBuiltinTools}
                                    onClick={() => onBuiltinToolToggle(tool.id, !tool.enabled)}
                                  >
                                    <span className="tools-toggle-control" aria-hidden="true">
                                      <span className="tools-toggle-thumb" />
                                    </span>
                                  </button>
                                ) : null}
                              </div>
                            </div>

                            {isExpanded ? (
                              <div className="tools-card-details" id={detailsID}>
                                <dl className="tools-card-detail-grid">
                                  <div className="tools-card-detail-item is-description">
                                    <dt>{t("tools.modules.detail.description")}</dt>
                                    <dd title={toolCopy.description}>{toolCopy.description}</dd>
                                  </div>
                                  <div className="tools-card-detail-item">
                                    <dt>{t("tools.modules.detail.toolId")}</dt>
                                    <dd>{tool.id}</dd>
                                  </div>
                                  <div className="tools-card-detail-item">
                                    <dt>{t("tools.modules.detail.concurrency")}</dt>
                                    <dd>{tool.capabilities.concurrency ?? t("tools.modules.value.default")}</dd>
                                  </div>
                                  <div className="tools-card-detail-item">
                                    <dt>{t("tools.modules.detail.aliases")}</dt>
                                    <dd>{tool.aliases.length > 0 ? tool.aliases.join(", ") : t("tools.modules.value.none")}</dd>
                                  </div>
                                </dl>
                                <div className="tools-card-input-schema">
                                  <span className="tools-card-detail-label">{t("tools.modules.detail.inputSchema")}</span>
                                  <pre>{formatJson(tool.inputSchema ?? {})}</pre>
                                </div>
                              </div>
                            ) : null}
                          </article>
                        )
                      })}
                    </div>
                  </section>
                </>
              ) : (
                <article className="tools-empty-state tools-detail-empty-state">
                  <h3>{t("tools.modules.emptyTitle")}</h3>
                  <p>{t("tools.modules.emptyCopy")}</p>
                </article>
              )}
            </div>
          </section>
        )}
      </div>
    </section>
  )
}
