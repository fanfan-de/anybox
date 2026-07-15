export type InstallerPlatform = "windows" | "mac" | "linux" | "mobile"
export type InstallerSource = "manifest" | "github" | "fallback"

export type ResolvedInstaller = {
  platform: InstallerPlatform
  source: InstallerSource
  url: string
  version?: string
}

export const repositoryUrl = "https://github.com/fanfan-de/anybox"
export const releasesUrl = `${repositoryUrl}/releases`

const releasesApiUrl =
  "https://api.github.com/repos/fanfan-de/anybox/releases?per_page=100"
const downloadManifestUrl =
  import.meta.env.VITE_DOWNLOAD_MANIFEST_URL?.trim() || ""

export const installerFallbackUrls: Record<InstallerPlatform, string> = {
  windows: releasesUrl,
  mac: releasesUrl,
  linux: releasesUrl,
  mobile: releasesUrl,
}

type GitHubReleaseAsset = {
  browser_download_url?: unknown
  name?: unknown
}

type GitHubRelease = {
  assets?: unknown
  published_at?: unknown
  tag_name?: unknown
}

type DownloadManifestPlatform = {
  fallbackUrl?: unknown
  url?: unknown
  version?: unknown
}

type DownloadManifest = {
  platforms?: unknown
}

type DownloadManifestPlatformMap = Partial<
  Record<InstallerPlatform, DownloadManifestPlatform>
>

let downloadManifestPromise: Promise<DownloadManifest | undefined> | undefined
let releasesPromise: Promise<GitHubRelease[]> | undefined

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

export function normalizeVersionLabel(version: string) {
  const normalizedVersion = version.trim()

  if (!normalizedVersion) return undefined

  const versionMatch = normalizedVersion.match(
    /(?:^|-)v?(\d+(?:\.\d+){1,3}(?:[-+][0-9a-z.-]+)?)$/i,
  )

  return versionMatch?.[1] ? `v${versionMatch[1]}` : normalizedVersion
}

export function detectInstallerPlatform(userAgent = navigator.userAgent) {
  const normalizedUserAgent = userAgent.toLowerCase()

  if (normalizedUserAgent.includes("android")) return "mobile" as const
  if (normalizedUserAgent.includes("windows")) return "windows" as const
  if (normalizedUserAgent.includes("macintosh") || normalizedUserAgent.includes("mac os")) {
    return "mac" as const
  }
  if (normalizedUserAgent.includes("linux")) return "linux" as const

  return undefined
}

const installerMatchers: Record<
  InstallerPlatform,
  (normalizedName: string) => boolean
> = {
  windows: (name) =>
    name.endsWith(".exe") && name.includes("anybox") && name.includes("x64"),
  mac: (name) =>
    name.endsWith(".dmg") && name.includes("anybox") && name.includes("arm64"),
  linux: (name) =>
    name.endsWith(".appimage") && name.includes("anybox") && name.includes("x64"),
  mobile: (name) => name.endsWith(".apk") && name.includes("anybox"),
}

function getInstallerAsset(release: GitHubRelease, platform: InstallerPlatform) {
  if (!Array.isArray(release.assets)) return undefined

  return release.assets.find((asset): asset is GitHubReleaseAsset => {
    if (!isRecord(asset)) return false
    return (
      isNonEmptyString(asset.browser_download_url) &&
      isNonEmptyString(asset.name) &&
      installerMatchers[platform](asset.name.toLowerCase())
    )
  })
}

function getManifestPlatform(
  manifest: DownloadManifest | undefined,
  platform: InstallerPlatform,
) {
  if (!manifest || !isRecord(manifest.platforms)) return undefined
  const entry = (manifest.platforms as DownloadManifestPlatformMap)[platform]
  return isRecord(entry) ? entry : undefined
}

function fetchDownloadManifest() {
  if (!downloadManifestUrl) return Promise.resolve(undefined)

  downloadManifestPromise ??= fetch(downloadManifestUrl, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  })
    .then((response) => {
      if (!response.ok) throw new Error(`Manifest request failed: ${response.status}`)
      return response.json() as Promise<DownloadManifest>
    })
    .catch((error: unknown) => {
      downloadManifestPromise = undefined
      throw error
    })

  return downloadManifestPromise
}

function fetchReleases() {
  releasesPromise ??= fetch(releasesApiUrl, {
    cache: "no-store",
    headers: { Accept: "application/vnd.github+json" },
  })
    .then((response) => {
      if (!response.ok) throw new Error(`GitHub releases request failed: ${response.status}`)
      return response.json() as Promise<GitHubRelease[]>
    })
    .catch((error: unknown) => {
      releasesPromise = undefined
      throw error
    })

  return releasesPromise
}

export async function resolveInstaller(
  platform: InstallerPlatform,
): Promise<ResolvedInstaller> {
  let manifest: DownloadManifest | undefined

  try {
    manifest = await fetchDownloadManifest()
    const manifestPlatform = getManifestPlatform(manifest, platform)

    if (isNonEmptyString(manifestPlatform?.url)) {
      const version = isNonEmptyString(manifestPlatform.version)
        ? normalizeVersionLabel(manifestPlatform.version)
        : undefined

      return {
        platform,
        source: "manifest",
        url: manifestPlatform.url.trim(),
        version,
      }
    }
  } catch {}

  try {
    const release = (await fetchReleases()).find((item) =>
      Boolean(getInstallerAsset(item, platform)),
    )
    const asset = release ? getInstallerAsset(release, platform) : undefined

    if (asset && isNonEmptyString(asset.browser_download_url)) {
      return {
        platform,
        source: "github",
        url: asset.browser_download_url,
        version: isNonEmptyString(release?.tag_name)
          ? normalizeVersionLabel(release.tag_name)
          : undefined,
      }
    }
  } catch {}

  const manifestFallback = getManifestPlatform(manifest, platform)?.fallbackUrl

  return {
    platform,
    source: "fallback",
    url: isNonEmptyString(manifestFallback)
      ? manifestFallback.trim()
      : installerFallbackUrls[platform],
  }
}

export async function resolveLatestReleaseVersion(platform: InstallerPlatform) {
  return (await resolveInstaller(platform)).version ?? ""
}
