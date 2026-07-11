import { Check, CloudOff, Loader2, RefreshCw } from "lucide-react"
import { useI18n } from "../../i18n"

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error"

export function CanvasSaveStatus({
  state,
  error,
  pendingCount,
  onRetry,
}: {
  state: SaveState
  error: string | null
  pendingCount: number
  onRetry: () => void
}) {
  const { t } = useI18n()
  const label = state === "dirty"
    ? t("save.dirty")
    : state === "saving"
      ? pendingCount > 1 ? t("save.savingCount", { count: pendingCount }) : t("save.saving")
      : state === "error"
        ? t("save.error")
        : state === "saved"
          ? t("save.saved")
          : t("save.ready")

  return (
    <div
      className={`cinema-save-status is-${state}`}
      role="status"
      aria-live={state === "error" ? "assertive" : "polite"}
      title={error ?? label}
      onClick={(event) => event.stopPropagation()}
    >
      {state === "saving" ? (
        <Loader2 className="is-spinning" size={14} aria-hidden="true" />
      ) : state === "error" ? (
        <CloudOff size={14} aria-hidden="true" />
      ) : state === "saved" ? (
        <Check size={14} aria-hidden="true" />
      ) : (
        <span className="cinema-save-status-dot" aria-hidden="true" />
      )}
      <span className="cinema-save-status-label">{label}</span>
      {state === "error" ? (
        <button
          type="button"
          className="cinema-save-status-retry"
          title={t("save.retry")}
          aria-label={t("save.retry")}
          onClick={onRetry}
        >
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}
