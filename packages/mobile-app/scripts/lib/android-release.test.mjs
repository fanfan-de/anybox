import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createAndroidReleaseManifest } from "./android-release.mjs"

function fixtureMobile() {
  return {
    version: "0.3.0",
    versionCode: 7,
    githubRepository: "fanfan-de/anybox",
    githubTagPrefix: "mobile-v",
    appJson: {
      extra: {
        anyboxMobileGitHubApkAssetName: "anybox-mobile.apk",
      },
    },
  }
}

test("creates the exact signed-release contract from APK bytes", async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "anybox-android-release-test-"))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const apkPath = path.join(directory, "app.apk")
  writeFileSync(apkPath, "verified-apk-fixture")

  const manifest = await createAndroidReleaseManifest({
    mobile: fixtureMobile(),
    apkPath,
    notes: ["Release note"],
    force: false,
    minimumVersionCode: 7,
    publishedAt: "2026-07-25T00:00:00.000Z",
  })

  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.platform, "android")
  assert.equal(manifest.versionCode, 7)
  assert.equal(
    manifest.apkUrl,
    "https://download.anybox.com.cn/mobile/android/releases/0.3.0/anybox-mobile.apk",
  )
  assert.equal(
    manifest.fallbackApkUrl,
    "https://github.com/fanfan-de/anybox/releases/download/mobile-v0.3.0/anybox-mobile.apk",
  )
  assert.match(manifest.sha256, /^[a-f0-9]{64}$/)
  assert.equal(manifest.sizeBytes, 20)
})

test("rejects an invalid minimum version code before publishing", async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "anybox-android-release-test-"))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const apkPath = path.join(directory, "app.apk")
  writeFileSync(apkPath, "apk")

  await assert.rejects(
    createAndroidReleaseManifest({
      mobile: fixtureMobile(),
      apkPath,
      notes: ["Release note"],
      force: false,
      minimumVersionCode: 8,
    }),
    /cannot exceed the published versionCode/,
  )
})

test("rejects release notes the client would refuse to parse", async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "anybox-android-release-test-"))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const apkPath = path.join(directory, "app.apk")
  writeFileSync(apkPath, "apk")

  await assert.rejects(
    createAndroidReleaseManifest({
      mobile: fixtureMobile(),
      apkPath,
      notes: [],
      force: false,
      minimumVersionCode: 7,
    }),
    /Release notes must contain/,
  )
})
