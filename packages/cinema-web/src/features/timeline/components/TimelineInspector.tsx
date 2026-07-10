import { useEffect, useState } from "react"
import { X } from "lucide-react"
import type { CinemaAssetStatus } from "@anybox/shared"
import type { CinemaTimelineClip, CinemaTimelineClipPatch } from "@anybox/shared/cinema-timeline"
import { timelineSecondsInputFromUs, timelineSecondsInputToUs } from "../model/timelineTime"

type InspectorDraft = {
  title: string
  timelineStartUs: string
  durationUs: string
  sourceInUs: string
  sourceDurationUs: string
  volume: string
  opacity: string
  fadeInUs: string
  fadeOutUs: string
}

function draftFromClip(clip: CinemaTimelineClip): InspectorDraft {
  return {
    title: clip.title,
    timelineStartUs: timelineSecondsInputFromUs(clip.timelineStartUs),
    durationUs: timelineSecondsInputFromUs(clip.durationUs),
    sourceInUs: clip.kind === "text" ? "0" : timelineSecondsInputFromUs(clip.sourceInUs),
    sourceDurationUs: clip.kind === "text" ? timelineSecondsInputFromUs(clip.durationUs) : timelineSecondsInputFromUs(clip.sourceDurationUs),
    volume: String(clip.volume),
    opacity: String(clip.opacity),
    fadeInUs: clip.kind === "audio" ? timelineSecondsInputFromUs(clip.fadeInUs ?? 0) : "0",
    fadeOutUs: clip.kind === "audio" ? timelineSecondsInputFromUs(clip.fadeOutUs ?? 0) : "0",
  }
}

export function TimelineInspector({
  clip,
  onClose,
  onUpdate,
  onMove,
  onTrim,
  assetStatus,
  onRequestReplacement,
}: {
  clip: CinemaTimelineClip
  onClose: () => void
  onUpdate: (patch: CinemaTimelineClipPatch) => void
  onMove: (timelineStartUs: number) => void
  onTrim: (next: { timelineStartUs: number; durationUs: number; sourceInUs: number; sourceDurationUs: number }) => void
  assetStatus?: CinemaAssetStatus | "unresolved"
  onRequestReplacement: () => void
}) {
  const [draft, setDraft] = useState(() => draftFromClip(clip))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setDraft(draftFromClip(clip))
    setError(null)
  }, [clip.id, clip.updatedAt])

  const setField = (field: keyof InspectorDraft, value: string) => setDraft((current) => ({ ...current, [field]: value }))
  const reset = () => {
    setDraft(draftFromClip(clip))
    setError(null)
  }
  const submit = () => {
    const timelineStartUs = timelineSecondsInputToUs(draft.timelineStartUs)
    const durationUs = timelineSecondsInputToUs(draft.durationUs)
    const sourceInUs = timelineSecondsInputToUs(draft.sourceInUs)
    const sourceDurationUs = timelineSecondsInputToUs(draft.sourceDurationUs)
    const volume = Number(draft.volume)
    const opacity = Number(draft.opacity)
    const fadeInUs = timelineSecondsInputToUs(draft.fadeInUs)
    const fadeOutUs = timelineSecondsInputToUs(draft.fadeOutUs)
    if (!draft.title.trim()) return setError("Name is required.")
    if (timelineStartUs === null || durationUs === null || ![volume, opacity].every(Number.isFinite)) return setError("Enter seconds with up to 6 decimal places.")
    if (durationUs <= 0) return setError("Duration must be greater than 0 seconds.")
    if (volume < 0 || opacity < 0 || opacity > 1) return setError("Volume must be positive and opacity must be between 0 and 1.")
    if (clip.kind !== "text" && (sourceInUs === null || sourceDurationUs === null || sourceDurationUs <= 0)) return setError("Source range must use valid non-negative seconds.")
    if (clip.kind === "audio" && (fadeInUs === null || fadeOutUs === null || fadeInUs + fadeOutUs > durationUs)) return setError("Audio fades must be non-negative seconds and fit within the clip.")

    if (timelineStartUs !== clip.timelineStartUs && durationUs === clip.durationUs) onMove(timelineStartUs)
    if (clip.kind !== "text" && sourceInUs !== null && sourceDurationUs !== null && (
      timelineStartUs !== clip.timelineStartUs
      || durationUs !== clip.durationUs
      || sourceInUs !== clip.sourceInUs
      || sourceDurationUs !== clip.sourceDurationUs
    )) onTrim({ timelineStartUs, durationUs, sourceInUs, sourceDurationUs })
    const patch: CinemaTimelineClipPatch = {}
    if (draft.title.trim() !== clip.title) patch.title = draft.title.trim()
    if (volume !== clip.volume) patch.volume = volume
    if (opacity !== clip.opacity) patch.opacity = opacity
    if (clip.kind === "audio" && fadeInUs !== (clip.fadeInUs ?? 0)) patch.fadeInUs = fadeInUs
    if (clip.kind === "audio" && fadeOutUs !== (clip.fadeOutUs ?? 0)) patch.fadeOutUs = fadeOutUs
    if (Object.keys(patch).length > 0) onUpdate(patch)
    setError(null)
  }

  return (
    <aside className="cinema-timeline-inspector" aria-label="Timeline inspector">
      <header>
        <strong>Inspector</strong>
        <button type="button" aria-label="Close inspector" title="Close inspector" onClick={onClose}><X aria-hidden="true" /></button>
      </header>
      <form
        className="cinema-timeline-inspector-body"
        onSubmit={(event) => { event.preventDefault(); submit() }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            reset()
          }
        }}
      >
        <label><span>Name</span><input type="text" value={draft.title} onChange={(event) => setField("title", event.target.value)} /></label>
        <label><span>Position (seconds)</span><input type="text" inputMode="decimal" value={draft.timelineStartUs} onChange={(event) => setField("timelineStartUs", event.target.value)} /></label>
        <label><span>Duration (seconds)</span><input type="text" inputMode="decimal" value={draft.durationUs} onChange={(event) => setField("durationUs", event.target.value)} /></label>
        {clip.kind !== "text" ? <label><span>Source in (seconds)</span><input type="text" inputMode="decimal" value={draft.sourceInUs} onChange={(event) => setField("sourceInUs", event.target.value)} /></label> : null}
        {clip.kind !== "text" ? <label><span>Source duration (seconds)</span><input type="text" inputMode="decimal" value={draft.sourceDurationUs} onChange={(event) => setField("sourceDurationUs", event.target.value)} /></label> : null}
        <label><span>Volume</span><input type="number" min={0} step="0.05" value={draft.volume} onChange={(event) => setField("volume", event.target.value)} /></label>
        {clip.kind === "audio" ? <label><span>Fade in (seconds)</span><input type="text" inputMode="decimal" value={draft.fadeInUs} onChange={(event) => setField("fadeInUs", event.target.value)} /></label> : null}
        {clip.kind === "audio" ? <label><span>Fade out (seconds)</span><input type="text" inputMode="decimal" value={draft.fadeOutUs} onChange={(event) => setField("fadeOutUs", event.target.value)} /></label> : null}
        <label><span>Opacity</span><input type="number" min={0} max={1} step="0.05" value={draft.opacity} onChange={(event) => setField("opacity", event.target.value)} /></label>
        {clip.kind !== "text" ? (
          <div className={`cinema-timeline-inspector-asset ${assetStatus && assetStatus !== "ready" && assetStatus !== "unresolved" ? "is-unavailable" : ""}`}>
            <span>Asset: {assetStatus ?? "unresolved"}</span>
            <button type="button" className="cinema-edit-secondary-button" onClick={onRequestReplacement}>Replace asset</button>
          </div>
        ) : null}
        {error ? <p className="cinema-timeline-inspector-error" role="alert">{error}</p> : null}
        <div className="cinema-timeline-inspector-actions">
          <button type="button" className="cinema-edit-secondary-button" onClick={reset}>Cancel</button>
          <button type="submit" className="cinema-edit-primary-button">Apply</button>
        </div>
      </form>
    </aside>
  )
}
