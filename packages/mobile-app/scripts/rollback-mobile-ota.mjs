import { randomUUID } from "node:crypto"
import {
  assertNativeFingerprint,
  assertPublicBytes,
  assertScopedReleaseTreeClean,
  jsonBody,
  loadMobileReleaseEnvironment,
  otaKeyId,
  parseOption,
  publicUrlForKey,
  readGit,
  readMobileConfig,
  requireOtaSigningMaterial,
  signBody,
  uploadImmutableBody,
  uploadPointerBody,
} from "./lib/mobile-update-tools.mjs"

async function main() {
  const args = process.argv.slice(2)
  const channel = parseOption(args, "--channel", "production")
  if (channel !== "preview" && channel !== "production") {
    throw new Error("--channel must be preview or production.")
  }
  if (!args.includes("--embedded")) {
    throw new Error("Only the explicit --embedded rollback mode is supported.")
  }
  loadMobileReleaseEnvironment()
  assertScopedReleaseTreeClean()
  const mobile = readMobileConfig()
  const signing = requireOtaSigningMaterial()
  const nativeFingerprint = await assertNativeFingerprint(mobile.runtimeVersion)
  const sourceCommit = readGit(["rev-parse", "HEAD"]).toLowerCase()
  const updateId = randomUUID()
  const createdAt = new Date().toISOString()
  const message = parseOption(args, "--message", "Emergency rollback to embedded update").trim()
  if (!message || message.length > 500) {
    throw new Error("--message must contain between 1 and 500 characters.")
  }
  const directive = {
    type: "rollBackToEmbedded",
    parameters: { commitTime: createdAt },
  }
  const rawDirective = jsonBody(directive)
  const signature = signBody(rawDirective, signing.privateKeyPem)
  const releaseKey = `mobile/ota/releases/${mobile.runtimeVersion}/${updateId}/manifest.json`
  const releaseUrl = publicUrlForKey(releaseKey)
  const pointer = {
    schemaVersion: 1,
    type: "rollback",
    channel,
    platform: "android",
    runtimeVersion: mobile.runtimeVersion,
    updateId,
    createdAt,
    manifestUrl: releaseUrl,
    signature,
    keyId: otaKeyId,
    sourceCommit,
    message,
    nativeFingerprint,
  }
  const pointerKey = `mobile/ota/channels/${channel}/android/${mobile.runtimeVersion}.json`
  const pointerBody = jsonBody(pointer)

  await uploadImmutableBody(rawDirective, releaseKey, "application/json; charset=utf-8")
  await assertPublicBytes(releaseUrl, rawDirective)
  await uploadPointerBody(pointerBody, pointerKey)
  await assertPublicBytes(publicUrlForKey(pointerKey), pointerBody)

  console.log(`Published signed rollBackToEmbedded directive ${updateId}.`)
  console.log(`Channel: ${channel}`)
  console.log(`Runtime: ${mobile.runtimeVersion}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
