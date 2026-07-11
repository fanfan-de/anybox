import { useEffect, useLayoutEffect, useRef, useState, type MouseEventHandler, type ReactNode } from "react"
import { Moon, Settings2, Sun, X } from "lucide-react"

export type CinemaWorkspaceID = "create" | "edit" | "deliver"
type CinemaThemePreference = "light" | "dark"

const CINEMA_THEME_STORAGE_KEY = "cinema-theme"

const CINEMA_THEME_OPTIONS: ReadonlyArray<{
  id: CinemaThemePreference
  label: string
  icon: typeof Sun
}> = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
]

const CINEMA_WORKSPACES: ReadonlyArray<{
  id: CinemaWorkspaceID
  label: string
}> = [
  { id: "create", label: "Create" },
  { id: "edit", label: "Edit" },
  { id: "deliver", label: "Deliver" },
]

function readThemePreference(): CinemaThemePreference {
  try {
    const stored = window.localStorage.getItem(CINEMA_THEME_STORAGE_KEY)
    return stored === "light" ? "light" : "dark"
  } catch {
    return "dark"
  }
}

function CinemaSettingsControl() {
  const [theme, setTheme] = useState<CinemaThemePreference>(readThemePreference)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const controlRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

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

  return (
    <div className="cinema-settings-control" ref={controlRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`cinema-settings-trigger ${settingsOpen ? "is-active" : ""}`}
        aria-label="Open settings"
        aria-haspopup="dialog"
        aria-expanded={settingsOpen}
        aria-controls="cinema-settings-panel"
        title="Settings"
        onClick={() => setSettingsOpen((open) => !open)}
      >
        <Settings2 size={16} aria-hidden="true" />
      </button>
      {settingsOpen ? (
        <section
          id="cinema-settings-panel"
          className="cinema-settings-panel"
          role="dialog"
          aria-label="Cinema settings"
        >
          <header className="cinema-settings-panel-header">
            <strong>Settings</strong>
            <button
              type="button"
              className="cinema-settings-close"
              aria-label="Close settings"
              title="Close settings"
              onClick={() => {
                setSettingsOpen(false)
                triggerRef.current?.focus()
              }}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </header>
          <div className="cinema-settings-row">
            <div className="cinema-settings-row-copy">
              <strong>Appearance</strong>
              <span>Choose the Cinema interface theme.</span>
            </div>
            <div className="cinema-settings-theme-options" role="radiogroup" aria-label="Interface theme">
              {CINEMA_THEME_OPTIONS.map((option) => {
                const Icon = option.icon
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    className={`cinema-settings-theme-option ${theme === option.id ? "is-active" : ""}`}
                    aria-checked={theme === option.id}
                    onClick={() => setTheme(option.id)}
                  >
                    <Icon size={15} aria-hidden="true" />
                    <span>{option.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  )
}

export function CinemaWorkbenchShell({
  projectName,
  activeWorkspace,
  onWorkspaceChange,
  availableWorkspaces,
  onClick,
  children,
}: {
  projectName: string
  activeWorkspace: CinemaWorkspaceID
  onWorkspaceChange: (workspace: CinemaWorkspaceID) => void
  availableWorkspaces?: Partial<Record<CinemaWorkspaceID, boolean>>
  onClick?: MouseEventHandler<HTMLElement>
  children: ReactNode
}) {
  const activeDefinition = CINEMA_WORKSPACES.find((workspace) => workspace.id === activeWorkspace)
    ?? CINEMA_WORKSPACES[0]

  return (
    <main className="cinema-shell is-workbench" onClick={onClick}>
      <header className="cinema-workbench-header">
        <CinemaSettingsControl />
        <nav className="cinema-workbench-tabs" role="tablist" aria-label="Cinema 工作台">
          {CINEMA_WORKSPACES.map((workspace) => {
            const available = workspace.id === "create" || availableWorkspaces?.[workspace.id] === true
            const selected = workspace.id === activeDefinition.id
            const tabID = `cinema-workbench-${workspace.id}-tab`
            const panelID = `cinema-workbench-${workspace.id}-panel`
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
                title={available ? `${workspace.label} 工作台` : `${workspace.label} 工作台即将开放`}
                onClick={() => {
                  if (available && !selected) onWorkspaceChange(workspace.id)
                }}
              >
                <span>{workspace.label}</span>
                {!available ? <small>Soon</small> : null}
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
