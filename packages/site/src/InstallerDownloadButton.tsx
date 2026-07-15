import { useEffect, useState } from "react"
import type { AriaRole, MouseEvent, ReactNode } from "react"
import { useSiteLanguage } from "./language"
import {
  installerFallbackUrls,
  resolveInstaller,
  resolveLatestReleaseVersion,
  type InstallerPlatform,
} from "./releaseDownloads"
import { trackSiteEvent } from "./siteAnalytics"

type DownloadPlacement = "hero" | "final" | "docs" | "platform-menu"

export function InstallerDownloadButton({
  children,
  className,
  placement = "docs",
  platform,
  role,
}: {
  children: ReactNode
  className: string
  placement?: DownloadPlacement
  platform: InstallerPlatform
  role?: AriaRole
}) {
  const { language } = useSiteLanguage()
  const [releaseVersion, setReleaseVersion] = useState("")
  const [isResolving, setIsResolving] = useState(false)

  useEffect(() => {
    let ignoreResult = false

    resolveLatestReleaseVersion(platform)
      .then((version) => {
        if (!ignoreResult) setReleaseVersion(version)
      })
      .catch(() => {})

    return () => {
      ignoreResult = true
    }
  }, [platform])

  async function handleDownload(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    if (isResolving) return

    setIsResolving(true)
    const resolved = await resolveInstaller(platform)

    trackSiteEvent({
      language,
      name: "download_click",
      placement,
      platform,
      source: resolved.source,
      version: resolved.version,
    })
    window.location.assign(resolved.url)
  }

  return (
    <a
      aria-busy={isResolving || undefined}
      className={className}
      href={installerFallbackUrls[platform]}
      onClick={(event) => void handleDownload(event)}
      role={role}
    >
      <span>{children}</span>
      {releaseVersion ? <span className="button-version">{releaseVersion}</span> : null}
    </a>
  )
}
