import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import {
  assertDevelopmentApkIdentity,
  DEVELOPMENT_PACKAGE_NAME,
  deploymentCommands,
  parseAdbDevices,
  resolveAndroidAbi,
  selectAndroidDevice,
} from "./lib/android-development.mjs"

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const repoRoot = path.resolve(packageRoot, "..", "..")
const apkPath = path.join(packageRoot, "build", "anybox-mobile-dev.apk")
const isWindows = process.platform === "win32"
const fatalLogPatterns = [
  /FATAL EXCEPTION/i,
  /\bAndroidRuntime\b.*FATAL/i,
  /Unable to load script/i,
  /Cannot find native module/i,
  /Invariant Violation/i,
  /ReactNativeJS.*(?:Error|TypeError|ReferenceError)/i,
]

function usage() {
  return [
    "Anybox Android development APK deployer",
    "",
    "Usage:",
    "  corepack pnpm mobile:android:deploy:dev -- --serial <serial>",
    "",
    "Options:",
    "  --serial <serial>    Target adb device. Falls back to ANDROID_SERIAL, then the only online device.",
    "  --clean              Force a clean Expo prebuild before compiling.",
    "  --skip-typecheck     Skip the default mobile TypeScript gate.",
    "  --no-launch          Install the APK without starting it.",
    "  --help               Show this help.",
    "",
    "This command only uses adb install -r. It never uninstalls the app or clears app data.",
  ].join("\n")
}

function parseArgs(argv) {
  const args = {
    clean: false,
    help: false,
    launch: true,
    serial: "",
    typecheck: true,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === "--") continue
    if (value === "--help" || value === "-h") args.help = true
    else if (value === "--clean") args.clean = true
    else if (value === "--skip-typecheck") args.typecheck = false
    else if (value === "--no-launch") args.launch = false
    else if (value === "--serial") {
      args.serial = String(argv[index + 1] ?? "").trim()
      if (!args.serial) throw new Error("--serial requires a device serial.")
      index += 1
    } else {
      throw new Error(`Unknown option: ${value}`)
    }
  }
  return args
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? packageRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
    shell:
      options.shell ??
      (isWindows && (command === "corepack" || /\.(?:bat|cmd)$/i.test(command))),
    stdio: options.capture ? "pipe" : "inherit",
    windowsHide: true,
  })
  if (!options.allowFailure && result.status !== 0) {
    if (options.capture) {
      if (result.stdout) process.stdout.write(result.stdout)
      if (result.stderr) process.stderr.write(result.stderr)
    }
    throw new Error(`${path.basename(command)} ${args.join(" ")} failed.`)
  }
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
    status: result.status,
  }
}

function resolveAndroidSdkTool(name, directory = "platform-tools") {
  const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
  if (!sdkRoot) {
    throw new Error(
      "ANDROID_HOME or ANDROID_SDK_ROOT is required. Run mobile:android:setup first.",
    )
  }
  const extension = isWindows ? ".exe" : ""
  if (directory === "build-tools") {
    const buildToolsRoot = path.join(sdkRoot, "build-tools")
    const versions = existsSync(buildToolsRoot)
      ? readdirSync(buildToolsRoot, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort(compareVersionsDescending)
      : []
    for (const version of versions) {
      const candidate = path.join(buildToolsRoot, version, `${name}${extension}`)
      if (existsSync(candidate)) return candidate
    }
    throw new Error(`Android SDK build tool is missing: ${name}.`)
  }
  const toolPath = path.join(sdkRoot, directory, `${name}${extension}`)
  if (!existsSync(toolPath)) throw new Error(`Android SDK tool is missing: ${toolPath}`)
  return toolPath
}

function compareVersionsDescending(left, right) {
  return right.localeCompare(left, undefined, { numeric: true, sensitivity: "base" })
}

function verifyStandaloneDevelopmentApk(aapt, expectedAbi) {
  if (!existsSync(apkPath)) throw new Error(`Development APK was not produced: ${apkPath}`)
  const badging = run(aapt, ["dump", "badging", apkPath], { capture: true }).output
  const manifest = run(
    aapt,
    ["dump", "xmltree", apkPath, "AndroidManifest.xml"],
    { capture: true },
  ).output
  const identity = assertDevelopmentApkIdentity({
    badging,
    expectedAbi,
    manifest,
  })
  const entries = run("jar", ["tf", apkPath], { capture: true }).output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
  if (!entries.includes("assets/index.android.bundle")) {
    throw new Error("Development APK does not contain the embedded JavaScript bundle.")
  }
  return identity
}

function installDevelopmentApk(command) {
  const result = run(command.command, command.args, {
    allowFailure: true,
    capture: true,
  })
  if (result.output) console.log(result.output)
  if (result.ok) return
  if (/INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match/i.test(result.output)) {
    throw new Error(
      "Development APK signing conflict. The existing development app was not uninstalled and its data was not cleared.",
    )
  }
  throw new Error(
    "adb install -r failed. The deployer did not uninstall the app or clear its data.",
  )
}

async function launchAndInspect(adb, serial, launchCommand) {
  run(launchCommand.command, launchCommand.args)
  await new Promise((resolve) => setTimeout(resolve, 3_000))

  const pid = run(
    adb,
    ["-s", serial, "shell", "pidof", DEVELOPMENT_PACKAGE_NAME],
    { allowFailure: true, capture: true },
  ).output.trim().split(/\s+/)[0]
  if (!pid) {
    throw new Error(`Development app process is not running: ${DEVELOPMENT_PACKAGE_NAME}.`)
  }
  const logcat = run(
    adb,
    ["-s", serial, "logcat", "-d", `--pid=${pid}`, "-t", "500"],
    { allowFailure: true, capture: true },
  ).output
  const fatalLines = logcat
    .split(/\r?\n/)
    .filter((line) => fatalLogPatterns.some((pattern) => pattern.test(line)))
  if (fatalLines.length) {
    console.error(fatalLines.slice(0, 40).join("\n"))
    throw new Error("Development app started with fatal Android/React Native log entries.")
  }
  return pid
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }

  const adb = resolveAndroidSdkTool("adb")
  const aapt = resolveAndroidSdkTool("aapt", "build-tools")
  const devices = parseAdbDevices(
    run(adb, ["devices", "-l"], { capture: true }).output,
  )
  const device = selectAndroidDevice({
    cliSerial: args.serial,
    devices,
    envSerial: process.env.ANDROID_SERIAL,
  })
  const rawAbi = run(
    adb,
    ["-s", device.serial, "shell", "getprop", "ro.product.cpu.abi"],
    { capture: true },
  ).output
  const abi = resolveAndroidAbi(rawAbi)
  console.log(`Target Android device: ${device.serial} (${abi})`)

  if (args.typecheck) {
    run(
      "corepack",
      ["pnpm", "--filter", "anybox-mobile-app", "typecheck"],
      { cwd: repoRoot },
    )
  }

  const buildArgs = [
    path.join(packageRoot, "scripts", "build-android-debug.mjs"),
    "--profile",
    "development",
  ]
  if (args.clean) buildArgs.push("--clean")
  run("node", buildArgs, {
    env: {
      ...process.env,
      ANYBOX_ANDROID_ARCHITECTURES: abi,
      ANYBOX_MOBILE_BUILD_PROFILE: "development",
    },
  })

  const identity = verifyStandaloneDevelopmentApk(aapt, abi)
  const commands = deploymentCommands({
    adb,
    apkPath,
    packageName: DEVELOPMENT_PACKAGE_NAME,
    serial: device.serial,
  })
  installDevelopmentApk(commands[0])
  const pid = args.launch
    ? await launchAndInspect(adb, device.serial, commands[1])
    : ""

  console.log(`Development APK: ${apkPath}`)
  console.log(
    `Verified identity: ${identity.packageName} · ${identity.applicationLabel} · anybox-mobile-dev`,
  )
  console.log("Install mode: adb install -r (existing development data preserved)")
  if (pid) console.log(`App process: ${pid}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
