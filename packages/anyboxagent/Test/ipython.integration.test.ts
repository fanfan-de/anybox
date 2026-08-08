import { afterAll, beforeAll, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  getIpythonRuntimeCacheDir,
  resolveIpythonPythonRuntime,
} from "../src/ipython/runtime.ts"
import { IpythonWorkerClient } from "../src/ipython/worker-client.ts"

function findPython() {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    const normalized = key.toUpperCase()
    if (
      normalized.startsWith("PYTHON")
      || normalized.startsWith("JUPYTER")
      || normalized.startsWith("IPYTHON")
    ) delete env[key]
  }
  const candidates = [
    process.env.ANYBOX_IPYTHON_TEST_PYTHON,
    "python",
    "python3",
  ].filter((value): value is string => Boolean(value))
  for (const executable of candidates) {
    const result = spawnSync(
      executable,
      ["-I", "-X", "utf8", "-c", "import IPython, ipykernel, jupyter_client, zmq"],
      { env, stdio: "ignore", windowsHide: true },
    )
    if (result.status === 0) return executable
  }
  return undefined
}

const python = findPython()
let workspace = ""

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM"
  }
}

async function waitForProcessExit(pid: number, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return !isProcessAlive(pid)
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return predicate()
}

function createClient(sessionID: string, generation = 1, cwd = workspace) {
  const sourceRoot = path.resolve(
    import.meta.dir,
    "../python/anybox_ipython_host/src",
  )
  return new IpythonWorkerClient({
    sessionID,
    cwd,
    generation,
    runtime: {
      executable: python!,
      source: "override",
      hostSourceRoot: sourceRoot,
      commandArgs: [
        "-I",
        "-X",
        "utf8",
        "-u",
        "-c",
        [
          "import runpy, sys",
          "source_root = sys.argv[1]",
          "sys.argv = ['anybox_ipython_host']",
          "sys.path.insert(0, source_root)",
          "runpy.run_module('anybox_ipython_host', run_name='__main__')",
        ].join("; "),
        sourceRoot,
      ],
    },
    startupTimeoutMs: 15_000,
    cellTimeoutMs: 15_000,
    interruptGraceMs: 4_000,
  })
}

const backgroundProcessCode = [
  "import subprocess, sys",
  "anybox_background = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])",
  "anybox_background.pid",
].join("\n")

beforeAll(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "anybox-ipython-integration-"))
})

afterAll(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true })
})

test("launches the bundled host with explicit UTF-8 mode", async () => {
  const dependenciesRoot = path.join(workspace, "fake-managed-dependencies")
  const executable = process.platform === "win32"
    ? path.join(dependenciesRoot, "python", "python.exe")
    : path.join(dependenciesRoot, "python", "bin", "python3")
  await mkdir(path.dirname(executable), { recursive: true })
  await writeFile(executable, "")

  const previousOverride = process.env.ANYBOX_IPYTHON_PYTHON
  const previousDependencies = process.env.ANYBOX_WORKSPACE_DEPENDENCIES_DIR
  try {
    delete process.env.ANYBOX_IPYTHON_PYTHON
    process.env.ANYBOX_WORKSPACE_DEPENDENCIES_DIR = dependenciesRoot

    const runtime = resolveIpythonPythonRuntime()
    expect(runtime.source).toBe("bundled")
    expect(runtime.commandArgs).toEqual([
      "-I",
      "-X",
      "utf8",
      "-u",
      "-m",
      "anybox_ipython_host",
    ])

    process.env.ANYBOX_IPYTHON_PYTHON = executable
    const overrideRuntime = resolveIpythonPythonRuntime()
    expect(overrideRuntime.source).toBe("override")
    expect(overrideRuntime.commandArgs.slice(0, 5)).toEqual([
      "-I",
      "-X",
      "utf8",
      "-u",
      "-c",
    ])
  } finally {
    if (previousOverride === undefined) delete process.env.ANYBOX_IPYTHON_PYTHON
    else process.env.ANYBOX_IPYTHON_PYTHON = previousOverride
    if (previousDependencies === undefined) delete process.env.ANYBOX_WORKSPACE_DEPENDENCIES_DIR
    else process.env.ANYBOX_WORKSPACE_DEPENDENCIES_DIR = previousDependencies
  }
})

test.skipIf(!python)("executes persistent cells and recovers after interrupt", async () => {
  const sessionID = "integration-session"
  const generation = 1
  const client = createClient(sessionID, generation)
  const ready = await client.start()
  let backgroundPid: number | undefined

  try {
    const first = await client.execute({ code: "value = 40\nprint('hello')" })
    expect(first).toMatchObject({ status: "ok", stdout: "hello\n", stateLost: false })

    const second = await client.execute({ code: "value + 2" })
    expect(second).toMatchObject({ status: "ok", result: "42" })

    const failed = await client.execute({ code: "raise ValueError('expected')" })
    expect(failed.status).toBe("error")
    expect(failed.error).toMatchObject({ name: "ValueError", message: "expected" })

    const controller = new AbortController()
    const interrupted = client.execute({
      code: "while True:\n    pass",
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 500)
    expect(await interrupted).toMatchObject({ status: "aborted", stateLost: false })

    const afterInterrupt = await client.execute({ code: "'still alive'" })
    expect(afterInterrupt).toMatchObject({ status: "ok", result: "'still alive'" })

    const background = await client.execute({ code: backgroundProcessCode })
    expect(background.status).toBe("ok")
    backgroundPid = Number(background.result)
    expect(Number.isInteger(backgroundPid)).toBe(true)
    if (!backgroundPid) throw new Error("IPython did not return a background process PID")
    expect(isProcessAlive(backgroundPid)).toBe(true)
  } finally {
    await client.shutdown()
  }

  if (!ready.kernelPid) throw new Error("IPython host did not return a kernel PID")
  if (!backgroundPid) throw new Error("IPython did not return a background process PID")
  if (process.platform === "win32") {
    expect(isProcessAlive(ready.kernelPid)).toBe(false)
    expect(isProcessAlive(backgroundPid)).toBe(false)
  }
  expect(await waitForProcessExit(ready.kernelPid)).toBe(true)
  expect(await waitForProcessExit(backgroundPid)).toBe(true)
  expect(existsSync(getIpythonRuntimeCacheDir({ sessionID, generation }))).toBe(false)
}, 45_000)

test.skipIf(!python)("preserves UTF-8 transport and state in a Unicode workspace", async () => {
  const unicodeWorkspace = path.join(workspace, "新建文件夹 (12)")
  await mkdir(unicodeWorkspace, { recursive: true })

  const generation = 37
  const client = createClient("integration-unicode-session", generation, unicodeWorkspace)
  await client.start()

  try {
    const first = await client.execute({
      code: [
        "# 中文注释：验证代码经 JSONL 传输后没有被改写",
        "中文变量 = '状态已保留'",
        "import os",
        "print('中文输出：你好，Anybox 🌏')",
        "print(os.getcwd())",
        "中文变量",
      ].join("\n"),
    })
    expect(first).toMatchObject({
      status: "ok",
      result: "'状态已保留'",
      stateLost: false,
      kernelGeneration: generation,
    })
    expect(first.stdout).toContain("中文输出：你好，Anybox 🌏\n")
    expect(first.stdout).toContain(`${unicodeWorkspace}\n`)

    const utf8Mode = await client.execute({ code: "import sys; sys.flags.utf8_mode" })
    expect(utf8Mode).toMatchObject({
      status: "ok",
      result: "1",
      stateLost: false,
      kernelGeneration: generation,
    })

    const failed = await client.execute({
      code: "raise ValueError('中文异常：编码不应杀死 kernel 💥')",
    })
    expect(failed).toMatchObject({
      status: "error",
      stateLost: false,
      kernelGeneration: generation,
      error: {
        name: "ValueError",
        message: "中文异常：编码不应杀死 kernel 💥",
      },
    })

    const persisted = await client.execute({ code: "中文变量 + ' / 仍在同一 kernel'" })
    expect(persisted).toMatchObject({
      status: "ok",
      result: "'状态已保留 / 仍在同一 kernel'",
      stateLost: false,
      kernelGeneration: generation,
    })
  } finally {
    await client.shutdown()
  }
}, 30_000)

test.skipIf(!python)("kills the kernel process group after an unexpected host exit", async () => {
  const client = createClient("integration-forced-exit")
  const ready = await client.start()
  const background = await client.execute({ code: backgroundProcessCode })
  const backgroundPid = Number(background.result)
  if (!ready.kernelPid || !backgroundPid) throw new Error("IPython did not return process IDs")

  try {
    ;(client as unknown as { forceTerminate: () => void }).forceTerminate()
    expect(await waitFor(() => client.isExited)).toBe(true)
  } finally {
    await client.shutdown()
  }

  if (process.platform === "win32") {
    expect(isProcessAlive(ready.kernelPid)).toBe(false)
    expect(isProcessAlive(backgroundPid)).toBe(false)
  }
  expect(await waitForProcessExit(ready.kernelPid)).toBe(true)
  expect(await waitForProcessExit(backgroundPid)).toBe(true)
}, 30_000)
