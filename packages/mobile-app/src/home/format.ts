import type { MobileAccountRelayDesktop } from "@/api/account-api"
import type { MobileConnection, MobileSessionSummary, MobileStatus } from "@/api/mobile-api"
import type { MobileTranslationKey } from "@/i18n"

type Translate = (key: MobileTranslationKey, params?: Record<string, string | number>) => string

export function formatProviderStatus({
  accountDesktopsLoading,
  connectingDesktopID,
  connection,
  onlineDesktops,
  status,
  t,
}: {
  accountDesktopsLoading: boolean
  connectingDesktopID: string | null
  connection: MobileConnection | null
  onlineDesktops: MobileAccountRelayDesktop[]
  status: MobileStatus | null
  t: Translate
}) {
  if (connection) {
    const name = status?.desktopName?.trim() || t("home.provider.defaultDesktop")
    if (status?.online) {
      return {
        label: t("home.provider.connected"),
        detail: status.appVersion ? `${name} ${status.appVersion}` : name,
        tone: "success" as const,
      }
    }
    return {
      label: t("home.provider.checking"),
      detail: connection.transport === "relay" ? t("home.provider.relaySaved") : connection.baseUrl,
      tone: "neutral" as const,
    }
  }

  if (connectingDesktopID) {
    return {
      label: t("home.provider.connecting"),
      detail: t("home.provider.preparingBridge"),
      tone: "neutral" as const,
    }
  }

  if (accountDesktopsLoading) {
    return {
      label: t("home.provider.searching"),
      detail: t("home.provider.searchingDetail"),
      tone: "neutral" as const,
    }
  }

  if (onlineDesktops.length) {
    return {
      label: t("home.provider.available"),
      detail: onlineDesktops.length === 1
        ? t("home.provider.oneDesktopOnline", { name: onlineDesktops[0]!.name })
        : t("home.provider.manyDesktopsOnline", { count: onlineDesktops.length }),
      tone: "neutral" as const,
    }
  }

  return {
    label: t("home.provider.offline"),
    detail: t("home.provider.startDesktop"),
    tone: "danger" as const,
  }
}

export function sortSessions(sessions: MobileSessionSummary[]) {
  return [...sessions].sort((left, right) => right.updated - left.updated)
}

export function buildSessionTitle(text: string, fallback = "Mobile chat") {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim())?.trim() || fallback
  return firstLine.length > 48 ? `${firstLine.slice(0, 45)}...` : firstLine
}
