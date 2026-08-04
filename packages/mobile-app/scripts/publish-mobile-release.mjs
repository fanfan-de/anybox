import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { prepareAndroidReleaseAssets } from "./lib/android-release.mjs"
import {
  assertVersionCodeAdvances,
  buildGitHubReleaseCreateArgs,
  isMissingPublishedReleasePair,
  selectLatestPublishedMobileRelease,
  selectPhysicalDeviceSerial,
} from "./lib/release-guards.mjs"
import {
  assertNativeFingerprint,
  assertNoExpoHosting,
  assertPublicBytes,
  assertPublicFile,
  assertScopedReleaseTreeClean,
  certificateFingerprint,
  loadMobileReleaseEnvironment,
  packageRoot,
  parseNotes,
  parseOption,
  publicUrlForKey,
  readGit,
  readMobileConfig,
  requireOtaSigningMaterial,
  run,
  uploadImmutableBody,
  uploadImmutableFile,
  uploadPointerBody,
  verifyBody,
} from "./lib/mobile-update-tools.mjs"

const repoRoot = path.resolve(packageRoot, "..", "..")
const isWindows = process.platform === "win32"
const corepack = isWindows ? "corepack.cmd" : "corepack"

function commandResult(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    env: process.env,
    shell: options.shell ?? (isWindows && /\.(?:bat|cmd)$/i.test(command)),
    stdio: "pipe",
    windowsHide: true,
  })
}

function requireTagAbsent(tag, repository) {
  if (readGit(["tag", "--list", tag]).trim()) {
    throw new Error(`Local tag already exists: ${tag}`)
  }
  if (readGit(["ls-remote", "--tags", "origin", `refs/tags/${tag}`]).trim()) {
    throw new Error(`Remote tag already exists: ${tag}`)
  }
  const ghVersion = commandResult("gh", ["--version"])
  if (ghVersion.status !== 0) {
    throw new Error("GitHub CLI is required for one-command mobile release publishing.")
  }
  const release = commandResult("gh", ["release", "view", tag, "--repo", repository])
  if (release.status === 0) {
    throw new Error(`GitHub Release already exists: ${tag}`)
  }
}

function resolveAdb() {
  const fromPath = commandResult("adb", ["version"])
  if (fromPath.status === 0) return "adb"
  const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
  if (sdkRoot) {
    const candidate = path.join(sdkRoot, "platform-tools", isWindows ? "adb.exe" : "adb")
    if (existsSync(candidate)) return candidate
  }
  throw new Error("adb is required for the mandatory physical-device release smoke test.")
}

function adbArgs(serial, args) {
  return serial ? ["-s", serial, ...args] : args
}

function requirePhysicalDevice(adb) {
  const devicesOutput = run(adb, ["devices", "-l"], { capture: true })
  const requestedSerial = process.env.ANDROID_SERIAL?.trim()
  const serial = selectPhysicalDeviceSerial(devicesOutput, requestedSerial)
  const emulatorFlag = run(adb, adbArgs(serial, ["shell", "getprop", "ro.kernel.qemu"]), {
    capture: true,
  })
  if (emulatorFlag.trim() === "1") {
    throw new Error("The release smoke target is an emulator. A physical Android device is required.")
  }
  return serial
}

function runDeviceSmoke(adb, serial, apkPath, mobile) {
  const install = commandResult(adb, adbArgs(serial, ["install", "-r", apkPath]))
  if (install.status !== 0) {
    throw new Error(
      "The signed APK could not be installed as an in-place update. If this device has the old debug-signed 0.2.4 build, uninstall it once, install the formal 0.3.0 APK, and rerun the smoke test.",
    )
  }
  run(adb, adbArgs(serial, ["shell", "am", "force-stop", mobile.packageName]))
  run(
    adb,
    adbArgs(serial, [
      "shell",
      "monkey",
      "-p",
      mobile.packageName,
      "-c",
      "android.intent.category.LAUNCHER",
      "1",
    ]),
  )
  const packageState = run(adb, adbArgs(serial, ["shell", "dumpsys", "package", mobile.packageName]), {
    capture: true,
  })
  if (
    !new RegExp(`versionCode=${mobile.versionCode}(?:\\s|$)`).test(packageState) ||
    !new RegExp(`versionName=${mobile.version.replaceAll(".", "\\.")}(?:\\s|$)`).test(packageState)
  ) {
    throw new Error("Physical-device smoke installed an unexpected Anybox version.")
  }
  const processId = run(adb, adbArgs(serial, ["shell", "pidof", mobile.packageName]), { capture: true })
  if (!processId.trim()) throw new Error("Anybox did not remain running after the device launch smoke.")
}

function createGitHubRelease(prepared, mobile, notes, sourceCommit) {
  const args = buildGitHubReleaseCreateArgs(prepared, mobile, notes, sourceCommit)
  const created = commandResult("gh", args)
  let recovering = false
  if (created.status !== 0) {
    const recovery = commandResult("gh", [
      "release",
      "view",
      prepared.tag,
      "--repo",
      mobile.githubRepository,
      "--json",
      "tagName,isDraft,assets,url",
    ])
    if (recovery.status !== 0) {
      if (created.stdout) process.stdout.write(created.stdout)
      if (created.stderr) process.stderr.write(created.stderr)
      throw new Error("GitHub mobile release creation failed.")
    }
    recovering = true
  }
  let release = JSON.parse(
    run(
      "gh",
      [
        "release",
        "view",
        prepared.tag,
        "--repo",
        mobile.githubRepository,
        "--json",
        "tagName,isDraft,assets,url",
      ],
      { capture: true },
    ),
  )
  const expectedAssets = new Set([
    mobile.appJson.extra.anyboxMobileGitHubApkAssetName,
    mobile.appJson.extra.anyboxMobileGitHubManifestAssetName,
    mobile.appJson.extra.anyboxMobileGitHubManifestSignatureAssetName,
  ])
  const actualAssets = new Set((release.assets ?? []).map((asset) => asset.name))
  if (recovering) {
    const assetPaths = new Map([
      [mobile.appJson.extra.anyboxMobileGitHubApkAssetName, prepared.apkOutputPath],
      [mobile.appJson.extra.anyboxMobileGitHubManifestAssetName, prepared.manifestOutputPath],
      [mobile.appJson.extra.anyboxMobileGitHubManifestSignatureAssetName, prepared.signatureOutputPath],
    ])
    for (const expected of expectedAssets) {
      if (!actualAssets.has(expected)) {
        run("gh", [
          "release",
          "upload",
          prepared.tag,
          assetPaths.get(expected),
          "--repo",
          mobile.githubRepository,
          "--clobber",
        ])
      }
    }
    release = JSON.parse(
      run(
        "gh",
        [
          "release",
          "view",
          prepared.tag,
          "--repo",
          mobile.githubRepository,
          "--json",
          "tagName,isDraft,assets,url",
        ],
        { capture: true },
      ),
    )
  }
  const verifiedAssets = new Set((release.assets ?? []).map((asset) => asset.name))
  for (const expected of expectedAssets) {
    if (!verifiedAssets.has(expected)) throw new Error(`GitHub Release is missing ${expected}.`)
  }
  if (release.isDraft) {
    run("gh", [
      "release",
      "edit",
      prepared.tag,
      "--repo",
      mobile.githubRepository,
      "--draft=false",
      "--latest=false",
    ])
  }
  return release.url
}

async function requireIncreasingPublishedVersionCode(mobile, certificatePem) {
  const manifestUrl = publicUrlForKey("mobile/android/version.json")
  const signatureUrl = publicUrlForKey("mobile/android/version.sig")
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const [manifestResponse, signatureResponse] = await Promise.all([
      fetch(`${manifestUrl}?preflight=${Date.now()}`, {
        cache: "no-store",
        signal: controller.signal,
      }),
      fetch(`${signatureUrl}?preflight=${Date.now()}`, {
        cache: "no-store",
        signal: controller.signal,
      }),
    ])
    // Tencent COS returns 403 for an absent public object when the bucket does not
    // grant anonymous listing. GitHub remains the monotonic source for this first
    // self-hosted release, and uploaded objects are verified publicly before use.
    if (isMissingPublishedReleasePair(manifestResponse.status, signatureResponse.status)) return
    if (!manifestResponse.ok || !signatureResponse.ok) {
      throw new Error(
        `Published Android release preflight failed: manifest HTTP ${manifestResponse.status}, ` +
          `signature HTTP ${signatureResponse.status}.`,
      )
    }
    const [manifestRaw, signature] = await Promise.all([
      manifestResponse.text(),
      signatureResponse.text(),
    ])
    if (!verifyBody(manifestRaw, signature.trim(), certificatePem)) {
      throw new Error("The currently published Android release manifest has an invalid signature.")
    }
    const previous = JSON.parse(manifestRaw)
    assertVersionCodeAdvances(mobile.versionCode, previous.versionCode)
  } finally {
    clearTimeout(timeout)
  }
}

async function requireIncreasingGitHubVersionCode(mobile) {
  const listed = commandResult("gh", [
    "release",
    "list",
    "--repo",
    mobile.githubRepository,
    "--limit",
    "100",
    "--json",
    "tagName,isDraft,isPrerelease,publishedAt",
  ])
  if (listed.status !== 0) {
    if (listed.stdout) process.stdout.write(listed.stdout)
    if (listed.stderr) process.stderr.write(listed.stderr)
    throw new Error("Unable to inspect existing GitHub mobile releases.")
  }
  let releases
  try {
    releases = JSON.parse(listed.stdout)
  } catch {
    throw new Error("GitHub mobile release listing returned invalid JSON.")
  }
  const previousRelease = selectLatestPublishedMobileRelease(releases, mobile.githubTagPrefix)
  if (!previousRelease) return
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(mobile.githubRepository)) {
    throw new Error("Mobile GitHub repository is invalid.")
  }
  const manifestAssetName = mobile.appJson.extra.anyboxMobileGitHubManifestAssetName
  const manifestUrl =
    `https://github.com/${mobile.githubRepository}/releases/download/` +
    `${encodeURIComponent(previousRelease.tagName)}/${encodeURIComponent(manifestAssetName)}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(manifestUrl, {
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(
        `Previous GitHub mobile release manifest returned HTTP ${response.status}: ${previousRelease.tagName}`,
      )
    }
    const previous = JSON.parse(await response.text())
    assertVersionCodeAdvances(mobile.versionCode, previous.versionCode)
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchRequiredText(url, label) {
  const response = await fetch(url, { cache: "no-store" })
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}.`)
  return response.text()
}

async function main() {
  const args = process.argv.slice(2)
  const notes = parseNotes(args)
  if (notes.length === 0) throw new Error('At least one --notes "..." value is required.')
  loadMobileReleaseEnvironment()
  assertScopedReleaseTreeClean()
  const mobile = readMobileConfig()
  const signing = requireOtaSigningMaterial()
  const sourceCommit = readGit(["rev-parse", "HEAD"]).toLowerCase()
  const tag = `${mobile.githubTagPrefix}${mobile.version}`
  requireTagAbsent(tag, mobile.githubRepository)
  await requireIncreasingGitHubVersionCode(mobile)
  await requireIncreasingPublishedVersionCode(mobile, signing.certificatePem)
  const nativeFingerprint = await assertNativeFingerprint(mobile.runtimeVersion)

  run(corepack, ["pnpm", "--filter", "anybox-mobile-app", "typecheck"], {
    cwd: repoRoot,
    shell: isWindows,
  })
  run(
    corepack,
    ["pnpm", "--filter", "anybox-mobile-app", "exec", "expo", "install", "--check"],
    { cwd: repoRoot, shell: isWindows },
  )
  run("node", [path.join(packageRoot, "scripts", "build-android-release.mjs"), "--channel", "production"])

  const apkPath = path.join(packageRoot, "build", "anybox-mobile-release.apk")
  if (!existsSync(apkPath)) throw new Error("Release APK build did not produce the expected output.")
  const adb = resolveAdb()
  const serial = requirePhysicalDevice(adb)
  runDeviceSmoke(adb, serial, apkPath, mobile)

  const minimumVersionCode = Number.parseInt(
    parseOption(
      args,
      "--minimum-version-code",
      String(mobile.appJson.extra.anyboxMobileMinimumVersionCode),
    ),
    10,
  )
  const prepared = await prepareAndroidReleaseAssets({
    mobile,
    apkPath,
    notes,
    force: args.includes("--force"),
    minimumVersionCode,
    privateKeyPem: signing.privateKeyPem,
  })
  assertNoExpoHosting(prepared.rawManifest, "Android release manifest")

  const githubUrl = createGitHubRelease(prepared, mobile, notes, sourceCommit)
  const apkAssetName = mobile.appJson.extra.anyboxMobileGitHubApkAssetName
  const manifestAssetName = mobile.appJson.extra.anyboxMobileGitHubManifestAssetName
  const signatureAssetName = mobile.appJson.extra.anyboxMobileGitHubManifestSignatureAssetName
  const releasePrefix = `mobile/android/releases/${mobile.version}`
  const immutableApkKey = `${releasePrefix}/${apkAssetName}`
  const immutableManifestKey = `${releasePrefix}/${manifestAssetName}`
  const immutableSignatureKey = `${releasePrefix}/${signatureAssetName}`
  const signatureBody = `${prepared.signature}\n`

  await uploadImmutableFile(apkPath, immutableApkKey, "application/vnd.android.package-archive")
  await uploadImmutableBody(
    prepared.rawManifest,
    immutableManifestKey,
    "application/json; charset=utf-8",
  )
  await uploadImmutableBody(signatureBody, immutableSignatureKey, "text/plain; charset=utf-8")
  await assertPublicFile(publicUrlForKey(immutableApkKey), apkPath)
  await assertPublicBytes(publicUrlForKey(immutableManifestKey), prepared.rawManifest)
  await assertPublicBytes(publicUrlForKey(immutableSignatureKey), signatureBody)

  const liveSignatureKey = "mobile/android/version.sig"
  const liveManifestKey = "mobile/android/version.json"
  await uploadPointerBody(signatureBody, liveSignatureKey, undefined, "text/plain; charset=utf-8")
  await assertPublicBytes(publicUrlForKey(liveSignatureKey), signatureBody)
  await uploadPointerBody(prepared.rawManifest, liveManifestKey)
  await assertPublicBytes(publicUrlForKey(liveManifestKey), prepared.rawManifest)

  const finalNonce = Date.now()
  const [publicManifestRaw, publicSignatureRaw, publicApkHead] = await Promise.all([
    fetchRequiredText(
      `${publicUrlForKey(liveManifestKey)}?final=${finalNonce}`,
      "Final public Android release manifest",
    ),
    fetchRequiredText(
      `${publicUrlForKey(liveSignatureKey)}?final=${finalNonce}`,
      "Final public Android release signature",
    ),
    fetch(`${prepared.manifest.apkUrl}?final=${finalNonce}`, {
      cache: "no-store",
      method: "HEAD",
      redirect: "follow",
    }),
  ])
  const publicSignature = publicSignatureRaw.trim()
  if (
    publicManifestRaw !== prepared.rawManifest ||
    !verifyBody(publicManifestRaw, publicSignature, signing.certificatePem)
  ) {
    throw new Error("Final public Android release manifest signature verification failed.")
  }
  if (!publicApkHead.ok) {
    throw new Error(`Final public APK HEAD returned HTTP ${publicApkHead.status}.`)
  }
  const finalApkUrl = new URL(publicApkHead.url || prepared.manifest.apkUrl)
  if (
    finalApkUrl.protocol !== "https:" ||
    finalApkUrl.hostname !== "download.anybox.com.cn" ||
    finalApkUrl.username ||
    finalApkUrl.password ||
    (finalApkUrl.port && finalApkUrl.port !== "443")
  ) {
    throw new Error("Final public APK redirected outside the trusted Anybox CDN.")
  }
  const publicApkLength = Number(publicApkHead.headers.get("content-length"))
  if (
    Number.isFinite(publicApkLength) &&
    publicApkLength > 0 &&
    publicApkLength !== prepared.manifest.sizeBytes
  ) {
    throw new Error("Final public APK Content-Length does not match the signed release manifest.")
  }

  const record = {
    schemaVersion: 1,
    tag,
    sourceCommit,
    githubUrl,
    version: mobile.version,
    versionCode: mobile.versionCode,
    packageName: mobile.packageName,
    runtimeVersion: mobile.runtimeVersion,
    nativeFingerprint,
    apkUrl: prepared.manifest.apkUrl,
    apkSha256: prepared.manifest.sha256,
    apkSizeBytes: prepared.manifest.sizeBytes,
    apkCertificateSha256: readFileSync(
      path.join(packageRoot, "credentials", "android-release-certificate.sha256"),
      "utf8",
    ).trim(),
    otaCertificateSha256: certificateFingerprint(signing.certificatePem),
    publishedAt: prepared.manifest.publishedAt,
    physicalDeviceSmoke: true,
  }
  const recordDirectory = path.join(packageRoot, "build", "release-records")
  mkdirSync(recordDirectory, { recursive: true })
  writeFileSync(
    path.join(recordDirectory, `${tag}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
  )

  console.log(`Published ${tag}`)
  console.log(`APK: ${prepared.manifest.apkUrl}`)
  console.log(`versionCode: ${mobile.versionCode}`)
  console.log(`APK certificate SHA-256: ${record.apkCertificateSha256}`)
  console.log(`OTA certificate SHA-256: ${record.otaCertificateSha256}`)
  console.log(`APK SHA-256: ${prepared.manifest.sha256}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
