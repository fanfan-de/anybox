import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CinemaRenderSettingsSchema,
  type CinemaRenderJob,
  type CinemaRenderJobListResult,
  type CinemaRenderSettings,
} from "@anybox/shared/cinema-render"
import type { CinemaTimelineDocument } from "@anybox/shared/cinema-timeline"
import { createRenderApi, CinemaRenderApiError } from "../api/renderApi"
import { DeliverPreview } from "./DeliverPreview"
import { DeliverSettings } from "./DeliverSettings"
import { DeliverSidebar } from "./DeliverSidebar"
import { DeliverTopbar } from "./DeliverTopbar"
import { RenderHistory } from "./RenderHistory"
import { RenderProgress } from "./RenderProgress"
import {
  applyRenderPreset,
  createRenderOperationFingerprint,
  defaultRenderSettings,
  presetForSettings,
  retainRenderOperation,
  retryRenderOperationFingerprint,
  type RenderPresetID,
  type RetainedRenderOperation,
} from "../model/renderPresets"
import { isRenderActive } from "../model/renderStatus"
import "../deliver.css"

function retentionExecutionAuthorizedFor(agentBaseURL: string) {
  try {
    const url = new URL(agentBaseURL)
    const hostname = url.hostname.trim().toLowerCase()
    return (url.protocol === "http:" || url.protocol === "https:")
      && (
        hostname === "127.0.0.1"
        || hostname === "localhost"
        || hostname === "::1"
        || hostname === "[::1]"
      )
  } catch {
    return false
  }
}

export function DeliverWorkbench({
  agentBaseURL,
  projectID,
  initialTimelineID,
  technicalPreview = false,
  onShowAssetInLibrary,
}: {
  agentBaseURL: string
  projectID: string
  initialTimelineID?: string | null
  technicalPreview?: boolean
  onShowAssetInLibrary?: (assetRef: NonNullable<CinemaRenderJob["outputAssetRef"]>) => void
}) {
  const queryClient = useQueryClient()
  const api = useMemo(() => createRenderApi(agentBaseURL, projectID), [agentBaseURL, projectID])
  const retentionExecutionAuthorized = useMemo(
    () => retentionExecutionAuthorizedFor(agentBaseURL),
    [agentBaseURL],
  )
  const [selectedTimelineID, setSelectedTimelineID] = useState<string | null>(initialTimelineID ?? null)
  const [settings, setSettings] = useState<CinemaRenderSettings | null>(null)
  const [selectedJobID, setSelectedJobID] = useState<string | null | undefined>()
  const [settingsOpen, setSettingsOpen] = useState(true)
  const [createPending, setCreatePending] = useState(false)
  const [actionPending, setActionPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const operationRef = useRef<RetainedRenderOperation | null>(null)
  const retryOperationRef = useRef<RetainedRenderOperation | null>(null)
  const initialHandoffAppliedRef = useRef(false)

  const timelinesQuery = useQuery({
    queryKey: ["cinema-deliver-timelines", agentBaseURL, projectID],
    queryFn: ({ signal }) => api.listTimelines(signal),
    staleTime: 1_000,
  })
  const timelines = timelinesQuery.data?.timelines ?? []

  useEffect(() => {
    if (timelines.length === 0) {
      setSelectedTimelineID(null)
      return
    }
    if (!initialHandoffAppliedRef.current) {
      initialHandoffAppliedRef.current = true
      const handoff = initialTimelineID && timelines.some((timeline) => timeline.id === initialTimelineID)
        ? initialTimelineID
        : timelines[0]?.id ?? null
      setSelectedTimelineID(handoff)
      return
    }
    if (!selectedTimelineID || !timelines.some((timeline) => timeline.id === selectedTimelineID)) {
      setSelectedTimelineID(timelines[0]?.id ?? null)
    }
  }, [initialTimelineID, selectedTimelineID, timelines])

  const timeline = useMemo<CinemaTimelineDocument | null>(
    () => timelines.find((candidate) => candidate.id === selectedTimelineID) ?? null,
    [selectedTimelineID, timelines],
  )
  const timelineDurationUs = useMemo(
    () => timeline?.clips.reduce(
      (durationUs, clip) => Math.max(durationUs, clip.timelineStartUs + clip.durationUs),
      0,
    ) ?? 0,
    [timeline],
  )

  useEffect(() => {
    if (!timeline) {
      setSettings(null)
      setSelectedJobID(undefined)
      return
    }
    setSettings(defaultRenderSettings(timeline))
    setSelectedJobID(undefined)
    setActionError(null)
  }, [timeline?.id])

  const jobsQuery = useQuery({
    queryKey: ["cinema-deliver-jobs", agentBaseURL, projectID, selectedTimelineID],
    queryFn: ({ signal }) => api.listJobs(selectedTimelineID!, signal),
    enabled: Boolean(selectedTimelineID),
    refetchInterval: (query) => query.state.data?.items.some((job) => isRenderActive(job.status)) ? 1_000 : false,
    staleTime: 500,
  })
  const jobs = jobsQuery.data?.items ?? []

  useEffect(() => {
    if (createPending || actionPending || jobsQuery.isFetching) return
    if (selectedJobID === null) return
    if (!selectedJobID || !jobs.some((job) => job.id === selectedJobID)) setSelectedJobID(jobs[0]?.id)
  }, [actionPending, createPending, jobs, jobsQuery.isFetching, selectedJobID])

  const selectedJob = selectedJobID === null
    ? undefined
    : jobs.find((job) => job.id === selectedJobID) ?? jobs[0]

  const preflightQuery = useQuery({
    queryKey: ["cinema-deliver-preflight", agentBaseURL, projectID, selectedTimelineID, timeline?.revision, settings],
    queryFn: ({ signal }) => api.preflight(selectedTimelineID!, settings!, signal),
    enabled: Boolean(selectedTimelineID && timeline && settings),
    staleTime: 750,
    retry: false,
  })
  const runtimeQuery = useQuery({
    queryKey: ["cinema-deliver-runtime", agentBaseURL],
    queryFn: ({ signal }) => api.getRuntime(signal),
    staleTime: 30_000,
    retry: false,
  })

  const preflight = preflightQuery.data
  const localSettingsValid = settings ? CinemaRenderSettingsSchema.safeParse(settings).success : false
  const runtimeReady = runtimeQuery.data?.available === true
  const startReady = Boolean(timeline && settings && localSettingsValid && preflight?.ready && runtimeReady && !createPending)
  const createOperationFingerprint = timeline && settings && localSettingsValid
    ? createRenderOperationFingerprint(timeline.id, timeline.revision, settings)
    : null

  useEffect(() => {
    if (operationRef.current && operationRef.current.fingerprint !== createOperationFingerprint) {
      operationRef.current = null
    }
  }, [createOperationFingerprint])

  const updateSettings = useCallback((patch: Partial<CinemaRenderSettings>) => {
    setSettings((current) => current ? { ...current, ...patch } as CinemaRenderSettings : current)
  }, [])

  const cacheReturnedJob = useCallback((job: CinemaRenderJob) => {
    queryClient.setQueryData<CinemaRenderJobListResult>(
      ["cinema-deliver-jobs", agentBaseURL, projectID, job.timelineID],
      (current) => ({
        items: [job, ...(current?.items ?? []).filter((candidate) => candidate.id !== job.id)],
      }),
    )
  }, [agentBaseURL, projectID, queryClient])

  const startRender = useCallback(async () => {
    if (!timeline || !settings || !preflight?.ready || !localSettingsValid || createPending) return
    setCreatePending(true)
    setActionError(null)
    const fingerprint = createRenderOperationFingerprint(timeline.id, timeline.revision, settings)
    const operation = retainRenderOperation(operationRef.current, fingerprint)
    operationRef.current = operation
    try {
      const job = await api.createJob(timeline.id, {
        operationID: operation.operationID,
        expectedTimelineRevision: timeline.revision,
        settings,
      })
      operationRef.current = null
      cacheReturnedJob(job)
      setSelectedJobID(job.id)
      await queryClient.invalidateQueries({ queryKey: ["cinema-deliver-jobs", agentBaseURL, projectID, timeline.id] })
    } catch (error) {
      if (error instanceof CinemaRenderApiError && error.code === "CINEMA_TIMELINE_REVISION_CONFLICT") {
        setActionError(`Timeline changed to revision ${error.latestRevision ?? "a newer revision"}. Readiness was refreshed; review and try again.`)
        await timelinesQuery.refetch()
        await queryClient.invalidateQueries({ queryKey: ["cinema-deliver-preflight", agentBaseURL, projectID] })
      } else if (error instanceof CinemaRenderApiError && error.code === "CINEMA_RENDER_PREFLIGHT_BLOCKED" && error.data) {
        setActionError("Preflight changed while starting the render. Review the issues and try again.")
      } else if (error instanceof Error) {
        setActionError(error.message)
      } else {
        setActionError("The render job could not be created.")
      }
    } finally {
      setCreatePending(false)
    }
  }, [agentBaseURL, api, cacheReturnedJob, createPending, localSettingsValid, preflight?.ready, projectID, queryClient, settings, timeline, timelinesQuery])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      const isTextEntry = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || (target instanceof HTMLElement && target.isContentEditable)
      if (event.key === "Escape") {
        if (settingsOpen) setSettingsOpen(false)
        setActionError(null)
        return
      }
      if (isTextEntry || event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return
      if (!startReady) return
      event.preventDefault()
      void startRender()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [settingsOpen, startReady, startRender])

  const cancelJob = useCallback(async () => {
    if (!selectedJob || !isRenderActive(selectedJob.status) || actionPending) return
    setActionPending(true)
    setActionError(null)
    try {
      await api.cancelJob(selectedJob.id)
      await queryClient.invalidateQueries({ queryKey: ["cinema-deliver-jobs", agentBaseURL, projectID, selectedJob.timelineID] })
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The render could not be canceled.")
    } finally {
      setActionPending(false)
    }
  }, [actionPending, agentBaseURL, api, projectID, queryClient, selectedJob])

  const retryJob = useCallback(async (job: CinemaRenderJob) => {
    if (actionPending) return
    setActionPending(true)
    setActionError(null)
    const fingerprint = retryRenderOperationFingerprint(job.id)
    const operation = retainRenderOperation(retryOperationRef.current, fingerprint, "retry")
    retryOperationRef.current = operation
    try {
      const retry = await api.retryJob(job.id, operation.operationID)
      retryOperationRef.current = null
      cacheReturnedJob(retry)
      setSelectedJobID(retry.id)
      await queryClient.invalidateQueries({ queryKey: ["cinema-deliver-jobs", agentBaseURL, projectID, job.timelineID] })
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The render could not be retried.")
    } finally {
      setActionPending(false)
    }
  }, [actionPending, agentBaseURL, api, cacheReturnedJob, projectID, queryClient])

  const refresh = useCallback(() => {
    void Promise.all([
      timelinesQuery.refetch(),
      jobsQuery.refetch(),
      preflightQuery.refetch(),
      runtimeQuery.refetch(),
    ])
  }, [jobsQuery, preflightQuery, runtimeQuery, timelinesQuery])

  const presetID: RenderPresetID = settings ? presetForSettings(settings) : "balanced"
  const choosePreset = (next: RenderPresetID) => {
    setSettings((current) => current ? applyRenderPreset(current, next) : current)
  }

  if (timelinesQuery.isLoading) {
    return <div className="cinema-deliver-loading" role="status">Loading Timelines…</div>
  }
  if (timelinesQuery.error) {
    return <div className="cinema-deliver-loading is-error" role="alert">{timelinesQuery.error instanceof Error ? timelinesQuery.error.message : "Could not load Timelines."}</div>
  }

  return (
    <section className={`cinema-deliver-workbench ${settingsOpen ? "is-settings-open" : ""}`}>
      <DeliverTopbar
        timelineTitle={timeline?.title}
        job={selectedJob}
        technicalPreview={technicalPreview}
        preflightReady={startReady}
        createPending={createPending}
        settingsOpen={settingsOpen}
        onStart={() => void startRender()}
        onToggleSettings={() => setSettingsOpen((value) => !value)}
        onRefresh={refresh}
      />
      <div className="cinema-deliver-layout">
        <DeliverSidebar
          timelines={timelines}
          selectedTimelineID={selectedTimelineID}
          onSelectTimeline={setSelectedTimelineID}
        />
        <DeliverPreview
          agentBaseURL={agentBaseURL}
          timeline={timeline}
          preflight={preflight}
          job={selectedJob}
          onShowInAssets={onShowAssetInLibrary}
        />
        <DeliverSettings
          settings={settings}
          presetID={presetID}
          onSettingsChange={updateSettings}
          onPresetChange={choosePreset}
          timelineDurationUs={timelineDurationUs}
          timeline={timeline}
          renderApi={api}
          executionAuthorized={retentionExecutionAuthorized}
          disabled={createPending || Boolean(selectedJob && isRenderActive(selectedJob.status))}
        />
      </div>
      <div className="cinema-deliver-lower-panel">
        <RenderProgress
          job={selectedJob}
          actionPending={actionPending || createPending}
          onCancel={() => void cancelJob()}
          onRetry={() => selectedJob && void retryJob(selectedJob)}
          currentTimelineRevision={timeline?.revision}
          latestRenderReady={startReady}
          onRenderLatest={() => void startRender()}
          onNewRender={() => {
            setSelectedJobID(null)
            setActionError(null)
          }}
        />
        <RenderHistory jobs={jobs} selectedJobID={selectedJob?.id} onSelect={(job) => setSelectedJobID(job.id)} />
      </div>
      {preflightQuery.isFetching ? <div className="cinema-deliver-inline-status" role="status">Checking delivery readiness…</div> : null}
      {preflightQuery.error ? <div className="cinema-deliver-alert" role="alert">{preflightQuery.error instanceof Error ? preflightQuery.error.message : "Preflight could not be completed."}</div> : null}
      {runtimeQuery.data?.issue ? <div className="cinema-deliver-alert" role="alert">FFmpeg runtime: {runtimeQuery.data.issue}</div> : null}
      {runtimeQuery.error ? <div className="cinema-deliver-alert" role="alert">FFmpeg runtime status could not be checked.</div> : null}
      {actionError ? <div className="cinema-deliver-alert" role="alert">{actionError}</div> : null}
      {preflight && preflight.issues.length > 0 ? (
        <section className="cinema-deliver-issues" aria-label="Preflight issues">
          <strong>{preflight.ready ? "Preflight notes" : "Resolve before rendering"}</strong>
          <ul>{preflight.issues.map((issue, index) => <li key={`${issue.code}-${issue.clipID ?? "all"}-${index}`} className={`is-${issue.severity}`}>{issue.message}</li>)}</ul>
        </section>
      ) : null}
      <div className="cinema-deliver-narrow-guard" role="status"><strong>Deliver needs a wider desktop window</strong><span>Increase the window width to at least 760px to review delivery settings.</span></div>
    </section>
  )
}
