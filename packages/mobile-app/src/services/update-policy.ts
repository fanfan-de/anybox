export interface VersionedAndroidRelease {
  versionCode: number
  minimumVersionCode: number
  force: boolean
}

export interface OptionalUpdateDismissal {
  versionCode: number
  dismissedAt: number
}

export type UpdatePromptPriority = "forced-apk" | "downloaded-ota" | "optional-apk" | "none"

export function isAndroidReleaseNewer(
  release: Pick<VersionedAndroidRelease, "versionCode">,
  currentVersionCode: number | null,
) {
  return currentVersionCode !== null && release.versionCode > currentVersionCode
}

export function isAndroidReleaseRequired(
  release: VersionedAndroidRelease,
  currentVersionCode: number | null,
) {
  return (
    isAndroidReleaseNewer(release, currentVersionCode) &&
    (release.force || currentVersionCode! < release.minimumVersionCode)
  )
}

export function shouldShowOptionalUpdate(
  releaseVersionCode: number,
  dismissal: OptionalUpdateDismissal | null,
  now: number,
  reminderIntervalMs: number,
) {
  return (
    !dismissal ||
    dismissal.versionCode !== releaseVersionCode ||
    now - dismissal.dismissedAt >= reminderIntervalMs
  )
}

export function selectUpdatePromptPriority(input: {
  forcedApk: boolean
  downloadedOta: boolean
  optionalApk: boolean
}): UpdatePromptPriority {
  if (input.forcedApk) return "forced-apk"
  if (input.downloadedOta) return "downloaded-ota"
  if (input.optionalApk) return "optional-apk"
  return "none"
}

export function shouldRetainConfirmedForcedUpdate(
  currentVersionCode: number | null,
  requiredReleaseVersionCode: number,
  binaryCheckStatus: string,
  binaryCheckSource: string = "none",
) {
  return (
    (binaryCheckStatus === "error" || binaryCheckSource === "github") &&
    (currentVersionCode === null || currentVersionCode < requiredReleaseVersionCode)
  )
}
