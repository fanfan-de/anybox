import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as Config from "../src/config/config.ts"
import { createIpythonRegistry, setIpythonRegistryForTest } from "../src/ipython/registry.ts"
import { IpythonRuntimeError } from "../src/ipython/types.ts"
import { IpythonTool } from "../src/tool/ipython.ts"

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

  test("returns a structured model-visible error when a fatal runtime failure loses state", async () => {
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

    const output = await runtime.execute({ code: "print('fatal')" }, context)
    expect(output).toMatchObject({
      title: "IPython runtime failed",
      data: {
        status: "runtime_error",
        errorCode: "IPYTHON_HOST_PROTOCOL_ERROR",
        message: "simulated fatal host error",
        kernelGeneration: 1,
        stateLost: true,
      },
    })
    expect(await runtime.toModelOutput?.(output)).toMatchObject({
      type: "error-json",
      value: {
        status: "runtime_error",
        errorCode: "IPYTHON_HOST_PROTOCOL_ERROR",
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
      title: "IPython error",
      data: { status: "error", stateLost: false, kernelGeneration: 1 },
    })
    expect(await runtime.toModelOutput?.(output)).toMatchObject({
      type: "json",
      value: { status: "error", stateLost: false, kernelGeneration: 1 },
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
