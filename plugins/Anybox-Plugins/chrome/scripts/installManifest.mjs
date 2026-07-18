import { execFile } from "node:child_process"
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const EXTENSION_CONFIG_FILENAME = "extension-id.json"
const RUNTIME_CONFIG_SUFFIX = ".runtime.json"

const platformDirectories = {
  darwin: "macos",
  linux: "linux",
  win32: "windows",
}

const architectureDirectories = {
  arm64: "arm64",
  x64: "x64",
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${label}.`)
  }
  return value.trim()
}

function isLoopbackHostname(hostname) {
  const normalized = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname
  if (normalized.toLowerCase() === "localhost" || normalized === "::1") return true

  const octets = normalized.split(".")
  return octets.length === 4
    && octets[0] === "127"
    && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
}

function normalizeAgentBaseURL(value) {
  const normalized = requiredString(value, "Anybox Agent base URL").replace(/\/+$/, "")
  const parsed = new URL(normalized)
  if (parsed.protocol !== "http:") {
    throw new Error(`Anybox Agent base URL must use local HTTP: ${normalized}`)
  }
  if (!isLoopbackHostname(parsed.hostname)) {
    throw new Error(`Anybox Agent base URL must use a loopback host: ${normalized}`)
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Anybox Agent base URL cannot contain credentials, query, or fragment.")
  }
  return parsed.toString().replace(/\/+$/, "")
}

export function resolveAgentBaseURL(env = process.env) {
  const explicit = env.ANYBOX_AGENT_BASE_URL?.trim()
  if (explicit) return normalizeAgentBaseURL(explicit)

  const host = env.ANYBOX_SERVER_HOST?.trim() || "127.0.0.1"
  const port = env.ANYBOX_SERVER_PORT?.trim() || "4096"
  return normalizeAgentBaseURL(`http://${host}:${port}`)
}

export function resolveBrowserTransportToken(env = process.env) {
  const token = requiredString(
    env.ANYBOX_BROWSER_TRANSPORT_TOKEN,
    "Anybox browser transport token",
  )
  if (/[\r\n]/.test(token)) {
    throw new Error("Anybox browser transport token must be a single line.")
  }
  return token
}

export function resolveBundledExtensionHost(
  pluginRoot,
  platform = process.platform,
  architecture = process.arch,
) {
  const platformDirectory = platformDirectories[platform]
  const architectureDirectory = architectureDirectories[architecture]
  if (!platformDirectory || !architectureDirectory) {
    throw new Error(`Unsupported Native Messaging Host target: ${platform}/${architecture}`)
  }

  const executableName = platform === "win32" ? "extension-host.exe" : "extension-host"
  return path.resolve(
    pluginRoot,
    "extension-host",
    platformDirectory,
    architectureDirectory,
    executableName,
  )
}

export function nativeMessagingManifest(input) {
  return {
    allowed_origins: [`chrome-extension://${requiredString(input.extensionId, "extension ID")}/`],
    description: "Anybox Chrome Native Messaging Host",
    name: requiredString(input.extensionHostName, "extension host name"),
    path: path.resolve(requiredString(input.extensionHostPath, "extension host path")),
    type: "stdio",
  }
}

export function resolveNativeMessagingPaths(input) {
  const hostName = requiredString(input.extensionHostName, "extension host name")
  const filename = `${hostName}.json`
  const runtimeFilename = `${hostName}${RUNTIME_CONFIG_SUFFIX}`
  const homeDir = path.resolve(input.homeDir)
  const env = input.env ?? process.env

  if (input.platform === "win32") {
    const appData = path.resolve(
      env.APPDATA?.trim() || path.join(homeDir, "AppData", "Roaming"),
    )
    const nativeMessagingDirectory = path.join(appData, "Anybox", "native-messaging")
    return {
      manifestPaths: [path.join(nativeMessagingDirectory, filename)],
      runtimeConfigPath: path.join(nativeMessagingDirectory, runtimeFilename),
    }
  }

  if (input.platform === "darwin") {
    return {
      manifestPaths: [
        path.join(
          homeDir,
          "Library",
          "Application Support",
          "Google",
          "Chrome",
          "NativeMessagingHosts",
          filename,
        ),
      ],
      runtimeConfigPath: path.join(
        homeDir,
        "Library",
        "Application Support",
        "Anybox",
        "native-messaging",
        runtimeFilename,
      ),
    }
  }

  if (input.platform === "linux") {
    const configHome = path.resolve(
      env.XDG_CONFIG_HOME?.trim() || path.join(homeDir, ".config"),
    )
    return {
      manifestPaths: [
        path.join(configHome, "google-chrome", "NativeMessagingHosts", filename),
      ],
      runtimeConfigPath: path.join(
        configHome,
        "Anybox",
        "native-messaging",
        runtimeFilename,
      ),
    }
  }

  throw new Error(`Unsupported Native Messaging Host platform: ${input.platform}`)
}

async function readExtensionConfig(pluginRoot) {
  const configPath = path.join(pluginRoot, "scripts", EXTENSION_CONFIG_FILENAME)
  const parsed = JSON.parse(await readFile(configPath, "utf8"))
  return {
    extensionId: requiredString(parsed.extensionId, "extension ID"),
    extensionHostName: requiredString(parsed.extensionHostName, "extension host name"),
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

async function registerWindowsHost({ extensionHostName, manifestPath }) {
  const registryKey = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${extensionHostName}`
  await execFileAsync(
    "reg",
    ["add", registryKey, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"],
    { windowsHide: true },
  )
  return registryKey
}

export async function install(options = {}) {
  const env = options.env ?? process.env
  if (env.ANYBOX_BROWSER_NATIVE_INSTALL?.trim().toLowerCase() === "off") {
    return { skipped: true }
  }

  const platform = options.platform ?? process.platform
  const architecture = options.architecture ?? process.arch
  const homeDir = options.homeDir ?? os.homedir()
  const pluginRoot = path.resolve(
    options.pluginRoot ?? path.join(import.meta.dirname, ".."),
  )
  const extensionConfig = await readExtensionConfig(pluginRoot)
  const extensionId = env.ANYBOX_BROWSER_EXTENSION_ID?.trim() || extensionConfig.extensionId
  const extensionHostPath = resolveBundledExtensionHost(pluginRoot, platform, architecture)
  await access(extensionHostPath)
  if (platform !== "win32") await chmod(extensionHostPath, 0o755)

  const paths = resolveNativeMessagingPaths({
    env,
    extensionHostName: extensionConfig.extensionHostName,
    homeDir,
    platform,
  })
  const manifest = nativeMessagingManifest({
    extensionHostName: extensionConfig.extensionHostName,
    extensionHostPath,
    extensionId,
  })
  const runtimeConfig = {
    agentBaseURL: resolveAgentBaseURL(env),
    browserTransportToken: resolveBrowserTransportToken(env),
    updatedAt: new Date().toISOString(),
  }

  await Promise.all(paths.manifestPaths.map((manifestPath) => writeJson(manifestPath, manifest)))
  await writeJson(paths.runtimeConfigPath, runtimeConfig)
  if (platform !== "win32") await chmod(paths.runtimeConfigPath, 0o600)

  let registryKey
  if (platform === "win32") {
    const register = options.registerWindowsHost ?? registerWindowsHost
    registryKey = await register({
      extensionHostName: extensionConfig.extensionHostName,
      manifestPath: paths.manifestPaths[0],
    })
  }

  return {
    extensionHostPath,
    extensionId,
    manifestPaths: paths.manifestPaths,
    registryKey,
    runtimeConfigPath: paths.runtimeConfigPath,
  }
}
