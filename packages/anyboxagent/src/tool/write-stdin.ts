import z from "zod"
import * as Identifier from "#id/id.ts"
import { getShellTaskRegistry } from "#shell/task-registry.ts"
import { normalizeTerminalOutput } from "#shell/terminal-output.ts"
import { isCriticalShellCommand, type ShellKind } from "#tool/shell-command.ts"
import * as Tool from "#tool/tool.ts"
import { toDisplayPath } from "#tool/shared.ts"

const INTERRUPT = "\x03"
const DEFAULT_POLL_YIELD_TIME_MS = 5_000
const DEFAULT_WRITE_YIELD_TIME_MS = 250
const MIN_POLL_YIELD_TIME_MS = 5_000
const MIN_WRITE_YIELD_TIME_MS = 250
const MAX_POLL_YIELD_TIME_MS = 300_000
const MAX_WRITE_YIELD_TIME_MS = 30_000
const DEFAULT_MAX_OUTPUT_TOKENS = 10_000
const MAX_OUTPUT_TOKENS = 50_000
const CHARS_PER_TOKEN = 4

const WriteStdinParameters = z.object({
  session_id: Identifier.schema("task").describe("Identifier of the running shell session."),
  chars: z.string().max(100_000).optional().describe("Characters to write to stdin. Defaults to empty, which polls without writing. Use \\u0003 to interrupt the process."),
  "yield-time_ms": z.number().int().nonnegative().max(MAX_POLL_YIELD_TIME_MS).optional().describe("Wait before yielding output. Empty polls clamp to 5000-300000 ms; non-empty writes clamp to 250-30000 ms."),
  max_output_tokens: z.number().int().positive().max(MAX_OUTPUT_TOKENS).optional().describe("Approximate output token budget. Defaults to 10000 tokens."),
}).strict()

interface WriteStdinMetadata extends Record<string, unknown> {
  id: string
  sessionID: string | null
  title: string
  command: string
  cwd: string
  displayCwd: string
  shell: string
  status: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  tty: boolean
  timedOut: boolean
  interrupted: boolean
  inputChars: number
  output: string
  outputTruncated: boolean
  originalTokenCount: number
  wallTimeSeconds: number
}

function resolveYieldTimeMs(chars: string, requested?: number) {
  if (chars) {
    return Math.min(
      MAX_WRITE_YIELD_TIME_MS,
      Math.max(MIN_WRITE_YIELD_TIME_MS, requested ?? DEFAULT_WRITE_YIELD_TIME_MS),
    )
  }

  return Math.min(
    MAX_POLL_YIELD_TIME_MS,
    Math.max(MIN_POLL_YIELD_TIME_MS, requested ?? DEFAULT_POLL_YIELD_TIME_MS),
  )
}

function detectShellKind(shell: string): ShellKind {
  const normalized = shell.toLowerCase()
  if (normalized.includes("powershell") || normalized.includes("pwsh")) return "powershell"
  if (normalized.includes("cmd.exe") || normalized.endsWith("cmd")) return "cmd"
  if (normalized.includes("wsl")) return "wsl"
  if (normalized.includes("bash")) return "bash"
  return "posix"
}

function retainRecentOutput(output: string, maxTokens: number) {
  const bytes = Buffer.from(output, "utf8")
  const maxBytes = Math.min(200_000, maxTokens * CHARS_PER_TOKEN)
  const originalTokenCount = Math.ceil(bytes.length / CHARS_PER_TOKEN)
  if (bytes.length <= maxBytes) {
    return {
      output,
      truncated: false,
      originalTokenCount,
    }
  }

  let start = bytes.length - maxBytes
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) {
    start += 1
  }

  return {
    output: bytes.subarray(start).toString("utf8"),
    truncated: true,
    originalTokenCount,
  }
}

export const WriteStdinTool = Tool.define(
  "write_stdin",
  async (): Promise<Tool.ToolRuntime<typeof WriteStdinParameters, WriteStdinMetadata>> => ({
    title: "Write Stdin",
    description: "Poll a managed shell session or interact with a tty=true terminal. Pipe sessions accept only empty polls and \\u0003 interruption; ordinary input requires restarting the command with tty=true.",
    parameters: WriteStdinParameters,
    validate: (parameters, ctx) => {
      const task = getShellTaskRegistry().info(parameters.session_id, ctx.sessionID)
      if (!task) {
        return `Shell session '${parameters.session_id}' was not found.`
      }
      if ((parameters.chars ?? "") && task.status !== "running") {
        return `Shell session '${parameters.session_id}' is not running.`
      }
      const chars = parameters.chars ?? ""
      if (chars && chars !== INTERRUPT && !task.tty) {
        return "Pipe shell sessions do not accept ordinary stdin. Stop the current task if needed, then restart the original shell command with tty=true."
      }
    },
    assessPermission: (parameters, ctx) => {
      const chars = parameters.chars ?? ""
      if (!chars) {
        return {
          action: "allow",
          risk: "low",
          reason: "Polling a managed shell session only reads buffered output and status.",
          allowInPlanning: true,
        }
      }
      if (chars === INTERRUPT) {
        return {
          action: "allow",
          risk: "medium",
          reason: "Ctrl-C interrupts a shell process that was already started by this session.",
        }
      }
      const task = getShellTaskRegistry().info(parameters.session_id, ctx.sessionID)
      if (task && !task.tty) {
        return {
          action: "deny",
          risk: "low",
          reason: "Pipe shell sessions do not accept ordinary stdin; restart the command with tty=true.",
        }
      }
      if (task && isCriticalShellCommand(detectShellKind(task.shell), chars)) {
        return {
          action: "deny",
          risk: "critical",
          reason: "Raw shell input matches a known dangerous command pattern.",
          resource: {
            command: chars,
            workdir: task.cwd,
            paths: [task.cwd],
          },
        }
      }
      return {
        action: "ask",
        risk: "medium",
        reason: "Writing stdin can interact with and change the behavior of a running shell process.",
        resource: {
          body: chars,
        },
      }
    },
    describeApproval: (parameters, ctx) => {
      const task = getShellTaskRegistry().info(parameters.session_id, ctx.sessionID)
      return {
        title: "Write shell input",
        summary: `Write input to shell session ${parameters.session_id}.`,
        details: {
          command: task?.command,
          workdir: task ? toDisplayPath(task.cwd) : undefined,
          paths: task ? [task.cwd] : undefined,
          body: parameters.chars,
        },
      }
    },
    execute: async (parameters, ctx) => {
      if (ctx.abort?.aborted) {
        throw new Error("write_stdin was cancelled before interacting with the shell session.")
      }
      const chars = parameters.chars ?? ""
      const yieldTimeMs = resolveYieldTimeMs(chars, parameters["yield-time_ms"])
      const interaction = await getShellTaskRegistry().interact({
        id: parameters.session_id,
        ownerSessionID: ctx.sessionID,
        data: chars,
        yieldTimeMs,
        abort: ctx.abort,
      })
      if (!interaction) {
        throw new Error(`Shell session '${parameters.session_id}' was not found.`)
      }

      const replayOutput = interaction.task.tty
        ? normalizeTerminalOutput(interaction.replay.output)
        : interaction.replay.output
      const retained = retainRecentOutput(
        replayOutput,
        parameters.max_output_tokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      )
      const outputTruncated = retained.truncated || (
        interaction.replay.mode === "reset" && interaction.replay.startCursor > 0
      )
      const running = interaction.task.status === "running"
      const displayCwd = toDisplayPath(interaction.task.cwd)
      const wallTimeSeconds = interaction.wallTimeMs / 1_000

      return {
        title: running ? `Shell Session ${interaction.task.id}` : `Shell Session ${interaction.task.id} Finished`,
        text: [
          `Session ID: ${interaction.task.id}`,
          `Command: ${interaction.task.command}`,
          `Workdir: ${displayCwd}`,
          `Shell: ${interaction.task.shell}`,
          `TTY: ${interaction.task.tty ? "yes" : "no"}`,
          `Status: ${interaction.task.status}`,
          `Exit: ${interaction.task.exitCode ?? (running ? "running" : "unknown")}`,
          `Timed Out: ${interaction.task.timedOut ? "yes" : "no"}`,
          `Wall Time: ${wallTimeSeconds.toFixed(3)} seconds`,
          outputTruncated ? "Note: Output was truncated to the configured token budget." : undefined,
          "",
          "OUTPUT:",
          retained.output || "(no new output)",
        ].filter(Boolean).join("\n"),
        metadata: {
          id: interaction.task.id,
          sessionID: running ? interaction.task.id : null,
          title: interaction.task.title,
          command: interaction.task.command,
          cwd: interaction.task.cwd,
          displayCwd,
          shell: interaction.task.shell,
          tty: interaction.task.tty,
          status: interaction.task.status,
          exitCode: interaction.task.exitCode,
          signal: interaction.task.signal,
          timedOut: interaction.task.timedOut,
          interrupted: chars === INTERRUPT,
          inputChars: chars.length,
          output: retained.output,
          outputTruncated,
          originalTokenCount: retained.originalTokenCount,
          wallTimeSeconds,
        },
      }
    },
    toModelOutput: async (result) => {
      const metadata = result.metadata
      if (!metadata) {
        return {
          type: "text",
          value: result.text,
        }
      }

      return {
        type: "json",
        value: {
          ...(metadata.sessionID ? { session_id: metadata.sessionID } : {}),
          ...(typeof metadata.exitCode === "number" ? { exit_code: metadata.exitCode } : {}),
          status: metadata.status,
          tty: metadata.tty,
          signal: metadata.signal,
          timed_out: metadata.timedOut,
          interrupted: metadata.interrupted,
          wall_time_seconds: metadata.wallTimeSeconds,
          original_token_count: metadata.originalTokenCount,
          output_truncated: metadata.outputTruncated,
          output: metadata.output,
        },
      }
    },
  }),
  {
    title: "Write Stdin",
    aliases: ["write-stdin"],
    capabilities: {
      kind: "exec",
      readOnly: false,
      destructive: true,
      concurrency: "safe",
      needsShell: true,
    },
  },
)
