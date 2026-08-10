import { PanelLeft, PanelRight } from "lucide-react"
import type { CinemaTimelineDocument } from "@anybox/cinema-plugin/contracts/timeline"
import type { CinemaTimelineCommandQueueSnapshot } from "../state/TimelineCommandQueue"
import { useI18n } from "../../../i18n"

export function EditTopbar({
  timeline,
  save,
  onToggleMedia,
  onToggleInspector,
  onRetry,
  deliveryReady,
  deliveryMessage,
}: {
  timeline: CinemaTimelineDocument | null
  save: CinemaTimelineCommandQueueSnapshot
  onToggleMedia: () => void
  onToggleInspector: () => void
  onRetry: () => void
  deliveryReady: boolean
  deliveryMessage: string
}) {
  const { t } = useI18n()
  const saveLabel = save.status === "saving"
    ? save.pendingCount > 1 ? t("save.savingCount", { count: save.pendingCount }) : t("save.saving")
    : save.status === "error"
      ? t("save.error")
      : timeline ? t("save.saved") : ""

  return (
    <header className="cinema-edit-topbar">
      <button className="cinema-edit-toolbar-button cinema-edit-media-toggle" type="button" aria-label={t("edit.toggleMedia")} title={t("edit.toggleMedia")} onClick={onToggleMedia}>
        <PanelLeft aria-hidden="true" />
      </button>
      <div className="cinema-edit-title" title={timeline?.title}>
        <strong>{timeline?.title ?? t("edit.title")}</strong>
        {timeline ? <span>{timeline.settings.width}×{timeline.settings.height} · {timeline.settings.frameRate.numerator / timeline.settings.frameRate.denominator} fps</span> : null}
      </div>
      {timeline ? <span className={`cinema-edit-delivery-state ${deliveryReady ? "is-ready" : ""}`} title={deliveryMessage}>{deliveryReady ? t("edit.readyToDeliver") : deliveryMessage}</span> : null}
      <div className="cinema-edit-save-group">
        <span className={`cinema-edit-save-state is-${save.status}`} role="status" aria-live="polite">{saveLabel}</span>
        {save.status === "error" ? <button className="cinema-edit-retry-button" type="button" onClick={onRetry}>{t("edit.retry")}</button> : null}
      </div>
      <button className="cinema-edit-toolbar-button cinema-edit-inspector-toggle" type="button" aria-label={t("edit.toggleInspector")} title={t("edit.toggleInspector")} onClick={onToggleInspector}>
        <PanelRight aria-hidden="true" />
      </button>
    </header>
  )
}
