import { randomBytes } from "node:crypto"
import { spawn, type ChildProcessByStdio } from "node:child_process"
import { createWriteStream } from "node:fs"
import { mkdir } from "node:fs/promises"
import net from "node:net"
import path from "node:path"
import type { Readable } from "node:stream"
import { setTimeout as delay } from "node:timers/promises"
import { getProcessEnvValue } from "#env/compat.ts"
import * as Log from "#util/log.ts"
import * as Plugin from "./plugin.ts"
import { appRuntimeDirectories } from "./app-runtime-paths.ts"

const log = Log.create({ service: "plugin-app-runtime" })
const RUNTIME_TOKEN_HEADER = "x-anybox-app-runtime-token"
const RUNTIME_START_POLL_MS = 100
const RUNTIME_STOP_TIMEOUT_MS = 5_000
const INHERITED_ENV_KEYS = new Set([
  "ALL_PROXY",
  "APPDATA",
  "COMSPEC",
  "DBUS_SESSION_BUS_ADDRESS",
  "DISPLAY",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOCALAPPDATA",
  "LOGNAME",
  "NODE_EXTRA_CA_CERTS",
  "PATH",
  "PATHEXT",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USER",
  "USERNAME",
  "USERPROFILE",
  "WAYLAND_DISPLAY",
  "WINDIR",
  "XAUTHORITY",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
  "XDG_STATE_HOME",
  "all_proxy",
  "https_proxy",
  "http_proxy",
])
const FORWARDED_REQUEST_HEADERS = new Set([
  "accept",
  "accept-language",
  "cache-control",
  "content-length",
  "content-range",
  "content-type",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "if-range",
  "if-unmodified-since",
  "last-event-id",
  "range",
  "user-agent",
])
const FORWARDED_RESPONSE_HEADERS = new Set([
  "accept-ranges",
  "cache-control",
  "content-disposition",
  "content-encoding",
  "content-language",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "expires",
  "last-modified",
  "retry-after",
  "vary",
  "x-request-id",
])

export type AppRuntimeErrorCode =
  | "APP_RUNTIME_NOT_AVAILABLE"
  | "APP_RUNTIME_START_FAILED"
  | "APP_RUNTIME_REQUEST_INVALID"
  | "APP_RUNTIME_REQUEST_FAILED"

export class AppRuntimeError extends Error {
  readonly code: AppRuntimeErrorCode

  constructor(code: AppRuntimeErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "AppRuntimeError"
    this.code = code
  }
}

type RuntimeProcess = ChildProcessByStdio<null, Readable, Readable>

type RuntimeState = {
  activeRequests: number
  child: RuntimeProcess
  definitionKey: string
  idleTimer?: ReturnType<typeof setTimeout>
  logStreams: Array<ReturnType<typeof createWriteStream>>
  pluginID: string
  port: number
  stopping: boolean
  startupError?: Error
  token: string
}

const runtimes = new Map<string, RuntimeState>()
const startingRuntimes = new Map<string, Promise<RuntimeState>>()

function inheritedEnvironment() {
  const env: NodeJS.ProcessEnv = {}
  for (const key of INHERITED_ENV_KEYS) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  return env
}

function replacePluginRoot(value: string, packageRoot: string) {
  return value.replaceAll("${PLUGIN_ROOT}", packageRoot)
}

function runtimeDefinitionKey(definition: Plugin.InstalledPluginAppRuntimeDefinition) {
  return JSON.stringify({
    packageRoot: definition.packageRoot,
    pluginVersion: definition.pluginVersion,
    runtime: definition.runtime,
    artifacts: definition.artifacts,
  })
}

async function allocateLoopbackPort() {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })
  const address = server.address()
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  if (!address || typeof address === "string") {
    throw new AppRuntimeError("APP_RUNTIME_START_FAILED", "Could not allocate an App Runtime port.")
  }
  return address.port
}

function resolveRuntimeCommand(command: string) {
  const normalized = command.trim().toLowerCase()
  if (normalized === "bun" || normalized === "bun.exe") {
    return getProcessEnvValue("ANYBOX_BUN_BINARY")?.trim() || process.execPath
  }
  return command
}

function createRuntimeEnvironment(
  definition: Plugin.InstalledPluginAppRuntimeDefinition,
  input: { port: number; token: string; directories: ReturnType<typeof appRuntimeDirectories> },
) {
  return {
    ...inheritedEnvironment(),
    ANYBOX_APP_ID: definition.pluginID,
    ANYBOX_APP_VERSION: definition.pluginVersion,
    ANYBOX_APP_PORT: String(input.port),
    ANYBOX_APP_TOKEN: input.token,
    ANYBOX_APP_DATA_DIR: input.directories.data,
    ANYBOX_APP_CACHE_DIR: input.directories.cache,
    ANYBOX_APP_LOG_DIR: input.directories.log,
    ANYBOX_APP_LOCALE: getProcessEnvValue("LANG")?.trim() || "en-US",
    ANYBOX_APP_ARTIFACTS_JSON: JSON.stringify(definition.artifacts),
  }
}

function openRuntimeLogs(pluginID: string, logDirectory: string) {
  const stdout = createWriteStream(path.join(logDirectory, "stdout.log"), { flags: "a" })
  const stderr = createWriteStream(path.join(logDirectory, "stderr.log"), { flags: "a" })
  return { stdout, stderr }
}

function closeRuntimeLogs(state: RuntimeState) {
  for (const stream of state.logStreams) stream.end()
}

function clearIdleTimer(state: RuntimeState) {
  if (!state.idleTimer) return
  clearTimeout(state.idleTimer)
  state.idleTimer = undefined
}

function scheduleIdleStop(state: RuntimeState, idleTimeoutMs: number) {
  clearIdleTimer(state)
  if (state.activeRequests > 0 || state.stopping || idleTimeoutMs <= 0) return
  state.idleTimer = setTimeout(() => {
    void stop(state.pluginID, "idle-timeout")
  }, idleTimeoutMs)
  state.idleTimer.unref?.()
}

async function waitForRuntimeReady(state: RuntimeState, definition: Plugin.InstalledPluginAppRuntimeDefinition) {
  const deadline = Date.now() + definition.runtime.startupTimeoutMs
  const healthURL = new URL(definition.runtime.healthcheckPath, `http://127.0.0.1:${state.port}`).toString()
  let lastError: unknown

  while (Date.now() < deadline) {
    if (state.startupError) {
      throw new AppRuntimeError(
        "APP_RUNTIME_START_FAILED",
        `App Runtime '${state.pluginID}' could not be started.`,
        { cause: state.startupError },
      )
    }
    if (state.child.exitCode !== null || state.child.killed) {
      throw new AppRuntimeError(
        "APP_RUNTIME_START_FAILED",
        `App Runtime '${state.pluginID}' exited before it became ready.`,
      )
    }
    try {
      const response = await fetch(healthURL, {
        headers: { [RUNTIME_TOKEN_HEADER]: state.token },
        signal: AbortSignal.timeout(Math.min(1_000, Math.max(100, deadline - Date.now()))),
      })
      if (response.ok) return
      lastError = new Error(`Healthcheck returned ${response.status}.`)
    } catch (error) {
      lastError = error
    }
    await delay(RUNTIME_START_POLL_MS)
  }

  throw new AppRuntimeError(
    "APP_RUNTIME_START_FAILED",
    `App Runtime '${state.pluginID}' did not become ready within ${definition.runtime.startupTimeoutMs}ms.`,
    { cause: lastError },
  )
}

async function launch(definition: Plugin.InstalledPluginAppRuntimeDefinition) {
  const directories = appRuntimeDirectories(definition.pluginID)
  await Promise.all(Object.values(directories).map((directory) => mkdir(directory, { recursive: true })))
  const port = await allocateLoopbackPort()
  const token = randomBytes(32).toString("base64url")
  const command = resolveRuntimeCommand(replacePluginRoot(definition.runtime.command, definition.packageRoot))
  const args = (definition.runtime.args ?? []).map((arg) => replacePluginRoot(arg, definition.packageRoot))
  const cwd = replacePluginRoot(definition.runtime.cwd ?? "${PLUGIN_ROOT}", definition.packageRoot)
  const runtimeLogs = openRuntimeLogs(definition.pluginID, directories.log)
  const child = spawn(command, args, {
    cwd,
    env: createRuntimeEnvironment(definition, { port, token, directories }),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  child.stdout.pipe(runtimeLogs.stdout, { end: false })
  child.stderr.pipe(runtimeLogs.stderr, { end: false })

  const state: RuntimeState = {
    activeRequests: 0,
    child,
    definitionKey: runtimeDefinitionKey(definition),
    logStreams: [runtimeLogs.stdout, runtimeLogs.stderr],
    pluginID: definition.pluginID,
    port,
    stopping: false,
    token,
  }
  runtimes.set(definition.pluginID, state)

  child.once("error", (error) => {
    state.startupError = error
    log.error("app-runtime-process-error", { pluginID: definition.pluginID, error })
  })
  child.once("exit", (code, signal) => {
    clearIdleTimer(state)
    closeRuntimeLogs(state)
    if (runtimes.get(definition.pluginID) === state) runtimes.delete(definition.pluginID)
    if (!state.stopping) {
      log.warn("app-runtime-exited", { pluginID: definition.pluginID, code, signal })
    }
  })

  try {
    await waitForRuntimeReady(state, definition)
    log.info("app-runtime-ready", { pluginID: definition.pluginID, port })
    scheduleIdleStop(state, definition.runtime.idleTimeoutMs)
    return state
  } catch (error) {
    await stopState(state, "startup-failed")
    throw error
  }
}

async function ensureRuntime(pluginID: string) {
  const definition = Plugin.getInstalledAppRuntimeDefinition(pluginID)
  if (!definition) {
    throw new AppRuntimeError(
      "APP_RUNTIME_NOT_AVAILABLE",
      `Plugin '${pluginID}' is not installed, enabled, or configured with an App Runtime.`,
    )
  }
  const key = runtimeDefinitionKey(definition)
  const starting = startingRuntimes.get(definition.pluginID)
  if (starting) return starting
  const current = runtimes.get(definition.pluginID)
  if (current && !current.stopping && current.definitionKey === key && current.child.exitCode === null) {
    clearIdleTimer(current)
    return current
  }
  if (current) await stopState(current, "definition-changed")

  const operation = launch(definition).finally(() => {
    if (startingRuntimes.get(definition.pluginID) === operation) startingRuntimes.delete(definition.pluginID)
  })
  startingRuntimes.set(definition.pluginID, operation)
  return operation
}

async function waitForExit(child: RuntimeProcess, timeoutMs: number) {
  if (child.exitCode !== null) return true
  return await Promise.race([
    new Promise<boolean>((resolve) => child.once("exit", () => resolve(true))),
    delay(timeoutMs).then(() => false),
  ])
}

async function stopState(state: RuntimeState, reason: string) {
  if (state.stopping) {
    await waitForExit(state.child, RUNTIME_STOP_TIMEOUT_MS)
    return
  }
  state.stopping = true
  clearIdleTimer(state)
  if (runtimes.get(state.pluginID) === state) runtimes.delete(state.pluginID)
  if (state.child.exitCode === null) state.child.kill("SIGTERM")
  if (!(await waitForExit(state.child, RUNTIME_STOP_TIMEOUT_MS)) && state.child.exitCode === null) {
    state.child.kill("SIGKILL")
    await waitForExit(state.child, 1_000)
  }
  closeRuntimeLogs(state)
  log.info("app-runtime-stopped", { pluginID: state.pluginID, reason })
}

export async function stop(pluginID: string, reason = "requested") {
  const normalizedPluginID = pluginID.trim().toLowerCase()
  const starting = startingRuntimes.get(normalizedPluginID)
  if (starting) {
    const state = await starting.catch(() => undefined)
    if (state) await stopState(state, reason)
    return
  }
  const state = runtimes.get(normalizedPluginID)
  if (state) await stopState(state, reason)
}

export async function stopAll(reason = "shutdown") {
  const pluginIDs = new Set([...runtimes.keys(), ...startingRuntimes.keys()])
  await Promise.allSettled([...pluginIDs].map((pluginID) => stop(pluginID, reason)))
}

function forwardRequestHeaders(request: Request, state: RuntimeState) {
  const headers = new Headers()
  for (const [name, value] of request.headers) {
    if (FORWARDED_REQUEST_HEADERS.has(name.toLowerCase())) headers.set(name, value)
  }
  headers.delete("content-length")
  headers.set(RUNTIME_TOKEN_HEADER, state.token)
  headers.set("x-anybox-app-id", state.pluginID)
  return headers
}

function forwardResponseHeaders(response: Response) {
  const headers = new Headers()
  for (const [name, value] of response.headers) {
    if (FORWARDED_RESPONSE_HEADERS.has(name.toLowerCase())) headers.set(name, value)
  }
  return headers
}

function releaseRuntimeRequest(state: RuntimeState, idleTimeoutMs: number) {
  state.activeRequests = Math.max(0, state.activeRequests - 1)
  scheduleIdleStop(state, idleTimeoutMs)
}

function trackResponseBody(response: Response, state: RuntimeState, idleTimeoutMs: number) {
  const body = response.body
  if (!body) {
    releaseRuntimeRequest(state, idleTimeoutMs)
    return null
  }
  const reader = body.getReader()
  let released = false
  const release = () => {
    if (released) return
    released = true
    releaseRuntimeRequest(state, idleTimeoutMs)
  }
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read()
        if (next.done) {
          release()
          controller.close()
          return
        }
        controller.enqueue(next.value)
      } catch (error) {
        release()
        controller.error(error)
      }
    },
    async cancel(reason) {
      release()
      await reader.cancel(reason).catch(() => {})
    },
  })
}

function normalizeRuntimeRequestPath(value: string) {
  let parsed: URL
  try {
    parsed = new URL(value, "http://anybox-app-runtime.invalid")
  } catch {
    throw new AppRuntimeError("APP_RUNTIME_REQUEST_INVALID", "App Runtime request path is invalid.")
  }
  if (parsed.origin !== "http://anybox-app-runtime.invalid" || !parsed.pathname.startsWith("/")) {
    throw new AppRuntimeError("APP_RUNTIME_REQUEST_INVALID", "App Runtime request must use a local path.")
  }
  return `${parsed.pathname}${parsed.search}`
}

export async function proxyRequest(pluginID: string, requestPath: string, request: Request) {
  const state = await ensureRuntime(pluginID)
  const definition = Plugin.getInstalledAppRuntimeDefinition(pluginID)
  if (!definition || runtimeDefinitionKey(definition) !== state.definitionKey) {
    await stopState(state, "plugin-disabled-or-updated")
    throw new AppRuntimeError("APP_RUNTIME_NOT_AVAILABLE", `Plugin '${pluginID}' App Runtime is no longer available.`)
  }
  const normalizedPath = normalizeRuntimeRequestPath(requestPath)
  const targetURL = new URL(normalizedPath, `http://127.0.0.1:${state.port}`).toString()
  const method = request.method.toUpperCase()
  state.activeRequests += 1
  clearIdleTimer(state)
  try {
    const init: RequestInit & { duplex?: "half" } = {
      method,
      headers: forwardRequestHeaders(request, state),
      redirect: "manual",
      signal: request.signal,
    }
    if (method !== "GET" && method !== "HEAD" && request.body) {
      init.body = request.body
      init.duplex = "half"
    }
    const response = await fetch(targetURL, init)
    return new Response(trackResponseBody(response, state, definition.runtime.idleTimeoutMs), {
      status: response.status,
      statusText: response.statusText,
      headers: forwardResponseHeaders(response),
    })
  } catch (error) {
    releaseRuntimeRequest(state, definition.runtime.idleTimeoutMs)
    if (error instanceof AppRuntimeError) throw error
    throw new AppRuntimeError(
      "APP_RUNTIME_REQUEST_FAILED",
      `App Runtime '${pluginID}' request failed.`,
      { cause: error },
    )
  }
}
