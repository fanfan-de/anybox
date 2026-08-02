import { useEffect, useMemo, useState, type ReactNode } from "react"
import type { AppLocale } from "../../../../shared/locale"
import { ChevronDownIcon, ChevronRightIcon, ToolsIcon } from "../icons"
import { useI18n } from "../i18n/I18nProvider"
import {
  getBuiltinToolCopyKeys,
  getBuiltinToolModuleCopyKeys,
} from "../i18n/tool-module-translations"
import type { TranslationKey } from "../i18n/translations"
import { ShellTopMenu } from "../shared-ui"
import type { BuiltinToolModuleSummary, BuiltinToolSummary } from "../types"

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
  onActiveModuleChange: (moduleID: BuiltinToolModuleID) => void
}

interface BuiltinToolModuleGroup {
  module: BuiltinToolModuleSummary
  items: BuiltinToolSummary[]
  enabledCount: number
}

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
  kind: BuiltinToolSummary["capabilities"]["kind"] | "other",
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

function getBuiltinToolKindLabel(tool: BuiltinToolSummary, t: Translate) {
  return getBuiltinToolKindLabelForKind(tool.capabilities.kind ?? "other", t)
}

function getBuiltinToolRiskLabel(tool: BuiltinToolSummary, t: Translate) {
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

function getBuiltinToolRiskBadgeClassName(tool: BuiltinToolSummary) {
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

function getLocalizedToolCopy(tool: BuiltinToolSummary, locale: AppLocale, t: Translate) {
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
      module,
      items,
      enabledCount: items.filter((tool) => tool.enabled).length,
    }]
  })
}

export function BuiltinToolsSidebarView({
  activeModuleID,
  builtinToolModules,
  builtinTools,
  onActiveModuleChange,
}: BuiltinToolsSidebarViewProps) {
  const { locale, t } = useI18n()
  const moduleGroups = useMemo(
    () => buildBuiltinToolModuleGroups(builtinToolModules, builtinTools),
    [builtinToolModules, builtinTools],
  )

  return (
    <section className="sidebar-view sidebar-view-tools" aria-label={t("tools.modules.sidebarAria")}>
      <div className="skills-tree-root tools-category-list" role="list" aria-label={t("tools.modules.listAria")}>
        {moduleGroups.map((group) => {
          const isActive = group.module.id === activeModuleID
          const moduleTitle = getLocalizedModuleCopy(group.module, locale, t).title

          return (
            <button
              key={group.module.id}
              className={isActive ? "skill-tree-row tools-category-item is-active" : "skill-tree-row tools-category-item"}
              aria-label={t("tools.modules.rowAria", {
                title: moduleTitle,
                enabled: group.enabledCount,
                total: group.items.length,
              })}
              aria-pressed={isActive}
              type="button"
              onClick={() => onActiveModuleChange(group.module.id)}
            >
              <span className="skill-tree-label">{moduleTitle}</span>
              <span className="prompt-tree-row-badges" aria-hidden="true">
                <span className="tools-badge">{group.items.length}</span>
                <span className="tools-badge">
                  {group.enabledCount}/{group.items.length}
                </span>
              </span>
            </button>
          )
        })}
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
  const moduleGroups = useMemo(
    () => buildBuiltinToolModuleGroups(builtinToolModules, builtinTools),
    [builtinToolModules, builtinTools],
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
                      <span className="tools-badge">{getModuleActivationLabel(activeModuleGroup.module, t)}</span>
                      <span className="tools-badge">{getModuleScopeLabel(activeModuleGroup.module, t)}</span>
                    </div>
                  </div>

                  <section
                    className="tools-panel tools-detail-section"
                    aria-label={t("tools.modules.toolsAria", { title: activeModuleCopy?.title ?? activeModuleGroup.module.title })}
                  >
                    <div className="tools-detail-header">
                      <div>
                        <span className="label">{t("tools.availability")}</span>
                        <h2>{t("tools.globalAvailability")}</h2>
                        <p>{t("tools.modules.enabledSummary", {
                          enabled: enabledBuiltinToolCount,
                          total: builtinTools.length,
                        })}</p>
                      </div>
                      <div className="tools-detail-actions">
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={isSavingBuiltinTools}
                          onClick={() => void onResetBuiltinTools()}
                        >
                          {isSavingBuiltinTools ? t("app.resetting") : t("tools.resetDefault")}
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

                    <button
                      className={[
                        "tools-module-availability",
                        activeModuleGroup.enabledCount > 0 && activeModuleGroup.enabledCount < activeModuleGroup.items.length
                          ? "is-partial"
                          : "",
                      ].filter(Boolean).join(" ")}
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
                      <span className="tools-module-availability-copy">
                        <strong>
                          {activeModuleGroup.enabledCount === activeModuleGroup.items.length
                            ? t("tools.modules.state.allowed")
                            : activeModuleGroup.enabledCount === 0
                              ? t("tools.modules.state.disabled")
                              : t("tools.modules.state.partial")}
                        </strong>
                        <span>{t("tools.modules.availabilityCopy", {
                          enabled: activeModuleGroup.enabledCount,
                          total: activeModuleGroup.items.length,
                        })}</span>
                      </span>
                      <span className="tools-toggle-control" aria-hidden="true">
                        <span className="tools-toggle-thumb" />
                      </span>
                    </button>

                    <div className="tools-card-list">
                      {activeModuleGroup.items.map((tool) => {
                        const isExpanded = expandedToolIDs.has(tool.id)
                        const detailsID = `builtin-tool-details-${tool.id}`
                        const toolCopy = getLocalizedToolCopy(tool, locale, t)

                        return (
                          <article
                            key={tool.id}
                            className={[
                              "tools-toggle-card",
                              "tools-card",
                              "tools-card-accordion",
                              tool.enabled ? "is-active" : "",
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
