import { useEffect, useMemo, useState } from "react"
import { X } from "lucide-react"
import type { CinemaTimelineClip, CinemaTimelineClipPatch } from "@anybox/shared/cinema-timeline"
import { useI18n } from "../../../i18n"

type MultiInspectorDraft = {
  playbackRate: string
  volume: string
  opacity: string
}

function commonNumber(clips: readonly CinemaTimelineClip[], field: "playbackRate" | "volume" | "opacity") {
  const value = clips[0]?.[field]
  return value !== undefined && clips.every((clip) => clip[field] === value) ? String(value) : ""
}

function draftFromClips(clips: readonly CinemaTimelineClip[]): MultiInspectorDraft {
  return {
    playbackRate: commonNumber(clips, "playbackRate"),
    volume: commonNumber(clips, "volume"),
    opacity: commonNumber(clips, "opacity"),
  }
}

export function TimelineMultiInspector({
  clips,
  onClose,
  onUpdate,
}: {
  clips: readonly CinemaTimelineClip[]
  onClose: () => void
  onUpdate: (patch: CinemaTimelineClipPatch) => void
}) {
  const { t } = useI18n()
  const selectionVersion = clips.map((clip) => `${clip.id}:${clip.updatedAt}`).join("|")
  const [draft, setDraft] = useState(() => draftFromClips(clips))
  const [error, setError] = useState<string | null>(null)
  const supportsPlaybackRate = useMemo(() => clips.every((clip) => clip.kind === "video" || clip.kind === "audio"), [clips])
  const supportsVolume = supportsPlaybackRate
  const supportsOpacity = useMemo(() => clips.every((clip) => clip.kind !== "audio"), [clips])

  useEffect(() => {
    setDraft(draftFromClips(clips))
    setError(null)
  }, [selectionVersion])

  const reset = () => {
    setDraft(draftFromClips(clips))
    setError(null)
  }
  const submit = () => {
    const patch: CinemaTimelineClipPatch = {}
    const playbackRate = draft.playbackRate === "" ? null : Number(draft.playbackRate)
    const volume = draft.volume === "" ? null : Number(draft.volume)
    const opacity = draft.opacity === "" ? null : Number(draft.opacity)
    if (
      (playbackRate !== null && (!Number.isFinite(playbackRate) || playbackRate <= 0))
      || (volume !== null && (!Number.isFinite(volume) || volume < 0))
      || (opacity !== null && (!Number.isFinite(opacity) || opacity < 0 || opacity > 1))
    ) {
      setError(t("inspector.error.volumeOpacity"))
      return
    }
    if (supportsPlaybackRate && playbackRate !== null && clips.some((clip) => clip.playbackRate !== playbackRate)) patch.playbackRate = playbackRate
    if (supportsVolume && volume !== null && clips.some((clip) => clip.volume !== volume)) patch.volume = volume
    if (supportsOpacity && opacity !== null && clips.some((clip) => clip.opacity !== opacity)) patch.opacity = opacity
    if (Object.keys(patch).length > 0) onUpdate(patch)
    setError(null)
  }

  const hasSafeFields = supportsPlaybackRate || supportsVolume || supportsOpacity
  return (
    <aside className="cinema-timeline-inspector" aria-label={t("inspector.label")}>
      <header>
        <strong>{t("inspector.multiTitle", { count: clips.length })}</strong>
        <button type="button" aria-label={t("inspector.close")} title={t("inspector.close")} onClick={onClose}><X aria-hidden="true" /></button>
      </header>
      <form
        className="cinema-timeline-inspector-body"
        onSubmit={(event) => { event.preventDefault(); submit() }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return
          event.preventDefault()
          reset()
        }}
      >
        <p className="cinema-timeline-inspector-summary">{t("inspector.multiDescription")}</p>
        {supportsPlaybackRate ? <label><span>{t("inspector.playbackRate")}</span><input type="number" min={0.01} step="any" placeholder={t("inspector.mixed")} value={draft.playbackRate} onChange={(event) => setDraft((current) => ({ ...current, playbackRate: event.target.value }))} /></label> : null}
        {supportsVolume ? <label><span>{t("inspector.volume")}</span><input type="number" min={0} step="0.05" placeholder={t("inspector.mixed")} value={draft.volume} onChange={(event) => setDraft((current) => ({ ...current, volume: event.target.value }))} /></label> : null}
        {supportsOpacity ? <label><span>{t("inspector.opacity")}</span><input type="number" min={0} max={1} step="0.05" placeholder={t("inspector.mixed")} value={draft.opacity} onChange={(event) => setDraft((current) => ({ ...current, opacity: event.target.value }))} /></label> : null}
        {!hasSafeFields ? <p className="cinema-timeline-inspector-summary">{t("inspector.noCommonFields")}</p> : null}
        {error ? <p className="cinema-timeline-inspector-error" role="alert">{error}</p> : null}
        <div className="cinema-timeline-inspector-actions">
          <button type="button" className="cinema-edit-secondary-button" onClick={reset}>{t("inspector.cancel")}</button>
          <button type="submit" className="cinema-edit-primary-button" disabled={!hasSafeFields}>{t("inspector.apply")}</button>
        </div>
      </form>
    </aside>
  )
}
