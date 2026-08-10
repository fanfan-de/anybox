import { useEffect, useRef, useState } from "react"
import type { RenderApi } from "../api/renderApi"
import {
  CINEMA_RENDER_RETENTION_CONFIRMATION,
  type CinemaRenderRetentionResult,
} from "../model/renderRetention"
import { formatBytes } from "../model/renderStatus"

const DAY_MS = 24 * 60 * 60 * 1_000
const MAX_VISIBLE_CANDIDATES = 8
const MAX_VISIBLE_ISSUES = 3

const RETENTION_ISSUE_LABELS: Record<CinemaRenderRetentionResult["errors"][number]["code"], string> = {
  "render-root-unavailable": "Render storage could not be safely scanned.",
  "job-metadata-invalid": "A render job has invalid metadata.",
  "job-metadata-changed": "A render job changed during the scan.",
  "candidate-cleanup-failed": "A rebuildable file could not be safely processed.",
}

function retentionDurationMs(daysText: string) {
  if (!/^[1-9]\d*$/.test(daysText)) return null
  const days = Number(daysText)
  const durationMs = days * DAY_MS
  return Number.isSafeInteger(days) && Number.isSafeInteger(durationMs) ? durationMs : null
}

function retentionOperationID(mode: "preview" | "execute") {
  const suffix = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `retention-${mode}-${suffix.replace(/[^A-Za-z0-9_-]/g, "-")}`.slice(0, 128)
}

function RetentionResultSummary({
  result,
  label,
}: {
  result: CinemaRenderRetentionResult
  label: string
}) {
  const candidates = result.candidateJobs.slice(0, MAX_VISIBLE_CANDIDATES)
  const hiddenCandidateCount = Math.max(0, result.candidateJobs.length - candidates.length)
  const issues = result.errors.slice(0, MAX_VISIBLE_ISSUES)
  const hiddenIssueCount = Math.max(0, result.errors.length - issues.length)
  return (
    <section className="cinema-render-retention-result" aria-label={label}>
      <dl>
        <div><dt>Jobs scanned</dt><dd>{result.discoveredJobCount}</dd></div>
        <div><dt>{result.dryRun ? "Eligible jobs" : "Cleaned jobs"}</dt><dd>{result.dryRun ? result.eligibleJobCount : result.cleanedJobs.length}</dd></div>
        <div><dt>{result.dryRun ? "Reclaimable" : "Reclaimed"}</dt><dd>{formatBytes(result.dryRun ? result.estimatedReclaimableBytes : result.reclaimedBytes)}</dd></div>
        <div><dt>Skipped</dt><dd>{result.skipped.length}</dd></div>
        <div><dt>Issues</dt><dd>{result.errors.length}</dd></div>
      </dl>
      {candidates.length > 0 ? (
        <div className="cinema-render-retention-candidates">
          <strong>Candidate jobs</strong>
          <ul>
            {candidates.map((candidate) => <li key={candidate.jobID}>{candidate.jobID}</li>)}
          </ul>
          {hiddenCandidateCount > 0 ? <small>And {hiddenCandidateCount} more.</small> : null}
        </div>
      ) : <p>No rebuildable render files are eligible for cleanup.</p>}
      {issues.length > 0 ? (
        <div className="cinema-render-retention-issues" role="alert">
          <strong>Some items need attention</strong>
          <ul>
            {issues.map((issue, index) => (
              <li key={`${issue.code}-${issue.jobID ?? "all"}-${index}`}>
                {RETENTION_ISSUE_LABELS[issue.code]}{issue.jobID ? ` (${issue.jobID})` : ""}
              </li>
            ))}
          </ul>
          {hiddenIssueCount > 0 ? <small>And {hiddenIssueCount} more.</small> : null}
        </div>
      ) : null}
    </section>
  )
}

export function RenderRetentionPanel({
  api,
  executionAuthorized,
}: {
  api: RenderApi
  executionAuthorized: boolean
}) {
  const [daysText, setDaysText] = useState("")
  const [previewPending, setPreviewPending] = useState(false)
  const [previewStatus, setPreviewStatus] = useState("")
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewResult, setPreviewResult] = useState<CinemaRenderRetentionResult | null>(null)
  const [executionConfirmation, setExecutionConfirmation] = useState("")
  const [executionPending, setExecutionPending] = useState(false)
  const [executionError, setExecutionError] = useState<string | null>(null)
  const [executionResult, setExecutionResult] = useState<CinemaRenderRetentionResult | null>(null)
  const previewControllerRef = useRef<AbortController | null>(null)
  const previewSequenceRef = useRef(0)
  const durationMs = retentionDurationMs(daysText)
  const durationInvalid = daysText.length > 0 && durationMs === null
  const hasPreviewCandidates = Boolean(previewResult && previewResult.candidateJobs.length > 0)

  useEffect(() => () => {
    previewSequenceRef.current += 1
    previewControllerRef.current?.abort()
  }, [])

  const resetForDurationChange = (value: string) => {
    previewSequenceRef.current += 1
    previewControllerRef.current?.abort()
    previewControllerRef.current = null
    setDaysText(value)
    setPreviewPending(false)
    setPreviewStatus("")
    setPreviewError(null)
    setPreviewResult(null)
    setExecutionConfirmation("")
    setExecutionError(null)
    setExecutionResult(null)
  }

  const previewCleanup = async () => {
    if (durationMs === null || previewPending || executionPending) return
    const controller = new AbortController()
    const sequence = previewSequenceRef.current + 1
    previewSequenceRef.current = sequence
    previewControllerRef.current = controller
    setPreviewPending(true)
    setPreviewStatus("Inspecting rebuildable render files…")
    setPreviewError(null)
    setPreviewResult(null)
    setExecutionConfirmation("")
    setExecutionError(null)
    setExecutionResult(null)
    try {
      const result = await api.runRetentionCleanup({
        operationID: retentionOperationID("preview"),
        retentionDurationMs: durationMs,
        dryRun: true,
      }, controller.signal)
      if (controller.signal.aborted || previewSequenceRef.current !== sequence) return
      setPreviewResult(result)
      setPreviewStatus("Cleanup preview is ready.")
    } catch (error) {
      if (previewSequenceRef.current !== sequence) return
      if (controller.signal.aborted) {
        setPreviewStatus("Cleanup preview canceled.")
      } else {
        setPreviewStatus("")
        setPreviewError(error instanceof Error ? error.message : "Cleanup preview failed.")
      }
    } finally {
      if (previewSequenceRef.current === sequence) {
        previewControllerRef.current = null
        setPreviewPending(false)
      }
    }
  }

  const executeCleanup = async () => {
    if (
      !executionAuthorized
      || executionPending
      || durationMs === null
      || !hasPreviewCandidates
      || executionConfirmation !== "CLEAN"
    ) return
    setExecutionPending(true)
    setExecutionError(null)
    setExecutionResult(null)
    try {
      const result = await api.runRetentionCleanup({
        operationID: retentionOperationID("execute"),
        retentionDurationMs: durationMs,
        dryRun: false,
        confirm: CINEMA_RENDER_RETENTION_CONFIRMATION,
      })
      setExecutionResult(result)
      setPreviewResult(null)
      setPreviewStatus("")
      setExecutionConfirmation("")
    } catch (error) {
      setExecutionError(error instanceof Error ? error.message : "Cleanup could not be completed.")
    } finally {
      setExecutionPending(false)
    }
  }

  return (
    <details className="cinema-render-retention">
      <summary>Advanced · Project storage</summary>
      <div className="cinema-render-retention-body">
        <p>Preview removal of expired render inputs and temporary files. Jobs, events, timeline snapshots, and registered outputs are preserved.</p>
        <label>
          <span>Keep render files for whole days</span>
          <input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={daysText}
            disabled={executionPending}
            aria-invalid={durationInvalid || undefined}
            aria-describedby="cinema-render-retention-days-help"
            onChange={(event) => resetForDurationChange(event.target.value)}
          />
          <small id="cinema-render-retention-days-help" className={durationInvalid ? "is-error" : undefined}>
            {durationInvalid ? "Enter a positive whole number of days." : "No retention period is selected by default."}
          </small>
        </label>

        <div className="cinema-render-retention-actions">
          <button
            type="button"
            className="cinema-deliver-secondary-button"
            disabled={durationMs === null || previewPending || executionPending}
            onClick={() => void previewCleanup()}
          >
            Preview cleanup
          </button>
          {previewPending ? (
            <button type="button" className="cinema-deliver-secondary-button" onClick={() => previewControllerRef.current?.abort()}>
              Cancel preview
            </button>
          ) : null}
        </div>

        {previewPending ? <div className="cinema-render-progress-indeterminate" aria-hidden="true" /> : null}
        {previewStatus ? <div className="cinema-render-retention-status" role="status">{previewStatus}</div> : null}
        {previewError ? <div className="cinema-render-retention-error" role="alert">{previewError}</div> : null}
        {previewResult ? <RetentionResultSummary result={previewResult} label="Cleanup preview" /> : null}

        {executionAuthorized ? (
          <section className="cinema-render-retention-execute" aria-label="Execute render cleanup">
            <p>Execution permanently removes only the rebuildable files listed by a fresh server scan. Once confirmed, this request cannot be canceled.</p>
            <label>
              <span>Type CLEAN to confirm</span>
              <input
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={executionConfirmation}
                disabled={executionPending || !hasPreviewCandidates}
                onChange={(event) => setExecutionConfirmation(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="cinema-deliver-danger-button"
              disabled={executionPending || !hasPreviewCandidates || executionConfirmation !== "CLEAN"}
              onClick={() => void executeCleanup()}
            >
              Clean rebuildable files
            </button>
            {executionPending ? (
              <div className="cinema-render-retention-status" role="status">Cleanup is running and can no longer be canceled.</div>
            ) : null}
            {executionError ? <div className="cinema-render-retention-error" role="alert">{executionError}</div> : null}
            {executionResult ? <RetentionResultSummary result={executionResult} label="Cleanup result" /> : null}
          </section>
        ) : (
          <p className="cinema-render-retention-unauthorized" role="status">
            Cleanup execution is not authorized on this Agent. You can preview eligible files, but no files will be removed.
          </p>
        )}
      </div>
    </details>
  )
}
