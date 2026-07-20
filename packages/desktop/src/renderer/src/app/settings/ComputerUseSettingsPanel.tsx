import { useEffect, useState } from "react"
import type { ComputerUseAppDecision } from "../../../../shared/desktop-ipc-contract"
import { useI18n } from "../i18n/I18nProvider"
import {
  getComputerUseAppDecisions,
  revokeComputerUseAppDecision,
} from "./client"

export function ComputerUseSettingsPanel() {
  const { t } = useI18n()
  const [decisions, setDecisions] = useState<ComputerUseAppDecision[]>([])
  const [busyAppID, setBusyAppID] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    void getComputerUseAppDecisions()
      .then((items) => {
        if (!cancelled) setDecisions(items ?? [])
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function revoke(decision: ComputerUseAppDecision) {
    setBusyAppID(decision.appID)
    setError("")
    try {
      const result = await revokeComputerUseAppDecision(decision.appID)
      if (result?.revoked) {
        setDecisions((current) =>
          current.filter((item) => item.appID !== decision.appID),
        )
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyAppID(null)
    }
  }

  return (
    <div className="settings-general-layout computer-use-settings-layout">
      <section
        className="settings-panel computer-use-settings-panel"
        aria-label={t("settings.computerUse.title")}
      >
        <div className="settings-section-heading">
          <div>
            <span className="settings-eyebrow">
              {t("settings.computerUse.eyebrow")}
            </span>
            <h2>{t("settings.computerUse.title")}</h2>
            <p>{t("settings.computerUse.description")}</p>
          </div>
        </div>

        {error ? (
          <p className="settings-helper-text is-error" role="alert">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="settings-helper-text">
            {t("settings.computerUse.loading")}
          </p>
        ) : decisions.length === 0 ? (
          <article className="settings-empty-state computer-use-empty-state">
            <h3>{t("settings.computerUse.emptyTitle")}</h3>
            <p>{t("settings.computerUse.emptyCopy")}</p>
          </article>
        ) : (
          <div
            className="computer-use-app-list"
            role="list"
            aria-label={t("settings.computerUse.allowedApps")}
          >
            {decisions.map((decision) => (
              <article
                className="computer-use-app-row"
                key={decision.appID}
                role="listitem"
              >
                <div className="computer-use-app-copy">
                  <strong>{decision.displayName}</strong>
                  <span>{t("settings.computerUse.alwaysAllowed")}</span>
                </div>
                <button
                  className="secondary-button is-danger"
                  disabled={busyAppID === decision.appID}
                  type="button"
                  onClick={() => void revoke(decision)}
                >
                  {busyAppID === decision.appID
                    ? t("settings.computerUse.revoking")
                    : t("settings.computerUse.revoke")}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
