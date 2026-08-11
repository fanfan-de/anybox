import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEventHandler, type ReactNode } from "react"
import { Film, Moon, Settings2, Sun, X } from "lucide-react"
import { SUPPORTED_LOCALES, useI18n, type TranslationKey } from "../../i18n"
import { CinemaProviderSettings } from "./CinemaProviderSettings"
import { isCinemaProviderID, type CinemaProviderID } from "./cinemaProviderSettingsApi"

export type CinemaWorkspaceID = "create" | "edit" | "deliver"
type CinemaThemePreference = "light" | "dark"

const CINEMA_THEME_STORAGE_KEY = "cinema-theme"

const CINEMA_THEME_OPTIONS: ReadonlyArray<{
  id: CinemaThemePreference
  labelKey: TranslationKey
  icon: typeof Sun
}> = [
  { id: "light", labelKey: "settings.theme.light", icon: Sun },
  { id: "dark", labelKey: "settings.theme.dark", icon: Moon },
]

const CINEMA_WORKSPACES: ReadonlyArray<{
  id: CinemaWorkspaceID
  labelKey: TranslationKey
}> = [
  { id: "create", labelKey: "workspace.create" },
  { id: "edit", labelKey: "workspace.edit" },
  { id: "deliver", labelKey: "workspace.deliver" },
]

const CINEMA_SETTINGS_VIEWS = ["general", "providers"] as const

function readThemePreference(): CinemaThemePreference {
  try {
    const stored = window.localStorage.getItem(CINEMA_THEME_STORAGE_KEY)
    return stored === "light" ? "light" : "dark"
  } catch {
    return "dark"
  }
}

function CinemaSettingsControl({
  agentBaseURL,
  onProviderConfigurationChanged,
}: {
  agentBaseURL: string
  onProviderConfigurationChanged?: () => void | Promise<void>
}) {
  const { locale, setLocale, t } = useI18n()
  const [theme, setTheme] = useState<CinemaThemePreference>(readThemePreference)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsView, setSettingsView] = useState<"general" | "providers">("general")
  const [requestedProviderID, setRequestedProviderID] = useState<CinemaProviderID>("comfyui-local")
  const controlRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  function handleSettingsTabKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentView: typeof CINEMA_SETTINGS_VIEWS[number],
  ) {
    const currentIndex = CINEMA_SETTINGS_VIEWS.indexOf(currentView)
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? CINEMA_SETTINGS_VIEWS.length - 1
        : event.key === "ArrowRight"
          ? (currentIndex + 1) % CINEMA_SETTINGS_VIEWS.length
          : event.key === "ArrowLeft"
            ? (currentIndex - 1 + CINEMA_SETTINGS_VIEWS.length) % CINEMA_SETTINGS_VIEWS.length
            : -1
    if (nextIndex < 0) return
    event.preventDefault()
    const nextView = CINEMA_SETTINGS_VIEWS[nextIndex]!
    setSettingsView(nextView)
    document.getElementById(`cinema-settings-${nextView}-tab`)?.focus()
  }

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme

    try {
      window.localStorage.setItem(CINEMA_THEME_STORAGE_KEY, theme)
    } catch {
      // Theme selection still applies for the current page when storage is unavailable.
    }
  }, [theme])

  useEffect(() => {
    if (!settingsOpen) return

    function handlePointerDown(event: PointerEvent) {
      if (controlRef.current?.contains(event.target as Node)) return
      setSettingsOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      setSettingsOpen(false)
      triggerRef.current?.focus()
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [settingsOpen])

  useEffect(() => {
    function handleProviderSettingsRequest(event: MessageEvent) {
      const message = event.data as { type?: unknown; providerID?: unknown } | null
      if (!message || message.type !== "anybox:open-cinema-provider-settings" || !isCinemaProviderID(message.providerID)) return
      setRequestedProviderID(message.providerID)
      setSettingsView("providers")
      setSettingsOpen(true)
    }

    window.addEventListener("message", handleProviderSettingsRequest)
    return () => window.removeEventListener("message", handleProviderSettingsRequest)
  }, [])

  return (
    <div className="cinema-settings-control" ref={controlRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`cinema-settings-trigger ${settingsOpen ? "is-active" : ""}`}
        aria-label={t("settings.open")}
        aria-haspopup="dialog"
        aria-expanded={settingsOpen}
        aria-controls="cinema-settings-panel"
        title={t("settings.title")}
        onClick={() => setSettingsOpen((open) => !open)}
      >
        <Settings2 size={16} aria-hidden="true" />
      </button>
      {settingsOpen ? (
        <section
          id="cinema-settings-panel"
          className={`cinema-settings-panel ${settingsView === "providers" ? "is-providers" : ""}`}
          role="dialog"
          aria-label={t("settings.dialog")}
        >
          <header className="cinema-settings-panel-header">
            <strong>{t("settings.title")}</strong>
            <button
              type="button"
              className="cinema-settings-close"
              aria-label={t("settings.close")}
              title={t("settings.close")}
              onClick={() => {
                setSettingsOpen(false)
                triggerRef.current?.focus()
              }}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </header>
          <div className="cinema-settings-tabs" role="tablist" aria-label={t("settings.sections")}>
            {CINEMA_SETTINGS_VIEWS.map((view) => (
              <button
                key={view}
                id={`cinema-settings-${view}-tab`}
                type="button"
                role="tab"
                className={settingsView === view ? "is-active" : ""}
                aria-controls={`cinema-settings-${view}-panel`}
                aria-selected={settingsView === view}
                tabIndex={settingsView === view ? 0 : -1}
                onClick={() => setSettingsView(view)}
                onKeyDown={(event) => handleSettingsTabKeyDown(event, view)}
              >
                {t(view === "general" ? "settings.section.general" : "settings.section.providers")}
              </button>
            ))}
          </div>
          {settingsView === "general" ? (
            <div
              id="cinema-settings-general-panel"
              role="tabpanel"
              aria-labelledby="cinema-settings-general-tab"
            >
              <div className="cinema-settings-row">
                <div className="cinema-settings-row-copy">
                  <strong>{t("settings.appearance")}</strong>
                  <span>{t("settings.appearanceDescription")}</span>
                </div>
                <div className="cinema-settings-choice-options" role="radiogroup" aria-label={t("settings.theme")}>
                  {CINEMA_THEME_OPTIONS.map((option) => {
                    const Icon = option.icon
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="radio"
                        className={`cinema-settings-choice-option ${theme === option.id ? "is-active" : ""}`}
                        aria-checked={theme === option.id}
                        onClick={() => setTheme(option.id)}
                      >
                        <Icon size={15} aria-hidden="true" />
                        <span>{t(option.labelKey)}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="cinema-settings-row">
                <div className="cinema-settings-row-copy">
                  <strong>{t("settings.language")}</strong>
                  <span>{t("settings.languageDescription")}</span>
                </div>
                <div className="cinema-settings-choice-options" role="radiogroup" aria-label={t("settings.languageOptions")}>
                  {SUPPORTED_LOCALES.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      className={`cinema-settings-choice-option ${locale === option.id ? "is-active" : ""}`}
                      aria-checked={locale === option.id}
                      onClick={() => setLocale(option.id)}
                    >
                      <span>{option.nativeLabel}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div
              id="cinema-settings-providers-panel"
              role="tabpanel"
              aria-labelledby="cinema-settings-providers-tab"
            >
              <CinemaProviderSettings
                initialProviderID={requestedProviderID}
                agentBaseURL={agentBaseURL}
                onConfigurationChanged={onProviderConfigurationChanged}
              />
            </div>
          )}
        </section>
      ) : null}
    </div>
  )
}

export function CinemaWorkbenchShell({
  projectName,
  agentBaseURL,
  activeWorkspace,
  onWorkspaceChange,
  availableWorkspaces,
  onProviderConfigurationChanged,
  onClick,
  children,
}: {
  projectName: string
  agentBaseURL: string
  activeWorkspace: CinemaWorkspaceID
  onWorkspaceChange: (workspace: CinemaWorkspaceID) => void
  availableWorkspaces?: Partial<Record<CinemaWorkspaceID, boolean>>
  onProviderConfigurationChanged?: () => void | Promise<void>
  onClick?: MouseEventHandler<HTMLElement>
  children: ReactNode
}) {
  const { t } = useI18n()
  const activeDefinition = CINEMA_WORKSPACES.find((workspace) => workspace.id === activeWorkspace)
    ?? CINEMA_WORKSPACES[0]

  function handleWorkspaceTabKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentWorkspace: CinemaWorkspaceID,
  ) {
    const availableDefinitions = CINEMA_WORKSPACES.filter((workspace) => (
      workspace.id === "create" || availableWorkspaces?.[workspace.id] === true
    ))
    const currentIndex = availableDefinitions.findIndex((workspace) => workspace.id === currentWorkspace)
    if (currentIndex < 0 || availableDefinitions.length === 0) return
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? availableDefinitions.length - 1
        : event.key === "ArrowRight"
          ? (currentIndex + 1) % availableDefinitions.length
          : event.key === "ArrowLeft"
            ? (currentIndex - 1 + availableDefinitions.length) % availableDefinitions.length
            : -1
    if (nextIndex < 0) return
    event.preventDefault()
    const nextWorkspace = availableDefinitions[nextIndex]!
    if (nextWorkspace.id !== currentWorkspace) onWorkspaceChange(nextWorkspace.id)
    document.getElementById(`cinema-workbench-${nextWorkspace.id}-tab`)?.focus()
  }

  return (
    <main className="cinema-shell is-workbench" onClick={onClick}>
      <header className="cinema-workbench-header">
        <div className="cinema-workbench-leading">
          <CinemaSettingsControl
            agentBaseURL={agentBaseURL}
            onProviderConfigurationChanged={onProviderConfigurationChanged}
          />
          <div className="cinema-workbench-identity" title={projectName}>
            <Film size={14} aria-hidden="true" />
            <span>{projectName}</span>
          </div>
        </div>
        <nav className="cinema-workbench-tabs" role="tablist" aria-label={t("workspace.navigation")}>
          {CINEMA_WORKSPACES.map((workspace) => {
            const available = workspace.id === "create" || availableWorkspaces?.[workspace.id] === true
            const selected = workspace.id === activeDefinition.id
            const tabID = `cinema-workbench-${workspace.id}-tab`
            const panelID = `cinema-workbench-${workspace.id}-panel`
            const workspaceLabel = t(workspace.labelKey)
            return (
              <button
                key={workspace.id}
                id={tabID}
                type="button"
                role="tab"
                className={`cinema-workbench-tab ${selected ? "is-active" : ""}`}
                aria-controls={panelID}
                aria-selected={selected}
                aria-disabled={!available}
                disabled={!available}
                tabIndex={selected ? 0 : -1}
                title={t(available ? "workspace.availableTitle" : "workspace.unavailableTitle", { workspace: workspaceLabel })}
                onClick={() => {
                  if (available && !selected) onWorkspaceChange(workspace.id)
                }}
                onKeyDown={(event) => handleWorkspaceTabKeyDown(event, workspace.id)}
              >
                <span>{workspaceLabel}</span>
                {!available ? <small>{t("workspace.soon")}</small> : null}
              </button>
            )
          })}
        </nav>
        <div className="cinema-workbench-header-spacer" aria-hidden="true" />
      </header>
      <section
        id={`cinema-workbench-${activeDefinition.id}-panel`}
        className="cinema-workbench-panel"
        role="tabpanel"
        aria-labelledby={`cinema-workbench-${activeDefinition.id}-tab`}
      >
        {children}
      </section>
    </main>
  )
}
