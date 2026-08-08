import type { JSONValue } from "@ai-sdk/provider"
import { stat } from "node:fs/promises"
import z from "zod"
import { isSshWorkspaceUri } from "@anybox/shared"
import * as Config from "#config/config.ts"
import { disposeIpythonRegistry, getIpythonRegistry } from "#ipython/registry.ts"
import {
  IpythonRuntimeError,
  type IpythonExecutionResult,
  type IpythonRuntimeFailure,
} from "#ipython/types.ts"
import { normalizeTerminalOutput } from "#shell/terminal-output.ts"
import * as Tool from "#tool/tool.ts"

const MAX_CODE_CHARS = 100_000
const IPYTHON_TOOL_ID = "ipython"

function isIpythonEnabled(selection: Awaited<ReturnType<typeof Config.getToolSelection>>) {
  return selection.tools[IPYTHON_TOOL_ID] === true
}

const IpythonParameters = z.object({
  code: z
    .string()
    .min(1)
    .max(MAX_CODE_CHARS)
    .refine((value) => value.trim().length > 0, "Code must contain non-whitespace characters."),
})

function normalizeExecutionResult(result: IpythonExecutionResult): IpythonExecutionResult {
  return {
    ...result,
    stdout: normalizeTerminalOutput(result.stdout),
    stderr: normalizeTerminalOutput(result.stderr),
    result: result.result === undefined ? undefined : normalizeTerminalOutput(result.result),
    displays: result.displays.map((display) => ({
      ...display,
      data: normalizeTerminalOutput(display.data),
    })),
    error: result.error
      ? {
          ...result.error,
          traceback: result.error.traceback.map(normalizeTerminalOutput),
        }
      : undefined,
  }
}

function formatExecutionResult(result: IpythonExecutionResult) {
  const sections: string[] = []
  if (result.stdout) sections.push(result.stdout)
  if (result.stderr) sections.push(`stderr:\n${result.stderr}`)
  if (result.result) sections.push(result.result)
  for (const display of result.displays) {
    if (display.data && display.data !== result.result) sections.push(display.data)
  }
  if (result.error) {
    const traceback = result.error.traceback.filter(Boolean).join("\n")
    sections.push(traceback || `${result.error.name}: ${result.error.message}`)
  }
  if (sections.length === 0) sections.push("IPython cell completed with no output.")
  if (result.outputTruncated) sections.push("[Output was truncated by Anybox.]")
  if (result.stateLost) {
    sections.push("[The IPython kernel was stopped and its in-memory state was lost.]")
  }
  return sections.join("\n\n")
}

function runtimeFailure(error: IpythonRuntimeError): IpythonRuntimeFailure {
  return {
    status: "runtime_error",
    errorCode: error.code,
    message: normalizeTerminalOutput(error.message),
    kernelGeneration: error.kernelGeneration ?? 0,
    stateLost: true,
  }
}

function formatRuntimeFailure(failure: IpythonRuntimeFailure) {
  return [
    `${failure.errorCode}: ${failure.message}`,
    `[The IPython kernel stopped. In-memory state from kernel generation ${failure.kernelGeneration} was lost.]`,
  ].join("\n\n")
}

function isRuntimeFailure(value: unknown): value is IpythonRuntimeFailure {
  return Boolean(
    value
      && typeof value === "object"
      && "status" in value
      && value.status === "runtime_error",
  )
}

export const IpythonTool = Tool.define<
  typeof IpythonParameters,
  Record<string, unknown>,
  IpythonExecutionResult | IpythonRuntimeFailure
>(
  IPYTHON_TOOL_ID,
  async () => ({
    title: "IPython",
    description: [
      "Execute Python and IPython code in a persistent environment scoped to the current Anybox session.",
      "Variables, imports, functions, and working-directory changes persist between calls while the session kernel is alive.",
      "This runtime is not a security sandbox and code runs with the current user's operating-system permissions.",
    ].join(" "),
    parameters: IpythonParameters,
    validate: async (_parameters, ctx) => {
      if (ctx.abort?.aborted) return "IPython execution was cancelled before the cell started."
      const cwd = ctx.cwd ?? ctx.worktree
      if (!cwd) return "IPython requires a local workspace directory."
      if (isSshWorkspaceUri(cwd)) return "IPython does not support SSH workspaces yet."
      const directory = await stat(cwd).catch(() => undefined)
      if (!directory?.isDirectory()) return `IPython workdir must be a directory: ${cwd}`
    },
    assessPermission: ({ code }, ctx) => {
      const workdir = ctx.cwd ?? ctx.worktree
      return {
        action: "ask",
        risk: "high",
        reason: "IPython executes arbitrary Python and shell commands with the current user's permissions.",
        resource: {
          workdir,
          paths: workdir ? [workdir] : undefined,
          body: code,
        },
      }
    },
    describeApproval: ({ code }, ctx) => {
      const workdir = ctx.cwd ?? ctx.worktree
      return {
        title: "Run IPython cell",
        summary: `Run Python code in ${workdir ?? "the active workspace"}.`,
        details: {
          workdir,
          paths: workdir ? [workdir] : undefined,
          body: code,
        },
      }
    },
    execute: async ({ code }, ctx) => {
      const cwd = ctx.cwd ?? ctx.worktree
      if (!cwd) throw new Error("IPython requires a local workspace directory.")

      // A tool call can wait behind an approval while the user disables
      // IPython. Re-check after acquiring the singleton so a stale call cannot
      // recreate a kernel after the disable path permanently closes it.
      const selection = await Config.getToolSelection(Config.GLOBAL_CONFIG_ID)
      if (!isIpythonEnabled(selection)) {
        await disposeIpythonRegistry()
        throw new Error("IPython is disabled in Builtin Tools.")
      }
      const registry = getIpythonRegistry()
      const latestSelection = await Config.getToolSelection(Config.GLOBAL_CONFIG_ID)
      if (!isIpythonEnabled(latestSelection)) {
        await disposeIpythonRegistry()
        throw new Error("IPython was disabled before this cell could start.")
      }

      let result: IpythonExecutionResult
      try {
        result = normalizeExecutionResult(await registry.execute({
          sessionID: ctx.sessionID,
          cwd,
          code,
          signal: ctx.abort,
        }))
      } catch (error) {
        if (!(error instanceof IpythonRuntimeError) || !error.stateLost) throw error
        // Thrown tool errors are flattened to text before the next model turn.
        // Return a tagged result so toModelOutput can preserve the fatal
        // runtime metadata as error-json.
        const failure = runtimeFailure(error)
        return {
          title: "IPython runtime failed",
          text: formatRuntimeFailure(failure),
          metadata: { ...failure },
          data: failure,
        }
      }
      return {
        title:
          result.status === "ok"
            ? "IPython completed"
            : result.status === "error"
              ? "IPython error"
              : result.status === "timed_out"
                ? "IPython timed out"
                : "IPython cancelled",
        text: formatExecutionResult(result),
        metadata: { ...result },
        data: result,
      }
    },
    toModelOutput: (output) => {
      const value = (output.data ?? output.metadata ?? { text: output.text }) as unknown
      return {
        type: isRuntimeFailure(value) ? "error-json" as const : "json" as const,
        value: value as JSONValue,
      }
    },
  }),
  {
    title: "IPython",
    defaultEnabled: false,
    maxResultSizeChars: 100_000,
    capabilities: {
      kind: "exec",
      readOnly: false,
      destructive: true,
      concurrency: "exclusive",
      needsShell: true,
    },
  },
)
