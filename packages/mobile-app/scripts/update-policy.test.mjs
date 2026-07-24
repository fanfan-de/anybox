import assert from "node:assert/strict"
import test from "node:test"
import {
  isAndroidReleaseNewer,
  isAndroidReleaseRequired,
  selectUpdatePromptPriority,
  shouldRetainConfirmedForcedUpdate,
  shouldShowOptionalUpdate,
} from "../src/services/update-policy"

const release = {
  versionCode: 8,
  minimumVersionCode: 7,
  force: false,
}

test("versionCode is the only APK upgrade ordering value", () => {
  assert.equal(isAndroidReleaseNewer(release, 7), true)
  assert.equal(isAndroidReleaseNewer(release, 8), false)
  assert.equal(isAndroidReleaseNewer(release, 9), false)
  assert.equal(isAndroidReleaseNewer(release, null), false)
})

test("APK updates are required only by force or minimumVersionCode", () => {
  assert.equal(isAndroidReleaseRequired(release, 7), false)
  assert.equal(isAndroidReleaseRequired({ ...release, minimumVersionCode: 8 }, 7), true)
  assert.equal(isAndroidReleaseRequired({ ...release, force: true }, 7), true)
  assert.equal(isAndroidReleaseRequired({ ...release, force: true }, 8), false)
})

test("optional APK dismissal lasts 24 hours for the same versionCode", () => {
  const day = 24 * 60 * 60 * 1000
  const now = Date.parse("2026-07-25T00:00:00.000Z")
  const dismissal = { versionCode: 8, dismissedAt: now }
  assert.equal(shouldShowOptionalUpdate(8, dismissal, now + day - 1, day), false)
  assert.equal(shouldShowOptionalUpdate(8, dismissal, now + day, day), true)
  assert.equal(shouldShowOptionalUpdate(9, dismissal, now + 1, day), true)
})

test("forced APK outranks downloaded OTA, which outranks optional APK", () => {
  assert.equal(
    selectUpdatePromptPriority({
      forcedApk: true,
      downloadedOta: true,
      optionalApk: true,
    }),
    "forced-apk",
  )
  assert.equal(
    selectUpdatePromptPriority({
      forcedApk: false,
      downloadedOta: true,
      optionalApk: true,
    }),
    "downloaded-ota",
  )
  assert.equal(
    selectUpdatePromptPriority({
      forcedApk: false,
      downloadedOta: false,
      optionalApk: true,
    }),
    "optional-apk",
  )
})

test("a previously confirmed forced update survives an offline check", () => {
  assert.equal(shouldRetainConfirmedForcedUpdate(7, 8, "error"), true)
  assert.equal(shouldRetainConfirmedForcedUpdate(null, 8, "error"), true)
  assert.equal(shouldRetainConfirmedForcedUpdate(8, 8, "error"), false)
  assert.equal(shouldRetainConfirmedForcedUpdate(7, 8, "current"), false)
})

test("a stale GitHub fallback cannot clear a confirmed forced update", () => {
  assert.equal(shouldRetainConfirmedForcedUpdate(7, 8, "current", "github"), true)
  assert.equal(shouldRetainConfirmedForcedUpdate(8, 8, "current", "github"), false)
  assert.equal(shouldRetainConfirmedForcedUpdate(7, 8, "current", "primary"), false)
})
