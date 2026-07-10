import type { MouseEventHandler, ReactNode } from "react"

export type CinemaWorkspaceID = "create" | "edit" | "deliver"

const CINEMA_WORKSPACES: ReadonlyArray<{
  id: CinemaWorkspaceID
  label: string
}> = [
  { id: "create", label: "Create" },
  { id: "edit", label: "Edit" },
  { id: "deliver", label: "Deliver" },
]

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
        <div className="cinema-workbench-identity" title={projectName}>
          <strong>Cinema</strong>
          <span>{projectName}</span>
        </div>
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
