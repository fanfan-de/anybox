import { RefreshCw, Settings2 } from "lucide-react"
import type { CinemaRenderJob } from "@anybox/shared/cinema-render"
import { renderStatusLabel } from "../model/renderStatus"
import { useI18n } from "../../../i18n"

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
  const { t } = useI18n()
  const status = job ? renderStatusLabel(job.status) : t(preflightReady ? "deliver.ready" : "deliver.preflightRequired")
  return (
    <header className="cinema-deliver-topbar">
      <div className="cinema-deliver-title-block">
        <span className="cinema-deliver-eyebrow">{t(technicalPreview ? "deliver.beta" : "deliver.title")}</span>
        <h1 title={timelineTitle ?? t("deliver.noTimeline")}>{timelineTitle ?? t("deliver.selectTimeline")}</h1>
        <span className="cinema-deliver-status-text" role="status">{status}</span>
      </div>
      <div className="cinema-deliver-topbar-actions">
        <button
          type="button"
          className="cinema-deliver-icon-button"
          aria-label={t("deliver.refresh")}
          title={t("deliver.refresh")}
          onClick={onRefresh}
        >
          <RefreshCw size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`cinema-deliver-icon-button ${settingsOpen ? "is-active" : ""}`}
          aria-label={t("deliver.toggleSettings")}
          aria-expanded={settingsOpen}
          title={t("deliver.renderSettings")}
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
          {t("deliver.start")}
        </button>
      </div>
    </header>
  )
}
