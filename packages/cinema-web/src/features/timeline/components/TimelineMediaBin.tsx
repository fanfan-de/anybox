import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { ChevronLeft, Film, Folder, Grid2X2, Image, LayoutList, ListVideo, Music, Plus, Search, Trash2 } from "lucide-react"
import type { CinemaAssetKind, CinemaAssetRecord } from "@anybox/shared"
import type { CinemaTimelineDocument } from "@anybox/shared/cinema-timeline"
import { createAssetLibraryApi } from "../../assets/assetLibraryApi"
import { useI18n, type TranslationKey } from "../../../i18n"

export type TimelineMediaSection = "timelines" | "subtitles" | "project" | "generated" | "imported"
type MediaKind = "all" | CinemaAssetKind

export function TimelineMediaBin({
  agentBaseURL,
  projectID,
  timelines,
  selectedTimelineID,
  creating,
  onCreate,
  onSelectTimeline,
  onDeleteTimeline,
  onActivateAsset,
  replacementClipTitle,
  revealedAsset,
  section,
  onSectionChange,
  subtitlePanel,
}: {
  agentBaseURL: string
  projectID: string
  timelines: CinemaTimelineDocument[]
  selectedTimelineID: string | null
  creating: boolean
  onCreate: () => void
  onSelectTimeline: (timelineID: string) => void
  onDeleteTimeline: (timeline: CinemaTimelineDocument) => void
  onActivateAsset: (asset: CinemaAssetRecord) => void
  replacementClipTitle?: string
  revealedAsset?: { id: string; displayName: string; requestID: string; section: TimelineMediaSection } | null
  section: TimelineMediaSection
  onSectionChange: (section: TimelineMediaSection) => void
  subtitlePanel?: ReactNode
}) {
  const { t } = useI18n()
  const [query, setQuery] = useState("")
  const [kind, setKind] = useState<MediaKind>("all")
  const [compact, setCompact] = useState(true)
  const [folderID, setFolderID] = useState<string | null>(null)
  const rootRef = useRef<HTMLElement>(null)
  const focusedRevealRequestRef = useRef<string | null>(null)
  const focusedRevealElementRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!replacementClipTitle) return
    onSectionChange("project")
    setFolderID(null)
    setQuery("")
  }, [onSectionChange, replacementClipTitle])
  useEffect(() => {
    if (!revealedAsset) return
    onSectionChange(revealedAsset.section)
    setFolderID(null)
    setQuery(revealedAsset.displayName)
    setKind("all")
  }, [onSectionChange, revealedAsset])
  const assetApi = useMemo(
    () => createAssetLibraryApi(agentBaseURL, projectID, { type: "project", projectID }),
    [agentBaseURL, projectID],
  )
  const stateQuery = useQuery({
    queryKey: ["cinema-timeline-media-state", agentBaseURL, projectID],
    enabled: section !== "timelines" && section !== "subtitles",
    queryFn: ({ signal }) => assetApi.getState(signal),
  })
  const sectionRoot = section === "generated"
    ? stateQuery.data?.defaultFolderIDs.generated
    : section === "imported"
      ? stateQuery.data?.defaultFolderIDs.inbox
      : stateQuery.data?.rootFolderID
  const effectiveFolderID = folderID ?? sectionRoot ?? ""
  const entriesQuery = useQuery({
    queryKey: ["cinema-timeline-media", agentBaseURL, projectID, section, effectiveFolderID, query],
    enabled: section !== "timelines" && section !== "subtitles" && Boolean(effectiveFolderID),
    queryFn: ({ signal }) => assetApi.listEntries({
      folderID: effectiveFolderID,
      query,
      limit: 100,
      signal,
    }),
  })
  const entries = (entriesQuery.data?.entries ?? []).filter((entry) => (
    entry.entryType === "folder" || kind === "all" || entry.asset.kind === kind
  ))
  useEffect(() => {
    if (!revealedAsset) return
    const row = [...(rootRef.current?.querySelectorAll<HTMLElement>("[data-asset-id]") ?? [])]
      .find((element) => element.dataset.assetId === revealedAsset.id)
    if (!row) return
    if (
      focusedRevealRequestRef.current === revealedAsset.requestID
      && focusedRevealElementRef.current === row
      && document.activeElement === row
    ) return
    focusedRevealRequestRef.current = revealedAsset.requestID
    focusedRevealElementRef.current = row
    row.focus()
    row.scrollIntoView({ block: "nearest" })
  }, [entriesQuery.data?.entries, revealedAsset])

  const selectSection = (next: TimelineMediaSection) => {
    onSectionChange(next)
    setFolderID(null)
    setQuery("")
  }

  return (
    <aside ref={rootRef} className="cinema-timeline-media-bin" aria-label={t("timeline.mediaBin")}>
      <div className="cinema-timeline-media-sections" role="tablist" aria-label={t("timeline.mediaSections")}>
        {([
          ["timelines", "deliver.timelines"],
          ["subtitles", "timeline.subtitles"],
          ["project", "timeline.projectAssets"],
          ["generated", "timeline.generated"],
          ["imported", "timeline.imported"],
        ] as const satisfies ReadonlyArray<readonly [TimelineMediaSection, TranslationKey]>).map(([id, labelKey]) => (
          <button key={id} type="button" role="tab" aria-selected={section === id} className={section === id ? "is-active" : ""} onClick={() => selectSection(id)}>{t(labelKey)}</button>
        ))}
      </div>

      {section === "timelines" ? (
        <div className="cinema-timeline-list">
          <div className="cinema-timeline-bin-heading">
            <strong>{t("deliver.timelines")}</strong>
            <button type="button" aria-label={t("timeline.new")} title={t("timeline.new")} disabled={creating} onClick={onCreate}><Plus aria-hidden="true" /></button>
          </div>
          <div className="cinema-timeline-bin-scroll">
            {timelines.map((timeline) => (
              <div key={timeline.id} className={`cinema-timeline-list-item ${selectedTimelineID === timeline.id ? "is-current" : ""}`}>
                <button type="button" className="cinema-timeline-list-row" aria-current={selectedTimelineID === timeline.id ? "page" : undefined} onClick={() => onSelectTimeline(timeline.id)}>
                  <Film aria-hidden="true" />
                  <span><strong>{timeline.title}</strong><small>{t("timeline.clipCount", { count: timeline.clips.length, revision: timeline.revision })}</small></span>
                </button>
                <button type="button" className="cinema-timeline-list-delete" aria-label={t("timeline.deleteNamed", { name: timeline.title })} title={t("timeline.delete")} onClick={() => onDeleteTimeline(timeline)}><Trash2 aria-hidden="true" /></button>
              </div>
            ))}
            {timelines.length === 0 ? <p className="cinema-timeline-bin-empty">{t("timeline.none")}</p> : null}
          </div>
        </div>
      ) : section === "subtitles" ? subtitlePanel : (
        <div className="cinema-timeline-assets">
          {replacementClipTitle ? <p className="cinema-timeline-replacement-hint">{t("timeline.replaceHint", { name: replacementClipTitle })}</p> : null}
          <div className="cinema-timeline-bin-heading">
            <button type="button" aria-label={t("timeline.backToParent")} title={t("timeline.back")} disabled={!entriesQuery.data?.folder?.parentID} onClick={() => setFolderID(entriesQuery.data?.folder?.parentID ?? null)}><ChevronLeft aria-hidden="true" /></button>
            <strong title={entriesQuery.data?.folder?.name}>{entriesQuery.data?.folder?.name ?? t("timeline.assets")}</strong>
            <button type="button" aria-label={t(compact ? "timeline.thumbnailView" : "timeline.compactView")} title={t(compact ? "timeline.thumbnailView" : "timeline.compactView")} onClick={() => setCompact((value) => !value)}>{compact ? <Grid2X2 aria-hidden="true" /> : <LayoutList aria-hidden="true" />}</button>
          </div>
          <label className="cinema-timeline-media-search">
            <Search aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("timeline.searchAssets")} aria-label={t("timeline.searchAssets")} />
          </label>
          <div className="cinema-timeline-kind-filter" role="group" aria-label={t("timeline.mediaType")}>
            {(["all", "video", "audio", "image"] as const).map((value) => (
              <button key={value} type="button" className={kind === value ? "is-active" : ""} aria-pressed={kind === value} onClick={() => setKind(value)}>{t(`timeline.kind.${value}` as TranslationKey)}</button>
            ))}
          </div>
          <div className={`cinema-timeline-bin-scroll cinema-timeline-asset-list ${compact ? "is-compact" : "is-grid"}`}>
            {entries.map((entry) => {
              if (entry.entryType === "folder") {
                return <button key={`folder-${entry.folder.id}`} type="button" className="cinema-timeline-asset-row is-folder" onClick={() => setFolderID(entry.folder.id)}><Folder aria-hidden="true" /><span>{entry.folder.name}</span></button>
              }
              const Icon = entry.asset.kind === "video" ? ListVideo : entry.asset.kind === "audio" ? Music : Image
              return (
                <button
                  key={`asset-${entry.asset.id}`}
                  type="button"
                  className={`cinema-timeline-asset-row ${revealedAsset?.id === entry.asset.id ? "is-revealed" : ""}`}
                  data-asset-id={entry.asset.id}
                  aria-current={revealedAsset?.id === entry.asset.id ? "true" : undefined}
                  draggable={entry.asset.status === "ready"}
                  title={entry.asset.displayName}
                  onDoubleClick={() => onActivateAsset(entry.asset)}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("application/x-anybox-cinema-timeline-asset", JSON.stringify(entry.asset))
                    event.dataTransfer.effectAllowed = "copy"
                  }}
                >
                  <Icon aria-hidden="true" />
                  <span>{entry.asset.displayName}</span>
                  <small>{entry.asset.status}</small>
                </button>
              )
            })}
            {entriesQuery.isLoading ? <p className="cinema-timeline-bin-empty">{t("timeline.loadingAssets")}</p> : null}
            {entriesQuery.error ? <p className="cinema-timeline-bin-empty is-error">{t("timeline.loadAssetsFailed")}</p> : null}
            {!entriesQuery.isLoading && entries.length === 0 ? <p className="cinema-timeline-bin-empty">{t("timeline.noMatchingAssets")}</p> : null}
          </div>
        </div>
      )}
    </aside>
  )
}
