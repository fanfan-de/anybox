import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as Config from "../src/config/config.ts"
import { createIpythonRegistry, setIpythonRegistryForTest } from "../src/ipython/registry.ts"
import { IpythonRuntimeError } from "../src/ipython/types.ts"
import { IpythonTool } from "../src/tool/ipython.ts"
import * as Tool from "../src/tool/tool.ts"

const tempDirectories: string[] = []

afterEach(async () => {
  setIpythonRegistryForTest(undefined)
  await Config.setToolSelection(Config.GLOBAL_CONFIG_ID, {})
  await Promise.all(tempDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

describe("IPython tool", () => {
  test("is a default-off, exclusive, high-risk execution tool", () => {
    expect(IpythonTool.defaultEnabled).toBe(false)
    expect(IpythonTool.capabilities).toEqual({
      kind: "exec",
      readOnly: false,
      destructive: true,
      concurrency: "exclusive",
      needsShell: true,
    })
  })

  test("shows the entire cell in the high-risk approval", async () => {
    const runtime = await IpythonTool.init()
    const code = `${"# harmless padding\n".repeat(400)}raise RuntimeError('visible tail')`
    const permission = await runtime.assessPermission?.({ code }, {
      sessionID: "session-approval",
      messageID: "message-approval",
      cwd: process.cwd(),
      worktree: process.cwd(),
    })
    expect(permission).toMatchObject({ action: "ask", risk: "high" })
    expect(permission?.resource?.body).toBe(code)
  })

  test("asks before execution and returns structured kernel output", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "anybox-ipython-tool-"))
    tempDirectories.push(directory)
    const registry = createIpythonRegistry({
      createManager: ({ sessionID, cwd, generation }) => ({
        sessionID,
        cwd,
        generation,
        isExited: false,
        execute: async () => ({
          status: "ok",
          executionCount: 2,
          stdout: "hello\n",
          stderr: "",
          result: "42",
          displays: [],
          durationMs: 10,
          kernelGeneration: generation,
          stateLost: false,
          outputTruncated: false,
        }),
        interrupt: async () => true,
        dispose: async () => undefined,
      }),
    })
    setIpythonRegistryForTest(registry)
    await Config.setToolSelection(Config.GLOBAL_CONFIG_ID, { ipython: true })
    const runtime = await IpythonTool.init()
    const context = {
      sessionID: "session-1",
      messageID: "message-1",
      cwd: directory,
      worktree: directory,
    }

    expect(await runtime.assessPermission?.({ code: "40 + 2" }, context)).toMatchObject({
      action: "ask",
      risk: "high",
      resource: { workdir: directory, body: "40 + 2" },
    })
    const output = await runtime.execute({ code: "40 + 2" }, context)
    expect(output.text).toContain("hello")
    expect(output.text).toContain("42")
    expect(output.data).toMatchObject({ status: "ok", result: "42", executionCount: 2 })
  })

  test("throws a structured technical failure when a fatal runtime failure loses state", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "anybox-ipython-tool-fatal-"))
    tempDirectories.push(directory)
    const registry = createIpythonRegistry({
      createManager: ({ sessionID, cwd, generation }) => ({
        sessionID,
        cwd,
        generation,
        isExited: true,
        execute: async () => {
          throw new IpythonRuntimeError(
            "IPYTHON_HOST_PROTOCOL_ERROR",
            "simulated fatal host error",
            { stateLost: true },
          )
        },
        interrupt: async () => false,
        dispose: async () => undefined,
      }),
    })
    setIpythonRegistryForTest(registry)
    await Config.setToolSelection(Config.GLOBAL_CONFIG_ID, { ipython: true })
    const runtime = await IpythonTool.init()
    const context = {
      sessionID: "session-fatal",
      messageID: "message-fatal",
      cwd: directory,
      worktree: directory,
    }

    let thrown: unknown
    try {
      await runtime.execute({ code: "print('fatal')" }, context)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Tool.ToolFailureError)
    expect(Tool.findToolFailureError(thrown)?.failure).toMatchObject({
      stage: "protocol",
      source: "runtime",
      code: "IPYTHON_HOST_PROTOCOL_ERROR",
      message: "simulated fatal host error",
      handlerExecuted: true,
      retryable: false,
      severity: "recoverable",
      details: {
        kernelGeneration: 1,
        stateLost: true,
      },
    })
  })

  test("keeps ordinary user-code errors as completed JSON results", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "anybox-ipython-tool-code-error-"))
    tempDirectories.push(directory)
    const registry = createIpythonRegistry({
      createManager: ({ sessionID, cwd, generation }) => ({
        sessionID,
        cwd,
        generation,
        isExited: false,
        execute: async () => ({
          status: "error",
          executionCount: 1,
          stdout: "",
          stderr: "",
          displays: [],
          error: {
            name: "ValueError",
            message: "bad input",
            traceback: ["ValueError: bad input"],
          },
          durationMs: 5,
          kernelGeneration: generation,
          stateLost: false,
          outputTruncated: false,
        }),
        interrupt: async () => false,
        dispose: async () => undefined,
      }),
    })
    setIpythonRegistryForTest(registry)
    await Config.setToolSelection(Config.GLOBAL_CONFIG_ID, { ipython: true })
    const runtime = await IpythonTool.init()
    const output = await runtime.execute({ code: "raise ValueError('bad input')" }, {
      sessionID: "session-code-error",
      messageID: "message-code-error",
      cwd: directory,
      worktree: directory,
    })

    expect(output).toMatchObject({
      title: "IPython returned an error",
      result: "negative",
      completeness: "complete",
      data: { status: "error", stateLost: false, kernelGeneration: 1 },
    })
    expect(await runtime.toModelOutput?.(output)).toMatchObject({
      type: "json",
      value: { status: "error", stateLost: false, kernelGeneration: 1 },
    })
  })

  test("reports truncation, timeout, and cancellation as distinct explicit semantics", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "anybox-ipython-tool-semantics-"))
    tempDirectories.push(directory)
    await Config.setToolSelection(Config.GLOBAL_CONFIG_ID, { ipython: true })

    const installResult = (result: {
      status: "ok" | "timed_out" | "aborted"
      stdout: string
      outputTruncated: boolean
    }) => {
      setIpythonRegistryForTest(createIpythonRegistry({
        createManager: ({ sessionID, cwd, generation }) => ({
          sessionID,
          cwd,
          generation,
          isExited: false,
          execute: async () => ({
            ...result,
            stderr: "",
            displays: [],
            durationMs: 5,
            kernelGeneration: generation,
            stateLost: false,
          }),
          interrupt: async () => false,
          dispose: async () => undefined,
        }),
      }))
    }
    const context = {
      sessionID: "session-semantics",
      messageID: "message-semantics",
      cwd: directory,
      worktree: directory,
    }

    installResult({ status: "ok", stdout: "partial output", outputTruncated: true })
    const partial = await (await IpythonTool.init()).execute({ code: "print('partial')" }, context)
    expect(partial).toMatchObject({
      result: "success",
      completeness: "partial",
      sideEffect: "possible",
      retry: "unsafe",
    })

    installResult({ status: "timed_out", stdout: "before timeout", outputTruncated: false })
    let timeoutError: unknown
    try {
      await (await IpythonTool.init()).execute({ code: "while True: pass" }, context)
    } catch (error) {
      timeoutError = error
    }
    expect(Tool.findToolControlSignal(timeoutError)).toMatchObject({
      outcome: {
        kind: "timeout",
        partialOutput: expect.stringContaining("before timeout"),
        execution: { sideEffect: "possible", retry: "unsafe" },
      },
      control: { mode: "continue-model" },
    })

    installResult({ status: "aborted", stdout: "before cancellation", outputTruncated: false })
    let cancellationError: unknown
    try {
      await (await IpythonTool.init()).execute({ code: "print('cancel')" }, context)
    } catch (error) {
      cancellationError = error
    }
    expect(Tool.findToolControlSignal(cancellationError)).toMatchObject({
      outcome: {
        kind: "cancelled",
        by: "framework",
        execution: { sideEffect: "possible", retry: "unsafe" },
      },
      control: { mode: "cancel-turn" },
    })
  })

  test("does not execute an approved stale call after the tool is disabled", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "anybox-ipython-tool-disabled-"))
    tempDirectories.push(directory)
    let executions = 0
    const registry = createIpythonRegistry({
      createManager: ({ sessionID, cwd, generation }) => ({
        sessionID,
        cwd,
        generation,
        isExited: false,
        execute: async () => {
          executions += 1
          throw new Error("unexpected execution")
        },
        interrupt: async () => false,
        dispose: async () => undefined,
      }),
    })
    setIpythonRegistryForTest(registry)
    await Config.setToolSelection(Config.GLOBAL_CONFIG_ID, { ipython: false })
    const runtime = await IpythonTool.init()

    await expect(runtime.execute({ code: "print('must not run')" }, {
      sessionID: "session-disabled",
      messageID: "message-disabled",
      cwd: directory,
      worktree: directory,
    })).rejects.toThrow("IPython is disabled")
    expect(executions).toBe(0)
  })
})
