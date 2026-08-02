import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import * as Identifier from "#id/id.ts"
import { PtyBuffer } from "#pty/buffer.ts"
import { terminateProcessTree } from "#shell/terminate.ts"

export type ShellTaskStatus = "running" | "exited" | "deleted"
export type ShellTaskOutputStream = "stdout" | "stderr"

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
  stdoutTruncated: boolean
  stderrTruncated: boolean
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
  }): ShellTaskRuntimeHandle
}

function createShellTaskRuntimeHandle(child: ChildProcessWithoutNullStreams): ShellTaskRuntimeHandle {
  const outputListeners = new Set<(event: ShellTaskOutputEvent) => void>()
  const exitListeners = new Set<(event: { exitCode: number | null; signal: NodeJS.Signals | null }) => void>()
  let finished = false

  const emitOutput = (stream: ShellTaskOutputStream, data: string) => {
    if (!data) return
    for (const listener of [...outputListeners]) {
      listener({ stream, data })
    }
  }

  const emitExit = (event: { exitCode: number | null; signal: NodeJS.Signals | null }) => {
    if (finished) return
    finished = true
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

  child.stdin.on("error", (error) => {
    emitOutput("stderr", `Failed to write process stdin: ${error.message}\n`)
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
      if (finished || child.stdin.destroyed || !child.stdin.writable) {
        throw new Error("Shell task stdin is unavailable")
      }
      child.stdin.write(data)
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
      return () => {
        outputListeners.delete(listener)
      }
    },
    onExit(listener) {
      exitListeners.add(listener)
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
        windowsHide: true,
      })

      return createShellTaskRuntimeHandle(child)
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

function createManagedShellTask(
  input: {
    id: string
    ownerSessionID?: string
    title?: string
    command: string
    cwd: string
    shell: string
    executable: string
    args: string[]
    env?: NodeJS.ProcessEnv
    bufferChars: number
    maxOutputChars: number
    timeoutMs?: number
    runtime: ShellTaskRuntimeAdapter
    now: () => number
    onExited?: (task: ShellTaskInfo) => void
    onDeleted?: (task: ShellTaskInfo) => void
  },
): ManagedShellTask {
  const buffer = new PtyBuffer(input.bufferChars)
  let stdout = ""
  let stderr = ""
  let stdoutTruncated = false
  let stderrTruncated = false
  const createdAt = input.now()
  let info: ShellTaskInfo = {
    id: input.id,
    ownerSessionID: input.ownerSessionID ?? null,
    title: input.title?.trim() || defaultTitle(input.command),
    command: input.command,
    cwd: input.cwd,
    shell: input.shell,
    status: "running",
    exitCode: null,
    signal: null,
    createdAt,
    updatedAt: createdAt,
    cursor: 0,
    timedOut: false,
  }
  let cleaned = false
  const runtime = input.runtime.spawn({
    executable: input.executable,
    args: input.args,
    cwd: input.cwd,
    env: input.env,
  })
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
    const current = stream === "stdout" ? stdout : stderr
    const remaining = input.maxOutputChars - current.length
    const retained = remaining > 0 ? data.slice(0, remaining) : ""
    const truncated = retained.length < data.length

    if (stream === "stdout") {
      stdout += retained
      stdoutTruncated ||= truncated
    } else {
      stderr += retained
      stderrTruncated ||= truncated
    }
  }

  function result(): ShellTaskResult {
    return {
      ...serialize(),
      stdout,
      stderr,
      stdoutTruncated,
      stderrTruncated,
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

  if (input.timeoutMs !== undefined) {
    timeoutTimer = setTimeout(() => {
      timeoutTimer = null
      if (cleaned || info.status !== "running") return
      updateInfo({
        timedOut: true,
        cursor: buffer.cursor,
      })
      runtime.kill()
    }, input.timeoutMs)
    timeoutTimer.unref?.()
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
            clearInterruptFallbackTimer()
            interruptFallbackTimer = setTimeout(() => {
              interruptFallbackTimer = null
              if (!cleaned && info.status === "running") {
                runtime.kill()
              }
            }, 1_000)
            interruptFallbackTimer.unref?.()
          } else {
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
    async stop() {
      if (info.status === "deleted") return serialize()
      const wasExited = info.status === "exited"

      updateInfo({
        status: "deleted",
        cursor: buffer.cursor,
      })
      input.onDeleted?.(serialize())
      if (!cleaned && !wasExited) {
        runtime.kill()
        await Promise.race([
          exitPromise,
          new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 1_000)
            timer.unref?.()
          }),
        ])
      }
      const task = serialize()
      this.dispose()
      return task
    },
    dispose() {
      if (cleaned) return
      cleaned = true
      clearTimeoutTimer()
      clearInterruptFallbackTimer()
      onOutputDispose?.()
      onExitDispose?.()
      onOutputDispose = null
      onExitDispose = null
      if (info.status === "running") {
        runtime.kill()
      }
    },
  }
}

export class ShellTaskRegistry {
  private readonly tasks = new Map<string, ManagedShellTask>()
  private readonly pruneTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly runtime: ShellTaskRuntimeAdapter
  private readonly now: () => number
  private readonly bufferChars: number
  private readonly exitRetentionMs: number
  private readonly deleteRetentionMs: number

  constructor(options: ShellTaskRegistryOptions = {}) {
    this.runtime = options.runtime ?? createShellTaskRuntimeAdapter()
    this.now = options.now ?? Date.now
    this.bufferChars = options.bufferChars ?? DEFAULT_BUFFER_CHARS
    this.exitRetentionMs = options.exitRetentionMs ?? DEFAULT_EXIT_RETENTION_MS
    this.deleteRetentionMs = options.deleteRetentionMs ?? DEFAULT_DELETE_RETENTION_MS
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

  start(input: {
    ownerSessionID?: string
    title?: string
    command: string
    cwd: string
    shell: string
    executable: string
    args: string[]
    env?: NodeJS.ProcessEnv
    maxOutputChars: number
    timeoutMs?: number
  }) {
    const id = Identifier.descending("task")
    const task = createManagedShellTask({
      id,
      ownerSessionID: input.ownerSessionID,
      title: input.title,
      command: input.command,
      cwd: input.cwd,
      shell: input.shell,
      executable: input.executable,
      args: input.args,
      env: input.env,
      bufferChars: this.bufferChars,
      maxOutputChars: input.maxOutputChars,
      timeoutMs: input.timeoutMs,
      runtime: this.runtime,
      now: this.now,
      onExited: (info) => {
        this.schedulePrune(info.id, this.exitRetentionMs)
      },
      onDeleted: (info) => {
        this.schedulePrune(info.id, this.deleteRetentionMs)
      },
    })

    this.tasks.set(id, task)
    return task.info()
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
