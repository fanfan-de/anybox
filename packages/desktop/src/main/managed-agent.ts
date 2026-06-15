import { app } from "electron"
import { createPlatformAdapter, getBundledBunName } from "@anybox/platform"
import { spawn, spawnSync, type ChildProcessByStdio } from "node:child_process"
import fs from "node:fs"
import fsp from "node:fs/promises"
import net from "node:net"
import path from "node:path"
import type { Readable } from "node:stream"
import { setTimeout as delay } from "node:timers/promises"
import { readTrimmedDesktopEnv } from "./env-compat"
import { AGENT_WORKDIR_ENV, resolveDefaultAgentWorkdir } from "./agent-workdir"
import { writeBrowserNativeMessagingRuntimeConfig } from "./browser-native-messaging"
import { safeError, safeLog } from "./safe-console"
import { createSourceRuntimeSnapshot, shouldRestartForSourceRuntimeChange, type SourceRuntimeSnapshot } from "./source-runtime-watch"

const MANAGED_AGENT_BASE_URL_ENV = "ANYBOX_AGENT_BASE_URL"
const MANAGED_AGENT_DISABLE_ENV = "ANYBOX_DISABLE_MANAGED_AGENT"
const MANAGED_AGENT_RUNTIME_ENV = "ANYBOX_AGENT_RUNTIME_DIR"
const MANAGED_AGENT_BUN_BINARY_ENV = "ANYBOX_BUN_BINARY"
const MANAGED_AGENT_DATA_DIR_ENV = "ANYBOX_AGENT_DATA_DIR"
const CONNECTOR_BUILD_CONFIG_ENV = "ANYBOX_CONNECTOR_BUILD_CONFIG"
const WORKSPACE_DEPENDENCIES_DIR_ENV = "ANYBOX_WORKSPACE_DEPENDENCIES_DIR"
const WORKSPACE_DEPENDENCIES_VERSION_ENV = "ANYBOX_WORKSPACE_DEPENDENCIES_VERSION"
const MANAGED_AGENT_PLUGIN_INSTALL_DIR_ENV_KEYS = [
  "ANYBOX_PLUGIN_INSTALL_DIR",
]

const BUNDLED_AGENT_ENTRYPOINT = "agent-server.js"
const BUNDLED_BUN_BINARY = getBundledBunName()
const platformAdapter = createPlatformAdapter({ platform: process.platform })

interface ManagedAgentProcess {
  readonly baseURL: string
  readonly child: ChildProcessByStdio<null, Readable, Readable>
  readonly port: number
  readonly sourceRuntime: boolean
}

interface ManagedAgentLaunchSpec {
  readonly label: string
  readonly command: string
  readonly args: string[]
  readonly dependenciesDir?: string
  readonly runtimeDir?: string
  readonly sourceRuntime: boolean
}

type ManagedAgentProxyEnv = Partial<
  Pick<NodeJS.ProcessEnv, "HTTP_PROXY" | "HTTPS_PROXY" | "ALL_PROXY" | "http_proxy" | "https_proxy" | "all_proxy">
>

let managedAgent: ManagedAgentProcess | undefined
let sourceRuntimeWatcher: fs.FSWatcher | undefined
let sourceRuntimeRestartTimer: ReturnType<typeof setTimeout> | undefined
let sourceRuntimeRestartPromise: Promise<void> | undefined
let sourceRuntimeSnapshot: SourceRuntimeSnapshot | undefined

function log(message: string, ...details: unknown[]) {
  safeLog("[desktop][agent]", message, ...details)
}

function logError(message: string, error: unknown) {
  safeError("[desktop][agent]", message, error)
}

async function publishBrowserNativeAgentBaseURL(baseURL: string) {
  try {
    await writeBrowserNativeMessagingRuntimeConfig(baseURL)
  } catch (error) {
    logError("failed to publish browser native messaging runtime config", error)
  }
}

function resolveBundledRuntimeCandidates() {
  const candidates = []
  const explicitRuntime = readTrimmedDesktopEnv(MANAGED_AGENT_RUNTIME_ENV)
  if (explicitRuntime) candidates.push(explicitRuntime)

  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, "agent"))
  } else {
    candidates.push(path.join(app.getAppPath(), "build", "agent-runtime"))
  }

  return candidates
}

function resolveSystemBunBinary() {
  const explicitBinary = readTrimmedDesktopEnv(MANAGED_AGENT_BUN_BINARY_ENV)
  if (explicitBinary && fs.existsSync(explicitBinary)) {
    return explicitBinary
  }

  const probe = spawnSync("bun", ["--print", "process.execPath"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    windowsHide: true,
  })
  const probedPath = probe.stdout?.trim()
  if (probe.status === 0 && probedPath && fs.existsSync(probedPath)) {
    return probedPath
  }

  const candidates = [
    process.env.APPDATA
      ? path.join(process.env.APPDATA, "npm", "node_modules", "bun", "bin", BUNDLED_BUN_BINARY)
      : undefined,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, ".bun", "bin", BUNDLED_BUN_BINARY) : undefined,
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate
    }
  }

  return undefined
}

function resolveSourceAgentLaunchSpec() {
  if (app.isPackaged) return undefined

  const desktopAppPath = app.getAppPath()
  const repoRoot = path.resolve(desktopAppPath, "..", "..")
  const entrypoint = path.join(repoRoot, "packages", "anyboxagent", "src", "server", "start.ts")
  if (!fs.existsSync(entrypoint)) {
    return undefined
  }

  const bunBinary = resolveSystemBunBinary()
  if (!bunBinary) {
    return undefined
  }

  return {
    label: `source runtime (${entrypoint})`,
    command: bunBinary,
    args: ["run", entrypoint],
    dependenciesDir: path.join(desktopAppPath, "build", "agent-runtime", "dependencies"),
    runtimeDir: path.join(desktopAppPath, "build", "agent-runtime"),
    sourceRuntime: true,
  } satisfies ManagedAgentLaunchSpec
}

function resolveBundledAgentLaunchSpecs() {
  const specs: ManagedAgentLaunchSpec[] = []

  for (const candidate of resolveBundledRuntimeCandidates()) {
    const bunBinary = path.join(candidate, BUNDLED_BUN_BINARY)
    const entrypoint = path.join(candidate, BUNDLED_AGENT_ENTRYPOINT)
    if (fs.existsSync(bunBinary) && fs.existsSync(entrypoint)) {
      specs.push({
        label: `bundled runtime (${candidate})`,
        command: bunBinary,
        args: [entrypoint],
        dependenciesDir: path.join(candidate, "dependencies"),
        runtimeDir: candidate,
        sourceRuntime: false,
      })
    }
  }

  return specs
}

function resolveManagedAgentLaunchSpecs() {
  const specs: ManagedAgentLaunchSpec[] = []
  const sourceSpec = resolveSourceAgentLaunchSpec()
  if (sourceSpec) specs.push(sourceSpec)

  specs.push(...resolveBundledAgentLaunchSpecs())
  return specs
}

export function resolveManagedAgentDataDir() {
  return path.join(app.getPath("userData"), "agent")
}

function readWorkspaceDependenciesBundleVersion(dependenciesDir: string | undefined) {
  if (!dependenciesDir) return undefined

  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dependenciesDir, "manifest.json"), "utf8")) as {
      bundleVersion?: unknown
    }
    if (typeof manifest.bundleVersion === "string" && manifest.bundleVersion.trim()) {
      return manifest.bundleVersion.trim()
    }
    if (typeof manifest.bundleVersion === "number") {
      return String(manifest.bundleVersion)
    }
  } catch {
    // Source runtimes may not have prepared dependencies yet.
  }

  return undefined
}

function proxyURLFromElectronProxyRule(rule: string) {
  const trimmed = rule.trim()
  if (!trimmed || /^DIRECT$/i.test(trimmed)) return undefined

  const [scheme, hostPort] = trimmed.split(/\s+/, 2)
  if (!scheme || !hostPort) return undefined

  switch (scheme.toUpperCase()) {
    case "PROXY":
    case "HTTPS":
      return `http://${hostPort}`
    default:
      return undefined
  }
}

async function resolveManagedAgentProxyEnv(targetURL = "https://anybox.com.cn"): Promise<ManagedAgentProxyEnv> {
  if (
    process.env.HTTPS_PROXY?.trim() ||
    process.env.HTTP_PROXY?.trim() ||
    process.env.ALL_PROXY?.trim() ||
    process.env.https_proxy?.trim() ||
    process.env.http_proxy?.trim() ||
    process.env.all_proxy?.trim()
  ) {
    return {}
  }

  try {
    const electron = await import("electron")
    const proxyRules = await electron.session.defaultSession.resolveProxy(targetURL)
    const proxyURL = proxyRules
      .split(";")
      .map(proxyURLFromElectronProxyRule)
      .find((value): value is string => Boolean(value))
    if (!proxyURL) return {}

    return {
      HTTP_PROXY: proxyURL,
      HTTPS_PROXY: proxyURL,
    }
  } catch (error) {
    logError("failed to resolve system proxy for managed agent", error)
    return {}
  }
}

function buildManagedAgentStartEnv(
  spec: ManagedAgentLaunchSpec,
  port: number,
  dataDir?: string,
  proxyEnv: ManagedAgentProxyEnv = {},
): NodeJS.ProcessEnv {
  const startEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...proxyEnv,
    ANYBOX_NODE_BINARY: process.execPath,
    ANYBOX_NODE_RUN_AS_NODE: "1",
    ANYBOX_SERVER_HOST: "127.0.0.1",
    ANYBOX_SERVER_PORT: String(port),
  }

  for (const key of MANAGED_AGENT_PLUGIN_INSTALL_DIR_ENV_KEYS) {
    delete startEnv[key]
  }

  if (spec.dependenciesDir) {
    startEnv[WORKSPACE_DEPENDENCIES_DIR_ENV] = spec.dependenciesDir
    const bundleVersion = readWorkspaceDependenciesBundleVersion(spec.dependenciesDir)
    if (bundleVersion) {
      startEnv[WORKSPACE_DEPENDENCIES_VERSION_ENV] = bundleVersion
    } else {
      delete startEnv[WORKSPACE_DEPENDENCIES_VERSION_ENV]
    }
  } else {
    delete startEnv[WORKSPACE_DEPENDENCIES_DIR_ENV]
    delete startEnv[WORKSPACE_DEPENDENCIES_VERSION_ENV]
  }

  if (dataDir) {
    startEnv[MANAGED_AGENT_DATA_DIR_ENV] = dataDir
  }

  if (!startEnv[CONNECTOR_BUILD_CONFIG_ENV] && spec.runtimeDir) {
    const connectorBuildConfigPath = path.join(spec.runtimeDir, "config", "connectors.json")
    if (fs.existsSync(connectorBuildConfigPath)) {
      startEnv[CONNECTOR_BUILD_CONFIG_ENV] = connectorBuildConfigPath
    }
  }

  return startEnv
}

function applyWorkspaceDependencyEnv(spec: ManagedAgentLaunchSpec) {
  if (spec.dependenciesDir) {
    process.env[WORKSPACE_DEPENDENCIES_DIR_ENV] = spec.dependenciesDir
    const bundleVersion = readWorkspaceDependenciesBundleVersion(spec.dependenciesDir)
    if (bundleVersion) {
      process.env[WORKSPACE_DEPENDENCIES_VERSION_ENV] = bundleVersion
    } else {
      delete process.env[WORKSPACE_DEPENDENCIES_VERSION_ENV]
    }
    return
  }

  delete process.env[WORKSPACE_DEPENDENCIES_DIR_ENV]
  delete process.env[WORKSPACE_DEPENDENCIES_VERSION_ENV]
}

async function reservePort(port: number) {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer()

    server.once("error", reject)
    server.listen(port, "127.0.0.1", () => {
      const address = server.address()
      const assignedPort = typeof address === "object" && address ? address.port : port
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve(assignedPort)
      })
    })
  })
}

async function findAvailablePort(preferredPort = 4096) {
  try {
    return await reservePort(preferredPort)
  } catch {
    return reservePort(0)
  }
}

function attachProcessLogging(child: ChildProcessByStdio<null, Readable, Readable>) {
  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (chunk: string) => {
    for (const line of chunk.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      log(trimmed)
    }
  })

  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk: string) => {
    for (const line of chunk.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      safeError("[desktop][agent]", trimmed)
    }
  })
}

function clearSourceRuntimeRestartTimer() {
  if (!sourceRuntimeRestartTimer) return
  clearTimeout(sourceRuntimeRestartTimer)
  sourceRuntimeRestartTimer = undefined
}

function resolveSourceWatchRoot() {
  if (app.isPackaged) return undefined

  const desktopAppPath = app.getAppPath()
  const repoRoot = path.resolve(desktopAppPath, "..", "..")
  const watchRoot = path.join(repoRoot, "packages", "anyboxagent", "src")
  return fs.existsSync(watchRoot) ? watchRoot : undefined
}

async function ensureSourceRuntimeWatcher() {
  if (app.isPackaged || sourceRuntimeWatcher) return

  const watchRoot = resolveSourceWatchRoot()
  if (!watchRoot) return

  try {
    sourceRuntimeSnapshot = await createSourceRuntimeSnapshot(watchRoot)
    sourceRuntimeWatcher = fs.watch(watchRoot, { recursive: true }, (_eventType, filename) => {
      if (!managedAgent?.sourceRuntime) return

      const changedPath = typeof filename === "string" && filename.trim().length > 0 ? filename.trim() : "unknown"
      clearSourceRuntimeRestartTimer()
      sourceRuntimeRestartTimer = setTimeout(() => {
        sourceRuntimeRestartTimer = undefined
        void (async () => {
          if (!sourceRuntimeSnapshot) {
            await restartManagedAgent(`source changed (${changedPath})`)
            return
          }

          // Windows can emit recursive watch events when prompt files are first read.
          const shouldRestart = await shouldRestartForSourceRuntimeChange({
            watchRoot,
            snapshot: sourceRuntimeSnapshot,
            changedPath,
          })
          if (!shouldRestart) return

          await restartManagedAgent(`source changed (${changedPath})`)
        })().catch((error) => {
          logError(`failed to process source runtime watch event (${changedPath})`, error)
        })
      }, 150)
    })
    log(`watching source runtime for changes at ${watchRoot}`)
  } catch (error) {
    logError(`failed to watch source runtime at ${watchRoot}`, error)
  }
}

async function waitForAgentHealth(
  baseURL: string,
  child: ChildProcessByStdio<null, Readable, Readable>,
  timeoutMs = 15000,
) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`Managed agent exited before becoming healthy (exit code ${child.exitCode})`)
    }

    try {
      const response = await fetch(new URL("/healthz", baseURL))
      if (response.ok) return
    } catch {
      // The server is still starting up.
    }

    await delay(250)
  }

  throw new Error(`Managed agent did not become healthy within ${timeoutMs}ms`)
}

async function restartManagedAgent(reason: string) {
  if (sourceRuntimeRestartPromise) return sourceRuntimeRestartPromise

  sourceRuntimeRestartPromise = (async () => {
    log(`restarting managed agent: ${reason}`)
    await stopManagedAgent()
    await ensureManagedAgentRunning()
  })()
    .catch((error) => {
      logError(`managed agent restart failed: ${reason}`, error)
    })
    .finally(() => {
      sourceRuntimeRestartPromise = undefined
    })

  return sourceRuntimeRestartPromise
}

export async function ensureManagedAgentRunning() {
  if (managedAgent) {
    await publishBrowserNativeAgentBaseURL(managedAgent.baseURL)
    return managedAgent.baseURL
  }

  const externalBaseURL = readTrimmedDesktopEnv(MANAGED_AGENT_BASE_URL_ENV)
  if (externalBaseURL) {
    await publishBrowserNativeAgentBaseURL(externalBaseURL)
    return externalBaseURL
  }

  if (readTrimmedDesktopEnv(MANAGED_AGENT_DISABLE_ENV) === "1") {
    return undefined
  }

  const launchSpecs = resolveManagedAgentLaunchSpecs()
  if (launchSpecs.length === 0) {
    log("managed runtime not found; falling back to external agent configuration")
    return undefined
  }

  const port = await findAvailablePort()
  const baseURL = `http://127.0.0.1:${port}`
  const dataDir = resolveManagedAgentDataDir()
  const proxyEnv = await resolveManagedAgentProxyEnv()

  await fsp.mkdir(dataDir, { recursive: true })
  if (!readTrimmedDesktopEnv(AGENT_WORKDIR_ENV)) {
    process.env[AGENT_WORKDIR_ENV] = resolveDefaultAgentWorkdir()
  }

  const launchErrors: Error[] = []

  for (const spec of launchSpecs) {
    log(`starting managed agent with ${spec.label}`)
    const startEnv = buildManagedAgentStartEnv(spec, port, dataDir, proxyEnv)

    const child = spawn(spec.command, spec.args, {
      cwd: dataDir,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: startEnv,
    })

    managedAgent = {
      child,
      baseURL,
      port,
      sourceRuntime: spec.sourceRuntime,
    }

    attachProcessLogging(child)
    child.once("exit", (code, signal) => {
      log(`managed agent exited (code=${code ?? "null"}, signal=${signal ?? "none"})`)
      if (managedAgent?.child === child) {
        managedAgent = undefined
      }
    })

    try {
      await waitForAgentHealth(baseURL, child)
      process.env[MANAGED_AGENT_BASE_URL_ENV] = baseURL
      applyWorkspaceDependencyEnv(spec)
      if (spec.sourceRuntime) {
        await ensureSourceRuntimeWatcher()
      }
      await publishBrowserNativeAgentBaseURL(baseURL)
      log(`managed agent ready at ${baseURL} via ${spec.label}`)
      return baseURL
    } catch (error) {
      managedAgent = undefined
      try {
        child.kill()
      } catch {
        // The child may have already exited.
      }

      const launchError = error instanceof Error ? error : new Error(String(error))
      launchErrors.push(new Error(`Failed to start ${spec.label}: ${launchError.message}`))
      logError(`managed agent startup failed for ${spec.label}`, launchError)
    }
  }

  const message = launchErrors.map((error) => error.message).join("; ")
  throw new Error(message || "Managed agent failed to start")
}

export async function stopManagedAgent() {
  const current = managedAgent
  managedAgent = undefined
  delete process.env[MANAGED_AGENT_BASE_URL_ENV]
  delete process.env[MANAGED_AGENT_DATA_DIR_ENV]
  delete process.env[WORKSPACE_DEPENDENCIES_DIR_ENV]
  delete process.env[WORKSPACE_DEPENDENCIES_VERSION_ENV]
  clearSourceRuntimeRestartTimer()

  if (!current || current.child.exitCode !== null) return

  const exitPromise = new Promise<void>((resolve) => {
    current.child.once("exit", () => resolve())
  })

  if (typeof current.child.pid === "number") {
    await platformAdapter.terminateProcessTree(current.child.pid)
  } else {
    current.child.kill()
  }
  await Promise.race([
    exitPromise,
    delay(2000).then(() => {
      if (current.child.exitCode === null) {
        current.child.kill("SIGKILL")
      }
    }),
  ]).catch(() => {
    // The app is exiting anyway.
  })
}

export const managedAgentInternals = {
  env: {
    agentDataDir: MANAGED_AGENT_DATA_DIR_ENV,
    workspaceDependenciesDir: WORKSPACE_DEPENDENCIES_DIR_ENV,
    workspaceDependenciesVersion: WORKSPACE_DEPENDENCIES_VERSION_ENV,
  },
  resolveBundledRuntimeCandidates,
  resolveSourceAgentLaunchSpec,
  resolveBundledAgentLaunchSpecs,
  resolveManagedAgentLaunchSpecs,
  readWorkspaceDependenciesBundleVersion,
  proxyURLFromElectronProxyRule,
  resolveManagedAgentProxyEnv,
  buildManagedAgentStartEnv,
}
