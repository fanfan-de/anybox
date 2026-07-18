import { app } from "electron"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import { readTrimmedDesktopEnv } from "./env-compat"
import { safeError, safeLog } from "./safe-console"

export const BROWSER_NATIVE_HOST_NAME = "com.anybox.browser"
export const DEFAULT_BROWSER_EXTENSION_ID = "hjbejdmgpifdjjlpgmdfmbmbhkedgnjc"
export const BROWSER_NATIVE_RUNTIME_CONFIG_FILENAME = `${BROWSER_NATIVE_HOST_NAME}.runtime.json`

const EXTENSION_ID_ENV = "ANYBOX_BROWSER_EXTENSION_ID"
const AGENT_RUNTIME_ENV = "ANYBOX_AGENT_RUNTIME_DIR"
const AGENT_BASE_URL_ENV = "ANYBOX_AGENT_BASE_URL"
const nativeHostExecutableName = process.platform === "win32"
  ? "anybox-chrome-native-host.exe"
  : "anybox-chrome-native-host"

export function browserNativeMessagingRegistryKey(hostName = BROWSER_NATIVE_HOST_NAME) {
  return `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${hostName}`
}

export function browserNativeMessagingManifest(input: {
  hostPath: string
  extensionID?: string
  hostName?: string
}) {
  const hostName = input.hostName ?? BROWSER_NATIVE_HOST_NAME
  const extensionID = input.extensionID || DEFAULT_BROWSER_EXTENSION_ID
  return {
    name: hostName,
    description: "Anybox Chrome Native Messaging Host",
    path: input.hostPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionID}/`],
  }
}

function resolveRuntimeRoot() {
  const explicit = readTrimmedDesktopEnv(AGENT_RUNTIME_ENV)
  if (explicit) return explicit
  if (app.isPackaged) return path.join(process.resourcesPath, "agent")
  return path.join(app.getAppPath(), "build", "agent-runtime")
}

export function resolveBrowserNativeHostExecutable() {
  return path.join(resolveRuntimeRoot(), "native-host", nativeHostExecutableName)
}

function resolveManifestPath() {
  return path.join(resolveNativeMessagingDirectory(), `${BROWSER_NATIVE_HOST_NAME}.json`)
}

function resolveNativeMessagingDirectory() {
  return path.join(app.getPath("userData"), "native-messaging")
}

export function resolveBrowserNativeMessagingRuntimeConfigPath() {
  return path.join(resolveNativeMessagingDirectory(), BROWSER_NATIVE_RUNTIME_CONFIG_FILENAME)
}

function normalizeAgentBaseURL(value: string) {
  const trimmed = value.trim()
  const url = new URL(trimmed)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Browser native messaging agent URL must use http or https: ${trimmed}`)
  }
  return url.toString().replace(/\/+$/, "")
}

export function browserNativeMessagingRuntimeConfig(input: { agentBaseURL: string }) {
  return {
    agentBaseURL: normalizeAgentBaseURL(input.agentBaseURL),
    updatedAt: new Date().toISOString(),
  }
}

export async function writeBrowserNativeMessagingRuntimeConfig(agentBaseURL: string) {
  const configPath = resolveBrowserNativeMessagingRuntimeConfigPath()
  const config = browserNativeMessagingRuntimeConfig({ agentBaseURL })
  await fsp.mkdir(path.dirname(configPath), { recursive: true })
  await fsp.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8")
  safeLog(`[desktop][browser-native] wrote runtime config at ${configPath}`)
  return { configPath, config }
}

export async function registerBrowserNativeMessagingHost(options: { agentBaseURL?: string } = {}) {
  if (process.platform !== "win32") return undefined

  const hostPath = resolveBrowserNativeHostExecutable()
  if (!fs.existsSync(hostPath)) {
    safeLog(`[desktop][browser-native] native host not found at ${hostPath}`)
    return undefined
  }

  const extensionID = readTrimmedDesktopEnv(EXTENSION_ID_ENV) || DEFAULT_BROWSER_EXTENSION_ID
  const manifestPath = resolveManifestPath()
  const manifest = browserNativeMessagingManifest({ hostPath, extensionID })
  await fsp.mkdir(path.dirname(manifestPath), { recursive: true })
  await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")

  const agentBaseURL = options.agentBaseURL || readTrimmedDesktopEnv(AGENT_BASE_URL_ENV)
  if (agentBaseURL) {
    await writeBrowserNativeMessagingRuntimeConfig(agentBaseURL).catch((error) => {
      safeError("[desktop][browser-native] failed to write runtime config", error)
    })
  }

  const result = spawnSync("reg", [
    "add",
    browserNativeMessagingRegistryKey(),
    "/ve",
    "/t",
    "REG_SZ",
    "/d",
    manifestPath,
    "/f",
  ], {
    encoding: "utf8",
    windowsHide: true,
  })

  if (result.status !== 0) {
    safeError("[desktop][browser-native] failed to register native messaging host", result.stderr || result.stdout)
    return undefined
  }

  safeLog(`[desktop][browser-native] registered ${BROWSER_NATIVE_HOST_NAME} at ${manifestPath}`)
  return { manifestPath, hostPath, extensionID }
}
