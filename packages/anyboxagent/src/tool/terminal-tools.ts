import crypto from "node:crypto"
import z from "zod"
import { getPtyRegistry } from "#pty/registry.ts"
import type { ManagedPtySession } from "#pty/session.ts"
import type { PtySessionInfo } from "#pty/types.ts"
import * as Session from "#session/core/session.ts"
import { isCriticalShellCommand, type ShellKind } from "#tool/shell-command.ts"
import * as Tool from "#tool/tool.ts"

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_OUTPUT_CHARS = 12_000

const commandQueues = new Map<string, Promise<unknown>>()
const activeRunCommands = new Set<string>()

const RunCommandParameters = z.object({
  command: z.string().min(1).describe("Command to execute in this session's persistent terminal."),
  timeoutMs: z.number().int().positive().max(10 * 60 * 1000).optional().describe("Timeout in milliseconds."),
  maxOutputChars: z.number().int().positive().max(200_000).optional().describe("Maximum output chars to return."),
}).strict()

const ReadParameters = z.object({
  maxOutputChars: z.number().int().positive().max(200_000).optional().describe("Maximum terminal buffer chars to return."),
}).strict()

const WriteInputParameters = z.object({
  data: z.string().min(1).describe("Raw input to write to this session's terminal."),
}).strict()

function requireMainSession(sessionID: string) {
  const session = Session.DataBaseRead("sessions", sessionID) as Session.SessionInfo | null
  if (!session) {
    throw new Error(`Session '${sessionID}' was not found.`)
  }
  if (Session.isSideChatSession(session)) {
    throw new Error("Side chat sessions do not support terminal tools.")
  }

  return session
}

async function getOrCreateTerminal(sessionID: string) {
  const session = requireMainSession(sessionID)
  const registry = getPtyRegistry()
  await registry.create({
    sessionID: session.id,
    cwd: session.directory,
  })
  const terminal = registry.getBySession(session.id)
  if (!terminal) {
    throw new Error(`Terminal for session '${session.id}' was not available after creation.`)
  }

  return terminal
}

function detectShellKind(shell: string): ShellKind {
  const normalized = shell.toLowerCase()
  if (normalized.includes("powershell") || normalized.includes("pwsh")) return "powershell"
  if (normalized.includes("cmd.exe") || normalized.endsWith("cmd")) return "cmd"
  if (normalized.includes("wsl")) return "wsl"
  if (normalized.includes("bash")) return "bash"
  return "posix"
}

function shellDisplayName(info: PtySessionInfo) {
  return `${info.shell} in ${info.cwd}`
}

function escapeSingleQuotedShellString(value: string) {
  return value.replace(/'/g, "'\\''")
}

function commandPayload(info: PtySessionInfo, command: string, marker: string) {
  const shellKind = detectShellKind(info.shell)
  const trimmed = command.trimEnd()

  if (shellKind === "powershell") {
    const escaped = marker.replace(/'/g, "''")
    return `${trimmed}\rWrite-Output '${escaped}'\r`
  }

  if (shellKind === "cmd") {
    return `${trimmed}\recho ${marker}\r`
  }

  return `${trimmed}\nprintf '%s\\n' '${escapeSingleQuotedShellString(marker)}'\n`
}

function truncateOutput(output: string, maxChars: number) {
  if (output.length <= maxChars) {
    return {
      output,
      truncated: false,
    }
  }

  return {
    output: output.slice(-maxChars),
    truncated: true,
  }
}

function enqueueSessionCommand<T>(sessionID: string, fn: () => Promise<T>) {
  const previous = commandQueues.get(sessionID) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(fn)
  commandQueues.set(
    sessionID,
    next.finally(() => {
      if (commandQueues.get(sessionID) === next) {
        commandQueues.delete(sessionID)
      }
    }),
  )
  return next
}

async function runCommandInTerminal(input: {
  terminal: ManagedPtySession
  command: string
  timeoutMs: number
  maxOutputChars: number
  abort?: AbortSignal
}) {
  const info = input.terminal.info()
  const marker = `__ANYBOX_TERMINAL_DONE_${crypto.randomUUID().replace(/-/g, "")}__`
  const payload = commandPayload(info, input.command, marker)
  let output = ""
  let settled = false
  let dispose: (() => void) | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  return await new Promise<{
    output: string
    truncated: boolean
    timedOut: boolean
  }>((resolve, reject) => {
    function cleanup() {
      dispose?.()
      dispose = null
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      input.abort?.removeEventListener("abort", onAbort)
    }

    function finish(timedOut: boolean) {
      if (settled) return
      settled = true
      cleanup()
      const markerIndex = output.indexOf(marker)
      const rawOutput = markerIndex >= 0 ? output.slice(0, markerIndex) : output
      const truncated = truncateOutput(rawOutput, input.maxOutputChars)
      resolve({
        output: truncated.output,
        truncated: truncated.truncated,
        timedOut,
      })
    }

    function onAbort() {
      try {
        input.terminal.write("\x03")
      } catch {
        // The command is already ending; return the output captured so far.
      }
      finish(true)
    }

    dispose = input.terminal.subscribe((event) => {
      if (event.type !== "output") return
      output += event.data
      if (output.includes(marker)) {
        finish(false)
      }
    })

    timer = setTimeout(() => {
      try {
        input.terminal.write("\x03")
      } catch {
        // The shell may already be closed; still return a timed-out result.
      }
      finish(true)
    }, input.timeoutMs)

    input.abort?.addEventListener("abort", onAbort)

    try {
      input.terminal.write(payload)
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

export const TerminalRunCommandTool = Tool.define(
  "terminal_run_command",
  async () => ({
    title: "Run Terminal Command",
    description: "Run a command in the persistent terminal bound to the current main session.",
    parameters: RunCommandParameters,
    describeApproval: async (parameters, ctx) => {
      const terminal = await getOrCreateTerminal(ctx.sessionID)
      return {
        title: "Run terminal command",
        summary: `Run a command in ${shellDisplayName(terminal.info())}.`,
        details: {
          command: parameters.command.trim(),
          workdir: terminal.info().cwd,
          paths: [terminal.info().cwd],
        },
      }
    },
    assessPermission: async (parameters, ctx) => {
      const terminal = await getOrCreateTerminal(ctx.sessionID)
      const shellKind = detectShellKind(terminal.info().shell)
      if (isCriticalShellCommand(shellKind, parameters.command)) {
        return {
          action: "ask",
          risk: "critical",
          reason: "The terminal command matches a known dangerous shell pattern.",
          resource: {
            command: parameters.command,
            workdir: terminal.info().cwd,
            paths: [terminal.info().cwd],
          },
        }
      }

      return {
        action: "ask",
        risk: "medium",
        reason: "Terminal commands execute in a persistent shell for this session.",
        resource: {
          command: parameters.command,
          workdir: terminal.info().cwd,
          paths: [terminal.info().cwd],
        },
      }
    },
    execute: async (parameters, ctx) =>
      enqueueSessionCommand(ctx.sessionID, async () => {
        const terminal = await getOrCreateTerminal(ctx.sessionID)
        activeRunCommands.add(ctx.sessionID)
        try {
          const result = await runCommandInTerminal({
            terminal,
            command: parameters.command,
            timeoutMs: parameters.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            maxOutputChars: parameters.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS,
            abort: ctx.abort,
          })
          const info = terminal.info()
          return {
            title: result.timedOut ? "Terminal command timed out" : "Terminal command completed",
            text: result.output,
            metadata: {
              sessionID: ctx.sessionID,
              ptyID: info.id,
              cwd: info.cwd,
              shell: info.shell,
              timedOut: result.timedOut,
              truncated: result.truncated,
              cursor: info.cursor,
            },
          }
        } finally {
          activeRunCommands.delete(ctx.sessionID)
        }
      }),
  }),
  {
    title: "Run Terminal Command",
    aliases: ["terminal-run-command"],
    capabilities: {
      kind: "exec",
      concurrency: "exclusive",
      needsShell: true,
    },
  },
)

export const TerminalReadTool = Tool.define(
  "terminal_read",
  async () => ({
    title: "Read Terminal",
    description: "Read the recent buffer from the persistent terminal bound to the current main session.",
    parameters: ReadParameters,
    execute: async (parameters, ctx) => {
      const terminal = await getOrCreateTerminal(ctx.sessionID)
      const info = terminal.info()
      const replay = terminal.replay(0)
      const maxOutputChars = parameters.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS
      const truncated = truncateOutput(replay.buffer, maxOutputChars)

      return {
        title: "Terminal buffer",
        text: truncated.output,
        metadata: {
          sessionID: ctx.sessionID,
          ptyID: info.id,
          cwd: info.cwd,
          shell: info.shell,
          status: info.status,
          cursor: info.cursor,
          truncated: truncated.truncated,
        },
      }
    },
  }),
  {
    title: "Read Terminal",
    aliases: ["terminal-read"],
    capabilities: {
      kind: "read",
      readOnly: true,
      needsShell: true,
    },
  },
)

export const TerminalWriteInputTool = Tool.define(
  "terminal_write_input",
  async () => ({
    title: "Write Terminal Input",
    description: "Write raw input to the persistent terminal bound to the current main session.",
    parameters: WriteInputParameters,
    validate: (_parameters, ctx) => {
      if (activeRunCommands.has(ctx.sessionID)) {
        return "Cannot write raw terminal input while terminal_run_command is active for this session."
      }
    },
    describeApproval: async (_parameters, ctx) => {
      const terminal = await getOrCreateTerminal(ctx.sessionID)
      return {
        title: "Write terminal input",
        summary: `Write raw input to ${shellDisplayName(terminal.info())}.`,
        details: {
          workdir: terminal.info().cwd,
          paths: [terminal.info().cwd],
        },
      }
    },
    assessPermission: async (parameters, ctx) => {
      const terminal = await getOrCreateTerminal(ctx.sessionID)
      const shellKind = detectShellKind(terminal.info().shell)
      if (isCriticalShellCommand(shellKind, parameters.data)) {
        return {
          action: "deny",
          risk: "critical",
          reason: "Raw terminal input matches a known dangerous shell pattern.",
          resource: {
            workdir: terminal.info().cwd,
            paths: [terminal.info().cwd],
          },
        }
      }

      return {
        action: "ask",
        risk: "medium",
        reason: "Raw terminal input can interact with a persistent shell process.",
        resource: {
          workdir: terminal.info().cwd,
          paths: [terminal.info().cwd],
        },
      }
    },
    execute: async (parameters, ctx) => {
      const terminal = await getOrCreateTerminal(ctx.sessionID)
      terminal.write(parameters.data)
      const info = terminal.info()
      return {
        title: "Terminal input written",
        text: `Wrote ${String(parameters.data.length)} characters to the session terminal.`,
        metadata: {
          sessionID: ctx.sessionID,
          ptyID: info.id,
          cwd: info.cwd,
          shell: info.shell,
          cursor: info.cursor,
        },
      }
    },
  }),
  {
    title: "Write Terminal Input",
    aliases: ["terminal-write-input"],
    capabilities: {
      kind: "exec",
      concurrency: "exclusive",
      needsShell: true,
    },
  },
)
