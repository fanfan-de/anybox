import fsp from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const REQUIRED_LICENSE_SCOPES = new Set([
  "ffmpeg-redistribution",
  "h264-use",
  "windows-media-foundation",
  "macos-videotoolbox",
  "source-and-notice-offer",
  "supported-os-scope",
])
const SHA_PATTERN = /^[a-f0-9]{7,64}$/i
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function approvedRecord(value, label) {
  invariant(value && typeof value === "object", `${label} approval is missing`)
  invariant(value.status === "approved", `${label} status must be approved`)
  invariant(typeof value.approver === "string" && value.approver.trim().length > 0, `${label} approver is missing`)
  invariant(Number.isFinite(Date.parse(value.approvedAt)), `${label} approvedAt is invalid`)
  invariant(Array.isArray(value.references) && value.references.length > 0, `${label} references are missing`)
  for (const reference of value.references) {
    invariant(typeof reference === "string" && reference.trim().length > 0, `${label} has an invalid reference`)
    invariant(!/[<>]|pending|placeholder|example\.invalid/i.test(reference), `${label} contains placeholder evidence`)
  }
}

export function validateDeliverReleaseApproval(record) {
  invariant(record?.schemaVersion === 1, "Unsupported Deliver release approval schema")
  invariant(record.templateOnly === false, "Deliver release approval is still a template")
  invariant(record.result === "approved", "Deliver release approval result must be approved")
  invariant(SEMVER_PATTERN.test(record.desktopVersion), "Approval desktopVersion is invalid")
  invariant(SHA_PATTERN.test(record.commitSHA), "Approval commitSHA is invalid")
  invariant(record.targets?.win32X64?.runtimeID, "Windows runtime approval binding is missing")
  invariant(record.targets?.darwinArm64?.runtimeID, "macOS runtime approval binding is missing")

  approvedRecord(record.license, "License")
  invariant(Array.isArray(record.license.scopes), "License scopes are missing")
  const licenseScopes = new Set(record.license.scopes)
  for (const scope of REQUIRED_LICENSE_SCOPES) invariant(licenseScopes.has(scope), `License approval does not cover ${scope}`)

  approvedRecord(record.product, "Product")
  invariant(typeof record.product.retentionPolicyReference === "string", "Product retention decision is missing")
  invariant(typeof record.product.cleanupAuthorizationReference === "string", "Product cleanup authorization is missing")
  invariant(record.product.confirmationWord === "CLEAN", "Product approval must bind the CLEAN confirmation word")
  invariant(record.product.noAutomaticScheduling === true, "Product approval must forbid automatic cleanup scheduling")
  invariant(typeof record.product.telemetryReference === "string", "Product telemetry decision is missing")

  approvedRecord(record.security, "Security")
  invariant(typeof record.security.retentionAndCleanupReference === "string", "Security retention/cleanup review is missing")
  invariant(typeof record.security.telemetryReference === "string", "Security telemetry review is missing")
  invariant(typeof record.security.monitoringReference === "string", "Security monitoring review is missing")

  invariant(record.rollback?.strategy === "disable-deliver", "Initial release rollback must disable Deliver")
  invariant(record.rollback?.capability === "timelineDelivery", "Rollback must target timelineDelivery")
  invariant(typeof record.rollback?.reference === "string" && record.rollback.reference.length > 0, "Rollback evidence is missing")
  return record
}

async function main() {
  const file = process.argv[2]
  invariant(file && !file.startsWith("-"), "Usage: verify-deliver-release-approval <approval.json>")
  const record = validateDeliverReleaseApproval(JSON.parse(await fsp.readFile(path.resolve(file), "utf8")))
  console.log(`[desktop][deliver-release] accepted license/product/security approval for ${record.desktopVersion}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    console.error(`[desktop][deliver-release] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
