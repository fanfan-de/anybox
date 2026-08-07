import type { JSONValue } from "@ai-sdk/provider"
import {
  containsWorkspaceLocation,
  createSshWorkspaceUri,
  isSshWorkspaceUri,
  parseWorkspaceLocation,
} from "@anybox/shared"
import z from "zod"
import * as Agent from "#agent/agent.ts"
import * as Config from "#config/config.ts"
import * as Identifier from "#id/id.ts"
import { Instance } from "#project/instance.ts"
import * as Ssh from "#remote/ssh/index.ts"
import {
  createToolExecution,
  getToolAccessFailure,
  readOnlyToolsOnlyForSession,
} from "#tool/execution.ts"
import {
  executeJavaScript,
  type JavaScriptExecutionLimits,
} from "#tool/javascript-runtime.ts"
import { resolveToolPath } from "#tool/shared.ts"
import * as Tool from "#tool/tool.ts"
import * as Log from "#util/log.ts"

export const EXEC_TOOL_ID = "exec"
export const EXEC_CHILD_TOOL_IDS = [
  "read_file",
  "list_directory",
  "glob",
  "grep",
] as const

export type ExecChildToolID = typeof EXEC_CHILD_TOOL_IDS[number]

export type ExecToolCallSummary = {
  callID: string
  tool: ExecChildToolID
  status: "completed" | "failed"
  durationMs: number
  error?: string
}

export type ExecResult = {
  result: JSONValue
  toolCalls: ExecToolCallSummary[]
  durationMs: number
}

type OrderedToolCallSummary = ExecToolCallSummary & {
  order: number
}

const log = Log.create({ service: "tool.exec" })
const ALLOWED_CHILD_KINDS = new Set<Tool.ToolKind>(["read", "search"])
const ERROR_SUMMARY_MAX_CHARS = 500

export const EXEC_JAVASCRIPT_LIMITS: JavaScriptExecutionLimits = {
  wallTimeoutMs: 30_000,
  cpuSliceMs: 250,
  memoryBytes: 32 * 1024 * 1024,
  maxStackBytes: 512 * 1024,
  maxToolCalls: 64,
  maxToolArgumentsChars: 50_000,
  maxToolResultChars: 50_000,
  maxTotalToolResultChars: 500_000,
  maxOutputChars: 50_000,
}

const ExecParameters = z.object({
  code: z.string().trim().min(1).max(32_000),
})

function normalizeError(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string") return error

  try {
    const serialized = JSON.stringify(error)
    if (serialized) return serialized
  } catch {
    // Fall through to String().
  }

  return String(error)
}

function summarizeError(error: unknown) {
  const message = normalizeError(error)
  return message.length > ERROR_SUMMARY_MAX_CHARS
    ? `${message.slice(0, ERROR_SUMMARY_MAX_CHARS)}…`
    : message
}

function failureCategory(error: unknown, signal: AbortSignal) {
  const message = normalizeError(error).toLowerCase()
  const signalReason = signal.aborted
    ? normalizeError(signal.reason).toLowerCase()
    : ""
  if (
    message.includes("timeout") ||
    message.includes("timed out") ||
    signalReason.includes("timeout") ||
    signalReason.includes("timed out")
  ) {
    return "timeout"
  }
  if (signal.aborted) return "aborted"

  if (
    message.includes("budget") ||
    message.includes("limit") ||
    message.includes("memory") ||
    message.includes("stack") ||
    message.includes("cpu")
  ) {
    return "budget"
  }
  if (message.includes("syntax")) return "syntax"
  if (message.includes("approval") || message.includes("permission")) return "permission"
  if (message.includes("tool")) return "tool"
  return "runtime"
}

function isJsonValue(
  value: unknown,
  ancestors = new Set<object>(),
): value is JSONValue {
  if (value === null) return true

  switch (typeof value) {
    case "string":
    case "boolean":
      return true
    case "number":
      return Number.isFinite(value)
    case "object":
      break
    default:
      return false
  }

  const objectValue = value as object
  if (ancestors.has(objectValue)) return false
  ancestors.add(objectValue)

  try {
    if (Array.isArray(value)) {
      return value.every((item) => isJsonValue(item, ancestors))
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false

    return Object.values(value as Record<string, unknown>)
      .every((item) => isJsonValue(item, ancestors))
  } finally {
    ancestors.delete(objectValue)
  }
}

async function childResultToJson(
  execution: Awaited<ReturnType<typeof createToolExecution>>,
  output: Tool.ToolOutput,
): Promise<JSONValue> {
  if (isJsonValue(output.data)) {
    return output.data
  }

  const modelOutput = await execution.toModelOutput(output)
  if (modelOutput.type === "json") return modelOutput.value
  if (modelOutput.type === "text") return modelOutput.value

  if (modelOutput.type === "error-text") {
    throw new Error(modelOutput.value || "Tool returned an error result.")
  }
  if (modelOutput.type === "execution-denied") {
    throw new Error(modelOutput.reason || "Tool execution was denied.")
  }
  if (modelOutput.type === "error-json") {
    throw new Error(JSON.stringify(modelOutput.value) || "Tool returned an error result.")
  }

  return output.text
}

function assertEligibleChildTool(item: Tool.ToolInfo | undefined, id: ExecChildToolID) {
  if (!item) {
    throw new Error(`Required exec child tool "${id}" is not registered.`)
  }

  const kind = item.capabilities?.kind
  if (
    !kind ||
    !ALLOWED_CHILD_KINDS.has(kind) ||
    item.capabilities?.readOnly !== true ||
    item.capabilities?.concurrency !== "safe"
  ) {
    throw new Error(
      `Tool "${id}" is not eligible for exec. Child tools must be read/search, readOnly, and concurrency=safe.`,
    )
  }

  return item
}

function snapshotAgent(agent: Agent.AgentInfo): Agent.AgentInfo {
  return Object.freeze({
    ...agent,
    options: Object.freeze({ ...agent.options }),
    tools: agent.tools ? Object.freeze({ ...agent.tools }) : undefined,
  }) as Agent.AgentInfo
}

function createCombinedAbortSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort(new Error(`JavaScript execution timed out after ${timeoutMs}ms.`))
  }, timeoutMs)
  timeout.unref?.()

  const onParentAbort = () => {
    controller.abort(parent?.reason)
  }

  if (parent?.aborted) {
    onParentAbort()
  } else {
    parent?.addEventListener("abort", onParentAbort, { once: true })
  }

  return {
    signal: controller.signal,
    abort(reason?: unknown) {
      if (!controller.signal.aborted) {
        controller.abort(reason)
      }
    },
    dispose() {
      clearTimeout(timeout)
      parent?.removeEventListener("abort", onParentAbort)
    },
  }
}

function throwIfAborted(signal: AbortSignal) {
  if (!signal.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new Error("JavaScript execution was aborted.")
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    try {
      throwIfAborted(signal)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      try {
        throwIfAborted(signal)
      } catch (error) {
        reject(error)
      }
    }
    const cleanup = () => signal.removeEventListener("abort", onAbort)

    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })
}

async function enforceProjectBoundReadFile(
  input: JSONValue,
  signal: AbortSignal,
  loadCanonicalRemoteRoots: () => Promise<readonly string[]>,
) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return

  const parameters = input as Record<string, JSONValue>
  const requestedPath = parameters.file_path ?? parameters.path
  if (typeof requestedPath === "string") {
    const resolvedPath = resolveToolPath(requestedPath)
    if (!isSshWorkspaceUri(resolvedPath)) return

    const location = parseWorkspaceLocation(resolvedPath)
    if (location.kind !== "ssh") return
    const canonicalPath = await raceWithAbort(
      Ssh.realpath(resolvedPath),
      signal,
    )
    const canonicalTarget = createSshWorkspaceUri(
      location.profileID,
      canonicalPath,
    )
    const canonicalRoots = await raceWithAbort(
      loadCanonicalRemoteRoots(),
      signal,
    )
    if (
      !canonicalRoots.some((root) =>
        containsWorkspaceLocation(root, canonicalTarget)
      )
    ) {
      throw new Error(
        `Path resolves outside the active project boundary: ${requestedPath}`,
      )
    }
  }
}

async function defaultAgent() {
  const agent = await Agent.get("default")
  if (!agent) {
    throw new Error("Default agent is not available.")
  }
  return agent
}

function sortedSummaries(
  summaries: ReadonlyMap<number, OrderedToolCallSummary>,
): ExecToolCallSummary[] {
  return [...summaries.values()]
    .sort((left, right) => left.order - right.order)
    .map(({ order: _order, ...summary }) => summary)
}

function resultCounts(summaries: ReadonlyMap<number, OrderedToolCallSummary>) {
  const values = [...summaries.values()]
  const completedCount = values.filter((item) => item.status === "completed").length
  return {
    completedCount,
    failedCount: values.length - completedCount,
  }
}

export const ExecTool = Tool.define(
  EXEC_TOOL_ID,
  async (initctx) => {
    return {
      title: "JavaScript Exec",
      description: [
        "Run isolated JavaScript to orchestrate the read-only tools tools.read_file, tools.list_directory, tools.glob, and tools.grep.",
        "The code is an async function body, so top-level await, loops, conditions, try/catch, and Promise.all are supported; use return to provide the final JSON result.",
        "Every tools call must be directly awaited, returned, included in an awaited or returned Promise.all, or given a rejection handler before the code returns; do not detach async functions or Promise chains.",
        "No return value becomes null. Each tools method accepts the same input object as the direct tool.",
        "The runtime has no imports, modules, network, filesystem APIs, process, Bun, console, timers, or other host capabilities.",
      ].join(" "),
      parameters: ExecParameters,
      execute: async (parameters, ctx): Promise<Tool.ToolOutput<Record<string, unknown>, ExecResult>> => {
        const parsedParameters = ExecParameters.parse(parameters)
        const startedAt = performance.now()
        const summaries = new Map<number, OrderedToolCallSummary>()
        let issuedToolCallCount = 0
        const parentToolCallID = ctx.toolCallID ?? Identifier.ascending("tool")
        const combinedAbort = createCombinedAbortSignal(ctx.abort, EXEC_JAVASCRIPT_LIMITS.wallTimeoutMs)

        try {
          const [ToolRegistry, globalSelectionResult, resolvedAgent] =
            await raceWithAbort(
              Promise.all([
                import("#tool/registry.ts"),
                Config.getToolSelection(Config.GLOBAL_CONFIG_ID),
                initctx?.agent ? Promise.resolve(initctx.agent) : defaultAgent(),
              ]),
              combinedAbort.signal,
            )
          const builtinRegistryResult = await raceWithAbort(
            ToolRegistry.builtinTools(),
            combinedAbort.signal,
          )
          const registry = Object.freeze([...builtinRegistryResult])
          const builtinToolIDs = new Set(builtinRegistryResult.map((item) => item.id))
          const globalToolSelection = Object.freeze({
            tools: Object.freeze({ ...globalSelectionResult.tools }),
          })
          const agent = snapshotAgent(resolvedAgent)
          const readOnlyToolsOnly = readOnlyToolsOnlyForSession(agent, ctx.sessionID, ctx.turnID)
          const childTools = new Map<ExecChildToolID, Tool.ToolInfo>()
          let canonicalRemoteRootsPromise: Promise<readonly string[]> | undefined
          const loadCanonicalRemoteRoots = () => {
            if (!canonicalRemoteRootsPromise) {
              const remoteRoots = [...new Set([
                Instance.directory,
                Instance.worktree,
              ])].filter(isSshWorkspaceUri)
              canonicalRemoteRootsPromise = Promise.all(
                remoteRoots.map(async (root) => {
                  const location = parseWorkspaceLocation(root)
                  if (location.kind !== "ssh") return root
                  const canonicalPath = await Ssh.realpath(root)
                  return createSshWorkspaceUri(
                    location.profileID,
                    canonicalPath,
                  )
                }),
              )
            }
            return canonicalRemoteRootsPromise
          }

          for (const id of EXEC_CHILD_TOOL_IDS) {
            const item = registry.find((candidate) =>
              candidate.id === id && builtinToolIDs.has(candidate.id)
            )
            childTools.set(id, assertEligibleChildTool(item, id))
          }

          const result = await executeJavaScript({
            code: parsedParameters.code,
            toolNames: EXEC_CHILD_TOOL_IDS,
            signal: combinedAbort.signal,
            limits: EXEC_JAVASCRIPT_LIMITS,
            invokeTool: async (name, childInput) => {
              throwIfAborted(combinedAbort.signal)

              if (!EXEC_CHILD_TOOL_IDS.includes(name as ExecChildToolID)) {
                throw new Error(`Tool "${name}" is not available inside exec.`)
              }

              const tool = name as ExecChildToolID
              const order = ++issuedToolCallCount
              const callID = `${parentToolCallID}:exec:${order}`
              const childStartedAt = performance.now()
              summaries.set(order, {
                order,
                callID,
                tool,
                status: "failed",
                durationMs: 0,
                error: "Tool call did not complete before JavaScript execution ended.",
              })

              try {
                const item = childTools.get(tool)
                if (!item) {
                  throw new Error(`Tool "${tool}" is not available inside exec.`)
                }

                const accessFailure = getToolAccessFailure({
                  item,
                  agent,
                  model: ctx.model ?? initctx?.model,
                  builtinToolIDs,
                  globalToolSelection,
                  readOnlyToolsOnly,
                })
                if (accessFailure) throw new Error(accessFailure)

                if (tool === "read_file") {
                  await enforceProjectBoundReadFile(
                    childInput,
                    combinedAbort.signal,
                    loadCanonicalRemoteRoots,
                  )
                }

                const execution = await createToolExecution({
                  item,
                  agent,
                  model: ctx.model ?? initctx?.model,
                  sessionID: ctx.sessionID,
                  turnID: ctx.turnID,
                  messageID: ctx.messageID,
                  abort: combinedAbort.signal,
                })
                throwIfAborted(combinedAbort.signal)

                const requiresApproval = await execution.needsApproval(childInput, callID)
                throwIfAborted(combinedAbort.signal)
                if (requiresApproval) {
                  throw new Error(
                    `Tool "${tool}" requires approval and cannot run inside exec.`,
                  )
                }

                throwIfAborted(combinedAbort.signal)
                const output = await execution.execute(childInput, {
                  toolCallID: callID,
                })
                throwIfAborted(combinedAbort.signal)
                const childResult = await childResultToJson(execution, output)
                throwIfAborted(combinedAbort.signal)

                summaries.set(order, {
                  order,
                  callID,
                  tool,
                  status: "completed",
                  durationMs: Math.max(0, Math.round(performance.now() - childStartedAt)),
                })
                return childResult
              } catch (error) {
                summaries.set(order, {
                  order,
                  callID,
                  tool,
                  status: "failed",
                  durationMs: Math.max(0, Math.round(performance.now() - childStartedAt)),
                  error: summarizeError(error),
                })
                throw error
              }
            },
          })

          const durationMs = Math.max(0, Math.round(performance.now() - startedAt))
          const toolCalls = sortedSummaries(summaries)
          const data: ExecResult = {
            result,
            toolCalls,
            durationMs,
          }
          const counts = resultCounts(summaries)

          log.info("execution-completed", {
            sessionID: ctx.sessionID,
            parentToolCallID,
            durationMs,
            toolCallCount: issuedToolCallCount,
            ...counts,
            failureCategory: counts.failedCount > 0 ? "child-tool" : undefined,
          })

          return {
            title: `JavaScript exec: ${counts.completedCount} completed, ${counts.failedCount} failed`,
            text: JSON.stringify(data),
            metadata: data,
            data,
          }
        } catch (error) {
          const durationMs = Math.max(0, Math.round(performance.now() - startedAt))
          const counts = resultCounts(summaries)
          log.warn("execution-failed", {
            sessionID: ctx.sessionID,
            parentToolCallID,
            durationMs,
            toolCallCount: issuedToolCallCount,
            ...counts,
            failureCategory: failureCategory(error, combinedAbort.signal),
          })

          throw new Error(
            `JavaScript exec failed: ${normalizeError(error)} (${counts.completedCount} child calls completed, ${counts.failedCount} failed).`,
            { cause: error },
          )
        } finally {
          combinedAbort.abort(new Error("JavaScript execution finished."))
          combinedAbort.dispose()
        }
      },
      toModelOutput: (result) => ({
        type: "json" as const,
        value: (result.data ?? result.metadata ?? { result: null, toolCalls: [], durationMs: 0 }) as JSONValue,
      }),
    }
  },
  {
    title: "JavaScript Exec",
    maxResultSizeChars: Infinity,
    capabilities: {
      kind: "workflow",
      readOnly: true,
      destructive: false,
      concurrency: "safe",
    },
  },
)
