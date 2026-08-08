import { describe, expect, test } from "bun:test"
import path from "node:path"
import {
  beginIpythonRuntimeShutdown,
  createIpythonRegistry,
  disposeIpythonRegistry,
  getIpythonRegistry,
  resumeIpythonRuntime,
  setIpythonRegistryForTest,
  type IpythonManagedSession,
} from "../src/ipython/registry.ts"
import {
  IpythonSessionManager,
  type IpythonSessionWorker,
} from "../src/ipython/session-manager.ts"
import { IpythonRuntimeError, type IpythonExecutionResult } from "../src/ipython/types.ts"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function result(input: Partial<IpythonExecutionResult> = {}): IpythonExecutionResult {
  return {
    status: "ok",
    stdout: "",
    stderr: "",
    displays: [],
    durationMs: 1,
    kernelGeneration: 1,
    stateLost: false,
    outputTruncated: false,
    ...input,
  }
}

describe("IPython session manager", () => {
  test("adds the active kernel generation to runtime failures", async () => {
    const worker: IpythonSessionWorker = {
      isExited: true,
      execute: async () => {
        throw new IpythonRuntimeError(
          "IPYTHON_HOST_PROTOCOL_ERROR",
          "simulated fatal transport failure",
          { stateLost: true },
        )
      },
      interruptActive: async () => false,
      shutdown: async () => undefined,
    }
    const manager = new IpythonSessionManager({
      sessionID: "session-fatal",
      cwd: process.cwd(),
      generation: 7,
      client: worker,
    })

    await expect(manager.execute({ code: "print('never completes')" })).rejects.toMatchObject({
      code: "IPYTHON_HOST_PROTOCOL_ERROR",
      stateLost: true,
      kernelGeneration: 7,
    })
  })

  test("serializes cells and skips a queued cell that was cancelled", async () => {
    const first = deferred<IpythonExecutionResult>()
    const calls: string[] = []
    let shutdownCount = 0
    const worker: IpythonSessionWorker = {
      isExited: false,
      execute: async ({ code }) => {
        calls.push(code)
        if (code === "first") return await first.promise
        return result({ result: code })
      },
      interruptActive: async () => true,
      shutdown: async () => {
        shutdownCount += 1
      },
    }
    const manager = new IpythonSessionManager({
      sessionID: "session-1",
      cwd: process.cwd(),
      generation: 1,
      client: worker,
    })

    const firstRun = manager.execute({ code: "first" })
    const controller = new AbortController()
    const secondRun = manager.execute({ code: "second", signal: controller.signal })
    controller.abort()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toEqual(["first"])
    expect(await Promise.race([
      secondRun,
      new Promise((resolve) => setTimeout(() => resolve("still-waiting"), 100)),
    ])).toMatchObject({ status: "aborted" })

    first.resolve(result({ result: "first" }))
    expect((await firstRun).result).toBe("first")
    expect((await secondRun).status).toBe("aborted")
    expect(calls).toEqual(["first"])

    await manager.dispose()
    await manager.dispose()
    expect(shutdownCount).toBe(1)
  })
})

describe("IPython registry", () => {
  test("refuses to create a registry after server shutdown begins", () => {
    beginIpythonRuntimeShutdown()
    try {
      expect(() => getIpythonRegistry()).toThrow("shutting down")
    } finally {
      resumeIpythonRuntime()
    }
  })

  test("reuses one manager per session and creates independent sessions", async () => {
    const created: string[] = []
    const registry = createIpythonRegistry({
      maxActiveSessions: 2,
      createManager: ({ sessionID, cwd, generation }) => {
        created.push(`${sessionID}:${generation}`)
        return {
          sessionID,
          cwd,
          generation,
          isExited: false,
          execute: async ({ code }) => result({ result: `${sessionID}:${code}`, kernelGeneration: generation }),
          interrupt: async () => true,
          dispose: async () => undefined,
        }
      },
    })

    expect((await registry.execute({ sessionID: "one", cwd: process.cwd(), code: "a" })).result).toBe("one:a")
    expect((await registry.execute({ sessionID: "one", cwd: process.cwd(), code: "b" })).result).toBe("one:b")
    expect((await registry.execute({ sessionID: "two", cwd: process.cwd(), code: "c" })).result).toBe("two:c")
    expect(created).toEqual(["one:1", "two:1"])

    await expect(registry.execute({ sessionID: "three", cwd: process.cwd(), code: "d" }))
      .rejects.toMatchObject({ code: "IPYTHON_KERNEL_LIMIT" })
    await registry.disposeAll()
  })

  test("does not reserve kernel slots for calls cancelled before entry", async () => {
    let created = 0
    const registry = createIpythonRegistry({
      maxActiveSessions: 1,
      createManager: ({ sessionID, cwd, generation }) => {
        created += 1
        return {
          sessionID,
          cwd,
          generation,
          isExited: false,
          execute: async () => result({ kernelGeneration: generation }),
          interrupt: async () => false,
          dispose: async () => undefined,
        }
      },
    })
    const controller = new AbortController()
    controller.abort()

    for (const sessionID of ["cancelled-1", "cancelled-2", "cancelled-3"]) {
      expect(await registry.execute({
        sessionID,
        cwd: process.cwd(),
        code: "never runs",
        signal: controller.signal,
      })).toMatchObject({ status: "aborted", kernelGeneration: 0 })
    }
    expect(registry.activeSessionCount).toBe(0)
    expect(created).toBe(0)

    await registry.execute({ sessionID: "real", cwd: process.cwd(), code: "runs" })
    expect(created).toBe(1)
    await registry.disposeAll()
  })

  test("drops a state-lost manager and increments its next generation", async () => {
    const generations: number[] = []
    const registry = createIpythonRegistry({
      createManager: ({ sessionID, cwd, generation }) => {
        generations.push(generation)
        const manager: IpythonManagedSession = {
          sessionID,
          cwd,
          generation,
          isExited: false,
          execute: async () => result({
            status: "timed_out",
            stateLost: true,
            kernelGeneration: generation,
          }),
          interrupt: async () => false,
          dispose: async () => undefined,
        }
        return manager
      },
    })

    await registry.execute({ sessionID: "one", cwd: process.cwd(), code: "hang" })
    await registry.execute({ sessionID: "one", cwd: process.cwd(), code: "again" })
    expect(generations).toEqual([1, 2])
    await registry.disposeAll()
  })

  test("waits for a state-lost manager to retire before creating its replacement", async () => {
    const releaseRetirement = deferred<void>()
    const generations: number[] = []
    const registry = createIpythonRegistry({
      createManager: ({ sessionID, cwd, generation }) => {
        generations.push(generation)
        return {
          sessionID,
          cwd,
          generation,
          isExited: false,
          execute: async () => result({
            status: generation === 1 ? "timed_out" : "ok",
            stateLost: generation === 1,
            kernelGeneration: generation,
          }),
          interrupt: async () => false,
          dispose: async () => {
            if (generation === 1) await releaseRetirement.promise
          },
        }
      },
    })

    await registry.execute({ sessionID: "retiring", cwd: process.cwd(), code: "hang" })
    const replacement = registry.execute({ sessionID: "retiring", cwd: process.cwd(), code: "again" })
    expect(await Promise.race([
      replacement.then(() => "completed"),
      new Promise((resolve) => setTimeout(() => resolve("waiting"), 50)),
    ])).toBe("waiting")
    expect(generations).toEqual([1])

    releaseRetirement.resolve()
    expect(await replacement).toMatchObject({ status: "ok", kernelGeneration: 2 })
    expect(generations).toEqual([1, 2])
    await registry.disposeAll()
  })

  test("cancels promptly while a state-lost manager is retiring without creating a replacement", async () => {
    const releaseRetirement = deferred<void>()
    const generations: number[] = []
    const registry = createIpythonRegistry({
      createManager: ({ sessionID, cwd, generation }) => {
        generations.push(generation)
        return {
          sessionID,
          cwd,
          generation,
          isExited: false,
          execute: async () => result({
            status: generation === 1 ? "timed_out" : "ok",
            stateLost: generation === 1,
            kernelGeneration: generation,
          }),
          interrupt: async () => false,
          dispose: async () => {
            if (generation === 1) await releaseRetirement.promise
          },
        }
      },
    })

    await registry.execute({ sessionID: "retiring", cwd: process.cwd(), code: "hang" })
    const controller = new AbortController()
    const replacement = registry.execute({
      sessionID: "retiring",
      cwd: process.cwd(),
      code: "never runs",
      signal: controller.signal,
    })
    controller.abort()

    expect(await Promise.race([
      replacement,
      new Promise((resolve) => setTimeout(() => resolve("still-waiting"), 100)),
    ])).toMatchObject({ status: "aborted", kernelGeneration: 1 })
    expect(generations).toEqual([1])

    releaseRetirement.resolve()
    await registry.execute({ sessionID: "retiring", cwd: process.cwd(), code: "runs" })
    expect(generations).toEqual([1, 2])
    await registry.disposeAll()
  })

  test("treats even a falsy retirement rejection as a terminal cleanup failure", async () => {
    let created = 0
    const registry = createIpythonRegistry({
      createManager: ({ sessionID, cwd, generation }) => {
        created += 1
        return {
          sessionID,
          cwd,
          generation,
          isExited: false,
          execute: async () => result({
            status: "timed_out",
            stateLost: true,
            kernelGeneration: generation,
          }),
          interrupt: async () => false,
          dispose: async () => await Promise.reject(undefined),
        }
      },
    })

    await registry.execute({ sessionID: "broken", cwd: process.cwd(), code: "hang" })
    await expect(registry.execute({ sessionID: "broken", cwd: process.cwd(), code: "again" }))
      .rejects.toMatchObject({ code: "IPYTHON_HOST_EXITED", stateLost: true, kernelGeneration: 1 })
    expect(created).toBe(1)
    await expect(registry.disposeAll()).rejects.toBeInstanceOf(AggregateError)
  })

  test("rejects reusing a session from a different workdir", async () => {
    const registry = createIpythonRegistry({
      createManager: ({ sessionID, cwd, generation }) => ({
        sessionID,
        cwd,
        generation,
        isExited: false,
        execute: async () => result(),
        interrupt: async () => false,
        dispose: async () => undefined,
      }),
    })
    await registry.execute({ sessionID: "one", cwd: process.cwd(), code: "1" })
    await expect(registry.execute({
      sessionID: "one",
      cwd: path.join(process.cwd(), "other"),
      code: "2",
    })).rejects.toMatchObject({ code: "IPYTHON_SESSION_WORKDIR_CHANGED" })
    await registry.disposeAll()
  })

  test("cannot be reopened through a stale reference after disposal", async () => {
    let created = 0
    const registry = createIpythonRegistry({
      createManager: ({ sessionID, cwd, generation }) => {
        created += 1
        return {
          sessionID,
          cwd,
          generation,
          isExited: false,
          execute: async () => result(),
          interrupt: async () => false,
          dispose: async () => undefined,
        }
      },
    })

    await registry.execute({ sessionID: "one", cwd: process.cwd(), code: "1" })
    await registry.disposeAll()
    await registry.disposeAll()
    await expect(registry.execute({ sessionID: "two", cwd: process.cwd(), code: "2" }))
      .rejects.toMatchObject({ code: "IPYTHON_HOST_EXITED", stateLost: true })
    expect(created).toBe(1)
  })

  test("keeps a failed global registry as a tombstone instead of starting beside an orphan", async () => {
    const registry = createIpythonRegistry({
      createManager: ({ sessionID, cwd, generation }) => ({
        sessionID,
        cwd,
        generation,
        isExited: false,
        execute: async () => result(),
        interrupt: async () => false,
        dispose: async () => {
          throw new Error("simulated cleanup failure")
        },
      }),
    })
    setIpythonRegistryForTest(registry)

    try {
      await registry.execute({ sessionID: "orphan-risk", cwd: process.cwd(), code: "1" })
      await expect(disposeIpythonRegistry()).rejects.toBeInstanceOf(AggregateError)
      expect(getIpythonRegistry()).toBe(registry)
      await expect(getIpythonRegistry().execute({
        sessionID: "replacement",
        cwd: process.cwd(),
        code: "2",
      })).rejects.toMatchObject({ code: "IPYTHON_HOST_EXITED", stateLost: true })
    } finally {
      setIpythonRegistryForTest(undefined)
    }
  })

  test("does not create a replacement kernel while a session is closing", async () => {
    const releaseDisposal = deferred<void>()
    let created = 0
    const registry = createIpythonRegistry({
      createManager: ({ sessionID, cwd, generation }) => {
        created += 1
        return {
          sessionID,
          cwd,
          generation,
          isExited: false,
          execute: async () => result(),
          interrupt: async () => false,
          dispose: async () => await releaseDisposal.promise,
        }
      },
    })

    await registry.execute({ sessionID: "closing", cwd: process.cwd(), code: "1" })
    const closing = registry.disposeSession("closing")
    await new Promise((resolve) => setTimeout(resolve, 0))
    await expect(registry.execute({ sessionID: "closing", cwd: process.cwd(), code: "2" }))
      .rejects.toMatchObject({ code: "IPYTHON_HOST_EXITED", stateLost: true })
    expect(created).toBe(1)

    releaseDisposal.resolve()
    expect(await closing).toBe(true)
    expect(registry.activeSessionCount).toBe(0)
  })
})
