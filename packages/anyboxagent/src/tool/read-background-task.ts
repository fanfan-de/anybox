import z from "zod"
import { Flag } from "#flag/flag.ts"
import * as Identifier from "#id/id.ts"
import { getShellTaskRegistry } from "#shell/task-registry.ts"
import * as Tool from "#tool/tool.ts"
import { toDisplayPath } from "#tool/shared.ts"

const DEFAULT_MAX_OUTPUT_CHARS = Flag.ANYBOX_EXPERIMENTAL_BASH_MAX_OUTPUT_LENGTH ?? 12_000

const ReadBackgroundTaskParameters = z.object({
  id: Identifier.schema("task").describe("Background task id."),
  cursor: z.number().int().nonnegative().optional().describe("Cursor from a previous read to fetch only new output."),
  maxOutputChars: z.number().int().positive().max(200_000).optional().describe("Maximum chars returned from the task output."),
})

interface ReadBackgroundTaskMetadata extends Record<string, unknown> {
  id: string
  title: string
  command: string
  cwd: string
  displayCwd: string
  shell: string
  status: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  cursor: number
  startCursor: number
  mode: "delta" | "reset"
  output: string
  outputTruncated: boolean
}

function retainRecentOutput(output: string, maxChars: number) {
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

export const ReadBackgroundTaskTool = Tool.define(
  "read_background_task",
  async (): Promise<Tool.ToolRuntime<typeof ReadBackgroundTaskParameters, ReadBackgroundTaskMetadata>> => {
    return {
      title: "Background Task",
      description: "Deprecated compatibility tool for reading a background shell task. Prefer write_stdin with empty chars.",
      parameters: ReadBackgroundTaskParameters,
      execute: async (parameters, ctx) => {
        const result = getShellTaskRegistry().read(parameters.id, parameters.cursor, ctx.sessionID)
        if (!result) {
          throw new Error(`Background task '${parameters.id}' was not found.`)
        }

        const maxOutputChars = parameters.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS
        const retained = retainRecentOutput(result.replay.output, maxOutputChars)
        const displayCwd = toDisplayPath(result.task.cwd)

        return {
          title: `Background Task ${result.task.id}`,
          text: [
            `Background Task ID: ${result.task.id}`,
            `Title: ${result.task.title}`,
            `Command: ${result.task.command}`,
            `Workdir: ${displayCwd}`,
            `Shell: ${result.task.shell}`,
            `Status: ${result.task.status}`,
            `Exit: ${result.task.exitCode ?? "running"}`,
            `Timed Out: ${result.task.timedOut ? "yes" : "no"}`,
            `Output Mode: ${result.replay.mode}`,
            `Cursor: ${result.replay.cursor}`,
            `Start Cursor: ${result.replay.startCursor}`,
            retained.truncated ? `Note: Output was truncated to the most recent ${maxOutputChars} characters.` : undefined,
            "",
            "OUTPUT:",
            retained.output || "(no output)",
          ].filter(Boolean).join("\n"),
          metadata: {
            id: result.task.id,
            title: result.task.title,
            command: result.task.command,
            cwd: result.task.cwd,
            displayCwd,
            shell: result.task.shell,
            status: result.task.status,
            exitCode: result.task.exitCode,
            signal: result.task.signal,
            timedOut: result.task.timedOut,
            cursor: result.replay.cursor,
            startCursor: result.replay.startCursor,
            mode: result.replay.mode,
            output: retained.output,
            outputTruncated: retained.truncated,
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
            id: metadata.id,
            title: metadata.title,
            command: metadata.command,
            workdir: metadata.displayCwd,
            shell: metadata.shell,
            status: metadata.status,
            exitCode: metadata.exitCode,
            signal: metadata.signal,
            timedOut: metadata.timedOut,
            cursor: metadata.cursor,
            startCursor: metadata.startCursor,
            mode: metadata.mode,
            output: metadata.output,
            outputTruncated: metadata.outputTruncated,
          },
        }
      },
    }
  },
  {
    title: "Background Task",
    aliases: ["read-background-task"],
    capabilities: {
      kind: "read",
      readOnly: true,
      destructive: false,
      concurrency: "safe",
    },
  },
)
