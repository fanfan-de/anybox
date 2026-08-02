import { createHash } from "node:crypto"
import {
  PLANNER_CORE_TOOL_MODULE_ID,
  ToolModuleIDSchema,
  type ToolModuleActivationMode,
  type ToolModuleActivationScope,
  type ToolModuleDiscoveryMode,
  type ToolModuleProviderKind,
} from "@anybox/shared"
import { Instance } from "#project/instance.ts"
import * as Tool from "#tool/tool.ts"

export interface ToolModuleProviderDescriptor {
  kind: ToolModuleProviderKind
  id: string
  name?: string
}

export interface ToolModuleActivationDescriptor {
  mode: ToolModuleActivationMode
  scope: ToolModuleActivationScope
  discovery: ToolModuleDiscoveryMode
}

export interface ToolModuleDescriptor {
  id: string
  title: string
  description: string
  keywords: string[]
  toolIDs: string[]
  provider?: ToolModuleProviderDescriptor
  activation?: ToolModuleActivationDescriptor
  failureMode?: "throw" | "omit"
  load?: () => Promise<Tool.ToolInfo[]>
}

/** @deprecated Use ToolModuleDescriptor. Kept while external registrars migrate. */
export interface NativeToolModuleDescriptor extends ToolModuleDescriptor {
  load: () => Promise<Tool.ToolInfo[]>
}

export interface ResolvedToolModuleDescriptor extends ToolModuleDescriptor {
  provider: ToolModuleProviderDescriptor
  activation: ToolModuleActivationDescriptor
  failureMode: "throw" | "omit"
}

export type ToolModuleExposure = "direct" | "deferred" | "hidden"

export interface ToolModuleCatalogEntry {
  descriptor: ResolvedToolModuleDescriptor
  tools: Tool.ToolInfo[]
  exposure: ToolModuleExposure
  active: boolean
  turnActivated: boolean
}

export interface ToolModuleLoadFailure {
  moduleID: string
  error: unknown
}

export interface ToolModuleCatalog {
  entries: ToolModuleCatalogEntry[]
  failures: ToolModuleLoadFailure[]
}

const PLANNER_CORE_TOOL_IDS = [
  "planner_list_todos",
  "planner_get_todo",
  "planner_create_todo",
  "planner_update_todo",
  "planner_complete_todo",
  "planner_schedule_todo",
  "planner_find_free_time",
  "planner_create_proposal",
  "planner_accept_proposal",
  "planner_dismiss_proposal",
  "planner_run_todo",
  "planner_link_automation",
]

const nativeModules: NativeToolModuleDescriptor[] = [
  {
    id: PLANNER_CORE_TOOL_MODULE_ID,
    title: "Planner",
    description: "Manage Anybox todos, schedules, deadlines, proposals, completion state, and free time.",
    keywords: [
      "planner",
      "plan",
      "todo",
      "task",
      "schedule",
      "calendar",
      "free time",
      "待办",
      "任务",
      "计划",
      "排期",
      "空闲时间",
    ],
    toolIDs: PLANNER_CORE_TOOL_IDS,
    provider: {
      kind: "native",
      id: "anybox",
      name: "Anybox",
    },
    activation: {
      mode: "search-or-explicit",
      scope: "turn",
      discovery: "module",
    },
    failureMode: "omit",
    load: async () => {
      const module = await import("#planner/tools.ts")
      return module.PlannerCoreTools
    },
  },
]

export const state = Instance.state(async () => ({
  custom: [] as NativeToolModuleDescriptor[],
}))

const BUILTIN_MODULE_METADATA = {
  "runtime.bootstrap": {
    title: "Runtime Bootstrap",
    description: "Discover optional capabilities and interact with the user.",
    keywords: ["runtime", "tool search", "approval", "question"],
  },
  "workflow.tasks": {
    title: "Task Workflow",
    description: "Track execution plans and task progress inside an Agent run.",
    keywords: ["task", "plan", "progress", "workflow"],
  },
  "workspace.files": {
    title: "Workspace Files",
    description: "Read, list, search, and inspect workspace files and images.",
    keywords: ["file", "directory", "search", "image", "workspace"],
  },
  "workspace.edit": {
    title: "Workspace Editing",
    description: "Apply structured edits and patches to workspace files.",
    keywords: ["edit", "patch", "replace", "write"],
  },
  "workspace.execution": {
    title: "Workspace Execution",
    description: "Run commands, terminals, and background processes in the workspace.",
    keywords: ["terminal", "shell", "command", "exec", "background"],
  },
  "workspace.code": {
    title: "Code Intelligence",
    description: "Inspect definitions, references, symbols, and language-server information.",
    keywords: ["code", "lsp", "definition", "reference", "symbol"],
  },
  "workspace.recovery": {
    title: "Workspace Recovery",
    description: "Inspect and restore workspace rollback checkpoints.",
    keywords: ["rollback", "checkpoint", "restore", "recovery"],
  },
  "agent.delegation": {
    title: "Agent Delegation",
    description: "Run parallel tools and coordinate delegated subagents.",
    keywords: ["agent", "subagent", "parallel", "delegate", "wait"],
  },
  "runtime.skills": {
    title: "Skills and Dependencies",
    description: "Load Agent skills, skill resources, and bundled workspace dependencies.",
    keywords: ["skill", "resource", "dependency", "workspace"],
  },
  "mcp.resources": {
    title: "MCP Resources",
    description: "List and read resources exposed by configured MCP servers.",
    keywords: ["mcp", "resource", "template"],
  },
  "media.image": {
    title: "Image Media",
    description: "Generate images through the configured image provider.",
    keywords: ["image", "generate", "media"],
  },
  "web.fetch": {
    title: "Web Fetch",
    description: "Retrieve and inspect content from web URLs.",
    keywords: ["web", "url", "fetch", "http"],
  },
  "runtime.core": {
    title: "Runtime Core",
    description: "Core Anybox tools that do not belong to another capability module.",
    keywords: ["runtime", "core", "anybox"],
  },
} as const

type BuiltinModuleID = keyof typeof BUILTIN_MODULE_METADATA

const BOOTSTRAP_TOOL_IDS = new Set(["ask_user_question", "tool_search"])
const TASK_TOOL_IDS = new Set(["task_create", "task_get", "task_list", "task_update"])
const FILE_TOOL_IDS = new Set(["read_file", "list_directory", "glob", "grep", "view_image"])
const EDIT_TOOL_IDS = new Set(["replace_text", "apply_patch"])
const EXECUTION_TOOL_IDS = new Set([
  "exec",
  "terminal_run_command",
  "terminal_read",
  "terminal_write_input",
  "git_bash_command",
  "macos_shell_command",
  "powershell_command",
  "cmd_command",
  "wsl_bash_command",
  "ssh_shell_command",
  "write_stdin",
  "read_background_task",
  "stop_background_task",
])
const CODE_TOOL_IDS = new Set(["lsp_definition", "lsp_references", "lsp_hover", "lsp_workspace_symbols"])
const RECOVERY_TOOL_IDS = new Set(["list_rollback_checkpoints", "rollback_to_checkpoint"])
const DELEGATION_TOOL_IDS = new Set([
  "multi_tool_use_parallel",
  "spawn_subagent",
  "cancel_subagent",
  "read_subagent",
  "wait_subagent",
])
const SKILL_TOOL_IDS = new Set(["load_skill", "read_skill_resource", "load_workspace_dependencies"])
const MCP_RESOURCE_TOOL_IDS = new Set(["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"])

function builtinModuleID(toolID: string): BuiltinModuleID {
  if (BOOTSTRAP_TOOL_IDS.has(toolID)) return "runtime.bootstrap"
  if (TASK_TOOL_IDS.has(toolID)) return "workflow.tasks"
  if (FILE_TOOL_IDS.has(toolID)) return "workspace.files"
  if (EDIT_TOOL_IDS.has(toolID)) return "workspace.edit"
  if (EXECUTION_TOOL_IDS.has(toolID)) return "workspace.execution"
  if (CODE_TOOL_IDS.has(toolID)) return "workspace.code"
  if (RECOVERY_TOOL_IDS.has(toolID)) return "workspace.recovery"
  if (DELEGATION_TOOL_IDS.has(toolID)) return "agent.delegation"
  if (SKILL_TOOL_IDS.has(toolID)) return "runtime.skills"
  if (MCP_RESOURCE_TOOL_IDS.has(toolID)) return "mcp.resources"
  if (toolID === "generate_image") return "media.image"
  if (toolID === "web_fetch") return "web.fetch"
  return "runtime.core"
}

function safeModuleSegment(value: string) {
  const normalized = value.normalize("NFKC").trim().toLowerCase()
  // Keep the complete module ID within ToolModuleIDSchema's 128-character
  // limit after adding the `mcp.` namespace.
  if (
    normalized.length <= 124 &&
    /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(normalized)
  ) return normalized

  const slug = normalized
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 12)
  return `${slug || "provider"}-${digest}`
}

export function mcpModuleID(serverID: string) {
  return `mcp.${safeModuleSegment(serverID)}`
}

function normalizeModuleID(value: string) {
  return ToolModuleIDSchema.parse(value.trim())
}

function defaultProvider(descriptor: ToolModuleDescriptor): ToolModuleProviderDescriptor {
  return descriptor.provider ?? {
    kind: "native",
    id: "anybox",
    name: "Anybox",
  }
}

function defaultActivation(descriptor: ToolModuleDescriptor): ToolModuleActivationDescriptor {
  return descriptor.activation ?? {
    mode: "search-or-explicit",
    scope: "turn",
    discovery: "module",
  }
}

function normalizeDescriptor(descriptor: ToolModuleDescriptor): ResolvedToolModuleDescriptor {
  return {
    ...descriptor,
    id: normalizeModuleID(descriptor.id),
    keywords: [...new Set(descriptor.keywords.map((keyword) => keyword.trim()).filter(Boolean))],
    toolIDs: [...new Set(descriptor.toolIDs.map((toolID) => toolID.trim()).filter(Boolean))],
    provider: defaultProvider(descriptor),
    activation: defaultActivation(descriptor),
    failureMode: descriptor.failureMode ?? "omit",
  }
}

function allDescriptors(custom: NativeToolModuleDescriptor[]) {
  const descriptors = [...nativeModules, ...custom].map(normalizeDescriptor)
  const seen = new Set<string>()
  for (const descriptor of descriptors) {
    if (seen.has(descriptor.id)) {
      throw new Error(`Duplicate tool module id "${descriptor.id}".`)
    }
    seen.add(descriptor.id)
  }
  return descriptors
}

/** Registered lazy/native descriptors. Use catalog() for the complete runtime module view. */
export async function descriptors() {
  return allDescriptors((await state()).custom)
}

export async function get(id: string) {
  const parsed = ToolModuleIDSchema.safeParse(id.trim())
  if (!parsed.success) return undefined
  return (await descriptors()).find((descriptor) => descriptor.id === parsed.data)
}

function sourceKind(providerKind: ToolModuleProviderKind): Tool.ToolSource["kind"] {
  if (providerKind === "mcp") return "mcp"
  if (providerKind === "native") return "native-module"
  if (providerKind === "builtin") return "builtin-module"
  if (providerKind === "plugin") return "plugin-module"
  return "custom-module"
}

export function sourceForDescriptor(descriptor: ResolvedToolModuleDescriptor): Tool.ToolSource {
  return {
    kind: sourceKind(descriptor.provider.kind),
    id: descriptor.provider.kind === "mcp" ? descriptor.provider.id : descriptor.id,
    moduleID: descriptor.id,
    name: descriptor.title,
    description: descriptor.description,
    provider: {
      kind: descriptor.provider.kind,
      id: descriptor.provider.id,
      name: descriptor.provider.name,
    },
  }
}

function attachModuleSource(
  descriptor: ResolvedToolModuleDescriptor,
  tools: Tool.ToolInfo[],
  validateDeclaredTools: boolean,
) {
  if (validateDeclaredTools) {
    const declaredToolIDs = new Set(descriptor.toolIDs)
    const loadedToolIDs = new Set<string>()

    for (const item of tools) {
      if (!declaredToolIDs.has(item.id)) {
        throw new Error(
          `Tool module "${descriptor.id}" loaded undeclared tool "${item.id}".`,
        )
      }
      if (loadedToolIDs.has(item.id)) {
        throw new Error(
          `Tool module "${descriptor.id}" loaded duplicate tool "${item.id}".`,
        )
      }
      loadedToolIDs.add(item.id)
    }

    for (const toolID of declaredToolIDs) {
      if (!loadedToolIDs.has(toolID)) {
        throw new Error(
          `Tool module "${descriptor.id}" did not load declared tool "${toolID}".`,
        )
      }
    }
  }

  const source = sourceForDescriptor(descriptor)
  return tools.map((item) => ({
    ...item,
    source,
  }))
}

function descriptorForExistingSource(item: Tool.ToolInfo): ResolvedToolModuleDescriptor | undefined {
  const source = item.source
  if (!source) return undefined

  const provider = source.provider ?? (
    source.kind === "mcp"
      ? { kind: "mcp" as const, id: source.id, name: source.name }
      : source.kind === "native-module"
        ? { kind: "native" as const, id: "anybox", name: "Anybox" }
        : source.kind === "builtin-module"
          ? { kind: "builtin" as const, id: "anybox", name: "Anybox" }
          : source.kind === "plugin-module"
            ? { kind: "plugin" as const, id: source.id, name: source.name }
            : { kind: "custom" as const, id: source.id, name: source.name }
  )
  const moduleID = source.moduleID ?? (
    provider.kind === "mcp" ? mcpModuleID(provider.id) : source.id
  )

  return normalizeDescriptor({
    id: moduleID,
    title: source.name,
    description: source.description ?? `${source.name} tools.`,
    keywords: [source.name, provider.kind, provider.id],
    toolIDs: [item.id],
    provider,
    activation: provider.kind === "mcp"
      ? { mode: "configured", scope: "project", discovery: "tool" }
      : provider.kind === "native"
        ? { mode: "search-or-explicit", scope: "turn", discovery: "module" }
        : provider.kind === "builtin"
          ? { mode: "always", scope: "global", discovery: "none" }
          : { mode: "always", scope: "project", discovery: "none" },
    failureMode: provider.kind === "builtin" || provider.kind === "custom" ? "throw" : "omit",
  })
}

function builtinDescriptor(item: Tool.ToolInfo): ResolvedToolModuleDescriptor {
  const id = builtinModuleID(item.id)
  const metadata = BUILTIN_MODULE_METADATA[id]
  return normalizeDescriptor({
    id,
    title: metadata.title,
    description: metadata.description,
    keywords: [...metadata.keywords],
    toolIDs: [item.id],
    provider: { kind: "builtin", id: "anybox", name: "Anybox" },
    activation: { mode: "always", scope: "global", discovery: "none" },
    failureMode: "throw",
  })
}

function customDescriptor(item: Tool.ToolInfo): ResolvedToolModuleDescriptor {
  return normalizeDescriptor({
    id: "custom.project",
    title: "Project Custom Tools",
    description: "Custom tools registered for the current Anybox project.",
    keywords: ["custom", "project", "tool"],
    toolIDs: [item.id],
    provider: { kind: "custom", id: Instance.project.id, name: "Project" },
    activation: { mode: "always", scope: "project", discovery: "none" },
    failureMode: "throw",
  })
}

export type RegisteredToolOrigin = "builtin" | "mcp" | "custom"

/** Adds universal module ownership without changing the tool's executable contract. */
export function attachRegisteredToolSource(item: Tool.ToolInfo, origin: RegisteredToolOrigin) {
  const descriptor = descriptorForExistingSource(item) ?? (
    origin === "builtin" ? builtinDescriptor(item) : customDescriptor(item)
  )
  return attachModuleSource(descriptor, [item], false)[0]!
}

function mergeDescriptor(
  current: ResolvedToolModuleDescriptor,
  next: ResolvedToolModuleDescriptor,
): ResolvedToolModuleDescriptor {
  if (
    current.provider.kind !== next.provider.kind ||
    current.provider.id !== next.provider.id ||
    current.activation.mode !== next.activation.mode ||
    current.activation.scope !== next.activation.scope ||
    current.activation.discovery !== next.activation.discovery
  ) {
    throw new Error(`Tool module "${current.id}" has conflicting provider or activation metadata.`)
  }

  return {
    ...current,
    keywords: [...new Set([...current.keywords, ...next.keywords])],
    toolIDs: [...new Set([...current.toolIDs, ...next.toolIDs])],
    failureMode: current.failureMode === "throw" || next.failureMode === "throw" ? "throw" : "omit",
  }
}

function descriptorFromSourcedTool(item: Tool.ToolInfo) {
  const descriptor = descriptorForExistingSource(item)
  if (!descriptor) {
    throw new Error(`Tool "${item.id}" is missing module source metadata.`)
  }
  return descriptor
}

export interface ToolModuleCatalogInput {
  tools: Tool.ToolInfo[]
  activatedModuleIDs?: Iterable<string>
  configuredModuleIDs?: Iterable<string>
  persistentMcpServerIDs?: Iterable<string>
  turnMcpServerIDs?: Iterable<string>
}

/**
 * Builds a catalog from tools that are already registered in the runtime.
 * This path is intentionally independent from Instance state so global
 * settings surfaces can inspect built-in ownership without a project context.
 */
export function catalogRegisteredTools(input: ToolModuleCatalogInput): ToolModuleCatalog {
  const activatedModuleIDs = new Set(input.activatedModuleIDs ?? [])
  const configuredModuleIDs = new Set(input.configuredModuleIDs ?? [])
  const persistentMcpServerIDs = new Set(input.persistentMcpServerIDs ?? [])
  const turnMcpServerIDs = new Set(input.turnMcpServerIDs ?? [])
  const grouped = new Map<string, {
    descriptor: ResolvedToolModuleDescriptor
    tools: Tool.ToolInfo[]
  }>()

  for (const item of input.tools) {
    const descriptor = descriptorFromSourcedTool(item)
    const existing = grouped.get(descriptor.id)
    if (existing) {
      existing.descriptor = mergeDescriptor(existing.descriptor, descriptor)
      existing.tools.push(item)
    } else {
      grouped.set(descriptor.id, { descriptor, tools: [item] })
    }
  }

  const entries: ToolModuleCatalogEntry[] = []
  for (const { descriptor, tools } of grouped.values()) {
    const turnActivated = activatedModuleIDs.has(descriptor.id)
    const configured = configuredModuleIDs.has(descriptor.id)
    const providerSelected = descriptor.provider.kind === "mcp" && (
      persistentMcpServerIDs.has(descriptor.provider.id) ||
      turnMcpServerIDs.has(descriptor.provider.id)
    )
    const active =
      descriptor.activation.mode === "always" ||
      configured ||
      providerSelected ||
      turnActivated
    const exposure: ToolModuleExposure = active
      ? "direct"
      : descriptor.activation.discovery === "tool"
        ? "deferred"
        : "hidden"

    entries.push({
      descriptor,
      tools,
      exposure,
      active,
      turnActivated,
    })
  }

  return { entries, failures: [] }
}

export async function catalog(input: ToolModuleCatalogInput): Promise<ToolModuleCatalog> {
  const activatedModuleIDs = new Set(input.activatedModuleIDs ?? [])
  const configuredModuleIDs = new Set(input.configuredModuleIDs ?? [])
  const registeredCatalog = catalogRegisteredTools(input)
  const entries = [...registeredCatalog.entries]
  const registeredModuleIDs = new Set(entries.map((entry) => entry.descriptor.id))

  const failures: ToolModuleLoadFailure[] = []
  for (const descriptor of await descriptors()) {
    if (registeredModuleIDs.has(descriptor.id)) {
      throw new Error(`Tool module "${descriptor.id}" is provided by more than one provider.`)
    }

    const turnActivated = activatedModuleIDs.has(descriptor.id)
    const configured = configuredModuleIDs.has(descriptor.id)
    const active = descriptor.activation.mode === "always" || configured || turnActivated
    if (!active) {
      entries.push({
        descriptor,
        tools: [],
        exposure: "hidden",
        active: false,
        turnActivated: false,
      })
      continue
    }

    try {
      if (!descriptor.load) {
        throw new Error(`Tool module "${descriptor.id}" does not define a provider loader.`)
      }
      const tools = attachModuleSource(descriptor, await descriptor.load(), true)
      entries.push({
        descriptor,
        tools,
        exposure: "direct",
        active: true,
        turnActivated,
      })
    } catch (error) {
      failures.push({ moduleID: descriptor.id, error })
      entries.push({
        descriptor,
        tools: [],
        exposure: "hidden",
        active: false,
        turnActivated: false,
      })
    }
  }

  return { entries, failures }
}

export async function load(id: string) {
  const descriptor = await get(id)
  if (!descriptor?.load) return undefined
  return attachModuleSource(descriptor, await descriptor.load(), true)
}

export async function getTool(name: string) {
  const modelName = Tool.toModelToolName(name)
  const descriptor = (await descriptors()).find((candidate) =>
    candidate.toolIDs.some((toolID) =>
      toolID === name || Tool.toModelToolName(toolID) === modelName,
    ),
  )
  if (!descriptor) return undefined

  return (await load(descriptor.id))?.find((item) => Tool.toolMatchesName(item, name))
}
