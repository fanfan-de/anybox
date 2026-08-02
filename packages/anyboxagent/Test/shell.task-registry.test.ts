import { describe, expect, it } from "bun:test"
import {
  createShellTaskRegistry,
  type ShellTaskOutputEvent,
  type ShellTaskRuntimeAdapter,
  type ShellTaskRuntimeHandle,
} from "#shell/task-registry.ts"
import type { PtyRuntimeHandle, PtyRuntimeSpawnInput } from "#pty/runtime.ts"

class FakeShellTaskHandle implements ShellTaskRuntimeHandle {
  readonly pid = 42
  killed = 0
  interrupted = 0
  writes: string[] = []
  private readonly outputListeners = new Set<(event: ShellTaskOutputEvent) => void>()
  private readonly exitListeners = new Set<(
    event: { exitCode: number | null; signal: NodeJS.Signals | null },
  ) => void>()

  kill() {
    this.killed += 1
  }

  write(data: string) {
    this.writes.push(data)
  }

  interrupt() {
    this.interrupted += 1
  }

  onOutput(listener: (event: ShellTaskOutputEvent) => void) {
    this.outputListeners.add(listener)
    return () => this.outputListeners.delete(listener)
  }

  onExit(listener: (event: { exitCode: number | null; signal: NodeJS.Signals | null }) => void) {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  output(event: ShellTaskOutputEvent) {
    for (const listener of this.outputListeners) listener(event)
  }

  exit(exitCode: number | null, signal: NodeJS.Signals | null = null) {
    for (const listener of this.exitListeners) listener({ exitCode, signal })
  }
}

class FakePtyHandle implements PtyRuntimeHandle {
  readonly pid = 84
  killed = 0
  writes: string[] = []
  private readonly dataListeners = new Set<(data: string) => void>()
  private readonly exitListeners = new Set<(event: { exitCode: number | null; signal?: number }) => void>()

  write(data: string) {
    this.writes.push(data)
  }

  resize() {}

  kill() {
    this.killed += 1
  }

  onData(listener: (data: string) => void) {
    this.dataListeners.add(listener)
    return () => this.dataListeners.delete(listener)
  }

  onExit(listener: (event: { exitCode: number | null; signal?: number }) => void) {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  output(data: string) {
    for (const listener of this.dataListeners) listener(data)
  }

  exit(exitCode: number | null, signal?: number) {
    for (const listener of this.exitListeners) listener({ exitCode, signal })
  }
}

describe("shell task registry", () => {
  it("runs an arbitrary executable invocation and returns separated output after exit", async () => {
    const handle = new FakeShellTaskHandle()
    let invocation: Parameters<ShellTaskRuntimeAdapter["spawn"]>[0] | undefined
    const registry = createShellTaskRegistry({
      runtime: {
        spawn(input) {
          invocation = input
          return handle
        },
      },
    })

    const task = await registry.start({
      command: "Write-Output hello",
      cwd: "C:\\workspace",
      shell: "PowerShell",
      executable: "powershell.exe",
      args: ["-NoProfile", "-Command", "Write-Output hello"],
      maxOutputChars: 100,
    })
    handle.output({ stream: "stdout", data: "hello\n" })
    handle.output({ stream: "stderr", data: "warning\n" })
    const pending = registry.wait(task.id, 1_000)
    handle.exit(0)

    expect(invocation).toEqual({
      executable: "powershell.exe",
      args: ["-NoProfile", "-Command", "Write-Output hello"],
      cwd: "C:\\workspace",
      env: undefined,
    })
    expect(await pending).toMatchObject({
      status: "exited",
      exitCode: 0,
      timedOut: false,
      stdout: "hello\n",
      stderr: "warning\n",
      stdoutTruncated: false,
      stderrTruncated: false,
    })
    expect(registry.read(task.id)?.replay.output).toBe("hello\nwarning\n")
    expect(registry.take(task.id)).not.toBeNull()
    expect(registry.info(task.id)).toBeNull()
  })

  it("marks and terminates a task that exceeds an explicit hard timeout", async () => {
    const handle = new FakeShellTaskHandle()
    const registry = createShellTaskRegistry({
      runtime: {
        spawn() {
          return handle
        },
      },
    })
    const task = await registry.start({
      command: "long-command",
      cwd: "C:\\workspace",
      shell: "PowerShell",
      executable: "powershell.exe",
      args: ["-Command", "long-command"],
      maxOutputChars: 100,
      timeoutMs: 10,
    })

    await Bun.sleep(25)
    expect(handle.killed).toBe(1)
    expect(registry.result(task.id)).toMatchObject({
      status: "running",
      timedOut: true,
    })

    handle.exit(null, "SIGTERM")
    expect(await registry.wait(task.id, 100)).toMatchObject({
      status: "exited",
      timedOut: true,
      signal: "SIGTERM",
    })
    registry.take(task.id)
  })

  it("tracks delivered output internally and isolates tasks by owning session", async () => {
    const handle = new FakeShellTaskHandle()
    const registry = createShellTaskRegistry({
      runtime: {
        spawn() {
          return handle
        },
      },
    })
    const task = await registry.start({
      ownerSessionID: "session-a",
      command: "long-command",
      cwd: "C:\\workspace",
      shell: "PowerShell",
      executable: "powershell.exe",
      args: ["-Command", "long-command"],
      maxOutputChars: 100,
    })

    handle.output({ stream: "stdout", data: "initial\n" })
    expect(registry.info(task.id)).toBeNull()
    registry.acknowledge(task.id, registry.info(task.id, "session-a")!.cursor, "session-a")
    handle.output({ stream: "stdout", data: "next\n" })

    expect(await registry.interact({
      id: task.id,
      ownerSessionID: "session-b",
      data: "",
      yieldTimeMs: 0,
    })).toBeNull()
    const firstRead = registry.interact({
      id: task.id,
      ownerSessionID: "session-a",
      data: "",
      yieldTimeMs: 0,
    })
    const secondRead = registry.interact({
      id: task.id,
      ownerSessionID: "session-a",
      data: "",
      yieldTimeMs: 0,
    })
    expect(await firstRead).toMatchObject({
      task: {
        ownerSessionID: "session-a",
        status: "running",
      },
      replay: {
        output: "next\n",
      },
    })
    expect((await secondRead)?.replay.output).toBe("")

    handle.exit(0)
    await registry.stop(task.id, "session-a")
  })

  it("rejects ordinary pipe stdin and maps Ctrl-C to an interrupt", async () => {
    const handle = new FakeShellTaskHandle()
    const registry = createShellTaskRegistry({
      runtime: {
        spawn() {
          return handle
        },
      },
    })
    const task = await registry.start({
      ownerSessionID: "session-a",
      command: "interactive-command",
      cwd: "C:\\workspace",
      shell: "PowerShell",
      executable: "powershell.exe",
      args: ["-Command", "interactive-command"],
      maxOutputChars: 100,
    })

    await expect(registry.interact({
      id: task.id,
      ownerSessionID: "session-a",
      data: "yes\n",
      yieldTimeMs: 0,
    })).rejects.toThrow("tty=true")
    await registry.interact({
      id: task.id,
      ownerSessionID: "session-a",
      data: "\x03",
      yieldTimeMs: 0,
    })

    expect(handle.writes).toEqual([])
    expect(handle.interrupted).toBe(1)
    handle.exit(null, "SIGINT")
    registry.take(task.id, "session-a")
  })

  it("uses a lazy PTY backend, merges terminal output, and sends raw input without a Ctrl-C kill fallback", async () => {
    const handle = new FakePtyHandle()
    let invocation: PtyRuntimeSpawnInput | undefined
    let ptyFactoryCalls = 0
    const registry = createShellTaskRegistry({
      ptyRuntimeFactory() {
        ptyFactoryCalls += 1
        return {
          spawn(input) {
            invocation = input
            return handle
          },
        }
      },
    })

    expect(ptyFactoryCalls).toBe(0)
    const task = await registry.start({
      ownerSessionID: "session-pty",
      command: "python",
      cwd: "C:\\workspace",
      shell: "PowerShell",
      tty: true,
      executable: "powershell.exe",
      args: ["-NoProfile", "-Command", "python"],
      env: { ANYBOX_TEST: "pty" },
      maxOutputChars: 100,
    })

    expect(ptyFactoryCalls).toBe(1)
    expect(invocation).toEqual({
      executable: "powershell.exe",
      args: ["-NoProfile", "-Command", "python"],
      cwd: "C:\\workspace",
      env: { ANYBOX_TEST: "pty" },
      cols: 120,
      rows: 32,
    })
    expect(task.tty).toBe(true)

    handle.output("\x1b[32mready\x1b[0m\r\n")
    await registry.interact({
      id: task.id,
      ownerSessionID: "session-pty",
      data: "yes\r",
      yieldTimeMs: 0,
    })
    await registry.interact({
      id: task.id,
      ownerSessionID: "session-pty",
      data: "\x03",
      yieldTimeMs: 0,
    })

    expect(handle.writes).toEqual(["yes\r", "\x03"])
    await Bun.sleep(1_050)
    expect(handle.killed).toBe(0)

    handle.exit(0)
    expect(await registry.wait(task.id, 100, "session-pty")).toMatchObject({
      tty: true,
      status: "exited",
      stdout: "",
      stderr: "",
      terminalOutput: "\x1b[32mready\x1b[0m\r\n",
      terminalOutputTruncated: false,
    })
    registry.take(task.id, "session-pty")
  })

  it("stops every task owned by a deleted agent session", async () => {
    const first = new FakeShellTaskHandle()
    const second = new FakeShellTaskHandle()
    const handles = [first, second]
    const registry = createShellTaskRegistry({
      runtime: {
        spawn() {
          return handles.shift()!
        },
      },
    })

    const firstTask = await registry.start({
      ownerSessionID: "session-cleanup",
      command: "one",
      cwd: "C:\\workspace",
      shell: "PowerShell",
      executable: "powershell.exe",
      args: ["-Command", "one"],
      maxOutputChars: 100,
    })
    const secondTask = await registry.start({
      ownerSessionID: "session-cleanup",
      command: "two",
      cwd: "C:\\workspace",
      shell: "PowerShell",
      executable: "powershell.exe",
      args: ["-Command", "two"],
      maxOutputChars: 100,
    })

    const pending = registry.stopByOwnerSession("session-cleanup")
    const disposing = registry.disposeAll()
    expect(first.killed).toBe(1)
    expect(second.killed).toBe(1)
    first.exit(null, "SIGTERM")
    second.exit(null, "SIGTERM")
    expect(await pending).toHaveLength(2)
    expect(await disposing).toHaveLength(2)
    expect(registry.info(firstTask.id, "session-cleanup")).toBeNull()
    expect(registry.info(secondTask.id, "session-cleanup")).toBeNull()
  })

  it("kills an asynchronously started PTY when the tool is cancelled before registration", async () => {
    const handle = new FakePtyHandle()
    const controller = new AbortController()
    const registry = createShellTaskRegistry({
      ptyRuntime: {
        async spawn() {
          await Promise.resolve()
          return handle
        },
      },
    })

    const pending = registry.start({
      ownerSessionID: "session-cancelled-start",
      command: "python",
      cwd: "C:\\workspace",
      shell: "PowerShell",
      tty: true,
      executable: "powershell.exe",
      args: ["-Command", "python"],
      maxOutputChars: 100,
      abort: controller.signal,
    })
    controller.abort()

    await expect(pending).rejects.toThrow("cancelled")
    expect(handle.killed).toBe(1)
  })

  it("waits for and cleans up a PTY that resolves while the registry is shutting down", async () => {
    const handle = new FakePtyHandle()
    let resolveSpawn: ((handle: PtyRuntimeHandle) => void) | undefined
    const registry = createShellTaskRegistry({
      ptyRuntime: {
        spawn() {
          return new Promise<PtyRuntimeHandle>((resolve) => {
            resolveSpawn = resolve
          })
        },
      },
    })
    const input = {
      ownerSessionID: "session-shutdown-start",
      command: "python",
      cwd: "C:\\workspace",
      shell: "PowerShell",
      tty: true,
      executable: "powershell.exe",
      args: ["-Command", "python"],
      maxOutputChars: 100,
    }

    const starting = registry.start(input).catch((error: unknown) => error)
    const disposing = registry.disposeAll()
    await expect(registry.start(input)).rejects.toThrow("shutting down")
    resolveSpawn?.(handle)
    await Bun.sleep(0)
    expect(handle.killed).toBe(1)
    handle.exit(null, 15)

    expect(await starting).toBeInstanceOf(Error)
    expect(await disposing).toEqual([])
  })
})
