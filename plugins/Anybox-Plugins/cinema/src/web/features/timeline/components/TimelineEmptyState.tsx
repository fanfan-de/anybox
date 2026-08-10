import { Plus } from "lucide-react"
import { useI18n } from "../../../i18n"

export function TimelineEmptyState({ creating, onCreate }: { creating: boolean; onCreate: () => void }) {
  const { t } = useI18n()
  return (
    <div className="cinema-timeline-empty">
      <div>
        <h2>{t("timeline.emptyTitle")}</h2>
        <p>{t("timeline.emptyDescription")}</p>
        <button className="cinema-edit-primary-button" type="button" disabled={creating} onClick={onCreate}>
          <Plus aria-hidden="true" />
          <span>{t(creating ? "timeline.creating" : "timeline.new")}</span>
        </button>
      </div>
    </div>
  )
}
