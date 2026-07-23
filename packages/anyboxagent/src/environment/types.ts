import path from "node:path"
import z from "zod"
import * as Identifier from "#id/id.ts"

export const ENVIRONMENT_CONFIG_VERSION = 1
export const ENVIRONMENT_CONFIG_MAX_BYTES = 256 * 1024
export const ENVIRONMENT_SCRIPT_MAX_CHARS = 64 * 1024
export const ENVIRONMENT_OUTPUT_MAX_CHARS = 200_000
export const ENVIRONMENT_SETUP_DEFAULT_TIMEOUT_SECONDS = 900

export const EnvironmentPlatform = z.enum(["windows", "macos", "linux"])
export type EnvironmentPlatform = z.output<typeof EnvironmentPlatform>

export const EnvironmentSource = z.enum(["anybox-jsonc", "codex-toml", "legacy-start"])
export type EnvironmentSource = z.output<typeof EnvironmentSource>

export const EnvironmentScope = z.enum(["direct", "ancestor", "bound"])
export type EnvironmentScope = z.output<typeof EnvironmentScope>

export const EnvironmentRunStatus = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "timed-out",
])
export type EnvironmentRunStatus = z.output<typeof EnvironmentRunStatus>

const ScriptText = z.string().trim().min(1).max(ENVIRONMENT_SCRIPT_MAX_CHARS)

export const EnvironmentScripts = z
  .object({
    default: ScriptText.optional(),
    windows: ScriptText.optional(),
    macos: ScriptText.optional(),
    linux: ScriptText.optional(),
  })
  .strict()
  .refine((scripts) => Object.values(scripts).some(Boolean), {
    message: "At least one environment script is required.",
  })
export type EnvironmentScripts = z.output<typeof EnvironmentScripts>

const RelativeEnvironmentDirectory = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .default(".")
  .refine((value) => !path.isAbsolute(value), {
    message: "Environment cwd must be relative.",
  })
  .refine((value) => {
    const normalized = path.normalize(value)
    return normalized !== ".."
      && !normalized.startsWith(`..${path.sep}`)
      && !path.isAbsolute(normalized)
  }, {
    message: "Environment cwd must stay inside the environment root.",
  })

export const EnvironmentSetup = z
  .object({
    scripts: EnvironmentScripts,
    cwd: RelativeEnvironmentDirectory.optional().default("."),
    timeoutSeconds: z
      .number()
      .int()
      .min(1)
      .max(3600)
      .optional()
      .default(ENVIRONMENT_SETUP_DEFAULT_TIMEOUT_SECONDS),
  })
  .strict()
export type EnvironmentSetup = z.output<typeof EnvironmentSetup>

export const EnvironmentAction = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
    name: z.string().trim().min(1).max(120),
    icon: z.string().trim().min(1).max(64).optional().default("terminal"),
    scripts: EnvironmentScripts,
    cwd: RelativeEnvironmentDirectory.optional().default("."),
  })
  .strict()
export type EnvironmentAction = z.output<typeof EnvironmentAction>

export const EnvironmentDefinition = z
  .object({
    version: z.literal(ENVIRONMENT_CONFIG_VERSION),
    name: z.string().trim().min(1).max(120),
    setup: EnvironmentSetup.optional(),
    actions: z.array(EnvironmentAction).max(32).optional().default([]),
  })
  .strict()
  .superRefine((definition, context) => {
    const ids = new Set<string>()
    for (const [index, action] of definition.actions.entries()) {
      if (ids.has(action.id)) {
        context.addIssue({
          code: "custom",
          message: `Action id '${action.id}' must be unique.`,
          path: ["actions", index, "id"],
        })
      }
      ids.add(action.id)
    }
  })
export type EnvironmentDefinition = z.output<typeof EnvironmentDefinition>

export const EnvironmentIssue = z.object({
  code: z.string(),
  message: z.string(),
  path: z.string().optional(),
  severity: z.enum(["warning", "error"]),
})
export type EnvironmentIssue = z.output<typeof EnvironmentIssue>

export const EnvironmentCandidate = z.object({
  key: z.string(),
  projectID: z.string(),
  requestedDirectory: z.string(),
  rootDirectory: z.string(),
  configPath: z.string(),
  source: EnvironmentSource,
  scope: EnvironmentScope,
  contentHash: z.string(),
  readonly: z.boolean(),
  trusted: z.boolean(),
  definition: EnvironmentDefinition.nullable(),
  issues: z.array(EnvironmentIssue),
  bindingID: Identifier.schema("environmentBinding").optional(),
  setupRunID: Identifier.schema("environmentRun").optional(),
  setupRunStatus: EnvironmentRunStatus.optional(),
})
export type EnvironmentCandidate = z.output<typeof EnvironmentCandidate>

export const EnvironmentPreference = z.object({
  id: z.string(),
  projectID: z.string(),
  directory: z.string(),
  selectedKey: z.string().nullable().optional(),
  autoSetup: z.boolean().default(true),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type EnvironmentPreference = z.output<typeof EnvironmentPreference>

export const EnvironmentTrust = z.object({
  id: z.string(),
  projectID: z.string(),
  configPath: z.string(),
  contentHash: z.string(),
  trustedAt: z.number(),
})
export type EnvironmentTrust = z.output<typeof EnvironmentTrust>

export const WorktreeEnvironmentBinding = z.object({
  id: Identifier.schema("environmentBinding"),
  projectID: z.string(),
  worktreeID: z.string(),
  sourceDirectory: z.string(),
  targetDirectory: z.string(),
  sourceConfigPath: z.string(),
  sourceRoot: z.string(),
  targetRoot: z.string(),
  environmentKey: z.string(),
  contentHash: z.string(),
  source: EnvironmentSource,
  definition: EnvironmentDefinition,
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type WorktreeEnvironmentBinding = z.output<typeof WorktreeEnvironmentBinding>

export const EnvironmentRunKind = z.enum(["setup", "action"])
export type EnvironmentRunKind = z.output<typeof EnvironmentRunKind>

export const EnvironmentRunRecord = z.object({
  id: Identifier.schema("environmentRun"),
  projectID: z.string(),
  environmentKey: z.string(),
  contentHash: z.string(),
  kind: EnvironmentRunKind,
  actionID: z.string().optional(),
  worktreeID: z.string().optional(),
  sessionID: z.string().optional(),
  bindingID: Identifier.schema("environmentBinding").optional(),
  cwd: z.string(),
  status: EnvironmentRunStatus,
  exitCode: z.number().int().nullable().optional(),
  output: z.string().default(""),
  outputTruncated: z.boolean().default(false),
  error: z.string().optional(),
  ptyID: z.string().optional(),
  createdAt: z.number(),
  startedAt: z.number().optional(),
  finishedAt: z.number().optional(),
  updatedAt: z.number(),
})
export type EnvironmentRunRecord = z.output<typeof EnvironmentRunRecord>

export interface EnvironmentListResult {
  projectID: string
  directory: string
  boundaryRoot: string
  items: EnvironmentCandidate[]
  selectedKey?: string
  autoSetup: boolean
}

export interface CreatePreparedWorktreeResult<Worktree> {
  worktree: Worktree
  binding?: WorktreeEnvironmentBinding
  setupRun?: EnvironmentRunRecord
}

export function currentEnvironmentPlatform(platform = process.platform): EnvironmentPlatform {
  if (platform === "win32") return "windows"
  if (platform === "darwin") return "macos"
  return "linux"
}

export function resolveEnvironmentScript(
  scripts: EnvironmentScripts,
  platform: EnvironmentPlatform = currentEnvironmentPlatform(),
) {
  return scripts[platform] ?? scripts.default
}
