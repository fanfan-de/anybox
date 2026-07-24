import { existsSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const isWindows = process.platform === "win32"
const isMac = process.platform === "darwin"
const strict = process.argv.includes("--strict")
const release = process.argv.includes("--release")

function packageBin(name) {
  return path.join(packageRoot, "node_modules", ".bin", `${name}${isWindows ? ".CMD" : ""}`)
}

function run(command, args = [], options = {}) {
  const useShell = options.shell ?? (isWindows && /\.cmd$/i.test(command))
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    encoding: "utf8",
    shell: useShell,
    windowsHide: true,
  })
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
    status: result.status,
  }
}

function checkCommand(label, command, args = ["--version"], options = {}) {
  const result = run(command, args, options)
  return {
    label,
    ok: result.ok,
    detail: result.ok ? firstLine(result.output) : "not found or not runnable",
  }
}

function firstLine(value) {
  return value.split(/\r?\n/).find(Boolean) ?? ""
}

function checkPackageBin(label, name, args = ["--version"]) {
  const bin = packageBin(name)
  if (!existsSync(bin)) {
    return {
      label,
      ok: false,
      detail: `${name} is not installed in packages/mobile-app`,
    }
  }
  const result = run(bin, args)
  return {
    label,
    ok: result.ok,
    detail: result.ok ? firstLine(result.output) : firstLine(result.output) || `${name} failed`,
  }
}

function checkIosRuntime() {
  if (!isMac) {
    return {
      label: "iOS Simulator runtime",
      ok: false,
      detail: "macOS only",
    }
  }
  const result = run("xcrun", ["simctl", "list", "runtimes", "-j"])
  if (!result.ok) {
    return {
      label: "iOS Simulator runtime",
      ok: false,
      detail: firstLine(result.output) || "not found or not runnable",
    }
  }

  try {
    const value = JSON.parse(result.output)
    const runtimes = Array.isArray(value.runtimes) ? value.runtimes : []
    const runtime = runtimes.find((item) => item?.identifier === "com.apple.CoreSimulator.SimRuntime.iOS-26-5" && item?.isAvailable === true)
      ?? runtimes.find((item) => typeof item?.identifier === "string" && item.identifier.includes(".SimRuntime.iOS-") && item.isAvailable === true)
    return {
      label: "iOS Simulator runtime",
      ok: Boolean(runtime),
      detail: runtime ? `${runtime.name ?? "iOS"} ${runtime.version ?? ""} ${runtime.buildversion ?? ""}`.trim() : "no available iOS runtime",
    }
  } catch {
    return {
      label: "iOS Simulator runtime",
      ok: false,
      detail: "unable to parse runtime list",
    }
  }
}

function checkEnv(name) {
  const value = process.env[name]?.trim()
  return {
    label: name,
    ok: Boolean(value),
    detail: value || "not set",
  }
}

const expo = checkPackageBin("Expo CLI", "expo", ["--version"])
const keytool = checkCommand("keytool", "keytool", ["-help"])
const githubCli = checkCommand("GitHub CLI", "gh", ["--version"])
const publicCertificate = {
  label: "OTA public certificate",
  ok: existsSync(path.join(packageRoot, "credentials", "ota-certificate.pem")),
  detail: existsSync(path.join(packageRoot, "credentials", "ota-certificate.pem"))
    ? "credentials/ota-certificate.pem"
    : "run pnpm mobile:keys:init",
}
const androidCertificateFingerprint = {
  label: "Android release certificate fingerprint",
  ok: existsSync(path.join(packageRoot, "credentials", "android-release-certificate.sha256")),
  detail: existsSync(path.join(packageRoot, "credentials", "android-release-certificate.sha256"))
    ? "credentials/android-release-certificate.sha256"
    : "run pnpm mobile:keys:init",
}
const localSigningConfig = {
  label: "Local mobile signing config",
  ok: existsSync(path.resolve(packageRoot, "..", "..", ".env.mobile-signing.local")),
  detail: existsSync(path.resolve(packageRoot, "..", "..", ".env.mobile-signing.local"))
    ? "configured outside Git"
    : "run pnpm mobile:keys:init",
}
const xcode = isMac
  ? checkCommand("Xcode", "xcodebuild", ["-version"])
  : {
      label: "Xcode",
      ok: false,
      detail: "macOS only",
    }
const iosSimulator = isMac
  ? checkCommand("iOS Simulator", "xcrun", ["simctl", "help"])
  : {
      label: "iOS Simulator",
      ok: false,
      detail: "macOS only",
    }
const iosRuntime = checkIosRuntime()

const checks = [
  checkCommand("Node.js", process.execPath, ["--version"]),
  checkPackageBin("TypeScript", "tsc", ["--version"]),
  expo,
  keytool,
  githubCli,
  publicCertificate,
  androidCertificateFingerprint,
  localSigningConfig,
  ...(isMac ? [xcode, iosSimulator, iosRuntime] : []),
  checkCommand("Java", "java", ["-version"]),
  checkCommand("adb", "adb", ["version"]),
  checkCommand("sdkmanager", "sdkmanager", ["--version"], { shell: isWindows }),
  checkEnv("JAVA_HOME"),
  checkEnv("ANDROID_HOME"),
  checkEnv("ANDROID_SDK_ROOT"),
]

const localAndroidReady =
  checks.find((item) => item.label === "Java")?.ok &&
  checks.find((item) => item.label === "adb")?.ok &&
  (checks.find((item) => item.label === "ANDROID_HOME")?.ok || checks.find((item) => item.label === "ANDROID_SDK_ROOT")?.ok)
const localIosReady = isMac && xcode.ok && iosSimulator.ok && iosRuntime.ok
const expoGoReady = expo.ok
const releaseReady =
  localAndroidReady &&
  keytool.ok &&
  githubCli.ok &&
  publicCertificate.ok &&
  androidCertificateFingerprint.ok &&
  localSigningConfig.ok

console.log("Anybox Mobile Doctor")
console.log("")
for (const check of checks) {
  console.log(`${check.ok ? "[ok]" : "[missing]"} ${check.label}: ${check.detail}`)
}

console.log("")
console.log(`${expoGoReady ? "[ok]" : "[missing]"} Expo Go smoke test readiness`)
console.log(`${localAndroidReady ? "[ok]" : "[missing]"} Local Android build readiness`)
console.log(`${localIosReady ? "[ok]" : isMac ? "[missing]" : "[skip]"} Local iOS simulator readiness${isMac ? "" : ": macOS with Xcode required"}`)
console.log(`${releaseReady ? "[ok]" : "[missing]"} Self-hosted Android release readiness`)

if (!localAndroidReady) {
  console.log("")
  console.log("Local Android builds need Java, Android SDK, adb, and ANDROID_HOME or ANDROID_SDK_ROOT.")
}

if (isMac && !localIosReady) {
  console.log("Local iOS builds need Xcode and the iOS Simulator command-line tools.")
}

if (release && !releaseReady) {
  console.log("Release mode needs the local signing keys, public certificate, GitHub CLI, and Java/Android tools.")
}

if (
  strict &&
  (!expoGoReady ||
    !localAndroidReady ||
    (isMac && !localIosReady) ||
    (release && !releaseReady))
) {
  process.exit(1)
}
