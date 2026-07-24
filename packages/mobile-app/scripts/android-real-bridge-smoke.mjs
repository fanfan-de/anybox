import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const defaultApkPath = path.join(packageRoot, "build", "anybox-mobile-debug.apk")
const defaultScreenshotPath = path.join(packageRoot, "build", "anybox-mobile-real-bridge.png")
const defaultPackageName = "com.anybox.mobile"
const defaultDesktopHandoffPath = path.join(process.env.APPDATA ?? "", "anybox-desktop-agent", "mobile-bridge-handoff.json")
const remoteScreenshotPath = "/sdcard/anybox-mobile-real-bridge-smoke.png"
const remoteWindowPath = "/sdcard/anybox-mobile-real-bridge-window.xml"

const fatalLogPatterns = [
  /FATAL EXCEPTION/i,
  /\bE AndroidRuntime\b.*FATAL/i,
  /Unable to load script/i,
  /Cannot find native module/i,
  /Invariant Violation/i,
  /ReactNativeJS.*(?:Error|TypeError|ReferenceError)/i,
]

function usage() {
  return [
    "Anybox Android Real Bridge Smoke Test",
    "",
    "Usage:",
    "  pnpm --filter anybox-mobile-app run android:smoke:bridge -- --url \"https://anybox.com.cn/?code=...\"",
    "  pnpm --filter anybox-mobile-app run android:smoke:bridge -- --url \"anybox-mobile://connect?url=...\"",
    "  pnpm --filter anybox-mobile-app run android:smoke:bridge -- --url \"anybox-mobile://pair?code=...&url=https%3A%2F%2Fanybox.com.cn\"",
    "  pnpm --filter anybox-mobile-app run android:smoke:bridge -- --url \"anybox-mobile://connect-options?...\"",
    "  pnpm --filter anybox-mobile-app run android:smoke:bridge",
    "",
    "Options:",
    "  --url <value>          Bridge URL, anybox-mobile://connect, anybox-mobile://pair, or connect-options deep link. Defaults to MOBILE_BRIDGE_URL.",
    "  --token <value>        Token to append when the URL has no token/code. Defaults to MOBILE_BRIDGE_TOKEN.",
    "  --handoff <path>       Desktop handoff JSON path. Defaults to %APPDATA%/anybox-desktop-agent/mobile-bridge-handoff.json.",
    "  --apk <path>           APK path. Defaults to build/anybox-mobile-debug.apk.",
    "  --package <name>       Android application ID.",
    "  --screenshot <path>    Local screenshot output path.",
    "  --wait <seconds>       Max seconds to wait for connected Home UI. Defaults to 45.",
    "  --android-host <host>   Hostname/IP used only inside the Android deep link.",
    "  --adb-reverse          Force adb reverse when the bridge URL uses localhost/127.0.0.1.",
    "  --no-adb-reverse       Do not automatically adb reverse localhost URLs for physical devices.",
    "  --no-emulator-rewrite  Do not rewrite localhost URLs to 10.0.2.2 for Android emulators.",
    "  --skip-install         Reuse the app already installed on the connected device.",
    "  --skip-preflight       Do not check /api/mobile/status from this computer before launching Android.",
    "  --keep-data            Do not clear app data before launch.",
    "  --replace-existing     Tap Replace when the app is already paired to another bridge.",
    "  --help                 Show this help.",
    "",
    "Environment:",
    "  MOBILE_BRIDGE_URL",
    "  MOBILE_BRIDGE_TOKEN",
  ].join("\n")
}

function parseArgs(argv) {
  const args = {
    adbReverse: false,
    androidHost: "",
    apk: defaultApkPath,
    help: false,
    handoff: defaultDesktopHandoffPath,
    keepData: false,
    noAdbReverse: false,
    noEmulatorRewrite: false,
    packageName: defaultPackageName,
    replaceExisting: false,
    screenshot: defaultScreenshotPath,
    skipPreflight: false,
    skipInstall: false,
    token: process.env.MOBILE_BRIDGE_TOKEN ?? "",
    url: process.env.MOBILE_BRIDGE_URL ?? "",
    waitSeconds: 45,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === "--help" || value === "-h") {
      args.help = true
    } else if (value === "--url") {
      args.url = argv[index + 1] ?? ""
      index += 1
    } else if (value === "--handoff") {
      args.handoff = path.resolve(argv[index + 1] ?? args.handoff)
      index += 1
    } else if (value === "--token") {
      args.token = argv[index + 1] ?? ""
      index += 1
    } else if (value === "--apk") {
      args.apk = path.resolve(argv[index + 1] ?? args.apk)
      index += 1
    } else if (value === "--package") {
      args.packageName = argv[index + 1] ?? args.packageName
      index += 1
    } else if (value === "--screenshot") {
      args.screenshot = path.resolve(argv[index + 1] ?? args.screenshot)
      index += 1
    } else if (value === "--wait") {
      const parsed = Number(argv[index + 1])
      args.waitSeconds = Number.isFinite(parsed) && parsed > 0 ? parsed : args.waitSeconds
      index += 1
    } else if (value === "--android-host") {
      args.androidHost = argv[index + 1] ?? ""
      index += 1
    } else if (value === "--adb-reverse") {
      args.adbReverse = true
    } else if (value === "--no-adb-reverse") {
      args.noAdbReverse = true
    } else if (value === "--no-emulator-rewrite") {
      args.noEmulatorRewrite = true
    } else if (value === "--skip-install") {
      args.skipInstall = true
    } else if (value === "--skip-preflight") {
      args.skipPreflight = true
    } else if (value === "--keep-data") {
      args.keepData = true
    } else if (value === "--replace-existing") {
      args.replaceExisting = true
    } else if (!value.startsWith("--") && !args.url) {
      args.url = value
    }
  }

  return args
}

function readHandoffUrl(filePath) {
  if (!filePath || !existsSync(filePath)) return ""
  const parsed = JSON.parse(readFileSync(filePath, "utf8"))
  const deepLink = parsed?.android?.deepLink
  const pairingUrl = parsed?.android?.pairingUrl
  const expiresAt = parsed?.pairingExpiresAt ? Date.parse(parsed.pairingExpiresAt) : NaN

  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
    throw new Error(`Desktop handoff pairing code expired: ${filePath}. Refresh the pairing code in the desktop Mobile Connection page.`)
  }

  if (typeof deepLink === "string" && deepLink.trim()) return deepLink
  if (typeof pairingUrl === "string" && pairingUrl.trim()) return pairingUrl
  return ""
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: options.encoding ?? "utf8",
    stdio: options.stdio ?? "inherit",
    windowsHide: true,
  })

  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? "unknown"}`)
  }

  return result
}

function quoteRemoteShellArgument(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function read(command, args, options = {}) {
  const result = run(command, args, {
    ...options,
    stdio: "pipe",
  })
  return {
    ok: result.status === 0,
    stderr: result.stderr?.toString() ?? "",
    stdout: result.stdout?.toString() ?? "",
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function requireConnectedDevice() {
  const devices = read("adb", ["devices"])
  const activeDevices = devices.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("List of devices"))
    .filter((line) => /\tdevice$/.test(line))

  if (!activeDevices.length) {
    throw new Error("No adb device is connected. Connect an Android device with USB debugging enabled.")
  }

  const serial = activeDevices[0]?.split(/\s+/)[0] ?? ""
  console.log(`adb device: ${serial}`)
  return {
    isEmulator: serial.startsWith("emulator-"),
    serial,
  }
}

function assertApkExists(apkPath) {
  if (!existsSync(apkPath)) {
    throw new Error(`APK not found: ${apkPath}. Build it first with corepack pnpm mobile:android:build:debug`)
  }
}

function readBridgeUrlFromConnectDeepLink(value) {
  try {
    const parsed = new URL(value.trim())
    const route = parsed.hostname || parsed.pathname.replace(/^\/+/, "")
    if (parsed.protocol !== "anybox-mobile:" || route !== "connect") return null
    return parsed.searchParams.get("url")?.trim() || null
  } catch {
    return null
  }
}

function readRelayPairingFromDeepLink(value) {
  try {
    const parsed = new URL(value.trim())
    const route = parsed.hostname || parsed.pathname.replace(/^\/+/, "")
    if (parsed.protocol !== "anybox-mobile:" || route !== "pair") return null
    const code = parsed.searchParams.get("code")?.trim() ?? ""
    const baseUrl = parsed.searchParams.get("url")?.trim() || "https://anybox.com.cn"
    return code ? { baseUrl: new URL(baseUrl).origin, code, deepLink: value.trim() } : null
  } catch {
    return null
  }
}

function readConnectionOptionsFromDeepLink(value) {
  try {
    const parsed = new URL(value.trim())
    const route = parsed.hostname || parsed.pathname.replace(/^\/+/, "")
    if (parsed.protocol !== "anybox-mobile:" || route !== "connect-options") return null

    const options = [
      parsed.searchParams.get("relay")?.trim(),
      parsed.searchParams.get("lan")?.trim(),
      parsed.searchParams.get("bridge")?.trim(),
    ].filter(Boolean)
    return options.length ? options : null
  } catch {
    return null
  }
}

function withTokenIfNeeded(rawUrl, token) {
  if (!token.trim()) return rawUrl
  const parsed = new URL(rawUrl)
  if (!parsed.searchParams.has("token") && !parsed.searchParams.has("code")) {
    parsed.searchParams.set("token", token.trim())
  }
  return parsed.toString()
}

function isLoopbackHost(hostname) {
  const normalized = hostname.toLowerCase()
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]"
}

function bridgePort(url) {
  if (url.port) return Number(url.port)
  return url.protocol === "https:" ? 443 : 80
}

function rewriteBridgeHost(rawUrl, host) {
  const parsed = new URL(rawUrl)
  parsed.hostname = host
  return parsed.toString()
}

function reverseBridgePort(port) {
  run("adb", ["reverse", `tcp:${port}`, `tcp:${port}`])
  console.log(`adb reverse: tcp:${port} -> tcp:${port}`)
}

function normalizeBridgeInput(input, token) {
  const trimmed = input.trim()
  if (!trimmed) throw new Error("Bridge URL is required. Pass --url or set MOBILE_BRIDGE_URL.")
  const connectionOptions = readConnectionOptionsFromDeepLink(trimmed)
  if (connectionOptions) {
    return normalizeBridgeInput(connectionOptions[0], token)
  }

  const relayPairing = readRelayPairingFromDeepLink(trimmed)
  if (relayPairing) {
    return {
      kind: "relay",
      baseUrl: relayPairing.baseUrl,
      code: relayPairing.code,
      bridgeUrl: relayPairing.baseUrl,
      deepLink: relayPairing.deepLink,
    }
  }

  const bridgeUrl = readBridgeUrlFromConnectDeepLink(trimmed)
  if (bridgeUrl) {
    const url = withTokenIfNeeded(bridgeUrl, token)
    return {
      kind: "bridge",
      baseUrl: new URL(url).origin,
      bridgeUrl: url,
      deepLink: `anybox-mobile://connect?url=${encodeURIComponent(url)}`,
    }
  }
  const candidate = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  const url = withTokenIfNeeded(candidate, token)
  return {
    kind: "bridge",
    baseUrl: new URL(url).origin,
    bridgeUrl: url,
    deepLink: `anybox-mobile://connect?url=${encodeURIComponent(url)}`,
  }
}

function prepareAndroidBridgeInput(bridgeInput, args, device) {
  if (bridgeInput.kind === "relay") {
    return {
      ...bridgeInput,
      deepLink: `anybox-mobile://connect?url=${encodeURIComponent(bridgeInput.deepLink)}`,
    }
  }

  const parsed = new URL(bridgeInput.bridgeUrl)
  let androidBridgeUrl = bridgeInput.bridgeUrl

  if (args.androidHost.trim()) {
    androidBridgeUrl = rewriteBridgeHost(androidBridgeUrl, args.androidHost.trim())
    console.log(`Android bridge host override: ${args.androidHost.trim()}`)
  } else if (isLoopbackHost(parsed.hostname)) {
    if (args.adbReverse) {
      reverseBridgePort(bridgePort(parsed))
    } else if (device.isEmulator && !args.noEmulatorRewrite) {
      androidBridgeUrl = rewriteBridgeHost(androidBridgeUrl, "10.0.2.2")
      console.log("Android emulator loopback rewrite: 127.0.0.1/localhost -> 10.0.2.2")
    } else if (!args.noAdbReverse) {
      reverseBridgePort(bridgePort(parsed))
    } else {
      throw new Error("The bridge URL uses localhost/127.0.0.1, which Android cannot reach directly. Use a LAN URL, --android-host, or allow adb reverse.")
    }
  }

  return {
    ...bridgeInput,
    androidBridgeUrl,
    deepLink: `anybox-mobile://connect?url=${encodeURIComponent(androidBridgeUrl)}`,
  }
}

async function preflightBridgeStatus(baseUrl) {
  let response
  try {
    response = await fetch(`${baseUrl}/api/mobile/status`, {
      headers: { accept: "application/json" },
    })
  } catch (error) {
    throw new Error(`Bridge preflight failed: ${baseUrl}/api/mobile/status is not reachable from this computer. ${error instanceof Error ? error.message : String(error)}`)
  }

  const text = await response.text()
  const value = text.trim() ? JSON.parse(text) : null
  if (!response.ok) {
    const message = value?.error?.message ?? `HTTP ${response.status}`
    throw new Error(`Bridge preflight failed: ${message}`)
  }

  const status = value?.success === true ? value.data : value
  console.log(`Bridge preflight: ${status?.online ? "online" : "unknown"} (${status?.desktopName ?? "desktop"} ${status?.appVersion ?? ""})`)
}

async function preflightRelayPairing(bridgeInput) {
  let response
  const previewUrl = new URL("/api/relay/pair/preview", bridgeInput.baseUrl)
  previewUrl.searchParams.set("code", bridgeInput.code)
  try {
    response = await fetch(previewUrl, {
      headers: { accept: "application/json" },
    })
  } catch (error) {
    throw new Error(`Relay preflight failed: ${previewUrl.origin}/api/relay/pair/preview is not reachable. ${error instanceof Error ? error.message : String(error)}`)
  }

  const text = await response.text()
  const value = text.trim() ? JSON.parse(text) : null
  if (!response.ok || value?.success !== true) {
    const message = value?.error?.message ?? `HTTP ${response.status}`
    throw new Error(`Relay preflight failed: ${message}`)
  }

  const preview = value.data
  if (!preview?.pairing?.valid) {
    throw new Error("Relay preflight failed: pairing code is expired or invalid.")
  }
  if (!preview.online) {
    throw new Error("Relay preflight failed: desktop is registered but offline.")
  }
  console.log(`Relay preflight: online (${preview.desktopName ?? "desktop"} ${preview.appVersion ?? ""})`)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function findNodeBoundsByAttribute(hierarchy, attribute, value) {
  const escapedText = escapeRegExp(value)
  const escapedAttribute = escapeRegExp(attribute)
  const pattern = new RegExp(`<node\\b(?=[^>]*\\s${escapedAttribute}="${escapedText}")[^>]*\\bbounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"[^>]*>`, "g")
  const match = pattern.exec(hierarchy)
  if (!match) return null
  return {
    left: Number(match[1]),
    top: Number(match[2]),
    right: Number(match[3]),
    bottom: Number(match[4]),
  }
}

function tapBounds(bounds) {
  const x = Math.round((bounds.left + bounds.right) / 2)
  const y = Math.round((bounds.top + bounds.bottom) / 2)
  run("adb", ["shell", "input", "tap", String(x), String(y)])
}

function tapAccessibilityLabel(hierarchy, label) {
  const bounds = findNodeBoundsByAttribute(hierarchy, "content-desc", label)
  if (!bounds) throw new Error(`Unable to find Android accessibility label: ${label}`)
  tapBounds(bounds)
}

function dumpWindowHierarchy() {
  const dumped = read("adb", ["shell", "uiautomator", "dump", remoteWindowPath], { allowFailure: true })
  if (!dumped.ok) return ""

  const hierarchy = read("adb", ["shell", "cat", remoteWindowPath], { allowFailure: true })
  run("adb", ["shell", "rm", remoteWindowPath], { allowFailure: true })
  return hierarchy.stdout
}

function visibleText(hierarchy, limit = 24) {
  return [...hierarchy.matchAll(/text="([^"]*)"/g)]
    .map((match) => match[1])
    .filter(Boolean)
    .slice(0, limit)
    .join(", ")
}

async function waitForConnectedHomeUi(packageName, timeoutSeconds, replaceExisting) {
  const deadline = Date.now() + timeoutSeconds * 1000
  let lastHierarchy = ""
  let confirmed = false
  let replaced = false

  while (Date.now() < deadline) {
    await sleep(1000)
    lastHierarchy = dumpWindowHierarchy()
    if (!lastHierarchy.includes(`package="${packageName}"`)) continue

    if (
      lastHierarchy.includes('text="Pairing failed"') ||
      lastHierarchy.includes('text="Connection failed"') ||
      lastHierarchy.includes('text="Refresh failed"')
    ) {
      throw new Error(`Android bridge pairing failed. Visible text: ${visibleText(lastHierarchy)}`)
    }

    if (lastHierarchy.includes('text="New pairing link received"')) {
      if (!replaceExisting) {
        throw new Error("App is already paired to another bridge. Re-run with --replace-existing or omit --keep-data.")
      }
      if (!replaced) {
        tapAccessibilityLabel(lastHierarchy, "Replace")
        replaced = true
      }
      continue
    }

    const confirmationAccessibilityLabel = [
      "Connect: Local network",
      "Connect: Cloud connection",
      "Connect: Direct connection",
    ].find((label) => lastHierarchy.includes(`content-desc="${label}"`))
    const legacyConfirmationLabel = [
      "Use local network",
      "Use cloud relay",
      "Confirm connection",
    ].find((label) => lastHierarchy.includes(`text="${label}"`))
    if ((confirmationAccessibilityLabel || legacyConfirmationLabel) && !confirmed) {
      const attribute = confirmationAccessibilityLabel ? "content-desc" : "text"
      const label = confirmationAccessibilityLabel ?? legacyConfirmationLabel
      const bounds = findNodeBoundsByAttribute(lastHierarchy, attribute, label)
      if (!bounds) {
        throw new Error(`Unable to find Android confirmation button: ${label}`)
      }
      tapBounds(bounds)
      confirmed = true
      continue
    }

    const hasLegacyHome = lastHierarchy.includes('text="Desktop"') && lastHierarchy.includes('text="Workspaces"')
    const hasComposerHome =
      lastHierarchy.includes('content-desc="Select model"') &&
      lastHierarchy.includes('class="android.widget.EditText"')
    const hasConnectedState =
      lastHierarchy.includes('text="Live"') ||
      lastHierarchy.includes('text="Online"')
    if ((hasLegacyHome && hasConnectedState) || hasComposerHome) return
  }

  const suffix = lastHierarchy ? ` Visible text: ${visibleText(lastHierarchy)}` : ""
  throw new Error(`Connected Home UI was not visible within ${timeoutSeconds} seconds.${suffix}`)
}

function findFatalLogLines(logcat) {
  return logcat
    .split(/\r?\n/)
    .filter((line) => fatalLogPatterns.some((pattern) => pattern.test(line)))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }

  if (!args.url.trim()) {
    args.url = readHandoffUrl(args.handoff)
    if (args.url) console.log(`Desktop handoff: ${args.handoff}`)
  }

  const bridgeInput = normalizeBridgeInput(args.url, args.token)
  if (!args.skipPreflight) {
    if (bridgeInput.kind === "relay") await preflightRelayPairing(bridgeInput)
    else await preflightBridgeStatus(bridgeInput.baseUrl)
  }
  const device = requireConnectedDevice()
  const androidBridgeInput = prepareAndroidBridgeInput(bridgeInput, args, device)
  if (!args.skipInstall) {
    assertApkExists(args.apk)
    run("adb", ["install", "-r", args.apk])
  }

  if (!args.keepData) {
    run("adb", ["shell", "pm", "clear", args.packageName])
  }

  run("adb", ["logcat", "-c"])
  run("adb", [
    "shell",
    "am",
    "start",
    "-W",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    quoteRemoteShellArgument(androidBridgeInput.deepLink),
    args.packageName,
  ])
  await waitForConnectedHomeUi(args.packageName, args.waitSeconds, args.replaceExisting)

  const pid = read("adb", ["shell", "pidof", args.packageName], { allowFailure: true }).stdout.trim()
  if (!pid) {
    throw new Error(`App process is not running after bridge smoke: ${args.packageName}`)
  }

  mkdirSync(path.dirname(args.screenshot), { recursive: true })
  run("adb", ["shell", "screencap", "-p", remoteScreenshotPath])
  run("adb", ["pull", remoteScreenshotPath, args.screenshot])
  run("adb", ["shell", "rm", remoteScreenshotPath], { allowFailure: true })

  const screenshotSize = statSync(args.screenshot).size
  if (screenshotSize < 4096) {
    throw new Error(`Screenshot looks too small to be valid: ${args.screenshot} (${screenshotSize} bytes)`)
  }

  const logcat = read("adb", ["logcat", "-d", "-t", "800"], { allowFailure: true }).stdout
  const fatalLines = findFatalLogLines(logcat)
  if (fatalLines.length) {
    console.error(fatalLines.slice(0, 40).join("\n"))
    throw new Error("Android real bridge smoke failed: fatal startup log lines were found.")
  }

  console.log(`App process: ${pid}`)
  console.log(`Screenshot: ${args.screenshot}`)
  console.log("Android real bridge smoke passed.")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
