import { describe, expect, it } from "bun:test"
import {
  createShellTaskRegistry,
  type ShellTaskOutputEvent,
  type ShellTaskRuntimeAdapter,
  type ShellTaskRuntimeHandle,
} from "#shell/task-registry.ts"

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

    const task = registry.start({
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
    const task = registry.start({
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
    const task = registry.start({
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

  it("writes input and maps Ctrl-C to an interrupt", async () => {
    const handle = new FakeShellTaskHandle()
    const registry = createShellTaskRegistry({
      runtime: {
        spawn() {
          return handle
        },
      },
    })
    const task = registry.start({
      ownerSessionID: "session-a",
      command: "interactive-command",
      cwd: "C:\\workspace",
      shell: "PowerShell",
      executable: "powershell.exe",
      args: ["-Command", "interactive-command"],
      maxOutputChars: 100,
    })

    await registry.interact({
      id: task.id,
      ownerSessionID: "session-a",
      data: "yes\n",
      yieldTimeMs: 0,
    })
    await registry.interact({
      id: task.id,
      ownerSessionID: "session-a",
      data: "\x03",
      yieldTimeMs: 0,
    })

    expect(handle.writes).toEqual(["yes\n"])
    expect(handle.interrupted).toBe(1)
    handle.exit(null, "SIGINT")
    registry.take(task.id, "session-a")
  })
})
