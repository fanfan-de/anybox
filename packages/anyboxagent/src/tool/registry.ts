import { Instance } from "#project/instance.ts"
import * as Tool from "#tool/tool.ts"
import { AskUserQuestionTool } from "#tool/ask-user-question.ts"
import { ApplyPatchTool } from "#tool/apply-patch.ts"
import { CancelSubagentTool } from "#tool/cancel-subagent.ts"
import { ExecTool } from "#tool/exec.ts"
import {
  CmdCommandTool,
  GitBashCommandTool,
  MacOSShellCommandTool,
  PowerShellCommandTool,
  WslBashCommandTool,
} from "#tool/shell-command.ts"
import { GlobTool } from "#tool/glob.ts"
import { GrepTool } from "#tool/grep.ts"
import { GenerateImageTool } from "#tool/generate-image.ts"
import { ListDirectoryTool } from "#tool/list-directory.ts"
import { ListRollbackCheckpointsTool } from "#tool/list-rollback-checkpoints.ts"
import { LspDefinitionTool, LspHoverTool, LspReferencesTool, LspWorkspaceSymbolsTool } from "#tool/lsp.ts"
import { LoadSkillTool } from "#tool/load-skill.ts"
import { ListMcpResourceTemplatesTool, ListMcpResourcesTool, ReadMcpResourceTool } from "#tool/mcp-resources.ts"
import { ParallelTool } from "#tool/parallel-tool.ts"
import { WriteStdinTool } from "#tool/write-stdin.ts"
import { ReadFileTool } from "#tool/read-file.ts"
import { ReadSubagentTool } from "#tool/read-subagent.ts"
import { ReadSkillResourceTool } from "#tool/read-skill-resource.ts"
import { ReplaceTextTool } from "#tool/replace-text.ts"
import { RollbackToCheckpointTool } from "#tool/rollback-to-checkpoint.ts"
import { SpawnSubagentTool } from "#tool/spawn-subagent.ts"
import { SshShellCommandTool } from "#tool/ssh-shell-command.ts"
import { TaskCreateTool, TaskGetTool, TaskListTool, TaskUpdateTool } from "#tool/task-tools.ts"
import { ToolSearchTool } from "#tool/tool-search.ts"
import * as ToolModule from "#tool/module.ts"
import { ViewImageTool } from "#tool/view-image.ts"
import { WaitSubagentTool } from "#tool/wait-subagent.ts"
import { WebFetchTool } from "#tool/web-fetch.ts"
import { LoadWorkspaceDependenciesTool } from "#tool/workspace-dependencies.ts"
import { IpythonTool } from "#tool/ipython.ts"
import * as Mcp from "#mcp/manager.ts"
import { isSshWorkspaceUri } from "@anybox/shared"

function exposedNames(tool: Tool.ToolInfo): string[] {
  return [tool.id, ...(tool.aliases ?? [])]
}

export function assertUniqueToolNames(tools: Tool.ToolInfo[]) {
  const seen = new Map<string, string>()
  const seenModelNames = new Map<string, string>()

  for (const tool of tools) {
    for (const name of exposedNames(tool)) {
      const existing = seen.get(name)
      if (existing && existing !== tool.id) {
        throw new Error(`Duplicate tool name "${name}" is declared by both "${existing}" and "${tool.id}".`)
      }

      seen.set(name, tool.id)

      const modelName = Tool.toModelToolName(name)
      const existingModelName = seenModelNames.get(modelName)
      if (existingModelName && existingModelName !== tool.id) {
        throw new Error(
          `Duplicate model-facing tool name "${modelName}" is declared by both "${existingModelName}" and "${tool.id}".`,
        )
      }

      seenModelNames.set(modelName, tool.id)
    }
  }
}

export const state = Instance.state(async () => {
  return {
    custom: [] as Tool.ToolInfo[],
  }
})

export function builtinShellToolsForPlatform(platform: NodeJS.Platform): Tool.ToolInfo[] {
  if (platform === "win32") {
    return [
      GitBashCommandTool,
      PowerShellCommandTool,
      CmdCommandTool,
      WslBashCommandTool,
    ]
  }

  if (platform === "darwin") {
    return [MacOSShellCommandTool]
  }

  return []
}

async function rawBuiltinTools(): Promise<Tool.ToolInfo[]> {
  let isRemoteWorkspace = false
  try {
    isRemoteWorkspace = isSshWorkspaceUri(Instance.directory)
  } catch {
    isRemoteWorkspace = false
  }

  const commonTools = [
    AskUserQuestionTool,
    TaskCreateTool,
    TaskGetTool,
    TaskListTool,
    TaskUpdateTool,
    ReadFileTool,
    WriteStdinTool,
    ReadSubagentTool,
    WaitSubagentTool,
    LoadSkillTool,
    ReadSkillResourceTool,
    ListMcpResourcesTool,
    ListMcpResourceTemplatesTool,
    ReadMcpResourceTool,
    ParallelTool,
    ExecTool,
    LoadWorkspaceDependenciesTool,
    ListRollbackCheckpointsTool,
    RollbackToCheckpointTool,
    ReplaceTextTool,
    ApplyPatchTool,
    GlobTool,
    GrepTool,
    ToolSearchTool,
    ListDirectoryTool,
    GenerateImageTool,
    ViewImageTool,
    WebFetchTool,
    SpawnSubagentTool,
    CancelSubagentTool,
  ]

  if (isRemoteWorkspace) {
    return [
      ...commonTools,
      SshShellCommandTool,
    ]
  }

  return [
    ...commonTools,
    IpythonTool,
    LspDefinitionTool,
    LspReferencesTool,
    LspHoverTool,
    LspWorkspaceSymbolsTool,
    ...builtinShellToolsForPlatform(process.platform),
  ]
}

export async function builtinTools(): Promise<Tool.ToolInfo[]> {
  return (await rawBuiltinTools()).map((item) =>
    ToolModule.attachRegisteredToolSource(item, "builtin")
  )
}

export interface ToolInventory {
  builtin: Tool.ToolInfo[]
  mcp: Tool.ToolInfo[]
  custom: Tool.ToolInfo[]
  all: Tool.ToolInfo[]
}

export async function inventory(): Promise<ToolInventory> {
  const custom = await state().then((x) => x.custom)
  const mcpTools = await Mcp.tools()
  const builtin = await builtinTools()
  const mcp = mcpTools.map((item) =>
    ToolModule.attachRegisteredToolSource(item, "mcp")
  )
  const sourcedCustom = custom.map((item) =>
    ToolModule.attachRegisteredToolSource(item, "custom")
  )
  const all = [
    ...builtin,
    ...mcp,
    ...sourcedCustom,
  ]

  assertUniqueToolNames(all)
  return {
    builtin,
    mcp,
    custom: sourcedCustom,
    all,
  }
}

export async function tools(): Promise<Tool.ToolInfo[]> {
  return (await inventory()).all
}

export async function get(id: string): Promise<Tool.ToolInfo | undefined> {
  const registered = (await tools()).find((tool) => Tool.toolMatchesName(tool, id))
  if (registered) return registered
  return ToolModule.getTool(id)
}

export async function names(): Promise<string[]> {
  return (await tools()).flatMap(exposedNames)
}
