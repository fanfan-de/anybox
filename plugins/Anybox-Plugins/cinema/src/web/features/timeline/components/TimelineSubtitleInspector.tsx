import { useEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import type { CinemaTimelineClipPatch, CinemaTimelineSubtitleCue } from "@anybox/cinema-plugin/contracts/timeline"
import { timelineSecondsInputFromUs, timelineSecondsInputToUs } from "../model/timelineTime"
import { useI18n } from "../../../i18n"

export function TimelineSubtitleInspector({
  cue,
  focusTextRequest,
  onClose,
  onUpdate,
  onTrim,
}: {
  cue: CinemaTimelineSubtitleCue
  focusTextRequest: number
  onClose: () => void
  onUpdate: (patch: CinemaTimelineClipPatch) => void
  onTrim: (timelineStartUs: number, durationUs: number) => void
}) {
  const { t } = useI18n()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState(cue.cueText)
  const [speaker, setSpeaker] = useState(cue.speaker ?? "")
  const [start, setStart] = useState(timelineSecondsInputFromUs(cue.timelineStartUs))
  const [duration, setDuration] = useState(timelineSecondsInputFromUs(cue.durationUs))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setText(cue.cueText)
    setSpeaker(cue.speaker ?? "")
    setStart(timelineSecondsInputFromUs(cue.timelineStartUs))
    setDuration(timelineSecondsInputFromUs(cue.durationUs))
    setError(null)
  }, [cue.id, cue.updatedAt])
  useEffect(() => {
    if (focusTextRequest > 0) textareaRef.current?.focus()
  }, [focusTextRequest])

  const reset = () => {
    setText(cue.cueText)
    setSpeaker(cue.speaker ?? "")
    setStart(timelineSecondsInputFromUs(cue.timelineStartUs))
    setDuration(timelineSecondsInputFromUs(cue.durationUs))
    setError(null)
  }
  const submit = () => {
    const timelineStartUs = timelineSecondsInputToUs(start)
    const durationUs = timelineSecondsInputToUs(duration)
    if (!text.trim()) return setError(t("subtitle.error.text"))
    if (text.trim().length > 4_000) return setError(t("subtitle.error.length"))
    if (timelineStartUs === null || durationUs === null || durationUs <= 0) return setError(t("subtitle.error.time"))
    const patch: CinemaTimelineClipPatch = {}
    if (text.trim() !== cue.cueText) patch.cueText = text.trim()
    if (speaker.trim() !== (cue.speaker ?? "")) patch.speaker = speaker.trim() || null
    if (Object.keys(patch).length > 0) onUpdate(patch)
    if (timelineStartUs !== cue.timelineStartUs || durationUs !== cue.durationUs) onTrim(timelineStartUs, durationUs)
    setError(null)
  }
  return (
    <aside className="cinema-timeline-inspector cinema-subtitle-inspector" aria-label={t("subtitle.inspector")}>
      <header><strong>{t("subtitle.inspector")}</strong><button type="button" aria-label={t("inspector.close")} title={t("inspector.close")} onClick={onClose}><X aria-hidden="true" /></button></header>
      <form className="cinema-timeline-inspector-body" onSubmit={(event) => { event.preventDefault(); submit() }} onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); reset() }
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submit() }
      }}>
        <label><span>{t("subtitle.text")}</span><textarea ref={textareaRef} maxLength={4_000} rows={5} value={text} onChange={(event) => setText(event.target.value)} /></label>
        <label><span>{t("subtitle.speaker")}</span><input type="text" maxLength={160} value={speaker} onChange={(event) => setSpeaker(event.target.value)} /></label>
        <label><span>{t("inspector.position")}</span><input type="text" inputMode="decimal" value={start} onChange={(event) => setStart(event.target.value)} /></label>
        <label><span>{t("inspector.duration")}</span><input type="text" inputMode="decimal" value={duration} onChange={(event) => setDuration(event.target.value)} /></label>
        {error ? <p className="cinema-timeline-inspector-error" role="alert">{error}</p> : null}
        <div className="cinema-timeline-inspector-actions"><button type="button" className="cinema-edit-secondary-button" onClick={reset}>{t("inspector.cancel")}</button><button type="submit" className="cinema-edit-primary-button">{t("inspector.apply")}</button></div>
      </form>
    </aside>
  )
}
