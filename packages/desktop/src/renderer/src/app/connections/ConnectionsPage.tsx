import { type ReactNode } from "react"
import { CloseIcon, SearchIcon } from "../icons"
import { useI18n } from "../i18n/I18nProvider"
import type { TranslationKey } from "../i18n/translations"
import { joinClassNames, ShellTopMenu } from "../shared-ui"
import type { ConnectionsTab } from "../types"

interface ConnectionsPageProps {
  activeTab: ConnectionsTab
  children: ReactNode
  connectorCount: number
  mobileCount?: number
  mcpCount: number
  pluginCount: number
  sshCount?: number
  searchQuery: string
  windowControls?: ReactNode
  onSearchQueryChange: (value: string) => void
  onTabChange: (tab: ConnectionsTab) => void
}

const CONNECTION_TABS: Array<{
  key: ConnectionsTab
  labelKey: TranslationKey
}> = [
  { key: "plugins", labelKey: "connections.tabs.plugins" },
  { key: "connectors", labelKey: "connections.tabs.connectors" },
  { key: "mcp", labelKey: "connections.tabs.mcp" },
  { key: "ssh", labelKey: "connections.tabs.ssh" },
  { key: "mobile", labelKey: "connections.tabs.mobile" },
]

function getSearchPlaceholderKey(tab: ConnectionsTab): TranslationKey {
  if (tab === "connectors") return "connections.search.connectors"
  if (tab === "mcp") return "connections.search.mcp"
  if (tab === "ssh") return "connections.search.ssh"
  if (tab === "mobile") return "connections.search.mobile"
  return "connections.search.plugins"
}

export function ConnectionsPage({
  activeTab,
  children,
  connectorCount,
  mobileCount = 1,
  mcpCount,
  pluginCount,
  sshCount = 0,
  searchQuery,
  windowControls,
  onSearchQueryChange,
  onTabChange,
}: ConnectionsPageProps) {
  const { t } = useI18n()
  const searchPlaceholder = t(getSearchPlaceholderKey(activeTab))
  const tabCounts: Record<ConnectionsTab, number> = {
    plugins: pluginCount,
    connectors: connectorCount,
    mcp: mcpCount,
    ssh: sshCount,
    mobile: mobileCount,
  }

  return (
    <section className="connections-page" aria-label={t("connections.title")}>
      <ShellTopMenu
        as="header"
        ariaLabel={t("connections.topMenu")}
        className="canvas-region-top-menu connections-top-menu"
        contentClassName="connections-top-menu-content"
        content={(
          <div className="connections-top-menu-inner">
            <nav className="top-menu-segment-list connections-tab-list" role="tablist" aria-label={t("connections.categories")}>
              {CONNECTION_TABS.map((tab) => {
                const isActive = activeTab === tab.key
                const label = t(tab.labelKey)

                return (
                  <button
                    key={tab.key}
                    className={joinClassNames("top-menu-segment connections-tab", isActive ? "is-active" : null)}
                    type="button"
                    role="tab"
                    aria-label={`${label} ${tabCounts[tab.key]}`}
                    aria-selected={isActive}
                    aria-controls="connections-tab-panel"
                    onClick={() => onTabChange(tab.key)}
                  >
                    <span>{label}</span>
                    <small>{tabCounts[tab.key]}</small>
                  </button>
                )
              })}
            </nav>
          </div>
        )}
        dragRegion
        layout="three-column"
        trailing={windowControls}
        trailingClassName="prompt-presets-top-menu-window-controls"
      />

      <div id="connections-tab-panel" className="connections-page-main" role="tabpanel">
        <div className="connections-page-search-row">
          <label className="connections-search-control">
            <SearchIcon />
            <input
              aria-label={searchPlaceholder}
              type="search"
              value={searchQuery}
              placeholder={searchPlaceholder}
              onChange={(event) => onSearchQueryChange(event.target.value)}
            />
            {searchQuery ? (
              <button
                type="button"
                aria-label={t("connections.search.clear")}
                title={t("connections.search.clear")}
                onClick={() => onSearchQueryChange("")}
              >
                <CloseIcon />
              </button>
            ) : null}
          </label>
        </div>
        <div className="connections-page-content">
          {children}
        </div>
      </div>
    </section>
  )
}
