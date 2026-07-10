import { useEffect, useRef } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { CheckCircle2, CircleAlert, CircleStop, Clock3 } from "lucide-react"
import type { CinemaRenderJob } from "@anybox/shared/cinema-render"
import { renderStatusLabel } from "../model/renderStatus"

export const RENDER_HISTORY_VIRTUALIZATION_THRESHOLD = 100

export function shouldVirtualizeRenderHistory(jobCount: number): boolean {
  return jobCount > RENDER_HISTORY_VIRTUALIZATION_THRESHOLD
}

function JobIcon({ status }: { status: CinemaRenderJob["status"] }) {
  if (status === "succeeded") return <CheckCircle2 size={15} aria-hidden="true" />
  if (status === "failed") return <CircleAlert size={15} aria-hidden="true" />
  if (status === "canceled" || status === "interrupted") return <CircleStop size={15} aria-hidden="true" />
  return <Clock3 size={15} aria-hidden="true" />
}

export function RenderHistory({
  jobs,
  selectedJobID,
  onSelect,
}: {
  jobs: readonly CinemaRenderJob[]
  selectedJobID?: string
  onSelect: (job: CinemaRenderJob) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>())
  const pendingFocusIndexRef = useRef<number | null>(null)
  const shouldVirtualize = shouldVirtualizeRenderHistory(jobs.length)
  const tabStopJobID = selectedJobID && jobs.some((job) => job.id === selectedJobID)
    ? selectedJobID
    : jobs[0]?.id
  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? jobs.length : 0,
    getScrollElement: () => listRef.current,
    estimateSize: () => 38,
    overscan: 6,
    getItemKey: (index) => jobs[index]?.id ?? index,
  })
  const virtualRows = rowVirtualizer.getVirtualItems()

  useEffect(() => {
    const pendingIndex = pendingFocusIndexRef.current
    if (pendingIndex === null) return
    const job = jobs[pendingIndex]
    const button = job ? buttonRefs.current.get(job.id) : undefined
    if (!button) return
    pendingFocusIndexRef.current = null
    button.focus({ preventScroll: true })
  }, [jobs, virtualRows])

  const selectAndFocus = (index: number) => {
    const nextIndex = Math.max(0, Math.min(jobs.length - 1, index))
    const next = jobs[nextIndex]
    if (!next) return
    onSelect(next)
    if (!shouldVirtualize) {
      buttonRefs.current.get(next.id)?.focus()
      return
    }
    pendingFocusIndexRef.current = nextIndex
    rowVirtualizer.scrollToIndex(nextIndex, { align: "auto" })
    window.requestAnimationFrame(() => {
      const button = buttonRefs.current.get(next.id)
      if (!button) return
      pendingFocusIndexRef.current = null
      button.focus({ preventScroll: true })
    })
  }

  const renderJob = (job: CinemaRenderJob, index: number) => (
    <button
      key={job.id}
      ref={(element) => {
        if (element) buttonRefs.current.set(job.id, element)
        else buttonRefs.current.delete(job.id)
      }}
      type="button"
      role="option"
      tabIndex={job.id === tabStopJobID ? 0 : -1}
      aria-selected={job.id === selectedJobID}
      aria-posinset={index + 1}
      aria-setsize={jobs.length}
      className={`cinema-deliver-history-row ${job.id === selectedJobID ? "is-selected" : ""}`}
      data-job-option={job.id}
      onClick={() => onSelect(job)}
      onKeyDown={(event) => {
        const nextIndex = event.key === "ArrowDown"
          ? index + 1
          : event.key === "ArrowUp"
            ? index - 1
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? jobs.length - 1
                : null
        if (nextIndex === null) return
        event.preventDefault()
        selectAndFocus(nextIndex)
      }}
    >
      <span className={`cinema-deliver-history-icon is-${job.status}`}><JobIcon status={job.status} /></span>
      <span className="cinema-deliver-history-copy"><strong>{job.settings.outputName}.mp4</strong></span>
      <small className="cinema-deliver-history-meta">{renderStatusLabel(job.status)} · rev {job.timelineRevision}</small>
    </button>
  )

  return (
    <section className="cinema-deliver-history" aria-label="Render history">
      <div className="cinema-deliver-section-heading"><span>Render history</span><small>{jobs.length}</small></div>
      {jobs.length === 0 ? <p className="cinema-deliver-history-empty">No renders for this Timeline yet.</p> : (
        <div
          ref={listRef}
          className={`cinema-deliver-history-list ${shouldVirtualize ? "is-virtualized" : ""}`}
          role="listbox"
          aria-label="Render history jobs"
        >
          {shouldVirtualize ? (
            <div
              className="cinema-deliver-history-virtual-content"
              role="presentation"
              style={{ height: rowVirtualizer.getTotalSize() }}
            >
              {virtualRows.map((virtualRow) => (
                <div
                  key={virtualRow.key}
                  className="cinema-deliver-history-virtual-row"
                  role="presentation"
                  style={{
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {renderJob(jobs[virtualRow.index]!, virtualRow.index)}
                </div>
              ))}
            </div>
          ) : jobs.map(renderJob)}
        </div>
      )}
    </section>
  )
}
