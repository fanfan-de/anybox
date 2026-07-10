import { RefreshCw, Settings2 } from "lucide-react"
import type { CinemaRenderJob } from "@anybox/shared/cinema-render"
import { renderStatusLabel } from "../model/renderStatus"

export function DeliverTopbar({
  timelineTitle,
  job,
  technicalPreview,
  preflightReady,
  createPending,
  settingsOpen,
  onStart,
  onToggleSettings,
  onRefresh,
}: {
  timelineTitle?: string
  job?: CinemaRenderJob
  technicalPreview?: boolean
  preflightReady: boolean
  createPending: boolean
  settingsOpen: boolean
  onStart: () => void
  onToggleSettings: () => void
  onRefresh: () => void
}) {
  const status = job ? renderStatusLabel(job.status) : preflightReady ? "Ready to render" : "Preflight required"
  return (
    <header className="cinema-deliver-topbar">
      <div className="cinema-deliver-title-block">
        <span className="cinema-deliver-eyebrow">{technicalPreview ? "Deliver technical preview" : "Deliver"}</span>
        <h1 title={timelineTitle ?? "No Timeline selected"}>{timelineTitle ?? "Select a Timeline"}</h1>
        <span className="cinema-deliver-status-text" role="status">{status}</span>
      </div>
      <div className="cinema-deliver-topbar-actions">
        <button
          type="button"
          className="cinema-deliver-icon-button"
          aria-label="Refresh delivery data"
          title="Refresh delivery data"
          onClick={onRefresh}
        >
          <RefreshCw size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`cinema-deliver-icon-button ${settingsOpen ? "is-active" : ""}`}
          aria-label="Toggle render settings"
          aria-expanded={settingsOpen}
          title="Render settings"
          onClick={onToggleSettings}
        >
          <Settings2 size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="cinema-deliver-primary-button"
          disabled={!preflightReady || createPending}
          aria-busy={createPending}
          onClick={onStart}
        >
          Start render
        </button>
      </div>
    </header>
  )
}
