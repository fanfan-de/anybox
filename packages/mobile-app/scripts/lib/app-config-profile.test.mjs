import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url)
const appJson = require("../../app.json")
const createConfig = require("../../app.config.js")

function withEnvironment(values, callback) {
  const previous = new Map()
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return callback()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test("default and explicit production profiles preserve the production identity", () => {
  const environment = {
    ANYBOX_MOBILE_BUILD_PROFILE: undefined,
    ANYBOX_MOBILE_UPDATE_CHANNEL: undefined,
    ANYBOX_MOBILE_UPDATES_URL: undefined,
    EXPO_PUBLIC_ANYBOX_PROVIDER_URL: undefined,
    EXPO_PUBLIC_ANYBOX_RELAY_URL: undefined,
  }
  const defaultConfig = withEnvironment(environment, () => createConfig())
  const productionConfig = withEnvironment(
    { ...environment, ANYBOX_MOBILE_BUILD_PROFILE: "production" },
    () => createConfig(),
  )

  assert.deepEqual(defaultConfig, productionConfig)
  assert.equal(defaultConfig.name, "Anybox Mobile")
  assert.equal(defaultConfig.android.package, "com.anybox.mobile")
  assert.equal(defaultConfig.scheme, "anybox-mobile")
  assert.equal(defaultConfig.updates.enabled, true)
  assert.equal(defaultConfig.updates.url, "https://updates.anybox.com.cn/v1/manifest")
  assert.equal(
    defaultConfig.extra.anyboxMobileReleaseUrl,
    "https://download.anybox.com.cn/mobile/android/version.json",
  )
  assert.equal(appJson.expo.android.package, "com.anybox.mobile")
  assert.equal(appJson.expo.scheme, "anybox-mobile")
})

test("development profile derives an isolated Android identity and disables updates", () => {
  const config = withEnvironment(
    {
      ANYBOX_MOBILE_BUILD_PROFILE: "development",
      EXPO_PUBLIC_ANYBOX_MOBILE_RELEASE_SIGNATURE_URL: "https://example.test/version.sig",
      EXPO_PUBLIC_ANYBOX_MOBILE_RELEASE_URL: "https://example.test/version.json",
      EXPO_PUBLIC_ANYBOX_RELAY_URL: "https://relay.example.test",
    },
    () => createConfig(),
  )

  assert.equal(config.name, "Anybox Mobile Dev")
  assert.equal(config.android.package, "com.anybox.mobile.dev")
  assert.equal(config.scheme, "anybox-mobile-dev")
  assert.deepEqual(config.updates, {
    enabled: false,
    checkAutomatically: "NEVER",
    fallbackToCacheTimeout: 0,
  })
  assert.equal(config.extra.anyboxMobileUpdateChannel, "development")
  assert.equal(config.extra.anyboxRelayUrl, "https://relay.example.test")
  assert.equal("anyboxMobileReleaseUrl" in config.extra, false)
  assert.equal("anyboxMobileReleaseSignatureUrl" in config.extra, false)
  assert.equal("anyboxMobileGitHubRepository" in config.extra, false)
  assert.equal(config.ios.bundleIdentifier, "com.anybox.mobile")
})

test("invalid build profile fails before Expo configuration is produced", () => {
  assert.throws(
    () =>
      withEnvironment(
        { ANYBOX_MOBILE_BUILD_PROFILE: "staging" },
        () => createConfig(),
      ),
    /must be production or development/,
  )
})
