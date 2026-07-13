export type InstallerPlatform = "windows" | "mac" | "mobile"

export const repositoryUrl = "https://github.com/fanfan-de/anybox"

const releasesApiUrl =
  "https://api.github.com/repos/fanfan-de/anybox/releases?per_page=100"
const downloadManifestUrl =
  import.meta.env.VITE_DOWNLOAD_MANIFEST_URL?.trim() || ""

export const installerFallbackUrls: Record<InstallerPlatform, string> = {
  windows: `${repositoryUrl}/releases`,
  mac: `${repositoryUrl}/releases`,
  mobile: `${repositoryUrl}/releases`,
}

type GitHubReleaseAsset = {
  browser_download_url?: unknown
  name?: unknown
}

type GitHubRelease = {
  assets?: unknown
  tag_name?: unknown
}

type DownloadManifestPlatform = {
  fallbackUrl?: unknown
  url?: unknown
  version?: unknown
}

type DownloadManifest = {
  platforms?: unknown
  version?: unknown
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

function normalizeVersionLabel(version: string) {
  const normalizedVersion = version.trim()

  if (!normalizedVersion) return undefined

  const versionMatch = normalizedVersion.match(
    /(?:^|-)v?(\d+(?:\.\d+){1,3}(?:[-+][0-9a-z.-]+)?)$/i,
  )

  if (versionMatch?.[1]) {
    return `v${versionMatch[1]}`
  }

  return normalizedVersion
}

const installerMatchers: Record<
  InstallerPlatform,
  (normalizedName: string) => boolean
> = {
  windows: (normalizedName) =>
    normalizedName.endsWith(".exe") &&
    normalizedName.includes("anybox") &&
    normalizedName.includes("x64"),
  mac: (normalizedName) =>
    normalizedName.endsWith(".dmg") &&
    normalizedName.includes("anybox") &&
    normalizedName.includes("arm64"),
  mobile: (normalizedName) =>
    normalizedName.endsWith(".apk") && normalizedName.includes("anybox"),
}

function getInstallerAsset(release: GitHubRelease, platform: InstallerPlatform) {
  if (!Array.isArray(release.assets)) return undefined

  return release.assets.find((asset): asset is GitHubReleaseAsset => {
    if (!asset || typeof asset !== "object") return false

    const { browser_download_url: downloadUrl, name } =
      asset as GitHubReleaseAsset

    if (typeof downloadUrl !== "string" || typeof name !== "string") {
      return false
    }

    return installerMatchers[platform](name.toLowerCase())
  })
}

function getInstallerUrl(release: GitHubRelease, platform: InstallerPlatform) {
  const installer = getInstallerAsset(release, platform)

  return typeof installer?.browser_download_url === "string"
    ? installer.browser_download_url
    : undefined
}

function getManifestPlatform(
  manifest: DownloadManifest | undefined,
  platform: InstallerPlatform,
) {
  if (!manifest || !isRecord(manifest)) return undefined

  const platforms = isRecord(manifest.platforms)
    ? (manifest.platforms as DownloadManifestPlatformMap)
    : undefined
  const manifestRecord = manifest as Record<string, unknown>
  const platformEntry = platforms?.[platform] ?? manifestRecord[platform]

  return isRecord(platformEntry)
    ? (platformEntry as DownloadManifestPlatform)
    : undefined
}

function getManifestVersion(
  manifest: DownloadManifest | undefined,
  platform: InstallerPlatform,
) {
  const platformVersion = getManifestPlatform(manifest, platform)?.version

  if (isNonEmptyString(platformVersion)) {
    return normalizeVersionLabel(platformVersion)
  }

  return undefined
}

function getManifestInstallerUrl(
  manifest: DownloadManifest | undefined,
  platform: InstallerPlatform,
) {
  const url = getManifestPlatform(manifest, platform)?.url

  return isNonEmptyString(url) ? url.trim() : undefined
}

function getManifestFallbackUrl(
  manifest: DownloadManifest | undefined,
  platform: InstallerPlatform,
) {
  const url = getManifestPlatform(manifest, platform)?.fallbackUrl

  return isNonEmptyString(url) ? url.trim() : undefined
}

function fetchDownloadManifest() {
  if (!downloadManifestUrl) return Promise.resolve(undefined)

  if (!downloadManifestPromise) {
    downloadManifestPromise = fetch(downloadManifestUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Download manifest request failed: ${response.status}`)
        }

        return response.json() as Promise<DownloadManifest>
      })
      .catch((error: unknown) => {
        downloadManifestPromise = undefined
        throw error
      })
  }

  return downloadManifestPromise
}

function fetchReleases() {
  if (!releasesPromise) {
    releasesPromise = fetch(releasesApiUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
      },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`GitHub releases request failed: ${response.status}`)
        }

        return response.json() as Promise<GitHubRelease[]>
      })
      .catch((error: unknown) => {
        releasesPromise = undefined
        throw error
      })
  }

  return releasesPromise
}

async function resolveLatestReleaseForPlatform(platform: InstallerPlatform) {
  const releases = await fetchReleases()
  return releases.find((release) => getInstallerAsset(release, platform))
}

export async function resolveLatestReleaseVersion(platform: InstallerPlatform) {
  try {
    const manifestVersion = getManifestVersion(
      await fetchDownloadManifest(),
      platform,
    )

    if (manifestVersion) return manifestVersion
  } catch {}

  const release = await resolveLatestReleaseForPlatform(platform)
  const tagName =
    typeof release?.tag_name === "string"
      ? normalizeVersionLabel(release.tag_name)
      : undefined

  return tagName ?? ""
}

async function resolveLatestInstallerUrl(platform: InstallerPlatform) {
  try {
    const manifestInstallerUrl = getManifestInstallerUrl(
      await fetchDownloadManifest(),
      platform,
    )

    if (manifestInstallerUrl) return manifestInstallerUrl
  } catch {}

  const release = await resolveLatestReleaseForPlatform(platform)

  if (!release) {
    throw new Error(`No ${platform} installer release found`)
  }

  const downloadUrl = getInstallerUrl(
    release,
    platform,
  )

  if (!downloadUrl) {
    throw new Error(`No ${platform} installer asset found in latest release`)
  }

  return downloadUrl
}

async function resolveFallbackUrl(platform: InstallerPlatform) {
  try {
    return (
      getManifestFallbackUrl(await fetchDownloadManifest(), platform) ??
      installerFallbackUrls[platform]
    )
  } catch {
    return installerFallbackUrls[platform]
  }
}

export async function navigateToLatestInstaller(platform: InstallerPlatform) {
  try {
    window.location.assign(await resolveLatestInstallerUrl(platform))
  } catch {
    window.location.assign(await resolveFallbackUrl(platform))
  }
}
