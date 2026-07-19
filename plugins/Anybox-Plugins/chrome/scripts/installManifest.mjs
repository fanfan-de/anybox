import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const EXTENSION_CONFIG_FILENAME = "extension-id.json"
const RUNTIME_CONFIG_SUFFIX = ".runtime.json"
export const BROWSER_IPC_PROTOCOL_VERSION = 1

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

function endpointIdentity(homeDir) {
  return createHash("sha256")
    .update(path.resolve(homeDir).toLowerCase())
    .digest("hex")
    .slice(0, 16)
}

function defaultIpcStateDirectory(homeDir, env) {
  const managedAgentDataDir = env.ANYBOX_AGENT_DATA_DIR?.trim()
  if (managedAgentDataDir) {
    return path.join(path.resolve(managedAgentDataDir), "state", "browser-ipc")
  }
  const stateHome = env.XDG_STATE_HOME?.trim()
    ? path.resolve(env.XDG_STATE_HOME)
    : path.join(path.resolve(homeDir), ".local", "state")
  return path.join(stateHome, "anybox", "browser-ipc")
}

function normalizeIpcEndpoint(value, label, platform) {
  const endpoint = requiredString(value, label)
  if (/[\r\n\0]/.test(endpoint)) {
    throw new Error(`${label} contains an invalid character.`)
  }
  if (platform === "win32") {
    if (!endpoint.startsWith("\\\\.\\pipe\\")) {
      throw new Error(`${label} must be a Windows Named Pipe path.`)
    }
    return endpoint
  }
  if (!path.isAbsolute(endpoint)) {
    throw new Error(`${label} must be an absolute Unix Domain Socket path.`)
  }
  return path.resolve(endpoint)
}

export function resolveBrowserIpcRuntimeConfig(input = {}) {
  const env = input.env ?? process.env
  const platform = input.platform ?? process.platform
  if (!["win32", "darwin", "linux"].includes(platform)) {
    throw new Error(`Unsupported Browser IPC platform: ${platform}`)
  }
  const homeDir = path.resolve(input.homeDir ?? os.homedir())
  const identity = endpointIdentity(homeDir)
  const ipcDirectory = defaultIpcStateDirectory(homeDir, env)
  const transport = platform === "win32"
    ? "windows-named-pipe"
    : "unix-domain-socket"
  const defaultEndpoint = (role) => platform === "win32"
    ? `\\\\.\\pipe\\anybox-browser-${role}-v${BROWSER_IPC_PROTOCOL_VERSION}-${identity}`
    : path.join(
        ipcDirectory,
        `${role}-v${BROWSER_IPC_PROTOCOL_VERSION}-${identity}.sock`,
      )
  const runtimeEndpoint = normalizeIpcEndpoint(
    env.ANYBOX_BROWSER_IPC_RUNTIME_ENDPOINT || defaultEndpoint("runtime"),
    "Anybox Browser Runtime IPC endpoint",
    platform,
  )
  const nativeHostEndpoint = normalizeIpcEndpoint(
    env.ANYBOX_BROWSER_IPC_NATIVE_ENDPOINT || defaultEndpoint("native-host"),
    "Anybox Browser Native Host IPC endpoint",
    platform,
  )
  const bootstrapPath = path.resolve(
    env.ANYBOX_BROWSER_IPC_BOOTSTRAP_PATH
      || path.join(ipcDirectory, `${input.extensionHostName || "com.anybox.browser"}.bootstrap.json`),
  )

  return {
    transport,
    protocolVersion: BROWSER_IPC_PROTOCOL_VERSION,
    runtimeEndpoint,
    nativeHostEndpoint,
    bootstrapPath,
  }
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
    ...resolveBrowserIpcRuntimeConfig({
      env,
      extensionHostName: extensionConfig.extensionHostName,
      homeDir,
      platform,
    }),
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
