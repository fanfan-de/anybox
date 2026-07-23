import { createHash } from "node:crypto"
import z from "zod"
import * as db from "#database/Sqlite.ts"
import * as Identifier from "#id/id.ts"
import {
  ENVIRONMENT_OUTPUT_MAX_CHARS,
  EnvironmentPreference,
  EnvironmentRunRecord,
  EnvironmentTrust,
  WorktreeEnvironmentBinding,
  type EnvironmentDefinition,
  type EnvironmentRunKind,
  type EnvironmentRunStatus,
  type EnvironmentSource,
} from "#environment/types.ts"

let tableGeneration = -1

function ensureTables() {
  const generation = db.getDatabaseGeneration()
  if (tableGeneration === generation && generation > 0) return
  db.syncTableColumnsWithZodObject("environment_preferences", EnvironmentPreference)
  db.syncTableColumnsWithZodObject("environment_trusts", EnvironmentTrust)
  db.syncTableColumnsWithZodObject("worktree_environment_bindings", WorktreeEnvironmentBinding)
  db.syncTableColumnsWithZodObject("environment_runs", EnvironmentRunRecord)
  tableGeneration = db.getDatabaseGeneration()
}

function digestID(...parts: string[]) {
  return createHash("sha256").update(parts.join("\0")).digest("hex")
}

export function preferenceID(projectID: string, directory: string) {
  return `envpref_${digestID(projectID, directory).slice(0, 32)}`
}

export function trustID(projectID: string, configPath: string, contentHash: string) {
  return `envtrust_${digestID(projectID, configPath, contentHash).slice(0, 32)}`
}

export function getPreference(projectID: string, directory: string) {
  ensureTables()
  return db.findById(
    "environment_preferences",
    EnvironmentPreference,
    preferenceID(projectID, directory),
  )
}

export function setPreference(input: {
  projectID: string
  directory: string
  selectedKey?: string | null
  autoSetup?: boolean
}) {
  ensureTables()
  const now = Date.now()
  const id = preferenceID(input.projectID, input.directory)
  const existing = db.findById("environment_preferences", EnvironmentPreference, id)
  const record = EnvironmentPreference.parse({
    id,
    projectID: input.projectID,
    directory: input.directory,
    selectedKey: input.selectedKey === undefined
      ? existing?.selectedKey ?? null
      : input.selectedKey,
    autoSetup: input.autoSetup ?? existing?.autoSetup ?? true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  })
  if (existing) {
    db.updateByIdWithSchema("environment_preferences", id, record, EnvironmentPreference)
  } else {
    db.insertOneWithSchema("environment_preferences", record, EnvironmentPreference)
  }
  return record
}

export function isTrusted(projectID: string, configPath: string, contentHash: string) {
  ensureTables()
  return Boolean(
    db.findById(
      "environment_trusts",
      EnvironmentTrust,
      trustID(projectID, configPath, contentHash),
    ),
  )
}

export function trustEnvironment(projectID: string, configPath: string, contentHash: string) {
  ensureTables()
  const record = EnvironmentTrust.parse({
    id: trustID(projectID, configPath, contentHash),
    projectID,
    configPath,
    contentHash,
    trustedAt: Date.now(),
  })
  const existing = db.findById("environment_trusts", EnvironmentTrust, record.id)
  if (existing) {
    db.updateByIdWithSchema("environment_trusts", record.id, record, EnvironmentTrust)
  } else {
    db.insertOneWithSchema("environment_trusts", record, EnvironmentTrust)
  }
  return record
}

export function revokeEnvironmentTrust(projectID: string, configPath: string) {
  ensureTables()
  return db.deleteMany("environment_trusts", [
    { column: "projectID", value: projectID },
    { column: "configPath", value: configPath },
  ])
}

export function createBinding(input: {
  projectID: string
  worktreeID: string
  sourceDirectory: string
  targetDirectory: string
  sourceConfigPath: string
  sourceRoot: string
  targetRoot: string
  environmentKey: string
  contentHash: string
  source: EnvironmentSource
  definition: EnvironmentDefinition
}) {
  ensureTables()
  const now = Date.now()
  const existing = findBindingByWorktree(input.worktreeID)
  const record = WorktreeEnvironmentBinding.parse({
    ...input,
    id: existing?.id ?? Identifier.descending("environmentBinding"),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  })
  if (existing) {
    db.updateByIdWithSchema(
      "worktree_environment_bindings",
      existing.id,
      record,
      WorktreeEnvironmentBinding,
    )
  } else {
    db.insertOneWithSchema("worktree_environment_bindings", record, WorktreeEnvironmentBinding)
  }
  return record
}

export function findBindingByWorktree(worktreeID: string) {
  ensureTables()
  return db
    .findManyWithSchema("worktree_environment_bindings", WorktreeEnvironmentBinding)
    .find((record) => record.worktreeID === worktreeID)
}

export function getBinding(id: string) {
  ensureTables()
  return db.findById("worktree_environment_bindings", WorktreeEnvironmentBinding, id)
}

export function deleteBindingByWorktree(worktreeID: string) {
  ensureTables()
  return db.deleteMany("worktree_environment_bindings", [
    { column: "worktreeID", value: worktreeID },
  ])
}

export function createRun(input: {
  projectID: string
  environmentKey: string
  contentHash: string
  kind: EnvironmentRunKind
  cwd: string
  actionID?: string
  worktreeID?: string
  sessionID?: string
  bindingID?: string
  status?: EnvironmentRunStatus
}) {
  ensureTables()
  const now = Date.now()
  const record = EnvironmentRunRecord.parse({
    ...input,
    id: Identifier.descending("environmentRun"),
    status: input.status ?? "queued",
    output: "",
    outputTruncated: false,
    createdAt: now,
    updatedAt: now,
  })
  db.insertOneWithSchema("environment_runs", record, EnvironmentRunRecord)
  return record
}

export function getRun(id: string) {
  ensureTables()
  return db.findById("environment_runs", EnvironmentRunRecord, id)
}

export function listRuns(input?: {
  projectID?: string
  worktreeID?: string
  sessionID?: string
  status?: EnvironmentRunStatus
}) {
  ensureTables()
  return db
    .findManyWithSchema("environment_runs", EnvironmentRunRecord)
    .filter((run) => {
      if (input?.projectID && run.projectID !== input.projectID) return false
      if (input?.worktreeID && run.worktreeID !== input.worktreeID) return false
      if (input?.sessionID && run.sessionID !== input.sessionID) return false
      if (input?.status && run.status !== input.status) return false
      return true
    })
    .sort((left, right) => right.createdAt - left.createdAt)
}

export function updateRun(id: string, update: Partial<z.input<typeof EnvironmentRunRecord>>) {
  ensureTables()
  const current = getRun(id)
  if (!current) return undefined
  const next = EnvironmentRunRecord.parse({
    ...current,
    ...update,
    id: current.id,
    updatedAt: Date.now(),
  })
  db.updateByIdWithSchema("environment_runs", id, next, EnvironmentRunRecord)
  return next
}

export function appendRunOutput(id: string, chunk: string) {
  const current = getRun(id)
  if (!current || !chunk) return current
  const combined = current.output + chunk
  const truncated = combined.length > ENVIRONMENT_OUTPUT_MAX_CHARS
  return updateRun(id, {
    output: truncated ? combined.slice(-ENVIRONMENT_OUTPUT_MAX_CHARS) : combined,
    outputTruncated: current.outputTruncated || truncated,
  })
}

export function removeProjectEnvironmentData(projectID: string) {
  ensureTables()
  for (const table of [
    "environment_preferences",
    "environment_trusts",
    "worktree_environment_bindings",
    "environment_runs",
  ]) {
    db.deleteMany(table, [{ column: "projectID", value: projectID }])
  }
}

export function removeWorktreeEnvironmentData(worktreeID: string) {
  ensureTables()
  db.deleteMany("worktree_environment_bindings", [{ column: "worktreeID", value: worktreeID }])
  db.deleteMany("environment_runs", [{ column: "worktreeID", value: worktreeID }])
}
