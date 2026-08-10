import { AlertTriangle, CheckCircle2 } from "lucide-react"
import type { CinemaRenderJob } from "@anybox/cinema-plugin/contracts/render"
import { isRenderActive, renderProgressPercent, renderStatusLabel } from "../model/renderStatus"

function renderDiagnosticSummary(job: CinemaRenderJob) {
  const summary = job.error?.diagnosticSummary
  if (!summary) return undefined
  if (!summary.runtime) return `Phase: ${summary.phase}. Runtime was not bound.`
  return `Phase: ${summary.phase}. Runtime: ${summary.runtime.runtimeID} · ${summary.runtime.platform} · ${summary.runtime.videoEncoder}/${summary.runtime.audioEncoder} · FFmpeg ${summary.runtime.ffmpegVersion}.`
}

export function RenderProgress({
  job,
  actionPending,
  onCancel,
  onRetry,
  onNewRender,
  currentTimelineRevision,
  latestRenderReady,
  onRenderLatest,
}: {
  job?: CinemaRenderJob
  actionPending: boolean
  onCancel: () => void
  onRetry: () => void
  onNewRender: () => void
  currentTimelineRevision?: number
  latestRenderReady?: boolean
  onRenderLatest?: () => void
}) {
  if (!job) return null
  const percent = renderProgressPercent(job)
  const revisionChanged = currentTimelineRevision !== undefined
    && currentTimelineRevision !== job.timelineRevision
  const revisionContext = revisionChanged
    ? ` This job uses Timeline revision ${job.timelineRevision}; the current Timeline is revision ${currentTimelineRevision}.`
    : ""
  const retryLabel = revisionChanged ? `Retry revision ${job.timelineRevision}` : "Retry"
  const diagnosticSummary = renderDiagnosticSummary(job)
  const newRenderAction = revisionChanged && onRenderLatest ? (
    <button
      type="button"
      className="cinema-deliver-secondary-button"
      disabled={actionPending || !latestRenderReady}
      onClick={onRenderLatest}
    >
      Render revision {currentTimelineRevision}
    </button>
  ) : (
    <button type="button" className="cinema-deliver-secondary-button" disabled={actionPending} onClick={onNewRender}>Start a new render</button>
  )
  return (
    <section className={`cinema-render-progress is-${job.status}`} aria-label="Render progress">
      <div className="cinema-render-progress-heading">
        <div>
          <span className="cinema-deliver-eyebrow">Render job</span>
          <strong>{renderStatusLabel(job.status)}</strong>
        </div>
        {isRenderActive(job.status) ? (
          <button type="button" className="cinema-deliver-danger-button" disabled={actionPending} onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
      {percent !== undefined ? (
        <div className="cinema-render-progress-track" role="progressbar" aria-label={`${renderStatusLabel(job.status)} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <span style={{ width: `${percent}%` }} />
        </div>
      ) : isRenderActive(job.status) ? <div className="cinema-render-progress-indeterminate" aria-hidden="true" /> : null}
      <div className="cinema-render-progress-meta">
        <span role="status">{job.progress.message ?? renderStatusLabel(job.status)}</span>
        {percent !== undefined ? <strong>{percent}%</strong> : null}
      </div>
      {job.status === "failed" ? (
        <div className="cinema-render-next-step is-error">
          <AlertTriangle size={16} aria-hidden="true" />
          <span role="alert">
            <span><strong>{job.error?.code ?? "render-failed"}</strong>: {job.error?.message ?? "The render failed."}{revisionContext}</span>
            {diagnosticSummary ? <span className="cinema-render-diagnostic-summary">{diagnosticSummary}</span> : null}
          </span>
          {job.error?.retryable ? <button type="button" className="cinema-deliver-secondary-button" disabled={actionPending} onClick={onRetry}>{retryLabel}</button> : null}
          {newRenderAction}
        </div>
      ) : null}
      {job.status === "canceled" || job.status === "interrupted" ? (
        <div className="cinema-render-next-step">
          <span role="status">
            <span>{job.status === "interrupted" && job.error
              ? <><strong>{job.error.code}</strong>: {job.error.message}</>
              : job.status === "interrupted" ? "The Agent stopped before this render finished." : "This render was canceled."}{revisionContext}</span>
            {diagnosticSummary ? <span className="cinema-render-diagnostic-summary">{diagnosticSummary}</span> : null}
          </span>
          {job.status === "interrupted" ? <button type="button" className="cinema-deliver-secondary-button" disabled={actionPending} onClick={onRetry}>{retryLabel}</button> : null}
          {newRenderAction}
        </div>
      ) : null}
      {job.status === "succeeded" ? (
        <div className="cinema-render-next-step is-success"><CheckCircle2 size={16} aria-hidden="true" /><span role="status">Output verified and registered in Assets.</span><button type="button" className="cinema-deliver-secondary-button" onClick={onNewRender}>Render again</button></div>
      ) : null}
    </section>
  )
}
