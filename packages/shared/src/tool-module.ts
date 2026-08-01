import { z } from "zod"

export const PLANNER_CORE_TOOL_MODULE_ID = "planner.core"

export const ToolModuleIDSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(
    /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
    "Tool module IDs must use lowercase letters, numbers, dots, underscores, or hyphens.",
  )

export type ToolModuleID = z.infer<typeof ToolModuleIDSchema>
