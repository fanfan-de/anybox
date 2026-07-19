import { execFile } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const EXTENSION_CONFIG_FILENAME = "extension-id.json"
const RUNTIME_CONFIG_SUFFIX = ".runtime.json"
const OWNERSHIP_FILENAME = "ownership.json"
const CURRENT_POINTER_FILENAME = "current.json"
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

function defaultManagedDataDirectory(homeDir, env) {
  const managedAgentDataDir = env.ANYBOX_AGENT_DATA_DIR?.trim()
  if (managedAgentDataDir) {
    return path.join(path.resolve(managedAgentDataDir), "data")
  }
  const dataHome = env.XDG_DATA_HOME?.trim()
    ? path.resolve(env.XDG_DATA_HOME)
    : path.join(path.resolve(homeDir), ".local", "share")
  return path.join(dataHome, "anybox")
}

function safeSegment(value) {
  const readable = value.toLowerCase().replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48) || "artifact"
  const suffix = createHash("sha256").update(value).digest("hex").slice(0, 12)
  return `${readable}-${suffix}`
}

async function sha256(filePath) {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex")
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

async function readPluginVersion(pluginRoot, executableHash) {
  try {
    const parsed = JSON.parse(
      await readFile(
        path.join(pluginRoot, ".anybox-plugin", "plugin.json"),
        "utf8",
      ),
    )
    return requiredString(parsed.version, "plugin version")
  } catch {
    return `host-${executableHash.slice(0, 12)}`
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"))
  } catch {
    return undefined
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(
    temporaryPath,
    `${JSON.stringify(value, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  )
  if (process.platform !== "win32") await chmod(temporaryPath, 0o600)
  await rename(temporaryPath, filePath)
}

async function installManagedExecutable(input) {
  const executableName = input.platform === "win32"
    ? "extension-host.exe"
    : "extension-host"
  const versionDirectory = path.join(
    input.managedRoot,
    "versions",
    safeSegment(input.version),
    `${input.platform}-${input.architecture}`,
  )
  await mkdir(versionDirectory, { recursive: true })
  const versionExecutable = path.join(versionDirectory, executableName)
  await copyFile(input.source, versionExecutable)
  if (input.platform !== "win32") await chmod(versionExecutable, 0o755)

  const currentDirectory = path.join(input.managedRoot, "current")
  const stagingDirectory = path.join(
    input.managedRoot,
    `.current-${process.pid}-${randomUUID()}`,
  )
  const backupDirectory = path.join(
    input.managedRoot,
    `.previous-${process.pid}-${randomUUID()}`,
  )
  await mkdir(stagingDirectory, { recursive: true })
  const stagedExecutable = path.join(stagingDirectory, executableName)
  await copyFile(versionExecutable, stagedExecutable)
  if (input.platform !== "win32") await chmod(stagedExecutable, 0o755)

  let movedCurrent = false
  try {
    await access(currentDirectory)
    await rename(currentDirectory, backupDirectory)
    movedCurrent = true
  } catch {
    // A first installation has no current directory.
  }
  try {
    await rename(stagingDirectory, currentDirectory)
  } catch (error) {
    if (movedCurrent) {
      await rename(backupDirectory, currentDirectory).catch(() => undefined)
    }
    await rm(stagingDirectory, { recursive: true, force: true })
    throw error
  }
  if (movedCurrent) {
    await rm(backupDirectory, { recursive: true, force: true })
  }

  return {
    executablePath: path.join(currentDirectory, executableName),
    versionExecutable,
  }
}

async function validManagedBinding(input) {
  const manifest = await readJson(input.manifestPath)
  const runtimeConfig = await readJson(input.runtimeConfigPath)
  if (
    manifest?.name !== input.hostName
    || manifest?.type !== "stdio"
    || !Array.isArray(manifest.allowed_origins)
    || !manifest.allowed_origins.includes(
      `chrome-extension://${input.extensionId}/`,
    )
    || typeof manifest.path !== "string"
    || !path.resolve(manifest.path).startsWith(
      `${path.resolve(input.managedRoot)}${path.sep}`,
    )
    || runtimeConfig?.transport !== input.runtimeConfig.transport
    || runtimeConfig?.protocolVersion !== input.runtimeConfig.protocolVersion
    || runtimeConfig?.runtimeEndpoint !== input.runtimeConfig.runtimeEndpoint
    || runtimeConfig?.nativeHostEndpoint
      !== input.runtimeConfig.nativeHostEndpoint
    || runtimeConfig?.bootstrapPath !== input.runtimeConfig.bootstrapPath
  ) {
    return undefined
  }
  try {
    await access(path.resolve(manifest.path))
    return {
      executablePath: path.resolve(manifest.path),
      ownershipID: typeof runtimeConfig.ownershipID === "string"
        ? runtimeConfig.ownershipID
        : undefined,
    }
  } catch {
    return undefined
  }
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
  const bundledExtensionHostPath = resolveBundledExtensionHost(
    pluginRoot,
    platform,
    architecture,
  )
  await access(bundledExtensionHostPath)

  const paths = resolveNativeMessagingPaths({
    env,
    extensionHostName: extensionConfig.extensionHostName,
    homeDir,
    platform,
  })
  const runtimeConfigBase = {
    ...resolveBrowserIpcRuntimeConfig({
      env,
      extensionHostName: extensionConfig.extensionHostName,
      homeDir,
      platform,
    }),
  }
  const dataDir = path.resolve(
    options.dataDir ?? defaultManagedDataDirectory(homeDir, env),
  )
  const managedRoot = path.join(
    dataDir,
    "platform-artifacts",
    safeSegment("chrome"),
    safeSegment("chrome-native-host"),
  )
  const existing = await validManagedBinding({
    extensionId,
    hostName: extensionConfig.extensionHostName,
    managedRoot,
    manifestPath: paths.manifestPaths[0],
    runtimeConfig: runtimeConfigBase,
    runtimeConfigPath: paths.runtimeConfigPath,
  })
  if (existing) {
    let registryKey
    if (platform === "win32") {
      const register = options.registerWindowsHost ?? registerWindowsHost
      registryKey = await register({
        extensionHostName: extensionConfig.extensionHostName,
        manifestPath: paths.manifestPaths[0],
      })
    }
    return {
      extensionHostPath: existing.executablePath,
      extensionId,
      managedRoot,
      manifestPaths: paths.manifestPaths,
      registryKey,
      reused: true,
      runtimeConfigPath: paths.runtimeConfigPath,
    }
  }

  const executableHash = await sha256(bundledExtensionHostPath)
  const pluginVersion = await readPluginVersion(pluginRoot, executableHash)
  const ownershipPath = path.join(managedRoot, OWNERSHIP_FILENAME)
  const previousOwnership = await readJson(ownershipPath)
  const ownershipID =
    previousOwnership?.pluginID === "chrome"
      && previousOwnership?.artifactID === "chrome-native-host"
      && typeof previousOwnership?.ownershipID === "string"
      ? previousOwnership.ownershipID
      : randomUUID()
  const { executablePath: extensionHostPath, versionExecutable } =
    await installManagedExecutable({
      architecture,
      managedRoot,
      platform,
      source: bundledExtensionHostPath,
      version: pluginVersion,
    })
  const currentPointerPath = path.join(managedRoot, CURRENT_POINTER_FILENAME)
  await writeJson(currentPointerPath, {
    schemaVersion: 1,
    ownershipID,
    pluginVersion,
    target: path.relative(managedRoot, versionExecutable),
  })
  const manifest = nativeMessagingManifest({
    extensionHostName: extensionConfig.extensionHostName,
    extensionHostPath,
    extensionId,
  })
  const installedAt = Date.now()
  const runtimeConfig = {
    ...runtimeConfigBase,
    ownershipID,
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

  await writeJson(ownershipPath, {
    schemaVersion: 1,
    artifactID: "chrome-native-host",
    type: "chrome-native-messaging-host",
    pluginID: "chrome",
    pluginVersion,
    ownershipID,
    hostName: extensionConfig.extensionHostName,
    platform,
    architecture,
    managedRoot,
    executablePath: extensionHostPath,
    executableSha256: await sha256(extensionHostPath),
    currentPointerPath,
    manifestPaths: paths.manifestPaths,
    runtimeConfigPath: paths.runtimeConfigPath,
    ownershipPath,
    registryKeys: registryKey ? [registryKey] : [],
    installedAt,
  })

  return {
    extensionHostPath,
    extensionId,
    managedRoot,
    manifestPaths: paths.manifestPaths,
    registryKey,
    runtimeConfigPath: paths.runtimeConfigPath,
  }
}
