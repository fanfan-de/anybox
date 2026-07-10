import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ChevronLeft, Film, Folder, Grid2X2, Image, LayoutList, ListVideo, Music, Plus, Search, Trash2 } from "lucide-react"
import type { CinemaAssetKind, CinemaAssetRecord } from "@anybox/shared"
import type { CinemaTimelineDocument } from "@anybox/shared/cinema-timeline"
import { createAssetLibraryApi } from "../../assets/assetLibraryApi"

export type TimelineMediaSection = "timelines" | "project" | "generated" | "imported"
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
  section,
  onSectionChange,
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
  section: TimelineMediaSection
  onSectionChange: (section: TimelineMediaSection) => void
}) {
  const [query, setQuery] = useState("")
  const [kind, setKind] = useState<MediaKind>("all")
  const [compact, setCompact] = useState(true)
  const [folderID, setFolderID] = useState<string | null>(null)
  useEffect(() => {
    if (!replacementClipTitle) return
    onSectionChange("project")
    setFolderID(null)
    setQuery("")
  }, [onSectionChange, replacementClipTitle])
  const assetApi = useMemo(
    () => createAssetLibraryApi(agentBaseURL, projectID, { type: "project", projectID }),
    [agentBaseURL, projectID],
  )
  const stateQuery = useQuery({
    queryKey: ["cinema-timeline-media-state", agentBaseURL, projectID],
    enabled: section !== "timelines",
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
    enabled: section !== "timelines" && Boolean(effectiveFolderID),
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

  const selectSection = (next: TimelineMediaSection) => {
    onSectionChange(next)
    setFolderID(null)
    setQuery("")
  }

  return (
    <aside className="cinema-timeline-media-bin" aria-label="Media bin">
      <div className="cinema-timeline-media-sections" role="tablist" aria-label="Media sections">
        {([
          ["timelines", "Timelines"],
          ["project", "Project Assets"],
          ["generated", "Generated"],
          ["imported", "Imported"],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={section === id} className={section === id ? "is-active" : ""} onClick={() => selectSection(id)}>{label}</button>
        ))}
      </div>

      {section === "timelines" ? (
        <div className="cinema-timeline-list">
          <div className="cinema-timeline-bin-heading">
            <strong>Timelines</strong>
            <button type="button" aria-label="New Timeline" title="New Timeline" disabled={creating} onClick={onCreate}><Plus aria-hidden="true" /></button>
          </div>
          <div className="cinema-timeline-bin-scroll">
            {timelines.map((timeline) => (
              <div key={timeline.id} className={`cinema-timeline-list-item ${selectedTimelineID === timeline.id ? "is-current" : ""}`}>
                <button type="button" className="cinema-timeline-list-row" aria-current={selectedTimelineID === timeline.id ? "page" : undefined} onClick={() => onSelectTimeline(timeline.id)}>
                  <Film aria-hidden="true" />
                  <span><strong>{timeline.title}</strong><small>{timeline.clips.length} clips · r{timeline.revision}</small></span>
                </button>
                <button type="button" className="cinema-timeline-list-delete" aria-label={`Delete ${timeline.title}`} title="Delete Timeline" onClick={() => onDeleteTimeline(timeline)}><Trash2 aria-hidden="true" /></button>
              </div>
            ))}
            {timelines.length === 0 ? <p className="cinema-timeline-bin-empty">No timelines</p> : null}
          </div>
        </div>
      ) : (
        <div className="cinema-timeline-assets">
          {replacementClipTitle ? <p className="cinema-timeline-replacement-hint">Choose a compatible asset to replace “{replacementClipTitle}”.</p> : null}
          <div className="cinema-timeline-bin-heading">
            <button type="button" aria-label="Back to parent folder" title="Back" disabled={!entriesQuery.data?.folder?.parentID} onClick={() => setFolderID(entriesQuery.data?.folder?.parentID ?? null)}><ChevronLeft aria-hidden="true" /></button>
            <strong title={entriesQuery.data?.folder?.name}>{entriesQuery.data?.folder?.name ?? "Assets"}</strong>
            <button type="button" aria-label={compact ? "Thumbnail view" : "Compact list view"} title={compact ? "Thumbnail view" : "Compact list view"} onClick={() => setCompact((value) => !value)}>{compact ? <Grid2X2 aria-hidden="true" /> : <LayoutList aria-hidden="true" />}</button>
          </div>
          <label className="cinema-timeline-media-search">
            <Search aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search assets" aria-label="Search assets" />
          </label>
          <div className="cinema-timeline-kind-filter" role="group" aria-label="Media type">
            {(["all", "video", "audio", "image"] as const).map((value) => (
              <button key={value} type="button" className={kind === value ? "is-active" : ""} aria-pressed={kind === value} onClick={() => setKind(value)}>{value}</button>
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
                  className="cinema-timeline-asset-row"
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
            {entriesQuery.isLoading ? <p className="cinema-timeline-bin-empty">Loading assets…</p> : null}
            {entriesQuery.error ? <p className="cinema-timeline-bin-empty is-error">Could not load assets</p> : null}
            {!entriesQuery.isLoading && entries.length === 0 ? <p className="cinema-timeline-bin-empty">No matching assets</p> : null}
          </div>
        </div>
      )}
    </aside>
  )
}
