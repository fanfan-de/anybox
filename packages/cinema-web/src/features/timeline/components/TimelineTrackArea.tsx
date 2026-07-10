import { useEffect, useMemo, useRef, useState } from "react"
import { Eye, Lock, Volume2 } from "lucide-react"
import type { CinemaAssetRecord, CinemaAssetStatus } from "@anybox/shared"
import type { CinemaTimelineClip, CinemaTimelineDocument, CinemaTimelineTrack, CinemaTimelineTrackPatch } from "@anybox/shared/cinema-timeline"
import { timelinePixelsToTime, timelineTimeToPixels } from "../model/timelineTime"
import { TimelineWaveform } from "./TimelineWaveform"
import { visibleTimelineClips } from "../model/timelineVirtualization"

const MIN_TRACK_WIDTH = 1800
const CLIP_DRAG_TYPE = "application/x-anybox-cinema-timeline-clip"
const ASSET_DRAG_TYPE = "application/x-anybox-cinema-timeline-asset"

function beginTrim(
  event: React.PointerEvent<HTMLSpanElement>,
  clip: CinemaTimelineClip,
  side: "start" | "end",
  pixelsPerSecond: number,
  onTrimClip: (clip: CinemaTimelineClip, next: {
    timelineStartUs: number
    durationUs: number
    sourceInUs: number
    sourceDurationUs: number
  }) => void,
) {
  if (clip.kind === "text") return
  event.preventDefault()
  event.stopPropagation()
  const element = event.currentTarget.parentElement
  if (!element) return
  const startClientX = event.clientX
  const originalLeft = timelineTimeToPixels(clip.timelineStartUs, pixelsPerSecond)
  const originalWidth = timelineTimeToPixels(clip.durationUs, pixelsPerSecond)
  const sourceRatio = clip.sourceDurationUs / clip.durationUs
  let finalDeltaUs = 0

  const move = (pointerEvent: PointerEvent) => {
    const rawDeltaUs = timelinePixelsToTime(Math.abs(pointerEvent.clientX - startClientX), pixelsPerSecond)
      * Math.sign(pointerEvent.clientX - startClientX)
    const minimumDurationUs = Math.max(
      1,
      Math.round(1_000_000 / 120),
      clip.kind === "audio" ? (clip.fadeInUs ?? 0) + (clip.fadeOutUs ?? 0) : 0,
    )
    if (side === "start") {
      const minimumDeltaUs = -Math.round(clip.sourceInUs / Math.max(sourceRatio, Number.EPSILON))
      finalDeltaUs = Math.max(minimumDeltaUs, Math.min(clip.durationUs - minimumDurationUs, rawDeltaUs))
      element.style.left = `${originalLeft + timelineTimeToPixels(finalDeltaUs, pixelsPerSecond)}px`
      element.style.width = `${originalWidth - timelineTimeToPixels(finalDeltaUs, pixelsPerSecond)}px`
    } else {
      const knownAssetDurationUs = clip.assetRef.snapshot.durationSeconds === undefined
        ? Number.MAX_SAFE_INTEGER
        : Math.round(clip.assetRef.snapshot.durationSeconds * 1_000_000)
      const maximumSourceDeltaUs = knownAssetDurationUs - clip.sourceInUs - clip.sourceDurationUs
      const maximumDeltaUs = Math.round(maximumSourceDeltaUs / Math.max(sourceRatio, Number.EPSILON))
      finalDeltaUs = Math.max(-clip.durationUs + minimumDurationUs, Math.min(maximumDeltaUs, rawDeltaUs))
      element.style.width = `${originalWidth + timelineTimeToPixels(finalDeltaUs, pixelsPerSecond)}px`
    }
  }
  const stop = () => {
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", stop)
    window.removeEventListener("pointercancel", stop)
    element.style.left = `${originalLeft}px`
    element.style.width = `${originalWidth}px`
    if (finalDeltaUs === 0) return
    const sourceDeltaUs = Math.round(finalDeltaUs * sourceRatio)
    onTrimClip(clip, side === "start" ? {
      timelineStartUs: clip.timelineStartUs + finalDeltaUs,
      durationUs: clip.durationUs - finalDeltaUs,
      sourceInUs: clip.sourceInUs + sourceDeltaUs,
      sourceDurationUs: clip.sourceDurationUs - sourceDeltaUs,
    } : {
      timelineStartUs: clip.timelineStartUs,
      durationUs: clip.durationUs + finalDeltaUs,
      sourceInUs: clip.sourceInUs,
      sourceDurationUs: clip.sourceDurationUs + sourceDeltaUs,
    })
  }
  window.addEventListener("pointermove", move)
  window.addEventListener("pointerup", stop)
  window.addEventListener("pointercancel", stop)
}

export function TimelineTrackArea({
  timeline,
  selectedClipID,
  playheadUs,
  pixelsPerSecond,
  onSelectClip,
  onSetPlayhead,
  onMoveClip,
  onTrimClip,
  onDropAsset,
  onUpdateTrack,
  assetStatuses,
  agentBaseURL,
  projectID,
}: {
  timeline: CinemaTimelineDocument
  selectedClipID: string | null
  playheadUs: number
  pixelsPerSecond: number
  onSelectClip: (clip: CinemaTimelineClip) => void
  onSetPlayhead: (timeUs: number) => void
  onMoveClip: (clip: CinemaTimelineClip, trackID: string, startUs: number) => void
  onTrimClip: (clip: CinemaTimelineClip, next: { timelineStartUs: number; durationUs: number; sourceInUs: number; sourceDurationUs: number }) => void
  onDropAsset: (asset: CinemaAssetRecord, trackID: string, startUs: number) => void
  onUpdateTrack: (track: CinemaTimelineTrack, patch: CinemaTimelineTrackPatch) => void
  assetStatuses: ReadonlyMap<string, CinemaAssetStatus | "unresolved">
  agentBaseURL: string
  projectID: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ scrollLeft: 0, width: 1200 })
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
  const trackWidth = Math.max(MIN_TRACK_WIDTH, timelineTimeToPixels(durationUs, pixelsPerSecond) + 500)
  const rulerStepSeconds = pixelsPerSecond >= 96 ? 1 : pixelsPerSecond >= 40 ? 2 : 5
  const rulerStepPixels = rulerStepSeconds * pixelsPerSecond
  const rulerCount = Math.ceil(trackWidth / rulerStepPixels)
  const visibleClipIDs = useMemo(
    () => new Set(visibleTimelineClips(timeline.clips, viewport, pixelsPerSecond).map((clip) => clip.id)),
    [pixelsPerSecond, timeline.clips, viewport],
  )

  return (
    <div
      ref={scrollRef}
      className="cinema-timeline-scroll-region"
      tabIndex={0}
      aria-label="Timeline tracks"
      onScroll={(event) => setViewport({ scrollLeft: event.currentTarget.scrollLeft, width: event.currentTarget.clientWidth })}
    >
      <div
        className="cinema-timeline-ruler"
        style={{ width: trackWidth }}
        onPointerDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          onSetPlayhead(timelinePixelsToTime(event.clientX - rect.left, pixelsPerSecond))
        }}
      >
        {Array.from({ length: rulerCount }, (_, index) => (
          <span key={index} style={{ left: index * rulerStepPixels }}>{index * rulerStepSeconds}s</span>
        ))}
      </div>
      <div className="cinema-timeline-tracks" style={{ width: trackWidth }}>
        <div className="cinema-timeline-playhead" style={{ left: 112 + timelineTimeToPixels(playheadUs, pixelsPerSecond) }} aria-hidden="true" />
        {timeline.tracks.map((track) => (
          <div className="cinema-timeline-track" key={track.id}>
            <div className="cinema-timeline-track-header">
              <strong>{track.title}</strong>
              <div>
                <button type="button" aria-label={`${track.title} lock`} title={track.locked ? "Unlock track" : "Lock track"} aria-pressed={track.locked} onClick={() => onUpdateTrack(track, { locked: !track.locked })}><Lock aria-hidden="true" /></button>
                <button type="button" aria-label={`${track.title} mute`} title={track.muted ? "Unmute track" : "Mute track"} aria-pressed={track.muted} onClick={() => onUpdateTrack(track, { muted: !track.muted })}><Volume2 aria-hidden="true" /></button>
                <button type="button" aria-label={`${track.title} visibility`} title={track.hidden ? "Show track" : "Hide track"} aria-pressed={!track.hidden} onClick={() => onUpdateTrack(track, { hidden: !track.hidden })}><Eye aria-hidden="true" /></button>
              </div>
            </div>
            <div
              className="cinema-timeline-track-lane"
              onPointerDown={(event) => {
                if (event.target !== event.currentTarget) return
                const rect = event.currentTarget.getBoundingClientRect()
                onSetPlayhead(timelinePixelsToTime(event.clientX - rect.left, pixelsPerSecond))
              }}
              onDragOver={(event) => {
                if (track.locked) return
                if (event.dataTransfer.types.includes(CLIP_DRAG_TYPE) || event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = event.dataTransfer.types.includes(CLIP_DRAG_TYPE) ? "move" : "copy"
                }
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (track.locked) return
                const rect = event.currentTarget.getBoundingClientRect()
                const startUs = timelinePixelsToTime(event.clientX - rect.left, pixelsPerSecond)
                const clipID = event.dataTransfer.getData(CLIP_DRAG_TYPE)
                if (clipID) {
                  const clip = timeline.clips.find((candidate) => candidate.id === clipID)
                  if (clip) onMoveClip(clip, track.id, startUs)
                  return
                }
                const rawAsset = event.dataTransfer.getData(ASSET_DRAG_TYPE)
                if (!rawAsset) return
                try {
                  onDropAsset(JSON.parse(rawAsset) as CinemaAssetRecord, track.id, startUs)
                } catch {
                  // Ignore malformed external drag data.
                }
              }}
            >
              {timeline.clips.filter((clip) => clip.trackID === track.id && visibleClipIDs.has(clip.id)).map((clip) => (
                <div
                  key={clip.id}
                  data-clip-id={clip.id}
                  role="button"
                  tabIndex={0}
                  draggable={!track.locked}
                  className={`cinema-timeline-clip is-${clip.kind} ${selectedClipID === clip.id ? "is-selected" : ""} ${clip.kind !== "text" && assetStatuses.get(clip.assetRef.assetID) !== undefined && assetStatuses.get(clip.assetRef.assetID) !== "ready" && assetStatuses.get(clip.assetRef.assetID) !== "unresolved" ? "is-asset-unavailable" : ""}`}
                  style={{
                    left: timelineTimeToPixels(clip.timelineStartUs, pixelsPerSecond),
                    width: Math.max(32, timelineTimeToPixels(clip.durationUs, pixelsPerSecond)),
                  }}
                  aria-pressed={selectedClipID === clip.id}
                  onClick={() => onSelectClip(clip)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      onSelectClip(clip)
                    }
                  }}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(CLIP_DRAG_TYPE, clip.id)
                    event.dataTransfer.effectAllowed = "move"
                  }}
                  title={clip.title}
                >
                  {clip.kind !== "text" ? <span className="cinema-timeline-trim-handle is-start" role="separator" aria-label={`Trim start of ${clip.title}`} onPointerDown={(event) => beginTrim(event, clip, "start", pixelsPerSecond, onTrimClip)} /> : null}
                  {clip.kind === "audio" ? <TimelineWaveform agentBaseURL={agentBaseURL} projectID={projectID} timelineID={timeline.id} clipID={clip.id} /> : null}
                  <span>{clip.title}</span>
                  <small>{clip.kind !== "text" && assetStatuses.get(clip.assetRef.assetID) && assetStatuses.get(clip.assetRef.assetID) !== "ready" ? assetStatuses.get(clip.assetRef.assetID) : clip.kind}</small>
                  {clip.kind !== "text" ? <span className="cinema-timeline-trim-handle is-end" role="separator" aria-label={`Trim end of ${clip.title}`} onPointerDown={(event) => beginTrim(event, clip, "end", pixelsPerSecond, onTrimClip)} /> : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
