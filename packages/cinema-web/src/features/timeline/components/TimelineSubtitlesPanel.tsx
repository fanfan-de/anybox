import { useMemo, useRef, useState } from "react"
import { AlertTriangle, Download, Plus, Search, Settings2, Upload } from "lucide-react"
import {
  parseCinemaSubtitle,
  serializeCinemaSubtitle,
  type CinemaSubtitleCueInput,
  type CinemaSubtitleFormat,
} from "@anybox/shared/cinema-subtitles"
import type {
  CinemaTimelineDocument,
  CinemaTimelineSubtitleCue,
  CinemaTimelineSubtitleTrack,
} from "@anybox/shared/cinema-timeline"
import { formatTimelineTime } from "../model/timelineTime"
import type { TimelineSubtitleQualityIssue } from "../model/timelineSubtitleQuality"
import { useI18n } from "../../../i18n"

function safeFilename(value: string) {
  const cleaned = value.normalize("NFKC").replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "")
  return cleaned || "subtitles"
}

function downloadText(filename: string, value: string, type: string) {
  const url = URL.createObjectURL(new Blob([value], { type }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function TimelineSubtitlesPanel({
  timeline,
  activeTrackID,
  selectedCueID,
  composerOpen,
  qualityIssues,
  onSetActiveTrack,
  onAddTrack,
  onOpenComposer,
  onCloseComposer,
  onCreateCue,
  onImport,
  onSelectCue,
  onEditTrack,
}: {
  timeline: CinemaTimelineDocument | null
  activeTrackID: string | null
  selectedCueID: string | null
  composerOpen: boolean
  qualityIssues: readonly TimelineSubtitleQualityIssue[]
  onSetActiveTrack: (trackID: string) => void
  onAddTrack: () => void
  onOpenComposer: () => void
  onCloseComposer: () => void
  onCreateCue: (text: string) => void
  onImport: (cues: readonly CinemaSubtitleCueInput[], filename: string) => void
  onSelectCue: (cue: CinemaTimelineSubtitleCue) => void
  onEditTrack: (track: CinemaTimelineSubtitleTrack) => void
}) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState("")
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string | null>(null)
  const tracks = (timeline?.tracks ?? []).filter((track): track is CinemaTimelineSubtitleTrack => track.kind === "subtitle")
  const activeTrack = tracks.find((track) => track.id === activeTrackID) ?? tracks[0] ?? null
  const issueCueIDs = useMemo(() => new Set(qualityIssues.map((issue) => issue.cueID)), [qualityIssues])
  const allCues = (timeline?.clips ?? [])
    .filter((clip): clip is CinemaTimelineSubtitleCue => clip.kind === "subtitle" && clip.trackID === activeTrack?.id)
    .sort((left, right) => left.timelineStartUs - right.timelineStartUs || left.id.localeCompare(right.id))
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const cues = allCues.filter((cue) => `${cue.speaker ?? ""}\n${cue.cueText}`.toLocaleLowerCase().includes(normalizedQuery))

  const exportTrack = (format: CinemaSubtitleFormat) => {
    if (!timeline || !activeTrack) return
    const source = allCues.map((cue) => ({ startUs: cue.timelineStartUs, durationUs: cue.durationUs, text: cue.cueText, speaker: cue.speaker }))
    const filename = `${safeFilename(timeline.title)}-${safeFilename(activeTrack.title)}-${safeFilename(activeTrack.language)}.${format}`
    downloadText(filename, serializeCinemaSubtitle(source, format), format === "srt" ? "application/x-subrip;charset=utf-8" : "text/vtt;charset=utf-8")
  }

  return (
    <div className="cinema-subtitles-panel">
      <div className="cinema-timeline-bin-heading">
        <strong>{t("timeline.subtitles")}</strong>
        <button type="button" title={t("timeline.addSubtitleTrack")} aria-label={t("timeline.addSubtitleTrack")} onClick={onAddTrack}><Plus aria-hidden="true" /></button>
      </div>
      {tracks.length > 0 ? (
        <div className="cinema-subtitle-track-picker" role="tablist" aria-label={t("timeline.subtitles")}>
          {tracks.map((track) => <button key={track.id} type="button" role="tab" aria-selected={track.id === activeTrack?.id} className={track.id === activeTrack?.id ? "is-active" : ""} onClick={() => onSetActiveTrack(track.id)}>{track.title}<small>{track.language}</small></button>)}
        </div>
      ) : <p className="cinema-timeline-bin-empty">{t("subtitle.noTracks")}</p>}
      <div className="cinema-subtitle-actions">
        <button type="button" disabled={!timeline} onClick={onOpenComposer}><Plus aria-hidden="true" />{t("timeline.addSubtitle")}</button>
        <button type="button" onClick={() => inputRef.current?.click()}><Upload aria-hidden="true" />{t("subtitle.import")}</button>
        <button type="button" disabled={!activeTrack} onClick={() => exportTrack("srt")}><Download aria-hidden="true" />SRT</button>
        <button type="button" disabled={!activeTrack} onClick={() => exportTrack("vtt")}><Download aria-hidden="true" />VTT</button>
        <button type="button" disabled={!activeTrack} title={t("subtitle.style")} aria-label={t("subtitle.style")} onClick={() => activeTrack && onEditTrack(activeTrack)}><Settings2 aria-hidden="true" /></button>
        <input ref={inputRef} className="cinema-visually-hidden" type="file" tabIndex={-1} aria-hidden="true" accept=".srt,.vtt,text/vtt,application/x-subrip" onChange={async (event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ""
          if (!file) return
          try {
            const format: CinemaSubtitleFormat = file.name.toLocaleLowerCase().endsWith(".vtt") ? "vtt" : "srt"
            const parsed = parseCinemaSubtitle(await file.text(), format)
            if (parsed.warnings.length > 0 && !window.confirm(parsed.warnings.map((warning) => warning.message).join("\n"))) return
            onImport(parsed.cues, file.name.replace(/\.(srt|vtt)$/i, ""))
            setError(null)
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause))
          }
        }} />
      </div>
      {composerOpen ? (
        <form className="cinema-subtitle-composer" onSubmit={(event) => {
          event.preventDefault()
          if (!draft.trim()) return setError(t("subtitle.error.text"))
          onCreateCue(draft.trim())
          setDraft("")
          setError(null)
        }}>
          <textarea autoFocus rows={3} maxLength={4_000} value={draft} placeholder={t("subtitle.newText")} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); setDraft(""); setError(null); onCloseComposer() }
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) event.currentTarget.form?.requestSubmit()
          }} />
          <div><button type="button" onClick={onCloseComposer}>{t("inspector.cancel")}</button><button type="submit" className="cinema-edit-primary-button">{t("subtitle.create")}</button></div>
        </form>
      ) : null}
      {activeTrack ? <label className="cinema-timeline-media-search"><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("subtitle.search")} aria-label={t("subtitle.search")} /></label> : null}
      {error ? <p className="cinema-timeline-bin-empty is-error" role="alert">{error}</p> : null}
      {qualityIssues.length > 0 ? <p className="cinema-subtitle-warning-summary"><AlertTriangle aria-hidden="true" />{qualityIssues.length} {t("subtitle.warnings")}</p> : null}
      <div className="cinema-timeline-bin-scroll cinema-subtitle-cue-list" role="listbox">
        {cues.map((cue) => (
          <button key={cue.id} type="button" role="option" aria-selected={selectedCueID === cue.id} className={selectedCueID === cue.id ? "is-selected" : ""} onClick={() => onSelectCue(cue)}>
            <small>{formatTimelineTime(cue.timelineStartUs)} – {formatTimelineTime(cue.timelineStartUs + cue.durationUs)}</small>
            <span>{cue.speaker ? `${cue.speaker}: ` : ""}{cue.cueText}</span>
            {issueCueIDs.has(cue.id) ? <AlertTriangle aria-label={t("subtitle.warnings")} /> : null}
          </button>
        ))}
        {activeTrack && cues.length === 0 ? <p className="cinema-timeline-bin-empty">{t("subtitle.noCues")}</p> : null}
      </div>
    </div>
  )
}
