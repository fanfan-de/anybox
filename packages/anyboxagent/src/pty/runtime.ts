import os from "node:os"
import { spawn as spawnChild } from "node:child_process"
import { constants as fsConstants } from "node:fs"
import path from "node:path"
import { access, chmod, stat } from "node:fs/promises"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import type { IPty } from "node-pty"
import { Flag } from "#flag/flag.ts"
import { withMacOSDefaultPath } from "#shell/environment.ts"
import { which } from "#util/which.ts"
import { getProcessEnvValue } from "#env/compat.ts"

type MaybePromise<T> = T | Promise<T>
type NodePtyModule = typeof import("node-pty")

const nodeRequire = createRequire(import.meta.url)

export type PtyRuntimeErrorCode = "PTY_RUNTIME_UNAVAILABLE" | "PTY_CREATE_FAILED"

export class PtyRuntimeError extends Error {
  constructor(
    public readonly code: PtyRuntimeErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "PtyRuntimeError"
  }
}

export function isPtyRuntimeError(error: unknown): error is PtyRuntimeError {
  return error instanceof PtyRuntimeError
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function toPtyCreateError(error: unknown, shell: string) {
  if (isPtyRuntimeError(error)) return error
  return new PtyRuntimeError("PTY_CREATE_FAILED", `Failed to start terminal shell '${shell}': ${errorMessage(error)}`)
}

export interface PtyRuntimeHandle {
  readonly pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(listener: (data: string) => void): () => void
  onExit(listener: (event: { exitCode: number | null; signal?: number }) => void): () => void
}

export interface PtyRuntimeAdapter {
  spawn(input: {
    shell: string
    cwd: string
    rows: number
    cols: number
    env: Record<string, string>
  }): MaybePromise<PtyRuntimeHandle>
}

type NodePtyWorkerEvent =
  | {
      type: "ready"
      pid: number
    }
  | {
      type: "data"
      data: string
    }
  | {
      type: "exit"
      exitCode: number | null
      signal?: number
    }
  | {
      type: "error"
      message: string
    }

async function isExistingFile(candidate: string) {
  return stat(candidate).then((entry) => entry.isFile()).catch(() => false)
}

async function resolveExistingCommand(candidate?: string | null) {
  const value = candidate?.trim()
  if (!value) return null

  if (value.includes("/") || value.includes("\\") || path.isAbsolute(value)) {
    return (await isExistingFile(value)) ? value : null
  }

  return which(value) ?? null
}

function isWindowsSystemBashShim(candidate: string) {
  if (process.platform !== "win32") return false
  const normalized = path.resolve(candidate).replaceAll("/", "\\").toLowerCase()
  return normalized.endsWith("\\windows\\system32\\bash.exe")
}

function resolveNodePtyPackageRoot() {
  try {
    return path.dirname(nodeRequire.resolve("node-pty/package.json"))
  } catch (error) {
    throw new PtyRuntimeError("PTY_RUNTIME_UNAVAILABLE", `Unable to resolve node-pty: ${errorMessage(error)}`)
  }
}

export async function ensureMacOSNodePtySpawnHelperExecutable(options?: {
  arch?: string
  packageRoot?: string
  platform?: NodeJS.Platform
}) {
  const platform = options?.platform ?? process.platform
  if (platform !== "darwin") return null

  const arch = options?.arch ?? process.arch
  const packageRoot = options?.packageRoot ?? resolveNodePtyPackageRoot()
  const helperPath = path.join(packageRoot, "prebuilds", `${platform}-${arch}`, "spawn-helper")
  const helperStat = await stat(helperPath).catch(() => null)
  if (!helperStat?.isFile()) {
    throw new PtyRuntimeError("PTY_RUNTIME_UNAVAILABLE", `node-pty spawn helper is missing: ${helperPath}`)
  }

  if ((helperStat.mode & 0o111) === 0) {
    try {
      await chmod(helperPath, helperStat.mode | 0o755)
    } catch (error) {
      throw new PtyRuntimeError(
        "PTY_RUNTIME_UNAVAILABLE",
        `node-pty spawn helper is not executable and could not be fixed: ${helperPath}: ${errorMessage(error)}`,
      )
    }
  }

  try {
    await access(helperPath, fsConstants.X_OK)
  } catch (error) {
    throw new PtyRuntimeError(
      "PTY_RUNTIME_UNAVAILABLE",
      `node-pty spawn helper is not executable: ${helperPath}: ${errorMessage(error)}`,
    )
  }

  return helperPath
}

let nodePtyModulePromise: Promise<NodePtyModule> | null = null

async function loadNodePtyModule() {
  if (!nodePtyModulePromise) {
    nodePtyModulePromise = (async () => {
      await ensureMacOSNodePtySpawnHelperExecutable()
      try {
        return await import("node-pty")
      } catch (error) {
        throw new PtyRuntimeError("PTY_RUNTIME_UNAVAILABLE", `Unable to load node-pty: ${errorMessage(error)}`)
      }
    })().catch((error) => {
      nodePtyModulePromise = null
      throw error
    })
  }

  return nodePtyModulePromise
}

export async function resolveDefaultPtyShell(input?: string) {
  const requestedShell = input ?? getProcessEnvValue("ANYBOX_PTY_SHELL")
  const explicit = await resolveExistingCommand(requestedShell)
  if (explicit) return explicit
  if (requestedShell?.trim()) {
    throw new PtyRuntimeError("PTY_CREATE_FAILED", `Terminal shell not found: ${requestedShell.trim()}`)
  }

  const fromShellEnv = await resolveExistingCommand(process.env.SHELL)
  if (fromShellEnv && !isWindowsSystemBashShim(fromShellEnv)) return fromShellEnv

  const fromConfiguredGitBash = await resolveExistingCommand(Flag.ANYBOX_GIT_BASH_PATH)
  if (fromConfiguredGitBash) return fromConfiguredGitBash

  if (process.platform === "win32") {
    const bash = (await resolveExistingCommand("bash.exe")) ?? (await resolveExistingCommand("bash"))
    if (bash && !isWindowsSystemBashShim(bash)) return bash

    const git = (await resolveExistingCommand("git.exe")) ?? (await resolveExistingCommand("git"))
    if (git) {
      const gitBash = path.resolve(git, "..", "..", "bin", "bash.exe")
      if (await isExistingFile(gitBash)) return gitBash
    }

    const pwsh = (await resolveExistingCommand("pwsh.exe")) ?? (await resolveExistingCommand("pwsh"))
    if (pwsh) return pwsh

    const powershell =
      (await resolveExistingCommand("powershell.exe")) ?? (await resolveExistingCommand("powershell"))
    if (powershell) return powershell

    const comSpec = await resolveExistingCommand(process.env.ComSpec)
    if (comSpec) return comSpec

    return "cmd.exe"
  }

  if (process.platform === "darwin") {
    return "/bin/zsh"
  }

  return (await resolveExistingCommand("bash")) ?? "/bin/sh"
}

const ALLOWED_ENV_KEYS = [
  "APPDATA",
  "COLORTERM",
  "ComSpec",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOCALAPPDATA",
  "MSYSTEM",
  "MSYS2_PATH_TYPE",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PATH",
  "PATHEXT",
  "Path",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "PWD",
  "SHELL",
  "SystemDrive",
  "SystemRoot",
  "TEMP",
  "TERM",
  "TMP",
  "USER",
  "USERNAME",
  "USERPROFILE",
  "WINDIR",
  "WT_SESSION",
]

export function buildPtyEnvironment(cwd: string, shell: string) {
  const env: Record<string, string> = {}
  const source = process.env

  for (const key of ALLOWED_ENV_KEYS) {
    const value = source[key]
    if (typeof value === "string" && value.length > 0) {
      env[key] = value
    }
  }

  if (process.platform === "win32") {
    const pathValue = source.Path ?? source.PATH ?? ""
    if (pathValue) {
      env.Path = pathValue
      env.PATH = pathValue
    }
    env.SystemRoot = source.SystemRoot ?? env.SystemRoot ?? "C:\\Windows"
    env.ComSpec = source.ComSpec ?? env.ComSpec ?? shell
    env.PATHEXT = source.PATHEXT ?? env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD"
    env.TEMP = source.TEMP ?? env.TEMP ?? os.tmpdir()
    env.TMP = source.TMP ?? env.TMP ?? os.tmpdir()
    env.USERPROFILE = source.USERPROFILE ?? env.USERPROFILE ?? os.homedir()
    env.HOMEDRIVE = source.HOMEDRIVE ?? env.HOMEDRIVE ?? path.parse(env.USERPROFILE).root.slice(0, 2)
    env.HOMEPATH = source.HOMEPATH ?? env.HOMEPATH ?? env.USERPROFILE.slice(2)
  } else {
    env.PATH = source.PATH ?? env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin"
    if (process.platform === "darwin") {
      env.PATH = withMacOSDefaultPath(env.PATH)
    }
    env.HOME = source.HOME ?? env.HOME ?? os.homedir()
    env.SHELL = shell
  }

  env.TERM = source.TERM ?? "xterm-256color"
  env.COLORTERM = source.COLORTERM ?? "truecolor"
  env.PWD = cwd
  env.ANYBOX_CLIENT = Flag.ANYBOX_CLIENT

  return env
}

function wrapRuntimeHandle(term: IPty): PtyRuntimeHandle {
  return {
    pid: term.pid,
    write(data) {
      term.write(data)
    },
    resize(cols, rows) {
      term.resize(cols, rows)
    },
    kill() {
      term.kill()
    },
    onData(listener) {
      const disposable = term.onData(listener)
      return () => disposable.dispose()
    },
    onExit(listener) {
      const disposable = term.onExit((event) => {
        listener({
          exitCode: event.exitCode ?? null,
          signal: event.signal,
        })
      })
      return () => disposable.dispose()
    },
  }
}

export function shouldUseNodePtySidecar(options?: { isBun?: boolean }) {
  return options?.isBun ?? Boolean(process.versions.bun)
}

function resolveNodeBinary() {
  return getProcessEnvValue("ANYBOX_NODE_BINARY")?.trim() || which("node.exe") || which("node")
}

function buildNodeSidecarEnvironment() {
  const env = { ...process.env }
  if (getProcessEnvValue("ANYBOX_NODE_RUN_AS_NODE") === "1") {
    env.ELECTRON_RUN_AS_NODE = "1"
  }

  return env
}

function createNodePtySidecarRuntimeAdapter(): PtyRuntimeAdapter {
  const nodeBinary = resolveNodeBinary()
  if (!nodeBinary) {
    throw new Error("Node.js is required to host PTY sessions when running the server with Bun")
  }

  const workerPath = fileURLToPath(new URL("./node-pty-worker.mjs", import.meta.url))

  return {
    async spawn(input) {
      await ensureMacOSNodePtySpawnHelperExecutable()

      const child = spawnChild(nodeBinary, [workerPath], {
        stdio: ["pipe", "pipe", "pipe"],
        env: buildNodeSidecarEnvironment(),
        windowsHide: true,
      })
      const dataListeners = new Set<(data: string) => void>()
      const exitListeners = new Set<(event: { exitCode: number | null; signal?: number }) => void>()
      let stdoutBuffer = ""
      let hasExited = false
      let startupSettled = false
      let runtimePid = child.pid ?? 0

      function emitData(data: string) {
        for (const listener of [...dataListeners]) {
          listener(data)
        }
      }

      function emitExit(event: { exitCode: number | null; signal?: number }) {
        if (hasExited) return
        hasExited = true
        for (const listener of [...exitListeners]) {
          listener(event)
        }
      }

      const handle: PtyRuntimeHandle = {
        get pid() {
          return runtimePid
        },
        write(data) {
          sendCommand({
            type: "write",
            data,
          })
        },
        resize(cols, rows) {
          sendCommand({
            type: "resize",
            cols,
            rows,
          })
        },
        kill() {
          try {
            sendCommand({
              type: "kill",
            })
          } catch {
            // The worker may already be gone.
          }

          if (!child.killed) {
            child.kill()
          }
        },
        onData(listener) {
          dataListeners.add(listener)
          return () => {
            dataListeners.delete(listener)
          }
        },
        onExit(listener) {
          exitListeners.add(listener)
          return () => {
            exitListeners.delete(listener)
          }
        },
      }

      function sendCommand(payload: Record<string, unknown>) {
        if (child.stdin.destroyed || !child.stdin.writable) {
          throw new Error("PTY worker stdin is unavailable")
        }

        child.stdin.write(`${JSON.stringify(payload)}\n`)
      }

      return new Promise<PtyRuntimeHandle>((resolve, reject) => {
        function failStartup(message: string) {
          if (startupSettled) return
          startupSettled = true
          clearTimeout(startupTimer)
          if (!child.killed) {
            child.kill()
          }
          reject(new PtyRuntimeError("PTY_CREATE_FAILED", message))
        }

        const startupTimer = setTimeout(() => {
          failStartup("PTY worker did not become ready in time")
        }, 5_000)
        startupTimer.unref?.()

        function finishStartup() {
          if (startupSettled) return false
          startupSettled = true
          clearTimeout(startupTimer)
          resolve(handle)
          return true
        }

        child.stdout.setEncoding("utf8")
        child.stdout.on("data", (chunk: string) => {
          stdoutBuffer += chunk
          const lines = stdoutBuffer.split(/\r?\n/)
          stdoutBuffer = lines.pop() ?? ""

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue

            let event: NodePtyWorkerEvent
            try {
              event = JSON.parse(trimmed) as NodePtyWorkerEvent
            } catch {
              continue
            }

            if (event.type === "ready") {
              runtimePid = event.pid
              finishStartup()
              continue
            }

            if (event.type === "data") {
              emitData(event.data)
              continue
            }

            if (event.type === "exit") {
              emitExit({
                exitCode: event.exitCode,
                signal: event.signal,
              })
              continue
            }

            if (event.type === "error") {
              if (!startupSettled) {
                failStartup(event.message)
                continue
              }
              emitData(`\r\n[pty worker error] ${event.message}\r\n`)
            }
          }
        })

        child.stderr.setEncoding("utf8")
        child.stderr.on("data", (chunk: string) => {
          if (!startupSettled) {
            failStartup(`PTY worker stderr: ${chunk.trim() || "unknown error"}`)
            return
          }
          emitData(`\r\n[pty worker stderr] ${chunk}\r\n`)
        })

        child.once("error", (error) => {
          if (!startupSettled) {
            failStartup(`PTY worker failed to start: ${errorMessage(error)}`)
            return
          }
          emitExit({
            exitCode: null,
          })
        })

        child.once("exit", (code, signal) => {
          if (!startupSettled) {
            failStartup(`PTY worker exited before ready (code=${code ?? "null"}, signal=${signal ?? "none"})`)
            return
          }
          emitExit({
            exitCode: typeof code === "number" ? code : null,
            signal: typeof signal === "string" ? undefined : signal ?? undefined,
          })
        })

        try {
          sendCommand({
            type: "start",
            shell: input.shell,
            cwd: input.cwd,
            rows: input.rows,
            cols: input.cols,
            env: input.env,
          })
        } catch (error) {
          failStartup(`Failed to initialize PTY worker: ${errorMessage(error)}`)
        }
      })
    },
  }
}

export function createNodePtyRuntimeAdapter(): PtyRuntimeAdapter {
  if (shouldUseNodePtySidecar()) {
    return createNodePtySidecarRuntimeAdapter()
  }

  return {
    async spawn(input) {
      const nodePty = await loadNodePtyModule()
      try {
        const term = nodePty.spawn(input.shell, [], {
          name: "xterm-256color",
          cwd: input.cwd,
          cols: input.cols,
          rows: input.rows,
          env: input.env,
          useConpty: process.platform === "win32" ? true : undefined,
        })

        return wrapRuntimeHandle(term)
      } catch (error) {
        throw toPtyCreateError(error, input.shell)
      }
    },
  }
}
