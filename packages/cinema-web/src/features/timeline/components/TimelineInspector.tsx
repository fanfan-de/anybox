import { useEffect, useState } from "react"
import { X } from "lucide-react"
import type { CinemaAssetStatus } from "@anybox/shared"
import type { CinemaTimelineClip, CinemaTimelineClipPatch, CinemaTimelineFit, CinemaTimelineTransform } from "@anybox/shared/cinema-timeline"
import { timelineSecondsInputFromUs, timelineSecondsInputToUs } from "../model/timelineTime"
import { useI18n } from "../../../i18n"

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
  fit: CinemaTimelineFit
  transformX: string
  transformY: string
  transformScale: string
  transformRotation: string
  transformAnchorX: string
  transformAnchorY: string
}

const defaultTransform: CinemaTimelineTransform = {
  x: 0,
  y: 0,
  scale: 1,
  rotationDegrees: 0,
  anchorX: 0.5,
  anchorY: 0.5,
}

const fitLabelKeys = {
  contain: "inspector.fit.contain",
  cover: "inspector.fit.cover",
  stretch: "inspector.fit.stretch",
} as const

function draftFromClip(clip: CinemaTimelineClip): InspectorDraft {
  const transform = clip.kind === "audio" ? defaultTransform : clip.transform ?? defaultTransform
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
    fit: clip.fit ?? "contain",
    transformX: String(transform.x),
    transformY: String(transform.y),
    transformScale: String(transform.scale),
    transformRotation: String(transform.rotationDegrees),
    transformAnchorX: String(transform.anchorX),
    transformAnchorY: String(transform.anchorY),
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
  const { t } = useI18n()
  const [draft, setDraft] = useState(() => draftFromClip(clip))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setDraft(draftFromClip(clip))
    setError(null)
  }, [clip.id, clip.updatedAt])

  const setField = <Key extends keyof InspectorDraft,>(field: Key, value: InspectorDraft[Key]) => setDraft((current) => ({ ...current, [field]: value }))
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
    const transform: CinemaTimelineTransform = {
      x: Number(draft.transformX),
      y: Number(draft.transformY),
      scale: Number(draft.transformScale),
      rotationDegrees: Number(draft.transformRotation),
      anchorX: Number(draft.transformAnchorX),
      anchorY: Number(draft.transformAnchorY),
    }
    if (!draft.title.trim()) return setError(t("inspector.error.name"))
    if (timelineStartUs === null || durationUs === null || ![volume, opacity].every(Number.isFinite)) return setError(t("inspector.error.seconds"))
    if (durationUs <= 0) return setError(t("inspector.error.duration"))
    if (volume < 0 || opacity < 0 || opacity > 1) return setError(t("inspector.error.volumeOpacity"))
    if (clip.kind !== "text" && (sourceInUs === null || sourceDurationUs === null || sourceDurationUs <= 0)) return setError(t("inspector.error.sourceRange"))
    if (clip.kind === "audio" && (fadeInUs === null || fadeOutUs === null || fadeInUs + fadeOutUs > durationUs)) return setError(t("inspector.error.fades"))
    if (clip.kind !== "audio" && (
      !Object.values(transform).every(Number.isFinite)
      || transform.scale <= 0
      || transform.anchorX < 0
      || transform.anchorX > 1
      || transform.anchorY < 0
      || transform.anchorY > 1
    )) return setError(t("inspector.error.transform"))

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
    if (clip.kind !== "audio") {
      if (draft.fit !== (clip.fit ?? "contain")) patch.fit = draft.fit
      const currentTransform = clip.transform ?? defaultTransform
      if ((Object.keys(transform) as Array<keyof CinemaTimelineTransform>).some((key) => transform[key] !== currentTransform[key])) {
        patch.transform = transform
      }
    }
    if (Object.keys(patch).length > 0) onUpdate(patch)
    setError(null)
  }

  return (
    <aside className="cinema-timeline-inspector" aria-label={t("inspector.label")}>
      <header>
        <strong>{t("inspector.title")}</strong>
        <button type="button" aria-label={t("inspector.close")} title={t("inspector.close")} onClick={onClose}><X aria-hidden="true" /></button>
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
        <label><span>{t("inspector.name")}</span><input type="text" value={draft.title} onChange={(event) => setField("title", event.target.value)} /></label>
        <label><span>{t("inspector.position")}</span><input type="text" inputMode="decimal" value={draft.timelineStartUs} onChange={(event) => setField("timelineStartUs", event.target.value)} /></label>
        <label><span>{t("inspector.duration")}</span><input type="text" inputMode="decimal" value={draft.durationUs} onChange={(event) => setField("durationUs", event.target.value)} /></label>
        {clip.kind !== "text" ? <label><span>{t("inspector.sourceIn")}</span><input type="text" inputMode="decimal" value={draft.sourceInUs} onChange={(event) => setField("sourceInUs", event.target.value)} /></label> : null}
        {clip.kind !== "text" ? <label><span>{t("inspector.sourceDuration")}</span><input type="text" inputMode="decimal" value={draft.sourceDurationUs} onChange={(event) => setField("sourceDurationUs", event.target.value)} /></label> : null}
        <label><span>{t("inspector.volume")}</span><input type="number" min={0} step="0.05" value={draft.volume} onChange={(event) => setField("volume", event.target.value)} /></label>
        {clip.kind === "audio" ? <label><span>{t("inspector.fadeIn")}</span><input type="text" inputMode="decimal" value={draft.fadeInUs} onChange={(event) => setField("fadeInUs", event.target.value)} /></label> : null}
        {clip.kind === "audio" ? <label><span>{t("inspector.fadeOut")}</span><input type="text" inputMode="decimal" value={draft.fadeOutUs} onChange={(event) => setField("fadeOutUs", event.target.value)} /></label> : null}
        <label><span>{t("inspector.opacity")}</span><input type="number" min={0} max={1} step="0.05" value={draft.opacity} onChange={(event) => setField("opacity", event.target.value)} /></label>
        {clip.kind !== "audio" ? (
          <fieldset className="cinema-timeline-inspector-transform">
            <legend>{t("inspector.transform")}</legend>
            {clip.kind !== "text" ? (
              <div className="cinema-timeline-inspector-fit" role="group" aria-label={t("inspector.fit")}>
                {(["contain", "cover", "stretch"] as const).map((fit) => (
                  <button
                    key={fit}
                    type="button"
                    aria-pressed={draft.fit === fit}
                    onClick={() => setField("fit", fit)}
                  >{t(fitLabelKeys[fit])}</button>
                ))}
              </div>
            ) : null}
            <label><span>{t("inspector.transformX")}</span><input type="number" step="1" value={draft.transformX} onChange={(event) => setField("transformX", event.target.value)} /></label>
            <label><span>{t("inspector.transformY")}</span><input type="number" step="1" value={draft.transformY} onChange={(event) => setField("transformY", event.target.value)} /></label>
            <label><span>{t("inspector.transformScale")}</span><input type="number" min="0.01" step="0.01" value={draft.transformScale} onChange={(event) => setField("transformScale", event.target.value)} /></label>
            <label><span>{t("inspector.transformRotation")}</span><input type="number" step="1" value={draft.transformRotation} onChange={(event) => setField("transformRotation", event.target.value)} /></label>
            <label><span>{t("inspector.transformAnchorX")}</span><input type="number" min="0" max="1" step="0.05" value={draft.transformAnchorX} onChange={(event) => setField("transformAnchorX", event.target.value)} /></label>
            <label><span>{t("inspector.transformAnchorY")}</span><input type="number" min="0" max="1" step="0.05" value={draft.transformAnchorY} onChange={(event) => setField("transformAnchorY", event.target.value)} /></label>
          </fieldset>
        ) : null}
        {clip.kind !== "text" ? (
          <div className={`cinema-timeline-inspector-asset ${assetStatus && assetStatus !== "ready" && assetStatus !== "unresolved" ? "is-unavailable" : ""}`}>
            <span>{t("inspector.asset", { status: assetStatus ?? "unresolved" })}</span>
            <button type="button" className="cinema-edit-secondary-button" onClick={onRequestReplacement}>{t("inspector.replaceAsset")}</button>
          </div>
        ) : null}
        {error ? <p className="cinema-timeline-inspector-error" role="alert">{error}</p> : null}
        <div className="cinema-timeline-inspector-actions">
          <button type="button" className="cinema-edit-secondary-button" onClick={reset}>{t("inspector.cancel")}</button>
          <button type="submit" className="cinema-edit-primary-button">{t("inspector.apply")}</button>
        </div>
      </form>
    </aside>
  )
}
