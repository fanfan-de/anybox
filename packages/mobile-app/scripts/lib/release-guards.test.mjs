import assert from "node:assert/strict"
import test from "node:test"
import {
  assertReleaseCertificateFingerprint,
  assertVersionCodeAdvances,
  buildGitHubReleaseCreateArgs,
  selectPhysicalDeviceSerial,
} from "./release-guards.mjs"

test("requires one explicitly selected physical-device candidate", () => {
  const one = "List of devices attached\nphone-1 device product:anybox model:Pixel\n"
  assert.equal(selectPhysicalDeviceSerial(one), "phone-1")
  assert.throws(
    () => selectPhysicalDeviceSerial("List of devices attached\n"),
    /physical device is required/,
  )
  const many =
    "List of devices attached\nphone-1 device model:A\nphone-2 device model:B\n"
  assert.throws(() => selectPhysicalDeviceSerial(many), /Multiple Android devices/)
  assert.equal(selectPhysicalDeviceSerial(many, "phone-2"), "phone-2")
})

test("blocks reused or lower Android versionCode values", () => {
  assert.doesNotThrow(() => assertVersionCodeAdvances(8, 7))
  assert.throws(() => assertVersionCodeAdvances(7, 7), /must increase/)
  assert.throws(() => assertVersionCodeAdvances(6, 7), /must increase/)
})

test("blocks debug or replacement APK signing certificates", () => {
  const production = "11".repeat(32)
  const debug = "22".repeat(32)
  assert.equal(
    assertReleaseCertificateFingerprint(production, production, production),
    production,
  )
  assert.throws(
    () => assertReleaseCertificateFingerprint(debug, debug, production),
    /pinned Anybox production release certificate/,
  )
  assert.throws(
    () => assertReleaseCertificateFingerprint(production, debug, production),
    /pinned Anybox production release certificate/,
  )
})

test("GitHub mobile releases are explicitly excluded from Latest", () => {
  const args = buildGitHubReleaseCreateArgs(
    {
      tag: "mobile-v0.3.0",
      apkOutputPath: "anybox-mobile.apk",
      manifestOutputPath: "anybox-mobile-release.json",
      signatureOutputPath: "anybox-mobile-release.json.sig",
    },
    { githubRepository: "fanfan-de/anybox", version: "0.3.0" },
    ["Release note"],
    "0123456789abcdef",
  )
  assert.ok(args.includes("--latest=false"))
  assert.deepEqual(
    args.slice(3, 6),
    [
      "anybox-mobile.apk",
      "anybox-mobile-release.json",
      "anybox-mobile-release.json.sig",
    ],
  )
})
