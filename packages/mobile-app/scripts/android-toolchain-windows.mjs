import { createWriteStream, existsSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { Readable } from "node:stream"
import { finished } from "node:stream/promises"
import {
  buildPowerShell7Args,
  requirePowerShell7Runtime,
} from "../../platform/src/powershell.ts"

const DEFAULT_PLATFORM = "android-36"
const DEFAULT_BUILD_TOOLS = "36.0.0"
const ANDROID_CLI_URL = "https://dl.google.com/android/repository/commandlinetools-win-14742923_latest.zip"
const JDK_URL = "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk"
const isWindows = process.platform === "win32"

function usage() {
  return [
    "Anybox Android Toolchain Setup",
    "",
    "Usage:",
    "  pnpm --filter anybox-mobile-app run android:setup",
    "  pnpm --filter anybox-mobile-app run android:setup -- --install --set-env",
    "",
    "Options:",
    "  --install              Install missing Windows packages with winget.",
    "  --portable             Download a user-local portable JDK and Android CLI instead of MSI installers.",
    "  --install-sdk          Install Android SDK packages with sdkmanager.",
    "  --set-env              Persist ANDROID_HOME and ANDROID_SDK_ROOT with setx.",
    `  --platform <value>     Android SDK platform package. Default: ${DEFAULT_PLATFORM}.`,
    `  --build-tools <value>  Android build-tools version. Default: ${DEFAULT_BUILD_TOOLS}.`,
    "  --help                 Show this help.",
  ].join("\n")
}

function parseArgs(argv) {
  const args = {
    buildTools: DEFAULT_BUILD_TOOLS,
    help: false,
    install: false,
    installSdk: false,
    platform: DEFAULT_PLATFORM,
    portable: false,
    setEnv: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === "--help" || value === "-h") args.help = true
    else if (value === "--install") args.install = true
    else if (value === "--portable") args.portable = true
    else if (value === "--install-sdk") args.installSdk = true
    else if (value === "--set-env") args.setEnv = true
    else if (value === "--platform") {
      args.platform = argv[index + 1] ?? args.platform
      index += 1
    } else if (value === "--build-tools") {
      args.buildTools = argv[index + 1] ?? args.buildTools
      index += 1
    }
  }

  return args
}

function run(command, args = [], options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    shell: options.shell ?? (isWindows && /\.cmd$/i.test(command)),
    stdio: options.stdio ?? "pipe",
    windowsHide: true,
  })
}

function commandExists(command) {
  const result = run(isWindows ? "where.exe" : "which", [command])
  return result.status === 0
}

function firstLine(value) {
  return value.split(/\r?\n/).find(Boolean) ?? ""
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function commandVersion(command, args) {
  const result = run(command, args)
  return {
    ok: result.status === 0,
    detail: result.status === 0 ? firstLine(`${result.stdout ?? ""}${result.stderr ?? ""}`.trim()) : "missing",
  }
}

function androidSdkRootCandidates() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Android", "Sdk") : "",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Android", "sdk") : "",
    path.join(os.homedir(), "AppData", "Local", "Android", "Sdk"),
  ].filter(Boolean)

  return [...new Set(candidates.map((item) => path.resolve(item)))]
}

function portableRoot() {
  return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "AnyboxMobile", "AndroidToolchain")
}

function portableJdkRoot() {
  return path.join(portableRoot(), "jdk-17")
}

function findAndroidSdkRoot() {
  return androidSdkRootCandidates().find((candidate) => existsSync(candidate)) ?? androidSdkRootCandidates()[0]
}

function findSdkTool(root, tool) {
  const executable = `${tool}${isWindows ? ".bat" : ""}`
  const binary = `${tool}${isWindows ? ".exe" : ""}`
  const candidates = [
    path.join(root, "cmdline-tools", "latest", "bin", executable),
    path.join(root, "cmdline-tools", "bin", executable),
    path.join(root, "tools", "bin", executable),
    path.join(root, "platform-tools", binary),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function findPortableJava() {
  const java = path.join(portableJdkRoot(), "bin", "java.exe")
  return existsSync(java) ? java : null
}

function printCheck(label, ok, detail) {
  console.log(`${ok ? "[ok]" : "[missing]"} ${label}: ${detail}`)
}

function installWingetPackage(id) {
  if (!commandExists("winget")) {
    throw new Error("winget is not available on this machine.")
  }

  const result = run(
    "winget",
    ["install", "--id", id, "-e", "--accept-source-agreements", "--accept-package-agreements", "--silent"],
    { stdio: "inherit" },
  )
  if (result.status !== 0) {
    throw new Error(`winget install failed: ${id}`)
  }
}

async function downloadFile(url, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true })
  try {
    const response = await fetch(url)
    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status}`)
    }
    await finished(Readable.fromWeb(response.body).pipe(createWriteStream(destination)))
    return
  } catch (error) {
    console.log(`Node download failed, retrying with PowerShell 7: ${error instanceof Error ? error.message : String(error)}`)
  }

  const powerShell = await requirePowerShell7Runtime()
  const result = run(
    powerShell.executable,
    buildPowerShell7Args(
      `$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri ${psQuote(url)} -OutFile ${psQuote(destination)} -MaximumRedirection 10`,
    ),
    { stdio: "inherit" },
  )
  if (result.status !== 0) {
    throw new Error(`Download failed: ${url}`)
  }
}

async function expandArchive(zipPath, destination) {
  const powerShell = await requirePowerShell7Runtime()
  const result = run(
    powerShell.executable,
    buildPowerShell7Args(
      `Expand-Archive -LiteralPath ${psQuote(zipPath)} -DestinationPath ${psQuote(destination)} -Force`,
    ),
    { stdio: "inherit" },
  )
  if (result.status !== 0) {
    throw new Error(`Failed to extract ${zipPath}`)
  }
}

async function installPortableJdk() {
  const java = findPortableJava()
  if (java) return java

  const root = portableRoot()
  const downloadPath = path.join(root, "downloads", "temurin-jdk-17.zip")
  const extractPath = path.join(root, "extract-jdk")
  await fs.rm(extractPath, { force: true, recursive: true })
  console.log("Downloading portable JDK 17...")
  await downloadFile(JDK_URL, downloadPath)
  await expandArchive(downloadPath, extractPath)

  const entries = await fs.readdir(extractPath, { withFileTypes: true })
  const jdkEntry = entries.find((entry) => entry.isDirectory())
  if (!jdkEntry) throw new Error("Portable JDK archive did not contain a JDK directory.")

  await fs.rm(portableJdkRoot(), { force: true, recursive: true })
  await fs.mkdir(path.dirname(portableJdkRoot()), { recursive: true })
  await fs.rename(path.join(extractPath, jdkEntry.name), portableJdkRoot())
  await fs.rm(extractPath, { force: true, recursive: true })
  return findPortableJava()
}

async function installPortableAndroidCli(sdkRoot) {
  const sdkmanager = findSdkTool(sdkRoot, "sdkmanager")
  if (sdkmanager) return sdkmanager

  const downloadPath = path.join(portableRoot(), "downloads", "android-commandline-tools.zip")
  const tempExtractPath = path.join(portableRoot(), "extract-android-cli")
  const latestPath = path.join(sdkRoot, "cmdline-tools", "latest")
  await fs.rm(tempExtractPath, { force: true, recursive: true })
  console.log("Downloading Android command-line tools...")
  await downloadFile(ANDROID_CLI_URL, downloadPath)
  await expandArchive(downloadPath, tempExtractPath)

  const source = path.join(tempExtractPath, "cmdline-tools")
  if (!existsSync(source)) throw new Error("Android CLI archive did not contain cmdline-tools.")

  await fs.rm(latestPath, { force: true, recursive: true })
  await fs.mkdir(path.dirname(latestPath), { recursive: true })
  await fs.rename(source, latestPath)
  await fs.rm(tempExtractPath, { force: true, recursive: true })
  return findSdkTool(sdkRoot, "sdkmanager")
}

function runSdkManager(sdkmanager, args, env) {
  const result = spawnSync(sdkmanager, args, {
    encoding: "utf8",
    env,
    shell: isWindows,
    stdio: "inherit",
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error(`sdkmanager failed: ${args.join(" ")}`)
  }
}

function acceptLicenses(sdkmanager, env) {
  const result = spawnSync(sdkmanager, ["--licenses"], {
    encoding: "utf8",
    env,
    input: Array.from({ length: 40 }, () => "y").join("\n"),
    shell: isWindows,
    stdio: ["pipe", "inherit", "inherit"],
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error("Android SDK license acceptance failed.")
  }
}

function setUserEnv(name, value) {
  const result = run("setx", [name, value], { stdio: "inherit" })
  if (result.status !== 0) {
    throw new Error(`Failed to persist ${name}.`)
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }

  if (!isWindows) {
    throw new Error("This setup helper is currently scoped to Windows.")
  }

  const sdkRoot = findAndroidSdkRoot()
  const portableJava = findPortableJava()
  const java = portableJava ? { ok: true, detail: portableJava } : commandVersion("java", ["-version"])
  const adbFromPath = commandVersion("adb", ["version"])
  const sdkmanagerFromPath = commandVersion("sdkmanager", ["--version"])
  let sdkmanager = sdkmanagerFromPath.ok ? "sdkmanager" : findSdkTool(sdkRoot, "sdkmanager")
  let adb = adbFromPath.ok ? "adb" : findSdkTool(sdkRoot, "adb")

  console.log("Anybox Android Toolchain")
  console.log("")
  printCheck("Java", java.ok, java.detail)
  printCheck("Android SDK root", existsSync(sdkRoot), sdkRoot)
  printCheck("sdkmanager", Boolean(sdkmanager), sdkmanager ?? "missing")
  printCheck("adb", Boolean(adb), adb ?? "missing")
  console.log("")

  if (args.portable) {
    await installPortableJdk()
    await installPortableAndroidCli(sdkRoot)
  }

  if (args.install) {
    if (!java.ok) installWingetPackage("EclipseAdoptium.Temurin.17.JDK")
    if (!sdkmanager) installWingetPackage("Google.AndroidCLI")
  }

  const nextPortableJava = findPortableJava()
  sdkmanager = commandExists("sdkmanager") ? "sdkmanager" : findSdkTool(sdkRoot, "sdkmanager")
  adb = commandExists("adb") ? "adb" : findSdkTool(sdkRoot, "adb")

  if (args.setEnv) {
    if (nextPortableJava) setUserEnv("JAVA_HOME", portableJdkRoot())
    setUserEnv("ANDROID_HOME", sdkRoot)
    setUserEnv("ANDROID_SDK_ROOT", sdkRoot)
  }

  if (args.installSdk) {
    if (!sdkmanager) {
      throw new Error("sdkmanager is still unavailable. Install Android CLI first, then reopen the terminal.")
    }
    const env = {
      ...process.env,
      ANDROID_HOME: sdkRoot,
      ANDROID_SDK_ROOT: sdkRoot,
      JAVA_HOME: nextPortableJava ? portableJdkRoot() : process.env.JAVA_HOME,
      PATH: nextPortableJava
        ? `${path.join(portableJdkRoot(), "bin")}${path.delimiter}${process.env.PATH ?? ""}`
        : process.env.PATH,
    }
    runSdkManager(sdkmanager, ["platform-tools", `platforms;${args.platform}`, `build-tools;${args.buildTools}`], env)
    acceptLicenses(sdkmanager, env)
  }

  console.log("Next shell environment:")
  if (nextPortableJava) console.log(`  $env:JAVA_HOME="${portableJdkRoot()}"`)
  console.log(`  $env:ANDROID_HOME="${sdkRoot}"`)
  console.log(`  $env:ANDROID_SDK_ROOT="${sdkRoot}"`)
  console.log(`  $env:Path="$env:JAVA_HOME\\bin;$env:ANDROID_HOME\\platform-tools;$env:ANDROID_HOME\\cmdline-tools\\latest\\bin;$env:Path"`)
  console.log("")
  console.log("Then run:")
  console.log("  corepack pnpm mobile:doctor")
  console.log("  corepack pnpm mobile:android:build:debug")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
