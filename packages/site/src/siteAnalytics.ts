import type { SiteLanguage } from "./language"
import type { InstallerPlatform, InstallerSource } from "./releaseDownloads"

export type SiteAnalyticsEvent =
  | {
      name: "download_click"
      language: SiteLanguage
      placement: "hero" | "final" | "docs" | "platform-menu"
      platform: InstallerPlatform
      source: InstallerSource
      version?: string
    }
  | {
      name: "navigation_click"
      language: SiteLanguage
      destination: "docs" | "github" | "pricing" | "releases"
      placement: "header" | "hero" | "trust" | "footer" | "final"
    }
  | {
      name: "platform_menu_open"
      language: SiteLanguage
      placement: "hero" | "final"
    }

const analyticsEndpoint = import.meta.env.VITE_SITE_ANALYTICS_ENDPOINT?.trim()

export function trackSiteEvent(event: SiteAnalyticsEvent) {
  if (!analyticsEndpoint || typeof window === "undefined") return

  const body = JSON.stringify({
    ...event,
    path: window.location.pathname,
    timestamp: new Date().toISOString(),
  })

  if (navigator.sendBeacon) {
    navigator.sendBeacon(
      analyticsEndpoint,
      new Blob([body], { type: "application/json" }),
    )
    return
  }

  void fetch(analyticsEndpoint, {
    body,
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    method: "POST",
  }).catch(() => {})
}
