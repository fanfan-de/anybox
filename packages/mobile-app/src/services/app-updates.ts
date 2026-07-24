import * as Application from "expo-application"
import Constants from "expo-constants"
import * as Updates from "expo-updates"
import { Linking, Platform } from "react-native"
import {
  addDownloadProgressListener,
  canRequestPackageInstalls,
  cancelDownload,
  clearStaleDownloads,
  downloadApk,
  installApk,
  isAndroidUpdaterAvailable,
  openInstallPermissionSettings,
  verifyDetachedSignature,
  type DownloadProgress,
  type DownloadedApk,
} from "../../modules/anybox-android-updater"
import {
  isAndroidReleaseNewer,
  isAndroidReleaseRequired,
} from "./update-policy"

export type { DownloadProgress } from "../../modules/anybox-android-updater"
export { isAndroidReleaseNewer, isAndroidReleaseRequired } from "./update-policy"

const DEFAULT_RELEASE_TIMEOUT_MS = 12_000
const DEFAULT_GITHUB_API_VERSION = "2022-11-28"
const MAX_APK_BYTES = 500 * 1024 * 1024
const EXPECTED_PACKAGE_NAME = "com.anybox.mobile"
const SHA256_PATTERN = /^[a-f0-9]{64}$/

export interface CurrentAppInfo {
  version: string
  buildVersion: string | null
  versionCode: number | null
  packageName: string | null
  platform: string
  channel: string | null
  runtimeVersion: string | null
  updateId: string | null
  updateCreatedAt: string | null
  isEmbeddedUpdate: boolean
  updatesEnabled: boolean
  updatesUrl: string | null
  releaseManifestUrl: string | null
  releaseSignatureUrl: string | null
  updaterAvailable: boolean
}

export interface OtaUpdateCheck {
  checked: boolean
  enabled: boolean
  available: boolean
  rollback: boolean
  channel: string | null
  runtimeVersion: string | null
  updateId: string | null
  status: "skipped" | "disabled" | "current" | "available" | "error"
  error?: string
}

export interface AndroidReleaseManifest {
  schemaVersion: 1
  platform: "android"
  version: string
  versionCode: number
  minimumVersionCode: number
  apkUrl: string
  fallbackApkUrl: string
  sha256: string
  sizeBytes: number
  publishedAt: string
  notes: string[]
  force: boolean
}

export type BinaryRelease = AndroidReleaseManifest

export interface BinaryUpdateCheck {
  checked: boolean
  configured: boolean
  available: boolean
  required: boolean
  signatureVerified: boolean
  source: "primary" | "github" | "none"
  release: AndroidReleaseManifest | null
  status: "skipped" | "unsupported" | "current" | "available" | "required" | "error"
  error?: string
}

export interface AppUpdateCheckResult {
  checkedAt: number
  current: CurrentAppInfo
  ota: OtaUpdateCheck
  binary: BinaryUpdateCheck
}

export interface CheckAppUpdatesOptions {
  includeOta?: boolean
  includeBinary?: boolean
}

interface GitHubReleaseSource {
  repository: string
  tagPrefix: string
  apkAssetName: string
  manifestAssetName: string
  signatureAssetName: string
}

interface GitHubAsset {
  name: string
  browserDownloadUrl: string
}

type GitHubRelease = Record<string, unknown>

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function readInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function getExtra() {
  return readRecord(Constants.expoConfig?.extra)
}

function getConfiguredString(key: string, environmentValue?: string) {
  return environmentValue?.trim() || readString(getExtra()?.[key])
}

export function getCurrentAppInfo(): CurrentAppInfo {
  const version = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "0.0.0"
  const buildVersion = Application.nativeBuildVersion
  const versionCode = Platform.OS === "android" ? readInteger(buildVersion) : null
  return {
    version,
    buildVersion,
    versionCode,
    packageName: Application.applicationId,
    platform: Platform.OS,
    channel: Updates.channel || getConfiguredString("anyboxMobileUpdateChannel"),
    runtimeVersion: Updates.runtimeVersion,
    updateId: Updates.updateId,
    updateCreatedAt: Updates.createdAt?.toISOString() ?? null,
    isEmbeddedUpdate: Updates.isEmbeddedLaunch,
    updatesEnabled: Updates.isEnabled,
    updatesUrl: readString(Constants.expoConfig?.updates?.url),
    releaseManifestUrl:
      getConfiguredString(
        "anyboxMobileReleaseUrl",
        process.env.EXPO_PUBLIC_ANYBOX_MOBILE_RELEASE_URL,
      ) ?? null,
    releaseSignatureUrl:
      getConfiguredString(
        "anyboxMobileReleaseSignatureUrl",
        process.env.EXPO_PUBLIC_ANYBOX_MOBILE_RELEASE_SIGNATURE_URL,
      ) ?? null,
    updaterAvailable: Platform.OS === "android" && isAndroidUpdaterAvailable,
  }
}

export function formatAppVersionLabel(info: CurrentAppInfo) {
  return info.buildVersion ? `${info.version} (${info.buildVersion})` : info.version
}

export async function checkAppUpdates(
  options: CheckAppUpdatesOptions = {},
): Promise<AppUpdateCheckResult> {
  const current = getCurrentAppInfo()
  const includeOta = options.includeOta ?? true
  const includeBinary = options.includeBinary ?? true
  const [ota, binary] = await Promise.all([
    includeOta ? checkOtaUpdate() : Promise.resolve(createSkippedOtaUpdateCheck()),
    includeBinary
      ? checkBinaryUpdate(current)
      : Promise.resolve(createSkippedBinaryUpdateCheck(current)),
  ])
  return { checkedAt: Date.now(), current, ota, binary }
}

export async function checkOtaUpdate(): Promise<OtaUpdateCheck> {
  const base = {
    checked: true,
    enabled: Updates.isEnabled,
    channel: getCurrentAppInfo().channel,
    runtimeVersion: Updates.runtimeVersion,
    updateId: Updates.updateId,
  }
  if (!Updates.isEnabled) {
    return {
      ...base,
      available: false,
      rollback: false,
      status: "disabled",
    }
  }
  try {
    const update = await Updates.checkForUpdateAsync()
    const available = update.isAvailable || update.isRollBackToEmbedded
    return {
      ...base,
      available,
      rollback: update.isRollBackToEmbedded,
      status: available ? "available" : "current",
    }
  } catch (error) {
    return {
      ...base,
      available: false,
      rollback: false,
      status: "error",
      error: errorMessage(error, "Unable to check OTA updates."),
    }
  }
}

export async function downloadOtaUpdate() {
  if (!Updates.isEnabled) throw new Error("OTA updates are not enabled in this build.")
  const result = await Updates.fetchUpdateAsync()
  if (!result.isNew && !result.isRollBackToEmbedded) {
    throw new Error("No downloaded OTA update is ready to apply.")
  }
  return {
    downloaded: result.isNew || result.isRollBackToEmbedded,
    rollback: result.isRollBackToEmbedded,
  }
}

export async function reloadToDownloadedOtaUpdate() {
  await Updates.reloadAsync()
}

export async function checkBinaryUpdate(current = getCurrentAppInfo()): Promise<BinaryUpdateCheck> {
  if (Platform.OS !== "android") {
    return {
      checked: false,
      configured: false,
      available: false,
      required: false,
      signatureVerified: false,
      source: "none",
      release: null,
      status: "unsupported",
    }
  }
  if (
    !current.releaseManifestUrl ||
    !current.releaseSignatureUrl ||
    !current.updaterAvailable
  ) {
    return {
      checked: false,
      configured: false,
      available: false,
      required: false,
      signatureVerified: false,
      source: "none",
      release: null,
      status: "error",
      error: "Signed Android release updates are not configured in this build.",
    }
  }

  let primaryError: string | null = null
  try {
    const release = await fetchSignedAndroidRelease(
      current.releaseManifestUrl,
      current.releaseSignatureUrl,
    )
    return binaryResultForRelease(release, current, "primary")
  } catch (error) {
    primaryError = errorMessage(error, "Primary release manifest failed.")
  }

  try {
    const source = getGitHubReleaseSource()
    if (!source) throw new Error("GitHub fallback is not configured.")
    const release = await fetchGitHubSignedAndroidRelease(source)
    return binaryResultForRelease(release, current, "github")
  } catch (error) {
    return {
      checked: true,
      configured: true,
      available: false,
      required: false,
      signatureVerified: false,
      source: "none",
      release: null,
      status: "error",
      error: `${primaryError} GitHub fallback: ${errorMessage(error, "failed")}`,
    }
  }
}

function binaryResultForRelease(
  release: AndroidReleaseManifest,
  current: CurrentAppInfo,
  source: "primary" | "github",
): BinaryUpdateCheck {
  const available = isAndroidReleaseNewer(release, current.versionCode)
  const required = available && isAndroidReleaseRequired(release, current.versionCode)
  return {
    checked: true,
    configured: true,
    available,
    required,
    signatureVerified: true,
    source,
    release: available ? release : null,
    status: required ? "required" : available ? "available" : "current",
  }
}

async function fetchSignedAndroidRelease(manifestUrl: string, signatureUrl: string) {
  const [manifestText, signatureText] = await Promise.all([
    fetchText(manifestUrl, "Android release manifest"),
    fetchText(signatureUrl, "Android release signature"),
  ])
  const verified = await verifyDetachedSignature(manifestText, signatureText.trim())
  if (!verified) throw new Error("Android release manifest signature verification failed.")
  let value: unknown
  try {
    value = JSON.parse(manifestText)
  } catch {
    throw new Error("Signed Android release manifest is not valid JSON.")
  }
  return normalizeAndroidRelease(value)
}

function normalizeAndroidRelease(value: unknown): AndroidReleaseManifest {
  const source = readRecord(value)
  if (!source) throw new Error("Android release manifest must be an object.")
  if (source.schemaVersion !== 1 || source.platform !== "android") {
    throw new Error("Unsupported Android release manifest schema.")
  }
  const version = readString(source.version)
  const versionCode = readInteger(source.versionCode)
  const minimumVersionCode = readInteger(source.minimumVersionCode)
  const apkUrl = readString(source.apkUrl)
  const fallbackApkUrl = readString(source.fallbackApkUrl)
  const sha256 = readString(source.sha256)?.toLowerCase() ?? null
  const sizeBytes = readInteger(source.sizeBytes)
  const publishedAt = readString(source.publishedAt)
  if (!version || version.length > 50) throw new Error("Android release version is invalid.")
  if (!versionCode || versionCode <= 0) throw new Error("Android release versionCode is invalid.")
  if (!minimumVersionCode || minimumVersionCode <= 0 || minimumVersionCode > versionCode) {
    throw new Error("Android release minimumVersionCode is invalid.")
  }
  if (!apkUrl || !isAllowedApkUrl(apkUrl, "primary")) {
    throw new Error("Android release APK URL is not an allowed Anybox CDN URL.")
  }
  if (!fallbackApkUrl || !isAllowedApkUrl(fallbackApkUrl, "fallback")) {
    throw new Error("Android release fallback URL is not an allowed GitHub URL.")
  }
  if (!sha256 || !SHA256_PATTERN.test(sha256)) throw new Error("Android release SHA-256 is invalid.")
  if (!sizeBytes || sizeBytes <= 0 || sizeBytes > MAX_APK_BYTES) {
    throw new Error("Android release APK size is invalid.")
  }
  if (
    !publishedAt ||
    !Number.isFinite(Date.parse(publishedAt)) ||
    new Date(Date.parse(publishedAt)).toISOString() !== publishedAt
  ) {
    throw new Error("Android release publishedAt is invalid.")
  }
  if (
    !Array.isArray(source.notes) ||
    source.notes.length > 100 ||
    !source.notes.every((note) => typeof note === "string" && note.length <= 2_000)
  ) {
    throw new Error("Android release notes are invalid.")
  }
  if (typeof source.force !== "boolean") throw new Error("Android release force flag is invalid.")

  return {
    schemaVersion: 1,
    platform: "android",
    version,
    versionCode,
    minimumVersionCode,
    apkUrl,
    fallbackApkUrl,
    sha256,
    sizeBytes,
    publishedAt,
    notes: source.notes as string[],
    force: source.force,
  }
}

function isAllowedApkUrl(value: string, kind: "primary" | "fallback") {
  try {
    const url = new URL(value)
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    ) {
      return false
    }
    if (kind === "primary") {
      return (
        url.hostname === "download.anybox.com.cn" &&
        /^\/mobile\/android\/releases\/[^/]+\/anybox-mobile\.apk$/.test(url.pathname)
      )
    }
    return (
      url.hostname === "github.com" &&
      /^\/[^/]+\/[^/]+\/releases\/download\/mobile-v[^/]+\/anybox-mobile\.apk$/.test(
        url.pathname,
      )
    )
  } catch {
    return false
  }
}

async function fetchText(url: string, label: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_RELEASE_TIMEOUT_MS)
  try {
    const parsed = new URL(url)
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      (parsed.port && parsed.port !== "443") ||
      !isAllowedReleaseMetadataHost(parsed.hostname)
    ) {
      throw new Error(`${label} uses an untrusted URL.`)
    }
    const response = await fetch(parsed, {
      headers: { accept: "application/json, text/plain" },
      signal: controller.signal,
    })
    const finalUrl = new URL(response.url || parsed)
    if (
      finalUrl.protocol !== "https:" ||
      finalUrl.username ||
      finalUrl.password ||
      (finalUrl.port && finalUrl.port !== "443") ||
      !isAllowedReleaseMetadataHost(finalUrl.hostname)
    ) {
      throw new Error(`${label} redirected to an untrusted URL.`)
    }
    if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}.`)
    const text = await response.text()
    if (text.length > 1_000_000) throw new Error(`${label} exceeds the 1 MB safety limit.`)
    return text
  } finally {
    clearTimeout(timeout)
  }
}

function isAllowedReleaseMetadataHost(hostname: string) {
  return (
    hostname === "download.anybox.com.cn" ||
    hostname === "github.com" ||
    hostname === "objects.githubusercontent.com" ||
    hostname === "release-assets.githubusercontent.com" ||
    hostname === "github-releases.githubusercontent.com"
  )
}

function getGitHubReleaseSource(): GitHubReleaseSource | null {
  const repository = getConfiguredString(
    "anyboxMobileGitHubRepository",
    process.env.EXPO_PUBLIC_ANYBOX_MOBILE_GITHUB_REPOSITORY,
  )
  if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) return null
  return {
    repository,
    tagPrefix: getConfiguredString("anyboxMobileGitHubReleaseTagPrefix") ?? "mobile-v",
    apkAssetName: getConfiguredString("anyboxMobileGitHubApkAssetName") ?? "anybox-mobile.apk",
    manifestAssetName:
      getConfiguredString("anyboxMobileGitHubManifestAssetName") ??
      "anybox-mobile-release.json",
    signatureAssetName:
      getConfiguredString("anyboxMobileGitHubManifestSignatureAssetName") ??
      "anybox-mobile-release.json.sig",
  }
}

async function fetchGitHubSignedAndroidRelease(source: GitHubReleaseSource) {
  const releasesValue = await fetchJson(
    `https://api.github.com/repos/${source.repository}/releases?per_page=30`,
    "GitHub releases",
  )
  if (!Array.isArray(releasesValue)) throw new Error("GitHub releases response is invalid.")
  const releases = releasesValue
    .map(readRecord)
    .filter((release): release is GitHubRelease => release !== null)
    .filter((release) => {
      const tag = readString(release.tag_name)
      return (
        Boolean(tag?.startsWith(source.tagPrefix)) &&
        release.draft !== true &&
        release.prerelease !== true
      )
    })
    .sort(
      (left, right) =>
        Date.parse(readString(right.published_at) ?? "") -
        Date.parse(readString(left.published_at) ?? ""),
    )

  for (const release of releases) {
    const assets = readGitHubAssets(release.assets)
    const apk = assets.find((asset) => asset.name === source.apkAssetName)
    const manifest = assets.find((asset) => asset.name === source.manifestAssetName)
    const signature = assets.find((asset) => asset.name === source.signatureAssetName)
    if (!apk || !manifest || !signature) continue
    try {
      const normalized = await fetchSignedAndroidRelease(
        manifest.browserDownloadUrl,
        signature.browserDownloadUrl,
      )
      if (normalized.fallbackApkUrl !== apk.browserDownloadUrl) {
        throw new Error("Signed GitHub fallback URL does not match the release APK asset.")
      }
      return normalized
    } catch {
      continue
    }
  }
  throw new Error("No valid signed mobile-v* GitHub release was found.")
}

async function fetchJson(url: string, label: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_RELEASE_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": DEFAULT_GITHUB_API_VERSION,
      },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}.`)
    return response.json()
  } finally {
    clearTimeout(timeout)
  }
}

function readGitHubAssets(value: unknown): GitHubAsset[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const source = readRecord(item)
    const name = readString(source?.name)
    const browserDownloadUrl = readString(source?.browser_download_url)
    return name && browserDownloadUrl ? [{ name, browserDownloadUrl }] : []
  })
}

export async function downloadBinaryRelease(
  release: AndroidReleaseManifest,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<DownloadedApk> {
  const subscription = onProgress ? addDownloadProgressListener(onProgress) : null
  try {
    await clearStaleDownloads()
    const options = {
      expectedSha256: release.sha256,
      expectedSizeBytes: release.sizeBytes,
      expectedPackageName: EXPECTED_PACKAGE_NAME,
      expectedVersionCode: release.versionCode,
      fileName: `anybox-mobile-${release.versionCode}.apk`,
    }
    try {
      return await downloadApk({ ...options, url: release.apkUrl })
    } catch (primaryError) {
      const nativeError = readRecord(primaryError)
      if (
        nativeError?.code === "ERR_DOWNLOAD_CANCELLED" ||
        readString(nativeError?.message)?.includes("download was cancelled")
      ) {
        throw primaryError
      }
      if (!release.fallbackApkUrl || release.fallbackApkUrl === release.apkUrl) throw primaryError
      return await downloadApk({ ...options, url: release.fallbackApkUrl })
    }
  } finally {
    subscription?.remove()
  }
}

export { cancelDownload as cancelBinaryDownload }

export async function canInstallDownloadedApk() {
  return canRequestPackageInstalls()
}

export async function openApkInstallPermissionSettings() {
  await openInstallPermissionSettings()
}

export async function installDownloadedApk(fileUri: string) {
  await installApk(fileUri)
}

export async function openBinaryReleaseInBrowser(release: AndroidReleaseManifest) {
  const url = release.fallbackApkUrl || release.apkUrl
  await Linking.openURL(url)
}

export async function readOtaDiagnosticErrors() {
  if (!Updates.isEnabled) return []
  try {
    const entries = await Updates.readLogEntriesAsync(24 * 60 * 60 * 1000)
    return entries
      .filter((entry) => entry.level === "error" || entry.level === "fatal")
      .slice(-20)
      .map((entry) => `${entry.timestamp}: ${entry.message}`)
  } catch {
    return []
  }
}

function createSkippedOtaUpdateCheck(): OtaUpdateCheck {
  return {
    checked: false,
    enabled: Updates.isEnabled,
    available: false,
    rollback: false,
    channel: getCurrentAppInfo().channel,
    runtimeVersion: Updates.runtimeVersion,
    updateId: Updates.updateId,
    status: "skipped",
  }
}

function createSkippedBinaryUpdateCheck(current: CurrentAppInfo): BinaryUpdateCheck {
  return {
    checked: false,
    configured: Boolean(
      current.releaseManifestUrl &&
        current.releaseSignatureUrl &&
        current.updaterAvailable,
    ),
    available: false,
    required: false,
    signatureVerified: false,
    source: "none",
    release: null,
    status: "skipped",
  }
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}
