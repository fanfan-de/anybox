import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto"
import {
  spawn as spawnChild,
  type ChildProcessWithoutNullStreams,
} from "node:child_process"
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { createConnection } from "node:net"
import { fileURLToPath } from "node:url"
import { ZodError } from "zod"
import {
  ANYBOX_CHROME_EXTENSION_ID,
  ANYBOX_CHROME_NATIVE_HOST_NAME,
} from "@anybox/chrome-shared/browser-extension"
import {
  BROWSER_CONTRACT_SUPPORTED_VERSIONS,
  BROWSER_CONTRACT_VERSION,
  type BrowserContractVersion,
} from "@anybox/chrome-shared/browser-contract"
import {
  BROWSER_IPC_HANDSHAKE_TIMEOUT_MS,
  BROWSER_IPC_PROTOCOL_VERSION,
  MAX_BROWSER_IPC_CHUNK_BYTES,
  MAX_BROWSER_IPC_FRAME_BYTES,
  MAX_BROWSER_IPC_MESSAGE_BYTES,
  BrowserIpcFrameDecoder,
  BrowserIpcNativeChunkMessage,
  BrowserIpcNativeHostHelloMessage,
  BrowserIpcNativeMessage,
  BrowserIpcProtocolError,
  BrowserIpcRole,
  BrowserIpcRuntimeHelloMessage,
  BrowserIpcRuntimeRequest,
  browserIpcProofTranscript,
  encodeBrowserIpcFrame,
  type BrowserIpcErrorCode,
  type BrowserIpcRuntimeRequest as BrowserIpcRuntimeRequestValue,
  type BrowserIpcTransportKind,
} from "@anybox/chrome-shared/browser-ipc"
import {
  browserExtensionBridge,
  type BrowserExtensionBridge,
} from "./bridge.ts"
import {
  BrowserCommandGatewayError,
  runBrowserRuntimeCommand,
} from "./command-gateway.ts"
import {
  browserPolicyEngine,
  type BrowserPolicyEngine,
} from "./browser-policy.ts"
import * as Log from "./log.ts"
import { browserRuntimePaths } from "@anybox/chrome-shared/runtime-paths"

const log = Log.create({ service: "browser-ipc" })
const IPC_DIRECTORY_NAME = "browser-ipc"
const NATIVE_BOOTSTRAP_FILENAME = `${ANYBOX_CHROME_NATIVE_HOST_NAME}.bootstrap.json`
const NATIVE_BOOTSTRAP_TTL_MS = 5 * 60_000
const LISTENER_CONTROL_MAX_BYTES = MAX_BROWSER_IPC_FRAME_BYTES * 2

export type BrowserIpcGatewayOptions = {
  platform?: NodeJS.Platform
  runtimeEndpoint?: string
  nativeHostEndpoint?: string
  bootstrapPath?: string
  brokerInstanceID?: string
  runtimeProof?: string
  now?: () => number
  handshakeTimeoutMs?: number
  nativeBootstrapTtlMs?: number
  bridge?: BrowserExtensionBridge
  policy?: BrowserPolicyEngine
}

type Challenge = {
  nonce: string
  expiresAt: number
}

type GatewayConnection = {
  connectionID: string
  role: BrowserIpcRole
  decoder: BrowserIpcFrameDecoder
  challenge: Challenge
  authenticated: boolean
  bridgeConnectionID?: string
  clientInstanceID?: string
  clientVersion?: string
  authorizationPublicKey?: string
  handshakeTimer: ReturnType<typeof setTimeout>
  requestIDs: Set<string>
  nativeChunks: Map<string, NativeChunkTransfer>
  nativeChunkBytes: number
  completedNativeTransferIDs: Set<string>
  closing: boolean
}

type NativeChunkTransfer = {
  total: number
  totalBytes: number
  chunks: Map<number, Buffer>
  receivedBytes: number
  timer: ReturnType<typeof setTimeout>
}

type NativeBootstrap = {
  proof: string
  issuedAt: number
  expiresAt: number
}

type BrowserIpcRuntimeEnvironment = {
  ANYBOX_BROWSER_IPC_PROTOCOL_VERSION: string
  ANYBOX_BROWSER_IPC_TRANSPORT: BrowserIpcTransportKind
  ANYBOX_BROWSER_IPC_RUNTIME_ENDPOINT: string
  ANYBOX_BROWSER_IPC_NATIVE_ENDPOINT: string
  ANYBOX_BROWSER_IPC_BOOTSTRAP_PATH: string
  ANYBOX_BROWSER_IPC_BROKER_INSTANCE_ID: string
  ANYBOX_BROWSER_IPC_RUNTIME_PROOF: string
}

function endpointIdentity(homeDir: string, ipcStateDirectory?: string) {
  const hash = createHash("sha256")
    .update(path.resolve(homeDir).toLowerCase())
  if (ipcStateDirectory) {
    hash
      .update("\0")
      .update(path.resolve(ipcStateDirectory).toLowerCase())
  }
  return hash.digest("hex")
    .slice(0, 16)
}

export function defaultBrowserIpcPaths(
  platform: NodeJS.Platform = process.platform,
  homeDir = browserRuntimePaths().home,
  stateDir = browserRuntimePaths().state,
) {
  if (!["win32", "darwin", "linux"].includes(platform)) {
    throw new BrowserIpcProtocolError(
      "PLATFORM_UNSUPPORTED",
      `Browser IPC is unsupported on platform '${platform}'.`,
    )
  }
  const persistentIpcDirectory = path.join(stateDir, IPC_DIRECTORY_NAME)
  const identity = endpointIdentity(
    homeDir,
    platform === "win32" ? undefined : persistentIpcDirectory,
  )
  const ipcDirectory = platform === "win32"
    ? persistentIpcDirectory
    : path.join("/tmp", `anybox-browser-${identity}`)
  const transport: BrowserIpcTransportKind = platform === "win32"
    ? "windows-named-pipe"
    : "unix-domain-socket"
  const endpoint = (role: BrowserIpcRole) => platform === "win32"
    ? `\\\\.\\pipe\\anybox-browser-${role}-v${BROWSER_IPC_PROTOCOL_VERSION}-${identity}`
    : path.join(
        ipcDirectory,
        `${role}-v${BROWSER_IPC_PROTOCOL_VERSION}-${identity}.sock`,
      )

  return {
    transport,
    ipcDirectory,
    runtimeEndpoint: endpoint("runtime"),
    nativeHostEndpoint: endpoint("native-host"),
    bootstrapPath: path.join(ipcDirectory, NATIVE_BOOTSTRAP_FILENAME),
  }
}

function randomProof() {
  return randomBytes(32).toString("base64url")
}

function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length
    && timingSafeEqual(leftBytes, rightBytes)
}

function proofFor(
  bootstrapProof: string,
  input: Parameters<typeof browserIpcProofTranscript>[0],
) {
  return createHmac("sha256", bootstrapProof)
    .update(browserIpcProofTranscript(input))
    .digest("base64url")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function protocolError(error: unknown) {
  if (error instanceof BrowserIpcProtocolError) return error
  if (error instanceof ZodError) {
    return new BrowserIpcProtocolError(
      "INVALID_MESSAGE",
      "Browser IPC message does not match the protocol schema.",
    )
  }
  return new BrowserIpcProtocolError(
    "INTERNAL_ERROR",
    error instanceof Error ? error.message : String(error),
  )
}

function endpointIsActive(
  endpoint: string,
  platform: NodeJS.Platform,
  timeoutMs = 300,
) {
  if (platform !== "win32" && !existsSync(endpoint)) {
    return Promise.resolve(false)
  }
  return new Promise<boolean>((resolve) => {
    const socket = createConnection(endpoint)
    let settled = false
    const finish = (active: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(active)
    }
    const timer = setTimeout(() => finish(true), timeoutMs)
    socket.once("connect", () => finish(true))
    socket.once("error", (error: NodeJS.ErrnoException) => {
      finish(!["ENOENT", "ECONNREFUSED"].includes(error.code ?? ""))
    })
  })
}

export class BrowserIpcGateway {
  readonly platform: NodeJS.Platform
  readonly transport: BrowserIpcTransportKind
  readonly runtimeEndpoint: string
  readonly nativeHostEndpoint: string
  readonly bootstrapPath: string
  readonly brokerInstanceID: string
  readonly runtimeProof: string

  private readonly now: () => number
  private readonly policy: BrowserPolicyEngine
  private readonly handshakeTimeoutMs: number
  private readonly nativeBootstrapTtlMs: number
  private readonly ipcDirectory: string
  private readonly bridge: BrowserExtensionBridge
  private readonly connections = new Map<string, GatewayConnection>()
  private startPromise: Promise<void> | undefined
  private running = false
  private nativeBootstrap: NativeBootstrap | undefined
  private nativeBootstrapTimer: ReturnType<typeof setTimeout> | undefined
  private listenerSidecar: ChildProcessWithoutNullStreams | undefined
  private listenerStdoutBuffer = ""
  private listenerStderrBuffer = ""
  private listenerStartResolve: (() => void) | undefined
  private listenerStartReject: ((error: Error) => void) | undefined
  private listenerStopResolve: (() => void) | undefined
  private readonly metrics = {
    approvalChallenges: 0,
    authorizedCommands: 0,
    permissionDenials: 0,
    leaseErrors: 0,
  }

  constructor(options: BrowserIpcGatewayOptions = {}) {
    this.platform = options.platform ?? process.platform
    const defaults = defaultBrowserIpcPaths(this.platform)
    this.transport = defaults.transport
    this.runtimeEndpoint = options.runtimeEndpoint ?? defaults.runtimeEndpoint
    this.nativeHostEndpoint = options.nativeHostEndpoint ?? defaults.nativeHostEndpoint
    this.bootstrapPath = options.bootstrapPath ?? defaults.bootstrapPath
    this.ipcDirectory = path.dirname(this.bootstrapPath)
    this.brokerInstanceID = options.brokerInstanceID ?? randomUUID()
    this.runtimeProof = options.runtimeProof ?? randomProof()
    this.policy = options.policy ?? browserPolicyEngine
    this.now = options.now ?? Date.now
    this.handshakeTimeoutMs = options.handshakeTimeoutMs
      ?? BROWSER_IPC_HANDSHAKE_TIMEOUT_MS
    this.nativeBootstrapTtlMs = Math.max(
      1,
      options.nativeBootstrapTtlMs ?? NATIVE_BOOTSTRAP_TTL_MS,
    )
    this.bridge = options.bridge ?? browserExtensionBridge
  }

  runtimeEnvironment(): BrowserIpcRuntimeEnvironment {
    return {
      ANYBOX_BROWSER_IPC_PROTOCOL_VERSION: String(BROWSER_IPC_PROTOCOL_VERSION),
      ANYBOX_BROWSER_IPC_TRANSPORT: this.transport,
      ANYBOX_BROWSER_IPC_RUNTIME_ENDPOINT: this.runtimeEndpoint,
      ANYBOX_BROWSER_IPC_NATIVE_ENDPOINT: this.nativeHostEndpoint,
      ANYBOX_BROWSER_IPC_BOOTSTRAP_PATH: this.bootstrapPath,
      ANYBOX_BROWSER_IPC_BROKER_INSTANCE_ID: this.brokerInstanceID,
      ANYBOX_BROWSER_IPC_RUNTIME_PROOF: this.runtimeProof,
    }
  }

  status() {
    const runtimeConnections = [...this.connections.values()]
      .filter((connection) => connection.role === "runtime" && connection.authenticated)
      .length
    const nativeHostConnections = [...this.connections.values()]
      .filter((connection) => connection.role === "native-host" && connection.authenticated)
      .length

    return {
      transport: this.transport,
      protocolVersion: BROWSER_IPC_PROTOCOL_VERSION,
      brokerInstanceID: this.brokerInstanceID,
      running: this.running,
      runtimeConnections,
      nativeHostConnections,
      nativeBootstrapAvailable: Boolean(this.nativeBootstrap),
      legacyHttpTransportEnabled: false,
      legacyWebSocketTransportEnabled: false,
      acl: this.platform === "win32"
        ? "process-token default DACL; no all-users read/write grant"
        : "socket directory 0700 and socket mode 0600",
      peerProcessIdentityVerified: false,
      metrics: {
        ...this.metrics,
        reconnectCount: this.bridge.status().reconnectCount,
      },
    }
  }

  start() {
    this.startPromise ??= this.startInternal().catch((error) => {
      this.startPromise = undefined
      throw error
    })
    return this.startPromise
  }

  async stop() {
    await this.startPromise?.catch(() => undefined)
    this.running = false
    this.clearNativeBootstrapTimer()
    for (const connection of [...this.connections.values()]) {
      this.postListenerMessage({
        type: "connection.terminate",
        connectionID: connection.connectionID,
      })
      this.cleanupConnection(connection)
    }

    await this.stopListenerSidecar()
    this.removeBootstrapIfOwned()
    this.nativeBootstrap = undefined
    this.removeUnixEndpoint(this.runtimeEndpoint)
    this.removeUnixEndpoint(this.nativeHostEndpoint)
    this.startPromise = undefined
  }

  private async startInternal() {
    this.prepareIpcDirectory()
    if (await endpointIsActive(this.runtimeEndpoint, this.platform)) {
      const error = new Error(
        "Another Chrome plugin Browser Host already owns the runtime endpoint.",
      ) as Error & { code: string }
      error.code = "BROWSER_HOST_ALREADY_RUNNING"
      throw error
    }
    this.removeUnixEndpoint(this.runtimeEndpoint)
    this.removeUnixEndpoint(this.nativeHostEndpoint)

    try {
      await this.startListenerSidecar()
      if (this.platform !== "win32") {
        chmodSync(this.runtimeEndpoint, 0o600)
        chmodSync(this.nativeHostEndpoint, 0o600)
      }
    } catch (error) {
      await this.stopListenerSidecar()
      this.removeUnixEndpoint(this.runtimeEndpoint)
      this.removeUnixEndpoint(this.nativeHostEndpoint)
      throw error
    }
    this.running = true
    this.provisionNativeBootstrap()
    log.info("started", {
      transport: this.transport,
      protocolVersion: BROWSER_IPC_PROTOCOL_VERSION,
      brokerInstanceID: this.brokerInstanceID,
      peerProcessIdentityVerified: false,
    })
  }

  private prepareIpcDirectory() {
    mkdirSync(this.ipcDirectory, { recursive: true, mode: 0o700 })
    if (this.platform !== "win32") chmodSync(this.ipcDirectory, 0o700)
  }

  private startListenerSidecar() {
    if (this.listenerSidecar) {
      return Promise.reject(new Error("Browser IPC listener sidecar is already running."))
    }
    const nodeBinary = process.env.ANYBOX_NODE_BINARY?.trim() || process.execPath
    const sidecarPath = fileURLToPath(
      new URL("./ipc-listener-sidecar.mjs", import.meta.url),
    )
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === "string"
          && !entry[0].toUpperCase().startsWith("ANYBOX_BROWSER_"),
      ),
    )
    if (process.env.ANYBOX_NODE_RUN_AS_NODE === "1") {
      env.ELECTRON_RUN_AS_NODE = "1"
    }
    const child = spawnChild(nodeBinary, [sidecarPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env,
      windowsHide: true,
    })
    this.listenerSidecar = child
    this.listenerStdoutBuffer = ""
    this.listenerStderrBuffer = ""
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      this.handleListenerStdout(chunk)
    })
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      this.listenerStderrBuffer = `${this.listenerStderrBuffer}${chunk}`.slice(-4_096)
    })
    child.once("error", (error) => {
      this.handleListenerFailure(
        new Error(`Browser IPC listener sidecar failed: ${error.message}`),
      )
    })
    child.once("exit", (code, signal) => {
      if (this.listenerSidecar !== child) return
      const detail = this.listenerStderrBuffer.trim()
      this.handleListenerFailure(new Error(
        `Browser IPC listener sidecar exited (code=${code ?? "null"}, signal=${signal ?? "none"})`
        + (detail ? `: ${detail}` : ""),
      ))
    })
    const ready = new Promise<void>((resolve, reject) => {
      this.listenerStartResolve = resolve
      this.listenerStartReject = reject
    })
    this.postListenerMessage({
      type: "start",
      runtimeEndpoint: this.runtimeEndpoint,
      nativeHostEndpoint: this.nativeHostEndpoint,
    })
    return ready
  }

  private async stopListenerSidecar() {
    const child = this.listenerSidecar
    if (!child) return
    const stopped = new Promise<void>((resolve) => {
      this.listenerStopResolve = resolve
    })
    this.postListenerMessage({ type: "stop" })
    await Promise.race([
      stopped,
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ])
    this.listenerSidecar = undefined
    child.stdout.removeAllListeners()
    child.stderr.removeAllListeners()
    child.removeAllListeners()
    child.stdin.destroy()
    if (!child.killed) child.kill()
    this.listenerStdoutBuffer = ""
    this.listenerStderrBuffer = ""
    this.listenerStartResolve = undefined
    this.listenerStartReject = undefined
    this.listenerStopResolve = undefined
  }

  private handleListenerStdout(chunk: string) {
    this.listenerStdoutBuffer += chunk
    if (Buffer.byteLength(this.listenerStdoutBuffer, "utf8") > LISTENER_CONTROL_MAX_BYTES) {
      this.handleListenerFailure(
        new Error("Browser IPC listener sidecar emitted an oversized control message."),
      )
      return
    }
    const lines = this.listenerStdoutBuffer.split(/\r?\n/)
    this.listenerStdoutBuffer = lines.pop() ?? ""
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        this.handleListenerMessage(JSON.parse(trimmed))
      } catch {
        this.handleListenerFailure(
          new Error("Browser IPC listener sidecar emitted invalid JSON."),
        )
        return
      }
    }
  }

  private handleListenerMessage(value: unknown) {
    if (!isRecord(value) || typeof value.type !== "string") return
    if (value.type === "ready") {
      this.listenerStartResolve?.()
      this.listenerStartResolve = undefined
      this.listenerStartReject = undefined
      return
    }
    if (value.type === "start.error") {
      const error = new Error(
        typeof value.message === "string"
          ? value.message
          : "Browser IPC listener failed to start.",
      )
      this.listenerStartReject?.(error)
      this.listenerStartResolve = undefined
      this.listenerStartReject = undefined
      const child = this.listenerSidecar
      this.listenerSidecar = undefined
      if (child && !child.killed) child.kill()
      return
    }
    if (value.type === "stopped") {
      this.listenerStopResolve?.()
      return
    }
    if (value.type === "connection.open") {
      const role = BrowserIpcRole.safeParse(value.role)
      if (!role.success || typeof value.connectionID !== "string") return
      this.accept(role.data, value.connectionID)
      return
    }

    const connection = typeof value.connectionID === "string"
      ? this.connections.get(value.connectionID)
      : undefined
    if (value.type === "connection.data" && connection) {
      try {
        if (typeof value.bytes !== "string") {
          throw new BrowserIpcProtocolError(
            "INVALID_MESSAGE",
            "Browser IPC listener sidecar returned invalid bytes.",
          )
        }
        const bytes = Buffer.from(value.bytes, "base64")
        for (const message of connection.decoder.push(bytes)) {
          void this.handleMessage(connection, message).catch((error) => {
            const normalized = protocolError(error)
            this.fail(connection, normalized.code, normalized.message)
          })
        }
      } catch (error) {
        const normalized = protocolError(error)
        this.fail(connection, normalized.code, normalized.message)
      }
      return
    }
    if (value.type === "connection.end" && connection) {
      try {
        connection.decoder.finish()
      } catch (error) {
        log.warn("truncated-frame", {
          connectionID: connection.connectionID,
          role: connection.role,
          error,
        })
      }
      return
    }
    if (value.type === "connection.close" && connection) {
      this.cleanupConnection(connection)
      return
    }
    if (value.type === "connection.error") {
      log.debug("connection-error", {
        connectionID: value.connectionID,
        message: value.message,
      })
      return
    }
    if (value.type === "listener.error" || value.type === "sidecar.error") {
      this.handleListenerFailure(new Error(
        typeof value.message === "string"
          ? value.message
          : "Browser IPC listener failed.",
      ))
    }
  }

  private handleListenerFailure(error: Error) {
    this.listenerStartReject?.(error)
    this.listenerStartResolve = undefined
    this.listenerStartReject = undefined
    if (!this.running) return
    this.running = false
    this.clearNativeBootstrapTimer()
    this.removeBootstrapIfOwned()
    this.nativeBootstrap = undefined
    for (const connection of [...this.connections.values()]) {
      this.cleanupConnection(connection)
    }
    const child = this.listenerSidecar
    this.listenerSidecar = undefined
    if (child && !child.killed) child.kill()
    log.error("listener-failed", { error })
  }

  private postListenerMessage(message: Record<string, unknown>, bytes?: Uint8Array) {
    const child = this.listenerSidecar
    if (!child || child.stdin.destroyed || !child.stdin.writable) return false
    const payload = bytes
      ? { ...message, bytes: Buffer.from(bytes).toString("base64") }
      : message
    child.stdin.write(`${JSON.stringify(payload)}\n`)
    return true
  }

  private accept(role: BrowserIpcRole, connectionID: string) {
    if (this.connections.has(connectionID)) return
    const challenge = {
      nonce: randomBytes(24).toString("base64url"),
      expiresAt: this.now() + this.handshakeTimeoutMs,
    }
    const connection: GatewayConnection = {
      connectionID,
      role,
      decoder: new BrowserIpcFrameDecoder(),
      challenge,
      authenticated: false,
      handshakeTimer: setTimeout(() => {
        this.fail(connection, "HANDSHAKE_EXPIRED", "Browser IPC hello timed out.")
      }, this.handshakeTimeoutMs),
      requestIDs: new Set(),
      nativeChunks: new Map(),
      nativeChunkBytes: 0,
      completedNativeTransferIDs: new Set(),
      closing: false,
    }
    this.connections.set(connectionID, connection)

    this.write(connection, {
      type: "challenge",
      protocolVersion: BROWSER_IPC_PROTOCOL_VERSION,
      role,
      brokerInstanceID: this.brokerInstanceID,
      ...challenge,
    })
  }

  private async handleMessage(
    connection: GatewayConnection,
    value: unknown,
  ) {
    if (!connection.authenticated) {
      this.handleHello(connection, value)
      return
    }

    if (!isRecord(value) || typeof value.type !== "string") {
      throw new BrowserIpcProtocolError(
        "INVALID_MESSAGE",
        "Browser IPC message must be an object with a type.",
      )
    }

    if (value.type === "pong") return
    if (connection.role === "runtime") {
      if (value.type !== "runtime.request") {
        throw new BrowserIpcProtocolError(
          value.type === "native.message" ? "ROLE_FORBIDDEN" : "UNKNOWN_MESSAGE_TYPE",
          "Runtime IPC clients may send only runtime.request messages.",
        )
      }
      const request = BrowserIpcRuntimeRequest.parse(value)
      await this.handleRuntimeRequest(connection, request)
      return
    }

    if (value.type !== "native.message" && value.type !== "native.chunk") {
      throw new BrowserIpcProtocolError(
        value.type === "runtime.request" ? "ROLE_FORBIDDEN" : "UNKNOWN_MESSAGE_TYPE",
        "Native Host IPC clients may send only native.message or native.chunk messages.",
      )
    }
    if (!connection.bridgeConnectionID) {
      throw new BrowserIpcProtocolError(
        "INTERNAL_ERROR",
        "Native Host bridge connection is not initialized.",
      )
    }
    const rawMessage = value.type === "native.message"
      ? JSON.stringify(BrowserIpcNativeMessage.parse(value).message)
      : this.acceptNativeChunk(
          connection,
          BrowserIpcNativeChunkMessage.parse(value),
        )
    if (rawMessage === undefined) return
    this.bridge.handleRawMessage(
      connection.bridgeConnectionID,
      JSON.parse(rawMessage),
    )
  }

  private acceptNativeChunk(
    connection: GatewayConnection,
    chunk: ReturnType<typeof BrowserIpcNativeChunkMessage.parse>,
  ) {
    if (connection.completedNativeTransferIDs.has(chunk.transferID)) {
      throw new BrowserIpcProtocolError(
        "DUPLICATE_REQUEST",
        "Browser IPC native transfer was already completed.",
      )
    }
    let transfer = connection.nativeChunks.get(chunk.transferID)
    if (!transfer) {
      if (
        connection.nativeChunkBytes + chunk.totalBytes
        > MAX_BROWSER_IPC_MESSAGE_BYTES
      ) {
        throw new BrowserIpcProtocolError(
          "FRAME_TOO_LARGE",
          "Browser IPC in-flight native messages exceed the 64 MB limit.",
        )
      }
      const timer = setTimeout(() => {
        const pending = connection.nativeChunks.get(chunk.transferID)
        if (!pending) return
        connection.nativeChunks.delete(chunk.transferID)
        connection.nativeChunkBytes -= pending.totalBytes
        this.fail(
          connection,
          "FRAME_TRUNCATED",
          "Browser IPC native message chunk transfer timed out.",
        )
      }, 30_000)
      timer.unref?.()
      transfer = {
        total: chunk.total,
        totalBytes: chunk.totalBytes,
        chunks: new Map(),
        receivedBytes: 0,
        timer,
      }
      connection.nativeChunks.set(chunk.transferID, transfer)
      connection.nativeChunkBytes += chunk.totalBytes
    } else if (
      transfer.total !== chunk.total
      || transfer.totalBytes !== chunk.totalBytes
    ) {
      throw new BrowserIpcProtocolError(
        "INVALID_MESSAGE",
        "Browser IPC native chunk metadata changed during transfer.",
      )
    }
    if (transfer.chunks.has(chunk.index)) {
      throw new BrowserIpcProtocolError(
        "DUPLICATE_REQUEST",
        "Browser IPC native chunk index was received more than once.",
      )
    }
    const bytes = Buffer.from(chunk.data, "base64")
    if (
      bytes.byteLength === 0
      || bytes.byteLength > MAX_BROWSER_IPC_CHUNK_BYTES
      || bytes.toString("base64") !== chunk.data
      || transfer.receivedBytes + bytes.byteLength > transfer.totalBytes
    ) {
      throw new BrowserIpcProtocolError(
        "INVALID_MESSAGE",
        "Browser IPC native chunk data is invalid.",
      )
    }
    transfer.chunks.set(chunk.index, bytes)
    transfer.receivedBytes += bytes.byteLength
    if (transfer.chunks.size < transfer.total) return undefined

    clearTimeout(transfer.timer)
    connection.nativeChunks.delete(chunk.transferID)
    connection.nativeChunkBytes -= transfer.totalBytes
    if (transfer.receivedBytes !== transfer.totalBytes) {
      throw new BrowserIpcProtocolError(
        "FRAME_TRUNCATED",
        "Browser IPC native chunks do not match the declared message size.",
      )
    }
    const ordered: Buffer[] = []
    for (let index = 0; index < transfer.total; index += 1) {
      const bytesAtIndex = transfer.chunks.get(index)
      if (!bytesAtIndex) {
        throw new BrowserIpcProtocolError(
          "FRAME_TRUNCATED",
          "Browser IPC native chunk sequence is incomplete.",
        )
      }
      ordered.push(bytesAtIndex)
    }
    connection.completedNativeTransferIDs.add(chunk.transferID)
    if (connection.completedNativeTransferIDs.size > 256) {
      const oldest = connection.completedNativeTransferIDs.values().next().value
      if (typeof oldest === "string") {
        connection.completedNativeTransferIDs.delete(oldest)
      }
    }
    const payload = Buffer.concat(ordered, transfer.totalBytes)
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(payload)
    } catch {
      throw new BrowserIpcProtocolError(
        "FRAME_MALFORMED_JSON",
        "Browser IPC native message must contain valid UTF-8 JSON.",
      )
    }
  }

  private handleHello(connection: GatewayConnection, value: unknown) {
    if (!isRecord(value) || value.type !== "hello") {
      throw new BrowserIpcProtocolError(
        "HELLO_REQUIRED",
        "Browser IPC clients must complete hello before sending messages.",
      )
    }
    if (value.protocolVersion !== BROWSER_IPC_PROTOCOL_VERSION) {
      throw new BrowserIpcProtocolError(
        "PROTOCOL_MISMATCH",
        `Browser IPC protocol ${String(value.protocolVersion)} is not supported.`,
      )
    }
    if (value.role !== connection.role) {
      throw new BrowserIpcProtocolError(
        "ROLE_MISMATCH",
        `Browser IPC endpoint requires role '${connection.role}'.`,
      )
    }
    if (value.brokerInstanceID !== this.brokerInstanceID) {
      throw new BrowserIpcProtocolError(
        "BROKER_STALE",
        "Browser IPC broker instance is stale.",
      )
    }
    if (
      value.nonce !== connection.challenge.nonce
      || this.now() > connection.challenge.expiresAt
    ) {
      throw new BrowserIpcProtocolError(
        "HANDSHAKE_EXPIRED",
        "Browser IPC challenge is invalid or expired.",
      )
    }

    const hello = connection.role === "runtime"
      ? BrowserIpcRuntimeHelloMessage.parse(value)
      : BrowserIpcNativeHostHelloMessage.parse(value)
    if (
      connection.role === "native-host"
      && this.nativeBootstrap
      && this.now() > this.nativeBootstrap.expiresAt
    ) {
      this.expireNativeBootstrap()
      throw new BrowserIpcProtocolError(
        "HANDSHAKE_EXPIRED",
        "Browser IPC bootstrap proof is expired.",
      )
    }
    const expectedBootstrapProof = connection.role === "runtime"
      ? this.runtimeProof
      : this.nativeBootstrap?.proof
    if (!expectedBootstrapProof) {
      throw new BrowserIpcProtocolError(
        "AUTH_FAILED",
        "Browser IPC bootstrap proof is unavailable or already consumed.",
      )
    }
    const expectedProof = proofFor(expectedBootstrapProof, {
      role: connection.role,
      brokerInstanceID: this.brokerInstanceID,
      nonce: connection.challenge.nonce,
      clientInstanceID: hello.clientInstanceID,
      clientVersion: hello.clientVersion,
      ...(hello.role === "runtime" && hello.authorizationPublicKey
        ? { authorizationPublicKey: hello.authorizationPublicKey }
        : {}),
    })
    if (!safeEqual(expectedProof, hello.proof)) {
      throw new BrowserIpcProtocolError(
        "AUTH_FAILED",
        "Browser IPC bootstrap proof is invalid.",
      )
    }

    clearTimeout(connection.handshakeTimer)
    connection.authenticated = true
    connection.clientInstanceID = hello.clientInstanceID
    connection.clientVersion = hello.clientVersion
    connection.authorizationPublicKey = hello.role === "runtime"
      ? hello.authorizationPublicKey
      : undefined

    if (connection.role === "native-host") {
      this.nativeBootstrap = undefined
      this.clearNativeBootstrapTimer()
      this.removeBootstrapIfOwned()
      // Rotate before completing this handshake so another Chrome profile can
      // immediately start with a distinct single-use credential.
      this.provisionNativeBootstrap()
      connection.bridgeConnectionID = this.bridge.register(
        {
          send: (data) => {
            this.writeNativePayload(connection, data)
          },
          close: () => this.endConnection(connection),
        },
        {
          transport: "native-ipc",
          hostName: ANYBOX_CHROME_NATIVE_HOST_NAME,
        },
      )
    }

    this.write(connection, {
      type: "ready",
      protocolVersion: BROWSER_IPC_PROTOCOL_VERSION,
      role: connection.role,
      brokerInstanceID: this.brokerInstanceID,
      ...(connection.role === "runtime"
        ? {
            applicationCapabilities: {
              runtimeOperations: ["status", "getInfo", "command"],
              browserContractVersions: [...BROWSER_CONTRACT_SUPPORTED_VERSIONS],
            },
          }
        : {}),
    })
    log.info("authenticated", {
      connectionID: connection.connectionID,
      role: connection.role,
      clientInstanceID: connection.clientInstanceID,
      clientVersion: connection.clientVersion,
    })
  }

  private async handleRuntimeRequest(
    connection: GatewayConnection,
    request: BrowserIpcRuntimeRequestValue,
  ) {
    if (connection.requestIDs.has(request.requestID)) {
      this.write(connection, {
        type: "runtime.response",
        requestID: request.requestID,
        ok: false,
        error: {
          code: "DUPLICATE_REQUEST",
          message: "Browser IPC requestID is already in flight.",
        },
      })
      return
    }

    connection.requestIDs.add(request.requestID)
    const commandStartedAt = request.operation === "command"
      ? performance.now()
      : undefined
    try {
      const data = request.operation === "status"
        ? this.runtimeStatus(connection)
        : request.operation === "getInfo"
          ? this.runtimeGetInfo(request.contractVersion, request.browserID)
          : await runBrowserRuntimeCommand(
              request,
              this.bridge,
              this.policy,
              connection.authorizationPublicKey,
            )
      if (
        request.operation === "command"
        && commandStartedAt !== undefined
      ) {
        const result = data && typeof data === "object"
          ? data as Record<string, unknown>
          : {}
        const matchCount = typeof result.count === "number"
          ? result.count
          : Array.isArray(result.values)
            ? result.values.length
            : undefined
        log.info("command", {
          method: request.method,
          durationMs: Math.max(
            0,
            Math.round(performance.now() - commandStartedAt),
          ),
          ...(matchCount === undefined ? {} : { matchCount }),
        })
      }
      if (
        request.operation === "command"
        && request.authorization?.value
      ) {
        this.metrics.authorizedCommands += 1
        log.info("authorization-accepted", {
          count: this.metrics.authorizedCommands,
        })
      }
      if (!this.isConnectionOpen(connection)) return
      this.write(connection, {
        type: "runtime.response",
        requestID: request.requestID,
        ok: true,
        data,
      })
    } catch (error) {
      if (!this.isConnectionOpen(connection)) return
      const code = error instanceof BrowserCommandGatewayError
        ? error.code
        : "INTERNAL_ERROR"
      if (
        request.operation === "command"
        && commandStartedAt !== undefined
      ) {
        log.info("command", {
          method: request.method,
          durationMs: Math.max(
            0,
            Math.round(performance.now() - commandStartedAt),
          ),
          errorCode: code,
        })
      }
      if (code === "APPROVAL_REQUIRED") {
        this.metrics.approvalChallenges += 1
        log.info("approval-required", {
          count: this.metrics.approvalChallenges,
        })
      } else if (code === "PERMISSION_DENIED") {
        this.metrics.permissionDenials += 1
        log.info("permission-denied", {
          count: this.metrics.permissionDenials,
        })
      } else if (
        code === "TAB_NOT_OWNED"
        || code === "TAB_CLAIM_REQUIRED"
        || code === "LEASE_EXPIRED"
      ) {
        this.metrics.leaseErrors += 1
        log.warn("lease-error", {
          code,
          count: this.metrics.leaseErrors,
        })
      }
      this.write(connection, {
        type: "runtime.response",
        requestID: request.requestID,
        ok: false,
        error: {
          code,
          message: error instanceof BrowserCommandGatewayError
            ? error.message
            : "The Chrome plugin Browser Host could not complete the browser request.",
          ...(error instanceof BrowserCommandGatewayError
            ? { retryable: error.retryable }
            : {}),
          ...(error instanceof BrowserCommandGatewayError && error.details
            ? { details: error.details }
            : {}),
        },
      })
    } finally {
      connection.requestIDs.delete(request.requestID)
    }
  }

  private runtimeStatus(connection: GatewayConnection) {
    const bridgeStatus = this.bridge.status()
    const contract = this.bridge.browserContractCompatibility()
    const ipcStatus = this.status()
    return {
      connected: bridgeStatus.connected,
      extensionConnected: contract.connected,
      contractCompatible: contract.compatible,
      backendVersion: bridgeStatus.active?.version,
      transport: ipcStatus.transport,
      protocolVersion: ipcStatus.protocolVersion,
      runtimeConnections: ipcStatus.runtimeConnections,
      nativeHostConnections: ipcStatus.nativeHostConnections,
      peerProcessIdentityVerified: ipcStatus.peerProcessIdentityVerified,
      authorizationVerificationAvailable: Boolean(
        connection.authorizationPublicKey,
      ),
      backends: bridgeStatus.backends,
      metrics: {
        ...ipcStatus.metrics,
        lastCleanup: bridgeStatus.lastCleanup,
      },
    }
  }

  private runtimeGetInfo(
    requestedContractVersion: number,
    browserID?: string,
  ) {
    if (requestedContractVersion !== BROWSER_CONTRACT_VERSION) {
      throw new BrowserCommandGatewayError(
        "CONTRACT_VERSION_UNSUPPORTED",
        `Browser Contract version '${requestedContractVersion}' is not supported.`,
      )
    }
    const contract = this.bridge.browserContractCompatibility()
    if (contract.connected && !contract.compatible) {
      throw new BrowserCommandGatewayError(
        "CONTRACT_VERSION_UNSUPPORTED",
        "The connected Chrome extension uses an incompatible Browser Contract.",
      )
    }
    return this.bridge.getInfo(
      browserID,
      requestedContractVersion as BrowserContractVersion,
    )
  }

  private write(connection: GatewayConnection, message: unknown) {
    if (!this.isConnectionOpen(connection)) return
    const frame = encodeBrowserIpcFrame(message)
    this.postListenerMessage(
      {
        type: "connection.write",
        connectionID: connection.connectionID,
        end: false,
      },
      frame,
    )
  }

  private writeNativePayload(connection: GatewayConnection, data: string) {
    const payload = Buffer.from(data, "utf8")
    if (payload.byteLength > MAX_BROWSER_IPC_MESSAGE_BYTES) {
      throw new BrowserIpcProtocolError(
        "FRAME_TOO_LARGE",
        "Browser IPC native message exceeds the 64 MB limit.",
      )
    }
    if (payload.byteLength <= MAX_BROWSER_IPC_CHUNK_BYTES) {
      this.write(connection, {
        type: "native.message",
        message: JSON.parse(data),
      })
      return
    }
    const transferID = randomUUID()
    const total = Math.ceil(
      payload.byteLength / MAX_BROWSER_IPC_CHUNK_BYTES,
    )
    for (let index = 0; index < total; index += 1) {
      const start = index * MAX_BROWSER_IPC_CHUNK_BYTES
      const end = Math.min(
        start + MAX_BROWSER_IPC_CHUNK_BYTES,
        payload.byteLength,
      )
      this.write(connection, {
        type: "native.chunk",
        transferID,
        index,
        total,
        totalBytes: payload.byteLength,
        data: payload.subarray(start, end).toString("base64"),
      })
    }
  }

  private isConnectionOpen(connection: GatewayConnection) {
    return this.connections.has(connection.connectionID)
      && !connection.closing
      && Boolean(this.listenerSidecar)
  }

  private endConnection(connection: GatewayConnection) {
    if (!this.isConnectionOpen(connection)) return
    connection.closing = true
    this.postListenerMessage({
      type: "connection.end",
      connectionID: connection.connectionID,
    })
  }

  private fail(
    connection: GatewayConnection,
    code: BrowserIpcErrorCode,
    message: string,
  ) {
    if (!this.isConnectionOpen(connection)) return
    connection.closing = true
    const frame = encodeBrowserIpcFrame({
      type: "error",
      code,
      message,
    })
    this.postListenerMessage(
      {
        type: "connection.write",
        connectionID: connection.connectionID,
        end: true,
      },
      frame,
    )
  }

  private cleanupConnection(connection: GatewayConnection) {
    if (!this.connections.delete(connection.connectionID)) return
    clearTimeout(connection.handshakeTimer)
    for (const transfer of connection.nativeChunks.values()) {
      clearTimeout(transfer.timer)
    }
    connection.nativeChunks.clear()
    connection.nativeChunkBytes = 0
    if (connection.bridgeConnectionID) {
      this.bridge.unregister(connection.bridgeConnectionID)
    }

    if (
      connection.role === "native-host"
      && this.running
      && ![...this.connections.values()].some(
        (candidate) =>
          candidate.role === "native-host" && candidate.authenticated,
      )
    ) {
      this.provisionNativeBootstrap()
    }
  }

  private provisionNativeBootstrap() {
    if (this.nativeBootstrap || !this.running) return
    this.nativeBootstrap = {
      proof: randomProof(),
      issuedAt: this.now(),
      expiresAt: this.now() + this.nativeBootstrapTtlMs,
    }
    const document = {
      transport: this.transport,
      protocolVersion: BROWSER_IPC_PROTOCOL_VERSION,
      role: "native-host",
      brokerInstanceID: this.brokerInstanceID,
      endpoint: this.nativeHostEndpoint,
      proof: this.nativeBootstrap.proof,
      issuedAt: new Date(this.nativeBootstrap.issuedAt).toISOString(),
      expiresAt: this.nativeBootstrap.expiresAt,
    }
    const temporaryPath = `${this.bootstrapPath}.${process.pid}.${randomUUID()}.tmp`
    writeFileSync(
      temporaryPath,
      `${JSON.stringify(document, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    )
    if (this.platform !== "win32") chmodSync(temporaryPath, 0o600)
    renameSync(temporaryPath, this.bootstrapPath)
    this.clearNativeBootstrapTimer()
    const expectedProof = this.nativeBootstrap.proof
    this.nativeBootstrapTimer = setTimeout(() => {
      if (this.nativeBootstrap?.proof !== expectedProof) return
      this.expireNativeBootstrap()
      this.provisionNativeBootstrap()
    }, this.nativeBootstrapTtlMs)
    this.nativeBootstrapTimer.unref?.()
  }

  private expireNativeBootstrap() {
    this.clearNativeBootstrapTimer()
    this.removeBootstrapIfOwned()
    this.nativeBootstrap = undefined
  }

  private clearNativeBootstrapTimer() {
    if (!this.nativeBootstrapTimer) return
    clearTimeout(this.nativeBootstrapTimer)
    this.nativeBootstrapTimer = undefined
  }

  private removeBootstrapIfOwned() {
    if (!existsSync(this.bootstrapPath)) return
    try {
      const parsed = JSON.parse(readFileSync(this.bootstrapPath, "utf8")) as {
        brokerInstanceID?: unknown
      }
      if (parsed.brokerInstanceID !== this.brokerInstanceID) return
      rmSync(this.bootstrapPath, { force: true })
    } catch {
      // Never delete a bootstrap file that cannot be proven to belong to us.
    }
  }

  private removeUnixEndpoint(endpoint: string) {
    if (this.platform === "win32" || !existsSync(endpoint)) return
    const relative = path.relative(this.ipcDirectory, endpoint)
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Refusing to remove Browser IPC endpoint outside ${this.ipcDirectory}.`)
    }
    const stat = lstatSync(endpoint)
    if (!stat.isSocket()) {
      throw new Error(`Refusing to replace non-socket Browser IPC endpoint: ${endpoint}`)
    }
    rmSync(endpoint, { force: true })
  }
}

export const browserIpcGateway = new BrowserIpcGateway()

export function startBrowserIpcGateway() {
  return browserIpcGateway.start()
}

export function stopBrowserIpcGateway() {
  return browserIpcGateway.stop()
}
