import { createPublicKey, verify } from "node:crypto"
import type {
  ExpoUpdateAsset,
  ExpoUpdateDirective,
  ExpoUpdateManifest,
  MobileOtaChannelPointer,
  MobileUpdateChannel,
} from "./types.js"
import { MOBILE_UPDATE_CHANNELS } from "./types.js"
import { ArtifactValidationError } from "./errors.js"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/
const BASE64_URL_SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/
const FINGERPRINT_PATTERN = /^[A-Za-z0-9_-]{20,256}$/
const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{7,64}$/i

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function requiredString(source: Record<string, unknown>, key: string, maximum = 2048) {
  const value = source[key]
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new ArtifactValidationError(`Invalid ${key}.`)
  }
  return value
}

function parseIsoDate(value: string, label: string) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new ArtifactValidationError(`${label} must be an ISO-8601 UTC timestamp.`)
  }
  return value
}

function parseAllowedAssetUrl(
  value: string,
  cdnBaseUrl: URL,
  runtimeVersion: string,
  updateId: string,
) {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new ArtifactValidationError("Update asset URL is invalid.")
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.host !== cdnBaseUrl.host) {
    throw new ArtifactValidationError("Update assets must use the configured HTTPS CDN host.")
  }
  const releasePrefix = `/mobile/ota/releases/${encodeURIComponent(runtimeVersion)}/${updateId}/`
  if (!parsed.pathname.startsWith(releasePrefix) || parsed.pathname.includes("..")) {
    throw new ArtifactValidationError("Update asset URL is outside the immutable release directory.")
  }
  return parsed.toString()
}

function parseAsset(
  value: unknown,
  cdnBaseUrl: URL,
  runtimeVersion: string,
  updateId: string,
): ExpoUpdateAsset {
  const source = record(value)
  if (!source) throw new ArtifactValidationError("Update asset must be an object.")
  const hash = requiredString(source, "hash", 100)
  const key = requiredString(source, "key", 256)
  const contentType = requiredString(source, "contentType", 200)
  const url = parseAllowedAssetUrl(requiredString(source, "url"), cdnBaseUrl, runtimeVersion, updateId)
  if (!BASE64_URL_SHA256_PATTERN.test(hash)) {
    throw new ArtifactValidationError("Update asset hash must be an unpadded Base64URL SHA-256.")
  }
  if (!/^[\w.+-]+\/[\w.+-]+(?:;\s*charset=[\w-]+)?$/i.test(contentType)) {
    throw new ArtifactValidationError("Update asset contentType is invalid.")
  }
  const fileExtension = source.fileExtension
  if (fileExtension !== undefined && (typeof fileExtension !== "string" || !/^\.[A-Za-z0-9]{1,12}$/.test(fileExtension))) {
    throw new ArtifactValidationError("Update asset fileExtension is invalid.")
  }
  return {
    hash,
    key,
    contentType,
    url,
    ...(typeof fileExtension === "string" ? { fileExtension } : {}),
  }
}

export function parseChannel(value: string | undefined): MobileUpdateChannel | null {
  return MOBILE_UPDATE_CHANNELS.includes(value as MobileUpdateChannel)
    ? (value as MobileUpdateChannel)
    : null
}

export function parsePointer(
  value: unknown,
  expected: { channel: MobileUpdateChannel; runtimeVersion: string; cdnBaseUrl: URL },
): MobileOtaChannelPointer {
  const source = record(value)
  if (!source) throw new ArtifactValidationError("Channel pointer must be a JSON object.")
  if (source.schemaVersion !== 1) throw new ArtifactValidationError("Unsupported channel pointer schemaVersion.")
  if (source.type !== "update" && source.type !== "rollback") {
    throw new ArtifactValidationError("Unsupported channel pointer type.")
  }
  if (source.channel !== expected.channel || source.platform !== "android") {
    throw new ArtifactValidationError("Channel pointer does not match the request.")
  }
  const runtimeVersion = requiredString(source, "runtimeVersion", 100)
  if (runtimeVersion !== expected.runtimeVersion) {
    throw new ArtifactValidationError("Channel pointer runtimeVersion does not match the request.")
  }
  const updateId = requiredString(source, "updateId", 64).toLowerCase()
  if (!UUID_PATTERN.test(updateId)) throw new ArtifactValidationError("Channel pointer updateId must be a UUID.")
  const createdAt = parseIsoDate(requiredString(source, "createdAt", 40), "Channel pointer createdAt")
  const manifestUrl = parseAllowedAssetUrl(
    requiredString(source, "manifestUrl"),
    expected.cdnBaseUrl,
    runtimeVersion,
    updateId,
  )
  if (!new URL(manifestUrl).pathname.endsWith("/manifest.json")) {
    throw new ArtifactValidationError("Channel pointer manifestUrl must end with manifest.json.")
  }
  const signature = requiredString(source, "signature", 4096)
  if (!BASE64_PATTERN.test(signature)) throw new ArtifactValidationError("Channel pointer signature is not Base64.")
  if (source.keyId !== "anybox-mobile-2026") throw new ArtifactValidationError("Unknown OTA signing key id.")
  const sourceCommit = requiredString(source, "sourceCommit", 64)
  if (!SOURCE_COMMIT_PATTERN.test(sourceCommit)) throw new ArtifactValidationError("Invalid sourceCommit.")
  const message = requiredString(source, "message", 500)
  const nativeFingerprint = requiredString(source, "nativeFingerprint", 256)
  if (!FINGERPRINT_PATTERN.test(nativeFingerprint)) throw new ArtifactValidationError("Invalid nativeFingerprint.")

  return {
    schemaVersion: 1,
    type: source.type,
    channel: expected.channel,
    platform: "android",
    runtimeVersion,
    updateId,
    createdAt,
    manifestUrl,
    signature,
    keyId: "anybox-mobile-2026",
    sourceCommit,
    message,
    nativeFingerprint,
  }
}

export function verifySignedBody(rawBody: string, signature: string, publicKeyPem: string) {
  try {
    return verify(
      "RSA-SHA256",
      Buffer.from(rawBody, "utf8"),
      createPublicKey(publicKeyPem),
      Buffer.from(signature, "base64"),
    )
  } catch {
    return false
  }
}

export function parseManifest(
  value: unknown,
  pointer: MobileOtaChannelPointer,
  cdnBaseUrl: URL,
): ExpoUpdateManifest {
  const source = record(value)
  if (!source) throw new ArtifactValidationError("Update manifest must be a JSON object.")
  const id = requiredString(source, "id", 64).toLowerCase()
  if (id !== pointer.updateId || !UUID_PATTERN.test(id)) {
    throw new ArtifactValidationError("Update manifest id does not match its channel pointer.")
  }
  const createdAt = parseIsoDate(requiredString(source, "createdAt", 40), "Update manifest createdAt")
  if (createdAt !== pointer.createdAt) {
    throw new ArtifactValidationError("Update manifest createdAt does not match its channel pointer.")
  }
  const runtimeVersion = requiredString(source, "runtimeVersion", 100)
  if (runtimeVersion !== pointer.runtimeVersion) {
    throw new ArtifactValidationError("Update manifest runtimeVersion does not match its channel pointer.")
  }
  const launchAsset = parseAsset(source.launchAsset, cdnBaseUrl, runtimeVersion, id)
  if (!Array.isArray(source.assets) || source.assets.length > 10_000) {
    throw new ArtifactValidationError("Update manifest assets must be an array.")
  }
  const assets = source.assets.map((asset) => parseAsset(asset, cdnBaseUrl, runtimeVersion, id))
  const metadata = record(source.metadata)
  const extra = record(source.extra)
  if (!metadata || !Object.values(metadata).every((item) => typeof item === "string")) {
    throw new ArtifactValidationError("Update manifest metadata must contain only string values.")
  }
  if (!extra) throw new ArtifactValidationError("Update manifest extra must be an object.")
  const anybox = record(extra.anybox)
  if (
    !anybox ||
    anybox.nativeFingerprint !== pointer.nativeFingerprint ||
    anybox.sourceCommit !== pointer.sourceCommit ||
    anybox.message !== pointer.message
  ) {
    throw new ArtifactValidationError("Update manifest Anybox metadata does not match its channel pointer.")
  }

  return {
    id,
    createdAt,
    runtimeVersion,
    launchAsset,
    assets,
    metadata: metadata as Record<string, string>,
    extra: extra as ExpoUpdateManifest["extra"],
  }
}

export function parseRollbackDirective(value: unknown, pointer: MobileOtaChannelPointer): ExpoUpdateDirective {
  const source = record(value)
  if (!source || source.type !== "rollBackToEmbedded") {
    throw new ArtifactValidationError("Rollback body must contain a rollBackToEmbedded directive.")
  }
  const parameters = record(source.parameters)
  if (!parameters) throw new ArtifactValidationError("Rollback directive is missing parameters.")
  const commitTime = parseIsoDate(requiredString(parameters, "commitTime", 40), "Rollback commitTime")
  if (commitTime !== pointer.createdAt) {
    throw new ArtifactValidationError("Rollback commitTime does not match its channel pointer.")
  }
  return {
    type: "rollBackToEmbedded",
    parameters: { commitTime },
    ...(record(source.extra) ? { extra: record(source.extra)! } : {}),
  }
}
