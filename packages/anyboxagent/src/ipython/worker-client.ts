import { spawn as spawnChild, type ChildProcessWithoutNullStreams } from "node:child_process"
import process from "node:process"
import { randomUUID } from "node:crypto"
import { rm } from "node:fs/promises"
import {
  prepareIpythonRuntimeEnvironment,
  resolveIpythonPythonRuntime,
  type IpythonPythonRuntime,
} from "#ipython/runtime.ts"
import {
  IPYTHON_HOST_PROTOCOL_VERSION,
  IpythonRuntimeError,
  type IpythonExecutionResult,
  type IpythonHostCommand,
  type IpythonHostEvent,
} from "#ipython/types.ts"
import { terminateProcessTree } from "#shell/terminate.ts"
import * as Log from "#util/log.ts"

export const IPYTHON_STARTUP_TIMEOUT_MS = 25_000
export const IPYTHON_CELL_TIMEOUT_MS = 120_000
export const IPYTHON_INTERRUPT_GRACE_MS = 2_000
export const IPYTHON_SHUTDOWN_GRACE_MS = 5_000
export const IPYTHON_FORCE_EXIT_GRACE_MS = 3_000
export const IPYTHON_MAX_OUTPUT_CHARS = 100_000

const MAX_PROTOCOL_LINE_CHARS = 2_000_000
const MAX_DIAGNOSTIC_CHARS = 16_000
const MAX_OUTPUT_EVENTS_PER_EXECUTION = 4_096
const HOST_FORCE_KILL_GRACE_MS = 1_000
const KERNEL_FORCE_KILL_GRACE_MS = 500
const KERNEL_TERMINATION_TIMEOUT_MS = 3_000
const WINDOWS_TASKKILL_TIMEOUT_MS = 2_000

const log = Log.create({ service: "ipython.runtime" })

interface ReadyInfo {
  pythonVersion?: string
  ipythonVersion?: string
  kernelPid?: number
}

interface PendingExecution {
  requestId: string
  startedAt: number
  resolve: (result: IpythonExecutionResult) => void
  reject: (error: unknown) => void
  stdout: string
  stderr: string
  resultParts: string[]
  displays: Array<{ mime: "text/plain"; data: string }>
  error?: IpythonExecutionResult["error"]
  executionCount?: number
  outputEventCount: number
  truncated: boolean
  cancellation?: "aborted" | "timed_out"
  abortSignal?: AbortSignal
  abortListener?: () => void
  timeout?: ReturnType<typeof setTimeout>
  interruptGrace?: ReturnType<typeof setTimeout>
}

export interface IpythonWorkerClientOptions {
  sessionID: string
  cwd: string
  generation: number
  runtime?: IpythonPythonRuntime
  startupTimeoutMs?: number
  cellTimeoutMs?: number
  interruptGraceMs?: number
  shutdownGraceMs?: number
  maxOutputChars?: number
  onExit?: (client: IpythonWorkerClient) => void
}

function appendBounded(current: string, addition: string, limit: number) {
  if (!addition) return { value: current, truncated: false }
  const remaining = Math.max(0, limit - current.length)
  if (addition.length <= remaining) {
    return { value: current + addition, truncated: false }
  }
  return {
    value: current + addition.slice(0, remaining),
    truncated: true,
  }
}

function eventRecord(value: unknown): IpythonHostEvent | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const type = (value as { type?: unknown }).type
  if (typeof type !== "string") return undefined
  return value as IpythonHostEvent
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function processTargetAlive(target: number) {
  try {
    process.kill(target, 0)
    return true
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM"
  }
}

async function waitForProcessTargetsToExit(targets: number[], timeoutMs: number) {
  const deadline = Date.now() + Math.max(0, timeoutMs)
  while (targets.some(processTargetAlive) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return targets.every((target) => !processTargetAlive(target))
}

export class IpythonWorkerClient {
  readonly sessionID: string
  readonly cwd: string
  readonly generation: number

  private readonly options: Required<Pick<
    IpythonWorkerClientOptions,
    "startupTimeoutMs" | "cellTimeoutMs" | "interruptGraceMs" | "shutdownGraceMs" | "maxOutputChars"
  >> & Pick<IpythonWorkerClientOptions, "onExit">
  private readonly runtime: IpythonPythonRuntime
  private cacheDir?: string
  private cacheCleanupPromise?: Promise<void>
  private child?: ChildProcessWithoutNullStreams
  private startPromise?: Promise<ReadyInfo>
  private exitPromise?: Promise<void>
  private resolveExit?: () => void
  private readyResolve?: (info: ReadyInfo) => void
  private readyReject?: (error: unknown) => void
  private stdoutBuffer = ""
  private stdoutEnded = false
  private processExit?: { code: number | null; signal: NodeJS.Signals | null }
  private diagnostics = ""
  private pending = new Map<string, PendingExecution>()
  private activeRequestID?: string
  private kernelPid?: number
  private kernelTerminationPromise?: Promise<void>
  private hostTerminationPromise?: Promise<boolean>
  private hostTreeTerminationConfirmed = false
  private terminalFailure?: IpythonRuntimeError
  private shutdownAcknowledged = false
  private shutdownPromise?: Promise<void>
  private closing = false
  private exited = false

  constructor(options: IpythonWorkerClientOptions) {
    this.sessionID = options.sessionID
    this.cwd = options.cwd
    this.generation = options.generation
    this.runtime = options.runtime ?? resolveIpythonPythonRuntime()
    this.options = {
      startupTimeoutMs: options.startupTimeoutMs ?? IPYTHON_STARTUP_TIMEOUT_MS,
      cellTimeoutMs: options.cellTimeoutMs ?? IPYTHON_CELL_TIMEOUT_MS,
      interruptGraceMs: options.interruptGraceMs ?? IPYTHON_INTERRUPT_GRACE_MS,
      shutdownGraceMs: options.shutdownGraceMs ?? IPYTHON_SHUTDOWN_GRACE_MS,
      maxOutputChars: options.maxOutputChars ?? IPYTHON_MAX_OUTPUT_CHARS,
      onExit: options.onExit,
    }
  }

  get isExited() {
    return this.exited
  }

  async start() {
    if (!this.startPromise) this.startPromise = this.startOnce()
    return await this.startPromise
  }

  private async startOnce(): Promise<ReadyInfo> {
    const runtimeEnvironment = await prepareIpythonRuntimeEnvironment({
      sessionID: this.sessionID,
      generation: this.generation,
    })
    this.cacheDir = runtimeEnvironment.cacheDir
    if (this.closing) {
      await this.cleanupRuntimeCache()
      throw new IpythonRuntimeError(
        "IPYTHON_HOST_EXITED",
        "The IPython session was closed before its host started.",
        { stateLost: true },
      )
    }
    this.exitPromise = new Promise<void>((resolve) => {
      this.resolveExit = resolve
    })
    const ready = new Promise<ReadyInfo>((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })

    const child = spawnChild(this.runtime.executable, this.runtime.commandArgs, {
      cwd: this.cwd,
      env: runtimeEnvironment.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    })
    this.child = child
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => this.consumeStdout(chunk))
    child.stdout.once("end", () => {
      this.stdoutEnded = true
      this.finalizeAfterProcessAndStdout()
    })
    child.stderr.on("data", (chunk: string) => {
      const appended = appendBounded(this.diagnostics, chunk, MAX_DIAGNOSTIC_CHARS)
      this.diagnostics = appended.value
    })
    child.stdin.on("error", (error) => this.handlePipeFailure("stdin", error))
    child.stdout.on("error", (error) => this.handlePipeFailure("stdout", error))
    child.stderr.on("error", (error) => this.handlePipeFailure("stderr", error))
    child.once("error", (error) => {
      const failure = new IpythonRuntimeError(
        "IPYTHON_HOST_START_FAILED",
        `Failed to start the Anybox IPython host: ${error.message}`,
        { cause: error, stateLost: true },
      )
      this.failAndTerminate(failure)
      if (!child.pid) this.finalizeProcessExit(null, null, failure)
    })
    child.once("exit", (code, signal) => {
      this.processExit = { code, signal }
      this.finalizeAfterProcessAndStdout()
    })

    const timeout = setTimeout(() => {
      const error = new IpythonRuntimeError(
        "IPYTHON_HOST_START_TIMEOUT",
        `The Anybox IPython host did not become ready within ${this.options.startupTimeoutMs}ms.`,
        { stateLost: true },
      )
      this.failAndTerminate(error)
    }, this.options.startupTimeoutMs)

    try {
      const info = await ready
      log.info("host-ready", {
        sessionID: this.sessionID,
        source: this.runtime.source,
        pid: child.pid,
        kernelPid: info.kernelPid,
        pythonVersion: info.pythonVersion,
        ipythonVersion: info.ipythonVersion,
      })
      return info
    } finally {
      clearTimeout(timeout)
      this.readyResolve = undefined
      this.readyReject = undefined
    }
  }

  private consumeStdout(chunk: string) {
    this.stdoutBuffer += chunk
    if (this.stdoutBuffer.length > MAX_PROTOCOL_LINE_CHARS && !this.stdoutBuffer.includes("\n")) {
      this.handleProtocolFailure("The IPython host emitted an oversized protocol line.")
      return
    }

    while (true) {
      const newline = this.stdoutBuffer.indexOf("\n")
      if (newline < 0) return
      const line = this.stdoutBuffer.slice(0, newline).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (!line) continue

      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch (error) {
        this.handleProtocolFailure(`The IPython host emitted invalid JSON: ${errorMessage(error)}`)
        return
      }
      const event = eventRecord(parsed)
      if (!event) {
        this.handleProtocolFailure("The IPython host emitted an invalid protocol event.")
        return
      }
      this.handleEvent(event)
    }
  }

  private handleProtocolFailure(message: string) {
    const error = new IpythonRuntimeError(
      "IPYTHON_HOST_PROTOCOL_ERROR",
      message,
      { stateLost: true },
    )
    this.failAndTerminate(error)
  }

  private handleProcessFailure(error: IpythonRuntimeError) {
    this.readyReject?.(error)
    this.rejectPending(error)
  }

  private failAndTerminate(error: IpythonRuntimeError) {
    if (!this.terminalFailure) this.terminalFailure = error
    this.handleProcessFailure(this.terminalFailure)
    this.forceTerminate()
  }

  private handlePipeFailure(pipe: "stdin" | "stdout" | "stderr", error: Error) {
    if (this.exited) return
    this.failAndTerminate(new IpythonRuntimeError(
      "IPYTHON_HOST_EXITED",
      `The Anybox IPython host ${pipe} pipe failed: ${error.message}`,
      { cause: error, stateLost: true },
    ))
  }

  private finalizeProcessExit(
    code: number | null,
    signal: NodeJS.Signals | null,
    explicitFailure?: IpythonRuntimeError,
  ) {
    if (this.exited) return
    if (this.stdoutBuffer.trim()) this.consumeStdout("\n")

    const expected = (
      this.closing
      && !this.terminalFailure
      && !explicitFailure
      && this.shutdownAcknowledged
      && code === 0
      && signal === null
    )
    const failure = explicitFailure ?? this.terminalFailure ?? new IpythonRuntimeError(
      "IPYTHON_HOST_EXITED",
      expected
        ? "The Anybox IPython host stopped."
        : `The Anybox IPython host exited unexpectedly (code=${code ?? "none"}, signal=${signal ?? "none"}).${this.diagnostics ? ` ${this.diagnostics}` : ""}`,
      { stateLost: true },
    )
    if (!expected && !this.terminalFailure) this.terminalFailure = failure

    this.exited = true
    this.resolveExit?.()
    this.resolveExit = undefined
    this.handleProcessFailure(failure)
    this.readyReject = undefined
    this.readyResolve = undefined
    this.child?.stdin.destroy()
    this.child?.stdout.destroy()
    this.child?.stderr.destroy()
    const cleanup = this.shutdownAcknowledged
      ? this.cleanupRuntimeCache()
      : this.terminateKnownKernel().then(() => this.cleanupRuntimeCache())
    void cleanup.catch((error) => {
      log.error("host-exit-cleanup-failed", {
        sessionID: this.sessionID,
        kernelPid: this.kernelPid,
        error: errorMessage(error),
      })
    })
    if (!expected) {
      log.error("host-exit-failure", {
        sessionID: this.sessionID,
        code,
        signal,
        message: failure.message,
      })
    }
    this.options.onExit?.(this)
  }

  private finalizeAfterProcessAndStdout() {
    const processExit = this.processExit
    if (!processExit || !this.stdoutEnded) return
    // Waiting for host exit plus stdout EOF preserves the final protocol event
    // without being held open by a user subprocess that inherited host stderr.
    this.finalizeProcessExit(processExit.code, processExit.signal)
  }

  private async cleanupRuntimeCache() {
    const cacheDir = this.cacheDir
    if (!cacheDir) return
    if (!this.cacheCleanupPromise) {
      this.cacheCleanupPromise = rm(cacheDir, {
        recursive: true,
        force: true,
        // Windows can briefly retain Jupyter/runtime files after both Python
        // processes exit. fs.rm applies a bounded linear backoff for EBUSY,
        // EPERM, ENOTEMPTY, EMFILE, and ENFILE when recursive cleanup is used.
        maxRetries: 6,
        retryDelay: 100,
      }).catch((error) => {
        log.error("cache-cleanup-failed", {
          sessionID: this.sessionID,
          cacheDir,
          error: errorMessage(error),
        })
        throw error
      })
    }
    await this.cacheCleanupPromise
  }

  private handleEvent(event: IpythonHostEvent) {
    if (event.type === "kernel_started") {
      if (
        event.protocolVersion !== IPYTHON_HOST_PROTOCOL_VERSION
        || !Number.isSafeInteger(event.kernelPid)
        || event.kernelPid <= 0
      ) {
        this.handleProtocolFailure("The IPython host reported invalid kernel startup metadata.")
        return
      }
      this.kernelPid = event.kernelPid
      return
    }

    if (event.type === "ready") {
      if (event.protocolVersion !== IPYTHON_HOST_PROTOCOL_VERSION) {
        this.handleProtocolFailure(
          `IPython host protocol mismatch: expected ${IPYTHON_HOST_PROTOCOL_VERSION}, received ${event.protocolVersion}.`,
        )
        return
      }
      this.readyResolve?.({
        pythonVersion: event.pythonVersion,
        ipythonVersion: event.ipythonVersion,
        kernelPid: event.kernelPid,
      })
      this.kernelPid = event.kernelPid
      return
    }

    if (event.type === "fatal") {
      const error = new IpythonRuntimeError(
        "IPYTHON_HOST_PROTOCOL_ERROR",
        event.message?.trim() || "The IPython host reported a fatal error.",
        { stateLost: true },
      )
      // A fatal event always means the host/kernel transport is unusable,
      // even when the Python side can associate it with one request.
      this.failAndTerminate(error)
      return
    }

    if (event.type === "shutdown") {
      this.shutdownAcknowledged = true
      return
    }

    if (!("requestId" in event) || !event.requestId) return
    const state = this.pending.get(event.requestId)
    if (!state) return

    if (event.type !== "idle" && event.type !== "error") {
      state.outputEventCount += 1
      if (state.outputEventCount > MAX_OUTPUT_EVENTS_PER_EXECUTION) {
        state.truncated = true
        return
      }
    }

    switch (event.type) {
      case "stream": {
        const target = event.name === "stderr" ? "stderr" : "stdout"
        const appended = appendBounded(state[target], event.text ?? "", this.options.maxOutputChars)
        state[target] = appended.value
        state.truncated ||= appended.truncated || event.truncated === true
        break
      }
      case "display": {
        if (event.mime !== "text/plain" || typeof event.data !== "string") break
        const appended = appendBounded("", event.data, this.options.maxOutputChars)
        state.displays.push({ mime: "text/plain", data: appended.value })
        state.truncated ||= appended.truncated || event.truncated === true
        break
      }
      case "result": {
        const value = event.text ?? event.data ?? ""
        const current = state.resultParts.join("\n")
        const appended = appendBounded(current, value, this.options.maxOutputChars)
        state.resultParts = appended.value ? [appended.value] : []
        state.executionCount = event.executionCount ?? state.executionCount
        state.truncated ||= appended.truncated || event.truncated === true
        break
      }
      case "error": {
        state.error = {
          name: event.ename?.trim() || "PythonError",
          message: event.evalue ?? "Python execution failed.",
          traceback: Array.isArray(event.traceback) ? event.traceback.map(String) : [],
        }
        state.executionCount = event.executionCount ?? state.executionCount
        break
      }
      case "idle": {
        state.executionCount = event.executionCount ?? state.executionCount
        state.truncated ||= event.truncated === true
        this.resolveExecution(state, false, event.durationMs)
        break
      }
      default:
        break
    }
  }

  private cleanupExecution(state: PendingExecution) {
    if (state.timeout) clearTimeout(state.timeout)
    if (state.interruptGrace) clearTimeout(state.interruptGrace)
    if (state.abortSignal && state.abortListener) {
      state.abortSignal.removeEventListener("abort", state.abortListener)
    }
    this.pending.delete(state.requestId)
    if (this.activeRequestID === state.requestId) this.activeRequestID = undefined
  }

  private executionResult(
    state: PendingExecution,
    stateLost: boolean,
    durationMs?: number,
  ): IpythonExecutionResult {
    return {
      status: state.cancellation ?? (state.error ? "error" : "ok"),
      executionCount: state.executionCount,
      stdout: state.stdout,
      stderr: state.stderr,
      result: state.resultParts.length > 0 ? state.resultParts.join("\n") : undefined,
      displays: state.displays,
      error: state.error,
      durationMs: durationMs ?? Math.max(0, Date.now() - state.startedAt),
      kernelGeneration: this.generation,
      stateLost,
      outputTruncated: state.truncated,
    }
  }

  private resolveExecution(state: PendingExecution, stateLost: boolean, durationMs?: number) {
    this.cleanupExecution(state)
    state.resolve(this.executionResult(state, stateLost, durationMs))
  }

  private rejectExecution(state: PendingExecution, error: unknown) {
    this.cleanupExecution(state)
    state.reject(error)
  }

  private rejectPending(error: unknown) {
    for (const state of [...this.pending.values()]) this.rejectExecution(state, error)
  }

  private write(command: IpythonHostCommand) {
    const stdin = this.child?.stdin
    if (
      !stdin
      || stdin.destroyed
      || this.exited
      || this.terminalFailure
      || (this.closing && command.type !== "shutdown")
    ) {
      throw new IpythonRuntimeError(
        "IPYTHON_HOST_EXITED",
        "The Anybox IPython host is not running.",
        { stateLost: true },
      )
    }
    stdin.write(`${JSON.stringify(command)}\n`, (error) => {
      if (error) this.handlePipeFailure("stdin", error)
    })
  }

  private async startForExecution(signal?: AbortSignal) {
    if (signal?.aborted) return "aborted-before-start" as const
    const start = this.start()
    if (!signal) {
      await start
      return "ready" as const
    }

    return await new Promise<"ready" | "aborted-during-start">((resolve, reject) => {
      let settled = false
      const finish = (result: "ready" | "aborted-during-start") => {
        if (settled) return
        settled = true
        signal.removeEventListener("abort", onAbort)
        resolve(result)
      }
      const onAbort = () => {
        // shutdown() marks the worker as closing synchronously; startOnce then
        // either stops the spawned host or notices the tombstone before spawn.
        void this.shutdown().catch((error) => {
          log.error("startup-abort-cleanup-failed", {
            sessionID: this.sessionID,
            error: errorMessage(error),
          })
        })
        finish("aborted-during-start")
      }
      signal.addEventListener("abort", onAbort, { once: true })
      start.then(
        () => finish("ready"),
        (error) => {
          if (settled) return
          settled = true
          signal.removeEventListener("abort", onAbort)
          reject(error)
        },
      )
    })
  }

  async execute(input: { code: string; signal?: AbortSignal }) {
    const startedAt = Date.now()
    const startup = await this.startForExecution(input.signal)
    if (startup !== "ready") {
      return {
        status: "aborted",
        stdout: "",
        stderr: "",
        displays: [],
        durationMs: Math.max(0, Date.now() - startedAt),
        kernelGeneration: this.generation,
        stateLost: startup === "aborted-during-start",
        outputTruncated: false,
      } satisfies IpythonExecutionResult
    }
    // The startup promise and AbortSignal can settle in adjacent microtasks.
    // Re-check after startup so an already-cancelled call never reaches the
    // kernel merely because the ready event won that race.
    if (input.signal?.aborted) {
      return {
        status: "aborted",
        stdout: "",
        stderr: "",
        displays: [],
        durationMs: Math.max(0, Date.now() - startedAt),
        kernelGeneration: this.generation,
        stateLost: false,
        outputTruncated: false,
      } satisfies IpythonExecutionResult
    }
    if (this.closing || this.exited || this.terminalFailure) {
      throw this.terminalFailure ?? new IpythonRuntimeError(
        "IPYTHON_HOST_EXITED",
        "The Anybox IPython host is not running.",
        { stateLost: true },
      )
    }
    if (this.activeRequestID) {
      throw new IpythonRuntimeError(
        "IPYTHON_HOST_PROTOCOL_ERROR",
        "The IPython session attempted to execute more than one cell concurrently.",
      )
    }

    const requestId = randomUUID()
    const result = new Promise<IpythonExecutionResult>((resolve, reject) => {
      const state: PendingExecution = {
        requestId,
        startedAt: Date.now(),
        resolve,
        reject,
        stdout: "",
        stderr: "",
        resultParts: [],
        displays: [],
        outputEventCount: 0,
        truncated: false,
        abortSignal: input.signal,
      }
      this.pending.set(requestId, state)
      this.activeRequestID = requestId

      state.timeout = setTimeout(
        () => this.beginInterrupt(state, "timed_out"),
        this.options.cellTimeoutMs,
      )

      try {
        this.write({
          type: "execute",
          protocolVersion: IPYTHON_HOST_PROTOCOL_VERSION,
          requestId,
          code: input.code,
          maxOutputChars: this.options.maxOutputChars,
        })
      } catch (error) {
        this.rejectExecution(state, error)
        return
      }

      // Register cancellation after the execute frame has been written, then
      // re-check the signal to cover an abort between the earlier check and
      // listener registration. This preserves execute-before-interrupt order.
      if (input.signal && this.pending.has(requestId)) {
        state.abortListener = () => this.beginInterrupt(state, "aborted")
        input.signal.addEventListener("abort", state.abortListener, { once: true })
        if (input.signal.aborted) state.abortListener()
      }
    })

    return await result
  }

  private beginInterrupt(state: PendingExecution, reason: "aborted" | "timed_out") {
    if (!this.pending.has(state.requestId) || state.cancellation) return
    state.cancellation = reason
    try {
      this.write({
        type: "interrupt",
        protocolVersion: IPYTHON_HOST_PROTOCOL_VERSION,
        requestId: state.requestId,
      })
    } catch {
      this.resolveExecution(state, true)
      this.forceTerminate()
      return
    }
    state.interruptGrace = setTimeout(() => {
      if (!this.pending.has(state.requestId)) return
      this.resolveExecution(state, true)
      this.forceTerminate()
    }, this.options.interruptGraceMs)
  }

  async interruptActive() {
    if (!this.activeRequestID) return false
    const state = this.pending.get(this.activeRequestID)
    if (!state) return false
    this.beginInterrupt(state, "aborted")
    return true
  }

  async shutdown() {
    if (!this.shutdownPromise) this.shutdownPromise = this.shutdownOnce()
    await this.shutdownPromise
  }

  private async shutdownOnce() {
    this.closing = true
    if (!this.child || this.exited) {
      await this.cleanupAfterHostExit()
      return
    }

    for (const state of [...this.pending.values()]) {
      if (!state.cancellation) state.cancellation = "aborted"
      this.resolveExecution(state, true)
    }

    try {
      this.write({
        type: "shutdown",
        protocolVersion: IPYTHON_HOST_PROTOCOL_VERSION,
        requestId: randomUUID(),
      })
    } catch {
      this.forceTerminate()
      await this.waitForExit(IPYTHON_FORCE_EXIT_GRACE_MS)
      if (!this.exited) {
        await this.terminateKnownKernel()
        throw new IpythonRuntimeError(
          "IPYTHON_HOST_EXITED",
          "The Anybox IPython host did not exit after forced shutdown.",
          { stateLost: true },
        )
      }
      await this.cleanupAfterHostExit()
      return
    }

    if (await this.waitForExit(this.options.shutdownGraceMs)) {
      await this.cleanupAfterHostExit()
      return
    }
    this.forceTerminate()
    if (await this.waitForExit(IPYTHON_FORCE_EXIT_GRACE_MS)) {
      await this.cleanupAfterHostExit()
      return
    }

    await this.terminateKnownKernel()
    log.error("host-stop-timeout", {
      sessionID: this.sessionID,
      pid: this.child.pid,
      kernelPid: this.kernelPid,
    })
    throw new IpythonRuntimeError(
      "IPYTHON_HOST_EXITED",
      "The Anybox IPython host did not exit after forced shutdown.",
      { stateLost: true },
    )
  }

  private async cleanupAfterHostExit() {
    if (!this.shutdownAcknowledged) await this.terminateKnownKernel()
    await this.cleanupRuntimeCache()
  }

  private async waitForExit(timeoutMs: number) {
    if (this.exited) return true
    const exited = this.exitPromise
    if (!exited) return false
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      exited,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs)
      }),
    ])
    if (timer) clearTimeout(timer)
    return this.exited
  }

  private forceTerminate() {
    this.closing = true
    const child = this.child
    if (!child || this.exited) return

    if (process.platform !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM")
      } catch {
        terminateProcessTree({ pid: child.pid, kill: (signal) => child.kill(signal) })
      }
      setTimeout(() => {
        if (this.exited || !child.pid) return
        try {
          process.kill(-child.pid, "SIGKILL")
        } catch {
          try {
            child.kill("SIGKILL")
          } catch {
            // The process already exited.
          }
        }
      }, HOST_FORCE_KILL_GRACE_MS).unref?.()
      return
    }

    if (child.pid && !this.hostTerminationPromise) {
      this.hostTerminationPromise = this.runWindowsTaskkill(child.pid).then((confirmed) => {
        this.hostTreeTerminationConfirmed = confirmed
        if (!confirmed && !this.exited) {
          try {
            child.kill("SIGKILL")
          } catch {
            // The process already exited.
          }
        }
        return confirmed
      })
    }
    setTimeout(() => {
      if (this.exited) return
      try {
        child.kill("SIGKILL")
      } catch {
        // The process already exited.
      }
    }, HOST_FORCE_KILL_GRACE_MS).unref?.()
  }

  private terminateKnownKernel() {
    if (this.kernelTerminationPromise) return this.kernelTerminationPromise
    const pid = this.kernelPid
    if (!pid) {
      if (!this.hostTerminationPromise) return Promise.resolve()
      return this.hostTerminationPromise.then((confirmed) => {
        if (!confirmed) {
          throw new IpythonRuntimeError(
            "IPYTHON_HOST_EXITED",
            "Unable to confirm that the Anybox IPython host process tree stopped.",
            { stateLost: true },
          )
        }
      })
    }

    const termination = this.terminateKnownKernelOnce(pid).then(() => {
      if (this.kernelPid === pid) this.kernelPid = undefined
    })
    this.kernelTerminationPromise = termination
    return termination
  }

  private async terminateKnownKernelOnce(pid: number) {
    if (process.platform === "win32") {
      // A successful, awaited taskkill /T is the only Windows API used here
      // that confirms the known kernel tree was enumerated and terminated.
      // If the parent disappeared first, fail closed instead of starting a new
      // generation beside descendants we can no longer identify.
      if (this.hostTerminationPromise) await this.hostTerminationPromise
      if (!processTargetAlive(pid) && this.hostTreeTerminationConfirmed) return
      if (!processTargetAlive(pid)) {
        throw new IpythonRuntimeError(
          "IPYTHON_HOST_EXITED",
          `IPython kernel PID ${pid} exited before its process tree could be confirmed stopped.`,
          { stateLost: true },
        )
      }
      const killed = await this.runWindowsTaskkill(pid)
      if (!killed || !(await waitForProcessTargetsToExit([pid], KERNEL_TERMINATION_TIMEOUT_MS))) {
        throw new IpythonRuntimeError(
          "IPYTHON_HOST_EXITED",
          `Unable to confirm that IPython kernel tree PID ${pid} stopped.`,
          { stateLost: true },
        )
      }
      return
    }

    const groupTarget = -pid
    if (!processTargetAlive(groupTarget) && !processTargetAlive(pid)) return
    try {
      process.kill(groupTarget, "SIGTERM")
    } catch {
      try {
        process.kill(pid, "SIGTERM")
      } catch {
        // Confirmation below decides whether cleanup succeeded.
      }
    }
    if (await waitForProcessTargetsToExit([groupTarget, pid], KERNEL_FORCE_KILL_GRACE_MS)) return

    try {
      process.kill(groupTarget, "SIGKILL")
    } catch {
      try {
        process.kill(pid, "SIGKILL")
      } catch {
        // Confirmation below decides whether cleanup succeeded.
      }
    }
    if (await waitForProcessTargetsToExit([groupTarget, pid], KERNEL_TERMINATION_TIMEOUT_MS)) return
    throw new IpythonRuntimeError(
      "IPYTHON_HOST_EXITED",
      `Unable to confirm that IPython kernel process group ${pid} stopped.`,
      { stateLost: true },
    )
  }

  private async runWindowsTaskkill(pid: number) {
    return await new Promise<boolean>((resolve) => {
      let settled = false
      let killer: ReturnType<typeof spawnChild>
      const finish = (value: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve(value)
      }
      const timeout = setTimeout(() => {
        try {
          killer.kill()
        } catch {
          // The helper already exited.
        }
        finish(false)
      }, WINDOWS_TASKKILL_TIMEOUT_MS)
      try {
        killer = spawnChild("taskkill", ["/pid", String(pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        })
      } catch {
        finish(false)
        return
      }
      killer.once("error", () => finish(false))
      killer.once("close", (code) => finish(code === 0))
    })
  }
}
