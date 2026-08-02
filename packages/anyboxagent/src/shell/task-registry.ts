import os from "node:os"
import { spawn, type ChildProcessByStdio } from "node:child_process"
import type { Readable } from "node:stream"
import * as Identifier from "#id/id.ts"
import { PtyBuffer } from "#pty/buffer.ts"
import {
  createNodePtyRuntimeAdapter,
  DEFAULT_PTY_COLS,
  DEFAULT_PTY_ROWS,
  type PtyRuntimeAdapter,
  type PtyRuntimeHandle,
} from "#pty/runtime.ts"
import { terminateProcessTree } from "#shell/terminate.ts"

export type ShellTaskStatus = "running" | "exited" | "deleted"
export type ShellTaskOutputStream = "stdout" | "stderr" | "terminal"

export interface ShellTaskOutputEvent {
  stream: ShellTaskOutputStream
  data: string
}

export interface ShellTaskInfo {
  id: string
  ownerSessionID: string | null
  title: string
  command: string
  cwd: string
  shell: string
  tty: boolean
  status: ShellTaskStatus
  exitCode: number | null
  signal: NodeJS.Signals | null
  createdAt: number
  updatedAt: number
  cursor: number
  timedOut: boolean
}

export interface ShellTaskResult extends ShellTaskInfo {
  stdout: string
  stderr: string
  terminalOutput: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
  terminalOutputTruncated: boolean
}

export interface ShellTaskReplay {
  mode: "delta" | "reset"
  output: string
  cursor: number
  startCursor: number
}

export interface ShellTaskReadResult {
  task: ShellTaskInfo
  replay: ShellTaskReplay
}

export interface ShellTaskInteractionResult extends ShellTaskReadResult {
  wallTimeMs: number
}

export interface ShellTaskRuntimeHandle {
  readonly pid: number | null
  write(data: string): void
  interrupt(): void
  kill(): void
  onOutput(listener: (event: ShellTaskOutputEvent) => void): () => void
  onExit(listener: (event: { exitCode: number | null; signal: NodeJS.Signals | null }) => void): () => void
}

export interface ShellTaskRuntimeAdapter {
  spawn(input: {
    executable: string
    args: string[]
    cwd: string
    env?: NodeJS.ProcessEnv
  }): ShellTaskRuntimeHandle | Promise<ShellTaskRuntimeHandle>
}

type PipeShellChild = ChildProcessByStdio<null, Readable, Readable>

function createShellTaskRuntimeHandle(child: PipeShellChild): ShellTaskRuntimeHandle {
  const outputListeners = new Set<(event: ShellTaskOutputEvent) => void>()
  const exitListeners = new Set<(event: { exitCode: number | null; signal: NodeJS.Signals | null }) => void>()
  const pendingOutput: ShellTaskOutputEvent[] = []
  let finished = false
  let retainedExitEvent: { exitCode: number | null; signal: NodeJS.Signals | null } | null = null

  const emitOutput = (stream: ShellTaskOutputStream, data: string) => {
    if (!data) return
    if (outputListeners.size === 0) {
      pendingOutput.push({ stream, data })
      return
    }
    for (const listener of [...outputListeners]) {
      listener({ stream, data })
    }
  }

  const emitExit = (event: { exitCode: number | null; signal: NodeJS.Signals | null }) => {
    if (finished) return
    finished = true
    retainedExitEvent = event
    for (const listener of [...exitListeners]) {
      listener(event)
    }
  }

  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (chunk: string) => {
    emitOutput("stdout", chunk)
  })

  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk: string) => {
    emitOutput("stderr", chunk)
  })

  child.once("exit", (code, signal) => {
    emitExit({
      exitCode: typeof code === "number" ? code : null,
      signal,
    })
  })

  child.once("error", (error) => {
    emitOutput("stderr", `Failed to start process: ${error.message}\n`)
    emitExit({
      exitCode: null,
      signal: null,
    })
  })

  return {
    get pid() {
      return child.pid ?? null
    },
    write(data) {
      void data
      throw new Error("Pipe shell tasks do not accept stdin; restart the command with tty=true for interactive input")
    },
    interrupt() {
      if (finished) return
      if (process.platform === "win32") {
        terminateProcessTree(child)
        return
      }

      if (!child.kill("SIGINT")) {
        terminateProcessTree(child)
      }
    },
    kill() {
      terminateProcessTree(child)
    },
    onOutput(listener) {
      outputListeners.add(listener)
      if (pendingOutput.length > 0) {
        const replay = pendingOutput.splice(0)
        for (const event of replay) listener(event)
      }
      return () => {
        outputListeners.delete(listener)
      }
    },
    onExit(listener) {
      exitListeners.add(listener)
      if (retainedExitEvent) {
        const event = retainedExitEvent
        queueMicrotask(() => {
          if (exitListeners.has(listener)) listener(event)
        })
      }
      return () => {
        exitListeners.delete(listener)
      }
    },
  }
}

export function createShellTaskRuntimeAdapter(): ShellTaskRuntimeAdapter {
  return {
    spawn(input) {
      const child = spawn(input.executable, input.args, {
        cwd: input.cwd,
        ...(input.env ? { env: input.env } : {}),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      })

      return createShellTaskRuntimeHandle(child)
    },
  }
}

function signalName(signal: number | undefined): NodeJS.Signals | null {
  if (!signal) return null
  for (const [name, value] of Object.entries(os.constants.signals)) {
    if (value === signal) return name as NodeJS.Signals
  }
  return null
}

function createPtyShellTaskRuntimeHandle(pty: PtyRuntimeHandle): ShellTaskRuntimeHandle {
  return {
    get pid() {
      return pty.pid
    },
    write(data) {
      pty.write(data)
    },
    interrupt() {
      pty.write("\x03")
    },
    kill() {
      pty.kill()
    },
    onOutput(listener) {
      return pty.onData((data) => listener({ stream: "terminal", data }))
    },
    onExit(listener) {
      return pty.onExit((event) => {
        listener({
          exitCode: event.exitCode,
          signal: signalName(event.signal),
        })
      })
    },
  }
}

interface ManagedShellTask {
  info(): ShellTaskInfo
  result(): ShellTaskResult
  read(cursor?: number | null): ShellTaskReadResult
  acknowledge(cursor: number): ShellTaskInfo
  interact(input: { data: string; yieldTimeMs: number; abort?: AbortSignal }): Promise<ShellTaskInteractionResult>
  wait(yieldTimeMs: number): Promise<ShellTaskResult>
  stop(): Promise<ShellTaskInfo>
  dispose(): void
}

export interface ShellTaskRegistryOptions {
  runtime?: ShellTaskRuntimeAdapter
  pipeRuntime?: ShellTaskRuntimeAdapter
  ptyRuntime?: PtyRuntimeAdapter
  ptyRuntimeFactory?: () => PtyRuntimeAdapter
  now?: () => number
  bufferChars?: number
  exitRetentionMs?: number
  deleteRetentionMs?: number
}

const DEFAULT_BUFFER_CHARS = 200_000
const DEFAULT_EXIT_RETENTION_MS = 5 * 60 * 1000
const DEFAULT_DELETE_RETENTION_MS = 15_000

function defaultTitle(command: string) {
  const collapsed = command.replace(/\s+/g, " ").trim()
  if (collapsed.length <= 80) return collapsed
  return `${collapsed.slice(0, 77)}...`
}

async function createManagedShellTask(
  input: {
    id: string
    ownerSessionID?: string
    title?: string
    command: string
    cwd: string
    shell: string
    tty: boolean
    executable: string
    args: string[]
    env?: NodeJS.ProcessEnv
    bufferChars: number
    maxOutputChars: number
    timeoutMs?: number
    runtime: ShellTaskRuntimeAdapter
    abort?: AbortSignal
    now: () => number
    onExited?: (task: ShellTaskInfo) => void
    onDeleted?: (task: ShellTaskInfo) => void
  },
): Promise<ManagedShellTask> {
  const buffer = new PtyBuffer(input.bufferChars)
  let stdout = ""
  let stderr = ""
  let terminalOutput = ""
  let stdoutTruncated = false
  let stderrTruncated = false
  let terminalOutputTruncated = false
  const createdAt = input.now()
  let info: ShellTaskInfo = {
    id: input.id,
    ownerSessionID: input.ownerSessionID ?? null,
    title: input.title?.trim() || defaultTitle(input.command),
    command: input.command,
    cwd: input.cwd,
    shell: input.shell,
    tty: input.tty,
    status: "running",
    exitCode: null,
    signal: null,
    createdAt,
    updatedAt: createdAt,
    cursor: 0,
    timedOut: false,
  }
  let cleaned = false
  const runtime = await input.runtime.spawn({
    executable: input.executable,
    args: input.args,
    cwd: input.cwd,
    env: input.env,
  })
  if (input.abort?.aborted) {
    try {
      runtime.kill()
    } catch {
      // The process may have exited while the async backend was starting.
    }
    throw new Error("Shell task start was cancelled")
  }
  let onOutputDispose: (() => void) | null = null
  let onExitDispose: (() => void) | null = null
  let resolveExit: (() => void) | null = null
  const exitPromise = new Promise<void>((resolve) => {
    resolveExit = resolve
  })
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null
  let interruptFallbackTimer: ReturnType<typeof setTimeout> | null = null
  let deliveredCursor = 0
  let interactionQueue: Promise<void> = Promise.resolve()
  let stopPromise: Promise<ShellTaskInfo> | null = null

  function serialize() {
    return { ...info }
  }

  function updateInfo(next: Partial<ShellTaskInfo>) {
    info = {
      ...info,
      ...next,
      updatedAt: next.updatedAt ?? input.now(),
    }
    return serialize()
  }

  function appendOutput(stream: ShellTaskOutputStream, data: string) {
    const current = stream === "stdout"
      ? stdout
      : stream === "stderr"
        ? stderr
        : terminalOutput
    const remaining = input.maxOutputChars - current.length
    const retained = remaining > 0 ? data.slice(0, remaining) : ""
    const truncated = retained.length < data.length

    if (stream === "stdout") {
      stdout += retained
      stdoutTruncated ||= truncated
    } else if (stream === "stderr") {
      stderr += retained
      stderrTruncated ||= truncated
    } else {
      terminalOutput += retained
      terminalOutputTruncated ||= truncated
    }
  }

  function result(): ShellTaskResult {
    return {
      ...serialize(),
      stdout,
      stderr,
      terminalOutput,
      stdoutTruncated,
      stderrTruncated,
      terminalOutputTruncated,
    }
  }

  function clearTimeoutTimer() {
    if (!timeoutTimer) return
    clearTimeout(timeoutTimer)
    timeoutTimer = null
  }

  function clearInterruptFallbackTimer() {
    if (!interruptFallbackTimer) return
    clearTimeout(interruptFallbackTimer)
    interruptFallbackTimer = null
  }

  async function waitForExit(yieldTimeMs: number, abort?: AbortSignal) {
    if (info.status !== "running" || yieldTimeMs <= 0 || abort?.aborted) return

    let yieldTimer: ReturnType<typeof setTimeout> | null = null
    let onAbort: (() => void) | null = null
    await Promise.race([
      exitPromise,
      new Promise<void>((resolve) => {
        yieldTimer = setTimeout(resolve, yieldTimeMs)
        yieldTimer.unref?.()
      }),
      new Promise<void>((resolve) => {
        if (!abort) return
        onAbort = resolve
        abort.addEventListener("abort", onAbort, { once: true })
      }),
    ])
    if (yieldTimer) clearTimeout(yieldTimer)
    if (onAbort) abort?.removeEventListener("abort", onAbort)
  }

  function enqueueInteraction<T>(fn: () => Promise<T>) {
    const next = interactionQueue.catch(() => undefined).then(fn)
    interactionQueue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  try {
    onOutputDispose = runtime.onOutput(({ stream, data }) => {
      if (cleaned || !data) return
      const cursor = buffer.append(data)
      appendOutput(stream, data)
      updateInfo({ cursor })
    })

    onExitDispose = runtime.onExit((event) => {
      resolveExit?.()
      clearTimeoutTimer()
      clearInterruptFallbackTimer()
      if (cleaned) return
      if (info.status === "deleted") {
        updateInfo({
          exitCode: event.exitCode,
          signal: event.signal,
          cursor: buffer.cursor,
        })
        return
      }
      if (info.status === "exited") return
      const task = updateInfo({
        status: "exited",
        exitCode: event.exitCode,
        signal: event.signal,
        cursor: buffer.cursor,
      })
      input.onExited?.(task)
    })
  } catch (error) {
    onOutputDispose?.()
    try {
      runtime.kill()
    } catch {
      // Preserve the listener setup failure as the actionable error.
    }
    throw error
  }

  if (input.timeoutMs !== undefined) {
    timeoutTimer = setTimeout(() => {
      timeoutTimer = null
      if (cleaned || info.status !== "running") return
      updateInfo({
        timedOut: true,
        cursor: buffer.cursor,
      })
      try {
        runtime.kill()
      } catch {
        // The task may already be exiting.
      }
    }, input.timeoutMs)
    timeoutTimer.unref?.()
  }

  function dispose() {
    if (cleaned) return
    cleaned = true
    clearTimeoutTimer()
    clearInterruptFallbackTimer()
    onOutputDispose?.()
    onExitDispose?.()
    onOutputDispose = null
    onExitDispose = null
    if (info.status === "running") {
      try {
        runtime.kill()
      } catch {
        // Disposing is best-effort after the runtime has already failed.
      }
    }
  }

  return {
    info() {
      return serialize()
    },
    result,
    read(cursor) {
      const replay = buffer.replayFrom(cursor)
      return {
        task: serialize(),
        replay: {
          mode: replay.mode,
          output: replay.buffer,
          cursor: replay.cursor,
          startCursor: replay.startCursor,
        },
      }
    },
    acknowledge(cursor) {
      const normalizedCursor = Math.max(0, Math.min(cursor, buffer.cursor))
      deliveredCursor = Math.max(deliveredCursor, normalizedCursor)
      return serialize()
    },
    interact(interaction) {
      return enqueueInteraction(async () => {
        if (info.status === "deleted") {
          throw new Error(`Shell task '${info.id}' is no longer available`)
        }

        const startedAt = input.now()
        if (interaction.data && !interaction.abort?.aborted) {
          if (info.status !== "running") {
            throw new Error(`Shell task '${info.id}' is not running`)
          }

          if (interaction.data === "\x03") {
            runtime.interrupt()
            if (!info.tty) {
              clearInterruptFallbackTimer()
              interruptFallbackTimer = setTimeout(() => {
                interruptFallbackTimer = null
                if (!cleaned && info.status === "running") {
                  try {
                    runtime.kill()
                  } catch {
                    // The process may have exited after ignoring the first interrupt.
                  }
                }
              }, 1_000)
              interruptFallbackTimer.unref?.()
            }
          } else {
            if (!info.tty) {
              throw new Error("Pipe shell sessions do not accept ordinary stdin; restart the command with tty=true")
            }
            runtime.write(interaction.data)
          }
        }

        await waitForExit(interaction.yieldTimeMs, interaction.abort)
        const replay = buffer.replayFrom(deliveredCursor)
        deliveredCursor = replay.cursor
        return {
          task: serialize(),
          replay: {
            mode: replay.mode,
            output: replay.buffer,
            cursor: replay.cursor,
            startCursor: replay.startCursor,
          },
          wallTimeMs: Math.max(0, input.now() - startedAt),
        }
      })
    },
    async wait(yieldTimeMs) {
      await waitForExit(yieldTimeMs)
      return result()
    },
    stop() {
      if (stopPromise) return stopPromise
      stopPromise = (async () => {
        if (info.status === "deleted") return serialize()
        const wasExited = info.status === "exited"

        updateInfo({
          status: "deleted",
          cursor: buffer.cursor,
        })
        input.onDeleted?.(serialize())
        if (!cleaned && !wasExited) {
          try {
            runtime.kill()
          } catch {
            // The task may already be exiting.
          }
          await Promise.race([
            exitPromise,
            new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, 1_000)
              timer.unref?.()
            }),
          ])
        }
        const task = serialize()
        dispose()
        return task
      })()
      return stopPromise
    },
    dispose,
  }
}

export class ShellTaskRegistry {
  private readonly tasks = new Map<string, ManagedShellTask>()
  private readonly pruneTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly pendingStarts = new Set<Promise<ShellTaskInfo>>()
  private readonly pipeRuntime: ShellTaskRuntimeAdapter
  private ptyRuntime: PtyRuntimeAdapter | undefined
  private readonly ptyRuntimeFactory: () => PtyRuntimeAdapter
  private readonly now: () => number
  private readonly bufferChars: number
  private readonly exitRetentionMs: number
  private readonly deleteRetentionMs: number
  private disposing = false

  constructor(options: ShellTaskRegistryOptions = {}) {
    this.pipeRuntime = options.pipeRuntime ?? options.runtime ?? createShellTaskRuntimeAdapter()
    this.ptyRuntime = options.ptyRuntime
    this.ptyRuntimeFactory = options.ptyRuntimeFactory ?? createNodePtyRuntimeAdapter
    this.now = options.now ?? Date.now
    this.bufferChars = options.bufferChars ?? DEFAULT_BUFFER_CHARS
    this.exitRetentionMs = options.exitRetentionMs ?? DEFAULT_EXIT_RETENTION_MS
    this.deleteRetentionMs = options.deleteRetentionMs ?? DEFAULT_DELETE_RETENTION_MS
  }

  private getPtyRuntime() {
    if (!this.ptyRuntime) {
      this.ptyRuntime = this.ptyRuntimeFactory()
    }
    return this.ptyRuntime
  }

  private schedulePrune(id: string, delayMs: number) {
    const existing = this.pruneTimers.get(id)
    if (existing) {
      clearTimeout(existing)
    }

    const timer = setTimeout(() => {
      const task = this.tasks.get(id)
      if (!task) return
      this.tasks.delete(id)
      this.pruneTimers.delete(id)
      task.dispose()
    }, delayMs)
    timer.unref?.()
    this.pruneTimers.set(id, timer)
  }

  async start(input: {
    ownerSessionID?: string
    title?: string
    command: string
    cwd: string
    shell: string
    tty?: boolean
    executable: string
    args: string[]
    env?: NodeJS.ProcessEnv
    maxOutputChars: number
    timeoutMs?: number
    abort?: AbortSignal
  }) {
    if (this.disposing) {
      throw new Error("Shell task registry is shutting down")
    }
    const id = Identifier.descending("task")
    const tty = input.tty ?? false
    const runtime: ShellTaskRuntimeAdapter = tty
      ? {
          spawn: async (spawnInput) => {
            const handle = await this.getPtyRuntime().spawn({
              executable: spawnInput.executable,
              args: spawnInput.args,
              cwd: spawnInput.cwd,
              env: spawnInput.env ?? process.env,
              cols: DEFAULT_PTY_COLS,
              rows: DEFAULT_PTY_ROWS,
            })
            return createPtyShellTaskRuntimeHandle(handle)
          },
        }
      : this.pipeRuntime
    const operation = (async () => {
      const task = await createManagedShellTask({
        id,
        ownerSessionID: input.ownerSessionID,
        title: input.title,
        command: input.command,
        cwd: input.cwd,
        shell: input.shell,
        tty,
        executable: input.executable,
        args: input.args,
        env: input.env,
        bufferChars: this.bufferChars,
        maxOutputChars: input.maxOutputChars,
        timeoutMs: input.timeoutMs,
        runtime,
        abort: input.abort,
        now: this.now,
        onExited: (info) => {
          this.schedulePrune(info.id, this.exitRetentionMs)
        },
        onDeleted: (info) => {
          this.schedulePrune(info.id, this.deleteRetentionMs)
        },
      })

      if (this.disposing) {
        await task.stop()
        throw new Error("Shell task registry shut down while the task was starting")
      }
      this.tasks.set(id, task)
      return task.info()
    })()
    this.pendingStarts.add(operation)
    try {
      return await operation
    } finally {
      this.pendingStarts.delete(operation)
    }
  }

  info(id: string, ownerSessionID?: string) {
    return this.accessibleTask(id, ownerSessionID)?.info() ?? null
  }

  private accessibleTask(id: string, ownerSessionID?: string) {
    const task = this.tasks.get(id)
    if (!task) return null
    const owner = task.info().ownerSessionID
    if (owner && owner !== ownerSessionID) return null
    return task
  }

  read(id: string, cursor?: number | null, ownerSessionID?: string) {
    return this.accessibleTask(id, ownerSessionID)?.read(cursor) ?? null
  }

  result(id: string, ownerSessionID?: string) {
    return this.accessibleTask(id, ownerSessionID)?.result() ?? null
  }

  acknowledge(id: string, cursor: number, ownerSessionID?: string) {
    return this.accessibleTask(id, ownerSessionID)?.acknowledge(cursor) ?? null
  }

  async interact(input: {
    id: string
    ownerSessionID?: string
    data: string
    yieldTimeMs: number
    abort?: AbortSignal
  }) {
    const task = this.accessibleTask(input.id, input.ownerSessionID)
    if (!task || task.info().status === "deleted") return null
    return await task.interact({
      data: input.data,
      yieldTimeMs: input.yieldTimeMs,
      abort: input.abort,
    })
  }

  async wait(id: string, yieldTimeMs: number, ownerSessionID?: string) {
    const task = this.accessibleTask(id, ownerSessionID)
    if (!task) return null
    return await task.wait(yieldTimeMs)
  }

  take(id: string, ownerSessionID?: string) {
    const task = this.accessibleTask(id, ownerSessionID)
    if (!task) return null

    const timer = this.pruneTimers.get(id)
    if (timer) clearTimeout(timer)
    this.pruneTimers.delete(id)
    this.tasks.delete(id)
    const result = task.result()
    task.dispose()
    return result
  }

  async stop(id: string, ownerSessionID?: string) {
    const task = this.accessibleTask(id, ownerSessionID)
    if (!task) return null
    return await task.stop()
  }

  async stopByOwnerSession(ownerSessionID: string) {
    const tasks = [...this.tasks.values()].filter((task) => task.info().ownerSessionID === ownerSessionID)
    return await Promise.all(tasks.map((task) => task.stop()))
  }

  async disposeAll() {
    this.disposing = true
    await Promise.allSettled([...this.pendingStarts])
    const tasks = [...this.tasks.values()]
    const results = await Promise.allSettled(tasks.map((task) => task.stop()))
    for (const timer of this.pruneTimers.values()) clearTimeout(timer)
    this.pruneTimers.clear()
    this.tasks.clear()
    for (const task of tasks) task.dispose()
    const stopped: ShellTaskInfo[] = []
    const errors: unknown[] = []
    for (const result of results) {
      if (result.status === "fulfilled") stopped.push(result.value)
      else errors.push(result.reason)
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to stop every managed shell task")
    }
    return stopped
  }
}

let activeShellTaskRegistry: ShellTaskRegistry | undefined

export function getShellTaskRegistry() {
  if (!activeShellTaskRegistry) {
    activeShellTaskRegistry = new ShellTaskRegistry()
  }

  return activeShellTaskRegistry
}

export function createShellTaskRegistry(options?: ShellTaskRegistryOptions) {
  return new ShellTaskRegistry(options)
}

export async function disposeShellTaskRegistry() {
  const registry = activeShellTaskRegistry
  if (!registry) return []
  try {
    return await registry.disposeAll()
  } finally {
    if (activeShellTaskRegistry === registry) {
      activeShellTaskRegistry = undefined
    }
  }
}
