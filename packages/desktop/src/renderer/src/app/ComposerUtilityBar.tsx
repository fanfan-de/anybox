import { useEffect, useId, useRef, useState } from "react"
import { GitBranchSwitcher } from "./GitBranchSwitcher"
import { useI18n } from "./i18n/I18nProvider"
import type { SessionContextUsage } from "./types"

type Translate = ReturnType<typeof useI18n>["t"]

interface ComposerUtilityBarProps {
  contextWindow: number | null
  gitDirectory: string | null
  gitProjectID: string | null
  showGitControls?: boolean
  usage: SessionContextUsage | null
}

function clampRatio(value: number) {
  return Math.max(0, Math.min(1, value))
}

function formatContextValue(value: number) {
  if (value >= 1000) {
    const formatted = value >= 100000 ? Math.round(value / 1000) : Number((value / 1000).toFixed(1))
    return `${String(formatted).replace(/\.0$/, "")}k`
  }

  return String(value)
}

function formatTokenValue(value: number | null, t: Translate) {
  return value === null
    ? t("composer.context.unavailable")
    : t("composer.context.tokens", { count: value.toLocaleString("en-US") })
}

function formatCacheValue(usage: SessionContextUsage | null, t: Translate) {
  if (!usage) return t("composer.context.unavailable")
  return t("composer.context.cacheValue", {
    read: usage.cacheReadTokens.toLocaleString("en-US"),
    write: usage.cacheWriteTokens.toLocaleString("en-US"),
  })
}

function resolvePressureState(ratio: number | null) {
  if (ratio === null) return "unknown"
  if (ratio >= 0.8) return "high"
  if (ratio >= 0.6) return "medium"
  return "low"
}

function resolvePressureStateLabel(state: ReturnType<typeof resolvePressureState>, t: Translate) {
  switch (state) {
    case "high":
      return t("composer.context.status.high")
    case "medium":
      return t("composer.context.status.medium")
    case "low":
      return t("composer.context.status.low")
    default:
      return t("composer.context.status.waiting")
  }
}

export function ComposerUtilityBar({
  contextWindow,
  gitDirectory,
  gitProjectID,
  showGitControls = true,
  usage,
}: ComposerUtilityBarProps) {
  const { t } = useI18n()
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const panelID = useId()
  const [isContextPanelOpen, setIsContextPanelOpen] = useState(false)
  const rawRatio = contextWindow && usage ? usage.inputTokens / contextWindow : null
  const clampedRatio = rawRatio === null ? 0 : clampRatio(rawRatio)
  const pressureState = resolvePressureState(rawRatio)
  const percent = rawRatio === null ? null : Math.round(rawRatio * 100)
  const statusLabel = resolvePressureStateLabel(pressureState, t)
  const pressureValue = percent === null ? t("composer.context.status.waiting") : t("composer.context.percent", { percent })
  const remainingTokens = contextWindow && usage ? Math.max(0, contextWindow - usage.inputTokens) : null
  const size = 28
  const radius = 10
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - clampedRatio)
  const meterWidth = `${String(Math.round(clampedRatio * 100))}%`

  const label =
    contextWindow && usage
      ? t("composer.context.buttonLabel", {
          percent: percent ?? 0,
          input: formatContextValue(usage.inputTokens),
          window: formatContextValue(contextWindow),
        })
      : contextWindow
        ? t("composer.context.buttonUnavailableUsage", { window: formatContextValue(contextWindow) })
        : t("composer.context.buttonUnavailableModel")

  const contextSummary =
    contextWindow && usage
      ? t("composer.context.summary", {
          input: formatTokenValue(usage.inputTokens, t),
          window: formatTokenValue(contextWindow, t),
        })
      : contextWindow
        ? t("composer.context.summaryWaitingUsage", { window: formatTokenValue(contextWindow, t) })
        : t("composer.context.summaryWaitingModel")

  useEffect(() => {
    if (!isContextPanelOpen) return

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setIsContextPanelOpen(false)
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return
      setIsContextPanelOpen(false)
      buttonRef.current?.focus()
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [isContextPanelOpen])

  return (
    <div className="composer-utility-bar" aria-label={t("composer.utilityBar")}>
      <div className="context-pressure-anchor">
        <button
          ref={buttonRef}
          type="button"
          className={
            isContextPanelOpen
              ? `composer-utility-chip context-pressure-indicator is-${pressureState} is-active`
              : `composer-utility-chip context-pressure-indicator is-${pressureState}`
          }
          aria-controls={panelID}
          aria-expanded={isContextPanelOpen}
          aria-haspopup="dialog"
          aria-label={label}
          title={label}
          onClick={() => setIsContextPanelOpen((current) => !current)}
        >
          <svg aria-hidden="true" className="context-pressure-ring" viewBox={`0 0 ${String(size)} ${String(size)}`}>
            <circle className="context-pressure-ring-track" cx="14" cy="14" r={String(radius)} />
            <circle
              className="context-pressure-ring-progress"
              cx="14"
              cy="14"
              r={String(radius)}
              strokeDasharray={String(circumference)}
              strokeDashoffset={String(dashOffset)}
            />
            <circle className="context-pressure-ring-core" cx="14" cy="14" r="2.6" />
          </svg>
        </button>

        {isContextPanelOpen ? (
          <div
            ref={panelRef}
            id={panelID}
            className="context-pressure-popover"
            role="dialog"
            aria-label={t("composer.context.details")}
          >
            <div className="context-pressure-popover-header">
              <div className="context-pressure-popover-heading">
                <p className="context-pressure-popover-title">{t("composer.context.title")}</p>
                <strong className="context-pressure-popover-value">{pressureValue}</strong>
              </div>
              <span className={`context-pressure-status is-${pressureState}`}>{statusLabel}</span>
            </div>
            <p className="context-pressure-popover-summary">{contextSummary}</p>
            <div className={`context-pressure-meter is-${pressureState}`} aria-hidden="true">
              <span className="context-pressure-meter-fill" style={{ width: meterWidth }} />
            </div>
            <dl className="context-pressure-metrics">
              <div>
                <dt>{t("composer.context.input")}</dt>
                <dd>{formatTokenValue(usage?.inputTokens ?? null, t)}</dd>
              </div>
              <div>
                <dt>{t("composer.context.window")}</dt>
                <dd>{formatTokenValue(contextWindow, t)}</dd>
              </div>
              <div>
                <dt>{t("composer.context.remaining")}</dt>
                <dd>{formatTokenValue(remainingTokens, t)}</dd>
              </div>
              <div>
                <dt>{t("composer.context.output")}</dt>
                <dd>{formatTokenValue(usage?.outputTokens ?? null, t)}</dd>
              </div>
              <div>
                <dt>{t("composer.context.reasoning")}</dt>
                <dd>{formatTokenValue(usage?.reasoningTokens ?? null, t)}</dd>
              </div>
              <div>
                <dt>{t("composer.context.cache")}</dt>
                <dd>{formatCacheValue(usage, t)}</dd>
              </div>
            </dl>
          </div>
        ) : null}
      </div>
      {showGitControls ? <GitBranchSwitcher projectID={gitProjectID} directory={gitDirectory} /> : null}
    </div>
  )
}
