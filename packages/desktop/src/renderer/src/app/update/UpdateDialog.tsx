import type { MouseEvent } from "react"
import type { DesktopAppUpdateState } from "../../../../shared/desktop-ipc-contract"
import { useI18n } from "../i18n/I18nProvider"
import { t as translateKey, type TranslationKey } from "../i18n/translations"

type UpdateTranslate = (key: TranslationKey, params?: Record<string, string | number>) => string

const defaultUpdateTranslate: UpdateTranslate = (key, params) => translateKey("en-US", key, params)

export type AppUpdateStatus = {
  tone: "success" | "error" | "muted"
  text: string
}

export function getAppUpdatePhaseLabel(
  state: DesktopAppUpdateState | null,
  translate: UpdateTranslate = defaultUpdateTranslate,
) {
  switch (state?.phase) {
    case "checking":
      return translate("updates.phase.checking")
    case "available":
      return translate("updates.phase.available")
    case "downloading":
      return translate("updates.phase.downloading")
    case "downloaded":
      return translate("updates.phase.downloaded")
    case "up-to-date":
      return translate("updates.phase.upToDate")
    case "error":
      return translate("updates.phase.error")
    case "unsupported":
      return translate("updates.phase.unsupported")
    default:
      return translate("updates.phase.ready")
  }
}

function getUpdateVersionLabel(state: DesktopAppUpdateState | null, translate: UpdateTranslate) {
  return state?.latestVersion
    ? translate("updates.version.label", { version: state.latestVersion })
    : translate("updates.version.fallback")
}

export function getAppUpdateSummary(
  state: DesktopAppUpdateState | null,
  translate: UpdateTranslate = defaultUpdateTranslate,
) {
  if (!state) return translate("updates.summary.loading")

  switch (state.phase) {
    case "checking":
      return translate("updates.summary.checking")
    case "available":
      return state.latestVersion
        ? translate("updates.summary.availableVersion", { version: state.latestVersion })
        : translate("updates.summary.available")
    case "downloading":
      return state.latestVersion
        ? translate("updates.summary.downloadingVersion", { version: state.latestVersion })
        : translate("updates.summary.downloading")
    case "downloaded":
      return state.latestVersion
        ? translate("updates.summary.downloadedVersion", { version: state.latestVersion })
        : translate("updates.summary.downloaded")
    case "up-to-date":
      return translate("updates.summary.upToDate")
    case "error":
      return state.error
        ? translate("updates.summary.errorWithMessage", { message: state.error })
        : translate("updates.summary.error")
    case "unsupported":
      return translate("updates.summary.unsupported")
    default:
      return translate("updates.summary.ready")
  }
}

export function shouldOpenUpdateCenterOnly(state: DesktopAppUpdateState | null) {
  return state?.phase === "checking" || state?.phase === "available" || state?.phase === "downloading" || state?.phase === "downloaded"
}

function getUpdateDialogTitle(state: DesktopAppUpdateState | null, translate: UpdateTranslate) {
  switch (state?.phase) {
    case "checking":
      return translate("updates.dialog.title.checking")
    case "available":
      return translate("updates.dialog.title.available")
    case "downloading":
      return translate("updates.dialog.title.downloading")
    case "downloaded":
      return translate("updates.dialog.title.downloaded")
    case "up-to-date":
      return translate("updates.dialog.title.upToDate")
    case "error":
      return translate("updates.dialog.title.error")
    case "unsupported":
      return translate("updates.dialog.title.unsupported")
    default:
      return translate("updates.dialog.title.default")
  }
}

function formatByteCount(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null

  const units = ["B", "KB", "MB", "GB"] as const
  let unitIndex = 0
  let nextValue = value
  while (nextValue >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024
    unitIndex += 1
  }

  if (unitIndex === 0) return `${Math.round(nextValue)} ${units[unitIndex]}`
  return `${nextValue.toFixed(1)} ${units[unitIndex]}`
}

function getUpdateProgressPercent(state: DesktopAppUpdateState | null) {
  if (state?.phase === "downloaded") return 100
  if (typeof state?.downloadPercent !== "number") return 0
  return Math.max(0, Math.min(100, state.downloadPercent))
}

function getProgressTransferLabel(state: DesktopAppUpdateState | null, progressPercent: number) {
  const transferred = formatByteCount(state?.downloadTransferredBytes)
  const total = formatByteCount(state?.downloadTotalBytes)
  if (transferred && total) return `${transferred} / ${total}`
  if (transferred) return transferred
  return `${Math.round(progressPercent)}%`
}

function getProgressSpeedLabel(state: DesktopAppUpdateState | null) {
  const speed = formatByteCount(state?.downloadBytesPerSecond)
  return speed ? `${speed}/s` : null
}

interface UpdateDialogProps {
  state: DesktopAppUpdateState | null
  status: AppUpdateStatus | null
  isChecking: boolean
  isInstalling: boolean
  onCheck: () => void
  onClose: () => void
  onInstall: () => void
}

export function UpdateDialog({
  state,
  status,
  isChecking,
  isInstalling,
  onCheck,
  onClose,
  onInstall,
}: UpdateDialogProps) {
  const { t } = useI18n()
  const phase = state?.phase ?? "idle"
  const progressPercent = getUpdateProgressPercent(state)
  const progressSpeed = getProgressSpeedLabel(state)
  const showProgress = phase === "available" || phase === "downloading"
  const showCheckAction = phase !== "available" && phase !== "downloading" && phase !== "downloaded"
  const canCheck = phase !== "checking" && !isChecking
  const canInstall = phase === "downloaded"
  const secondaryActionLabel = phase === "available" || phase === "downloading" || phase === "checking"
    ? t("updates.action.downloadInBackground")
    : t("updates.action.later")

  function handleOverlayClick(event: MouseEvent<HTMLElement>) {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  return (
    <section className="update-center-overlay" role="presentation" onClick={handleOverlayClick}>
      <article
        className={`update-center-dialog is-${phase}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-center-title"
      >
        <header className="update-center-titlebar">
          <h2 id="update-center-title">{getUpdateDialogTitle(state, t)}</h2>
          <p>{getAppUpdateSummary(state, t)}</p>
        </header>

        {showProgress ? (
          <div className="update-center-progress-panel">
            <div
              className="update-center-progress"
              aria-label={t("updates.progress.aria", { percent: Math.round(progressPercent) })}
            >
              <span className="update-center-progress-track">
                <span className="update-center-progress-fill" style={{ width: `${progressPercent}%` }} />
              </span>
            </div>
            <div className="update-center-progress-details">
              <span>{getProgressTransferLabel(state, progressPercent)}</span>
              {progressSpeed ? <span>{progressSpeed}</span> : null}
            </div>
          </div>
        ) : null}

        {phase === "downloaded" && state?.releaseNotes ? (
          <section className="update-center-release-notes" aria-label={t("updates.release.notesAria")}>
            <h3>{getUpdateVersionLabel(state, t)}</h3>
            <p>{state.releaseNotes}</p>
          </section>
        ) : null}

        {phase === "unsupported" ? (
          <p className="update-center-helper">
            {t("updates.helper.unsupported")}
          </p>
        ) : null}

        {status ? <p className={`update-center-message is-${status.tone}`}>{status.text}</p> : null}

        <footer className="update-center-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            {secondaryActionLabel}
          </button>
          {canInstall ? (
            <button className="primary-button" type="button" disabled={isInstalling} onClick={onInstall}>
              {isInstalling ? t("updates.action.restarting") : t("updates.action.restartToInstall")}
            </button>
          ) : showCheckAction ? (
            <button className="primary-button" type="button" disabled={!canCheck} onClick={onCheck}>
              {isChecking || phase === "checking" ? t("updates.action.checking") : t("updates.action.checkForUpdates")}
            </button>
          ) : null}
        </footer>
      </article>
    </section>
  )
}
