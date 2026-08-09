import z from "zod"
import { parseWorkspaceLocation } from "@anybox/shared"
import { Instance } from "#project/instance.ts"
import * as Ssh from "#remote/ssh/index.ts"
import { isApiError } from "#server/error.ts"
import { assessShellPermission, isCriticalShellCommand } from "#tool/shell-command.ts"
import { resolveToolPath, statResolvedPath, toDisplayPath } from "#tool/shared.ts"
import * as Tool from "#tool/tool.ts"

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_OUTPUT_CHARS = 12_000

const SshShellCommandParameters = z.object({
  command: z.string().min(1).describe("POSIX shell command to execute on the SSH server."),
  workdir: z.string().optional().describe("Remote working directory. Defaults to the current SSH project directory."),
  timeoutMs: z.number().int().positive().max(10 * 60 * 1000).optional().describe("Timeout in milliseconds."),
  maxOutputChars: z.number().int().positive().max(200_000).optional().describe("Maximum chars kept for stdout and stderr."),
  allowUnsafe: z.boolean().optional().describe("Allow known dangerous command patterns."),
  description: z.string().optional().describe("Short description for the command intent."),
})

type SshShellCommandParameters = z.infer<typeof SshShellCommandParameters>

function resolveRemoteCwd(parameters: SshShellCommandParameters, ctx: Tool.Context) {
  return parameters.workdir
    ? resolveToolPath(parameters.workdir)
    : resolveToolPath(ctx.cwd ?? Instance.directory)
}

function splitRemoteUri(uri: string) {
  const location = parseWorkspaceLocation(uri)
  if (location.kind !== "ssh") throw new Error("ssh_shell_command can only run in an SSH workspace")
  return location
}

export const SshShellCommandTool = Tool.define(
  "ssh_shell_command",
  async () => {
    return {
      title: "SSH Shell",
      description: "Run a non-interactive POSIX shell command on the configured SSH server inside the current remote project boundary.",
      parameters: SshShellCommandParameters,
      validate: async (parameters, ctx) => {
        if (ctx.abort?.aborted) {
          throw new Tool.ToolControlSignal({
            kind: "cancelled",
            reason: "SSH command was cancelled before it started.",
            by: "framework",
            execution: { sideEffect: "none", retry: "safe" },
          }, { mode: "cancel-turn", reason: "SSH command was cancelled." })
        }
        const command = parameters.command.trim()
        if (!command) return "Command must contain non-whitespace characters."

        let cwd: string
        try {
          cwd = resolveRemoteCwd(parameters, ctx)
        } catch (error) {
          return error instanceof Error ? error.message : "Failed to resolve workdir."
        }

        const stats = await statResolvedPath(cwd).catch(() => undefined)
        if (!stats?.isDirectory()) return `Workdir must be a remote directory: ${parameters.workdir ?? cwd}`
      },
      describeApproval: (parameters, ctx) => {
        const cwd = resolveRemoteCwd(parameters, ctx)
        const displayCwd = toDisplayPath(cwd)
        return {
          title: parameters.description?.trim() || "Run SSH command",
          summary: `Run an SSH shell command in ${displayCwd}.`,
          details: {
            command: parameters.command.trim(),
            workdir: displayCwd,
            paths: [displayCwd],
          },
        }
      },
      assessPermission: (parameters, ctx) => {
        const cwd = resolveRemoteCwd(parameters, ctx)
        return assessShellPermission("posix", parameters, cwd)
      },
      authorize: (parameters) => {
        const command = parameters.command.trim()
        if (!parameters.allowUnsafe && isCriticalShellCommand("posix", command)) {
          return {
            message:
              "Command matched a dangerous pattern and was blocked. Set allowUnsafe=true only when this action is explicitly intended.",
          }
        }
      },
      execute: async (parameters, ctx) => {
        if (ctx.abort?.aborted) {
          throw new Tool.ToolControlSignal({
            kind: "cancelled",
            reason: "SSH command was cancelled before it started.",
            by: "framework",
            execution: { sideEffect: "none", retry: "safe" },
          }, { mode: "cancel-turn", reason: "SSH command was cancelled." })
        }
        const cwd = resolveRemoteCwd(parameters, ctx)
        const location = splitRemoteUri(cwd)
        const command = parameters.command.trim()
        const timeoutMs = parameters.timeoutMs ?? DEFAULT_TIMEOUT_MS
        const maxOutputChars = parameters.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS
        const result = await Ssh.exec(location.profileID, location.remotePath, command, {
          timeoutMs,
          maxOutputChars,
        }).catch((error) => {
          if (isApiError(error) && error.code === "SSH_COMMAND_TIMEOUT") {
            throw new Tool.ToolControlSignal({
              kind: "timeout",
              reason: "SSH command exceeded its configured timeout.",
              timeoutMs,
              execution: { sideEffect: "possible", retry: "unsafe" },
            }, { mode: "continue-model", reason: "SSH command timed out." })
          }
          if (isApiError(error)) {
            throw new Tool.ToolFailureError(error, {
              stage: "transport",
              source: "provider",
              code: error.code,
              handlerExecuted: true,
              details: { status: error.status },
            })
          }
          throw error
        })
        const stdout = result.stdout.trimEnd()
        const stderr = result.stderr.trimEnd()
        const title = result.exitCode === 0
          ? "SSH command completed"
          : "SSH command failed"

        return {
          title,
          text: [
            `Exit: ${result.exitCode}`,
            "",
            "STDOUT:",
            stdout || "(no stdout)",
            "",
            "STDERR:",
            stderr || "(no stderr)",
          ].join("\n"),
          metadata: {
            command,
            shell: "remote sh -lc",
            cwd,
            displayCwd: toDisplayPath(cwd),
            timeoutMs,
            exitCode: result.exitCode,
            stdout,
            stderr,
            stdoutTruncated: result.stdoutTruncated,
            stderrTruncated: result.stderrTruncated,
            durationMs: result.durationMs,
          },
          result: result.exitCode === 0 ? "success" : "negative",
          completeness: result.stdoutTruncated || result.stderrTruncated ? "partial" : "complete",
          sideEffect: "possible",
          retry: "unsafe",
        }
      },
      toModelOutput: async (result) => {
        const metadata = result.metadata
        if (!metadata) return { type: "text", value: result.text }
        return {
          type: "json",
          value: {
            workdir: metadata.displayCwd,
            shell: metadata.shell,
            exitCode: metadata.exitCode,
            result: result.result ?? "success",
            completeness: result.completeness ?? "complete",
            stdout: metadata.stdout,
            stderr: metadata.stderr,
          },
        }
      },
    }
  },
  {
    title: "SSH Shell",
    aliases: ["ssh-shell-command"],
    capabilities: {
      kind: "exec",
      readOnly: false,
      destructive: true,
      concurrency: "exclusive",
      needsShell: true,
    },
  },
)
