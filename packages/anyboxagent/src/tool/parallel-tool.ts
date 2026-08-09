import type { JSONValue } from "@ai-sdk/provider"
import z from "zod"
import * as Agent from "#agent/agent.ts"
import * as Config from "#config/config.ts"
import * as Identifier from "#id/id.ts"
import type * as Provider from "#provider/provider.ts"
import {
  createToolExecution,
  getToolAccessFailure,
  readOnlyToolsOnlyForSession,
} from "#tool/execution.ts"
import * as Tool from "#tool/tool.ts"

export const PARALLEL_TOOL_ID = "multi_tool_use_parallel"
export const PARALLEL_TOOL_LEGACY_ID = "multi_tool_use.parallel"

const ALLOWED_CHILD_KINDS = new Set<Tool.ToolKind>(["read", "search"])
const MAX_PARALLEL_CALLS = 8

const ParallelCall = z.object({
  tool: z.string().trim().min(1).describe("Tool id or alias to execute."),
  input: z.record(z.string(), z.unknown()).optional().describe("Input object for the child tool."),
})

const ParallelToolParameters = z.object({
  calls: z
    .array(ParallelCall)
    .min(1)
    .max(MAX_PARALLEL_CALLS)
    .describe("Independent read/search tool calls to execute in parallel."),
})

type ParallelCallInput = z.infer<typeof ParallelCall>

type ParallelChildResult = {
  index: number
  tool: string
  phase: "settled"
  outcome: "returned" | "blocked" | "denied" | "cancelled" | "timeout" | "failed"
  result?: "success" | "negative"
  completeness?: "complete" | "partial"
  title?: string
  output?: string
  modelOutput?: Exclude<Tool.ToolModelOutput, string>
  error?: string
}

type ParallelToolData = {
  kind: "parallel-tool-results"
  results: ParallelChildResult[]
}

function normalizeError(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string") return error

  try {
    const serialized = JSON.stringify(error)
    if (serialized) return serialized
  } catch {
    // fall through
  }

  return String(error)
}

function findToolByName(tools: Tool.ToolInfo[], name: string) {
  return tools.find((item) => Tool.toolMatchesName(item, name))
}

function getChildEligibilityFailure(item: Tool.ToolInfo) {
  if ((item.modelRequirements?.inputModalities?.length ?? 0) > 0) {
    return `Tool "${item.id}" must be called directly because model-dependent content tools cannot be wrapped by ${PARALLEL_TOOL_ID}.`
  }

  const kind = item.capabilities?.kind
  if (
    item.capabilities?.readOnly !== true ||
    item.capabilities?.concurrency !== "safe" ||
    !kind ||
    !ALLOWED_CHILD_KINDS.has(kind)
  ) {
    return `Tool "${item.id}" is not eligible for ${PARALLEL_TOOL_ID}. Only read/search tools marked readOnly and concurrency=safe can be batched.`
  }
}

function isParallelToolName(name: string) {
  return name === PARALLEL_TOOL_ID || name === PARALLEL_TOOL_LEGACY_ID
}

async function defaultAgent() {
  const agent = await Agent.get("default")
  if (!agent) {
    throw new Error("Default agent is not available.")
  }

  return agent
}

async function runChildCall(input: {
  call: ParallelCallInput
  index: number
  agent: Agent.AgentInfo
  model?: Provider.Model
  sessionID: string
  turnID?: string
  messageID: string
  abort: AbortSignal
  parentToolCallID: string
  registry: Tool.ToolInfo[]
  builtinToolIDs: Set<string>
  globalToolSelection: Awaited<ReturnType<typeof Config.getToolSelection>>
  readOnlyToolsOnly: boolean
}): Promise<ParallelChildResult> {
  const requestedTool = input.call.tool.trim()
  const base = {
    index: input.index,
    tool: requestedTool,
  }

  try {
    if (isParallelToolName(requestedTool)) {
      return {
        ...base,
        phase: "settled",
        outcome: "blocked",
        error: `${PARALLEL_TOOL_ID} cannot call itself.`,
      }
    }

    const item = findToolByName(input.registry, requestedTool)
    if (!item) {
      return {
        ...base,
        phase: "settled",
        outcome: "blocked",
        error: `Tool "${requestedTool}" is not available.`,
      }
    }

    const accessFailure = getToolAccessFailure({
      item,
      agent: input.agent,
      model: input.model,
      builtinToolIDs: input.builtinToolIDs,
      globalToolSelection: input.globalToolSelection,
      readOnlyToolsOnly: input.readOnlyToolsOnly,
    })
    if (accessFailure) {
      return {
        ...base,
        phase: "settled",
        outcome: "blocked",
        error: accessFailure,
      }
    }

    const eligibilityFailure = getChildEligibilityFailure(item)
    if (eligibilityFailure) {
      return {
        ...base,
        phase: "settled",
        outcome: "blocked",
        error: eligibilityFailure,
      }
    }

    const execution = await createToolExecution({
      item,
      agent: input.agent,
      model: input.model,
      sessionID: input.sessionID,
      turnID: input.turnID,
      messageID: input.messageID,
      abort: input.abort,
    })
    const output = await execution.execute(input.call.input ?? {}, {
      toolCallID: `${input.parentToolCallID}:${input.index}`,
    })
    const modelOutput = await execution.toModelOutput(output)

    return {
      ...base,
      tool: item.id,
      phase: "settled",
      outcome: "returned",
      result: output.result ?? "success",
      completeness: output.completeness ?? "complete",
      title: output.title,
      output: output.text,
      modelOutput,
    }
  } catch (error) {
    const signal = Tool.findToolControlSignal(error)
    return {
      ...base,
      phase: "settled",
      outcome: signal?.outcome.kind ?? "failed",
      error: normalizeError(error),
    }
  }
}

function formatResults(results: ParallelChildResult[]) {
  return results
    .map((result) => {
      const semantics = result.outcome === "returned"
        ? `${result.outcome}/${result.result}/${result.completeness}`
        : result.outcome
      const header = `[${result.index}] ${result.tool}: ${semantics}${result.title ? ` - ${result.title}` : ""}`
      if (result.outcome !== "returned") {
        return `${header}\n${result.error ?? "Unknown error."}`
      }

      return `${header}\n${result.output ?? ""}`.trimEnd()
    })
    .join("\n\n")
}

export const ParallelTool = Tool.define(
  PARALLEL_TOOL_ID,
  async (initctx) => {
    return {
      title: "Parallel Tool Use",
      description:
        "Execute 1-8 independent read/search tool calls in parallel. Only read-only tools marked concurrency=safe are allowed.",
      parameters: ParallelToolParameters,
      execute: async (parameters, ctx): Promise<Tool.ToolOutput<Record<string, unknown>, ParallelToolData>> => {
        const parsedParameters = ParallelToolParameters.parse(parameters)
        const [ToolRegistry, globalToolSelection] = await Promise.all([
          import("#tool/registry.ts"),
          Config.getToolSelection(Config.GLOBAL_CONFIG_ID),
        ])
        const [registry, builtinRegistry] = await Promise.all([
          ToolRegistry.tools(ctx.abort),
          ToolRegistry.builtinTools(),
        ])
        const agent = initctx?.agent ?? await defaultAgent()
        const builtinToolIDs = new Set(builtinRegistry.map((item) => item.id))
        const readOnlyToolsOnly = readOnlyToolsOnlyForSession(agent, ctx.sessionID, ctx.turnID)
        const parentToolCallID = ctx.toolCallID ?? Identifier.ascending("tool")
        const results: ParallelChildResult[] = await Promise.all(
          parsedParameters.calls.map((call: ParallelCallInput, index: number) =>
            runChildCall({
              call,
              index,
              agent,
              model: ctx.model ?? initctx?.model,
              sessionID: ctx.sessionID,
              turnID: ctx.turnID,
              messageID: ctx.messageID,
              abort: ctx.abort ?? new AbortController().signal,
              parentToolCallID,
              registry,
              builtinToolIDs,
              globalToolSelection,
              readOnlyToolsOnly,
            }),
          ),
        )
        const data: ParallelToolData = {
          kind: "parallel-tool-results",
          results,
        }
        const successful = results.filter((item) =>
          item.outcome === "returned" && item.result === "success"
        ).length
        const negative = results.filter((item) =>
          item.outcome === "returned" && item.result === "negative"
        ).length
        const nonReturned = results.length - successful - negative
        const partial = results.some((item) =>
          item.outcome !== "returned" || item.completeness === "partial"
        )

        return {
          title: `Parallel tools: ${successful} successful, ${negative} negative, ${nonReturned} not returned`,
          text: formatResults(results),
          metadata: data,
          data,
          result: negative > 0 || nonReturned > 0 ? "negative" : "success",
          completeness: partial ? "partial" : "complete",
          sideEffect: "none",
          retry: "safe",
        }
      },
      toModelOutput: (result) => ({
        type: "json" as const,
        value: (result.data ?? result.metadata ?? { text: result.text }) as JSONValue,
      }),
    }
  },
  {
    title: "Parallel Tool Use",
    aliases: [PARALLEL_TOOL_LEGACY_ID],
    maxResultSizeChars: Infinity,
    capabilities: {
      kind: "read",
      readOnly: true,
      destructive: false,
      concurrency: "safe",
    },
  },
)
