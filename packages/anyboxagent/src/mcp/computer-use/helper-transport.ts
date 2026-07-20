import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { connect, type Socket } from "node:net"
import { dirname, join } from "node:path"
import { computerUseError, ComputerUseBrokerError } from "./errors.ts"

const MAX_FRAME_BYTES = 8 * 1024 * 1024
const PROTOCOL_VERSION = 1
const DEFAULT_TIMEOUT_MS = 15_000

interface RequestContext {
  sessionID: string
  turnID: string
  toolCallID: string
}

interface PendingRequest {
  reject: (error: unknown) => void
  resolve: (value: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

interface ComputerUseHelperTransportOptions {
  readonly requireAuthenticode?: boolean
}

export class ComputerUseHelperTransport {
  private child?: ChildProcessWithoutNullStreams
  private socket?: Socket
  private buffer = Buffer.alloc(0)
  private nextID = 1
  private initialized?: Promise<Record<string, unknown>>
  private pending = new Map<string, PendingRequest>()
  private serial = Promise.resolve()
  private helperVersion?: string
  private readonly requireAuthenticode: boolean

  constructor(
    private readonly helperPath: string,
    private readonly onPhysicalEscape: () => void,
    options: ComputerUseHelperTransportOptions = {},
  ) {
    this.requireAuthenticode =
      options.requireAuthenticode
      ?? process.env.ANYBOX_COMPUTER_USE_REQUIRE_SIGNATURE?.trim() === "1"
  }

  available() {
    return process.platform === "win32" && existsSync(this.helperPath)
  }

  version() {
    return this.helperVersion
  }

  async ensureInitialized() {
    if (!this.initialized) {
      this.initialized = this.start()
    }
    try {
      return await this.initialized
    } catch (error) {
      this.initialized = undefined
      throw error
    }
  }

  async call(
    method: string,
    params: Record<string, unknown>,
    options: { signal?: AbortSignal; timeoutMs?: number; context: RequestContext },
  ) {
    const previous = this.serial
    let release!: () => void
    this.serial = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      await this.ensureInitialized()
      return await this.request(method, params, options)
    } finally {
      release()
    }
  }

  stop(error = computerUseError("CU_INTERRUPTED", "Computer Use helper stopped.")) {
    this.socket?.destroy()
    this.socket = undefined
    if (this.child && this.child.exitCode === null && !this.child.killed) {
      this.child.kill()
    }
    this.child = undefined
    this.initialized = undefined
    this.helperVersion = undefined
    this.buffer = Buffer.alloc(0)
    this.failPending(error)
  }

  private async start() {
    if (!this.available()) {
      throw computerUseError(
        process.platform === "win32" ? "CU_HELPER_MISSING" : "CU_UNSUPPORTED_PLATFORM",
        process.platform === "win32"
          ? "The Anybox Computer Use helper is not installed."
          : "Computer Use is currently available only on Windows.",
      )
    }
    this.verifyHelperDigest()
    if (this.requireAuthenticode) {
      this.verifyHelperAuthenticode()
    }
    this.buffer = Buffer.alloc(0)
    const pipeName = `anybox-cu-${randomBytes(16).toString("hex")}`
    const brokerToken = randomBytes(32).toString("hex")
    const child = spawn(
      this.helperPath,
      ["--broker-pipe", pipeName, "--broker-pid", String(process.pid)],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    )
    this.child = child
    try {
      child.stderr.resume()
      child.stdout.resume()
      child.once("error", (error) => {
        this.failPending(computerUseError(
          "CU_INTERNAL_ERROR",
          "The Computer Use helper failed to start.",
          { cause: error },
        ))
      })
      child.once("exit", (code) => {
        if (this.child !== child) return
        this.child = undefined
        this.socket?.destroy()
        this.socket = undefined
        this.initialized = undefined
        this.helperVersion = undefined
        this.buffer = Buffer.alloc(0)
        this.failPending(computerUseError(
          code === 130 ? "CU_INTERRUPTED" : "CU_INTERNAL_ERROR",
          code === 130
            ? "Computer Use was interrupted."
            : "The Computer Use helper exited unexpectedly.",
        ))
      })
      child.stdin.end(`${brokerToken}\n`)

      const socket = await this.connectPipe(`\\\\.\\pipe\\${pipeName}`, child)
      this.socket = socket
      socket.on("data", (chunk) => this.onData(Buffer.from(chunk)))
      socket.once("close", () => {
        if (this.socket === socket) this.socket = undefined
        if (this.child === child && child.exitCode === null && !child.killed) {
          child.kill()
        }
        this.failPending(computerUseError(
          "CU_INTERNAL_ERROR",
          "The Computer Use broker channel closed.",
        ))
      })
      socket.once("error", (error) => {
        this.failPending(computerUseError(
          "CU_INTERNAL_ERROR",
          "The Computer Use broker channel failed.",
          { cause: error },
        ))
      })

      const result = await this.requestRaw("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        client: { name: "anybox-computer-use-broker", version: "1.0.0" },
        maxFrameBytes: MAX_FRAME_BYTES,
        brokerToken,
      }, DEFAULT_TIMEOUT_MS)
      const record = asRecord(result)
      if (
        Number(record.protocolVersion) !== PROTOCOL_VERSION
        || asRecord(record.capabilities).hostBroker !== true
        || asRecord(record.capabilities).physicalEscape !== true
      ) {
        throw computerUseError(
          "CU_PROTOCOL_MISMATCH",
          "The Computer Use helper did not confirm the host broker contract.",
        )
      }
      this.helperVersion =
        typeof record.helperVersion === "string"
          ? record.helperVersion
          : undefined
      return record
    } catch (error) {
      const normalized = error instanceof ComputerUseBrokerError
        ? error
        : computerUseError(
            "CU_INTERNAL_ERROR",
            "The Computer Use helper failed during startup.",
            { cause: error },
          )
      this.stop(normalized)
      throw normalized
    }
  }

  private verifyHelperDigest() {
    const digestPath = join(dirname(this.helperPath), "computer-use-helper.sha256")
    if (!existsSync(digestPath)) {
      throw computerUseError(
        "CU_HELPER_MISSING",
        "The Computer Use helper integrity manifest is missing.",
      )
    }
    const expected = readFileSync(digestPath, "utf8")
      .trim()
      .toLowerCase()
      .split(/\s+/)[0]
    const actual = createHash("sha256")
      .update(readFileSync(this.helperPath))
      .digest("hex")
    if (!/^[a-f0-9]{64}$/.test(expected ?? "") || expected !== actual) {
      throw computerUseError(
        "CU_PROTOCOL_MISMATCH",
        "The Computer Use helper failed its integrity check.",
      )
    }
  }

  private verifyHelperAuthenticode() {
    const script = [
      "try {",
      "  $signature = Get-AuthenticodeSignature -LiteralPath $env:ANYBOX_CU_SIGNATURE_TARGET",
      "  [Console]::Out.Write($signature.Status.ToString())",
      "  exit 0",
      "} catch {",
      "  exit 2",
      "}",
    ].join("; ")
    let observedStatus: string | undefined
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
      throw computerUseError(
        "CU_PROTOCOL_MISMATCH",
        "The Computer Use helper failed its publisher signature check.",
      )
    }
  }

  private connectPipe(path: string, child: ChildProcessWithoutNullStreams) {
    const deadline = Date.now() + 5_000
    return new Promise<Socket>((resolve, reject) => {
      const attempt = () => {
        if (child.exitCode !== null || child.killed) {
          reject(computerUseError("CU_INTERNAL_ERROR", "The Computer Use helper exited before connecting."))
          return
        }
        const socket = connect(path)
        socket.once("connect", () => resolve(socket))
        socket.once("error", (error: NodeJS.ErrnoException) => {
          socket.destroy()
          if (
            Date.now() < deadline
            && ["ENOENT", "ECONNREFUSED", "EPIPE"].includes(error.code ?? "")
          ) {
            setTimeout(attempt, 25)
            return
          }
          reject(computerUseError(
            "CU_INTERNAL_ERROR",
            "Could not connect to the Computer Use helper.",
            { cause: error },
          ))
        })
      }
      attempt()
    })
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    options: { signal?: AbortSignal; timeoutMs?: number; context: RequestContext },
  ) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    if (options.signal?.aborted) {
      throw computerUseError("CU_INTERRUPTED", "Computer Use request was cancelled.")
    }
    return this.requestRaw(method, params, timeoutMs, options.context, options.signal)
  }

  private requestRaw(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
    context?: RequestContext,
    signal?: AbortSignal,
  ) {
    const socket = this.socket
    if (!socket || socket.destroyed) {
      throw computerUseError("CU_INTERNAL_ERROR", "Computer Use helper is not connected.")
    }
    const id = String(this.nextID++)
    const body = Buffer.from(JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
      meta: {
        protocolVersion: PROTOCOL_VERSION,
        requestId: `broker_${id}`,
        sessionId: context?.sessionID,
        turnId: context?.turnID,
        toolCallId: context?.toolCallID,
        deadlineUnixMs: Date.now() + timeoutMs,
      },
    }))
    if (body.length > MAX_FRAME_BYTES) {
      throw computerUseError("CU_PROTOCOL_MISMATCH", "Computer Use request exceeded the frame limit.")
    }
    const frame = Buffer.allocUnsafe(4 + body.length)
    frame.writeUInt32LE(body.length, 0)
    body.copy(frame, 4)

    return new Promise<unknown>((resolve, reject) => {
      const onAbort = () => {
        this.stop(computerUseError(
          "CU_INTERRUPTED",
          "Computer Use request was cancelled.",
          { effectMayHaveOccurred: method === "perform_action" },
        ))
      }
      const timer = setTimeout(() => {
        this.stop(computerUseError(
          "CU_TIMEOUT",
          `Computer Use helper request timed out: ${method}.`,
          {
            retryable: true,
            requiresFreshState: true,
            effectMayHaveOccurred: method === "perform_action",
          },
        ))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => {
          signal?.removeEventListener("abort", onAbort)
          resolve(value)
        },
        reject: (error) => {
          signal?.removeEventListener("abort", onAbort)
          reject(error)
        },
        timer,
      })
      signal?.addEventListener("abort", onAbort, { once: true })
      socket.write(frame, (error) => {
        if (error) this.stop(computerUseError(
          "CU_INTERNAL_ERROR",
          "Could not write to the Computer Use helper.",
          { cause: error },
        ))
      })
    })
  }

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0)
      if (length <= 0 || length > MAX_FRAME_BYTES) {
        this.stop(computerUseError("CU_PROTOCOL_MISMATCH", "Computer Use helper sent an invalid frame."))
        return
      }
      if (this.buffer.length < 4 + length) return
      const body = this.buffer.subarray(4, 4 + length)
      this.buffer = this.buffer.subarray(4 + length)
      let message: Record<string, unknown>
      try {
        message = asRecord(JSON.parse(body.toString("utf8")))
      } catch (error) {
        this.stop(computerUseError("CU_PROTOCOL_MISMATCH", "Computer Use helper sent invalid JSON.", { cause: error }))
        return
      }
      if (message.method === "physical_escape" && message.id === undefined) {
        this.onPhysicalEscape()
        continue
      }
      const id = String(message.id ?? "")
      const pending = this.pending.get(id)
      if (!pending) continue
      this.pending.delete(id)
      clearTimeout(pending.timer)
      const rawError = message.error && typeof message.error === "object"
        ? asRecord(message.error)
        : undefined
      if (rawError) {
        const data = asRecord(rawError.data)
        pending.reject(new ComputerUseBrokerError(
          typeof data.computerUseCode === "string" ? data.computerUseCode : "CU_INTERNAL_ERROR",
          typeof rawError.message === "string" ? rawError.message : "Computer Use helper request failed.",
          {
            retryable: data.retryable === true,
            requiresFreshState: data.requiresFreshState === true,
            effectMayHaveOccurred: data.effectMayHaveOccurred === true,
          },
        ))
      } else {
        pending.resolve(message.result)
      }
    }
  }

  private failPending(error: unknown) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {}
}
