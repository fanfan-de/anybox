import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react"
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import type { CinemaAssetRecord, CinemaAssetStatus } from "@anybox/shared"
import {
  isCinemaTimelineClipCompatibleWithTrack,
  type CinemaTimelineClip,
  type CinemaTimelineClipPatch,
  type CinemaTimelineDocument,
  type CinemaTimelineTrack,
  type CinemaTimelineTrackPatch,
} from "@anybox/shared/cinema-timeline"
import { CinemaTimelineApiError, createTimelineApi } from "../api/timelineApi"
import { createAssetLibraryApi } from "../../assets/assetLibraryApi"
import { projectTimelineCommand } from "../model/timelineProjection"
import { snapTimelineTime, timelineSnapCandidates } from "../model/timelineSnap"
import { timelineFrameDurationUs } from "../model/timelineTime"
import { validateTimelineForDelivery } from "../model/timelineValidation"
import {
  createTimelineHistoryEntry,
  materializeTimelineCommand,
  type CinemaTimelineCommandTemplate,
  type CinemaTimelineHistoryEntry,
} from "../model/timelineUndo"
import {
  CinemaTimelineCommandQueue,
  type CinemaTimelineCommandDraft,
  type CinemaTimelineCommandQueueSnapshot,
} from "../state/TimelineCommandQueue"
import { readCinemaTimelineUiSnapshot, writeCinemaTimelineUiSnapshot } from "../state/timelineUiStore"
import { EditTopbar } from "./EditTopbar"
import { TimelineEmptyState } from "./TimelineEmptyState"
import { TimelineInspector } from "./TimelineInspector"
import { TimelineMediaBin, type TimelineMediaSection } from "./TimelineMediaBin"
import { TimelinePreviewStage } from "./TimelinePreviewStage"
import { TimelineToolbar } from "./TimelineToolbar"
import { TimelineTrackArea } from "./TimelineTrackArea"
import "../timeline.css"

const idleSaveState: CinemaTimelineCommandQueueSnapshot = {
  status: "idle",
  pendingCount: 0,
  error: null,
}

function commandID(type: string) {
  return `${type}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
}

function nextAvailableStart(document: CinemaTimelineDocument, trackID: string, preferredStartUs: number, durationUs: number) {
  let startUs = Math.max(0, preferredStartUs)
  const clips = document.clips
    .filter((clip) => clip.trackID === trackID)
    .sort((left, right) => left.timelineStartUs - right.timelineStartUs)
  for (const clip of clips) {
    if (startUs + durationUs <= clip.timelineStartUs) break
    if (startUs < clip.timelineStartUs + clip.durationUs) startUs = clip.timelineStartUs + clip.durationUs
  }
  return startUs
}

function assetRefFromRecord(projectID: string, asset: CinemaAssetRecord) {
  return {
    scope: { type: "project" as const, projectID },
    assetID: asset.id,
    contentRevision: asset.contentRevision,
    snapshot: {
      kind: asset.kind,
      displayName: asset.displayName,
      mimeType: asset.mimeType,
      ...(asset.width !== undefined ? { width: asset.width } : {}),
      ...(asset.height !== undefined ? { height: asset.height } : {}),
      ...(asset.durationSeconds !== undefined ? { durationSeconds: asset.durationSeconds } : {}),
    },
  }
}

export function EditWorkbench({
  agentBaseURL,
  projectID,
  onRegisterFlush,
  onTimelineSelected,
}: {
  agentBaseURL: string
  projectID: string
  onRegisterFlush?: (flush: (() => Promise<void>) | null) => void
  onTimelineSelected?: (timelineID: string | null) => void
}) {
  const queryClient = useQueryClient()
  const api = useMemo(() => createTimelineApi(agentBaseURL, projectID), [agentBaseURL, projectID])
  const queryKey = ["cinema-timelines", agentBaseURL, projectID] as const
  const timelinesQuery = useQuery({ queryKey, queryFn: api.list })
  const timelines = timelinesQuery.data?.timelines ?? []
  const [selectedTimelineID, setSelectedTimelineID] = useState<string | null>(null)
  const [selectedClip, setSelectedClip] = useState<CinemaTimelineClip | null>(null)
  const [mediaOpen, setMediaOpen] = useState(true)
  const [mediaSection, setMediaSection] = useState<TimelineMediaSection>("timelines")
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [previewPercent, setPreviewPercent] = useState(42)
  const [playheadUs, setPlayheadUs] = useState(0)
  const [pixelsPerSecond, setPixelsPerSecond] = useState(48)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [interactionError, setInteractionError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [previewMuted, setPreviewMuted] = useState(false)
  const [saveState, setSaveState] = useState<CinemaTimelineCommandQueueSnapshot>(idleSaveState)
  const [timelineDocument, setTimelineDocument] = useState<CinemaTimelineDocument | null>(null)
  const timelineDocumentRef = useRef<CinemaTimelineDocument | null>(null)
  const undoStackRef = useRef<CinemaTimelineHistoryEntry[]>([])
  const redoStackRef = useRef<CinemaTimelineHistoryEntry[]>([])
  const [historyCounts, setHistoryCounts] = useState({ undo: 0, redo: 0 })
  const [replacementClipID, setReplacementClipID] = useState<string | null>(null)

  useEffect(() => {
    if (selectedTimelineID && timelines.some((timeline) => timeline.id === selectedTimelineID)) return
    setSelectedTimelineID(timelines[0]?.id ?? null)
  }, [selectedTimelineID, timelines])

  useEffect(() => {
    onTimelineSelected?.(selectedTimelineID)
  }, [onTimelineSelected, selectedTimelineID])

  const serverTimeline = timelines.find((candidate) => candidate.id === selectedTimelineID) ?? null
  useEffect(() => {
    const ui = serverTimeline ? readCinemaTimelineUiSnapshot(projectID, serverTimeline.id) : null
    timelineDocumentRef.current = serverTimeline
    setTimelineDocument(serverTimeline)
    setSaveState(idleSaveState)
    undoStackRef.current = []
    redoStackRef.current = []
    setHistoryCounts({ undo: 0, redo: 0 })
    setPlayheadUs(ui?.playheadUs ?? 0)
    setPixelsPerSecond(ui?.pixelsPerSecond ?? 48)
    setPreviewPercent(ui?.previewPercent ?? 42)
    setMediaOpen(ui?.mediaOpen ?? true)
    setInspectorOpen(ui?.inspectorOpen ?? true)
    setSnapEnabled(ui?.snapEnabled ?? true)
    setSelectedClip(ui?.selectedClipID ? serverTimeline?.clips.find((clip) => clip.id === ui.selectedClipID) ?? null : null)
  }, [serverTimeline?.id])

  const timeline = timelineDocument
  useEffect(() => {
    if (!timeline) return
    const timer = window.setTimeout(() => writeCinemaTimelineUiSnapshot(projectID, timeline.id, {
      playheadUs: Math.round(playheadUs),
      pixelsPerSecond,
      previewPercent,
      mediaOpen,
      inspectorOpen,
      snapEnabled,
      selectedClipID: selectedClip?.id ?? null,
    }), 250)
    return () => window.clearTimeout(timer)
  }, [inspectorOpen, mediaOpen, pixelsPerSecond, playheadUs, previewPercent, projectID, selectedClip?.id, snapEnabled, timeline?.id])

  const queue = useMemo(() => {
    if (!selectedTimelineID || !serverTimeline) return null
    return new CinemaTimelineCommandQueue({
      initialRevision: serverTimeline.revision,
      send: api.sendCommand,
      fetchLatestTimeline: () => api.get(selectedTimelineID),
      isRevisionConflict: (error) => error instanceof CinemaTimelineApiError
        && error.status === 409
        && error.code === "CINEMA_TIMELINE_REVISION_CONFLICT",
      onSnapshot: setSaveState,
      onResult: (result, pendingCount) => {
        if (pendingCount > 0) return
        timelineDocumentRef.current = result.timeline
        setTimelineDocument(result.timeline)
        queryClient.setQueryData<{ timelines: CinemaTimelineDocument[] }>(queryKey, (current) => ({
          timelines: (current?.timelines ?? []).map((timeline) => timeline.id === result.timeline.id ? result.timeline : timeline),
        }))
      },
    })
  }, [api, queryClient, selectedTimelineID, serverTimeline?.id])
  useEffect(() => {
    onRegisterFlush?.(queue ? () => queue.flush() : null)
    return () => onRegisterFlush?.(null)
  }, [onRegisterFlush, queue])
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!queue?.hasPendingCommands()) return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", beforeUnload)
    return () => window.removeEventListener("beforeunload", beforeUnload)
  }, [queue, saveState.pendingCount, saveState.status])

  const assetRefs = useMemo(() => {
    const refs = new Map<string, Exclude<CinemaTimelineClip, { kind: "text" }>["assetRef"]>()
    for (const clip of timeline?.clips ?? []) if (clip.kind !== "text") refs.set(clip.assetRef.assetID, clip.assetRef)
    return [...refs.values()]
  }, [timeline?.clips])
  const assetQueries = useQueries({
    queries: assetRefs.map((assetRef) => ({
      queryKey: ["cinema-timeline-asset-status", agentBaseURL, projectID, assetRef.scope, assetRef.assetID, assetRef.contentRevision],
      queryFn: ({ signal }: { signal: AbortSignal }) => createAssetLibraryApi(agentBaseURL, projectID, assetRef.scope).getAsset(assetRef.assetID, signal),
      staleTime: 5_000,
      retry: false,
    })),
  })
  const assetStatuses = useMemo(() => {
    const statuses = new Map<string, CinemaAssetStatus | "unresolved">()
    assetRefs.forEach((assetRef, index) => {
      const query = assetQueries[index]
      statuses.set(assetRef.assetID, query?.data?.asset.status ?? (query?.isError ? "missing" : "unresolved"))
    })
    return statuses
  }, [assetQueries, assetRefs])
  const deliveryValidation = timeline ? validateTimelineForDelivery(timeline, assetStatuses) : { ready: false, issues: [] }
  const timelineDurationUs = timeline?.clips.reduce((duration, clip) => Math.max(duration, clip.timelineStartUs + clip.durationUs), 0) ?? 0
  useEffect(() => {
    if (!playing) return
    let frame = 0
    let previous = performance.now()
    const tick = (now: number) => {
      const elapsedUs = Math.max(0, now - previous) * 1_000
      previous = now
      setPlayheadUs((current) => {
        const next = current + elapsedUs
        if (next >= timelineDurationUs) {
          setPlaying(false)
          return timelineDurationUs
        }
        return next
      })
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [playing, timelineDurationUs])
  useEffect(() => {
    if (!selectedClip) return
    const latest = timeline?.clips.find((clip) => clip.id === selectedClip.id) ?? null
    setSelectedClip(latest)
  }, [selectedClip?.id, timeline])

  const createMutation = useMutation({
    mutationFn: () => api.create(),
    onSuccess: (created) => {
      queryClient.setQueryData<{ timelines: CinemaTimelineDocument[] }>(queryKey, (current) => ({
        timelines: [created, ...(current?.timelines ?? [])],
      }))
      setSelectedTimelineID(created.id)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (target: CinemaTimelineDocument) => {
      await queue?.flush()
      return await api.delete(target.id)
    },
    onSuccess: ({ timelineID }) => {
      queryClient.setQueryData<{ timelines: CinemaTimelineDocument[] }>(queryKey, (current) => ({
        timelines: (current?.timelines ?? []).filter((candidate) => candidate.id !== timelineID),
      }))
      if (selectedTimelineID === timelineID) {
        const next = timelines.find((candidate) => candidate.id !== timelineID)
        setSelectedTimelineID(next?.id ?? null)
        setSelectedClip(null)
      }
      setInteractionError(null)
    },
    onError: (error) => setInteractionError(error instanceof Error ? error.message : "Could not delete the Timeline."),
  })

  const selectTimeline = (timelineID: string) => {
    const switchTimeline = async () => {
      await queue?.flush().catch(() => undefined)
      setSelectedTimelineID(timelineID)
      setSelectedClip(null)
      setPlayheadUs(0)
    }
    void switchTimeline()
  }

  const syncHistoryCounts = () => setHistoryCounts({
    undo: undoStackRef.current.length,
    redo: redoStackRef.current.length,
  })

  const executeCommand = (draft: CinemaTimelineCommandDraft, recordHistory = true) => {
    const current = timelineDocumentRef.current
    if (!current || !queue) return false
    try {
      const history = recordHistory ? createTimelineHistoryEntry(current, draft) : null
      const next = projectTimelineCommand(current, draft)
      timelineDocumentRef.current = next
      setTimelineDocument(next)
      setInteractionError(null)
      void queue.enqueue(draft).catch(() => undefined)
      if (history) {
        undoStackRef.current.push(history)
        redoStackRef.current = []
        syncHistoryCounts()
      }
      return true
    } catch (error) {
      setInteractionError(error instanceof Error ? error.message : "Timeline command is invalid.")
      return false
    }
  }

  const executeTemplates = (templates: readonly CinemaTimelineCommandTemplate[]) => {
    const current = timelineDocumentRef.current
    if (!current) return false
    for (const template of templates) {
      if (!executeCommand(materializeTimelineCommand(template, {
        id: commandID(`history-${template.type}`),
        timelineID: current.id,
        actor: "cinema-web",
      }), false)) return false
    }
    return true
  }

  const undo = () => {
    const entry = undoStackRef.current.pop()
    if (!entry) return
    if (executeTemplates(entry.undo)) redoStackRef.current.push(entry)
    else undoStackRef.current.push(entry)
    syncHistoryCounts()
  }

  const redo = () => {
    const entry = redoStackRef.current.pop()
    if (!entry) return
    if (executeTemplates(entry.redo)) undoStackRef.current.push(entry)
    else redoStackRef.current.push(entry)
    syncHistoryCounts()
  }

  const addAsset = (asset: CinemaAssetRecord, preferredStartUs = playheadUs, preferredTrackID?: string) => {
    const current = timelineDocumentRef.current
    if (!current || asset.status !== "ready") return
    if (replacementClipID) {
      const clip = current.clips.find((candidate) => candidate.id === replacementClipID)
      if (!clip || clip.kind === "text") return
      if (clip.kind !== asset.kind) {
        setInteractionError(`Choose a ${clip.kind} asset for this clip.`)
        return
      }
      const durationUs = asset.durationSeconds === undefined ? undefined : Math.round(asset.durationSeconds * 1_000_000)
      if (durationUs !== undefined && clip.sourceInUs + clip.sourceDurationUs > durationUs) {
        setInteractionError("The replacement asset is shorter than the current source range.")
        return
      }
      if (executeCommand({
        id: commandID("replace-clip-asset"),
        timelineID: current.id,
        actor: "cinema-web",
        type: "update-clip",
        clipID: clip.id,
        patch: { assetRef: assetRefFromRecord(projectID, asset) },
      })) setReplacementClipID(null)
      return
    }
    let targetTrack = preferredTrackID
      ? current.tracks.find((track) => track.id === preferredTrackID)
      : current.tracks.find((track) => track.kind === (asset.kind === "audio" ? "audio" : asset.kind === "video" ? "video" : "overlay"))
    if (targetTrack && !isCinemaTimelineClipCompatibleWithTrack(targetTrack.kind, asset.kind)) {
      setInteractionError(`${asset.kind} assets cannot be added to ${targetTrack.title}.`)
      return
    }
    if (!targetTrack && asset.kind === "image") {
      targetTrack = {
        id: commandID("track"),
        kind: "overlay",
        title: "O1",
        order: current.tracks.length,
        locked: false,
        muted: false,
        hidden: false,
      }
      executeCommand({
        id: commandID("create-track"),
        timelineID: current.id,
        actor: "cinema-web",
        type: "create-track",
        track: targetTrack,
      })
    }
    const projected = timelineDocumentRef.current
    if (!targetTrack || !projected) return
    if (targetTrack.locked) {
      setInteractionError(`${targetTrack.title} is locked.`)
      return
    }
    const durationUs = Math.max(1, Math.round((asset.durationSeconds ?? (asset.kind === "image" ? 5 : 1)) * 1_000_000))
    const startUs = nextAvailableStart(projected, targetTrack.id, preferredStartUs, durationUs)
    const timestamp = new Date().toISOString()
    executeCommand({
      id: commandID("add-clip"),
      timelineID: projected.id,
      actor: "cinema-web",
      type: "add-clip",
      clip: {
        id: commandID("clip"),
        trackID: targetTrack.id,
        kind: asset.kind,
        title: asset.displayName,
        timelineStartUs: startUs,
        durationUs,
        playbackRate: 1,
        volume: 1,
        opacity: 1,
        ...(asset.kind === "image" || asset.kind === "video" ? { fit: "contain" as const } : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
        assetRef: assetRefFromRecord(projectID, asset),
        sourceInUs: 0,
        sourceDurationUs: durationUs,
        ...(asset.kind === "audio" ? { fadeInUs: 0, fadeOutUs: 0 } : {}),
      },
    })
  }

  const moveClip = (clip: CinemaTimelineClip, trackID: string, proposedStartUs: number) => {
    const current = timelineDocumentRef.current
    if (!current) return
    const targetTrack = current.tracks.find((track) => track.id === trackID)
    if (!targetTrack || !isCinemaTimelineClipCompatibleWithTrack(targetTrack.kind, clip.kind)) {
      setInteractionError(`${clip.kind} clips cannot be moved to this track.`)
      return
    }
    const sourceTrack = current.tracks.find((track) => track.id === clip.trackID)
    if (sourceTrack?.locked || targetTrack.locked) {
      setInteractionError(`${sourceTrack?.locked ? sourceTrack.title : targetTrack.title} is locked.`)
      return
    }
    const startUs = snapEnabled
      ? snapTimelineTime(proposedStartUs, timelineSnapCandidates(current, [clip.id]), pixelsPerSecond).timeUs
      : proposedStartUs
    executeCommand({
      id: commandID("move-clip"),
      timelineID: current.id,
      actor: "cinema-web",
      type: "move-clip",
      clipID: clip.id,
      trackID,
      timelineStartUs: startUs,
    })
  }

  const trimClip = (clip: CinemaTimelineClip, next: { timelineStartUs: number; durationUs: number; sourceInUs: number; sourceDurationUs: number }) => {
    const current = timelineDocumentRef.current
    if (!current || clip.kind === "text") return
    if (current.tracks.find((track) => track.id === clip.trackID)?.locked) return setInteractionError("Unlock the track before trimming this clip.")
    executeCommand({
      id: commandID("trim-clip"),
      timelineID: current.id,
      actor: "cinema-web",
      type: "trim-clip",
      clipID: clip.id,
      ...next,
    })
  }

  const splitSelectedClip = () => {
    const current = timelineDocumentRef.current
    const clip = current?.clips.find((candidate) => candidate.id === selectedClip?.id)
    if (!current || !clip || playheadUs <= clip.timelineStartUs || playheadUs >= clip.timelineStartUs + clip.durationUs) return
    if (current.tracks.find((track) => track.id === clip.trackID)?.locked) return setInteractionError("Unlock the track before splitting this clip.")
    executeCommand({
      id: commandID("split-clip"),
      timelineID: current.id,
      actor: "cinema-web",
      type: "split-clip",
      clipID: clip.id,
      rightClipID: commandID("clip"),
      splitTimeUs: playheadUs,
    })
  }

  const deleteSelectedClip = () => {
    const current = timelineDocumentRef.current
    if (!current || !selectedClip) return
    if (current.tracks.find((track) => track.id === selectedClip.trackID)?.locked) return setInteractionError("Unlock the track before deleting this clip.")
    if (executeCommand({
      id: commandID("delete-clips"),
      timelineID: current.id,
      actor: "cinema-web",
      type: "delete-clips",
      clipIDs: [selectedClip.id],
    })) setSelectedClip(null)
  }

  const updateSelectedClip = (patch: CinemaTimelineClipPatch) => {
    const current = timelineDocumentRef.current
    if (!current || !selectedClip) return
    if (current.tracks.find((track) => track.id === selectedClip.trackID)?.locked) return setInteractionError("Unlock the track before editing this clip.")
    executeCommand({
      id: commandID("update-clip"),
      timelineID: current.id,
      actor: "cinema-web",
      type: "update-clip",
      clipID: selectedClip.id,
      patch,
    })
  }

  const updateTrack = (track: CinemaTimelineTrack, patch: CinemaTimelineTrackPatch) => {
    const current = timelineDocumentRef.current
    if (!current) return
    executeCommand({
      id: commandID("update-track"),
      timelineID: current.id,
      actor: "cinema-web",
      type: "update-track",
      trackID: track.id,
      patch,
    })
  }

  const fitTimeline = () => {
    if (timelineDurationUs <= 0) return setPixelsPerSecond(48)
    const chromeWidth = (mediaOpen ? 248 : 0) + (selectedClip && inspectorOpen ? 264 : 0) + 180
    const availableWidth = Math.max(320, window.innerWidth - chromeWidth)
    setPixelsPerSecond(Math.max(12, Math.min(192, availableWidth / (timelineDurationUs / 1_000_000))))
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) return
      if ((event.key === "Delete" || event.key === "Backspace") && selectedClip) {
        event.preventDefault()
        deleteSelectedClip()
      } else if (event.key.toLowerCase() === "s" && selectedClip) {
        event.preventDefault()
        splitSelectedClip()
      } else if (event.key === "Home") {
        event.preventDefault()
        setPlayheadUs(0)
      } else if (event.key === " ") {
        event.preventDefault()
        setPlaying((value) => !value)
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault()
        const direction = event.key === "ArrowRight" ? 1 : -1
        const stepUs = event.shiftKey ? 1_000_000 : timeline ? timelineFrameDurationUs(timeline.settings.frameRate) : 40_000
        setPlayheadUs((value) => Math.min(timelineDurationUs, Math.max(0, value + direction * stepUs)))
      } else if (event.key === "Escape") {
        setSelectedClip(null)
        setInteractionError(null)
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  })

  const beginPreviewResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const main = event.currentTarget.parentElement
    if (!main) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const resize = (pointerEvent: PointerEvent) => {
      const rect = main.getBoundingClientRect()
      const next = (pointerEvent.clientY - rect.top) / Math.max(1, rect.height) * 100
      setPreviewPercent(Math.min(70, Math.max(25, next)))
    }
    const stop = () => {
      window.removeEventListener("pointermove", resize)
      window.removeEventListener("pointerup", stop)
      window.removeEventListener("pointercancel", stop)
    }
    window.addEventListener("pointermove", resize)
    window.addEventListener("pointerup", stop)
    window.addEventListener("pointercancel", stop)
  }

  return (
    <section className={`cinema-edit-workbench ${mediaOpen ? "is-media-open" : ""} ${selectedClip && inspectorOpen ? "is-inspector-open" : ""}`}>
      <EditTopbar
        timeline={timeline}
        save={saveState}
        onToggleMedia={() => setMediaOpen((value) => !value)}
        onToggleInspector={() => setInspectorOpen((value) => !value)}
        onRetry={() => queue?.retry()}
        deliveryReady={deliveryValidation.ready}
        deliveryMessage={deliveryValidation.issues[0]?.message ?? "Checking delivery readiness"}
      />
      <div className="cinema-edit-body">
        {mediaOpen ? (
          <TimelineMediaBin
            agentBaseURL={agentBaseURL}
            projectID={projectID}
            timelines={timelines}
            selectedTimelineID={selectedTimelineID}
            creating={createMutation.isPending}
            onCreate={() => createMutation.mutate()}
            onSelectTimeline={selectTimeline}
            onDeleteTimeline={(target) => {
              if (window.confirm(`Delete “${target.title}”? This cannot be undone.`)) deleteMutation.mutate(target)
            }}
            onActivateAsset={addAsset}
            replacementClipTitle={replacementClipID ? timeline?.clips.find((clip) => clip.id === replacementClipID)?.title : undefined}
            section={mediaSection}
            onSectionChange={setMediaSection}
          />
        ) : null}
        <div className="cinema-edit-main" style={{ "--cinema-edit-preview-size": `${previewPercent}%` } as CSSProperties}>
          {timelinesQuery.isLoading ? <div className="cinema-timeline-empty"><p>Loading timelines…</p></div> : null}
          {timelinesQuery.error ? <div className="cinema-timeline-empty is-error" role="alert"><p>{timelinesQuery.error instanceof Error ? timelinesQuery.error.message : "Could not load timelines"}</p></div> : null}
          {!timelinesQuery.isLoading && !timelinesQuery.error && !timeline ? (
            <TimelineEmptyState creating={createMutation.isPending} onCreate={() => createMutation.mutate()} />
          ) : null}
          {timeline ? (
            <>
              <TimelinePreviewStage
                agentBaseURL={agentBaseURL}
                projectID={projectID}
                timeline={timeline}
                playheadUs={playheadUs}
                playing={playing}
                muted={previewMuted}
                onTogglePlaying={() => setPlaying((value) => !value)}
                onToggleMuted={() => setPreviewMuted((value) => !value)}
                onSeek={(timeUs) => setPlayheadUs(Math.min(timelineDurationUs, Math.max(0, timeUs)))}
                onStepFrame={(direction) => setPlayheadUs((value) => Math.min(timelineDurationUs, Math.max(0, value + direction * timelineFrameDurationUs(timeline.settings.frameRate))))}
                onBrowseAssets={() => {
                  setMediaOpen(true)
                  setMediaSection("project")
                }}
              />
              <div
                className="cinema-edit-horizontal-splitter"
                role="separator"
                aria-label="Resize preview and Timeline"
                aria-orientation="horizontal"
                aria-valuemin={25}
                aria-valuemax={70}
                aria-valuenow={Math.round(previewPercent)}
                tabIndex={0}
                onPointerDown={beginPreviewResize}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
                  event.preventDefault()
                  setPreviewPercent((value) => Math.min(70, Math.max(25, value + (event.key === "ArrowDown" ? 2 : -2))))
                }}
              />
              <section className="cinema-timeline-editor" aria-label="Timeline editor">
                <TimelineToolbar
                  snapEnabled={snapEnabled}
                  canSplit={Boolean(selectedClip && playheadUs > selectedClip.timelineStartUs && playheadUs < selectedClip.timelineStartUs + selectedClip.durationUs)}
                  canUndo={historyCounts.undo > 0}
                  canRedo={historyCounts.redo > 0}
                  onSplit={splitSelectedClip}
                  onToggleSnap={() => setSnapEnabled((value) => !value)}
                  onUndo={undo}
                  onRedo={redo}
                  onZoomOut={() => setPixelsPerSecond((value) => Math.max(12, value / 1.5))}
                  onZoomIn={() => setPixelsPerSecond((value) => Math.min(192, value * 1.5))}
                  onFit={fitTimeline}
                />
                <TimelineTrackArea
                  timeline={timeline}
                  selectedClipID={selectedClip?.id ?? null}
                  playheadUs={playheadUs}
                  pixelsPerSecond={pixelsPerSecond}
                  onSetPlayhead={setPlayheadUs}
                  onMoveClip={moveClip}
                  onTrimClip={trimClip}
                  onDropAsset={(asset, trackID, startUs) => addAsset(asset, startUs, trackID)}
                  onUpdateTrack={updateTrack}
                  assetStatuses={assetStatuses}
                  agentBaseURL={agentBaseURL}
                  projectID={projectID}
                  onSelectClip={(clip) => {
                    setSelectedClip(clip)
                    setInspectorOpen(true)
                  }}
                />
              </section>
            </>
          ) : null}
        </div>
        {selectedClip && inspectorOpen ? (
          <TimelineInspector
            clip={selectedClip}
            onClose={() => setInspectorOpen(false)}
            onUpdate={updateSelectedClip}
            onMove={(timelineStartUs) => moveClip(selectedClip, selectedClip.trackID, timelineStartUs)}
            onTrim={(next) => trimClip(selectedClip, next)}
            assetStatus={selectedClip.kind === "text" ? undefined : assetStatuses.get(selectedClip.assetRef.assetID)}
            onRequestReplacement={() => {
              setReplacementClipID(selectedClip.id)
              setMediaOpen(true)
            }}
          />
        ) : null}
      </div>
      {interactionError ? <div className="cinema-edit-interaction-error" role="alert">{interactionError}</div> : null}
      <div className="cinema-edit-narrow-guard" role="status">
        <strong>Edit needs a wider desktop window</strong>
        <span>Increase the window width to at least 760px to edit this Timeline.</span>
      </div>
    </section>
  )
}
