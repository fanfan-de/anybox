import { spawn } from "node:child_process"
import { createHmac, randomUUID } from "node:crypto"
import { access, readFile } from "node:fs/promises"
import { createConnection, type Socket } from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  BROWSER_IPC_PROTOCOL_VERSION,
  BrowserAuthorizationPublicKey,
  BrowserIpcFrameDecoder,
  browserIpcProofTranscript,
  encodeBrowserIpcFrame,
} from "@anybox/chrome-shared/browser-ipc"
import { browserRuntimePaths } from "@anybox/chrome-shared/runtime-paths"
import type {
  BrowserAuthorizationReceipt,
  BrowserContractCommandMethod,
  BrowserContractErrorCode,
} from "@anybox/chrome-shared/browser-contract"
import type {
  BrowserExtensionCommandContext,
} from "@anybox/chrome-shared/browser-extension"

const BROWSER_HOST_CLIENT_VERSION = "0.13.0"
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000
const HOST_START_TIMEOUT_MS = 8_000
const HOST_REPLACE_TIMEOUT_MS = 5_000
const BROWSER_AUTH_PUBLIC_KEY_ENV = "ANYBOX_BROWSER_AUTH_PUBLIC_KEY"

export type BrowserHostRequest =
  | {
      operation: "status"
    }
  | {
      operation: "getInfo"
      contractVersion: number
      browserID?: string
    }
  | {
      operation: "command"
      contractVersion: number
      method: BrowserContractCommandMethod
      params: unknown
      context?: BrowserExtensionCommandContext
      authorization?: BrowserAuthorizationReceipt
      timeoutMs?: number
    }

type RuntimeBootstrap = {
  role: "runtime"
  protocolVersion: number
  brokerInstanceID: string
  endpoint: string
  proof: string
  hostPID: number
  hostVersion: string
}

type PendingRequest = {
  resolve(value: unknown): void
  reject(error: Error): void
}

type Handshake = {
  socket: Socket
  resolve(): void
  reject(error: Error): void
}

export class BrowserHostClientError extends Error {
  readonly retryable: boolean
  readonly details?: Record<string, unknown>

  constructor(
    readonly code: BrowserContractErrorCode | string,
    message: string,
    options: {
      retryable?: boolean
      details?: Record<string, unknown>
      cause?: unknown
    } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    )
    this.name = "BrowserHostClientError"
    this.retryable = options.retryable ?? false
    this.details = options.details
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BrowserHostClientError(
      "BACKEND_UNAVAILABLE",
      `${label} is missing from the Browser Host bootstrap.`,
      { retryable: true },
    )
  }
  return value.trim()
}

function requiredProcessID(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new BrowserHostClientError(
      "BACKEND_UNAVAILABLE",
      `${label} is missing from the Browser Host bootstrap.`,
      { retryable: true },
    )
  }
  return Number(value)
}

function browserAuthorizationPublicKey() {
  const value = process.env[BROWSER_AUTH_PUBLIC_KEY_ENV]?.trim()
  if (!value) return undefined
  const parsed = BrowserAuthorizationPublicKey.safeParse(value)
  if (!parsed.success) {
    throw new BrowserHostClientError(
      "AUTHORIZATION_INVALID",
      "The Anybox browser authorization public key is invalid.",
      { retryable: false },
    )
  }
  return parsed.data
}

function runtimeBootstrapPath() {
  return path.resolve(
    process.env.ANYBOX_BROWSER_HOST_BOOTSTRAP_PATH?.trim()
      || browserRuntimePaths().runtimeBootstrap,
  )
}

async function readRuntimeBootstrap(): Promise<RuntimeBootstrap> {
  const bootstrapPath = runtimeBootstrapPath()
  let value: unknown
  try {
    value = JSON.parse(await readFile(bootstrapPath, "utf8"))
  } catch (cause) {
    throw new BrowserHostClientError(
      "BACKEND_UNAVAILABLE",
      "Chrome plugin Browser Host bootstrap is unavailable.",
      { retryable: true, cause },
    )
  }
  if (
    !isRecord(value)
    || value.role !== "runtime"
    || value.protocolVersion !== BROWSER_IPC_PROTOCOL_VERSION
  ) {
    throw new BrowserHostClientError(
      "BACKEND_UNAVAILABLE",
      "Chrome plugin Browser Host bootstrap is incompatible.",
      { retryable: true },
    )
  }
  return {
    role: "runtime",
    protocolVersion: BROWSER_IPC_PROTOCOL_VERSION,
    brokerInstanceID: requiredString(
      value.brokerInstanceID,
      "Browser Host broker instance ID",
    ),
    endpoint: requiredString(value.endpoint, "Browser Host runtime endpoint"),
    proof: requiredString(value.proof, "Browser Host runtime proof"),
    hostPID: requiredProcessID(value.hostPID, "Browser Host process ID"),
    hostVersion: requiredString(value.hostVersion, "Browser Host version"),
  }
}

function browserHostEntrypoint() {
  return path.resolve(
    process.env.ANYBOX_BROWSER_HOST_ENTRYPOINT?.trim()
      || fileURLToPath(new URL("./browser-host.mjs", import.meta.url)),
  )
}

async function spawnBrowserHost() {
  if (process.env.ANYBOX_BROWSER_HOST?.trim().toLowerCase() === "off") {
    throw new BrowserHostClientError(
      "BACKEND_UNAVAILABLE",
      "Chrome plugin Browser Host startup is disabled.",
      { retryable: true },
    )
  }
  const entrypoint = browserHostEntrypoint()
  try {
    await access(entrypoint)
  } catch (cause) {
    throw new BrowserHostClientError(
      "BACKEND_UNAVAILABLE",
      "Chrome plugin package is missing scripts/browser-host.mjs.",
      { retryable: false, cause },
    )
  }
  const env = { ...process.env }
  if (process.env.ANYBOX_NODE_RUN_AS_NODE === "1") {
    env.ELECTRON_RUN_AS_NODE = "1"
  }
  const child = spawn(process.execPath, [entrypoint], {
    detached: true,
    env,
    stdio: "ignore",
    windowsHide: true,
  })
  child.unref()
}

function wait(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs))
}

function processIsRunning(processID: number) {
  try {
    process.kill(processID, 0)
    return true
  } catch (error) {
    if (
      isRecord(error)
      && (error.code === "ESRCH" || error.code === "EINVAL")
    ) {
      return false
    }
    throw error
  }
}

async function replaceIncompatibleHost(bootstrap: RuntimeBootstrap) {
  if (bootstrap.hostPID === process.pid) {
    throw new BrowserHostClientError(
      "BACKEND_UNAVAILABLE",
      "Chrome plugin Browser Host bootstrap points to the current process.",
      { retryable: false },
    )
  }

  // Authenticate with the legacy transcript before terminating an older Host.
  // Older strict hello schemas do not know the per-connection verifier field.
  const authenticatedClient = new BrowserHostRuntimeClient(bootstrap, false)
  await authenticatedClient.ensureConnected()
  authenticatedClient.close()

  try {
    process.kill(bootstrap.hostPID, "SIGTERM")
  } catch (error) {
    if (
      !isRecord(error)
      || (error.code !== "ESRCH" && error.code !== "EINVAL")
    ) {
      throw new BrowserHostClientError(
        "BACKEND_UNAVAILABLE",
        "The incompatible Chrome plugin Browser Host could not be stopped.",
        {
          retryable: true,
          cause: error,
          details: {
            actualVersion: bootstrap.hostVersion,
            expectedVersion: BROWSER_HOST_CLIENT_VERSION,
          },
        },
      )
    }
  }

  const deadline = Date.now() + HOST_REPLACE_TIMEOUT_MS
  while (Date.now() < deadline && processIsRunning(bootstrap.hostPID)) {
    await wait(25)
  }
  if (processIsRunning(bootstrap.hostPID)) {
    throw new BrowserHostClientError(
      "BACKEND_UNAVAILABLE",
      "The incompatible Chrome plugin Browser Host did not stop in time.",
      {
        retryable: true,
        details: {
          actualVersion: bootstrap.hostVersion,
          expectedVersion: BROWSER_HOST_CLIENT_VERSION,
        },
      },
    )
  }
}

async function connectToAvailableHost() {
  const deadline = Date.now() + HOST_START_TIMEOUT_MS
  let started = false
  let lastError: unknown
  let delayMs = 25

  while (Date.now() < deadline) {
    try {
      const bootstrap = await readRuntimeBootstrap()
      if (bootstrap.hostVersion !== BROWSER_HOST_CLIENT_VERSION) {
        await replaceIncompatibleHost(bootstrap)
        lastError = new BrowserHostClientError(
          "BACKEND_UNAVAILABLE",
          "An incompatible Chrome plugin Browser Host was replaced.",
          {
            retryable: true,
            details: {
              actualVersion: bootstrap.hostVersion,
              expectedVersion: BROWSER_HOST_CLIENT_VERSION,
            },
          },
        )
        if (!started) {
          started = true
          await spawnBrowserHost()
        }
        await wait(Math.min(delayMs, Math.max(1, deadline - Date.now())))
        delayMs = Math.min(delayMs * 2, 250)
        continue
      }
      const client = new BrowserHostRuntimeClient(bootstrap)
      await client.ensureConnected()
      return client
    } catch (error) {
      lastError = error
      if (!started) {
        started = true
        await spawnBrowserHost()
      }
      await wait(Math.min(delayMs, Math.max(1, deadline - Date.now())))
      delayMs = Math.min(delayMs * 2, 250)
    }
  }

  throw new BrowserHostClientError(
    "BACKEND_UNAVAILABLE",
    "Chrome plugin Browser Host did not become ready.",
    { retryable: true, cause: lastError },
  )
}

class BrowserHostRuntimeClient {
  readonly #bootstrap: RuntimeBootstrap
  readonly #advertiseAuthorizationPublicKey: boolean
  readonly #clientInstanceID = randomUUID()
  readonly #pending = new Map<string, PendingRequest>()
  #socket: Socket | undefined
  #decoder: BrowserIpcFrameDecoder | undefined
  #connectPromise: Promise<void> | undefined
  #handshake: Handshake | undefined

  constructor(
    bootstrap: RuntimeBootstrap,
    advertiseAuthorizationPublicKey = true,
  ) {
    this.#bootstrap = bootstrap
    this.#advertiseAuthorizationPublicKey =
      advertiseAuthorizationPublicKey
  }

  async request<TResult = unknown>(request: BrowserHostRequest) {
    await this.ensureConnected()
    const socket = this.#socket
    if (!socket || socket.destroyed) {
      throw new BrowserHostClientError(
        "BACKEND_UNAVAILABLE",
        "Chrome plugin Browser Host connection is closed.",
        { retryable: true },
      )
    }
    const requestID = randomUUID()
    return new Promise<TResult>((resolve, reject) => {
      this.#pending.set(requestID, {
        resolve: (value) => resolve(value as TResult),
        reject,
      })
      try {
        socket.write(encodeBrowserIpcFrame({
          type: "runtime.request",
          requestID,
          ...request,
        }))
      } catch (error) {
        this.#pending.delete(requestID)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  async ensureConnected() {
    if (this.#socket && !this.#socket.destroyed && !this.#handshake) return
    this.#connectPromise ??= this.connect().finally(() => {
      this.#connectPromise = undefined
    })
    await this.#connectPromise
  }

  close() {
    this.disconnect(
      new BrowserHostClientError(
        "BACKEND_UNAVAILABLE",
        "Chrome plugin Browser Host connection was reset.",
        { retryable: true },
      ),
    )
  }

  private connect() {
    this.disconnect(
      new BrowserHostClientError(
        "BACKEND_UNAVAILABLE",
        "Chrome plugin Browser Host connection was replaced.",
        { retryable: true },
      ),
    )
    return new Promise<void>((resolve, reject) => {
      const socket = createConnection(this.#bootstrap.endpoint)
      const decoder = new BrowserIpcFrameDecoder()
      const timeout = setTimeout(() => {
        rejectHandshake(new BrowserHostClientError(
          "BACKEND_UNAVAILABLE",
          "Chrome plugin Browser Host handshake timed out.",
          { retryable: true },
        ))
      }, DEFAULT_CONNECT_TIMEOUT_MS)
      const rejectHandshake = (error: Error) => {
        if (this.#socket !== socket) return
        clearTimeout(timeout)
        this.#handshake = undefined
        socket.destroy()
        reject(error)
      }

      this.#socket = socket
      this.#decoder = decoder
      this.#handshake = {
        socket,
        resolve: () => {
          clearTimeout(timeout)
          this.#handshake = undefined
          resolve()
        },
        reject: rejectHandshake,
      }
      socket.on("data", (chunk) => {
        if (this.#socket !== socket) return
        try {
          const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk
          for (const message of decoder.push(bytes)) {
            this.handleMessage(socket, message)
          }
        } catch (error) {
          rejectHandshake(
            error instanceof Error ? error : new Error(String(error)),
          )
        }
      })
      socket.once("error", (error) => {
        if (this.#handshake?.socket === socket) rejectHandshake(error)
      })
      socket.once("close", () => {
        if (this.#socket !== socket) return
        this.#socket = undefined
        this.#decoder = undefined
        const error = new BrowserHostClientError(
          "BACKEND_UNAVAILABLE",
          "Chrome plugin Browser Host connection closed.",
          { retryable: true },
        )
        if (this.#handshake?.socket === socket) {
          clearTimeout(timeout)
          this.#handshake = undefined
          reject(error)
        }
        this.rejectPending(error)
      })
    })
  }

  private handleMessage(socket: Socket, value: unknown) {
    if (!isRecord(value) || typeof value.type !== "string") {
      throw new BrowserHostClientError(
        "BACKEND_UNAVAILABLE",
        "Chrome plugin Browser Host returned an invalid IPC message.",
      )
    }
    if (value.type === "challenge") {
      if (
        value.protocolVersion !== BROWSER_IPC_PROTOCOL_VERSION
        || value.role !== "runtime"
        || value.brokerInstanceID !== this.#bootstrap.brokerInstanceID
        || typeof value.nonce !== "string"
        || !value.nonce
        || !Number.isSafeInteger(value.expiresAt)
        || Number(value.expiresAt) < Date.now()
      ) {
        throw new BrowserHostClientError(
          "BACKEND_UNAVAILABLE",
          "Chrome plugin Browser Host challenge is incompatible or stale.",
          { retryable: true },
        )
      }
      const proofInput = {
        role: "runtime" as const,
        brokerInstanceID: this.#bootstrap.brokerInstanceID,
        nonce: value.nonce,
        clientInstanceID: this.#clientInstanceID,
        clientVersion: BROWSER_HOST_CLIENT_VERSION,
        authorizationPublicKey: this.#advertiseAuthorizationPublicKey
          ? browserAuthorizationPublicKey()
          : undefined,
      }
      socket.write(encodeBrowserIpcFrame({
        type: "hello",
        protocolVersion: BROWSER_IPC_PROTOCOL_VERSION,
        ...proofInput,
        proof: createHmac("sha256", this.#bootstrap.proof)
          .update(browserIpcProofTranscript(proofInput))
          .digest("base64url"),
      }))
      return
    }
    if (value.type === "ready") {
      if (
        value.protocolVersion !== BROWSER_IPC_PROTOCOL_VERSION
        || value.role !== "runtime"
        || value.brokerInstanceID !== this.#bootstrap.brokerInstanceID
      ) {
        throw new BrowserHostClientError(
          "BACKEND_UNAVAILABLE",
          "Chrome plugin Browser Host ready message is incompatible.",
          { retryable: true },
        )
      }
      this.#handshake?.resolve()
      return
    }
    if (value.type === "error") {
      const error = new BrowserHostClientError(
        typeof value.code === "string" ? value.code : "BACKEND_UNAVAILABLE",
        typeof value.message === "string"
          ? value.message
          : "Chrome plugin Browser Host rejected the connection.",
        { retryable: true },
      )
      if (this.#handshake) this.#handshake.reject(error)
      else this.rejectPending(error)
      return
    }
    if (value.type === "runtime.response") {
      const requestID =
        typeof value.requestID === "string" ? value.requestID : ""
      const pending = this.#pending.get(requestID)
      if (!pending) return
      this.#pending.delete(requestID)
      if (value.ok === true) {
        pending.resolve(value.data)
      } else {
        const error = isRecord(value.error) ? value.error : {}
        pending.reject(new BrowserHostClientError(
          typeof error.code === "string" ? error.code : "COMMAND_FAILED",
          typeof error.message === "string"
            ? error.message
            : "Chrome plugin Browser Host request failed.",
          {
            retryable:
              typeof error.retryable === "boolean" && error.retryable,
            details: isRecord(error.details) ? error.details : undefined,
          },
        ))
      }
      return
    }
    if (value.type === "ping") {
      socket.write(encodeBrowserIpcFrame({
        type: "pong",
        nonce: value.nonce,
      }))
      return
    }
    throw new BrowserHostClientError(
      "BACKEND_UNAVAILABLE",
      `Chrome plugin Browser Host message '${value.type}' is unsupported.`,
    )
  }

  private disconnect(error: Error) {
    const socket = this.#socket
    this.#socket = undefined
    this.#decoder = undefined
    if (this.#handshake) {
      const handshake = this.#handshake
      this.#handshake = undefined
      handshake.reject(error)
    }
    if (socket && !socket.destroyed) socket.destroy()
    this.rejectPending(error)
  }

  private rejectPending(error: Error) {
    for (const pending of this.#pending.values()) pending.reject(error)
    this.#pending.clear()
  }
}

let browserHostClientPromise:
  | Promise<BrowserHostRuntimeClient>
  | undefined

async function browserHostClient() {
  browserHostClientPromise ??= connectToAvailableHost().catch((error) => {
    browserHostClientPromise = undefined
    throw error
  })
  return browserHostClientPromise
}

export async function ensureBrowserHostRuntime() {
  await browserHostClient()
}

export async function requestBrowserHost<TResult = unknown>(
  request: BrowserHostRequest,
) {
  let client = await browserHostClient()
  try {
    return await client.request<TResult>(request)
  } catch (error) {
    if (
      !(error instanceof BrowserHostClientError)
      || !error.retryable
    ) {
      throw error
    }
    client.close()
    browserHostClientPromise = undefined
    client = await browserHostClient()
    return client.request<TResult>(request)
  }
}
