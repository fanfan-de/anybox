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

export const PROGRESSIVE_DISCLOSURE_TOOL_MODULE_ID = "runtime.progressive-disclosure"

const BUILTIN_MODULE_METADATA = {
  "workspace.shell": {
    title: "Shell",
    description: "Run shell commands and interact with persistent or managed terminal sessions.",
    keywords: ["shell", "terminal", "command", "process", "background"],
  },
  "workflow.tasks": {
    title: "Tasks",
    description: "Track execution plans and task progress inside an Agent run.",
    keywords: ["task", "plan", "progress", "workflow"],
  },
  "workspace.file-io": {
    title: "File Read and Write",
    description: "Read, create, edit, patch, and inspect workspace files.",
    keywords: ["file", "read", "write", "edit", "patch", "image", "workspace"],
  },
  "workspace.file-search": {
    title: "File Search",
    description: "List directories and search workspace paths or file contents.",
    keywords: ["file", "directory", "search", "glob", "grep", "workspace"],
  },
  "runtime.programmatic-orchestration": {
    title: "Programmatic Orchestration",
    description: "Compose supported tool calls with isolated JavaScript or safe parallel execution.",
    keywords: ["orchestration", "javascript", "exec", "parallel", "compose"],
  },
  "agent.multiagent": {
    title: "Multi-agent",
    description: "Spawn, inspect, wait for, and cancel delegated child Agent sessions.",
    keywords: ["agent", "subagent", "multiagent", "delegate", "wait"],
  },
  [PROGRESSIVE_DISCLOSURE_TOOL_MODULE_ID]: {
    title: "Progressive Disclosure",
    description: "Discover optional tools, Skills, MCP resources, and bundled workspace runtimes only when needed.",
    keywords: ["progressive disclosure", "tool search", "skill", "mcp", "resource", "runtime", "dependency"],
  },
  "agent.metacognition": {
    title: "Metacognition",
    description: "Inspect and return to earlier checkpoints to support Agent reflection and self-correction.",
    keywords: ["metacognition", "reflection", "self correction", "checkpoint", "rollback"],
  },
  "network.web": {
    title: "Network",
    description: "Fetch public web pages and network resources.",
    keywords: ["network", "web", "fetch", "http", "url"],
  },
  "media.visual-generation": {
    title: "Visual Generation",
    description: "Generate visual media with configured image models.",
    keywords: ["visual", "image", "generate", "media", "model"],
  },
  "workspace.lsp": {
    title: "LSP Tools",
    description: "Inspect definitions, references, hover details, and workspace symbols through language servers.",
    keywords: ["code", "lsp", "definition", "reference", "hover", "symbol"],
  },
  "interaction.human": {
    title: "Human Interaction",
    description: "Ask the user structured questions and wait for their response.",
    keywords: ["human", "user", "interaction", "question", "clarification"],
  },
  "runtime.other": {
    title: "Other",
    description: "Built-in tools that do not yet have a suitable capability module.",
    keywords: ["other", "miscellaneous", "runtime", "uncategorized"],
  },
} as const

type BuiltinModuleID = keyof typeof BUILTIN_MODULE_METADATA

const SHELL_TOOL_IDS = new Set([
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
])
const TASK_TOOL_IDS = new Set(["task_create", "task_get", "task_list", "task_update"])
const FILE_IO_TOOL_IDS = new Set(["read_file", "replace_text", "apply_patch", "view_image"])
const FILE_SEARCH_TOOL_IDS = new Set(["list_directory", "glob", "grep"])
const PROGRAMMATIC_ORCHESTRATION_TOOL_IDS = new Set([
  "exec",
  "multi_tool_use_parallel",
])
const MULTIAGENT_TOOL_IDS = new Set([
  "spawn_subagent",
  "cancel_subagent",
  "read_subagent",
  "wait_subagent",
])
const PROGRESSIVE_DISCLOSURE_TOOL_IDS = new Set([
  "tool_search",
  "load_skill",
  "read_skill_resource",
  "list_mcp_resources",
  "list_mcp_resource_templates",
  "read_mcp_resource",
  "load_workspace_dependencies",
])
const METACOGNITION_TOOL_IDS = new Set(["list_rollback_checkpoints", "rollback_to_checkpoint"])
const NETWORK_TOOL_IDS = new Set(["web_fetch"])
const VISUAL_GENERATION_TOOL_IDS = new Set(["generate_image"])
const LSP_TOOL_IDS = new Set(["lsp_definition", "lsp_references", "lsp_hover", "lsp_workspace_symbols"])
const HUMAN_INTERACTION_TOOL_IDS = new Set(["ask_user_question"])

function builtinModuleID(toolID: string): BuiltinModuleID {
  if (SHELL_TOOL_IDS.has(toolID)) return "workspace.shell"
  if (TASK_TOOL_IDS.has(toolID)) return "workflow.tasks"
  if (FILE_IO_TOOL_IDS.has(toolID)) return "workspace.file-io"
  if (FILE_SEARCH_TOOL_IDS.has(toolID)) return "workspace.file-search"
  if (PROGRAMMATIC_ORCHESTRATION_TOOL_IDS.has(toolID)) return "runtime.programmatic-orchestration"
  if (MULTIAGENT_TOOL_IDS.has(toolID)) return "agent.multiagent"
  if (PROGRESSIVE_DISCLOSURE_TOOL_IDS.has(toolID)) return PROGRESSIVE_DISCLOSURE_TOOL_MODULE_ID
  if (METACOGNITION_TOOL_IDS.has(toolID)) return "agent.metacognition"
  if (NETWORK_TOOL_IDS.has(toolID)) return "network.web"
  if (VISUAL_GENERATION_TOOL_IDS.has(toolID)) return "media.visual-generation"
  if (LSP_TOOL_IDS.has(toolID)) return "workspace.lsp"
  if (HUMAN_INTERACTION_TOOL_IDS.has(toolID)) return "interaction.human"
  return "runtime.other"
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

/**
 * Loads platform-owned native module definitions for read-only catalog
 * inspection. This does not activate a module, mutate module state, or expose
 * its tools to an Agent turn.
 */
export async function inspectNativeModules(): Promise<ToolModuleCatalog> {
  const entries: ToolModuleCatalogEntry[] = []
  const failures: ToolModuleLoadFailure[] = []

  for (const descriptor of allDescriptors([])) {
    if (descriptor.provider.kind !== "native") continue

    try {
      if (!descriptor.load) {
        throw new Error(`Tool module "${descriptor.id}" does not define a provider loader.`)
      }
      const tools = attachModuleSource(descriptor, await descriptor.load(), true)
      entries.push({
        descriptor,
        tools,
        exposure: "hidden",
        active: false,
        turnActivated: false,
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
