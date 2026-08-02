import { z } from "zod"

export const PLANNER_CORE_TOOL_MODULE_ID = "planner.core"

export const ToolModuleProviderKindSchema = z.enum([
  "builtin",
  "native",
  "mcp",
  "plugin",
  "custom",
])

export type ToolModuleProviderKind = z.infer<typeof ToolModuleProviderKindSchema>

export const ToolModuleActivationModeSchema = z.enum([
  "always",
  "configured",
  "search-or-explicit",
  "explicit-only",
])

export type ToolModuleActivationMode = z.infer<typeof ToolModuleActivationModeSchema>

export const ToolModuleActivationScopeSchema = z.enum([
  "global",
  "project",
  "session",
  "turn",
])

export type ToolModuleActivationScope = z.infer<typeof ToolModuleActivationScopeSchema>

export const ToolModuleDiscoveryModeSchema = z.enum([
  "none",
  "module",
  "tool",
])

export type ToolModuleDiscoveryMode = z.infer<typeof ToolModuleDiscoveryModeSchema>

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
