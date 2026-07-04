import { type ReactNode, useEffect, useMemo, useState } from "react"
import QRCode from "qrcode"
import type { AgentFolderWorkspace, DesktopMobileBridgeStatus, DesktopMobileDeviceSummary } from "../../../../shared/desktop-ipc-contract"
import { useI18n } from "../i18n/I18nProvider"
import type { TranslationKey } from "../i18n/translations"
import { CopyIcon, ResetIcon } from "../icons"
import { joinClassNames, ShellTopMenu, writeTextToClipboard } from "../shared-ui"
import { SshConnectionsPage } from "./SshConnectionsPage"

type MobileTranslate = (key: TranslationKey, params?: Record<string, string | number>) => string
export type MobileConnectionPanel = "this-mac" | "ssh"

interface MobileConnectionPageProps {
  activePanel?: MobileConnectionPanel
  showAdvancedInfo?: boolean
  windowControls?: ReactNode
  onActivePanelChange?: (panel: MobileConnectionPanel) => void
  onWorkspaceOpened?: (workspace: AgentFolderWorkspace) => void | Promise<void>
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

function getPrimaryLanPairingUrl(status: DesktopMobileBridgeStatus | null) {
  if (!status || isLoopbackBridgeHost(status.host)) return ""
  return status.pairingUrls[0] ?? ""
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

function createConnectionOptionsDeepLink(input: { relayDeepLink?: string; lanUrl?: string; fallbackUrl?: string }) {
  const params = new URLSearchParams()
  if (input.relayDeepLink) params.set("relay", input.relayDeepLink)
  if (input.lanUrl) params.set("lan", input.lanUrl)
  if (params.toString()) return `anybox-mobile://connect-options?${params.toString()}`
  return createPairingDeepLink(input.fallbackUrl ?? "")
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
  return createConnectionOptionsDeepLink({
    relayDeepLink,
    lanUrl: getPrimaryLanPairingUrl(status),
    fallbackUrl: pairingUrl,
  })
}

function getPrimaryPairingExpiresAt(status: DesktopMobileBridgeStatus | null, now = Date.now()) {
  if (!status) return null
  const expiries = [
    getCloudRelayPairingDeepLink(status, now) ? status.cloudRelay.pairingExpiresAt ?? null : null,
    getPrimaryLanPairingUrl(status) ? status.pairingExpiresAt : null,
  ].filter((value): value is number => Boolean(value))
  if (expiries.length) return Math.min(...expiries)
  return status.pairingExpiresAt
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

function getCloudRelaySummary(status: DesktopMobileBridgeStatus | null, t: MobileTranslate) {
  const cloudRelay = status?.cloudRelay
  if (!cloudRelay) return t("connections.mobile.checking")
  if (cloudRelay.enabled && cloudRelay.state === "connected") return t("connections.mobile.connected")
  if (cloudRelay.enabled && cloudRelay.state === "registering") return t("connections.mobile.connecting")
  if (cloudRelay.enabled) return cloudRelay.state || t("connections.mobile.enabled")
  return t("connections.mobile.notConfigured")
}

function getCloudRelayTone(status: DesktopMobileBridgeStatus | null) {
  const cloudRelay = status?.cloudRelay
  if (cloudRelay?.enabled && cloudRelay.state === "connected") return "is-success"
  if (cloudRelay?.enabled) return "is-warning"
  return "is-muted"
}

function getBridgeTone(status: DesktopMobileBridgeStatus | null) {
  if (!status) return "is-muted"
  return status.running ? "is-success" : "is-warning"
}

function getLanTone(status: DesktopMobileBridgeStatus | null) {
  return getPrimaryLanPairingUrl(status) ? "is-success" : "is-muted"
}

const MOBILE_CONNECTION_TABS: Array<{
  key: MobileConnectionPanel
  labelKey: TranslationKey
}> = [
  { key: "this-mac", labelKey: "connections.mobile.tabs.thisMac" },
  { key: "ssh", labelKey: "connections.mobile.tabs.ssh" },
]

export function MobileConnectionPage({
  activePanel: controlledActivePanel,
  onActivePanelChange,
  onWorkspaceOpened,
  showAdvancedInfo = false,
  windowControls,
}: MobileConnectionPageProps = {}) {
  const { locale, t } = useI18n()
  const [uncontrolledActivePanel, setUncontrolledActivePanel] = useState<MobileConnectionPanel>("this-mac")
  const [status, setStatus] = useState<DesktopMobileBridgeStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [isRefreshingPairing, setIsRefreshingPairing] = useState(false)
  const [isRotating, setIsRotating] = useState(false)
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
  const pairingExpiryLabel = formatPairingExpiry(getPrimaryPairingExpiresAt(status, now), now, t)
  const lanPairingUrl = useMemo(() => getPrimaryLanPairingUrl(status), [status])
  const activePanel = controlledActivePanel ?? uncontrolledActivePanel

  function handleActivePanelChange(panel: MobileConnectionPanel) {
    if (controlledActivePanel === undefined) {
      setUncontrolledActivePanel(panel)
    }
    onActivePanelChange?.(panel)
  }

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
  const tabCounts: Record<MobileConnectionPanel, number> = {
    "this-mac": activeDeviceCount,
    ssh: 0,
  }

  return (
    <section className="mobile-connection-page" aria-label={t("connections.mobile.title")}>
      <ShellTopMenu
        as="header"
        ariaLabel={t("mobile.topMenu")}
        className="canvas-region-top-menu mobile-connection-top-menu"
        contentClassName="canvas-region-top-menu-tabs-shell"
        content={(
          <nav className="top-menu-segment-list mobile-connection-segment-list" role="tablist" aria-label={t("connections.mobile.categories")}>
            {MOBILE_CONNECTION_TABS.map((tab) => {
              const isActive = activePanel === tab.key
              const label = t(tab.labelKey)

              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls="mobile-connection-tab-panel"
                  className={joinClassNames("top-menu-segment mobile-connection-segment", isActive ? "is-active" : null)}
                  onClick={() => handleActivePanelChange(tab.key)}
                >
                  <span>{label}</span>
                  <small>{tabCounts[tab.key]}</small>
                </button>
              )
            })}
          </nav>
        )}
        dragRegion
        layout="three-column"
        trailing={windowControls}
        trailingClassName="mobile-connection-top-menu-window-controls"
      />

      <div className="mobile-connection-page-main">
        <div className="mobile-connection-shell">
          {error ? <div className="settings-banner is-error">{error}</div> : null}

          <div id="mobile-connection-tab-panel" role="tabpanel" className={`mobile-connection-tab-panel is-${activePanel}`}>
            {activePanel === "this-mac" ? (
              <>
                <div className="mobile-connection-workbench">
                  <aside className="mobile-connection-side-panel" aria-label={t("connections.mobile.statusTitle")}>
                    <div className="mobile-connection-sidebar-header">
                      <h2>{t("connections.mobile.title")}</h2>
                      <span>{activeDeviceCount}</span>
                    </div>

                    <section className="mobile-connection-panel mobile-connection-status-panel">
                      <div className="settings-section-header mobile-connection-sidebar-section-header">
                        <div>
                          <h3>{t("connections.mobile.statusTitle")}</h3>
                        </div>
                      </div>
                      <div className="mobile-connection-status-list">
                        <div className="mobile-connection-status-row">
                          <div>
                            <span>{t("connections.mobile.desktopReady")}</span>
                          </div>
                          <strong className={`mobile-connection-pill ${getBridgeTone(status)}`}>
                            {status?.running ? t("connections.mobile.ready") : t("connections.mobile.stopped")}
                          </strong>
                        </div>
                        <div className="mobile-connection-status-row">
                          <div>
                            <span>{t("connections.mobile.cloudRelay")}</span>
                          </div>
                          <strong className={`mobile-connection-pill ${getCloudRelayTone(status)}`}>
                            {getCloudRelaySummary(status, t)}
                          </strong>
                        </div>
                        <div className="mobile-connection-status-row">
                          <div>
                            <span>{t("connections.mobile.localNetwork")}</span>
                          </div>
                          <strong className={`mobile-connection-pill ${getLanTone(status)}`}>
                            {lanPairingUrl ? t("connections.mobile.available") : t("connections.mobile.unavailable")}
                          </strong>
                        </div>
                        <div className="mobile-connection-status-row">
                          <div>
                            <span>{t("connections.mobile.pairedDevices")}</span>
                          </div>
                          <strong>{activeDeviceCount}</strong>
                        </div>
                      </div>
                    </section>

                    <section className="mobile-connection-panel mobile-connection-devices-panel">
                      <div className="settings-section-header">
                        <div>
                          <h3>{t("connections.mobile.pairedDevices")}</h3>
                        </div>
                        <button
                          type="button"
                          className="secondary-button mobile-connection-sidebar-action"
                          onClick={() => void refreshStatus()}
                        >
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
                                </div>
                                <span className="mobile-connection-device-meta">
                                  {revoked
                                    ? t("connections.mobile.revoked")
                                    : t("connections.mobile.lastSeen", { time: formatDeviceTime(device.lastSeenAt, locale) })}
                                </span>
                                {revoked ? null : (
                                  <button
                                    type="button"
                                    className="secondary-button is-danger mobile-connection-device-action"
                                    disabled={revokingDeviceID === device.id}
                                    onClick={() => void revokeDevice(device.id)}
                                  >
                                    {revokingDeviceID === device.id ? t("connections.mobile.revoking") : t("connections.mobile.revoke")}
                                  </button>
                                )}
                              </div>
                            )
                          })
                        ) : (
                          <div className="mobile-connection-empty">{t("connections.mobile.emptyDevices")}</div>
                        )}
                      </div>
                    </section>
                  </aside>

                  <section className="mobile-connection-pairing-panel" aria-label={t("connections.mobile.scanTitle")}>
                    <div className="mobile-connection-pairing-copy">
                      <h2>{t("connections.mobile.scanTitle")}</h2>
                    </div>

                    <div className="mobile-connection-pairing-body">
                      <div className="mobile-connection-qr-stage">
                        <div className="mobile-connection-qr" aria-label={t("connections.mobile.qrCode")}>
                          {qrDataUrl ? (
                            <img src={qrDataUrl} alt={t("connections.mobile.qrCode")} />
                          ) : (
                            <span>{pairingDeepLink || primaryPairingUrl ? t("connections.mobile.generating") : t("connections.mobile.unavailable")}</span>
                          )}
                        </div>
                        <p>{pairingExpiryLabel}</p>
                        {!pairingDeepLink && status ? (
                          <small>{t("connections.mobile.noPairingAddress")}</small>
                        ) : null}
                      </div>
                    </div>

                    <div className="mobile-connection-primary-actions">
                      <button
                        type="button"
                        className="secondary-button mobile-connection-refresh-button"
                        disabled={isRefreshingPairing}
                        onClick={() => void refreshPairingCode()}
                      >
                        {isRefreshingPairing ? t("connections.mobile.refreshing") : t("connections.mobile.refreshQr")}
                      </button>
                    </div>
                  </section>
                </div>

                {showAdvancedInfo ? (
                  <section className="mobile-connection-panel mobile-connection-advanced-panel">
                    <div className="settings-section-header">
                      <div>
                        <h3>{t("connections.mobile.advancedTroubleshooting")}</h3>
                        <p>{t("connections.mobile.advancedDescription")}</p>
                      </div>
                    </div>

                    <div className="mobile-connection-advanced-body">
                      <div className="mobile-connection-technical-grid">
                        <div>
                          <span>{t("connections.mobile.listeningAddress")}</span>
                          <strong>{status?.host ?? "0.0.0.0"}</strong>
                        </div>
                        <div>
                          <span>{t("connections.mobile.portLabel")}</span>
                          <strong>{status?.port ?? t("connections.mobile.portUnavailable")}</strong>
                        </div>
                        <div>
                          <span>{t("connections.mobile.bridgeStatus")}</span>
                          <strong>{status?.running ? t("connections.mobile.running") : t("connections.mobile.stopped")}</strong>
                        </div>
                      </div>

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
                          disabled={!androidSmokeCommand}
                          onClick={() => void copyValue("smoke-command", androidSmokeCommand)}
                        >
                          <CopyIcon />
                          {copied === "smoke-command" ? t("connections.mobile.copied") : t("connections.mobile.copyTestCommand")}
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
                        {status && pairingUrls.length === 0 ? (
                          <div className="mobile-connection-empty">{t("connections.mobile.noPairingAddress")}</div>
                        ) : null}
                      </div>
                      <code className="mobile-connection-token">{status?.token ?? ""}</code>
                    </div>
                  </section>
                ) : null}
              </>
            ) : (
              <div className="mobile-connection-ssh-panel">
                <SshConnectionsPage searchQuery="" onWorkspaceOpened={onWorkspaceOpened} />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
