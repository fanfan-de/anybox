import assert from "node:assert/strict"
import test from "node:test"
import {
  assertDevelopmentApkIdentity,
  buildIdentityForProfile,
  choosePrebuildMode,
  createProfileStamp,
  deploymentCommands,
  parseAdbDevices,
  readProfileStamp,
  resolveAndroidAbi,
  resolveBuildProfile,
  rewriteAnyboxMobileScheme,
  selectAndroidDevice,
} from "./android-development.mjs"

const deviceOutput = [
  "List of devices attached",
  "phone-1\tdevice product:test model:Phone_One transport_id:1",
  "phone-2\toffline transport_id:2",
  "",
].join("\n")

test("build profiles default to production and expose stable identities", () => {
  assert.equal(resolveBuildProfile(""), "production")
  assert.equal(buildIdentityForProfile("production").packageName, "com.anybox.mobile")
  assert.deepEqual(buildIdentityForProfile("development"), {
    appName: "Anybox Mobile Dev",
    outputFileName: "anybox-mobile-dev.apk",
    packageName: "com.anybox.mobile.dev",
    profile: "development",
    scheme: "anybox-mobile-dev",
  })
  assert.throws(() => resolveBuildProfile("preview"), /production or development/)
})

test("device selection follows CLI, ANDROID_SERIAL, then unique online device", () => {
  const devices = parseAdbDevices(deviceOutput)
  assert.equal(
    selectAndroidDevice({ cliSerial: "phone-1", envSerial: "ignored", devices }).serial,
    "phone-1",
  )
  assert.equal(
    selectAndroidDevice({ envSerial: "phone-1", devices }).serial,
    "phone-1",
  )
  assert.equal(selectAndroidDevice({ devices }).serial, "phone-1")
  assert.throws(
    () => selectAndroidDevice({ cliSerial: "missing", devices }),
    /not connected/,
  )
  assert.throws(
    () => selectAndroidDevice({ cliSerial: "phone-2", devices }),
    /not ready/,
  )
  assert.throws(
    () =>
      selectAndroidDevice({
        devices: parseAdbDevices(
          "List of devices attached\nphone-1\tdevice\nphone-3\tdevice\n",
        ),
      }),
    /Multiple Android devices/,
  )
  assert.throws(
    () => selectAndroidDevice({ devices: [] }),
    /No authorized online Android device/,
  )
})

test("target ABI validation only permits Gradle-supported ABIs", () => {
  assert.equal(resolveAndroidAbi("arm64-v8a\n"), "arm64-v8a")
  assert.equal(resolveAndroidAbi("x86_64,x86"), "x86_64")
  assert.throws(() => resolveAndroidAbi("riscv64"), /Unsupported or missing/)
})

test("development APK validation checks package, label, and scheme", () => {
  const badging = [
    "package: name='com.anybox.mobile.dev' versionCode='7' versionName='0.3.0'",
    "application-label:'Anybox Mobile Dev'",
    "native-code: 'arm64-v8a'",
  ].join("\n")
  const manifest =
    'A: android:scheme(0x01010027)="anybox-mobile-dev" (Raw: "anybox-mobile-dev")'
  assert.deepEqual(assertDevelopmentApkIdentity({
    badging,
    expectedAbi: "arm64-v8a",
    manifest,
  }), {
    applicationLabel: "Anybox Mobile Dev",
    nativeAbis: ["arm64-v8a"],
    packageName: "com.anybox.mobile.dev",
    versionCode: "7",
    versionName: "0.3.0",
  })
  assert.throws(
    () =>
      assertDevelopmentApkIdentity({
        badging: badging.replace("com.anybox.mobile.dev", "com.anybox.mobile"),
        manifest,
      }),
    /package mismatch/,
  )
  assert.throws(
    () =>
      assertDevelopmentApkIdentity({
        badging,
        expectedAbi: "x86_64",
        manifest,
      }),
    /ABI mismatch/,
  )
})

test("profile stamp forces clean prebuild only for first build, clean flag, or switching", () => {
  assert.equal(readProfileStamp(createProfileStamp("development")), "development")
  assert.equal(readProfileStamp("{}"), null)
  assert.equal(readProfileStamp('{"profile":"development","schemaVersion":2}'), null)
  assert.equal(
    choosePrebuildMode({
      androidDirectoryExists: false,
      cleanRequested: false,
      previousProfile: null,
      requestedProfile: "development",
    }).clean,
    true,
  )
  assert.equal(
    choosePrebuildMode({
      androidDirectoryExists: true,
      cleanRequested: false,
      previousProfile: "development",
      requestedProfile: "development",
    }).clean,
    false,
  )
  assert.match(
    choosePrebuildMode({
      androidDirectoryExists: true,
      cleanRequested: false,
      previousProfile: "development",
      requestedProfile: "production",
    }).reason,
    /changed from development to production/,
  )
  assert.equal(
    choosePrebuildMode({
      androidDirectoryExists: true,
      cleanRequested: true,
      previousProfile: "development",
      requestedProfile: "development",
    }).clean,
    true,
  )
})

test("production deep links are safely rewritten for the development package", () => {
  assert.equal(
    rewriteAnyboxMobileScheme(
      "anybox-mobile://pair?code=abc&url=https%3A%2F%2Fanybox.com.cn",
    ),
    "anybox-mobile-dev://pair?code=abc&url=https%3A%2F%2Fanybox.com.cn",
  )
  assert.equal(
    rewriteAnyboxMobileScheme(
      "anybox-mobile-dev://connect?url=http%3A%2F%2F127.0.0.1",
    ),
    "anybox-mobile-dev://connect?url=http%3A%2F%2F127.0.0.1",
  )
  assert.throws(
    () => rewriteAnyboxMobileScheme("https://example.test"),
    /must use anybox-mobile/,
  )
})

test("deployment commands preserve data and contain no destructive fallback", () => {
  const commands = deploymentCommands({
    adb: "adb",
    apkPath: "./build/anybox-mobile-dev.apk",
    packageName: "com.anybox.mobile.dev",
    serial: "phone-1",
  })
  assert.deepEqual(commands[0].args.slice(0, 4), [
    "-s",
    "phone-1",
    "install",
    "-r",
  ])
  const serialized = JSON.stringify(commands)
  assert.doesNotMatch(serialized, /\buninstall\b|\bclear\b|pm\s+clear/)
  assert.match(serialized, /com\.anybox\.mobile\.dev/)
})
