import { PanelLeft, PanelRight } from "lucide-react"
import type { CinemaTimelineDocument } from "@anybox/shared/cinema-timeline"
import type { CinemaTimelineCommandQueueSnapshot } from "../state/TimelineCommandQueue"

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
  const saveLabel = save.status === "saving"
    ? `Saving${save.pendingCount > 1 ? ` ${save.pendingCount} changes` : ""}`
    : save.status === "error"
      ? "Save failed"
      : timeline ? "Saved" : ""

  return (
    <header className="cinema-edit-topbar">
      <button className="cinema-edit-toolbar-button cinema-edit-media-toggle" type="button" aria-label="Toggle media bin" title="Toggle media bin" onClick={onToggleMedia}>
        <PanelLeft aria-hidden="true" />
      </button>
      <div className="cinema-edit-title" title={timeline?.title}>
        <strong>{timeline?.title ?? "Edit"}</strong>
        {timeline ? <span>{timeline.settings.width}×{timeline.settings.height} · {timeline.settings.frameRate.numerator / timeline.settings.frameRate.denominator} fps</span> : null}
      </div>
      {timeline ? <span className={`cinema-edit-delivery-state ${deliveryReady ? "is-ready" : ""}`} title={deliveryMessage}>{deliveryReady ? "Ready to deliver" : deliveryMessage}</span> : null}
      <div className="cinema-edit-save-group">
        <span className={`cinema-edit-save-state is-${save.status}`} role="status" aria-live="polite">{saveLabel}</span>
        {save.status === "error" ? <button className="cinema-edit-retry-button" type="button" onClick={onRetry}>Retry</button> : null}
      </div>
      <button className="cinema-edit-toolbar-button cinema-edit-inspector-toggle" type="button" aria-label="Toggle inspector" title="Toggle inspector" onClick={onToggleInspector}>
        <PanelRight aria-hidden="true" />
      </button>
    </header>
  )
}
