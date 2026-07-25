const fs = require("node:fs")
const path = require("node:path")
const appJson = require("./app.json")

const BUILD_PROFILES = new Set(["production", "development"])
const UPDATE_CHANNELS = new Set(["preview", "production"])
const SELF_HOSTED_UPDATES_URL = "https://updates.anybox.com.cn/v1/manifest"
const OTA_CERTIFICATE_RELATIVE_PATH = "./credentials/ota-certificate.pem"

function firstNonEmpty(values) {
  for (const value of values) {
    const stringValue = value == null ? "" : String(value).trim()
    if (stringValue) return stringValue
  }
  return ""
}

function resolveBuildProfile() {
  const profile = firstNonEmpty([
    process.env.ANYBOX_MOBILE_BUILD_PROFILE,
    "production",
  ])
  if (!BUILD_PROFILES.has(profile)) {
    throw new Error(
      `ANYBOX_MOBILE_BUILD_PROFILE must be production or development; received ${profile}.`,
    )
  }
  return profile
}

function resolveUpdateChannel(baseConfig) {
  const channel = firstNonEmpty([
    process.env.ANYBOX_MOBILE_UPDATE_CHANNEL,
    baseConfig.extra?.anyboxMobileUpdateChannel,
    "production",
  ])
  if (!UPDATE_CHANNELS.has(channel)) {
    throw new Error(`ANYBOX_MOBILE_UPDATE_CHANNEL must be preview or production; received ${channel}.`)
  }
  return channel
}

function resolveUpdatesUrl(baseConfig) {
  const updateUrl = firstNonEmpty([
    process.env.ANYBOX_MOBILE_UPDATES_URL,
    baseConfig.updates?.url,
    SELF_HOSTED_UPDATES_URL,
  ])
  const parsed = new URL(updateUrl)
  const allowLocalHttp = process.env.ANYBOX_ALLOW_HTTP_UPDATES === "1"
  const localHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"
  if (allowLocalHttp && localHost && parsed.protocol === "http:") {
    return parsed.toString()
  }
  if (parsed.toString() !== SELF_HOSTED_UPDATES_URL) {
    throw new Error(
      `Anybox mobile updates URL must be ${SELF_HOSTED_UPDATES_URL}. ` +
        "Local HTTP testing requires localhost and ANYBOX_ALLOW_HTTP_UPDATES=1.",
    )
  }
  return SELF_HOSTED_UPDATES_URL
}

module.exports = () => {
  const baseConfig = appJson.expo
  const buildProfile = resolveBuildProfile()
  const anyboxRelayUrl = firstNonEmpty([
    process.env.EXPO_PUBLIC_ANYBOX_RELAY_URL,
    process.env.EXPO_PUBLIC_ANYBOX_PROVIDER_URL,
    baseConfig.extra?.anyboxRelayUrl,
    "https://anybox.com.cn",
  ])

  if (buildProfile === "development") {
    const {
      anyboxMobileGitHubRepository: _githubRepository,
      anyboxMobileReleaseSignatureUrl: _releaseSignatureUrl,
      anyboxMobileReleaseUrl: _releaseUrl,
      ...developmentExtra
    } = baseConfig.extra ?? {}
    return {
      ...baseConfig,
      name: "Anybox Mobile Dev",
      scheme: "anybox-mobile-dev",
      android: {
        ...baseConfig.android,
        package: "com.anybox.mobile.dev",
      },
      updates: {
        enabled: false,
        checkAutomatically: "NEVER",
        fallbackToCacheTimeout: 0,
      },
      extra: {
        ...developmentExtra,
        anyboxMobileUpdateChannel: "development",
        anyboxRelayUrl,
      },
    }
  }

  const channel = resolveUpdateChannel(baseConfig)
  const updateUrl = resolveUpdatesUrl(baseConfig)
  const certificatePath = path.resolve(__dirname, "credentials", "ota-certificate.pem")
  const hasCertificate = fs.existsSync(certificatePath)
  const releaseManifestUrl = firstNonEmpty([
    process.env.EXPO_PUBLIC_ANYBOX_MOBILE_RELEASE_URL,
    baseConfig.extra?.anyboxMobileReleaseUrl,
  ])
  const releaseSignatureUrl = firstNonEmpty([
    process.env.EXPO_PUBLIC_ANYBOX_MOBILE_RELEASE_SIGNATURE_URL,
    baseConfig.extra?.anyboxMobileReleaseSignatureUrl,
  ])
  const githubRepository = firstNonEmpty([
    process.env.EXPO_PUBLIC_ANYBOX_MOBILE_GITHUB_REPOSITORY,
    process.env.EXPO_PUBLIC_ANYBOX_MOBILE_GITHUB_REPO,
    baseConfig.extra?.anyboxMobileGitHubRepository,
  ])
  return {
    ...baseConfig,
    updates: {
      ...baseConfig.updates,
      url: updateUrl,
      requestHeaders: {
        ...(baseConfig.updates?.requestHeaders ?? {}),
        "expo-channel-name": channel,
      },
      ...(hasCertificate
        ? {
            codeSigningCertificate: OTA_CERTIFICATE_RELATIVE_PATH,
            codeSigningMetadata: {
              alg: "rsa-v1_5-sha256",
              keyid: "anybox-mobile-2026",
            },
          }
        : {}),
    },
    extra: {
      ...baseConfig.extra,
      anyboxMobileReleaseUrl: releaseManifestUrl,
      anyboxMobileReleaseSignatureUrl: releaseSignatureUrl,
      anyboxMobileUpdateChannel: channel,
      anyboxMobileGitHubRepository: githubRepository,
      anyboxRelayUrl,
    },
  }
}
