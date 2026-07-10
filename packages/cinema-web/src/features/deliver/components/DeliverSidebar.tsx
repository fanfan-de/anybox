import { Film, ListVideo } from "lucide-react"
import type { CinemaTimelineDocument } from "@anybox/shared/cinema-timeline"

export function DeliverSidebar({
  timelines,
  selectedTimelineID,
  onSelectTimeline,
}: {
  timelines: readonly CinemaTimelineDocument[]
  selectedTimelineID: string | null
  onSelectTimeline: (timelineID: string) => void
}) {
  return (
    <aside className="cinema-deliver-sidebar" aria-label="Delivery timelines">
      <div className="cinema-deliver-section-heading">
        <span><ListVideo size={15} aria-hidden="true" /> Timelines</span>
        <small>{timelines.length}</small>
      </div>
      {timelines.length === 0 ? (
        <div className="cinema-deliver-sidebar-empty" role="status">
          <Film size={18} aria-hidden="true" />
          <span>Create a Timeline in Edit first.</span>
        </div>
      ) : (
        <div className="cinema-deliver-timeline-list" role="listbox" aria-label="Choose a Timeline">
          {timelines.map((timeline) => (
            <button
              key={timeline.id}
              type="button"
              role="option"
              aria-selected={timeline.id === selectedTimelineID}
              className={`cinema-deliver-timeline-row ${timeline.id === selectedTimelineID ? "is-selected" : ""}`}
              onClick={() => onSelectTimeline(timeline.id)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
                event.preventDefault()
                const index = timelines.findIndex((candidate) => candidate.id === timeline.id)
                const nextIndex = event.key === "ArrowDown"
                  ? Math.min(timelines.length - 1, index + 1)
                  : Math.max(0, index - 1)
                const next = timelines[nextIndex]
                if (next) {
                  onSelectTimeline(next.id)
                  const nextButton = [...document.querySelectorAll<HTMLButtonElement>("[data-timeline-option]")]
                    .find((candidate) => candidate.dataset.timelineOption === next.id)
                  nextButton?.focus()
                }
              }}
              data-timeline-option={timeline.id}
            >
              <span className="cinema-deliver-timeline-icon"><Film size={15} aria-hidden="true" /></span>
              <span className="cinema-deliver-timeline-copy">
                <strong title={timeline.title}>{timeline.title}</strong>
              </span>
              <small className="cinema-deliver-timeline-meta">Rev {timeline.revision}</small>
            </button>
          ))}
        </div>
      )}
    </aside>
  )
}
