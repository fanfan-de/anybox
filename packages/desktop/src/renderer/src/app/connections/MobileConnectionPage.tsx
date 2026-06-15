import { useEffect, useMemo, useState } from "react"
import QRCode from "qrcode"
import type { DesktopMobileBridgeStatus, DesktopMobileDeviceSummary } from "../../../../shared/desktop-ipc-contract"
import { useI18n } from "../i18n/I18nProvider"
import type { TranslationKey } from "../i18n/translations"
import { CopyIcon, ResetIcon, SmartphoneIcon } from "../icons"
import { writeTextToClipboard } from "../shared-ui"

type MobileTranslate = (key: TranslationKey, params?: Record<string, string | number>) => string

function formatStartedAt(value: number | null, locale: string, t: MobileTranslate) {
  if (!value) return t("connections.mobile.notRunning")
  return new Date(value).toLocaleString(locale)
}

function formatDeviceTime(value: number, locale: string) {
  return new Date(value).toLocaleString(locale)
}

function formatPairingExpiry(expiresAt: number | null, now: number, t: MobileTranslate) {
  if (!expiresAt) return t("connections.mobile.unavailable")
  const remaining = Math.max(0, expiresAt - now)
  const minutes = Math.floor(remaining / 60_000)
  const seconds = Math.floor((remaining % 60_000) / 1000)
  return remaining > 0
    ? t("connections.mobile.expiresIn", { time: `${minutes}:${String(seconds).padStart(2, "0")}` })
    : t("connections.mobile.expired")
}

function isLoopbackBridgeHost(host: string) {
  const normalized = host.toLowerCase()
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1"
}

function getPrimaryUrl(status: DesktopMobileBridgeStatus | null) {
  if (!status) return ""
  if (status.publicUrl) return status.publicUrl
  return isLoopbackBridgeHost(status.host) ? (status.localUrl ?? "") : (status.urls[0] ?? "")
}

function getPrimaryPairingUrl(status: DesktopMobileBridgeStatus | null) {
  if (!status) return ""
  if (status.publicPairingUrl) return status.publicPairingUrl
  return isLoopbackBridgeHost(status.host) ? (status.pairingLocalUrl ?? "") : (status.pairingUrls[0] ?? "")
}

function uniqueUrls(urls: Array<string | null | undefined>) {
  return urls.filter((url, index): url is string => Boolean(url) && urls.indexOf(url) === index)
}

function getPairingUrls(status: DesktopMobileBridgeStatus | null) {
  if (!status) return []
  const localUrls = isLoopbackBridgeHost(status.host) ? [status.pairingLocalUrl] : status.pairingUrls
  return uniqueUrls([status.publicPairingUrl, ...localUrls])
}

function getLegacyUrls(status: DesktopMobileBridgeStatus | null) {
  if (!status) return []
  const localUrls = isLoopbackBridgeHost(status.host) ? [status.localUrl] : status.urls
  return uniqueUrls([status.publicUrl, ...localUrls])
}

function createPairingDeepLink(url: string) {
  return url ? `anybox-mobile://connect?url=${encodeURIComponent(url)}` : ""
}

function getCloudRelayPairingDeepLink(status: DesktopMobileBridgeStatus | null, now = Date.now()) {
  return status?.cloudRelay?.enabled &&
    status.cloudRelay.pairingDeepLink &&
    status.cloudRelay.pairingExpiresAt &&
    status.cloudRelay.pairingExpiresAt > now
    ? status.cloudRelay.pairingDeepLink
    : ""
}

function getPrimaryPairingDeepLink(status: DesktopMobileBridgeStatus | null, pairingUrl: string, now = Date.now()) {
  const relayDeepLink = getCloudRelayPairingDeepLink(status, now)
  return relayDeepLink
    ? relayDeepLink
    : createPairingDeepLink(pairingUrl)
}

function quotePowerShellArgument(value: string) {
  return `"${value.replace(/`/g, "``").replace(/"/g, '`"')}"`
}

function createAndroidSmokeCommand(deepLink: string) {
  return deepLink ? `corepack pnpm mobile:android:smoke:bridge -- --url ${quotePowerShellArgument(deepLink)}` : ""
}

function getActiveDeviceCount(devices: DesktopMobileDeviceSummary[] | undefined) {
  return (devices ?? []).filter((device) => !device.revokedAt).length
}

function formatCapabilities(capabilities: string[], t: MobileTranslate) {
  return capabilities.length ? capabilities.join(", ") : t("connections.mobile.noCapabilities")
}

function formatCloudRelayDetail(status: DesktopMobileBridgeStatus | null, t: MobileTranslate) {
  const cloudRelay = status?.cloudRelay
  if (!cloudRelay?.enabled) return cloudRelay?.lastError ?? t("connections.mobile.notConfigured")
  const baseUrl = cloudRelay.baseUrl ?? t("connections.mobile.relayUrlUnavailable")
  const account = cloudRelay.account ?? { state: "unknown" as const }
  const accountLabel =
    account.state === "connected"
      ? account.email
        ? t("connections.mobile.accountDiscovery", { email: account.email })
        : t("connections.mobile.accountDiscoveryEnabled")
      : account.state === "not_connected"
        ? t("connections.mobile.signInForDiscovery")
        : account.state === "error"
          ? account.lastError ?? t("connections.mobile.accountDiscoveryUnavailable")
          : t("connections.mobile.accountDiscoveryUnknown")
  return `${baseUrl} - ${accountLabel}`
}

export function MobileConnectionPage() {
  const { locale, t } = useI18n()
  const [status, setStatus] = useState<DesktopMobileBridgeStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [isRefreshingPairing, setIsRefreshingPairing] = useState(false)
  const [isRotating, setIsRotating] = useState(false)
  const [isLegacyOpen, setIsLegacyOpen] = useState(false)
  const [revokingDeviceID, setRevokingDeviceID] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  async function refreshStatus() {
    try {
      if (!window.desktop?.getMobileBridgeStatus) {
        throw new Error(t("connections.mobile.bridgeUnavailable"))
      }
      setError(null)
      setStatus(await window.desktop.getMobileBridgeStatus())
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    }
  }

  useEffect(() => {
    void refreshStatus()
  }, [])

  useEffect(() => {
    if (!status?.pairingExpiresAt) return undefined
    const delay = Math.max(1000, status.pairingExpiresAt - Date.now() + 500)
    const timeout = window.setTimeout(() => {
      void refreshStatus()
    }, delay)
    return () => window.clearTimeout(timeout)
  }, [status?.pairingExpiresAt])

  useEffect(() => {
    if (!status?.pairingExpiresAt) return undefined
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [status?.pairingExpiresAt])

  const primaryUrl = useMemo(() => getPrimaryUrl(status), [status])
  const primaryPairingUrl = useMemo(() => getPrimaryPairingUrl(status), [status])
  const pairingUrls = useMemo(() => getPairingUrls(status), [status])
  const legacyUrls = useMemo(() => getLegacyUrls(status), [status])
  const pairingDeepLink = useMemo(() => getPrimaryPairingDeepLink(status, primaryPairingUrl, now), [now, primaryPairingUrl, status])
  const androidSmokeCommand = useMemo(() => createAndroidSmokeCommand(pairingDeepLink), [pairingDeepLink])
  const pairingExpiryLabel = formatPairingExpiry(
    getCloudRelayPairingDeepLink(status, now) ? status?.cloudRelay?.pairingExpiresAt ?? null : status?.pairingExpiresAt ?? null,
    now,
    t,
  )

  useEffect(() => {
    let cancelled = false
    if (!pairingDeepLink) {
      setQrDataUrl(null)
      return undefined
    }

    void QRCode.toDataURL(pairingDeepLink, {
      errorCorrectionLevel: "M",
      margin: 1,
      scale: 6,
      type: "image/png",
    })
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl)
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null)
      })

    return () => {
      cancelled = true
    }
  }, [pairingDeepLink])

  async function copyValue(label: string, value: string) {
    if (!value) return
    await writeTextToClipboard(value)
    setCopied(label)
    window.setTimeout(() => setCopied((current) => current === label ? null : current), 1600)
  }

  async function rotateToken() {
    setIsRotating(true)
    try {
      if (!window.desktop?.rotateMobileBridgeToken) {
        throw new Error(t("connections.mobile.bridgeUnavailable"))
      }
      setStatus(await window.desktop.rotateMobileBridgeToken())
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setIsRotating(false)
    }
  }

  async function refreshPairingCode() {
    setIsRefreshingPairing(true)
    try {
      if (!window.desktop?.refreshMobilePairingCode) {
        throw new Error(t("connections.mobile.bridgeUnavailable"))
      }
      setError(null)
      setStatus(await window.desktop.refreshMobilePairingCode())
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setIsRefreshingPairing(false)
    }
  }

  async function revokeDevice(deviceID: string) {
    setRevokingDeviceID(deviceID)
    try {
      if (!window.desktop?.revokeMobileDevice) {
        throw new Error(t("connections.mobile.deviceManagementUnavailable"))
      }
      setError(null)
      setStatus(await window.desktop.revokeMobileDevice({ deviceID }))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setRevokingDeviceID(null)
    }
  }

  const devices = status?.devices ?? []
  const activeDeviceCount = getActiveDeviceCount(devices)

  return (
    <section className="mobile-connection-page" aria-label={t("connections.mobile.title")}>
      <div className="mobile-connection-shell">
        <header className="mobile-connection-hero">
          <span className="mobile-connection-icon" aria-hidden="true">
            <SmartphoneIcon />
          </span>
          <div>
            <h1>{t("connections.mobile.title")}</h1>
            <p>{t("connections.mobile.description")}</p>
          </div>
        </header>

        {error ? <div className="settings-banner is-error">{error}</div> : null}

        <section className="mobile-connection-grid">
          <article className="mobile-connection-card">
            <span className="settings-field-label">{t("connections.mobile.bridgeStatus")}</span>
            <strong>{status?.running ? t("connections.mobile.running") : t("connections.mobile.stopped")}</strong>
            <small>{formatStartedAt(status?.startedAt ?? null, locale, t)}</small>
          </article>
          <article className="mobile-connection-card">
            <span className="settings-field-label">{t("connections.mobile.listeningAddress")}</span>
            <strong>{status?.host ?? "0.0.0.0"}</strong>
            <small>{status?.port ? t("connections.mobile.port", { port: status.port }) : t("connections.mobile.portUnavailable")}</small>
          </article>
          <article className="mobile-connection-card">
            <span className="settings-field-label">{t("connections.mobile.pairedDevices")}</span>
            <strong>{activeDeviceCount}</strong>
            <small>{devices.length ? t("connections.mobile.records", { count: devices.length }) : t("connections.mobile.noDevices")}</small>
          </article>
          <article className="mobile-connection-card">
            <span className="settings-field-label">{t("connections.mobile.cloudRelay")}</span>
            <strong>{status?.cloudRelay?.state ?? "disabled"}</strong>
            <small>{formatCloudRelayDetail(status, t)}</small>
          </article>
        </section>

        <section className="mobile-connection-panel">
          <div className="settings-section-header">
            <div>
              <h3>{t("connections.mobile.scanTitle")}</h3>
              <p>{pairingExpiryLabel}</p>
            </div>
            <div className="settings-inline-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={isRefreshingPairing}
                onClick={() => void refreshPairingCode()}
              >
                <ResetIcon />
                {isRefreshingPairing ? t("connections.mobile.refreshing") : t("connections.mobile.refreshQr")}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={!pairingDeepLink}
                onClick={() => void copyValue("deeplink", pairingDeepLink)}
              >
                <CopyIcon />
                {copied === "deeplink" ? t("connections.mobile.copied") : t("connections.mobile.copyDeepLink")}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={!androidSmokeCommand}
                onClick={() => void copyValue("smoke-command", androidSmokeCommand)}
              >
                <CopyIcon />
                {copied === "smoke-command" ? t("connections.mobile.copied") : t("connections.mobile.copyTestCommand")}
              </button>
            </div>
          </div>

          <div className="mobile-connection-qr" aria-label={t("connections.mobile.qrCode")}>
            {qrDataUrl ? (
              <img src={qrDataUrl} alt={t("connections.mobile.qrCode")} />
            ) : (
              <span>{pairingDeepLink || primaryPairingUrl ? t("connections.mobile.generating") : t("connections.mobile.unavailable")}</span>
            )}
          </div>

          <div className="mobile-connection-url-list">
            {pairingDeepLink ? (
              <button
                type="button"
                className="mobile-connection-url-row"
                onClick={() => void copyValue("deeplink-row", pairingDeepLink)}
              >
                <span>{pairingDeepLink}</span>
                <CopyIcon />
              </button>
            ) : null}
            {pairingUrls.map((url) => (
              <button
                key={url}
                type="button"
                className="mobile-connection-url-row"
                onClick={() => void copyValue(url, url)}
              >
                <span>{url}</span>
                <CopyIcon />
              </button>
            ))}
            {androidSmokeCommand ? (
              <button
                type="button"
                className="mobile-connection-url-row"
                onClick={() => void copyValue("smoke-command-row", androidSmokeCommand)}
              >
                <span>{androidSmokeCommand}</span>
                <CopyIcon />
              </button>
            ) : null}
            {status && pairingUrls.length === 0 ? (
              <div className="mobile-connection-empty">{t("connections.mobile.noPairingAddress")}</div>
            ) : null}
          </div>
        </section>

        <section className="mobile-connection-panel">
          <div className="settings-section-header">
            <div>
              <h3>{t("connections.mobile.advancedTokenAccess")}</h3>
            </div>
            <button
              type="button"
              className="secondary-button"
              aria-expanded={isLegacyOpen}
              onClick={() => setIsLegacyOpen((current) => !current)}
            >
              {isLegacyOpen ? t("connections.mobile.hideAdvanced") : t("connections.mobile.showAdvanced")}
            </button>
          </div>

          {isLegacyOpen ? (
            <>
              <div className="settings-inline-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!primaryUrl}
                  onClick={() => void copyValue("legacy-url", primaryUrl)}
                >
                  <CopyIcon />
                  {copied === "legacy-url" ? t("connections.mobile.copied") : t("connections.mobile.copyLegacyUrl")}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!status?.token}
                  onClick={() => void copyValue("token", status?.token ?? "")}
                >
                  <CopyIcon />
                  {copied === "token" ? t("connections.mobile.copied") : t("connections.mobile.copyToken")}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={isRotating}
                  onClick={() => void rotateToken()}
                >
                  <ResetIcon />
                  {isRotating ? t("connections.mobile.refreshing") : t("connections.mobile.rotateToken")}
                </button>
              </div>
              <div className="mobile-connection-url-list">
                {legacyUrls.map((url) => (
                  <button
                    key={url}
                    type="button"
                    className="mobile-connection-url-row"
                    onClick={() => void copyValue(`legacy-${url}`, url)}
                  >
                    <span>{url}</span>
                    <CopyIcon />
                  </button>
                ))}
              </div>
              <code className="mobile-connection-token">{status?.token ?? ""}</code>
            </>
          ) : null}
        </section>

        <section className="mobile-connection-panel">
          <div className="settings-section-header">
            <div>
              <h3>{t("connections.mobile.pairedDevices")}</h3>
            </div>
            <button type="button" className="secondary-button" onClick={() => void refreshStatus()}>
              {t("app.refresh")}
            </button>
          </div>

          <div className="mobile-connection-device-list">
            {devices.length ? (
              devices.map((device) => {
                const revoked = Boolean(device.revokedAt)
                return (
                  <div key={device.id} className={revoked ? "mobile-connection-device-row is-revoked" : "mobile-connection-device-row"}>
                    <div className="mobile-connection-device-main">
                      <strong>{device.name}</strong>
                      <span>{formatCapabilities(device.capabilities, t)}</span>
                    </div>
                    <span>
                      {revoked
                        ? t("connections.mobile.revoked")
                        : t("connections.mobile.lastSeen", { time: formatDeviceTime(device.lastSeenAt, locale) })}
                    </span>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={revoked || revokingDeviceID === device.id}
                      onClick={() => void revokeDevice(device.id)}
                    >
                      {revokingDeviceID === device.id ? t("connections.mobile.revoking") : t("connections.mobile.revoke")}
                    </button>
                  </div>
                )
              })
            ) : (
              <div className="mobile-connection-empty">{t("connections.mobile.emptyDevices")}</div>
            )}
          </div>
        </section>
      </div>
    </section>
  )
}
