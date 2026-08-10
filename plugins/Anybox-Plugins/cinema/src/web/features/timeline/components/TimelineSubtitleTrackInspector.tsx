import { useEffect, useState } from "react"
import { X } from "lucide-react"
import type { CinemaTimelineSubtitleTrack, CinemaTimelineTrackPatch } from "@anybox/cinema-plugin/contracts/timeline"
import { useI18n } from "../../../i18n"

export function TimelineSubtitleTrackInspector({ track, onClose, onUpdate }: {
  track: CinemaTimelineSubtitleTrack
  onClose: () => void
  onUpdate: (patch: CinemaTimelineTrackPatch) => void
}) {
  const { t } = useI18n()
  const [language, setLanguage] = useState(track.language)
  const [role, setRole] = useState(track.role)
  const [style, setStyle] = useState(track.style)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setLanguage(track.language); setRole(track.role); setStyle(track.style); setError(null) }, [track.id, track.language, track.role, track.style])
  const submit = () => {
    try { new Intl.Locale(language) } catch { return setError(t("subtitle.error.language")) }
    onUpdate({ language: new Intl.Locale(language).baseName, role, style })
    setError(null)
  }
  return (
    <aside className="cinema-timeline-inspector cinema-subtitle-track-inspector" aria-label={t("subtitle.styleTitle")}>
      <header><strong>{t("subtitle.styleTitle")}</strong><button type="button" aria-label={t("inspector.close")} title={t("inspector.close")} onClick={onClose}><X aria-hidden="true" /></button></header>
      <form className="cinema-timeline-inspector-body" onSubmit={(event) => { event.preventDefault(); submit() }}>
        <label><span>{t("subtitle.language")}</span><input type="text" value={language} onChange={(event) => setLanguage(event.target.value)} /></label>
        <label><span>{t("subtitle.role")}</span><select value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="subtitle">{t("subtitle.role.subtitle")}</option><option value="caption">{t("subtitle.role.caption")}</option><option value="forced">{t("subtitle.role.forced")}</option></select></label>
        <label><span>{t("subtitle.fontSize")}</span><input type="number" min={12} max={240} value={style.fontSizePx} onChange={(event) => setStyle((current) => ({ ...current, fontSizePx: Number(event.target.value) }))} /></label>
        <label><span>{t("subtitle.textColor")}</span><input type="text" pattern="#[0-9A-Fa-f]{8}" value={style.textColor} onChange={(event) => setStyle((current) => ({ ...current, textColor: event.target.value }))} /></label>
        <label><span>{t("subtitle.outlineColor")}</span><input type="text" pattern="#[0-9A-Fa-f]{8}" value={style.outlineColor} onChange={(event) => setStyle((current) => ({ ...current, outlineColor: event.target.value }))} /></label>
        <label><span>{t("subtitle.outlineWidth")}</span><input type="number" min={0} max={12} step={0.5} value={style.outlineWidthPx} onChange={(event) => setStyle((current) => ({ ...current, outlineWidthPx: Number(event.target.value) }))} /></label>
        <label><span>{t("subtitle.backgroundColor")}</span><input type="text" pattern="#[0-9A-Fa-f]{8}" value={style.backgroundColor} onChange={(event) => setStyle((current) => ({ ...current, backgroundColor: event.target.value }))} /></label>
        <label><span>{t("subtitle.alignment")}</span><select value={style.alignment} onChange={(event) => setStyle((current) => ({ ...current, alignment: event.target.value as typeof current.alignment }))}><option value="bottom-left">{t("subtitle.align.left")}</option><option value="bottom-center">{t("subtitle.align.center")}</option><option value="bottom-right">{t("subtitle.align.right")}</option></select></label>
        <label><span>{t("subtitle.marginBottom")}</span><input type="number" min={0} max={540} value={style.marginBottomPx} onChange={(event) => setStyle((current) => ({ ...current, marginBottomPx: Number(event.target.value) }))} /></label>
        {error ? <p className="cinema-timeline-inspector-error" role="alert">{error}</p> : null}
        <div className="cinema-timeline-inspector-actions"><button type="button" className="cinema-edit-secondary-button" onClick={onClose}>{t("inspector.cancel")}</button><button type="submit" className="cinema-edit-primary-button">{t("inspector.apply")}</button></div>
      </form>
    </aside>
  )
}
