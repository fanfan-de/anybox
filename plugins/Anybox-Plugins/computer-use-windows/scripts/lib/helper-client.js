"use strict"

const { spawn } = require("node:child_process")
const fs = require("node:fs")
const {
  DEFAULT_HELPER_TIMEOUT_MS,
  MAX_FRAME_BYTES,
  PLUGIN_VERSION,
  PROTOCOL_VERSION,
} = require("./build-info")
const { ComputerUseError, asComputerUseError, cuError } = require("./errors")
const { FrameDecoder, encodeFrame } = require("./frame-codec")
const { SerialQueue } = require("./serial-queue")

class HelperClient {
  constructor(options) {
    this.helperPath = options.helperPath
    this.helperArgs = options.helperArgs ?? []
    this.cwd = options.cwd
    this.spawn = options.spawn ?? spawn
    this.stderr = options.stderr ?? process.stderr
    this.maxFrameBytes = options.maxFrameBytes ?? MAX_FRAME_BYTES
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_HELPER_TIMEOUT_MS
    this.process = undefined
    this.decoder = undefined
    this.initialized = undefined
    this.startPromise = undefined
    this.nextID = 1
    this.pending = new Map()
    this.queue = new SerialQueue()
  }

  available() {
    return process.platform === "win32" && fs.existsSync(this.helperPath)
  }

  async call(method, params = {}, options = {}) {
    return this.queue.run(async () => {
      await this.ensureInitialized()
      return this.requestRaw(method, params, options)
    })
  }

  async ensureInitialized() {
    if (this.initialized) return this.initialized
    if (this.startPromise) return this.startPromise

    this.startPromise = (async () => {
      this.ensureSupported()
      this.spawnHelper()
      const result = await this.requestRaw("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        client: {
          name: "anybox-computer-use-mcp",
          version: PLUGIN_VERSION,
        },
        maxFrameBytes: this.maxFrameBytes,
      }, { timeoutMs: this.defaultTimeoutMs })
      if (
        Number(result?.protocolVersion) !== PROTOCOL_VERSION
        || typeof result?.helperVersion !== "string"
      ) {
        throw cuError("CU_PROTOCOL_MISMATCH", "Computer Use helper returned an incompatible handshake.")
      }
      this.initialized = result
      return result
    })()

    try {
      return await this.startPromise
    } catch (error) {
      this.stop(asComputerUseError(error, "CU_PROTOCOL_MISMATCH"))
      throw error
    } finally {
      this.startPromise = undefined
    }
  }

  ensureSupported() {
    if (process.platform !== "win32") {
      throw cuError("CU_UNSUPPORTED_PLATFORM", "Computer Use Windows is only supported on Windows.")
    }
    if (!fs.existsSync(this.helperPath)) {
      throw cuError("CU_HELPER_MISSING", `Computer Use helper executable is missing: ${this.helperPath}`)
    }
  }

  spawnHelper() {
    if (this.process && !this.process.killed && this.process.exitCode === null) return

    const child = this.spawn(this.helperPath, this.helperArgs, {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    this.process = child
    this.decoder = new FrameDecoder({ maxFrameBytes: this.maxFrameBytes })
    child.stdout.on("data", (chunk) => this.handleStdout(child, chunk))
    child.stderr.setEncoding?.("utf8")
    child.stderr.on("data", (chunk) => {
      this.stderr.write(`[computer-use-windows helper] ${chunk}`)
    })
    child.on("error", (error) => {
      this.stopChild(child, cuError("CU_INTERNAL_ERROR", "Computer Use helper failed to start.", { cause: error }))
    })
    child.on("exit", (code, signal) => {
      this.stopChild(
        child,
        cuError(
          code === 130 ? "CU_INTERRUPTED" : "CU_INTERNAL_ERROR",
          code === 130
            ? "Computer Use was interrupted by the user."
            : `Computer Use helper exited (${code ?? signal ?? "unknown"}).`,
        ),
        false,
      )
    })
  }

  handleStdout(child, chunk) {
    if (this.process !== child || !this.decoder) return
    let messages
    try {
      messages = this.decoder.push(chunk)
    } catch (error) {
      this.stopChild(child, asComputerUseError(error, "CU_PROTOCOL_MISMATCH"))
      return
    }

    for (const message of messages) {
      if (message.jsonrpc !== "2.0" || message.id === undefined) {
        this.stopChild(child, cuError("CU_PROTOCOL_MISMATCH", "Helper returned an invalid JSON-RPC response."))
        return
      }
      const id = String(message.id)
      const pending = this.pending.get(id)
      if (!pending || pending.child !== child) continue
      this.pending.delete(id)
      clearTimeout(pending.timeout)
      pending.signal?.removeEventListener("abort", pending.onAbort)

      if (message.error) {
        const data = message.error.data && typeof message.error.data === "object"
          ? message.error.data
          : {}
        pending.reject(new ComputerUseError(
          typeof data.computerUseCode === "string" ? data.computerUseCode : "CU_INTERNAL_ERROR",
          String(message.error.message || "Computer Use helper request failed."),
          {
            retryable: data.retryable,
            requiresFreshState: data.requiresFreshState,
            effectMayHaveOccurred: data.effectMayHaveOccurred,
          },
        ))
      } else {
        pending.resolve(message.result)
      }
    }
  }

  requestRaw(method, params, options = {}) {
    const child = this.process
    if (!child || child.killed || child.exitCode !== null) {
      throw cuError("CU_INTERNAL_ERROR", "Computer Use helper is not running.")
    }
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs
    const signal = options.signal
    if (signal?.aborted) {
      throw cuError("CU_INTERRUPTED", "Computer Use request was cancelled before it started.")
    }

    const id = String(this.nextID++)
    const frame = encodeFrame({
      jsonrpc: "2.0",
      id,
      method,
      params,
      meta: {
        protocolVersion: PROTOCOL_VERSION,
        requestId: `req_${id}`,
        sessionId: null,
        turnId: null,
        deadlineUnixMs: Date.now() + timeoutMs,
      },
    }, this.maxFrameBytes)

    return new Promise((resolve, reject) => {
      const failAndStop = (error) => {
        if (!this.pending.has(id)) return
        this.pending.delete(id)
        clearTimeout(timeout)
        signal?.removeEventListener("abort", onAbort)
        const normalized = asComputerUseError(error)
        reject(normalized)
        this.stopChild(child, normalized)
      }
      const onAbort = () => failAndStop(cuError(
        "CU_INTERRUPTED",
        "Computer Use request was cancelled.",
        { effectMayHaveOccurred: method === "perform_action" },
      ))
      const timeout = setTimeout(() => failAndStop(cuError(
        "CU_TIMEOUT",
        `Computer Use helper request timed out: ${method}`,
        { effectMayHaveOccurred: method === "perform_action" },
      )), timeoutMs)
      this.pending.set(id, { child, method, onAbort, reject, resolve, signal, timeout })
      signal?.addEventListener("abort", onAbort, { once: true })
      child.stdin.write(frame, (error) => {
        if (error) failAndStop(cuError("CU_INTERNAL_ERROR", "Could not write to Computer Use helper.", { cause: error }))
      })
    })
  }

  stop(error = cuError("CU_INTERNAL_ERROR", "Computer Use helper stopped.")) {
    if (this.process) this.stopChild(this.process, error)
  }

  stopChild(child, error, kill = true) {
    for (const [id, pending] of this.pending.entries()) {
      if (pending.child !== child) continue
      this.pending.delete(id)
      clearTimeout(pending.timeout)
      pending.signal?.removeEventListener("abort", pending.onAbort)
      pending.reject(error)
    }
    if (this.process === child) {
      this.process = undefined
      this.decoder?.reset()
      this.decoder = undefined
      this.initialized = undefined
    }
    if (kill && !child.killed && child.exitCode === null) child.kill()
  }
}

module.exports = {
  HelperClient,
}
