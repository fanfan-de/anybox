import { useMemo, useState, type ReactNode } from "react"
import {
  CloseIcon,
  ConnectedStatusIcon,
  CopyIcon,
  DeleteIcon,
  DisconnectedStatusIcon,
  OpenExternalIcon,
  SearchIcon,
} from "../icons"
import { ShellTopMenu, writeTextToClipboard } from "../shared-ui"
import type {
  ConnectorDefinition,
  ConnectorStatus,
} from "../types"

interface ConnectorsPageProps {
  activeConnectorID: string | null
  connectorApiKeyDrafts: Record<string, string>
  connectorCatalog: ConnectorDefinition[]
  connectorConfigDrafts: Record<string, Record<string, string>>
  connectorStatuses: ConnectorStatus[]
  connectorsError: string | null
  diagnosingConnectorID: string | null
  isLoading: boolean
  savingConnectorID: string | null
  hideTopMenu?: boolean
  searchQuery?: string
  windowControls?: ReactNode
  onCancelConnectorAuthFlow: (connectorID: string) => boolean | Promise<boolean>
  onConnectorApiKeyDraftChange: (connectorID: string, value: string) => void
  onConnectorConfigDraftChange: (connectorID: string, key: string, value: string) => void
  onConnectorSelect: (connectorID: string) => void
  onDeleteConnectorApiKey: (connectorID: string) => boolean | Promise<boolean>
  onDeleteConnectorConfig: (connectorID: string) => boolean | Promise<boolean>
  onDeleteConnectorAuthSession: (connectorID: string) => boolean | Promise<boolean>
  onDiagnoseConnector: (connectorID: string) => boolean | Promise<boolean>
  onSaveConnectorApiKey: (connectorID: string) => boolean | Promise<boolean>
  onSaveConnectorConfig: (connectorID: string) => boolean | Promise<boolean>
  onStartConnectorAuthFlow: (connectorID: string) => boolean | Promise<boolean>
  onSearchQueryChange?: (value: string) => void
}

function fallbackConnectorID(definitionID: string) {
  return `connector:${definitionID}:default`
}

function connectorIDForDefinition(definition: ConnectorDefinition, statuses: ConnectorStatus[]) {
  return statuses.find((status) => status.definitionID === definition.id)?.connectorID ?? fallbackConnectorID(definition.id)
}

function connectorStatusForDefinition(definition: ConnectorDefinition, statuses: ConnectorStatus[]) {
  return statuses.find((status) => status.definitionID === definition.id)
}

function connectorStatusLabel(status: ConnectorStatus | undefined, definition?: ConnectorDefinition) {
  if (status?.authStatus === "pending") return "Signing in"
  if (status?.authStatus === "expired") return "Expired"
  if (status?.authStatus === "error") return "Error"
  if (status?.authStatus === "unavailable" || definition?.available === false) return "Unavailable"
  if (status?.connected) return "Connected"
  return "Not connected"
}

function connectorStatusClassName(status: ConnectorStatus | undefined, definition?: ConnectorDefinition) {
  if (status?.connected) return "is-connected"
  if (status?.authStatus === "pending") return "is-pending"
  if (status?.authStatus === "error" || status?.authStatus === "expired") return "is-error"
  if (status?.authStatus === "unavailable" || definition?.available === false) return "is-unavailable"
  return "is-disconnected"
}

function credentialKindLabel(definition: ConnectorDefinition, status?: ConnectorStatus) {
  const kind = status?.credentialKind ?? definition.credential?.kind
  if (kind === "oauth") return "OAuth"
  if (kind === "api_key") return "API key"
  return "None"
}

function toolSummary(definition: ConnectorDefinition) {
  return definition.tools.length > 0
    ? definition.tools.map((tool) => tool.title ?? tool.name).join(", ")
    : "Declared by connector runtime"
}

function permissionSummary(definition: ConnectorDefinition) {
  return definition.permissions.length > 0 ? definition.permissions.join(", ") : "No extra permissions declared"
}

function isImageIcon(icon: string) {
  return /^(https?:\/\/|data:image\/)/.test(icon)
}

function connectorInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return "CN"
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase()
}

function ConnectorMark({ definition }: { definition: ConnectorDefinition }) {
  const icon = definition.icon?.trim()

  return (
    <span className="connectors-icon-mark" aria-hidden="true">
      {icon && isImageIcon(icon) ? (
        <img src={icon} alt="" />
      ) : icon && icon.length <= 4 ? (
        <span>{icon}</span>
      ) : (
        <span>{connectorInitials(definition.name)}</span>
      )}
    </span>
  )
}

function doesConnectorMatchSearch(definition: ConnectorDefinition, rawQuery: string) {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return true

  return [
    definition.id,
    definition.name,
    definition.description,
    definition.publisher,
    definition.risk,
    definition.permissions.join(" "),
    definition.tools.map((tool) => `${tool.name} ${tool.title ?? ""}`).join(" "),
  ]
    .join(" ")
    .toLowerCase()
    .includes(query)
}

export function ConnectorsPage({
  activeConnectorID,
  connectorApiKeyDrafts,
  connectorCatalog,
  connectorConfigDrafts,
  connectorStatuses,
  connectorsError,
  diagnosingConnectorID,
  hideTopMenu = false,
  isLoading,
  savingConnectorID,
  searchQuery,
  windowControls,
  onCancelConnectorAuthFlow,
  onConnectorApiKeyDraftChange,
  onConnectorConfigDraftChange,
  onConnectorSelect,
  onDeleteConnectorApiKey,
  onDeleteConnectorConfig,
  onDeleteConnectorAuthSession,
  onDiagnoseConnector,
  onSaveConnectorApiKey,
  onSaveConnectorConfig,
  onSearchQueryChange,
  onStartConnectorAuthFlow,
}: ConnectorsPageProps) {
  const [localSearchQuery, setLocalSearchQuery] = useState("")
  const [copiedCallbackURL, setCopiedCallbackURL] = useState(false)
  const hasExternalSearch = searchQuery !== undefined
  const effectiveSearchQuery = searchQuery ?? localSearchQuery
  const filteredConnectors = useMemo(
    () => connectorCatalog.filter((definition) => doesConnectorMatchSearch(definition, effectiveSearchQuery)),
    [connectorCatalog, effectiveSearchQuery],
  )
  const activeDefinition = activeConnectorID
    ? connectorCatalog.find((definition) => connectorIDForDefinition(definition, connectorStatuses) === activeConnectorID) ?? null
    : null
  const activeStatus = activeConnectorID
    ? connectorStatuses.find((status) => status.connectorID === activeConnectorID) ??
      (activeDefinition ? connectorStatusForDefinition(activeDefinition, connectorStatuses) : undefined)
    : undefined
  const activeCredential = activeDefinition?.credential
  const isBusy = Boolean(activeConnectorID && savingConnectorID === activeConnectorID)
  const isDiagnosing = Boolean(activeConnectorID && diagnosingConnectorID === activeConnectorID)
  const activeFlow = activeStatus?.activeFlow
  const hasPendingFlow = Boolean(activeFlow && ["pending", "waiting_user", "authorizing"].includes(activeFlow.status))
  const isUnavailable = activeDefinition?.available === false || activeStatus?.authStatus === "unavailable"
  const hasConfigFields = Boolean(activeDefinition && activeDefinition.configFields.length > 0)
  const activeConfigDraft = activeConnectorID ? connectorConfigDrafts[activeConnectorID] ?? {} : {}
  const isConfigReady = !hasConfigFields || Boolean(activeStatus?.configured)

  async function copyCallbackURL(url: string) {
    await writeTextToClipboard(url)
    setCopiedCallbackURL(true)
    window.setTimeout(() => setCopiedCallbackURL(false), 1600)
  }

  function handleSearchQueryChange(value: string) {
    if (!hasExternalSearch) {
      setLocalSearchQuery(value)
    }
    onSearchQueryChange?.(value)
  }

  return (
    <section className={hideTopMenu ? "connectors-page is-embedded" : "connectors-page"} aria-label="Connectors">
      {!hideTopMenu ? (
        <ShellTopMenu
          as="header"
          ariaLabel="Connectors top menu"
          className="canvas-region-top-menu connectors-top-menu"
          contentClassName="canvas-region-top-menu-tabs-shell"
          content={(
            <div className="prompt-presets-top-menu-label">
              <ConnectedStatusIcon />
              <span>Connectors</span>
            </div>
          )}
          dragRegion
          layout="three-column"
          trailing={windowControls}
          trailingClassName="prompt-presets-top-menu-window-controls"
        />
      ) : null}

      <div className="settings-page-main is-services connectors-page-main">
        {connectorsError ? <div className="settings-banner is-error">{connectorsError}</div> : null}

        {isLoading ? (
          <article className="settings-empty-state">
            <span className="label">Loading</span>
            <h3>Fetching connectors</h3>
            <p>Reading platform connector definitions and connection state.</p>
          </article>
        ) : (
          <section className="settings-services-layout connectors-page-layout" aria-label="Connector management layout">
            <div className="settings-service-list-panel connectors-list-panel">
              <section
                className={hasExternalSearch ? "sidebar-view connectors-sidebar is-search-external" : "sidebar-view connectors-sidebar"}
                aria-label="Connectors sidebar view"
              >
                {!hasExternalSearch ? (
                  <div className="skills-tree-search-row connectors-search-row" role="search">
                    <SearchIcon />
                    <input
                      aria-label="Search connectors"
                      type="search"
                      value={effectiveSearchQuery}
                      placeholder="Search connectors"
                      onChange={(event) => handleSearchQueryChange(event.target.value)}
                    />
                    {effectiveSearchQuery ? (
                      <button
                        aria-label="Clear connector search"
                        title="Clear search"
                        type="button"
                        onClick={() => handleSearchQueryChange("")}
                      >
                        <CloseIcon />
                      </button>
                    ) : null}
                  </div>
                ) : null}

                <div className="skills-tree-root connectors-list-stack" role="list" aria-label="Connectors">
                  {filteredConnectors.length > 0 ? (
                    filteredConnectors.map((definition) => {
                      const connectorID = connectorIDForDefinition(definition, connectorStatuses)
                      const status = connectorStatusForDefinition(definition, connectorStatuses)
                      const isActive = connectorID === activeConnectorID
                      const statusLabel = connectorStatusLabel(status, definition)

                      return (
                        <button
                          key={definition.id}
                          className={isActive ? "connectors-list-row is-active" : "connectors-list-row"}
                          type="button"
                          aria-label={`${definition.name} ${statusLabel}`}
                          aria-pressed={isActive}
                          onClick={() => onConnectorSelect(connectorID)}
                        >
                          <ConnectorMark definition={definition} />
                          <span className="connectors-list-copy">
                            <strong>{definition.name}</strong>
                            <span>{definition.publisher}</span>
                          </span>
                          <span className={`connectors-status-dot ${connectorStatusClassName(status, definition)}`} aria-hidden="true" />
                        </button>
                      )
                    })
                  ) : connectorCatalog.length > 0 ? (
                    <p className="skills-tree-empty">No connectors match this search.</p>
                  ) : (
                    <p className="skills-tree-empty">No platform connectors are registered.</p>
                  )}
                </div>
              </section>
            </div>

            <div className="settings-service-detail-panel connectors-detail-panel">
              {activeDefinition && activeConnectorID ? (
                <main className="connectors-detail-shell" aria-label={`${activeDefinition.name} connector details`}>
                  <section className="connectors-detail-header">
                    <ConnectorMark definition={activeDefinition} />
                    <div>
                      <div className={`connectors-status-badge ${connectorStatusClassName(activeStatus, activeDefinition)}`}>
                        {activeStatus?.connected ? <ConnectedStatusIcon /> : <DisconnectedStatusIcon />}
                        <span>{connectorStatusLabel(activeStatus, activeDefinition)}</span>
                      </div>
                      <h1>{activeDefinition.name}</h1>
                      <p>{activeDefinition.description}</p>
                    </div>
                  </section>

                  {hasConfigFields ? (
                    <section className="connectors-detail-section" aria-labelledby="connector-setup-title">
                      <h2 id="connector-setup-title">Setup</h2>
                      <div className="connectors-setup-panel">
                        <ol className="connectors-setup-steps">
                          <li>Create a custom app in Feishu Open Platform.</li>
                          <li>Copy the App ID and App Secret from Credentials & Basic Info.</li>
                          <li>Add the Anybox callback URL to the Feishu app redirect URL settings.</li>
                          <li>Save credentials here, then sign in with the Feishu account.</li>
                          <li>Enable the required Drive and Docx scopes before authorizing.</li>
                        </ol>
                        {activeDefinition.oauthCallbackURL ? (
                          <div className="connectors-callback-url-card">
                            <span>OAuth redirect URL</span>
                            <code>{activeDefinition.oauthCallbackURL}</code>
                            <button
                              className="connectors-action-button connectors-callback-copy-button is-secondary"
                              type="button"
                              aria-label="Copy OAuth redirect URL"
                              title={copiedCallbackURL ? "Copied" : "Copy OAuth redirect URL"}
                              onClick={() => void copyCallbackURL(activeDefinition.oauthCallbackURL!)}
                            >
                              <CopyIcon />
                              <span>{copiedCallbackURL ? "Copied" : "Copy"}</span>
                            </button>
                          </div>
                        ) : null}
                        <div className="connectors-config-fields">
                          {activeDefinition.configFields.map((field) => (
                            <label key={field.key} className="plugins-connector-key-field connectors-key-field">
                              <span>{field.label}</span>
                              <input
                                aria-label={field.label}
                                type={field.type === "password" ? "password" : "text"}
                                value={activeConfigDraft[field.key] ?? ""}
                                placeholder={field.placeholder ?? field.label}
                                onChange={(event) => onConnectorConfigDraftChange(activeConnectorID, field.key, event.target.value)}
                              />
                              {field.description ? <small>{field.description}</small> : null}
                            </label>
                          ))}
                        </div>
                        <div className="connectors-actions">
                          <button
                            className="connectors-action-button is-primary"
                            type="button"
                            disabled={isBusy}
                            onClick={() => void onSaveConnectorConfig(activeConnectorID)}
                          >
                            {isBusy ? "Saving..." : activeStatus?.configured ? "Update credentials" : "Save credentials"}
                          </button>
                          {activeStatus?.configured ? (
                            <button
                              className="connectors-action-button is-danger"
                              type="button"
                              disabled={isBusy}
                              onClick={() => void onDeleteConnectorConfig(activeConnectorID)}
                            >
                              <DeleteIcon />
                              <span>{isBusy ? "Clearing..." : "Clear credentials"}</span>
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </section>
                  ) : null}

                  <section className="connectors-detail-section" aria-labelledby="connector-auth-title">
                    <h2 id="connector-auth-title">Authentication</h2>
                    <div className="connectors-detail-table">
                      <div>
                        <span>Connector ID</span>
                        <strong>{activeConnectorID}</strong>
                      </div>
                      <div>
                        <span>Publisher</span>
                        <strong>{activeDefinition.publisher}</strong>
                      </div>
                      <div>
                        <span>Risk</span>
                        <strong>{activeDefinition.risk}</strong>
                      </div>
                      <div>
                        <span>Credential</span>
                        <strong>{activeStatus?.credentialLabel ?? activeCredential?.label ?? credentialKindLabel(activeDefinition, activeStatus)}</strong>
                      </div>
                      <div>
                        <span>Credential kind</span>
                        <strong>{credentialKindLabel(activeDefinition, activeStatus)}</strong>
                      </div>
                      {activeCredential?.kind === "oauth" ? (
                        <div>
                          <span>OAuth</span>
                          <strong>{hasConfigFields ? "Custom app stored locally" : `Managed by ${activeDefinition.publisher}`}</strong>
                        </div>
                      ) : null}
                      {activeStatus?.configurationLabel ? (
                        <div>
                          <span>Configuration</span>
                          <strong>{activeStatus.configurationLabel}</strong>
                        </div>
                      ) : null}
                      {activeStatus?.email ? (
                        <div>
                          <span>Account</span>
                          <strong>{activeStatus.email}</strong>
                        </div>
                      ) : null}
                      {activeStatus?.generatedMcpServerID ? (
                        <div>
                          <span>MCP server</span>
                          <strong>{activeStatus.generatedMcpServerID}</strong>
                        </div>
                      ) : null}
                    </div>

                    <div className="connectors-actions" aria-label={`${activeDefinition.name} connector actions`}>
                      {isUnavailable ? (
                        <span className="connectors-action-note">Connector runtime unavailable.</span>
                      ) : activeCredential?.kind === "oauth" ? (
                        <>
                          {hasPendingFlow ? (
                            <button
                              className="connectors-action-button is-secondary"
                              type="button"
                              disabled={isBusy}
                              onClick={() => void onCancelConnectorAuthFlow(activeConnectorID)}
                            >
                              {isBusy ? "Cancelling..." : "Cancel sign-in"}
                            </button>
                          ) : (
                            <button
                              className="connectors-action-button is-primary"
                              type="button"
                              disabled={isBusy || !isConfigReady}
                              onClick={() => void onStartConnectorAuthFlow(activeConnectorID)}
                            >
                              <OpenExternalIcon />
                              <span>{isBusy ? "Opening..." : activeStatus?.connected ? "Reconnect" : "Sign in"}</span>
                            </button>
                          )}
                          {activeStatus?.connected ? (
                            <button
                              className="connectors-action-button is-danger"
                              type="button"
                              disabled={isBusy}
                              onClick={() => void onDeleteConnectorAuthSession(activeConnectorID)}
                            >
                              <DeleteIcon />
                              <span>{isBusy ? "Disconnecting..." : "Disconnect"}</span>
                            </button>
                          ) : null}
                        </>
                      ) : activeCredential?.kind === "api_key" ? (
                        <>
                          <label className="plugins-connector-key-field connectors-key-field">
                            <span>{activeCredential.label}</span>
                            <input
                              aria-label={activeCredential.label}
                              type={activeCredential.type === "text" ? "text" : "password"}
                              value={connectorApiKeyDrafts[activeConnectorID] ?? ""}
                              placeholder={activeCredential.placeholder ?? "Enter API key"}
                              onChange={(event) => onConnectorApiKeyDraftChange(activeConnectorID, event.target.value)}
                            />
                          </label>
                          <button
                            className="connectors-action-button is-primary"
                            type="button"
                            disabled={isBusy}
                            onClick={() => void onSaveConnectorApiKey(activeConnectorID)}
                          >
                            {isBusy ? "Saving..." : "Update key"}
                          </button>
                          {activeStatus?.connected ? (
                            <button
                              className="connectors-action-button is-danger"
                              type="button"
                              disabled={isBusy}
                              onClick={() => void onDeleteConnectorApiKey(activeConnectorID)}
                            >
                              <DeleteIcon />
                              <span>{isBusy ? "Clearing..." : "Disconnect"}</span>
                            </button>
                          ) : null}
                        </>
                      ) : (
                        <span className="connectors-action-note">No credential required.</span>
                      )}

                      <button
                        className="connectors-action-button is-secondary"
                        type="button"
                        disabled={isDiagnosing || !isConfigReady}
                        onClick={() => void onDiagnoseConnector(activeConnectorID)}
                      >
                        {isDiagnosing ? "Checking..." : "Diagnose"}
                      </button>
                    </div>
                  </section>

                  <section className="connectors-detail-section" aria-labelledby="connector-capability-title">
                    <h2 id="connector-capability-title">Capabilities</h2>
                    <div className="connectors-detail-table">
                      <div>
                        <span>Tools</span>
                        <strong>{toolSummary(activeDefinition)}</strong>
                      </div>
                      <div>
                        <span>Permissions</span>
                        <strong>{permissionSummary(activeDefinition)}</strong>
                      </div>
                      <div>
                        <span>Source</span>
                        <strong>{activeDefinition.source}</strong>
                      </div>
                      {activeDefinition.credential?.kind === "oauth" && activeDefinition.credential.scopes.length > 0 ? (
                        <div>
                          <span>OAuth scopes</span>
                          <strong>{activeDefinition.credential.scopes.join(", ")}</strong>
                        </div>
                      ) : null}
                    </div>
                  </section>

                  {activeDefinition.installReview.length > 0 ? (
                    <section className="connectors-detail-section" aria-labelledby="connector-review-title">
                      <h2 id="connector-review-title">Review</h2>
                      <ul className="connectors-review-list">
                        {activeDefinition.installReview.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                </main>
              ) : (
                <article className="settings-empty-state">
                  <span className="label">Connectors</span>
                  <h3>Select a connector</h3>
                  <p>Choose a platform connector to manage authentication and diagnostics.</p>
                </article>
              )}
            </div>
          </section>
        )}
      </div>
    </section>
  )
}
