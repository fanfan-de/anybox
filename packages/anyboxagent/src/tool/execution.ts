import * as Agent from "#agent/agent.ts"
import * as Config from "#config/config.ts"
import * as Identifier from "#id/id.ts"
import * as Permission from "#permission/permission.ts"
import { runWithFilesystemAuthorization } from "#permission/filesystem-authorization.ts"
import { Instance } from "#project/instance.ts"
import type * as Provider from "#provider/provider.ts"
import * as Session from "#session/core/session.ts"
import * as ToolResultPersistence from "#session/support/tool-result-persistence.ts"
import * as Tool from "#tool/tool.ts"

type GlobalToolSelection = Awaited<ReturnType<typeof Config.getToolSelection>>

export type ToolExecution = {
  item: Tool.ToolInfo
  title: string
  description: string
  parameters: Tool.NormalizedToolRuntime["parameters"]
  needsApproval(args: unknown, toolCallID?: string): Promise<boolean>
  execute(args: unknown, options?: { toolCallID?: string }): Promise<Tool.ToolOutput>
  toModelOutput(output: Tool.ToolOutput): Promise<Exclude<Tool.ToolModelOutput, string>>
}

function asRecord(args: unknown): Record<string, unknown> {
  if (args && typeof args === "object" && !Array.isArray(args)) {
    return args as Record<string, unknown>
  }

  return {}
}

export function isToolAllowedForAgent(tool: Tool.ToolInfo, agent: Agent.AgentInfo) {
  const policy = agent.tools
  if (!policy) return true

  const names = [tool.id, ...(tool.aliases ?? [])]
  const matches = names
    .map((name) => policy[name])
    .filter((value): value is boolean => typeof value === "boolean")

  if (matches.includes(false)) {
    return false
  }

  const values = Object.values(policy)
  const hasAllowlistEntries = values.some((value) => value === true)
  if (hasAllowlistEntries) {
    return matches.includes(true)
  }

  if (values.length === 0) {
    return false
  }

  return true
}

export function isToolGloballyEnabled(
  tool: Tool.ToolInfo,
  selection: Record<string, boolean>,
) {
  const matches = [tool.id, ...(tool.aliases ?? [])]
    .map((name) => selection[name])
    .filter((value): value is boolean => typeof value === "boolean")

  if (matches.includes(false)) {
    return false
  }

  return true
}

export function readOnlyToolsOnlyForSession(
  agent: Agent.AgentInfo,
  sessionID: string,
  turnID?: string,
) {
  const session = Session.DataBaseRead("sessions", sessionID) as Session.SessionInfo | null
  const turn = turnID
    ? Session.DataBaseRead("turns", turnID) as Session.TurnInfo | null
    : null
  return (
    turn?.threadTargetKind === "detached-branch" ||
    session?.policy?.toolPolicy === "read-only" ||
    agent.toolPolicy === "read-only"
  )
}

export function getToolAccessFailure(input: {
  item: Tool.ToolInfo
  agent: Agent.AgentInfo
  model?: Provider.Model
  builtinToolIDs: Set<string>
  globalToolSelection: GlobalToolSelection
  readOnlyToolsOnly: boolean
}) {
  const modelFailure = getToolModelRequirementFailure(input.item, input.model)
  if (modelFailure) return modelFailure

  if (
    input.builtinToolIDs.has(input.item.id) &&
    !isToolGloballyEnabled(input.item, input.globalToolSelection.tools)
  ) {
    return `Tool "${input.item.id}" is disabled by the global tool selection.`
  }

  if (!isToolAllowedForAgent(input.item, input.agent)) {
    return `Tool "${input.item.id}" is not enabled for agent "${input.agent.name}".`
  }

  if (input.readOnlyToolsOnly && input.item.capabilities?.readOnly !== true) {
    return `Tool "${input.item.id}" is not available in read-only sessions.`
  }
}

export function getToolModelRequirementFailure(
  item: Tool.ToolInfo,
  model?: Provider.Model,
) {
  return Tool.getModelRequirementFailure(item, model)
}

export async function createToolExecution(input: {
  item: Tool.ToolInfo
  agent: Agent.AgentInfo
  model?: Provider.Model
  sessionID: string
  turnID?: string
  messageID: string
  abort: AbortSignal
}): Promise<ToolExecution> {
  const modelFailure = getToolModelRequirementFailure(input.item, input.model)
  if (modelFailure) throw new Error(modelFailure)

  const runtime = await input.item.init({ agent: input.agent, model: input.model })
  const title = runtime.title ?? input.item.title ?? input.item.id
  const decisionCache = new Map<string, Awaited<ReturnType<typeof Permission.evaluate>>>()

  const runtimeContext = (toolCallID?: string): Tool.Context => ({
    sessionID: input.sessionID,
    turnID: input.turnID,
    messageID: input.messageID,
    cwd: Instance.directory,
    worktree: Instance.worktree,
    abort: input.abort,
    toolCallID,
    model: input.model,
  })

  const persistOutputIfLarge = async (
    output: Tool.ToolOutput,
    toolCallID: string,
  ): Promise<Tool.ToolOutput> => {
    const processed = await ToolResultPersistence.maybePersistToolResult({
      sessionID: input.sessionID,
      toolCallID,
      toolName: input.item.id,
      output: output.text,
      metadata: output.metadata ?? {},
      modelOutput: undefined,
      data: output.data,
      attachments: output.attachments,
      rawResult: output,
      maxResultSizeChars: input.item.maxResultSizeChars,
    })

    if (!processed.persisted) {
      return output
    }

    return {
      ...output,
      text: processed.output,
      metadata: processed.metadata,
      data: processed.data,
      attachments: processed.attachments,
    }
  }

  const evaluatePermission = async (args: unknown, toolCallID?: string) => {
    const cached = toolCallID ? decisionCache.get(toolCallID) : undefined
    if (cached) return cached

    const recordArgs = asRecord(args)
    const intent = runtime.assessPermission
      ? await runtime.assessPermission(recordArgs, runtimeContext(toolCallID))
      : undefined

    const decision = await Permission.evaluate({
      sessionID: input.sessionID,
      turnID: input.turnID,
      messageID: input.messageID,
      toolCallID,
      projectID: Instance.project.id,
      agent: input.agent.name,
      cwd: Instance.directory,
      worktree: Instance.worktree,
      tool: {
        id: input.item.id,
        kind: input.item.capabilities?.kind ?? "other",
        readOnly: input.item.capabilities?.readOnly ?? false,
        destructive: input.item.capabilities?.destructive ?? false,
        needsShell: input.item.capabilities?.needsShell ?? false,
      },
      input: recordArgs,
      intent,
    })

    if (toolCallID && decision.action !== "ask") {
      decisionCache.set(toolCallID, decision)
    }
    return decision
  }

  return {
    item: input.item,
    title,
    description: runtime.description,
    parameters: runtime.parameters,
    needsApproval: async (args, toolCallID) => {
      const decision = await evaluatePermission(args, toolCallID)
      return decision.action === "ask"
    },
    execute: async (args, options) => {
      const modelFailure = getToolModelRequirementFailure(input.item, input.model)
      if (modelFailure) throw new Error(modelFailure)

      const toolCallID = options?.toolCallID ?? Identifier.ascending("tool")
      const decision = await evaluatePermission(args, toolCallID)

      if (decision.action === "deny") {
        throw new Error(decision.reason)
      }
      if (decision.action === "ask") {
        throw new Error("Tool execution requires approval before it can continue.")
      }

      const execute = () => runtime.execute(args, runtimeContext(toolCallID))
      const rawOutput = decision.filesystemAuthorization
        ? await runWithFilesystemAuthorization(decision.filesystemAuthorization, execute)
        : await execute()
      const normalizedOutput = Tool.normalizeToolOutput(rawOutput)
      const source = input.item.source
      const output = source && (source.kind === "mcp" || source.kind === "native-module")
        ? {
            ...normalizedOutput,
            metadata: {
              ...normalizedOutput.metadata,
              toolSource: {
                kind: source.kind,
                id: source.id,
                moduleID: source.moduleID,
                name: source.name,
                description: source.description,
                provider: source.provider,
              },
            },
          }
        : normalizedOutput

      // The session processor attaches universal module provenance to stored
      // runtime events. Direct-output injection remains limited to the two
      // legacy source kinds so newly sourced built-ins keep their established
      // metadata/data contracts.
      return persistOutputIfLarge(output, toolCallID)
    },
    toModelOutput: async (output) => {
      const normalized = Tool.normalizeToolOutput(output)
      const persisted = ToolResultPersistence.readPersistedOutputMetadata(normalized.metadata)
      if (persisted) {
        return {
          type: "text",
          value: persisted.replacement,
        }
      }

      const modelOutput = runtime.toModelOutput
        ? await runtime.toModelOutput(normalized)
        : normalized.text

      return Tool.normalizeToolModelOutput(modelOutput)
    },
  }
}
