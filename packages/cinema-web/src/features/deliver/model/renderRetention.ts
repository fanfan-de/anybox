export const CINEMA_RENDER_RETENTION_CONFIRMATION = "DELETE_REBUILDABLE_RENDER_FILES" as const

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const RETENTION_TARGETS = ["inputs", "input-staging", "temporary-output"] as const
const RETENTION_SKIP_REASONS = [
  "active-job",
  "within-retention",
  "unsafe-job-directory",
  "unsafe-candidate",
] as const
const RETENTION_ERROR_CODES = [
  "render-root-unavailable",
  "job-metadata-invalid",
  "job-metadata-changed",
  "candidate-cleanup-failed",
] as const
const RETENTION_ERROR_TARGETS = [
  ...RETENTION_TARGETS,
  "render-jobs",
  "job-metadata",
] as const

export type CinemaRenderRetentionTarget = typeof RETENTION_TARGETS[number]
export type CinemaRenderRetentionSkipReason = typeof RETENTION_SKIP_REASONS[number]
export type CinemaRenderRetentionErrorCode = typeof RETENTION_ERROR_CODES[number]
export type CinemaRenderRetentionErrorTarget = typeof RETENTION_ERROR_TARGETS[number]

type CinemaRenderRetentionRequestBase = {
  operationID: string
  retentionDurationMs: number
}

export type CinemaRenderRetentionRequest = CinemaRenderRetentionRequestBase & (
  | {
    dryRun: true
    confirm?: typeof CINEMA_RENDER_RETENTION_CONFIRMATION
  }
  | {
    dryRun: false
    confirm: typeof CINEMA_RENDER_RETENTION_CONFIRMATION
  }
)

export type CinemaRenderRetentionResult = {
  operationID: string
  retentionDurationMs: number
  dryRun: boolean
  discoveredJobCount: number
  terminalJobCount: number
  eligibleJobCount: number
  estimatedReclaimableBytes: number
  candidateJobs: Array<{
    jobID: string
    targets: CinemaRenderRetentionTarget[]
    estimatedReclaimableBytes: number
    fileCount: number
    directoryCount: number
  }>
  reclaimedBytes: number
  cleanedJobs: Array<{
    jobID: string
    targets: CinemaRenderRetentionTarget[]
    reclaimedBytes: number
    removedFileCount: number
    removedDirectoryCount: number
  }>
  skipped: Array<{
    jobID: string
    reason: CinemaRenderRetentionSkipReason
    target?: CinemaRenderRetentionTarget
  }>
  errors: Array<{
    jobID?: string
    code: CinemaRenderRetentionErrorCode
    target?: CinemaRenderRetentionErrorTarget
    message: string
  }>
}

function strictObject(value: unknown, allowedKeys: readonly string[], label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  const object = value as Record<string, unknown>
  const allowed = new Set(allowedKeys)
  const unexpected = Object.keys(object).find((key) => !allowed.has(key))
  if (unexpected) throw new TypeError(`${label} contains unexpected field '${unexpected}'`)
  return object
}

function safeID(value: unknown, label: string) {
  if (typeof value !== "string" || !SAFE_ID_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a safe 1-128 character identifier`)
  }
  return value
}

function booleanValue(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean`)
  return value
}

function nonnegativeInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer`)
  }
  return value
}

function positiveInteger(value: unknown, label: string) {
  const parsed = nonnegativeInteger(value, label)
  if (parsed === 0) throw new TypeError(`${label} must be positive`)
  return parsed
}

function nonemptyString(value: unknown, label: string) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must be a nonempty string`)
  return value
}

function enumValue<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  label: string,
): Values[number] {
  if (typeof value !== "string" || !(values as readonly string[]).includes(value)) {
    throw new TypeError(`${label} is invalid`)
  }
  return value as Values[number]
}

function arrayValue<T>(value: unknown, parse: (item: unknown, index: number) => T, label: string) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`)
  return value.map(parse)
}

function parseTargets(value: unknown, label: string) {
  return arrayValue(value, (target, index) => (
    enumValue(target, RETENTION_TARGETS, `${label}[${index}]`)
  ), label)
}

export function parseCinemaRenderRetentionRequest(value: unknown): CinemaRenderRetentionRequest {
  const input = strictObject(
    value,
    ["operationID", "retentionDurationMs", "dryRun", "confirm"],
    "Render retention request",
  )
  const operationID = safeID(input.operationID, "operationID")
  const retentionDurationMs = positiveInteger(input.retentionDurationMs, "retentionDurationMs")
  const dryRun = booleanValue(input.dryRun, "dryRun")
  const confirm = input.confirm === undefined
    ? undefined
    : enumValue(input.confirm, [CINEMA_RENDER_RETENTION_CONFIRMATION] as const, "confirm")
  if (!dryRun && confirm !== CINEMA_RENDER_RETENTION_CONFIRMATION) {
    throw new TypeError(`Execute mode requires confirm='${CINEMA_RENDER_RETENTION_CONFIRMATION}'`)
  }
  return dryRun
    ? { operationID, retentionDurationMs, dryRun, ...(confirm ? { confirm } : {}) }
    : { operationID, retentionDurationMs, dryRun, confirm: CINEMA_RENDER_RETENTION_CONFIRMATION }
}

export function parseCinemaRenderRetentionResult(value: unknown): CinemaRenderRetentionResult {
  const result = strictObject(value, [
    "operationID",
    "retentionDurationMs",
    "dryRun",
    "discoveredJobCount",
    "terminalJobCount",
    "eligibleJobCount",
    "estimatedReclaimableBytes",
    "candidateJobs",
    "reclaimedBytes",
    "cleanedJobs",
    "skipped",
    "errors",
  ], "Render retention result")

  return {
    operationID: safeID(result.operationID, "result.operationID"),
    retentionDurationMs: positiveInteger(result.retentionDurationMs, "result.retentionDurationMs"),
    dryRun: booleanValue(result.dryRun, "result.dryRun"),
    discoveredJobCount: nonnegativeInteger(result.discoveredJobCount, "result.discoveredJobCount"),
    terminalJobCount: nonnegativeInteger(result.terminalJobCount, "result.terminalJobCount"),
    eligibleJobCount: nonnegativeInteger(result.eligibleJobCount, "result.eligibleJobCount"),
    estimatedReclaimableBytes: nonnegativeInteger(result.estimatedReclaimableBytes, "result.estimatedReclaimableBytes"),
    candidateJobs: arrayValue(result.candidateJobs, (candidate, index) => {
      const item = strictObject(candidate, [
        "jobID",
        "targets",
        "estimatedReclaimableBytes",
        "fileCount",
        "directoryCount",
      ], `result.candidateJobs[${index}]`)
      return {
        jobID: safeID(item.jobID, `result.candidateJobs[${index}].jobID`),
        targets: parseTargets(item.targets, `result.candidateJobs[${index}].targets`),
        estimatedReclaimableBytes: nonnegativeInteger(item.estimatedReclaimableBytes, `result.candidateJobs[${index}].estimatedReclaimableBytes`),
        fileCount: nonnegativeInteger(item.fileCount, `result.candidateJobs[${index}].fileCount`),
        directoryCount: nonnegativeInteger(item.directoryCount, `result.candidateJobs[${index}].directoryCount`),
      }
    }, "result.candidateJobs"),
    reclaimedBytes: nonnegativeInteger(result.reclaimedBytes, "result.reclaimedBytes"),
    cleanedJobs: arrayValue(result.cleanedJobs, (cleaned, index) => {
      const item = strictObject(cleaned, [
        "jobID",
        "targets",
        "reclaimedBytes",
        "removedFileCount",
        "removedDirectoryCount",
      ], `result.cleanedJobs[${index}]`)
      return {
        jobID: safeID(item.jobID, `result.cleanedJobs[${index}].jobID`),
        targets: parseTargets(item.targets, `result.cleanedJobs[${index}].targets`),
        reclaimedBytes: nonnegativeInteger(item.reclaimedBytes, `result.cleanedJobs[${index}].reclaimedBytes`),
        removedFileCount: nonnegativeInteger(item.removedFileCount, `result.cleanedJobs[${index}].removedFileCount`),
        removedDirectoryCount: nonnegativeInteger(item.removedDirectoryCount, `result.cleanedJobs[${index}].removedDirectoryCount`),
      }
    }, "result.cleanedJobs"),
    skipped: arrayValue(result.skipped, (skipped, index) => {
      const item = strictObject(skipped, ["jobID", "reason", "target"], `result.skipped[${index}]`)
      const target = item.target === undefined
        ? undefined
        : enumValue(item.target, RETENTION_TARGETS, `result.skipped[${index}].target`)
      return {
        jobID: safeID(item.jobID, `result.skipped[${index}].jobID`),
        reason: enumValue(item.reason, RETENTION_SKIP_REASONS, `result.skipped[${index}].reason`),
        ...(target ? { target } : {}),
      }
    }, "result.skipped"),
    errors: arrayValue(result.errors, (error, index) => {
      const item = strictObject(error, ["jobID", "code", "target", "message"], `result.errors[${index}]`)
      const jobID = item.jobID === undefined ? undefined : safeID(item.jobID, `result.errors[${index}].jobID`)
      const target = item.target === undefined
        ? undefined
        : enumValue(item.target, RETENTION_ERROR_TARGETS, `result.errors[${index}].target`)
      return {
        ...(jobID ? { jobID } : {}),
        code: enumValue(item.code, RETENTION_ERROR_CODES, `result.errors[${index}].code`),
        ...(target ? { target } : {}),
        message: nonemptyString(item.message, `result.errors[${index}].message`),
      }
    }, "result.errors"),
  }
}
