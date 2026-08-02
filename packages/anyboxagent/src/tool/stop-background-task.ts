import z from "zod"
import * as Identifier from "#id/id.ts"
import { getShellTaskRegistry } from "#shell/task-registry.ts"
import * as Tool from "#tool/tool.ts"
import { toDisplayPath } from "#tool/shared.ts"

const StopBackgroundTaskParameters = z.object({
  id: Identifier.schema("task").describe("Background task id."),
})

interface StopBackgroundTaskMetadata extends Record<string, unknown> {
  id: string
  title: string
  command: string
  cwd: string
  displayCwd: string
  shell: string
  tty: boolean
  status: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  cursor: number
}

export const StopBackgroundTaskTool = Tool.define(
  "stop_background_task",
  async (): Promise<Tool.ToolRuntime<typeof StopBackgroundTaskParameters, StopBackgroundTaskMetadata>> => {
    return {
      title: "Stop Background Task",
      description: "Deprecated compatibility tool for force-terminating a background shell task. For tty=true sessions, use this when terminal Ctrl-C should not or did not close the session.",
      parameters: StopBackgroundTaskParameters,
      execute: async (parameters, ctx) => {
        const task = await getShellTaskRegistry().stop(parameters.id, ctx.sessionID)
        if (!task) {
          throw new Error(`Background task '${parameters.id}' was not found.`)
        }

        const displayCwd = toDisplayPath(task.cwd)

        return {
          title: `Stopped ${task.id}`,
          text: [
            `Background Task ID: ${task.id}`,
            `Title: ${task.title}`,
            `Command: ${task.command}`,
            `Workdir: ${displayCwd}`,
            `Shell: ${task.shell}`,
            `TTY: ${task.tty ? "yes" : "no"}`,
            `Status: ${task.status}`,
            `Exit: ${task.exitCode ?? "unknown"}`,
            `Timed Out: ${task.timedOut ? "yes" : "no"}`,
          ].join("\n"),
          metadata: {
            id: task.id,
            title: task.title,
            command: task.command,
            cwd: task.cwd,
            displayCwd,
            shell: task.shell,
            tty: task.tty,
            status: task.status,
            exitCode: task.exitCode,
            signal: task.signal,
            timedOut: task.timedOut,
            cursor: task.cursor,
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
            tty: metadata.tty,
            status: metadata.status,
            exitCode: metadata.exitCode,
            signal: metadata.signal,
            timedOut: metadata.timedOut,
            cursor: metadata.cursor,
          },
        }
      },
    }
  },
  {
    title: "Stop Background Task",
    aliases: ["stop-background-task"],
    capabilities: {
      kind: "exec",
      readOnly: false,
      destructive: true,
      concurrency: "exclusive",
    },
  },
)
