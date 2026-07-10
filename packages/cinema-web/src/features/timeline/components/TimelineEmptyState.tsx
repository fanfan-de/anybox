import { Plus } from "lucide-react"

export function TimelineEmptyState({ creating, onCreate }: { creating: boolean; onCreate: () => void }) {
  return (
    <div className="cinema-timeline-empty">
      <div>
        <h2>No timelines yet</h2>
        <p>Create a timeline to assemble project video and audio. Nothing is added automatically.</p>
        <button className="cinema-edit-primary-button" type="button" disabled={creating} onClick={onCreate}>
          <Plus aria-hidden="true" />
          <span>{creating ? "Creating…" : "New Timeline"}</span>
        </button>
      </div>
    </div>
  )
}
