import { useState } from "react"
import { Captions, Film, Layers, LocateFixed, Magnet, Maximize2, Music, Plus, Redo2, Scissors, Undo2, ZoomIn, ZoomOut } from "lucide-react"
import type { CinemaTimelineTrackKind } from "@anybox/cinema-plugin/contracts/timeline"
import { useI18n, type TranslationKey } from "../../../i18n"
import { TimelineClipContextMenu, type TimelineClipContextMenuState } from "./TimelineClipContextMenu"

export function TimelineToolbar({
  snapEnabled,
  canSplit,
  canUndo,
  canRedo,
  onSplit,
  onToggleSnap,
  onUndo,
  onRedo,
  onZoomOut,
  onZoomIn,
  onFit,
  onAddTrack,
  onAddSubtitle,
  followPlayhead,
  onToggleFollowPlayhead,
}: {
  snapEnabled: boolean
  canSplit: boolean
  canUndo: boolean
  canRedo: boolean
  onSplit: () => void
  onToggleSnap: () => void
  onUndo: () => void
  onRedo: () => void
  onZoomOut: () => void
  onZoomIn: () => void
  onFit: () => void
  onAddTrack: (kind: CinemaTimelineTrackKind) => void
  onAddSubtitle: () => void
  followPlayhead: boolean
  onToggleFollowPlayhead: () => void
}) {
  const { t } = useI18n()
  const [trackMenu, setTrackMenu] = useState<TimelineClipContextMenuState | null>(null)
  const tools = [
    ["timeline.split", Scissors, onSplit, !canSplit, "S"],
    ["timeline.snap", Magnet, onToggleSnap, false, null],
    ["timeline.undo", Undo2, onUndo, !canUndo, "Ctrl/Cmd+Z"],
    ["timeline.redo", Redo2, onRedo, !canRedo, "Ctrl/Cmd+Shift+Z"],
    ["timeline.zoomOut", ZoomOut, onZoomOut, false, null],
    ["timeline.zoomIn", ZoomIn, onZoomIn, false, null],
    ["timeline.fit", Maximize2, onFit, false, null],
  ] as const satisfies ReadonlyArray<readonly [TranslationKey, typeof Scissors, () => void, boolean, string | null]>
  return (
    <div className="cinema-timeline-toolbar" role="toolbar" aria-label={t("timeline.tools")}>
      <TimelineClipContextMenu
        menu={trackMenu}
        onClose={() => setTrackMenu(null)}
        actions={[
          { id: "video", label: t("timeline.addVideoTrack"), icon: <Film />, onSelect: () => onAddTrack("video") },
          { id: "audio", label: t("timeline.addAudioTrack"), icon: <Music />, onSelect: () => onAddTrack("audio") },
          { id: "overlay", label: t("timeline.addOverlayTrack"), icon: <Layers />, onSelect: () => onAddTrack("overlay") },
          { id: "subtitle", label: t("timeline.addSubtitleTrack"), icon: <Captions />, onSelect: () => onAddTrack("subtitle") },
        ]}
      />
      <button
        type="button"
        className="cinema-timeline-add-track"
        aria-label={t("timeline.addTrack")}
        title={t("timeline.addTrack")}
        aria-haspopup="menu"
        aria-expanded={trackMenu !== null}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          setTrackMenu({
            x: rect.left,
            y: rect.bottom + 4,
            label: t("timeline.addTrack"),
            returnFocus: event.currentTarget,
          })
        }}
      >
        <Plus aria-hidden="true" />
      </button>
      <button type="button" aria-label={t("timeline.addSubtitle")} title={t("timeline.addSubtitle")} onClick={onAddSubtitle}><Captions aria-hidden="true" /></button>
      {tools.map(([labelKey, Icon, onClick, disabled, shortcut]) => (
        <button key={labelKey} type="button" className={labelKey === "timeline.snap" && snapEnabled ? "is-active" : ""} aria-label={t(labelKey)} title={`${t(labelKey)}${shortcut ? ` · ${shortcut}` : ""}`} aria-pressed={labelKey === "timeline.snap" ? snapEnabled : undefined} disabled={disabled} onClick={onClick}>
          <Icon aria-hidden="true" />
        </button>
      ))}
      <button
        type="button"
        className={followPlayhead ? "is-active" : ""}
        aria-label={t("timeline.followPlayhead")}
        title={t("timeline.followPlayhead")}
        aria-pressed={followPlayhead}
        onClick={onToggleFollowPlayhead}
      >
        <LocateFixed aria-hidden="true" />
      </button>
    </div>
  )
}
