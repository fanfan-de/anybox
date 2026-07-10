import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const RUNTIME_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,255}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const COMMIT_SHA_PATTERN = /^[a-f0-9]{7,64}$/i
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const ABSOLUTE_WINDOWS_PATH = /^(?:[A-Za-z]:[\\/]|\\\\)/
const ACTIVE_RENDER_PHASES = new Set(["snapshotting", "probing", "rendering", "registering"])
const PLATFORMS = new Set(["win32", "darwin", "linux"])
const VIDEO_ENCODERS = new Set(["libx264", "h264_mf", "h264_videotoolbox"])

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function assertExactKeys(value, expectedKeys, label) {
  invariant(isObject(value), `${label} must be an object`)
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  invariant(
    actual.length === expected.length && actual.every((key, index) => key === expected[index]),
    `${label} fields must be exactly: ${expected.join(", ")}`,
  )
}

function assertString(value, label, { min = 1, max = 2_048 } = {}) {
  invariant(typeof value === "string", `${label} must be a string`)
  invariant(value.trim() === value, `${label} must not have surrounding whitespace`)
  invariant(value.length >= min && value.length <= max, `${label} has an invalid length`)
  invariant(!/[\u0000-\u001f\u007f]/.test(value), `${label} must not contain control characters`)
  return value
}

function assertBoolean(value, expected, label) {
  invariant(typeof value === "boolean", `${label} must be a boolean`)
  if (expected !== undefined) invariant(value === expected, `${label} must be ${expected}`)
}

function assertPositiveInteger(value, label) {
  invariant(Number.isSafeInteger(value) && value > 0, `${label} must be a positive integer`)
}

function assertSafeID(value, label) {
  assertString(value, label, { max: 128 })
  invariant(SAFE_ID_PATTERN.test(value), `${label} must be a path-safe ID`)
}

function assertTimestamp(value, label) {
  invariant(typeof value === "string" && ISO_DATETIME_PATTERN.test(value), `${label} must be an ISO-8601 timestamp with timezone`)
  const milliseconds = Date.parse(value)
  invariant(Number.isFinite(milliseconds), `${label} is not a valid timestamp`)
  return milliseconds
}

function assertStringArray(value, label, { allowEmpty = true } = {}) {
  invariant(Array.isArray(value), `${label} must be an array`)
  if (!allowEmpty) invariant(value.length > 0, `${label} must not be empty`)
  for (let index = 0; index < value.length; index += 1) {
    assertString(value[index], `${label}[${index}]`)
  }
  invariant(new Set(value).size === value.length, `${label} must not contain duplicates`)
}

function assertPathRedacted(value, label = "evidence") {
  if (typeof value === "string") {
    invariant(!ABSOLUTE_WINDOWS_PATH.test(value), `${label} must not contain an absolute Windows path`)
    invariant(!value.startsWith("/"), `${label} must not contain an absolute POSIX path`)
    invariant(!/^file:\/\//i.test(value), `${label} must not contain a file URL`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPathRedacted(entry, `${label}[${index}]`))
    return
  }
  if (isObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      assertPathRedacted(entry, `${label}.${key}`)
    }
  }
}

function validateBuild(build, releaseStrict) {
  assertExactKeys(build, [
    "classification",
    "desktopVersion",
    "commitSHA",
    "artifactFileName",
    "artifactSHA256",
    "deliverDevGateEnabled",
    "releaseStrictVerificationPassed",
    "publishPolicy",
  ], "build")
  invariant(
    build.classification === "technical-preview" || build.classification === "release-candidate",
    "build.classification must be technical-preview or release-candidate",
  )
  assertString(build.desktopVersion, "build.desktopVersion", { max: 128 })
  invariant(SEMVER_PATTERN.test(build.desktopVersion), "build.desktopVersion must be semantic version text")
  assertString(build.commitSHA, "build.commitSHA", { max: 64 })
  invariant(COMMIT_SHA_PATTERN.test(build.commitSHA), "build.commitSHA must be a Git commit SHA")
  assertString(build.artifactFileName, "build.artifactFileName", { max: 255 })
  invariant(path.basename(build.artifactFileName) === build.artifactFileName, "build.artifactFileName must not contain a path")
  assertString(build.artifactSHA256, "build.artifactSHA256", { min: 64, max: 64 })
  invariant(SHA256_PATTERN.test(build.artifactSHA256), "build.artifactSHA256 must be a lowercase SHA-256 digest")
  assertBoolean(build.deliverDevGateEnabled, undefined, "build.deliverDevGateEnabled")
  assertBoolean(build.releaseStrictVerificationPassed, undefined, "build.releaseStrictVerificationPassed")
  invariant(build.publishPolicy === "never", "build.publishPolicy must be never for a local acceptance artifact")

  if (build.classification === "technical-preview") {
    invariant(build.deliverDevGateEnabled, "technical-preview evidence must record the Deliver development gate as enabled")
    invariant(!build.releaseStrictVerificationPassed, "technical-preview evidence cannot claim release-strict verification")
  } else {
    invariant(!build.deliverDevGateEnabled, "release-candidate evidence must not use the Deliver development gate")
    invariant(build.releaseStrictVerificationPassed, "release-candidate evidence must pass release-strict verification")
  }
  if (releaseStrict) {
    invariant(build.classification === "release-candidate", "release-strict verification rejects technical-preview rehearsal evidence")
  }
}

function validateHost(host) {
  assertExactKeys(host, [
    "platform",
    "architecture",
    "osVersion",
    "installPathContainsSpaces",
    "absoluteInstallPathRecorded",
  ], "host")
  invariant(PLATFORMS.has(host.platform), "host.platform is unsupported")
  assertString(host.architecture, "host.architecture", { max: 64 })
  assertString(host.osVersion, "host.osVersion", { max: 256 })
  assertBoolean(host.installPathContainsSpaces, true, "host.installPathContainsSpaces")
  assertBoolean(host.absoluteInstallPathRecorded, false, "host.absoluteInstallPathRecorded")
}

function validateRuntime(runtime) {
  assertExactKeys(runtime, ["runtimeID", "ffmpegVersion", "platform", "videoEncoder", "audioEncoder"], "runtime")
  assertString(runtime.runtimeID, "runtime.runtimeID", { max: 256 })
  invariant(RUNTIME_ID_PATTERN.test(runtime.runtimeID), "runtime.runtimeID must be path-free")
  assertString(runtime.ffmpegVersion, "runtime.ffmpegVersion", { max: 256 })
  invariant(!/[\\/]/.test(runtime.ffmpegVersion), "runtime.ffmpegVersion must be path-free")
  invariant(PLATFORMS.has(runtime.platform), "runtime.platform is unsupported")
  invariant(VIDEO_ENCODERS.has(runtime.videoEncoder), "runtime.videoEncoder is unsupported")
  invariant(runtime.audioEncoder === "aac", "runtime.audioEncoder must be aac")
}

function validateRenderBeforeKill(renderBeforeKill) {
  assertExactKeys(renderBeforeKill, [
    "projectID",
    "timelineID",
    "timelineRevision",
    "jobID",
    "jobStatus",
    "lockedRuntimeMatchesRuntimeSection",
    "sustainedProgressObserved",
  ], "renderBeforeKill")
  assertSafeID(renderBeforeKill.projectID, "renderBeforeKill.projectID")
  assertSafeID(renderBeforeKill.timelineID, "renderBeforeKill.timelineID")
  invariant(
    Number.isSafeInteger(renderBeforeKill.timelineRevision) && renderBeforeKill.timelineRevision >= 0,
    "renderBeforeKill.timelineRevision must be a non-negative integer",
  )
  assertSafeID(renderBeforeKill.jobID, "renderBeforeKill.jobID")
  invariant(ACTIVE_RENDER_PHASES.has(renderBeforeKill.jobStatus), "renderBeforeKill.jobStatus must be an active render phase")
  assertBoolean(
    renderBeforeKill.lockedRuntimeMatchesRuntimeSection,
    true,
    "renderBeforeKill.lockedRuntimeMatchesRuntimeSection",
  )
  assertBoolean(renderBeforeKill.sustainedProgressObserved, true, "renderBeforeKill.sustainedProgressObserved")
}

function validateKillAndRestart(killAndRestart) {
  assertExactKeys(killAndRestart, [
    "processKind",
    "killedPID",
    "killedAt",
    "desktopRemainedRunning",
    "agentRestartObservedAt",
    "agentRestartedWithDifferentPID",
  ], "killAndRestart")
  invariant(killAndRestart.processKind === "managed-agent", "killAndRestart.processKind must be managed-agent")
  assertPositiveInteger(killAndRestart.killedPID, "killAndRestart.killedPID")
  const killedAt = assertTimestamp(killAndRestart.killedAt, "killAndRestart.killedAt")
  const restartedAt = assertTimestamp(killAndRestart.agentRestartObservedAt, "killAndRestart.agentRestartObservedAt")
  invariant(restartedAt > killedAt, "Agent restart must be observed after the kill")
  assertBoolean(killAndRestart.desktopRemainedRunning, true, "killAndRestart.desktopRemainedRunning")
  assertBoolean(
    killAndRestart.agentRestartedWithDifferentPID,
    true,
    "killAndRestart.agentRestartedWithDifferentPID",
  )
  return { killedAt, restartedAt }
}

function validateRecovery(recovery, runtime, restartedAt) {
  assertExactKeys(recovery, [
    "observedAt",
    "terminalStatus",
    "errorCode",
    "renderInterruptedEventObserved",
    "diagnosticPhase",
    "diagnosticRuntimeMatchesLockedBinding",
    "temporaryOutputAbsent",
    "orphanFFmpegProcessAbsent",
    "partialOrFakeOutputAssetAbsent",
  ], "recovery")
  const observedAt = assertTimestamp(recovery.observedAt, "recovery.observedAt")
  invariant(observedAt >= restartedAt, "Recovery must be observed after the Agent restart")
  invariant(recovery.terminalStatus === "interrupted", "recovery.terminalStatus must be interrupted")
  invariant(recovery.errorCode === "render-interrupted", "recovery.errorCode must be render-interrupted")
  assertBoolean(recovery.renderInterruptedEventObserved, true, "recovery.renderInterruptedEventObserved")
  invariant(ACTIVE_RENDER_PHASES.has(recovery.diagnosticPhase), "recovery.diagnosticPhase must identify the interrupted phase")
  assertBoolean(
    recovery.diagnosticRuntimeMatchesLockedBinding,
    true,
    "recovery.diagnosticRuntimeMatchesLockedBinding",
  )
  assertBoolean(recovery.temporaryOutputAbsent, true, "recovery.temporaryOutputAbsent")
  assertBoolean(recovery.orphanFFmpegProcessAbsent, true, "recovery.orphanFFmpegProcessAbsent")
  assertBoolean(recovery.partialOrFakeOutputAssetAbsent, true, "recovery.partialOrFakeOutputAssetAbsent")
  invariant(runtime.platform !== undefined, "runtime must be recorded before recovery can be validated")
  return observedAt
}

function validateRetry(retry, originalJobID, originalRevision, recoveryObservedAt) {
  assertExactKeys(retry, [
    "requestedAt",
    "jobID",
    "retryOfJobID",
    "isDistinctJob",
    "usesOriginalTimelineRevision",
    "terminalStatus",
  ], "retry")
  const requestedAt = assertTimestamp(retry.requestedAt, "retry.requestedAt")
  invariant(requestedAt >= recoveryObservedAt, "Retry must be requested after recovery is observed")
  assertSafeID(retry.jobID, "retry.jobID")
  assertSafeID(retry.retryOfJobID, "retry.retryOfJobID")
  invariant(retry.retryOfJobID === originalJobID, "retry.retryOfJobID must reference the interrupted job")
  invariant(retry.jobID !== originalJobID, "retry.jobID must differ from the interrupted job")
  assertBoolean(retry.isDistinctJob, true, "retry.isDistinctJob")
  assertBoolean(retry.usesOriginalTimelineRevision, true, "retry.usesOriginalTimelineRevision")
  invariant(retry.terminalStatus === "succeeded", "retry.terminalStatus must be succeeded")
  invariant(Number.isSafeInteger(originalRevision), "Original timeline revision must be recorded")
  return requestedAt
}

function validateRedactionChecklist(checklist) {
  assertExactKeys(checklist, [
    "absolutePathsAbsent",
    "environmentVariablesAbsent",
    "rawCommandsAndFilterGraphsAbsent",
    "rawStderrAbsent",
    "tokensAndSecretsAbsent",
  ], "redactionChecklist")
  for (const [key, value] of Object.entries(checklist)) {
    assertBoolean(value, true, `redactionChecklist.${key}`)
  }
}

export function validateDeliverRestartEvidence(evidence, { releaseStrict = false } = {}) {
  assertExactKeys(evidence, [
    "$comment",
    "schemaVersion",
    "templateOnly",
    "gate",
    "result",
    "recordedAt",
    "operatorReference",
    "build",
    "host",
    "runtime",
    "renderBeforeKill",
    "killAndRestart",
    "recovery",
    "retry",
    "redactionChecklist",
    "evidenceReferences",
    "failureReasons",
    "notes",
  ], "evidence")
  assertPathRedacted(evidence)
  assertString(evidence.$comment, "evidence.$comment")
  invariant(evidence.schemaVersion === 1, `Unsupported evidence schema ${evidence.schemaVersion}`)
  invariant(evidence.templateOnly === false, "Evidence is still marked templateOnly")
  invariant(evidence.gate === "deliver-installed-agent-kill-restart", "Evidence has the wrong gate ID")
  invariant(evidence.result === "passed" || evidence.result === "failed", "evidence.result must be passed or failed")
  const recordedAt = assertTimestamp(evidence.recordedAt, "evidence.recordedAt")
  assertString(evidence.operatorReference, "evidence.operatorReference", { max: 256 })

  validateBuild(evidence.build, releaseStrict)
  validateHost(evidence.host)
  validateRuntime(evidence.runtime)
  invariant(evidence.host.platform === evidence.runtime.platform, "Host and runtime platforms must match")
  validateRenderBeforeKill(evidence.renderBeforeKill)
  const { restartedAt } = validateKillAndRestart(evidence.killAndRestart)
  const recoveryObservedAt = validateRecovery(evidence.recovery, evidence.runtime, restartedAt)
  const retryRequestedAt = validateRetry(
    evidence.retry,
    evidence.renderBeforeKill.jobID,
    evidence.renderBeforeKill.timelineRevision,
    recoveryObservedAt,
  )
  invariant(recordedAt >= retryRequestedAt, "Evidence must be recorded after the retry is requested")
  validateRedactionChecklist(evidence.redactionChecklist)
  assertStringArray(evidence.evidenceReferences, "evidence.evidenceReferences", { allowEmpty: false })
  assertStringArray(evidence.failureReasons, "evidence.failureReasons")
  assertStringArray(evidence.notes, "evidence.notes")
  if (evidence.result === "passed") {
    invariant(evidence.failureReasons.length === 0, "Passed evidence must not contain failure reasons")
  } else {
    invariant(evidence.failureReasons.length > 0, "Failed evidence must explain at least one failure")
    throw new Error(`Evidence records a failed run with ${evidence.failureReasons.length} failure reason(s)`)
  }
  return {
    classification: evidence.build.classification,
    platform: evidence.host.platform,
    artifactSHA256: evidence.build.artifactSHA256,
    result: evidence.result,
  }
}

function parseArguments(argv) {
  let evidencePath
  let releaseStrict = false
  for (const argument of argv) {
    if (argument === "--release-strict") {
      releaseStrict = true
      continue
    }
    invariant(!argument.startsWith("-"), `Unknown option ${argument}`)
    invariant(!evidencePath, "Only one evidence file may be supplied")
    evidencePath = argument
  }
  invariant(evidencePath, "Usage: verify-deliver-restart-evidence <evidence.json> [--release-strict]")
  return { evidencePath: path.resolve(evidencePath), releaseStrict }
}

async function main() {
  try {
    const { evidencePath, releaseStrict } = parseArguments(process.argv.slice(2))
    const evidence = JSON.parse(await fs.readFile(evidencePath, "utf8"))
    const result = validateDeliverRestartEvidence(evidence, { releaseStrict })
    const scope = result.classification === "technical-preview"
      ? "valid technical-preview rehearsal evidence; public release gate remains open"
      : "valid release-candidate restart evidence"
    console.log(`[desktop][deliver-restart-evidence] ${scope} (${result.platform}, sha256=${result.artifactSHA256})`)
  } catch (error) {
    console.error(`[desktop][deliver-restart-evidence] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
