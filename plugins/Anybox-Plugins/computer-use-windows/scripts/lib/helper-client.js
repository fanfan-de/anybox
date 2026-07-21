"use strict"

const { spawn, spawnSync } = require("node:child_process")
const { createHash, randomBytes } = require("node:crypto")
const fs = require("node:fs")
const net = require("node:net")
const path = require("node:path")
const {
  DEFAULT_HELPER_TIMEOUT_MS,
  MAX_FRAME_BYTES,
  PLUGIN_VERSION,
  PROTOCOL_VERSION,
} = require("./build-info")
const { ComputerUseError, asComputerUseError, cuError } = require("./errors")
const { FrameDecoder, encodeFrame } = require("./frame-codec")
const { SerialQueue } = require("./serial-queue")

const PIPE_CONNECT_TIMEOUT_MS = 5_000

class HelperClient {
  constructor(options) {
    this.helperPath = options.helperPath
    this.helperArgs = options.helperArgs ?? []
    this.cwd = options.cwd
    this.spawn = options.spawn ?? spawn
    this.connect = options.connect ?? net.connect
    this.pipePath = options.pipePath ?? ((name) => `\\\\.\\pipe\\${name}`)
    this.stderr = options.stderr ?? process.stderr
    this.platform = options.platform ?? process.platform
    this.verifyIntegrity = options.verifyIntegrity !== false
    this.requireAuthenticode = options.requireAuthenticode
      ?? process.env.ANYBOX_COMPUTER_USE_REQUIRE_SIGNATURE?.trim() === "1"
    this.onPhysicalEscape = options.onPhysicalEscape
    this.onOverlayUnavailable = options.onOverlayUnavailable
    this.defaultContext = options.defaultContext
    this.maxFrameBytes = options.maxFrameBytes ?? MAX_FRAME_BYTES
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_HELPER_TIMEOUT_MS
    this.process = undefined
    this.socket = undefined
    this.decoder = undefined
    this.initialized = undefined
    this.startPromise = undefined
    this.nextID = 1
    this.pending = new Map()
    this.queue = new SerialQueue()
  }

  available() {
    return this.platform === "win32" && fs.existsSync(this.helperPath)
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

    this.startPromise = this.start()
    try {
      this.initialized = await this.startPromise
      return this.initialized
    } catch (error) {
      this.stop(asComputerUseError(error, "CU_PROTOCOL_MISMATCH"))
      throw error
    } finally {
      this.startPromise = undefined
    }
  }

  ensureSupported() {
    if (this.platform !== "win32") {
      throw cuError("CU_UNSUPPORTED_PLATFORM", "Computer Use Windows is only supported on Windows.")
    }
    if (!fs.existsSync(this.helperPath)) {
      throw cuError("CU_HELPER_MISSING", `Computer Use helper executable is missing: ${this.helperPath}`)
    }
  }

  async start() {
    this.ensureSupported()
    if (this.verifyIntegrity) this.verifyHelperDigest()
    if (this.requireAuthenticode) this.verifyHelperAuthenticode()

    const pipeName = `anybox-cu-${randomBytes(16).toString("hex")}`
    const brokerToken = randomBytes(32).toString("hex")
    const child = this.spawn(this.helperPath, [
      ...this.helperArgs,
      "--broker-pipe",
      pipeName,
      "--broker-pid",
      String(process.pid),
    ], {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    this.process = child
    this.decoder = new FrameDecoder({ maxFrameBytes: this.maxFrameBytes })

    try {
      child.stdout.resume()
      child.stderr.setEncoding?.("utf8")
      child.stderr.on("data", (chunk) => {
        this.stderr.write(`[computer-use-windows helper] ${chunk}`)
      })
      child.once("error", (error) => {
        this.stopChild(
          child,
          cuError("CU_INTERNAL_ERROR", "Computer Use helper failed to start.", { cause: error }),
        )
      })
      child.once("exit", (code, signal) => {
        if (this.process !== child) return
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
      child.stdin.end(`${brokerToken}\n`)

      const socket = await this.connectPipe(this.pipePath(pipeName), child)
      if (this.process !== child) {
        socket.destroy()
        throw cuError("CU_INTERNAL_ERROR", "Computer Use helper stopped before connecting.")
      }
      this.socket = socket
      socket.on("data", (chunk) => this.handleData(child, Buffer.from(chunk)))
      socket.once("close", () => {
        if (this.socket !== socket || this.process !== child) return
        this.stopChild(
          child,
          cuError("CU_INTERNAL_ERROR", "Computer Use helper broker channel closed."),
        )
      })
      socket.once("error", (error) => {
        if (this.socket !== socket || this.process !== child) return
        this.stopChild(
          child,
          cuError("CU_INTERNAL_ERROR", "Computer Use helper broker channel failed.", { cause: error }),
        )
      })

      const result = await this.requestRaw("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        client: {
          name: "anybox-computer-use-plugin",
          version: PLUGIN_VERSION,
        },
        maxFrameBytes: this.maxFrameBytes,
        brokerToken,
      }, { timeoutMs: this.defaultTimeoutMs })
      if (
        Number(result?.protocolVersion) !== PROTOCOL_VERSION
        || typeof result?.helperVersion !== "string"
        || result?.capabilities?.hostBroker !== true
        || result?.capabilities?.physicalEscape !== true
      ) {
        throw cuError(
          "CU_PROTOCOL_MISMATCH",
          "Computer Use helper returned an incompatible plugin-broker handshake.",
        )
      }
      if (result?.capabilities?.overlay !== true) {
        throw cuError(
          "CU_OVERLAY_UNAVAILABLE",
          "Computer Use helper did not provide the required safety overlay.",
        )
      }
      return result
    } catch (error) {
      const normalized = error instanceof ComputerUseError
        ? error
        : cuError("CU_INTERNAL_ERROR", "Computer Use helper failed during startup.", {
            cause: error,
          })
      this.stopChild(child, normalized)
      throw normalized
    }
  }

  verifyHelperDigest() {
    const digestPath = path.join(path.dirname(this.helperPath), "computer-use-helper.sha256")
    if (!fs.existsSync(digestPath)) {
      throw cuError("CU_HELPER_MISSING", "Computer Use helper integrity manifest is missing.")
    }
    const expected = fs.readFileSync(digestPath, "utf8")
      .trim()
      .toLowerCase()
      .split(/\s+/u)[0]
    const actual = createHash("sha256")
      .update(fs.readFileSync(this.helperPath))
      .digest("hex")
    if (!/^[a-f0-9]{64}$/u.test(expected ?? "") || expected !== actual) {
      throw cuError("CU_PROTOCOL_MISMATCH", "Computer Use helper failed its integrity check.")
    }
  }

  verifyHelperAuthenticode() {
    const script = [
      "try {",
      "  $signature = Get-AuthenticodeSignature -LiteralPath $env:ANYBOX_CU_SIGNATURE_TARGET",
      "  [Console]::Out.Write($signature.Status.ToString())",
      "  exit 0",
      "} catch {",
      "  exit 2",
      "}",
    ].join("; ")
    let observedStatus
    for (const executable of ["pwsh.exe", "powershell.exe"]) {
      const result = spawnSync(executable, [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          ANYBOX_CU_SIGNATURE_TARGET: this.helperPath,
        },
        maxBuffer: 64 * 1024,
        windowsHide: true,
      })
      const status = result.stdout?.trim()
      if (result.status === 0 && status) {
        observedStatus = status
        break
      }
    }
    if (observedStatus !== "Valid") {
      throw cuError(
        "CU_PROTOCOL_MISMATCH",
        "Computer Use helper failed its publisher signature check.",
      )
    }
  }

  connectPipe(pipePath, child) {
    const deadline = Date.now() + PIPE_CONNECT_TIMEOUT_MS
    return new Promise((resolve, reject) => {
      const attempt = () => {
        if (child.exitCode !== null || child.killed || this.process !== child) {
          reject(cuError("CU_INTERNAL_ERROR", "Computer Use helper exited before connecting."))
          return
        }
        const socket = this.connect(pipePath)
        socket.once("connect", () => resolve(socket))
        socket.once("error", (error) => {
          socket.destroy()
          if (
            Date.now() < deadline
            && ["ENOENT", "ECONNREFUSED", "EPIPE"].includes(error?.code ?? "")
          ) {
            setTimeout(attempt, 25)
            return
          }
          reject(cuError(
            "CU_INTERNAL_ERROR",
            "Could not connect to the Computer Use helper broker channel.",
            { cause: error },
          ))
        })
      }
      attempt()
    })
  }

  handleData(child, chunk) {
    if (this.process !== child || !this.decoder) return
    let messages
    try {
      messages = this.decoder.push(chunk)
    } catch (error) {
      this.stopChild(child, asComputerUseError(error, "CU_PROTOCOL_MISMATCH"))
      return
    }

    for (const message of messages) {
      if (message.jsonrpc === "2.0" && message.method === "physical_escape") {
        const interrupted = cuError("CU_INTERRUPTED", "Computer Use was interrupted by physical Escape.")
        try {
          this.onPhysicalEscape?.(interrupted)
        } catch {
          // A plugin callback cannot weaken the physical interrupt.
        }
        this.stopChild(child, interrupted)
        return
      }
      if (message.jsonrpc === "2.0" && message.method === "overlay_unavailable") {
        const unavailable = cuError(
          "CU_OVERLAY_UNAVAILABLE",
          "The Computer Use safety overlay became unavailable; desktop access was stopped.",
          { retryable: true, requiresFreshState: true },
        )
        try {
          this.onOverlayUnavailable?.(unavailable)
        } catch {
          // A plugin callback cannot weaken fail-closed overlay handling.
        }
        this.stopChild(child, unavailable)
        return
      }
      if (message.jsonrpc !== "2.0" || message.id === undefined) {
        this.stopChild(
          child,
          cuError("CU_PROTOCOL_MISMATCH", "Helper returned an invalid JSON-RPC response."),
        )
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
    const socket = this.socket
    if (!child || child.killed || child.exitCode !== null || !socket || socket.destroyed) {
      throw cuError("CU_INTERNAL_ERROR", "Computer Use helper is not connected.")
    }
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs
    const signal = options.signal
    if (signal?.aborted) {
      throw cuError("CU_INTERRUPTED", "Computer Use request was cancelled before it started.")
    }

    const id = String(this.nextID++)
    const context = options.context ?? this.defaultContext ?? {}
    const frame = encodeFrame({
      jsonrpc: "2.0",
      id,
      method,
      params,
      meta: {
        protocolVersion: PROTOCOL_VERSION,
        requestId: `plugin_${id}`,
        sessionId: context.sessionID ?? null,
        turnId: context.turnID ?? null,
        toolCallId: context.toolCallID ?? null,
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
      socket.write(frame, (error) => {
        if (error) {
          failAndStop(cuError(
            "CU_INTERNAL_ERROR",
            "Could not write to the Computer Use helper broker channel.",
            { cause: error },
          ))
        }
      })
    })
  }

  stop(error = cuError("CU_INTERNAL_ERROR", "Computer Use helper stopped.")) {
    if (this.process) this.stopChild(this.process, error)
  }

  async endTurnAndStop(options = {}) {
    const child = this.process
    if (!child) return
    try {
      await this.queue.run(async () => {
        if (this.process !== child || !this.initialized) return
        await this.requestRaw("end_turn", {}, options)
      })
    } finally {
      if (this.process === child) {
        this.stopChild(
          child,
          cuError("CU_INTERNAL_ERROR", "Computer Use helper stopped after turn cleanup."),
        )
      }
    }
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
      const socket = this.socket
      this.socket = undefined
      socket?.destroy()
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
