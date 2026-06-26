import { useEffect, useId, useState } from "react"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  AutomationIcon,
  CalendarIcon,
  FileTextIcon,
  LayoutSidebarLeftIcon,
  PluginIcon,
  SettingsIcon,
  ToolsIcon,
} from "../icons"
import { useI18n } from "../i18n/I18nProvider"
import type { TranslationKey } from "../i18n/translations"
import { joinClassNames, SidebarToggleButton, type SidebarSide } from "../shared-ui"
import type { LeftSidebarView } from "../types"

interface ActivityRailProps {
  activeView: LeftSidebarView
  bottomSlotRef?: (node: HTMLDivElement | null) => void
  isSettingsOpen?: boolean
  isSidebarCollapsed: boolean
  onOpenSettings?: () => void
  onViewChange: (view: LeftSidebarView) => void
  onToggleSidebar: () => void
  side: SidebarSide
}

const primaryLeftRailViews = [
  { view: "workspace" as const, labelKey: "shell.openWorkspace", Icon: LayoutSidebarLeftIcon },
  { view: "connections" as const, labelKey: "shell.openConnectionsAndExtensions", Icon: PluginIcon },
  { view: "calendar" as const, labelKey: "shell.openCalendar", Icon: CalendarIcon },
  { view: "automations" as const, labelKey: "shell.openAutomations", Icon: AutomationIcon },
]

const configurationLeftRailViews = [
  { view: "resources" as const, labelKey: "shell.openPromptsAndSkills", Icon: FileTextIcon },
  { view: "tools" as const, labelKey: "shell.openTools", Icon: ToolsIcon },
]

function isConfigurationLeftRailView(view: LeftSidebarView) {
  return configurationLeftRailViews.some((item) => item.view === view)
}

interface ActivityRailViewButtonProps {
  className?: string
  Icon: typeof LayoutSidebarLeftIcon
  isActive: boolean
  label: string
  onClick: () => void
}

function ActivityRailViewButton({ className, Icon, isActive, label, onClick }: ActivityRailViewButtonProps) {
  return (
    <button
      className={joinClassNames("activity-rail-view-button", className, isActive && "is-active")}
      aria-label={label}
      aria-pressed={isActive}
      title={label}
      type="button"
      onClick={onClick}
    >
      <Icon />
    </button>
  )
}

export function ActivityRail({
  activeView,
  bottomSlotRef,
  isSettingsOpen = false,
  isSidebarCollapsed,
  onOpenSettings,
  onViewChange,
  onToggleSidebar,
  side,
}: ActivityRailProps) {
  const railClassName = side === "right" ? "activity-rail is-right" : "activity-rail"
  const configurationMenuID = useId()
  const { t } = useI18n()
  const isConfigurationViewActive = isConfigurationLeftRailView(activeView)
  const [isConfigurationMenuOpen, setIsConfigurationMenuOpen] = useState(isConfigurationViewActive)
  const ConfigurationToggleIcon = isConfigurationMenuOpen ? ChevronDownIcon : ChevronRightIcon
  const configurationToggleLabel = isConfigurationMenuOpen
    ? t("shell.hideConfigurationShortcuts")
    : t("shell.showConfigurationShortcuts")

  useEffect(() => {
    if (isConfigurationViewActive) {
      setIsConfigurationMenuOpen(true)
    }
  }, [isConfigurationViewActive])

  function handleConfigurationViewChange(view: LeftSidebarView) {
    setIsConfigurationMenuOpen(true)
    onViewChange(view)
  }

  return (
    <aside className={railClassName} aria-label={side === "left" ? t("shell.primaryNavigationRail") : t("shell.inspectorRail")}>
      <div className="activity-rail-top-menu">
        <SidebarToggleButton
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={onToggleSidebar}
          side={side}
          variant="rail"
        />
      </div>
      <div className="activity-rail-primary">
        {side === "left" ? (
          <div className="activity-rail-view-stack" aria-label={t("shell.primaryViews")}>
            {primaryLeftRailViews.map(({ view, labelKey, Icon }) => {
              const isActive = activeView === view
              const label = t(labelKey as TranslationKey)

              return (
                <ActivityRailViewButton
                  key={view}
                  Icon={Icon}
                  isActive={isActive}
                  label={label}
                  onClick={() => onViewChange(view)}
                />
              )
            })}
          </div>
        ) : null}
      </div>
      {side === "left" ? (
        <div className="activity-rail-footer">
          <div className="activity-rail-config" aria-label={t("shell.configurationViews")}>
            <div id={configurationMenuID} className="activity-rail-config-stack" hidden={!isConfigurationMenuOpen}>
              {configurationLeftRailViews.map(({ view, labelKey, Icon }) => {
                const isActive = activeView === view
                const label = t(labelKey as TranslationKey)

                return (
                  <ActivityRailViewButton
                    key={view}
                    className="activity-rail-config-button"
                    Icon={Icon}
                    isActive={isActive}
                    label={label}
                    onClick={() => handleConfigurationViewChange(view)}
                  />
                )
              })}
            </div>
            <button
              className={[
                "activity-rail-view-button",
                "activity-rail-config-toggle",
                isConfigurationMenuOpen ? "is-expanded" : "is-collapsed",
                isConfigurationViewActive ? "is-active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-controls={configurationMenuID}
              aria-expanded={isConfigurationMenuOpen}
              aria-label={configurationToggleLabel}
              title={configurationToggleLabel}
              type="button"
              onClick={() => setIsConfigurationMenuOpen((nextValue) => !nextValue)}
            >
              <ConfigurationToggleIcon />
            </button>
          </div>
          {bottomSlotRef ? <div ref={bottomSlotRef} className="activity-rail-bottom" /> : null}
          {onOpenSettings ? (
            <button
              className={joinClassNames("activity-rail-view-button", "activity-rail-settings", isSettingsOpen && "is-active")}
              aria-label={t("shell.openSettings")}
              aria-pressed={isSettingsOpen}
              title={t("shell.openSettings")}
              type="button"
              onClick={onOpenSettings}
            >
              <SettingsIcon />
            </button>
          ) : null}
        </div>
      ) : bottomSlotRef ? (
        <div ref={bottomSlotRef} className="activity-rail-bottom" />
      ) : null}
    </aside>
  )
}
