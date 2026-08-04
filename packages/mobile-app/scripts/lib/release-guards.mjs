export function parseAuthorizedAndroidDevices(output) {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => /\sdevice(?:\s|$)/.test(line))
    .map((line) => line.split(/\s+/)[0])
}

export function selectPhysicalDeviceSerial(devicesOutput, requestedSerial = "") {
  const devices = parseAuthorizedAndroidDevices(devicesOutput)
  const serial = requestedSerial.trim() || (devices.length === 1 ? devices[0] : "")
  if (!serial || !devices.includes(serial)) {
    throw new Error(
      devices.length === 0
        ? "No authorized Android device is connected. A physical device is required."
        : "Multiple Android devices are connected. Set ANDROID_SERIAL to the physical release-test device.",
    )
  }
  return serial
}

export function assertVersionCodeAdvances(currentVersionCode, previousVersionCode) {
  if (
    !Number.isSafeInteger(previousVersionCode) ||
    previousVersionCode <= 0 ||
    currentVersionCode <= previousVersionCode
  ) {
    throw new Error(
      `Android versionCode must increase: current release is ${currentVersionCode}, ` +
        `published release is ${previousVersionCode}.`,
    )
  }
}

export function isMissingPublishedReleasePair(manifestStatus, signatureStatus) {
  if (manifestStatus !== signatureStatus) return false
  return manifestStatus === 404 || manifestStatus === 403
}

export function shouldRetryPublishedReleasePairWithoutQuery(manifestStatus, signatureStatus) {
  return manifestStatus === 400 && signatureStatus === 400
}

export function selectLatestPublishedMobileRelease(releases, tagPrefix) {
  return [...releases]
    .filter(
      (release) =>
        release?.isDraft === false &&
        release?.isPrerelease === false &&
        typeof release?.tagName === "string" &&
        release.tagName.startsWith(tagPrefix) &&
        Number.isFinite(Date.parse(release.publishedAt)),
    )
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))[0]
}

export function assertReleaseCertificateFingerprint(
  apkCertificateFingerprint,
  keystoreCertificateFingerprint,
  pinnedCertificateFingerprint,
) {
  const normalize = (value, label) => {
    const normalized = String(value ?? "").replaceAll(":", "").trim().toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(normalized)) {
      throw new Error(`${label} must be a SHA-256 certificate fingerprint.`)
    }
    return normalized
  }
  const apk = normalize(apkCertificateFingerprint, "APK certificate fingerprint")
  const keystore = normalize(keystoreCertificateFingerprint, "Keystore certificate fingerprint")
  const pinned = normalize(pinnedCertificateFingerprint, "Pinned release certificate fingerprint")
  if (apk !== keystore || apk !== pinned) {
    throw new Error(
      "APK signing certificate does not match the pinned Anybox production release certificate.",
    )
  }
  return apk
}

export function buildGitHubReleaseCreateArgs(prepared, mobile, notes, sourceCommit) {
  return [
    "release",
    "create",
    prepared.tag,
    prepared.apkOutputPath,
    prepared.manifestOutputPath,
    prepared.signatureOutputPath,
    "--repo",
    mobile.githubRepository,
    "--target",
    sourceCommit,
    "--title",
    `Anybox Mobile ${mobile.version}`,
    "--notes",
    notes.join("\n"),
    "--latest=false",
  ]
}
