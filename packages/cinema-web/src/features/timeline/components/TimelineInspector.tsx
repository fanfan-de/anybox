import { useEffect, useState } from "react"
import { X } from "lucide-react"
import type { CinemaAssetStatus } from "@anybox/shared"
import type { CinemaTimelineClip, CinemaTimelineClipPatch } from "@anybox/shared/cinema-timeline"

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
    timelineStartUs: String(clip.timelineStartUs),
    durationUs: String(clip.durationUs),
    sourceInUs: clip.kind === "text" ? "0" : String(clip.sourceInUs),
    sourceDurationUs: clip.kind === "text" ? String(clip.durationUs) : String(clip.sourceDurationUs),
    volume: String(clip.volume),
    opacity: String(clip.opacity),
    fadeInUs: clip.kind === "audio" ? String(clip.fadeInUs ?? 0) : "0",
    fadeOutUs: clip.kind === "audio" ? String(clip.fadeOutUs ?? 0) : "0",
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
    const timelineStartUs = Number(draft.timelineStartUs)
    const durationUs = Number(draft.durationUs)
    const sourceInUs = Number(draft.sourceInUs)
    const sourceDurationUs = Number(draft.sourceDurationUs)
    const volume = Number(draft.volume)
    const opacity = Number(draft.opacity)
    const fadeInUs = Number(draft.fadeInUs)
    const fadeOutUs = Number(draft.fadeOutUs)
    if (!draft.title.trim()) return setError("Name is required.")
    if (![timelineStartUs, durationUs, volume, opacity].every(Number.isFinite)) return setError("Enter valid numeric values.")
    if (!Number.isInteger(timelineStartUs) || timelineStartUs < 0 || !Number.isInteger(durationUs) || durationUs <= 0) return setError("Position and duration must be integer microseconds.")
    if (volume < 0 || opacity < 0 || opacity > 1) return setError("Volume must be positive and opacity must be between 0 and 1.")
    if (clip.kind !== "text" && (!Number.isInteger(sourceInUs) || sourceInUs < 0 || !Number.isInteger(sourceDurationUs) || sourceDurationUs <= 0)) return setError("Source range must use positive integer microseconds.")
    if (clip.kind === "audio" && (!Number.isInteger(fadeInUs) || fadeInUs < 0 || !Number.isInteger(fadeOutUs) || fadeOutUs < 0 || fadeInUs + fadeOutUs > durationUs)) return setError("Audio fades must be non-negative integer microseconds and fit within the clip.")

    if (timelineStartUs !== clip.timelineStartUs && durationUs === clip.durationUs) onMove(timelineStartUs)
    if (clip.kind !== "text" && (
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
        <label><span>Position µs</span><input type="number" min={0} step={1} value={draft.timelineStartUs} onChange={(event) => setField("timelineStartUs", event.target.value)} /></label>
        <label><span>Duration µs</span><input type="number" min={1} step={1} value={draft.durationUs} onChange={(event) => setField("durationUs", event.target.value)} /></label>
        {clip.kind !== "text" ? <label><span>Source in µs</span><input type="number" min={0} step={1} value={draft.sourceInUs} onChange={(event) => setField("sourceInUs", event.target.value)} /></label> : null}
        {clip.kind !== "text" ? <label><span>Source duration µs</span><input type="number" min={1} step={1} value={draft.sourceDurationUs} onChange={(event) => setField("sourceDurationUs", event.target.value)} /></label> : null}
        <label><span>Volume</span><input type="number" min={0} step="0.05" value={draft.volume} onChange={(event) => setField("volume", event.target.value)} /></label>
        {clip.kind === "audio" ? <label><span>Fade in µs</span><input type="number" min={0} step={1} value={draft.fadeInUs} onChange={(event) => setField("fadeInUs", event.target.value)} /></label> : null}
        {clip.kind === "audio" ? <label><span>Fade out µs</span><input type="number" min={0} step={1} value={draft.fadeOutUs} onChange={(event) => setField("fadeOutUs", event.target.value)} /></label> : null}
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
