const { createHmac, randomUUID } = require("node:crypto")
const { createConnection } = require("node:net")
const { TextDecoder } = require("node:util")

const BROWSER_IPC_PROTOCOL_VERSION = 1
const MAX_BROWSER_IPC_FRAME_BYTES = 16 * 1024 * 1024
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000
const utf8Decoder = new TextDecoder("utf-8", { fatal: true })

class BrowserIpcClientError extends Error {
  constructor(code, message, options = {}) {
    super(message)
    this.name = "BrowserIpcClientError"
    this.code = code
    if (typeof options.retryable === "boolean") this.retryable = options.retryable
    if (isRecord(options.details)) this.details = options.details
  }
}

function encodeFrame(value, maxFrameBytes = MAX_BROWSER_IPC_FRAME_BYTES) {
  const serialized = JSON.stringify(value)
  if (typeof serialized !== "string") {
    throw new BrowserIpcClientError(
      "FRAME_MALFORMED_JSON",
      "Browser IPC frames must contain a JSON value.",
    )
  }
  const payload = Buffer.from(serialized, "utf8")
  if (payload.length === 0) {
    throw new BrowserIpcClientError(
      "FRAME_INVALID_LENGTH",
      "Browser IPC frames cannot be empty.",
    )
  }
  if (payload.length > maxFrameBytes) {
    throw new BrowserIpcClientError(
      "FRAME_TOO_LARGE",
      `Browser IPC frame is ${payload.length} bytes; maximum is ${maxFrameBytes}.`,
    )
  }
  const frame = Buffer.allocUnsafe(payload.length + 4)
  frame.writeUInt32BE(payload.length, 0)
  payload.copy(frame, 4)
  return frame
}

class FrameDecoder {
  constructor(maxFrameBytes = MAX_BROWSER_IPC_FRAME_BYTES) {
    this.maxFrameBytes = maxFrameBytes
    this.buffered = Buffer.alloc(0)
  }

  push(chunk) {
    this.buffered = this.buffered.length === 0
      ? Buffer.from(chunk)
      : Buffer.concat([this.buffered, chunk])
    const messages = []
    while (this.buffered.length >= 4) {
      const length = this.buffered.readUInt32BE(0)
      if (length === 0) {
        throw new BrowserIpcClientError(
          "FRAME_INVALID_LENGTH",
          "Browser IPC frame length must be greater than zero.",
        )
      }
      if (length > this.maxFrameBytes) {
        throw new BrowserIpcClientError(
          "FRAME_TOO_LARGE",
          `Browser IPC frame declares ${length} bytes; maximum is ${this.maxFrameBytes}.`,
        )
      }
      if (this.buffered.length < 4 + length) break
      const payload = this.buffered.subarray(4, 4 + length)
      this.buffered = this.buffered.subarray(4 + length)
      try {
        messages.push(JSON.parse(utf8Decoder.decode(payload)))
      } catch {
        throw new BrowserIpcClientError(
          "FRAME_MALFORMED_JSON",
          "Browser IPC frame must contain valid UTF-8 JSON.",
        )
      }
    }
    return messages
  }

  finish() {
    if (this.buffered.length > 0) {
      throw new BrowserIpcClientError(
        "FRAME_TRUNCATED",
        "Browser IPC connection closed inside a frame.",
      )
    }
  }
}

function proofTranscript(input) {
  return [
    `anybox-browser-ipc-v${BROWSER_IPC_PROTOCOL_VERSION}`,
    input.role,
    input.brokerInstanceID,
    input.nonce,
    input.clientInstanceID,
    input.clientVersion,
  ].join("\n")
}

function proofFor(secret, input) {
  return createHmac("sha256", secret)
    .update(proofTranscript(input))
    .digest("base64url")
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

class BrowserIpcRuntimeClient {
  constructor(options) {
    this.endpoint = requiredString(options.endpoint, "Browser IPC runtime endpoint")
    this.brokerInstanceID = requiredString(
      options.brokerInstanceID,
      "Browser IPC broker instance ID",
    )
    this.bootstrapProof = requiredString(
      options.bootstrapProof,
      "Browser IPC runtime bootstrap proof",
    )
    this.clientVersion = requiredString(
      options.clientVersion,
      "Browser IPC runtime client version",
    )
    this.clientInstanceID = options.clientInstanceID || randomUUID()
    this.connectTimeoutMs = options.connectTimeoutMs || DEFAULT_CONNECT_TIMEOUT_MS
    this.socket = undefined
    this.decoder = undefined
    this.connectPromise = undefined
    this.handshake = undefined
    this.applicationCapabilities = undefined
    this.pending = new Map()
  }

  async request(request) {
    await this.ensureConnected()
    if (request?.operation === "getInfo") {
      const capabilities = this.applicationCapabilities
      if (
        !capabilities?.runtimeOperations.includes("getInfo")
        || !capabilities.browserContractVersions.includes(request.contractVersion)
      ) {
        throw new BrowserIpcClientError(
          "CONTRACT_VERSION_UNSUPPORTED",
          "The connected Anybox Agent does not advertise the requested Browser Contract.",
        )
      }
    }
    const socket = this.socket
    if (!socket || socket.destroyed) {
      throw new BrowserIpcClientError(
        "CONNECTION_CLOSED",
        "Browser IPC runtime connection is closed.",
      )
    }

    const requestID = randomUUID()
    return new Promise((resolve, reject) => {
      this.pending.set(requestID, { resolve, reject })
      try {
        socket.write(encodeFrame({
          type: "runtime.request",
          requestID,
          ...request,
        }))
      } catch (error) {
        this.pending.delete(requestID)
        reject(error)
      }
    })
  }

  reset() {
    this.disconnect(
      new BrowserIpcClientError(
        "CONNECTION_CLOSED",
        "Browser IPC runtime connection was reset.",
      ),
    )
  }

  async ensureConnected() {
    if (this.socket && !this.socket.destroyed && !this.handshake) return
    if (!this.connectPromise) {
      this.connectPromise = this.connectWithRetry().finally(() => {
        this.connectPromise = undefined
      })
    }
    await this.connectPromise
  }

  async connectWithRetry() {
    const deadline = Date.now() + this.connectTimeoutMs
    let delay = 25
    let lastError
    do {
      try {
        await this.connectOnce()
        return
      } catch (error) {
        lastError = error
        if (Date.now() >= deadline) break
        await sleep(Math.min(delay, Math.max(1, deadline - Date.now())))
        delay = Math.min(delay * 2, 250)
      }
    } while (Date.now() < deadline)

    throw lastError || new BrowserIpcClientError(
      "CONNECTION_CLOSED",
      "Browser IPC runtime connection failed.",
    )
  }

  connectOnce() {
    this.disconnect(
      new BrowserIpcClientError(
        "CONNECTION_CLOSED",
        "Browser IPC runtime connection was replaced.",
      ),
    )
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.endpoint)
      const decoder = new FrameDecoder()
      const timeout = setTimeout(() => {
        rejectHandshake(
          new BrowserIpcClientError(
            "HANDSHAKE_EXPIRED",
            "Browser IPC runtime handshake timed out.",
          ),
        )
      }, this.connectTimeoutMs)
      const rejectHandshake = (error) => {
        if (this.socket !== socket) return
        clearTimeout(timeout)
        this.handshake = undefined
        socket.destroy()
        reject(error)
      }

      this.socket = socket
      this.decoder = decoder
      this.handshake = {
        socket,
        resolve: () => {
          clearTimeout(timeout)
          this.handshake = undefined
          resolve()
        },
        reject: rejectHandshake,
      }

      socket.on("data", (chunk) => {
        if (this.socket !== socket) return
        try {
          for (const message of decoder.push(chunk)) {
            this.handleMessage(socket, message)
          }
        } catch (error) {
          rejectHandshake(error)
        }
      })
      socket.on("error", (error) => {
        if (this.handshake?.socket === socket) rejectHandshake(error)
      })
      socket.on("close", () => {
        if (this.socket !== socket) return
        try {
          decoder.finish()
        } catch {
          // The pending requests below receive the stable connection error.
        }
        const error = new BrowserIpcClientError(
          "CONNECTION_CLOSED",
          "Browser IPC runtime connection closed.",
        )
        if (this.handshake?.socket === socket) {
          clearTimeout(timeout)
          this.handshake = undefined
          reject(error)
        }
        this.socket = undefined
        this.decoder = undefined
        this.rejectPending(error)
      })
    })
  }

  handleMessage(socket, message) {
    if (!isRecord(message) || typeof message.type !== "string") {
      throw new BrowserIpcClientError(
        "INVALID_MESSAGE",
        "Browser IPC server message is invalid.",
      )
    }
    if (message.type === "challenge") {
      if (
        message.protocolVersion !== BROWSER_IPC_PROTOCOL_VERSION
        || message.role !== "runtime"
      ) {
        throw new BrowserIpcClientError(
          "PROTOCOL_MISMATCH",
          "Browser IPC runtime challenge is incompatible.",
        )
      }
      if (message.brokerInstanceID !== this.brokerInstanceID) {
        throw new BrowserIpcClientError(
          "BROKER_STALE",
          "Browser IPC broker instance is stale.",
        )
      }
      if (
        typeof message.nonce !== "string"
        || !message.nonce
        || !Number.isSafeInteger(message.expiresAt)
        || message.expiresAt < Date.now()
      ) {
        throw new BrowserIpcClientError(
          "HANDSHAKE_EXPIRED",
          "Browser IPC runtime challenge is invalid or expired.",
        )
      }
      const proofInput = {
        role: "runtime",
        brokerInstanceID: this.brokerInstanceID,
        nonce: message.nonce,
        clientInstanceID: this.clientInstanceID,
        clientVersion: this.clientVersion,
      }
      socket.write(encodeFrame({
        type: "hello",
        protocolVersion: BROWSER_IPC_PROTOCOL_VERSION,
        ...proofInput,
        proof: proofFor(this.bootstrapProof, proofInput),
      }))
      return
    }
    if (message.type === "ready") {
      if (
        message.protocolVersion !== BROWSER_IPC_PROTOCOL_VERSION
        || message.role !== "runtime"
        || message.brokerInstanceID !== this.brokerInstanceID
      ) {
        throw new BrowserIpcClientError(
          "PROTOCOL_MISMATCH",
          "Browser IPC runtime ready message is incompatible.",
        )
      }
      const capabilities = message.applicationCapabilities
      if (capabilities !== undefined) {
        if (
          !isRecord(capabilities)
          || !Array.isArray(capabilities.runtimeOperations)
          || capabilities.runtimeOperations.length === 0
          || capabilities.runtimeOperations.some((operation) =>
            typeof operation !== "string"
            || !operation.trim()
            || operation.length > 64
          )
          || !Array.isArray(capabilities.browserContractVersions)
          || capabilities.browserContractVersions.length === 0
          || capabilities.browserContractVersions.some((version) =>
            !Number.isSafeInteger(version) || version < 1
          )
        ) {
          throw new BrowserIpcClientError(
            "PROTOCOL_MISMATCH",
            "Browser IPC runtime application capabilities are invalid.",
          )
        }
      }
      this.applicationCapabilities = capabilities
      this.handshake?.resolve()
      return
    }
    if (message.type === "error") {
      const error = new BrowserIpcClientError(
        typeof message.code === "string" ? message.code : "INVALID_MESSAGE",
        typeof message.message === "string"
          ? message.message
          : "Browser IPC server rejected the connection.",
      )
      if (this.handshake) this.handshake.reject(error)
      else this.rejectPending(error)
      return
    }
    if (message.type === "runtime.response") {
      const pending = this.pending.get(message.requestID)
      if (!pending) return
      this.pending.delete(message.requestID)
      if (message.ok === true) pending.resolve(message.data)
      else {
        pending.reject(new BrowserIpcClientError(
          message.error?.code || "BROWSER_COMMAND_FAILED",
          message.error?.message || "Browser IPC request failed.",
          {
            retryable: message.error?.retryable,
            details: message.error?.details,
          },
        ))
      }
      return
    }
    if (message.type === "ping") {
      socket.write(encodeFrame({ type: "pong", nonce: message.nonce }))
      return
    }
    throw new BrowserIpcClientError(
      "UNKNOWN_MESSAGE_TYPE",
      `Browser IPC server message type '${message.type}' is not supported.`,
    )
  }

  disconnect(error) {
    const socket = this.socket
    this.socket = undefined
    this.decoder = undefined
    this.applicationCapabilities = undefined
    if (this.handshake) {
      const handshake = this.handshake
      this.handshake = undefined
      handshake.reject(error)
    }
    if (socket && !socket.destroyed) socket.destroy()
    this.rejectPending(error)
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`)
  }
  return value.trim()
}

module.exports = {
  BROWSER_IPC_PROTOCOL_VERSION,
  BrowserIpcClientError,
  BrowserIpcRuntimeClient,
  FrameDecoder,
  MAX_BROWSER_IPC_FRAME_BYTES,
  encodeFrame,
  proofFor,
  proofTranscript,
}
