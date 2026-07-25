import path from "node:path"

export const PRODUCTION_BUILD_PROFILE = "production"
export const DEVELOPMENT_BUILD_PROFILE = "development"
export const DEVELOPMENT_PACKAGE_NAME = "com.anybox.mobile.dev"
export const DEVELOPMENT_APP_NAME = "Anybox Mobile Dev"
export const DEVELOPMENT_SCHEME = "anybox-mobile-dev"
export const PRODUCTION_PACKAGE_NAME = "com.anybox.mobile"
export const PRODUCTION_SCHEME = "anybox-mobile"

const BUILD_PROFILES = new Set([
  PRODUCTION_BUILD_PROFILE,
  DEVELOPMENT_BUILD_PROFILE,
])
const ANDROID_ABIS = new Set([
  "arm64-v8a",
  "armeabi-v7a",
  "x86",
  "x86_64",
])
const MOBILE_SCHEMES = new Set([
  PRODUCTION_SCHEME,
  DEVELOPMENT_SCHEME,
])

export function resolveBuildProfile(value, fallback = PRODUCTION_BUILD_PROFILE) {
  const profile = String(value ?? "").trim() || fallback
  if (!BUILD_PROFILES.has(profile)) {
    throw new Error(
      `Android build profile must be production or development; received ${profile}.`,
    )
  }
  return profile
}

export function buildIdentityForProfile(profileValue) {
  const profile = resolveBuildProfile(profileValue)
  if (profile === DEVELOPMENT_BUILD_PROFILE) {
    return {
      appName: DEVELOPMENT_APP_NAME,
      outputFileName: "anybox-mobile-dev.apk",
      packageName: DEVELOPMENT_PACKAGE_NAME,
      profile,
      scheme: DEVELOPMENT_SCHEME,
    }
  }
  return {
    appName: "Anybox Mobile",
    outputFileName: "anybox-mobile-debug.apk",
    packageName: PRODUCTION_PACKAGE_NAME,
    profile,
    scheme: PRODUCTION_SCHEME,
  }
}

export function parseAdbDevices(output) {
  return String(output ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("List of devices attached"))
    .filter((line) => !line.startsWith("* daemon"))
    .map((line) => {
      const [serial = "", state = "", ...details] = line.split(/\s+/)
      return { details: details.join(" "), serial, state }
    })
    .filter((device) => device.serial && device.state)
}

export function selectAndroidDevice({
  cliSerial = "",
  devices,
  envSerial = "",
}) {
  const requestedSerial = String(cliSerial).trim() || String(envSerial).trim()
  const online = devices.filter((device) => device.state === "device")

  if (requestedSerial) {
    const selected = devices.find((device) => device.serial === requestedSerial)
    if (!selected) {
      throw new Error(`Requested Android device is not connected: ${requestedSerial}.`)
    }
    if (selected.state !== "device") {
      throw new Error(
        `Requested Android device ${requestedSerial} is not ready (state: ${selected.state}).`,
      )
    }
    return selected
  }

  if (online.length === 0) {
    throw new Error(
      "No authorized online Android device is connected. Connect one device or pass --serial.",
    )
  }
  if (online.length > 1) {
    throw new Error(
      `Multiple Android devices are online (${online.map((device) => device.serial).join(", ")}). ` +
        "Pass --serial or set ANDROID_SERIAL.",
    )
  }
  return online[0]
}

export function resolveAndroidAbi(value) {
  const abi = String(value ?? "").trim().split(",")[0]?.trim()
  if (!ANDROID_ABIS.has(abi)) {
    throw new Error(
      `Unsupported or missing Android ABI "${abi || "unknown"}". Expected one of: ` +
        [...ANDROID_ABIS].join(", "),
    )
  }
  return abi
}

export function parseApkBadging(output) {
  const text = String(output ?? "")
  const packageLine = text.split(/\r?\n/).find((line) => line.startsWith("package:"))
  if (!packageLine) throw new Error("aapt did not return APK package metadata.")
  const nativeCodeLine = text
    .split(/\r?\n/)
    .find((line) => line.startsWith("native-code:"))
  const applicationLabel =
    text.match(/^application-label:'([^']*)'/m)?.[1] ??
    text.match(/^application-label-[^:]+:'([^']*)'/m)?.[1] ??
    ""
  return {
    applicationLabel,
    nativeAbis: [...(nativeCodeLine?.matchAll(/'([^']+)'/g) ?? [])].map(
      (match) => match[1],
    ),
    packageName: packageLine.match(/name='([^']+)'/)?.[1] ?? "",
    versionCode: packageLine.match(/versionCode='([^']+)'/)?.[1] ?? "",
    versionName: packageLine.match(/versionName='([^']+)'/)?.[1] ?? "",
  }
}

export function assertDevelopmentApkIdentity({ badging, expectedAbi, manifest }) {
  const identity = parseApkBadging(badging)
  if (identity.packageName !== DEVELOPMENT_PACKAGE_NAME) {
    throw new Error(
      `Development APK package mismatch: expected ${DEVELOPMENT_PACKAGE_NAME}, ` +
        `received ${identity.packageName || "unknown"}.`,
    )
  }
  if (identity.applicationLabel !== DEVELOPMENT_APP_NAME) {
    throw new Error(
      `Development APK label mismatch: expected ${DEVELOPMENT_APP_NAME}, ` +
        `received ${identity.applicationLabel || "unknown"}.`,
    )
  }
  const schemePattern = new RegExp(
    `android:scheme[^\\n]*["']${escapeRegExp(DEVELOPMENT_SCHEME)}["']`,
  )
  if (!schemePattern.test(String(manifest ?? ""))) {
    throw new Error(
      `Development APK manifest does not contain the ${DEVELOPMENT_SCHEME} scheme.`,
    )
  }
  if (
    expectedAbi &&
    (identity.nativeAbis.length !== 1 || identity.nativeAbis[0] !== expectedAbi)
  ) {
    throw new Error(
      `Development APK ABI mismatch: expected only ${expectedAbi}, received ` +
        `${identity.nativeAbis.join(", ") || "none"}.`,
    )
  }
  return identity
}

export function readProfileStamp(value) {
  if (!value) return null
  try {
    const parsed = JSON.parse(String(value))
    if (
      parsed?.schemaVersion !== 1 ||
      typeof parsed.profile !== "string"
    ) {
      return null
    }
    return resolveBuildProfile(parsed.profile)
  } catch {
    return null
  }
}

export function choosePrebuildMode({
  androidDirectoryExists,
  cleanRequested,
  previousProfile,
  requestedProfile,
}) {
  const profile = resolveBuildProfile(requestedProfile)
  const previous = previousProfile ? resolveBuildProfile(previousProfile) : null
  if (cleanRequested) return { clean: true, reason: "--clean was requested" }
  if (!androidDirectoryExists) return { clean: true, reason: "Android project is missing" }
  if (!previous) return { clean: true, reason: "Android build profile is not recorded" }
  if (previous !== profile) {
    return {
      clean: true,
      reason: `Android build profile changed from ${previous} to ${profile}`,
    }
  }
  return { clean: false, reason: `reusing the ${profile} Android project` }
}

export function createProfileStamp(profileValue) {
  return `${JSON.stringify(
    {
      profile: resolveBuildProfile(profileValue),
      schemaVersion: 1,
    },
    null,
    2,
  )}\n`
}

export function rewriteAnyboxMobileScheme(value, targetScheme = DEVELOPMENT_SCHEME) {
  const resolvedTargetScheme = resolveAnyboxMobileScheme(targetScheme)
  const text = String(value ?? "").trim()
  const match = text.match(/^([a-z][a-z0-9+.-]*):/i)
  const sourceScheme = match?.[1]?.toLowerCase()
  if (!sourceScheme || !MOBILE_SCHEMES.has(sourceScheme)) {
    throw new Error("Anybox Mobile deep link must use anybox-mobile: or anybox-mobile-dev:.")
  }
  return `${resolvedTargetScheme}:${text.slice(match[0].length)}`
}

export function resolveAnyboxMobileScheme(
  value,
  fallback = PRODUCTION_SCHEME,
) {
  const scheme = String(value ?? "").trim() || fallback
  if (!MOBILE_SCHEMES.has(scheme)) {
    throw new Error(`Unsupported Anybox Mobile scheme: ${scheme}.`)
  }
  return scheme
}

export function deploymentCommands({ adb, apkPath, packageName, serial }) {
  const normalizedApkPath = path.resolve(apkPath)
  return [
    {
      args: ["-s", serial, "install", "-r", normalizedApkPath],
      command: adb,
      label: "install",
    },
    {
      args: [
        "-s",
        serial,
        "shell",
        "monkey",
        "-p",
        packageName,
        "-c",
        "android.intent.category.LAUNCHER",
        "1",
      ],
      command: adb,
      label: "launch",
    },
  ]
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
