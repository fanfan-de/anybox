import { useEffect, useId, useMemo, useState } from "react"
import { InstallerDownloadButton } from "./InstallerDownloadButton"
import { useSiteLanguage } from "./language"
import {
  detectInstallerPlatform,
  type InstallerPlatform,
} from "./releaseDownloads"
import { trackSiteEvent } from "./siteAnalytics"

export type DownloadPlacement = "hero" | "final"

const platformLabels: Record<InstallerPlatform, { en: string; zh: string }> = {
  windows: { en: "Windows", zh: "Windows" },
  mac: { en: "macOS", zh: "macOS" },
  linux: { en: "Linux", zh: "Linux" },
  mobile: { en: "Android", zh: "Android" },
}

export function DownloadCta({ placement }: { placement: DownloadPlacement }) {
  const { language } = useSiteLanguage()
  const menuId = useId()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [detectedPlatform, setDetectedPlatform] = useState<InstallerPlatform>()

  useEffect(() => {
    setDetectedPlatform(detectInstallerPlatform())
  }, [])

  const primaryPlatform = detectedPlatform ?? "windows"
  const primaryLabel = useMemo(() => {
    const platform = platformLabels[primaryPlatform][language]
    return language === "zh" ? `下载 ${platform} 版` : `Download for ${platform}`
  }, [language, primaryPlatform])

  return (
    <div
      className="download-cta"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setIsMenuOpen(false)
        }
      }}
    >
      <InstallerDownloadButton
        className="button button-primary download-primary"
        placement={placement}
        platform={primaryPlatform}
      >
        {primaryLabel}
      </InstallerDownloadButton>
      <button
        aria-controls={menuId}
        aria-expanded={isMenuOpen}
        className="button button-secondary download-menu-trigger"
        onClick={() => {
          setIsMenuOpen((open) => {
            if (!open) {
              trackSiteEvent({
                language,
                name: "platform_menu_open",
                placement,
              })
            }
            return !open
          })
        }}
        type="button"
      >
        {language === "zh" ? "其他平台" : "Other platforms"}
      </button>
      {isMenuOpen ? (
        <div className="download-platform-menu" id={menuId} role="menu">
          {(Object.keys(platformLabels) as InstallerPlatform[]).map((platform) => (
            <InstallerDownloadButton
              className={platform === primaryPlatform ? "is-current" : ""}
              key={platform}
              placement="platform-menu"
              platform={platform}
              role="menuitem"
            >
              {language === "zh"
                ? `${platformLabels[platform].zh} 下载`
                : `Download for ${platformLabels[platform].en}`}
            </InstallerDownloadButton>
          ))}
        </div>
      ) : null}
    </div>
  )
}
