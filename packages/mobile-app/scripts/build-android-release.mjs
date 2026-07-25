import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { assertReleaseCertificateFingerprint } from "./lib/release-guards.mjs"

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const repoRoot = path.resolve(packageRoot, "..", "..")
const isWindows = process.platform === "win32"
const androidDir = path.join(packageRoot, "android")
const outputPath = path.join(packageRoot, "build", "anybox-mobile-release.apk")
const certificatePath = path.join(packageRoot, "credentials", "ota-certificate.pem")
const releaseCertificateFingerprintPath = path.join(
  packageRoot,
  "credentials",
  "android-release-certificate.sha256",
)
const DEFAULT_APK_ARCHITECTURES = "arm64-v8a,armeabi-v7a"
const ALLOWED_ANDROID_ARCHITECTURES = new Set([
  "arm64-v8a",
  "armeabi-v7a",
  "x86",
  "x86_64",
])

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const separator = trimmed.indexOf("=")
    if (separator <= 0) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "")
    if (process.env[key] === undefined) process.env[key] = value
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? packageRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
    shell: options.shell ?? (isWindows && /\.(?:bat|cmd)$/i.test(command)),
    stdio: options.capture ? "pipe" : "inherit",
    windowsHide: true,
  })
  if (result.status !== 0) {
    if (options.capture) {
      if (result.stdout) process.stdout.write(result.stdout)
      if (result.stderr) process.stderr.write(result.stderr)
    }
    throw new Error(`${path.basename(command)} failed. See the command output above.`)
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim()
}

function resolveBuildTool(name) {
  const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
  if (!sdkRoot) throw new Error("ANDROID_HOME or ANDROID_SDK_ROOT is required.")
  const buildToolsRoot = path.join(sdkRoot, "build-tools")
  const suffix = isWindows ? (name === "apksigner" ? ".bat" : ".exe") : ""
  const versions = existsSync(buildToolsRoot)
    ? readdirSync(buildToolsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
    : []
  const candidate = versions
    .map((version) => path.join(buildToolsRoot, version, `${name}${suffix}`))
    .find((filePath) => existsSync(filePath))
  if (!candidate) throw new Error(`Android build tool ${name} was not found under ${buildToolsRoot}.`)
  return candidate
}

function requireReleaseSecrets() {
  loadEnvFile(path.join(repoRoot, ".env.mobile-signing.local"))
  const required = [
    "ANYBOX_ANDROID_KEYSTORE_PATH",
    "ANYBOX_ANDROID_KEYSTORE_PASSWORD",
    "ANYBOX_ANDROID_KEY_ALIAS",
    "ANYBOX_ANDROID_KEY_PASSWORD",
  ]
  const missing = required.filter((name) => !process.env[name]?.trim())
  if (missing.length) {
    throw new Error(`Missing release signing values: ${missing.join(", ")}. Run pnpm mobile:keys:init first.`)
  }
  const keystorePath = path.resolve(process.env.ANYBOX_ANDROID_KEYSTORE_PATH)
  if (!existsSync(keystorePath)) throw new Error(`Android keystore not found: ${keystorePath}`)
  process.env.ANYBOX_ANDROID_KEYSTORE_PATH = keystorePath
  if (!existsSync(certificatePath)) {
    throw new Error(`OTA public certificate not found: ${certificatePath}. Run pnpm mobile:keys:init first.`)
  }
  if (!existsSync(releaseCertificateFingerprintPath)) {
    throw new Error(
      `Android release certificate fingerprint not found: ${releaseCertificateFingerprintPath}. ` +
        "Run pnpm mobile:keys:init first.",
    )
  }
}

function resolveApkArchitectures() {
  const raw = process.env.ANYBOX_ANDROID_ARCHITECTURES?.trim() || DEFAULT_APK_ARCHITECTURES
  const architectures = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
  if (
    architectures.length === 0 ||
    new Set(architectures).size !== architectures.length ||
    architectures.some((value) => !ALLOWED_ANDROID_ARCHITECTURES.has(value))
  ) {
    throw new Error(
      "ANYBOX_ANDROID_ARCHITECTURES must be a unique comma-separated subset of " +
        [...ALLOWED_ANDROID_ARCHITECTURES].join(", ") +
        ".",
    )
  }
  return architectures.join(",")
}

function resolveGradleMaxWorkers() {
  const value = process.env.ANYBOX_GRADLE_MAX_WORKERS?.trim() || (isWindows ? "1" : "2")
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error("ANYBOX_GRADLE_MAX_WORKERS must be a positive integer.")
  }
  return value
}

function assertNoExpoHostedConfiguration(value, label) {
  const forbidden = [
    { pattern: /\bu\.expo\.dev\b/i, name: "Expo Updates hosted URL" },
    { pattern: /\bexp\.host\b/i, name: "legacy Expo manifest host" },
    { pattern: /\bexpo\.io\b|\bexp\.direct\b|\bexpo\.test\b/i, name: "Expo hosted domain" },
    { pattern: /(?:["']projectId["']|projectId\s*:)/i, name: "EAS projectId" },
    { pattern: /\bexpo\.dev\/(?:accounts|@)/i, name: "Expo hosted project URL" },
  ]
  const match = forbidden.find(({ pattern }) => pattern.test(value))
  if (match) {
    throw new Error(`${label} contains forbidden ${match.name}.`)
  }
}

function verifySelfHostedApkConfiguration(apkPath, aapt) {
  const manifest = run(aapt, ["dump", "xmltree", apkPath, "AndroidManifest.xml"], { capture: true })
  assertNoExpoHostedConfiguration(manifest, "APK AndroidManifest.xml")
  const cleartextTrafficLine = manifest
    .split(/\r?\n/)
    .find((line) => line.includes("android:usesCleartextTraffic"))
  if (
    !cleartextTrafficLine ||
    (!cleartextTrafficLine.includes("0xffffffff") && !/Raw:\s*"true"/i.test(cleartextTrafficLine))
  ) {
    throw new Error(
      "APK AndroidManifest.xml does not allow cleartext traffic required by the local Wi-Fi bridge.",
    )
  }
  if (!manifest.includes("https://updates.anybox.com.cn/v1/manifest")) {
    throw new Error("APK AndroidManifest.xml does not contain the self-hosted update URL.")
  }
  if (!manifest.includes("expo-channel-name")) {
    throw new Error("APK AndroidManifest.xml does not contain the OTA channel request header.")
  }

  const entries = run("jar", ["tf", apkPath], { capture: true })
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (!entries.includes("assets/index.android.bundle")) {
    throw new Error("APK does not contain the embedded Android JavaScript bundle.")
  }
  for (const entry of entries) {
    if (entry.startsWith("/") || entry.includes("\\") || entry.split("/").includes("..") || /^[A-Za-z]:/.test(entry)) {
      throw new Error(`Unsafe APK entry path: ${entry}`)
    }
  }

  const scanRoot = mkdtempSync(path.join(os.tmpdir(), "anybox-mobile-apk-scan-"))
  try {
    run("jar", ["xf", apkPath], { cwd: scanRoot, capture: true })
    const pending = [scanRoot]
    while (pending.length > 0) {
      const directory = pending.pop()
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const extractedPath = path.resolve(directory, entry.name)
        if (!extractedPath.startsWith(`${path.resolve(scanRoot)}${path.sep}`)) {
          throw new Error(`APK entry escaped the scan directory: ${extractedPath}`)
        }
        if (entry.isDirectory()) {
          pending.push(extractedPath)
          continue
        }
        if (!entry.isFile()) {
          throw new Error(`APK contains an unsupported filesystem entry: ${extractedPath}`)
        }
        assertNoExpoHostedConfiguration(
          readFileSync(extractedPath).toString("latin1"),
          `APK ${path.relative(scanRoot, extractedPath)}`,
        )
      }
    }
  } finally {
    rmSync(scanRoot, { force: true, recursive: true })
  }
}

function verifyApk(apkPath) {
  const appConfig = JSON.parse(readFileSync(path.join(packageRoot, "app.json"), "utf8")).expo
  const expectedPackageName = appConfig.android.package
  const expectedVersionCode = String(appConfig.android.versionCode)
  const expectedVersion = appConfig.version

  const aapt = resolveBuildTool("aapt")
  const apksigner = resolveBuildTool("apksigner")
  const zipalign = resolveBuildTool("zipalign")
  const badging = run(aapt, ["dump", "badging", apkPath], { capture: true })
  const packageLine = badging.split(/\r?\n/).find((line) => line.startsWith("package:"))
  if (!packageLine) throw new Error("aapt did not return APK package metadata.")
  const packageName = packageLine.match(/name='([^']+)'/)?.[1]
  const versionCode = packageLine.match(/versionCode='([^']+)'/)?.[1]
  const versionName = packageLine.match(/versionName='([^']+)'/)?.[1]
  if (packageName !== expectedPackageName || versionCode !== expectedVersionCode || versionName !== expectedVersion) {
    throw new Error(
      `APK identity mismatch: expected ${expectedPackageName} ${expectedVersion} (${expectedVersionCode}), ` +
        `received ${packageName} ${versionName} (${versionCode}).`,
    )
  }

  run(zipalign, ["-c", "-P", "16", "4", apkPath])
  const signatureOutput = run(apksigner, ["verify", "--verbose", "--print-certs", apkPath], { capture: true })
  if (!/Verified using v[23] scheme.*true/i.test(signatureOutput)) {
    throw new Error("APK does not have a verified Android v2 or v3 signature.")
  }
  const apkCertificate = signatureOutput.match(/certificate SHA-256 digest:\s*([a-fA-F0-9]+)/i)?.[1]?.toLowerCase()
  if (!apkCertificate) throw new Error("Unable to read the APK signing certificate SHA-256.")

  const keytoolOutput = run(
    "keytool",
    [
      "-list",
      "-v",
      "-keystore",
      process.env.ANYBOX_ANDROID_KEYSTORE_PATH,
      "-storepass:env",
      "ANYBOX_ANDROID_KEYSTORE_PASSWORD",
      "-alias",
      process.env.ANYBOX_ANDROID_KEY_ALIAS,
    ],
    { capture: true, env: process.env },
  )
  const keystoreCertificate = keytoolOutput
    .match(/SHA256:\s*([A-Fa-f0-9:]+)/i)?.[1]
    ?.replaceAll(":", "")
    .toLowerCase()
  const pinnedCertificate = readFileSync(releaseCertificateFingerprintPath, "utf8")
  assertReleaseCertificateFingerprint(apkCertificate, keystoreCertificate, pinnedCertificate)

  verifySelfHostedApkConfiguration(apkPath, aapt)
  return { apkCertificate, packageName, versionCode, versionName }
}

function main() {
  process.env.ANYBOX_MOBILE_BUILD_PROFILE = "production"
  requireReleaseSecrets()
  const channelIndex = process.argv.indexOf("--channel")
  const channel = channelIndex >= 0 ? process.argv[channelIndex + 1] : process.env.ANYBOX_MOBILE_UPDATE_CHANNEL || "production"
  if (channel !== "preview" && channel !== "production") {
    throw new Error("--channel must be preview or production.")
  }
  process.env.ANYBOX_MOBILE_UPDATE_CHANNEL = channel
  process.env.NODE_ENV = "production"

  run("node", [
    path.join(packageRoot, "scripts", "build-android-debug.mjs"),
    "--profile",
    "production",
    "--clean",
    "--prepare-only",
    "--minify",
  ])
  const gradlePath = path.join(androidDir, isWindows ? "gradlew.bat" : "gradlew")
  if (!existsSync(gradlePath)) throw new Error("Android Gradle wrapper was not generated.")
  const buildGradle = readFileSync(path.join(androidDir, "app", "build.gradle"), "utf8")
  if (!buildGradle.includes("@generated by with-android-release-signing")) {
    throw new Error("Android release signing plugin was not applied.")
  }
  if (
    /buildTypes\s*\{[\s\S]*?\n\s+release\s*\{[\s\S]*?signingConfig\s+signingConfigs\.debug/.test(
      buildGradle,
    )
  ) {
    throw new Error("Android release still points to the debug signing key.")
  }
  if (
    !/buildTypes\s*\{[\s\S]*?\n\s+release\s*\{[\s\S]*?signingConfig\s+signingConfigs\.release/.test(
      buildGradle,
    )
  ) {
    throw new Error("Android release does not explicitly use the production signing config.")
  }

  const architectures = resolveApkArchitectures()
  const gradleMaxWorkers = resolveGradleMaxWorkers()
  run(gradlePath, [
    "--no-daemon",
    "--console=plain",
    `--max-workers=${gradleMaxWorkers}`,
    `-PreactNativeArchitectures=${architectures}`,
    "assembleRelease",
  ], {
    cwd: androidDir,
    shell: isWindows,
  })
  const builtApk = path.join(androidDir, "app", "build", "outputs", "apk", "release", "app-release.apk")
  if (!existsSync(builtApk)) throw new Error(`Release APK was not found at ${builtApk}`)
  mkdirSync(path.dirname(outputPath), { recursive: true })
  copyFileSync(builtApk, outputPath)
  const verified = verifyApk(outputPath)

  console.log(`Release APK: ${outputPath}`)
  console.log(`Package: ${verified.packageName} ${verified.versionName} (${verified.versionCode})`)
  console.log(`Certificate SHA-256: ${verified.apkCertificate}`)
  console.log(`Update channel: ${channel}`)
  console.log(`Android architectures: ${architectures}`)
  console.log(`Gradle max workers: ${gradleMaxWorkers}`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
