import { PLANNER_CORE_TOOL_MODULE_ID } from "@anybox/shared"
import { Instance } from "#project/instance.ts"
import * as Tool from "#tool/tool.ts"

export interface NativeToolModuleDescriptor {
  id: string
  title: string
  description: string
  keywords: string[]
  toolIDs: string[]
  load: () => Promise<Tool.ToolInfo[]>
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

const builtinModules: NativeToolModuleDescriptor[] = [
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
    load: async () => {
      const module = await import("#planner/tools.ts")
      return module.PlannerCoreTools
    },
  },
]

export const state = Instance.state(async () => ({
  custom: [] as NativeToolModuleDescriptor[],
}))

function normalizeModuleID(value: string) {
  return value.trim()
}

function allDescriptors(custom: NativeToolModuleDescriptor[]) {
  const descriptors = [...builtinModules, ...custom]
  const seen = new Set<string>()
  for (const descriptor of descriptors) {
    if (seen.has(descriptor.id)) {
      throw new Error(`Duplicate native tool module id "${descriptor.id}".`)
    }
    seen.add(descriptor.id)
  }
  return descriptors
}

export async function descriptors() {
  return allDescriptors((await state()).custom)
}

export async function get(id: string) {
  const normalizedID = normalizeModuleID(id)
  if (!normalizedID) return undefined
  return (await descriptors()).find((descriptor) => descriptor.id === normalizedID)
}

function attachModuleSource(
  descriptor: NativeToolModuleDescriptor,
  tools: Tool.ToolInfo[],
) {
  const declaredToolIDs = new Set(descriptor.toolIDs)
  const loadedToolIDs = new Set<string>()

  for (const item of tools) {
    if (!declaredToolIDs.has(item.id)) {
      throw new Error(
        `Native tool module "${descriptor.id}" loaded undeclared tool "${item.id}".`,
      )
    }
    if (loadedToolIDs.has(item.id)) {
      throw new Error(
        `Native tool module "${descriptor.id}" loaded duplicate tool "${item.id}".`,
      )
    }
    loadedToolIDs.add(item.id)
  }

  for (const toolID of declaredToolIDs) {
    if (!loadedToolIDs.has(toolID)) {
      throw new Error(
        `Native tool module "${descriptor.id}" did not load declared tool "${toolID}".`,
      )
    }
  }

  return tools.map((item) => ({
    ...item,
    source: {
      kind: "native-module" as const,
      id: descriptor.id,
      name: descriptor.title,
      description: descriptor.description,
    },
  }))
}

export async function load(id: string) {
  const descriptor = await get(id)
  if (!descriptor) return undefined
  return attachModuleSource(descriptor, await descriptor.load())
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
