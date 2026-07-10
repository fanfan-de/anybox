import { Check, CloudOff, Loader2, RefreshCw } from "lucide-react"

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
  const label = state === "dirty"
    ? "未保存"
    : state === "saving"
      ? pendingCount > 1 ? `正在保存 ${pendingCount} 项` : "正在保存"
      : state === "error"
        ? "保存失败"
        : state === "saved"
          ? "已保存"
          : "准备就绪"

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
          title="重试保存"
          aria-label="重试保存"
          onClick={onRetry}
        >
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}
