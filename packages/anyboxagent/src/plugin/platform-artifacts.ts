import { execFile } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import z from "zod"
import * as Global from "#global/global.ts"

const execFileAsync = promisify(execFile)
const BROWSER_IPC_PROTOCOL_VERSION = 1
const OWNERSHIP_FILENAME = "ownership.json"
const CURRENT_POINTER_FILENAME = "current.json"
const PENDING_REMOVALS_DIRECTORY = ".pending-removals"

const RelativeArtifactPath = z.string().trim().min(1).refine((value) => (
  !path.isAbsolute(value)
  && !value.split(/[\\/]/u).some((segment) => segment === "..")
  && !/[\0\r\n]/u.test(value)
), "Platform artifact paths must remain inside the plugin package.")

export const PluginPlatformArtifact = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/u),
  type: z.literal("chrome-native-messaging-host"),
  hostName: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/u),
  description: z.string().trim().min(1).max(256),
  extensionIDs: z.array(
    z.string().regex(/^[a-p]{32}$/u),
  ).min(1).max(16),
  executables: z.array(z.object({
    platform: z.enum(["win32", "darwin", "linux"]),
    architecture: z.enum(["x64", "arm64"]),
    path: RelativeArtifactPath,
  }).strict()).min(1),
  runtimeConfig: z.object({
    kind: z.literal("anybox-browser-ipc"),
  }).strict().optional(),
}).strict()
export type PluginPlatformArtifact = z.infer<typeof PluginPlatformArtifact>

export const PlatformArtifactOwnershipReceipt = z.object({
  schemaVersion: z.literal(1),
  artifactID: z.string().min(1),
  type: z.literal("chrome-native-messaging-host"),
  pluginID: z.string().min(1),
  pluginVersion: z.string().min(1),
  ownershipID: z.string().uuid(),
  hostName: z.string().min(1),
  platform: z.enum(["win32", "darwin", "linux"]),
  architecture: z.enum(["x64", "arm64"]),
  managedRoot: z.string().min(1),
  executablePath: z.string().min(1),
  executableSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  currentPointerPath: z.string().min(1),
  manifestPaths: z.array(z.string().min(1)).min(1),
  runtimeConfigPath: z.string().min(1).optional(),
  ownershipPath: z.string().min(1),
  registryKeys: z.array(z.string().min(1)),
  installedAt: z.number().int().positive(),
}).strict()
export type PlatformArtifactOwnershipReceipt = z.infer<
  typeof PlatformArtifactOwnershipReceipt
>

export class PlatformArtifactError extends Error {
  constructor(
    readonly code:
      | "PLATFORM_ARTIFACT_UNSUPPORTED"
      | "PLATFORM_ARTIFACT_INVALID"
      | "PLATFORM_ARTIFACT_INSTALL_FAILED"
      | "PLATFORM_ARTIFACT_OWNERSHIP_CONFLICT",
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message)
    this.name = "PlatformArtifactError"
  }
}

type InstallOptions = {
  pluginID: string
  pluginVersion: string
  packageRoot: string
  artifacts: PluginPlatformArtifact[]
  existingReceipts?: PlatformArtifactOwnershipReceipt[]
  platform?: NodeJS.Platform
  architecture?: NodeJS.Architecture
  homeDir?: string
  dataDir?: string
  stateDir?: string
  env?: NodeJS.ProcessEnv
  now?: () => number
  run?: (file: string, args: string[]) => Promise<unknown>
  removeReplacedCurrent?: (replacedRoot: string) => Promise<void>
  copyVersionExecutable?: (
    source: string,
    destination: string,
  ) => Promise<void>
}

type RemoveOptions = {
  pluginID: string
  receipts: PlatformArtifactOwnershipReceipt[]
  dataDir?: string
  run?: (file: string, args: string[]) => Promise<unknown>
  removeManagedRoot?: (managedRoot: string) => Promise<void>
}

const PendingPlatformArtifactRemoval = z.object({
  schemaVersion: z.literal(1),
  pluginID: z.string().min(1),
  artifactID: z.string().min(1),
  ownershipID: z.string().uuid(),
  managedRoot: z.string().min(1),
  createdAt: z.number().int().positive(),
}).strict()

type PendingPlatformArtifactRemoval = z.infer<
  typeof PendingPlatformArtifactRemoval
>

const pendingCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()

function safeSegment(value: string) {
  const readable = value.toLowerCase().replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48) || "artifact"
  const suffix = createHash("sha256").update(value).digest("hex").slice(0, 12)
  return `${readable}-${suffix}`
}

function contained(root: string, candidate: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === "" || (
    !relative.startsWith("..")
    && !path.isAbsolute(relative)
  )
}

async function resolvePackageFile(packageRoot: string, relativePath: string) {
  const root = await realpath(packageRoot)
  const candidate = path.resolve(root, relativePath)
  if (!contained(root, candidate)) {
    throw new PlatformArtifactError(
      "PLATFORM_ARTIFACT_INVALID",
      "Platform artifact executable escapes the plugin package.",
    )
  }
  const resolved = await realpath(candidate).catch((cause) => {
    throw new PlatformArtifactError(
      "PLATFORM_ARTIFACT_INVALID",
      `Platform artifact executable '${relativePath}' is missing.`,
      cause,
    )
  })
  if (!contained(root, resolved) || !(await stat(resolved)).isFile()) {
    throw new PlatformArtifactError(
      "PLATFORM_ARTIFACT_INVALID",
      `Platform artifact executable '${relativePath}' is not a package file.`,
    )
  }
  return resolved
}

function nativeMessagingPaths(input: {
  platform: "win32" | "darwin" | "linux"
  homeDir: string
  hostName: string
  env: NodeJS.ProcessEnv
}) {
  const filename = `${input.hostName}.json`
  const runtimeFilename = `${input.hostName}.runtime.json`
  if (input.platform === "win32") {
    const appData = path.resolve(
      input.env.APPDATA?.trim()
        || path.join(input.homeDir, "AppData", "Roaming"),
    )
    const directory = path.join(appData, "Anybox", "native-messaging")
    return {
      manifestPaths: [path.join(directory, filename)],
      runtimeConfigPath: path.join(directory, runtimeFilename),
    }
  }
  if (input.platform === "darwin") {
    return {
      manifestPaths: [path.join(
        input.homeDir,
        "Library",
        "Application Support",
        "Google",
        "Chrome",
        "NativeMessagingHosts",
        filename,
      )],
      runtimeConfigPath: path.join(
        input.homeDir,
        "Library",
        "Application Support",
        "Anybox",
        "native-messaging",
        runtimeFilename,
      ),
    }
  }
  const configHome = path.resolve(
    input.env.XDG_CONFIG_HOME?.trim()
      || path.join(input.homeDir, ".config"),
  )
  return {
    manifestPaths: [path.join(
      configHome,
      "google-chrome",
      "NativeMessagingHosts",
      filename,
    )],
    runtimeConfigPath: path.join(
      configHome,
      "Anybox",
      "native-messaging",
      runtimeFilename,
    ),
  }
}

function endpointIdentity(homeDir: string) {
  return createHash("sha256")
    .update(path.resolve(homeDir).toLowerCase())
    .digest("hex")
    .slice(0, 16)
}

function browserRuntimeConfig(input: {
  platform: "win32" | "darwin" | "linux"
  homeDir: string
  stateDir: string
  hostName: string
  ownershipID: string
  now: number
}) {
  const identity = endpointIdentity(input.homeDir)
  const ipcDirectory = path.join(input.stateDir, "browser-ipc")
  const endpoint = (role: "runtime" | "native-host") =>
    input.platform === "win32"
      ? `\\\\.\\pipe\\anybox-browser-${role}-v${BROWSER_IPC_PROTOCOL_VERSION}-${identity}`
      : path.join(
          ipcDirectory,
          `${role}-v${BROWSER_IPC_PROTOCOL_VERSION}-${identity}.sock`,
        )
  return {
    transport: input.platform === "win32"
      ? "windows-named-pipe"
      : "unix-domain-socket",
    protocolVersion: BROWSER_IPC_PROTOCOL_VERSION,
    runtimeEndpoint: endpoint("runtime"),
    nativeHostEndpoint: endpoint("native-host"),
    bootstrapPath: path.join(
      ipcDirectory,
      `${input.hostName}.bootstrap.json`,
    ),
    ownershipID: input.ownershipID,
    updatedAt: new Date(input.now).toISOString(),
  }
}

async function sha256(filePath: string) {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex")
}

async function atomicText(filePath: string, text: string) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, text, {
    encoding: "utf8",
    mode: 0o600,
  })
  if (process.platform !== "win32") await chmod(temporaryPath, 0o600)
  await rename(temporaryPath, filePath)
}

async function atomicJson(filePath: string, value: unknown) {
  await atomicText(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function optionalText(filePath: string) {
  try {
    return await readFile(filePath, "utf8")
  } catch {
    return undefined
  }
}

async function restoreText(filePath: string, text: string | undefined) {
  if (text === undefined) {
    await rm(filePath, { force: true })
    return
  }
  await atomicText(filePath, text)
}

async function readReceipt(filePath: string) {
  try {
    return PlatformArtifactOwnershipReceipt.parse(
      JSON.parse(await readFile(filePath, "utf8")),
    )
  } catch {
    return undefined
  }
}

function sameOwner(
  receipt: PlatformArtifactOwnershipReceipt | undefined,
  input: {
    pluginID: string
    artifactID: string
    ownershipID?: string
  },
) {
  return Boolean(
    receipt
    && receipt.pluginID === input.pluginID
    && receipt.artifactID === input.artifactID
    && (
      input.ownershipID === undefined
      || receipt.ownershipID === input.ownershipID
    ),
  )
}

async function atomicCurrentExecutable(input: {
  source: string
  managedRoot: string
  executableName: string
  platform: "win32" | "darwin" | "linux"
  removeReplacedCurrent?: (replacedRoot: string) => Promise<void>
}) {
  const current = path.join(input.managedRoot, "current")
  if (input.platform === "win32") {
    let settled = false
    return {
      executablePath: input.source,
      async commit(
        deferRemoval?: (replacedRoot: string) => Promise<void>,
      ) {
        if (settled) return
        try {
          await access(current)
        } catch (error) {
          if (
            error
            && typeof error === "object"
            && "code" in error
            && String(error.code) === "ENOENT"
          ) {
            settled = true
            return
          }
          throw error
        }
        try {
          if (input.removeReplacedCurrent) {
            await input.removeReplacedCurrent(current)
          } else {
            await rm(current, { recursive: true, force: true })
          }
        } catch (error) {
          if (!deferRemoval || !isRetryableRemovalError(error)) throw error
          await deferRemoval(current)
        }
        settled = true
      },
      async rollback() {
        settled = true
      },
    }
  }

  const staging = path.join(
    input.managedRoot,
    `.current-${process.pid}-${randomUUID()}`,
  )
  const backup = path.join(
    input.managedRoot,
    `.previous-${process.pid}-${randomUUID()}`,
  )
  await mkdir(staging, { recursive: true })
  const stagedExecutable = path.join(staging, input.executableName)
  await copyFile(input.source, stagedExecutable)
  if (process.platform !== "win32") await chmod(stagedExecutable, 0o755)
  let movedCurrent = false
  try {
    await access(current)
    await rename(current, backup)
    movedCurrent = true
  } catch {
    // A first install has no current directory.
  }
  try {
    await rename(staging, current)
  } catch (cause) {
    if (movedCurrent) await rename(backup, current).catch(() => undefined)
    await rm(staging, { recursive: true, force: true })
    throw cause
  }
  let settled = false
  return {
    executablePath: path.join(current, input.executableName),
    async commit(
      deferRemoval?: (replacedRoot: string) => Promise<void>,
    ) {
      if (settled) return
      if (movedCurrent) {
        try {
          if (input.removeReplacedCurrent) {
            await input.removeReplacedCurrent(backup)
          } else {
            await rm(backup, { recursive: true, force: true })
          }
        } catch (error) {
          if (!deferRemoval || !isRetryableRemovalError(error)) throw error
          await deferRemoval(backup)
        }
      }
      settled = true
    },
    async rollback() {
      if (settled) return
      await rm(current, { recursive: true, force: true })
      if (movedCurrent) await rename(backup, current)
      settled = true
    },
  }
}

async function defaultRun(file: string, args: string[]) {
  return execFileAsync(file, args, { windowsHide: true })
}

function testPlatformRoot() {
  return process.env.ANYBOX_TEST_HOME?.trim()
}

function defaultPlatformDataDir() {
  const testRoot = testPlatformRoot()
  return testRoot ? path.join(testRoot, "platform-data") : Global.Path.data
}

function defaultPlatformStateDir() {
  const testRoot = testPlatformRoot()
  return testRoot ? path.join(testRoot, "platform-state") : Global.Path.state
}

function defaultPlatformEnvironment() {
  const testRoot = testPlatformRoot()
  if (!testRoot) return process.env
  return {
    ...process.env,
    APPDATA: path.join(testRoot, "AppData", "Roaming"),
    XDG_CONFIG_HOME: path.join(testRoot, ".config"),
  }
}

function defaultPlatformCommandRunner() {
  if (!testPlatformRoot()) return defaultRun
  return async (_file: string, args: string[]) => ({
    stdout: args[0] === "query" ? "" : undefined,
  })
}

async function defaultRemoveManagedRoot(managedRoot: string) {
  await rm(managedRoot, {
    recursive: true,
    force: true,
    maxRetries: 4,
    retryDelay: 100,
  })
}

function isRetryableRemovalError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error
    ? String(error.code)
    : ""
  return ["EACCES", "EBUSY", "ENOTEMPTY", "EPERM"].includes(code)
}

async function writePendingRemoval(
  managedBase: string,
  receipt: PlatformArtifactOwnershipReceipt,
) {
  const directory = path.join(managedBase, PENDING_REMOVALS_DIRECTORY)
  await mkdir(directory, { recursive: true })
  const id = `${safeSegment(receipt.pluginID)}-${safeSegment(receipt.artifactID)}-${randomUUID()}`
  const markerPath = path.join(directory, `${id}.json`)
  const pending = PendingPlatformArtifactRemoval.parse({
    schemaVersion: 1,
    pluginID: receipt.pluginID,
    artifactID: receipt.artifactID,
    ownershipID: receipt.ownershipID,
    managedRoot: receipt.managedRoot,
    createdAt: Date.now(),
  })
  await atomicJson(markerPath, pending)
  return { markerPath, pending }
}

async function quarantinePendingRemoval(
  managedBase: string,
  markerPath: string,
  pending: PendingPlatformArtifactRemoval,
) {
  const quarantineRoot = path.join(
    managedBase,
    PENDING_REMOVALS_DIRECTORY,
    `${safeSegment(pending.pluginID)}-${safeSegment(pending.artifactID)}-${randomUUID()}.root`,
  )
  try {
    await rename(pending.managedRoot, quarantineRoot)
    const quarantined = PendingPlatformArtifactRemoval.parse({
      ...pending,
      managedRoot: quarantineRoot,
    })
    await atomicJson(markerPath, quarantined)
    return quarantined
  } catch {
    return pending
  }
}

export async function retryPendingPlatformArtifactCleanup(input: {
  dataDir?: string
  removeManagedRoot?: (managedRoot: string) => Promise<void>
} = {}) {
  const dataDir = path.resolve(input.dataDir ?? defaultPlatformDataDir())
  const managedBase = path.join(dataDir, "platform-artifacts")
  const directory = path.join(managedBase, PENDING_REMOVALS_DIRECTORY)
  const removeManagedRoot = input.removeManagedRoot ?? defaultRemoveManagedRoot
  const removed: string[] = []
  const pending: string[] = []
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  )
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue
    const markerPath = path.join(directory, entry.name)
    let record: PendingPlatformArtifactRemoval
    try {
      record = PendingPlatformArtifactRemoval.parse(
        JSON.parse(await readFile(markerPath, "utf8")),
      )
    } catch {
      await rm(markerPath, { force: true })
      continue
    }
    if (
      !contained(managedBase, record.managedRoot)
      || path.resolve(record.managedRoot) === path.resolve(managedBase)
    ) {
      await rm(markerPath, { force: true })
      continue
    }
    try {
      await removeManagedRoot(record.managedRoot)
      await rm(markerPath, { force: true })
      removed.push(record.artifactID)
    } catch {
      pending.push(record.artifactID)
    }
  }
  await rm(directory, { recursive: false }).catch(() => undefined)
  return { removed, pending }
}

function schedulePendingPlatformArtifactCleanup(dataDir: string) {
  const key = path.resolve(dataDir)
  if (pendingCleanupTimers.has(key)) return
  const timer = setTimeout(() => {
    pendingCleanupTimers.delete(key)
    void retryPendingPlatformArtifactCleanup({ dataDir: key })
      .then((result) => {
        if (result.pending.length > 0) {
          schedulePendingPlatformArtifactCleanup(key)
        }
      })
      .catch(() => schedulePendingPlatformArtifactCleanup(key))
  }, 30_000)
  timer.unref?.()
  pendingCleanupTimers.set(key, timer)
}

export async function installPlatformArtifacts(
  rawOptions: InstallOptions,
): Promise<PlatformArtifactOwnershipReceipt[]> {
  const platform = rawOptions.platform ?? process.platform
  const architecture = rawOptions.architecture ?? process.arch
  if (
    !["win32", "darwin", "linux"].includes(platform)
    || !["x64", "arm64"].includes(architecture)
  ) {
    throw new PlatformArtifactError(
      "PLATFORM_ARTIFACT_UNSUPPORTED",
      `Platform artifacts are unsupported on ${platform}/${architecture}.`,
    )
  }
  const supportedPlatform = platform as "win32" | "darwin" | "linux"
  const supportedArchitecture = architecture as "x64" | "arm64"
  const artifacts = rawOptions.artifacts.map((artifact) =>
    PluginPlatformArtifact.parse(artifact)
  )
  const homeDir = path.resolve(rawOptions.homeDir ?? Global.Path.home)
  const dataDir = path.resolve(rawOptions.dataDir ?? defaultPlatformDataDir())
  const stateDir = path.resolve(
    rawOptions.stateDir ?? defaultPlatformStateDir(),
  )
  const env = rawOptions.env ?? defaultPlatformEnvironment()
  const run = rawOptions.run ?? defaultPlatformCommandRunner()
  const installed: PlatformArtifactOwnershipReceipt[] = []

  await retryPendingPlatformArtifactCleanup({ dataDir })

  for (const artifact of artifacts) {
    const target = artifact.executables.find((candidate) =>
      candidate.platform === supportedPlatform
      && candidate.architecture === supportedArchitecture
    )
    if (!target) {
      throw new PlatformArtifactError(
        "PLATFORM_ARTIFACT_UNSUPPORTED",
        `Artifact '${artifact.id}' has no ${platform}/${architecture} executable.`,
      )
    }
    const source = await resolvePackageFile(rawOptions.packageRoot, target.path)
    const managedRoot = path.resolve(
      dataDir,
      "platform-artifacts",
      safeSegment(rawOptions.pluginID),
      safeSegment(artifact.id),
    )
    if (!contained(path.join(dataDir, "platform-artifacts"), managedRoot)) {
      throw new PlatformArtifactError(
        "PLATFORM_ARTIFACT_INVALID",
        "Managed artifact path escaped the Anybox data directory.",
      )
    }
    const ownershipPath = path.join(managedRoot, OWNERSHIP_FILENAME)
    const diskOwner = await readReceipt(ownershipPath)
    const existing = rawOptions.existingReceipts?.find(
      (receipt) => receipt.artifactID === artifact.id,
    )
    if (
      (diskOwner || existing)
      && !sameOwner(diskOwner, {
        pluginID: rawOptions.pluginID,
        artifactID: artifact.id,
        ownershipID: existing?.ownershipID,
      })
    ) {
      throw new PlatformArtifactError(
        "PLATFORM_ARTIFACT_OWNERSHIP_CONFLICT",
        `Artifact '${artifact.id}' is not owned by this Anybox plugin installation.`,
      )
    }
    const ownershipID = existing?.ownershipID ?? diskOwner?.ownershipID
      ?? randomUUID()
    const sourceSha256 = await sha256(source)
    const versionDirectory = path.join(
      managedRoot,
      "versions",
      `${safeSegment(rawOptions.pluginVersion)}-${sourceSha256.slice(0, 12)}`,
      `${supportedPlatform}-${supportedArchitecture}`,
    )
    await mkdir(versionDirectory, { recursive: true })
    const executableName = supportedPlatform === "win32"
      ? "extension-host.exe"
      : "extension-host"
    const versionExecutable = path.join(versionDirectory, executableName)
    const installedSha256 = await sha256(versionExecutable).catch(
      () => undefined,
    )
    if (installedSha256 !== sourceSha256) {
      await (rawOptions.copyVersionExecutable ?? copyFile)(
        source,
        versionExecutable,
      )
    }
    if (supportedPlatform !== "win32") await chmod(versionExecutable, 0o755)

    const currentPointerPath = path.join(
      managedRoot,
      CURRENT_POINTER_FILENAME,
    )
    const paths = nativeMessagingPaths({
      platform: supportedPlatform,
      homeDir,
      hostName: artifact.hostName,
      env,
    })
    const runtimeConfigPath = artifact.runtimeConfig
      ? paths.runtimeConfigPath
      : undefined
    const registryKey = supportedPlatform === "win32"
      ? `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${artifact.hostName}`
      : undefined
    const rollbackPaths = [
      currentPointerPath,
      ownershipPath,
      ...paths.manifestPaths,
      ...(runtimeConfigPath ? [runtimeConfigPath] : []),
    ]
    const previousFiles = new Map(
      await Promise.all(rollbackPaths.map(async (filePath) => [
        filePath,
        await optionalText(filePath),
      ] as const)),
    )
    const previousRegistryValue = registryKey
      ? await registryValue(run, registryKey)
      : undefined
    let currentSwap: Awaited<ReturnType<typeof atomicCurrentExecutable>>
      | undefined

    try {
      currentSwap = await atomicCurrentExecutable({
        source: versionExecutable,
        managedRoot,
        executableName,
        platform: supportedPlatform,
        removeReplacedCurrent: rawOptions.removeReplacedCurrent,
      })
      await atomicJson(currentPointerPath, {
        schemaVersion: 1,
        ownershipID,
        pluginVersion: rawOptions.pluginVersion,
        target: path.relative(managedRoot, versionExecutable),
      })
      const manifest = {
        allowed_origins: artifact.extensionIDs.map(
          (extensionID) => `chrome-extension://${extensionID}/`,
        ),
        description: artifact.description,
        name: artifact.hostName,
        path: currentSwap.executablePath,
        type: "stdio",
      }
      for (const manifestPath of paths.manifestPaths) {
        await atomicJson(manifestPath, manifest)
      }
      const installedAt = rawOptions.now?.() ?? Date.now()
      if (runtimeConfigPath) {
        await atomicJson(runtimeConfigPath, browserRuntimeConfig({
          platform: supportedPlatform,
          homeDir,
          stateDir,
          hostName: artifact.hostName,
          ownershipID,
          now: installedAt,
        }))
      }
      const registryKeys: string[] = []
      if (registryKey) {
        await run("reg", [
          "add",
          registryKey,
          "/ve",
          "/t",
          "REG_SZ",
          "/d",
          paths.manifestPaths[0]!,
          "/f",
        ])
        registryKeys.push(registryKey)
      }
      const receipt = PlatformArtifactOwnershipReceipt.parse({
        schemaVersion: 1,
        artifactID: artifact.id,
        type: artifact.type,
        pluginID: rawOptions.pluginID,
        pluginVersion: rawOptions.pluginVersion,
        ownershipID,
        hostName: artifact.hostName,
        platform: supportedPlatform,
        architecture: supportedArchitecture,
        managedRoot,
        executablePath: currentSwap.executablePath,
        executableSha256: await sha256(currentSwap.executablePath),
        currentPointerPath,
        manifestPaths: paths.manifestPaths,
        runtimeConfigPath,
        ownershipPath,
        registryKeys,
        installedAt,
      })
      await atomicJson(ownershipPath, receipt)
      await currentSwap.commit(async (replacedRoot) => {
        const managedBase = path.join(dataDir, "platform-artifacts")
        await writePendingRemoval(managedBase, {
          ...receipt,
          managedRoot: replacedRoot,
        })
        schedulePendingPlatformArtifactCleanup(dataDir)
      })
      installed.push(receipt)
    } catch (cause) {
      const rollbackResults = await Promise.allSettled([
        ...(currentSwap ? [currentSwap.rollback()] : []),
        ...[...previousFiles].map(([filePath, text]) =>
          restoreText(filePath, text)
        ),
        ...(registryKey
          ? [
              previousRegistryValue
                ? run("reg", [
                    "add",
                    registryKey,
                    "/ve",
                    "/t",
                    "REG_SZ",
                    "/d",
                    previousRegistryValue,
                    "/f",
                  ])
                : run("reg", ["delete", registryKey, "/f"]).catch(
                    () => undefined,
                  ),
            ]
          : []),
      ])
      const rollbackFailures = rollbackResults
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason)
      throw new PlatformArtifactError(
        "PLATFORM_ARTIFACT_INSTALL_FAILED",
        rollbackFailures.length > 0
          ? `Failed to install platform artifact '${artifact.id}' and fully roll it back.`
          : `Failed to install platform artifact '${artifact.id}'; the previous installation was restored.`,
        rollbackFailures.length > 0 ? { cause, rollbackFailures } : cause,
      )
    }
  }
  return installed
}

async function registryValue(
  run: (file: string, args: string[]) => Promise<unknown>,
  key: string,
) {
  try {
    const result = await run("reg", ["query", key, "/ve"]) as {
      stdout?: unknown
    }
    const text = typeof result?.stdout === "string" ? result.stdout : ""
    const match = text.match(/REG_SZ\s+(.+)\s*$/mu)
    return match?.[1]?.trim()
  } catch {
    return undefined
  }
}

export async function removePlatformArtifacts(rawOptions: RemoveOptions) {
  const dataDir = path.resolve(rawOptions.dataDir ?? defaultPlatformDataDir())
  const managedBase = path.join(dataDir, "platform-artifacts")
  const run = rawOptions.run ?? defaultPlatformCommandRunner()
  const removeManagedRoot = rawOptions.removeManagedRoot
    ?? defaultRemoveManagedRoot
  const removed: string[] = []
  const skipped: Array<{ artifactID: string; reason: string }> = []
  const pending: Array<{ artifactID: string; reason: string }> = []

  await retryPendingPlatformArtifactCleanup({
    dataDir,
    removeManagedRoot,
  })

  for (const rawReceipt of rawOptions.receipts) {
    const receipt = PlatformArtifactOwnershipReceipt.parse(rawReceipt)
    const diskReceipt = await readReceipt(receipt.ownershipPath)
    if (
      receipt.pluginID !== rawOptions.pluginID
      || !sameOwner(diskReceipt, {
        pluginID: rawOptions.pluginID,
        artifactID: receipt.artifactID,
        ownershipID: receipt.ownershipID,
      })
      || !contained(managedBase, receipt.managedRoot)
    ) {
      skipped.push({
        artifactID: receipt.artifactID,
        reason: "ownership receipt mismatch",
      })
      continue
    }

    if (receipt.platform === "win32") {
      for (const key of receipt.registryKeys) {
        const current = await registryValue(run, key)
        if (
          current
          && path.resolve(current).toLowerCase()
            === path.resolve(receipt.manifestPaths[0]!).toLowerCase()
        ) {
          await run("reg", ["delete", key, "/f"])
        }
      }
    }
    for (const manifestPath of receipt.manifestPaths) {
      try {
        const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
          name?: unknown
          path?: unknown
        }
        if (
          manifest.name === receipt.hostName
          && typeof manifest.path === "string"
          && path.resolve(manifest.path) === path.resolve(receipt.executablePath)
        ) {
          await rm(manifestPath, { force: true })
        }
      } catch {
        // Missing or replaced manifests are not owned anymore.
      }
    }
    if (receipt.runtimeConfigPath) {
      try {
        const config = JSON.parse(
          await readFile(receipt.runtimeConfigPath, "utf8"),
        ) as { ownershipID?: unknown }
        if (config.ownershipID === receipt.ownershipID) {
          await rm(receipt.runtimeConfigPath, { force: true })
        }
      } catch {
        // Missing or replaced runtime config is left untouched.
      }
    }
    const deferred = await writePendingRemoval(managedBase, receipt)
    try {
      await removeManagedRoot(receipt.managedRoot)
      await rm(deferred.markerPath, { force: true })
    } catch (error) {
      if (!isRetryableRemovalError(error)) throw error
      await quarantinePendingRemoval(
        managedBase,
        deferred.markerPath,
        deferred.pending,
      )
      pending.push({
        artifactID: receipt.artifactID,
        reason: "native host files are in use; cleanup was deferred",
      })
      if (!rawOptions.removeManagedRoot) {
        schedulePendingPlatformArtifactCleanup(dataDir)
      }
    }
    removed.push(receipt.artifactID)
  }
  return { removed, skipped, pending }
}
