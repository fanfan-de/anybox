import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  Lock,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  MoveLeft,
  Pencil,
  Scissors,
  Search,
  Trash2,
  Volume2,
} from "lucide-react"
import type { CinemaAssetRecord, CinemaAssetStatus } from "@anybox/shared"
import { isCinemaTimelineClipCompatibleWithTrack } from "@anybox/shared/cinema-timeline"
import type { CinemaTimelineClip, CinemaTimelineDocument, CinemaTimelineTrack, CinemaTimelineTrackPatch } from "@anybox/shared/cinema-timeline"
import type { CSSProperties } from "react"
import type { TimelineClipPlacement, TimelineMoveTarget, TimelineMovingClip } from "../interaction/timelineInteractionTypes"
import { useTimelineAutoScroll } from "../interaction/useTimelineAutoScroll"
import { useTimelinePointerInteraction } from "../interaction/useTimelinePointerInteraction"
import {
  TIMELINE_TRACK_HEADER_WIDTH_PX,
  timelineCanvasWidth,
  timelineContentWidth,
  timelineVisibleContentRange,
} from "../model/timelineLayout"
import { formatTimelineTime, timelinePixelsToTime, timelineTimeToPixels } from "../model/timelineTime"
import { timelineSnapCandidates } from "../model/timelineSnap"
import {
  normalizedTimelineSelectionRect,
  timelineClipSelectionRects,
} from "../model/timelineSelection"
import { TimelineWaveform } from "./TimelineWaveform"
import { TimelineFilmstrip } from "./TimelineFilmstrip"
import {
  TimelineClipContextMenu,
  type TimelineClipContextMenuState,
} from "./TimelineClipContextMenu"
import { useI18n } from "../../../i18n"
import { visibleTimelineClips } from "../model/timelineVirtualization"
import { timelineRulerTicks } from "../model/timelineTicks"
import {
  timelinePointerAnchorTime,
  timelineScrollLeftForAnchor,
  timelineWheelZoom,
} from "../model/timelineViewport"
import {
  TimelineTrackDeleteDialog,
  type TimelineTrackDeleteRequest,
} from "./TimelineTrackDeleteDialog"

const ASSET_DRAG_TYPE = "application/x-anybox-cinema-timeline-asset"
const CLIP_KIND_LABEL_KEYS = {
  video: "timeline.kind.video",
  audio: "timeline.kind.audio",
  image: "timeline.kind.image",
  text: "timeline.kind.text",
} as const

function timelineMoveTargetAtPoint(
  timeline: CinemaTimelineDocument,
  clientX: number,
  clientY: number,
): TimelineMoveTarget | null {
  const element = document.elementFromPoint(clientX, clientY)
  const lane = element?.closest<HTMLElement>(".cinema-timeline-track-lane[data-timeline-track-id]")
  if (!lane) return null
  const track = timeline.tracks.find((candidate) => candidate.id === lane.dataset.timelineTrackId)
  if (!track) return null
  return {
    trackID: track.id,
    trackKind: track.kind,
    locked: track.locked,
    laneLeft: lane.getBoundingClientRect().left,
  }
}

function timelineGroupTrackTargets(
  timeline: CinemaTimelineDocument,
  movingClips: readonly TimelineMovingClip[],
  activeClipID: string,
  targetTrackID: string,
) {
  const tracks = [...timeline.tracks].sort((left, right) => left.order - right.order)
  const active = movingClips.find((clip) => clip.clipID === activeClipID)
  const activeSourceIndex = tracks.findIndex((track) => track.id === active?.trackID)
  const activeTargetIndex = tracks.findIndex((track) => track.id === targetTrackID)
  if (!active || activeSourceIndex < 0 || activeTargetIndex < 0) return null
  const trackOffset = activeTargetIndex - activeSourceIndex
  const targets: Record<string, string> = {}
  for (const movingClip of movingClips) {
    const clip = timeline.clips.find((candidate) => candidate.id === movingClip.clipID)
    const sourceIndex = tracks.findIndex((track) => track.id === movingClip.trackID)
    const sourceTrack = tracks[sourceIndex]
    const targetTrack = tracks[sourceIndex + trackOffset]
    if (
      !clip
      || !sourceTrack
      || !targetTrack
      || sourceTrack.locked
      || targetTrack.locked
      || !isCinemaTimelineClipCompatibleWithTrack(targetTrack.kind, clip.kind)
    ) return null
    targets[clip.id] = targetTrack.id
  }
  return targets
}

export function TimelineTrackArea({
  timeline,
  selectedClipIDs,
  playheadUs,
  playing,
  playbackDirection,
  followPlayhead,
  onFollowPlayheadChange,
  pixelsPerSecond,
  snapEnabled,
  onSelectClip,
  onSelectionChange,
  onSetPlayhead,
  onMoveClip,
  onMoveClips,
  onSplitSelection,
  onDuplicateSelection,
  onDeleteSelection,
  onRippleDeleteSelection,
  onShowClipInAssets,
  onTrimClip,
  onDropAsset,
  onUpdateTrack,
  onDeleteTrack,
  onReorderTrack,
  trackHeightsPx,
  collapsedTrackIDs,
  onTrackHeightChange,
  onToggleTrackCollapsed,
  scrollPosition,
  onScrollPositionChange,
  onZoom,
  assetStatuses,
  agentBaseURL,
  projectID,
}: {
  timeline: CinemaTimelineDocument
  selectedClipIDs: readonly string[]
  playheadUs: number
  playing: boolean
  playbackDirection: -1 | 1
  followPlayhead: boolean
  onFollowPlayheadChange: (follow: boolean) => void
  pixelsPerSecond: number
  snapEnabled: boolean
  onSelectClip: (clip: CinemaTimelineClip, toggle: boolean) => void
  onSelectionChange: (clipIDs: string[]) => void
  onSetPlayhead: (timeUs: number) => void
  onMoveClip: (clip: CinemaTimelineClip, trackID: string, startUs: number) => void
  onMoveClips: (placements: readonly TimelineClipPlacement[]) => void
  onSplitSelection: () => void
  onDuplicateSelection: () => void
  onDeleteSelection: () => void
  onRippleDeleteSelection: () => void
  onShowClipInAssets: (clip: CinemaTimelineClip) => void
  onTrimClip: (clip: CinemaTimelineClip, next: { timelineStartUs: number; durationUs: number; sourceInUs: number; sourceDurationUs: number }) => void
  onDropAsset: (asset: CinemaAssetRecord, trackID: string, startUs: number) => void
  onUpdateTrack: (track: CinemaTimelineTrack, patch: CinemaTimelineTrackPatch) => void
  onDeleteTrack: (track: CinemaTimelineTrack, deleteClips: boolean) => void
  onReorderTrack: (track: CinemaTimelineTrack, direction: -1 | 1) => void
  trackHeightsPx: Readonly<Record<string, number>>
  collapsedTrackIDs: readonly string[]
  onTrackHeightChange: (trackID: string, heightPx: number) => void
  onToggleTrackCollapsed: (trackID: string) => void
  scrollPosition: { scrollLeft: number; scrollTop: number }
  onScrollPositionChange: (position: { scrollLeft: number; scrollTop: number }) => void
  onZoom: (pixelsPerSecond: number) => void
  assetStatuses: ReadonlyMap<string, CinemaAssetStatus | "unresolved">
  agentBaseURL: string
  projectID: string
}) {
  const { t } = useI18n()
  const scrollRef = useRef<HTMLDivElement>(null)
  const rulerRef = useRef<HTMLDivElement>(null)
  const tracksRef = useRef<HTMLDivElement>(null)
  const zoomAnchorRef = useRef<{ timeUs: number; pointerOffsetX: number } | null>(null)
  const ignoreScrollUntilRef = useRef(0)
  const previousScrollLeftRef = useRef(0)
  const followResumeArmedRef = useRef(false)
  const [contextMenu, setContextMenu] = useState<(TimelineClipContextMenuState & { clipID: string }) | null>(null)
  const [trackMenu, setTrackMenu] = useState<(TimelineClipContextMenuState & { trackID: string }) | null>(null)
  const [deleteTrackRequest, setDeleteTrackRequest] = useState<TimelineTrackDeleteRequest | null>(null)
  const [renamingTrackID, setRenamingTrackID] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState("")
  const renameInputRef = useRef<HTMLInputElement>(null)
  const resizeTrackRef = useRef<{
    pointerID: number
    trackID: string
    originClientY: number
    originHeight: number
  } | null>(null)
  const [viewport, setViewport] = useState({ scrollLeft: 0, width: 1200 })
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    ignoreScrollUntilRef.current = performance.now() + 100
    element.scrollLeft = scrollPosition.scrollLeft
    element.scrollTop = scrollPosition.scrollTop
    previousScrollLeftRef.current = element.scrollLeft
    setViewport({ scrollLeft: element.scrollLeft, width: element.clientWidth })
  }, [timeline.id])
  useLayoutEffect(() => {
    const element = scrollRef.current
    const anchor = zoomAnchorRef.current
    if (!element || !anchor) return
    zoomAnchorRef.current = null
    ignoreScrollUntilRef.current = performance.now() + 100
    element.scrollLeft = Math.min(
      Math.max(0, element.scrollWidth - element.clientWidth),
      timelineScrollLeftForAnchor(
        anchor.timeUs,
        anchor.pointerOffsetX,
        TIMELINE_TRACK_HEADER_WIDTH_PX,
        pixelsPerSecond,
      ),
    )
    setViewport({ scrollLeft: element.scrollLeft, width: element.clientWidth })
    onScrollPositionChange({ scrollLeft: element.scrollLeft, scrollTop: element.scrollTop })
  }, [onScrollPositionChange, pixelsPerSecond])
  useEffect(() => {
    if (playing) return
    followResumeArmedRef.current = false
  }, [playing])
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element || !playing) return
    const usableWidth = Math.max(1, element.clientWidth - TIMELINE_TRACK_HEADER_WIDTH_PX)
    const playheadContentX = TIMELINE_TRACK_HEADER_WIDTH_PX
      + timelineTimeToPixels(playheadUs, pixelsPerSecond)
    const playheadRatio = (
      playheadContentX
      - element.scrollLeft
      - TIMELINE_TRACK_HEADER_WIDTH_PX
    ) / usableWidth
    const atFollowEdge = playbackDirection > 0 ? playheadRatio >= 0.82 : playheadRatio <= 0.18
    if (!followPlayhead) {
      if (!atFollowEdge) {
        followResumeArmedRef.current = true
        return
      }
      if (!followResumeArmedRef.current) return
      followResumeArmedRef.current = false
      onFollowPlayheadChange(true)
      return
    }
    if (!atFollowEdge) return
    const targetRatio = playbackDirection > 0 ? 0.35 : 0.65
    const nextScrollLeft = Math.min(
      Math.max(0, element.scrollWidth - element.clientWidth),
      Math.max(
        0,
        playheadContentX
          - TIMELINE_TRACK_HEADER_WIDTH_PX
          - usableWidth * targetRatio,
      ),
    )
    if (Math.abs(nextScrollLeft - element.scrollLeft) < 1) return
    ignoreScrollUntilRef.current = performance.now() + 100
    element.scrollLeft = nextScrollLeft
    previousScrollLeftRef.current = element.scrollLeft
    setViewport({ scrollLeft: element.scrollLeft, width: element.clientWidth })
    onScrollPositionChange({ scrollLeft: element.scrollLeft, scrollTop: element.scrollTop })
  }, [followPlayhead, onFollowPlayheadChange, onScrollPositionChange, pixelsPerSecond, playbackDirection, playheadUs, playing])
  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const update = () => setViewport({ scrollLeft: element.scrollLeft, width: element.clientWidth })
    update()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const durationUs = timeline.clips.reduce((duration, clip) => Math.max(duration, clip.timelineStartUs + clip.durationUs), 0)
  const orderedTimelineTracks = useMemo(
    () => [...timeline.tracks].sort((left, right) => left.order - right.order),
    [timeline.tracks],
  )
  const collapsedTrackIDSet = useMemo(() => new Set(collapsedTrackIDs), [collapsedTrackIDs])
  const contentWidth = timelineContentWidth(durationUs, pixelsPerSecond)
  const canvasWidth = timelineCanvasWidth(contentWidth)
  const rulerTicks = useMemo(() => timelineRulerTicks({
    pixelsPerSecond,
    frameRate: timeline.settings.frameRate,
    scrollLeft: viewport.scrollLeft,
    viewportWidth: viewport.width,
    trackHeaderWidth: TIMELINE_TRACK_HEADER_WIDTH_PX,
    durationUs: Math.ceil(contentWidth / pixelsPerSecond * 1_000_000),
  }), [contentWidth, pixelsPerSecond, timeline.settings.frameRate, viewport])
  const visibleClipIDs = useMemo(
    () => new Set(visibleTimelineClips(timeline.clips, viewport, pixelsPerSecond).map((clip) => clip.id)),
    [pixelsPerSecond, timeline.clips, viewport],
  )
  const visibleContentRange = useMemo(
    () => timelineVisibleContentRange(viewport, 144),
    [viewport],
  )
  const selectedClipIDSet = useMemo(() => new Set(selectedClipIDs), [selectedClipIDs])
  const selectionRects = useMemo(
    () => timelineClipSelectionRects(timeline, pixelsPerSecond, {
      trackHeightsPx,
      collapsedTrackIDs: collapsedTrackIDSet,
    }),
    [collapsedTrackIDSet, pixelsPerSecond, timeline, trackHeightsPx],
  )
  const selectedClips = useMemo(() => selectedClipIDs.flatMap((clipID) => {
    const clip = timeline.clips.find((candidate) => candidate.id === clipID)
    return clip ? [clip] : []
  }), [selectedClipIDs, timeline.clips])
  const selectedTracksLocked = selectedClips.some((clip) => timeline.tracks.find((track) => track.id === clip.trackID)?.locked)
  const selectedTrackCount = new Set(selectedClips.map((clip) => clip.trackID)).size
  const contextClip = contextMenu ? timeline.clips.find((clip) => clip.id === contextMenu.clipID) ?? null : null
  const contextTrack = trackMenu ? timeline.tracks.find((track) => track.id === trackMenu.trackID) ?? null : null
  const contextTrackIndex = contextTrack
    ? orderedTimelineTracks.findIndex((track) => track.id === contextTrack.id)
    : -1
  const canSplitSelection = selectedClips.length === 1
    && playheadUs > selectedClips[0]!.timelineStartUs
    && playheadUs < selectedClips[0]!.timelineStartUs + selectedClips[0]!.durationUs
    && !selectedTracksLocked
  const pointerInteraction = useTimelinePointerInteraction({
    pixelsPerSecond,
    onCommitMove: (placements) => {
      if (placements.length === 1) {
        const placement = placements[0]!
        const clip = timeline.clips.find((candidate) => candidate.id === placement.clipID)
        if (clip) onMoveClip(clip, placement.trackID, placement.timelineStartUs)
      } else {
        onMoveClips(placements)
      }
    },
    onCommitTrim: (clipID, draft) => {
      const clip = timeline.clips.find((candidate) => candidate.id === clipID)
      if (clip) onTrimClip(clip, draft)
    },
    onScrubPlayhead: onSetPlayhead,
    onSelectionChange,
  })
  useEffect(() => {
    if (!renamingTrackID) return
    const frame = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [renamingTrackID])
  const commitTrackRename = (track: CinemaTimelineTrack) => {
    const title = renameDraft.trim()
    setRenamingTrackID(null)
    if (title && title !== track.title) onUpdateTrack(track, { title })
  }
  const updatePointerAt = (pointer: {
    pointerID: number
    clientX: number
    clientY: number
  }) => {
    const moveTarget = timelineMoveTargetAtPoint(timeline, pointer.clientX, pointer.clientY)
    const movingInteraction = pointerInteraction.interaction.type === "moving-clip"
      ? pointerInteraction.interaction
      : null
    const targetTrackIDs = moveTarget && movingInteraction
      ? timelineGroupTrackTargets(
          timeline,
          movingInteraction.originalClips,
          movingInteraction.activeClipID,
          moveTarget.trackID,
        )
      : null
    pointerInteraction.updateClipMove({
      pointerID: pointer.pointerID,
      clientX: pointer.clientX,
      target: moveTarget,
      targetTrackIDs: targetTrackIDs ?? undefined,
      validTarget: moveTarget ? targetTrackIDs !== null : undefined,
    })
    pointerInteraction.updateTrim({
      pointerID: pointer.pointerID,
      clientX: pointer.clientX,
    })
    if (rulerRef.current) {
      pointerInteraction.updateScrub({
        pointerID: pointer.pointerID,
        clientX: pointer.clientX,
        rulerLeft: rulerRef.current.getBoundingClientRect().left,
      })
    }
    if (pointerInteraction.interaction.type === "marquee-selecting" && tracksRef.current) {
      const tracksRect = tracksRef.current.getBoundingClientRect()
      pointerInteraction.updateMarquee({
        pointerID: pointer.pointerID,
        current: {
          x: pointer.clientX - tracksRect.left,
          y: pointer.clientY - tracksRect.top,
        },
        clipRects: selectionRects,
      })
    }
  }
  const autoScroll = useTimelineAutoScroll({
    scrollRef,
    active: pointerInteraction.interaction.type !== "idle",
    leftInset: TIMELINE_TRACK_HEADER_WIDTH_PX,
    onScrollFrame: updatePointerAt,
  })
  const updatePointerInteraction = (event: React.PointerEvent<HTMLDivElement>) => {
    const pointer = {
      pointerID: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
    }
    autoScroll.updatePointer(pointer)
    updatePointerAt(pointer)
  }
  const beginPlayheadScrub = (
    event: React.PointerEvent<HTMLElement>,
    rulerLeft: number,
  ) => {
    if (!event.isPrimary || event.button !== 0 || !scrollRef.current) return
    event.preventDefault()
    event.stopPropagation()
    pointerInteraction.beginScrub({
      pointerID: event.pointerId,
      clientX: event.clientX,
      rulerLeft,
      originalPlayheadUs: playheadUs,
      captureTarget: scrollRef.current,
    })
  }
  const beginClipTrim = (
    event: React.PointerEvent<HTMLSpanElement>,
    clip: CinemaTimelineClip,
    edge: "start" | "end",
    track: CinemaTimelineTrack,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    onSelectClip(clip, false)
    if (clip.kind === "text" || track.locked || !scrollRef.current) return
    const minimumDurationUs = Math.max(
      1,
      Math.round(1_000_000 / 120),
      clip.kind === "audio" ? (clip.fadeInUs ?? 0) + (clip.fadeOutUs ?? 0) : 0,
    )
    pointerInteraction.beginTrim({
      pointerID: event.pointerId,
      clientX: event.clientX,
      clipID: clip.id,
      edge,
      originalClip: {
        timelineStartUs: clip.timelineStartUs,
        durationUs: clip.durationUs,
        sourceInUs: clip.sourceInUs,
        sourceDurationUs: clip.sourceDurationUs,
      },
      minimumDurationUs,
      assetDurationUs: clip.assetRef.snapshot.durationSeconds === undefined
        ? null
        : Math.round(clip.assetRef.snapshot.durationSeconds * 1_000_000),
      snapCandidates: snapEnabled
        ? timelineSnapCandidates(timeline, [clip.id], [playheadUs])
        : [],
      captureTarget: scrollRef.current,
    })
  }
  const movingClipIDs = pointerInteraction.interaction.type === "moving-clip"
    ? new Set(pointerInteraction.interaction.originalClips.map((clip) => clip.clipID))
    : new Set<string>()
  const snapGuideUs = pointerInteraction.interaction.type === "moving-clip"
    || pointerInteraction.interaction.type === "trimming-clip"
    ? pointerInteraction.interaction.snapGuideUs
    : null
  const marqueeRect = pointerInteraction.interaction.type === "marquee-selecting"
    ? normalizedTimelineSelectionRect(
        pointerInteraction.interaction.origin,
        pointerInteraction.interaction.current,
      )
    : null

  return (
    <div
      ref={scrollRef}
      className={`cinema-timeline-scroll-region ${pointerInteraction.interaction.type !== "idle" ? "is-pointer-active" : ""}`}
      tabIndex={0}
      aria-label={t("timeline.tracks")}
      data-pixels-per-second={pixelsPerSecond}
      style={{ "--cinema-timeline-track-header-width": `${TIMELINE_TRACK_HEADER_WIDTH_PX}px` } as CSSProperties}
      onScroll={(event) => {
        const element = event.currentTarget
        if (
          playing
          && performance.now() > ignoreScrollUntilRef.current
          && Math.abs(element.scrollLeft - previousScrollLeftRef.current) >= 1
        ) {
          followResumeArmedRef.current = false
          onFollowPlayheadChange(false)
        }
        previousScrollLeftRef.current = element.scrollLeft
        setViewport({ scrollLeft: element.scrollLeft, width: element.clientWidth })
        onScrollPositionChange({ scrollLeft: element.scrollLeft, scrollTop: element.scrollTop })
      }}
      onWheel={(event) => {
        const element = event.currentTarget
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault()
          if (pointerInteraction.interaction.type !== "idle") return
          const nextPixelsPerSecond = timelineWheelZoom(pixelsPerSecond, event.deltaY)
          if (nextPixelsPerSecond === pixelsPerSecond) return
          const pointerOffsetX = event.clientX - element.getBoundingClientRect().left
          zoomAnchorRef.current = {
            timeUs: timelinePointerAnchorTime(
              element.scrollLeft,
              pointerOffsetX,
              TIMELINE_TRACK_HEADER_WIDTH_PX,
              pixelsPerSecond,
            ),
            pointerOffsetX,
          }
          onZoom(nextPixelsPerSecond)
          return
        }
        event.preventDefault()
        if (event.shiftKey) {
          if (playing) {
            followResumeArmedRef.current = false
            onFollowPlayheadChange(false)
          }
          element.scrollLeft += Math.abs(event.deltaX) > Math.abs(event.deltaY)
            ? event.deltaX
            : event.deltaY
          return
        }
        element.scrollTop += event.deltaY
      }}
      onPointerMove={updatePointerInteraction}
      onPointerUp={(event) => {
        updatePointerInteraction(event)
        autoScroll.stop()
        pointerInteraction.commitClipMove(event.pointerId)
        pointerInteraction.commitTrim(event.pointerId)
        pointerInteraction.commitScrub(event.pointerId)
        pointerInteraction.commitMarquee(event.pointerId)
      }}
      onPointerCancel={(event) => {
        autoScroll.stop()
        pointerInteraction.cancel(event.pointerId)
      }}
      onLostPointerCapture={(event) => {
        autoScroll.stop()
        pointerInteraction.cancel(event.pointerId)
      }}
    >
      <TimelineClipContextMenu
        menu={contextMenu}
        onClose={() => setContextMenu(null)}
        actions={[
          {
            id: "split",
            label: t("timeline.split"),
            icon: <Scissors />,
            shortcut: "S",
            disabled: !canSplitSelection,
            onSelect: onSplitSelection,
          },
          {
            id: "duplicate",
            label: t("timeline.duplicateClips"),
            icon: <Copy />,
            shortcut: "Ctrl+D",
            disabled: selectedClips.length === 0 || selectedTracksLocked,
            onSelect: onDuplicateSelection,
          },
          {
            id: "delete",
            label: t("timeline.deleteClips"),
            icon: <Trash2 />,
            shortcut: "Del",
            disabled: selectedClips.length === 0 || selectedTracksLocked,
            variant: "danger",
            onSelect: onDeleteSelection,
          },
          {
            id: "ripple-delete",
            label: t("timeline.rippleDelete"),
            icon: <MoveLeft />,
            disabled: selectedClips.length === 0 || selectedTracksLocked || selectedTrackCount !== 1,
            variant: "danger",
            onSelect: onRippleDeleteSelection,
          },
          {
            id: "show-in-assets",
            label: t("timeline.showInAssets"),
            icon: <Search />,
            disabled: !contextClip || contextClip.kind === "text",
            onSelect: () => {
              if (contextClip) onShowClipInAssets(contextClip)
            },
          },
        ]}
      />
      <TimelineClipContextMenu
        menu={trackMenu}
        onClose={() => setTrackMenu(null)}
        actions={[
          {
            id: "rename-track",
            label: t("timeline.renameTrack"),
            icon: <Pencil />,
            onSelect: () => {
              if (!contextTrack) return
              setRenameDraft(contextTrack.title)
              setRenamingTrackID(contextTrack.id)
            },
          },
          {
            id: "move-track-up",
            label: t("timeline.moveTrackUp"),
            icon: <ArrowUp />,
            disabled: !contextTrack || contextTrackIndex <= 0,
            onSelect: () => {
              if (contextTrack) onReorderTrack(contextTrack, -1)
            },
          },
          {
            id: "move-track-down",
            label: t("timeline.moveTrackDown"),
            icon: <ArrowDown />,
            disabled: !contextTrack || contextTrackIndex < 0 || contextTrackIndex >= orderedTimelineTracks.length - 1,
            onSelect: () => {
              if (contextTrack) onReorderTrack(contextTrack, 1)
            },
          },
          {
            id: "toggle-track-collapsed",
            label: t(contextTrack && collapsedTrackIDSet.has(contextTrack.id) ? "timeline.expandTrack" : "timeline.collapseTrack"),
            icon: contextTrack && collapsedTrackIDSet.has(contextTrack.id) ? <Maximize2 /> : <Minimize2 />,
            disabled: !contextTrack,
            onSelect: () => {
              if (contextTrack) onToggleTrackCollapsed(contextTrack.id)
            },
          },
          {
            id: "delete-track",
            label: t("timeline.deleteTrack"),
            icon: <Trash2 />,
            variant: "danger",
            disabled: !contextTrack || contextTrack.locked,
            onSelect: () => {
              if (!contextTrack) return
              setDeleteTrackRequest({
                track: contextTrack,
                clipCount: timeline.clips.filter((clip) => clip.trackID === contextTrack.id).length,
                returnFocus: scrollRef.current ?? trackMenu?.returnFocus ?? document.body,
              })
            },
          },
        ]}
      />
      <TimelineTrackDeleteDialog
        request={deleteTrackRequest}
        onCancel={() => setDeleteTrackRequest(null)}
        onConfirm={() => {
          if (!deleteTrackRequest) return
          onDeleteTrack(deleteTrackRequest.track, deleteTrackRequest.clipCount > 0)
          setDeleteTrackRequest(null)
        }}
      />
      <div
        ref={rulerRef}
        className="cinema-timeline-ruler"
        style={{ width: contentWidth }}
        onPointerDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          beginPlayheadScrub(event, rect.left)
        }}
      >
        {rulerTicks.map((tick) => (
          <span
            key={tick.timeUs}
            className={tick.major ? "is-major" : "is-minor"}
            style={{ left: tick.leftPx }}
            data-ruler-time-us={tick.timeUs}
          >
            {tick.label ? <small>{tick.label}</small> : null}
          </span>
        ))}
      </div>
      <div ref={tracksRef} className="cinema-timeline-tracks" style={{ width: canvasWidth }}>
        {marqueeRect ? (
          <div
            className="cinema-timeline-marquee"
            style={{
              left: marqueeRect.left,
              top: marqueeRect.top,
              width: marqueeRect.right - marqueeRect.left,
              height: marqueeRect.bottom - marqueeRect.top,
            }}
            aria-hidden="true"
          />
        ) : null}
        {snapGuideUs !== null ? (
          <div
            className="cinema-timeline-snap-guide"
            data-snap-time-us={snapGuideUs}
            style={{ left: TIMELINE_TRACK_HEADER_WIDTH_PX + timelineTimeToPixels(snapGuideUs, pixelsPerSecond) }}
            aria-hidden="true"
          >
            <span>{formatTimelineTime(snapGuideUs)}</span>
          </div>
        ) : null}
        <div
          className="cinema-timeline-playhead"
          data-pointer-state={pointerInteraction.interaction.type === "scrubbing-playhead" ? "scrubbing" : "idle"}
          style={{ left: TIMELINE_TRACK_HEADER_WIDTH_PX + timelineTimeToPixels(playheadUs, pixelsPerSecond) }}
          aria-hidden="true"
          onPointerDown={(event) => {
            if (rulerRef.current) beginPlayheadScrub(event, rulerRef.current.getBoundingClientRect().left)
          }}
        />
        {orderedTimelineTracks.map((track) => {
          const collapsed = collapsedTrackIDSet.has(track.id)
          const trackHeight = collapsed ? 36 : trackHeightsPx[track.id] ?? 72
          return (
          <div
            className={`cinema-timeline-track ${collapsed ? "is-collapsed" : ""}`}
            data-track-id={track.id}
            data-track-order={track.order}
            key={track.id}
            style={{ "--cinema-timeline-track-height": `${trackHeight}px` } as CSSProperties}
          >
            <div
              className="cinema-timeline-track-header"
              onContextMenu={(event) => {
                event.preventDefault()
                setContextMenu(null)
                setTrackMenu({
                  trackID: track.id,
                  x: event.clientX,
                  y: event.clientY,
                  label: t("timeline.trackActions", { name: track.title }),
                  returnFocus: event.currentTarget,
                })
              }}
            >
              {renamingTrackID === track.id ? (
                <input
                  ref={renameInputRef}
                  className="cinema-timeline-track-title-input"
                  value={renameDraft}
                  aria-label={t("timeline.renameTrack")}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onBlur={() => commitTrackRename(track)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      commitTrackRename(track)
                    } else if (event.key === "Escape") {
                      event.preventDefault()
                      setRenamingTrackID(null)
                    }
                  }}
                />
              ) : <strong title={track.title}>{track.title}</strong>}
              <div>
                <button type="button" aria-label={t("timeline.trackLock", { name: track.title })} title={t(track.locked ? "timeline.unlockTrack" : "timeline.lockTrack")} aria-pressed={track.locked} onClick={() => onUpdateTrack(track, { locked: !track.locked })}><Lock aria-hidden="true" /></button>
                <button type="button" aria-label={t("timeline.trackMute", { name: track.title })} title={t(track.muted ? "timeline.unmuteTrack" : "timeline.muteTrack")} aria-pressed={track.muted} onClick={() => onUpdateTrack(track, { muted: !track.muted })}><Volume2 aria-hidden="true" /></button>
                <button type="button" aria-label={t("timeline.trackVisibility", { name: track.title })} title={t(track.hidden ? "timeline.showTrack" : "timeline.hideTrack")} aria-pressed={!track.hidden} onClick={() => onUpdateTrack(track, { hidden: !track.hidden })}><Eye aria-hidden="true" /></button>
                <button
                  type="button"
                  className="cinema-timeline-track-menu-button"
                  aria-label={t("timeline.trackActions", { name: track.title })}
                  title={t("timeline.trackActions", { name: track.title })}
                  aria-haspopup="menu"
                  aria-expanded={trackMenu?.trackID === track.id}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    setContextMenu(null)
                    setTrackMenu({
                      trackID: track.id,
                      x: rect.left,
                      y: rect.bottom + 4,
                      label: t("timeline.trackActions", { name: track.title }),
                      returnFocus: event.currentTarget,
                    })
                  }}
                ><MoreHorizontal aria-hidden="true" /></button>
              </div>
            </div>
            <div
              className="cinema-timeline-track-lane"
              data-timeline-track-id={track.id}
              onPointerDown={(event) => {
                if (event.target !== event.currentTarget) return
                const rect = event.currentTarget.getBoundingClientRect()
                onSetPlayhead(timelinePixelsToTime(event.clientX - rect.left, pixelsPerSecond))
                if (!event.isPrimary || event.button !== 0 || !scrollRef.current || !tracksRef.current) return
                event.preventDefault()
                const tracksRect = tracksRef.current.getBoundingClientRect()
                pointerInteraction.beginMarquee({
                  pointerID: event.pointerId,
                  origin: {
                    x: event.clientX - tracksRect.left,
                    y: event.clientY - tracksRect.top,
                  },
                  originalSelectedClipIDs: selectedClipIDs,
                  captureTarget: scrollRef.current,
                })
              }}
              onDragOver={(event) => {
                if (track.locked) return
                if (event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = "copy"
                }
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (track.locked) return
                const rect = event.currentTarget.getBoundingClientRect()
                const startUs = timelinePixelsToTime(event.clientX - rect.left, pixelsPerSecond)
                const rawAsset = event.dataTransfer.getData(ASSET_DRAG_TYPE)
                if (!rawAsset) return
                try {
                  onDropAsset(JSON.parse(rawAsset) as CinemaAssetRecord, track.id, startUs)
                } catch {
                  // Ignore malformed external drag data.
                }
              }}
            >
              {timeline.clips.filter((clip) => {
                const placement = pointerInteraction.interaction.type === "moving-clip"
                  ? pointerInteraction.interaction.draftClips.find((draft) => draft.clipID === clip.id) ?? clip
                  : clip
                return placement.trackID === track.id && (visibleClipIDs.has(clip.id) || movingClipIDs.has(clip.id))
              }).map((clip) => {
                const activeMove = pointerInteraction.interaction.type === "moving-clip"
                  && pointerInteraction.interaction.originalClips.some((original) => original.clipID === clip.id)
                  ? pointerInteraction.interaction
                  : null
                const moving = activeMove !== null
                const activeTrim = pointerInteraction.interaction.type === "trimming-clip"
                  && pointerInteraction.interaction.clipID === clip.id
                  ? pointerInteraction.interaction
                  : null
                const placement = activeMove?.draftClips.find((draft) => draft.clipID === clip.id) ?? clip
                const renderedTimelineStartUs = activeTrim?.draft.timelineStartUs ?? placement.timelineStartUs
                const renderedDurationUs = activeTrim?.draft.durationUs ?? clip.durationUs
                const renderedLeftPx = timelineTimeToPixels(renderedTimelineStartUs, pixelsPerSecond)
                const renderedWidthPx = Math.max(32, timelineTimeToPixels(renderedDurationUs, pixelsPerSecond))
                const selected = selectedClipIDSet.has(clip.id)
                const assetStatus = clip.kind === "text" ? undefined : assetStatuses.get(clip.assetRef.assetID)
                const assetUnavailable = assetStatus !== undefined && assetStatus !== "ready" && assetStatus !== "unresolved"
                const clipMeta = assetUnavailable
                  ? t("timeline.assetUnavailable", { status: assetStatus })
                  : t(CLIP_KIND_LABEL_KEYS[clip.kind])
                return (
                  <div
                    key={clip.id}
                    data-clip-id={clip.id}
                    data-pointer-state={moving ? "moving" : activeTrim ? "trimming" : "idle"}
                    role="button"
                    tabIndex={0}
                    className={`cinema-timeline-clip is-${clip.kind} ${selected ? "is-selected" : ""} ${moving ? "is-moving" : ""} ${activeTrim ? "is-trimming" : ""} ${activeMove && !activeMove.validTarget ? "is-invalid-drop" : ""} ${clip.kind !== "text" && assetStatuses.get(clip.assetRef.assetID) !== undefined && assetStatuses.get(clip.assetRef.assetID) !== "ready" && assetStatuses.get(clip.assetRef.assetID) !== "unresolved" ? "is-asset-unavailable" : ""}`}
                    style={{
                      left: renderedLeftPx,
                      width: renderedWidthPx,
                    }}
                    aria-pressed={selected}
                    aria-label={t("timeline.clipLabel", { name: clip.title, meta: clipMeta })}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      if (!selected) onSelectClip(clip, false)
                      setTrackMenu(null)
                      setContextMenu({
                        clipID: clip.id,
                        x: event.clientX,
                        y: event.clientY,
                        label: t("timeline.clipActions", { name: clip.title }),
                        returnFocus: event.currentTarget,
                      })
                    }}
                    onPointerDown={(event) => {
                      if (event.shiftKey || !selected || selectedClipIDs.length === 1) {
                        onSelectClip(clip, event.shiftKey)
                      }
                      if (event.shiftKey || !event.isPrimary || event.button !== 0 || track.locked || !scrollRef.current) return
                      event.preventDefault()
                      const rect = event.currentTarget.getBoundingClientRect()
                      const groupClips = selectedClipIDSet.has(clip.id)
                        ? selectedClipIDs.flatMap((clipID) => {
                            const selected = timeline.clips.find((candidate) => candidate.id === clipID)
                            return selected ? [selected] : []
                          })
                        : [clip]
                      pointerInteraction.beginClipMove({
                        pointerID: event.pointerId,
                        clientX: event.clientX,
                        clipLeft: rect.left,
                        snapCandidates: snapEnabled
                          ? timelineSnapCandidates(timeline, groupClips.map((candidate) => candidate.id), [playheadUs])
                          : [],
                        activeClipID: clip.id,
                        clips: groupClips.map((candidate) => ({
                          clipID: candidate.id,
                          trackID: candidate.trackID,
                          timelineStartUs: candidate.timelineStartUs,
                          durationUs: candidate.durationUs,
                        })),
                        captureTarget: scrollRef.current,
                      })
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        onSelectClip(clip, false)
                      }
                    }}
                    title={clip.title}
                  >
                    {clip.kind !== "text" ? <span className="cinema-timeline-trim-handle is-start" role="separator" aria-label={t("timeline.trimStart", { name: clip.title })} onPointerDown={(event) => beginClipTrim(event, clip, "start", track)} /> : null}
                    {clip.kind === "video" ? (
                      <TimelineFilmstrip
                        agentBaseURL={agentBaseURL}
                        projectID={projectID}
                        clip={clip}
                        clipLeftPx={renderedLeftPx}
                        clipWidthPx={renderedWidthPx}
                        visibleStartPx={visibleContentRange.start}
                        visibleEndPx={visibleContentRange.end}
                        ready={assetStatus === "ready"}
                      />
                    ) : null}
                    {clip.kind === "audio" ? <TimelineWaveform agentBaseURL={agentBaseURL} projectID={projectID} timelineID={timeline.id} clip={clip} /> : null}
                    <span className="cinema-timeline-clip-label">
                      <span>{clip.title}</span>
                      <small data-asset-status={assetStatus ?? "none"}>{clipMeta}</small>
                    </span>
                    {clip.kind !== "text" ? <span className="cinema-timeline-trim-handle is-end" role="separator" aria-label={t("timeline.trimEnd", { name: clip.title })} onPointerDown={(event) => beginClipTrim(event, clip, "end", track)} /> : null}
                  </div>
                )
              })}
            </div>
            {!collapsed ? (
              <div
                className="cinema-timeline-track-resize-handle"
                role="separator"
                tabIndex={0}
                aria-orientation="horizontal"
                aria-label={t("timeline.resizeTrack", { name: track.title })}
                aria-valuemin={72}
                aria-valuemax={240}
                aria-valuenow={trackHeight}
                onPointerDown={(event) => {
                  if (!event.isPrimary || event.button !== 0) return
                  event.preventDefault()
                  event.stopPropagation()
                  resizeTrackRef.current = {
                    pointerID: event.pointerId,
                    trackID: track.id,
                    originClientY: event.clientY,
                    originHeight: trackHeight,
                  }
                  event.currentTarget.setPointerCapture(event.pointerId)
                }}
                onPointerMove={(event) => {
                  const resize = resizeTrackRef.current
                  if (!resize || resize.pointerID !== event.pointerId || resize.trackID !== track.id) return
                  onTrackHeightChange(track.id, resize.originHeight + event.clientY - resize.originClientY)
                }}
                onPointerUp={(event) => {
                  if (resizeTrackRef.current?.pointerID !== event.pointerId) return
                  resizeTrackRef.current = null
                  event.currentTarget.releasePointerCapture(event.pointerId)
                }}
                onPointerCancel={() => { resizeTrackRef.current = null }}
                onKeyDown={(event) => {
                  const increment = event.shiftKey ? 24 : 8
                  if (event.key === "ArrowUp") {
                    event.preventDefault()
                    onTrackHeightChange(track.id, trackHeight - increment)
                  } else if (event.key === "ArrowDown") {
                    event.preventDefault()
                    onTrackHeightChange(track.id, trackHeight + increment)
                  } else if (event.key === "Home") {
                    event.preventDefault()
                    onTrackHeightChange(track.id, 72)
                  } else if (event.key === "End") {
                    event.preventDefault()
                    onTrackHeightChange(track.id, 240)
                  }
                }}
              />
            ) : null}
          </div>
        )})}
      </div>
    </div>
  )
}
