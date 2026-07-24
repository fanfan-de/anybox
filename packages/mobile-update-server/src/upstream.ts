import { ArtifactValidationError, UpstreamUnavailableError } from "./errors.js"
import {
  parseManifest,
  parsePointer,
  parseRollbackDirective,
  verifySignedBody,
} from "./security.js"
import type {
  MobileUpdateChannel,
  VerifiedArtifact,
} from "./types.js"

export interface UpstreamConfig {
  cdnBaseUrl: URL
  publicKeyPem: string
  fetchTimeoutMs: number
  fetcher: typeof fetch
}

function channelPointerUrl(cdnBaseUrl: URL, channel: MobileUpdateChannel, runtimeVersion: string) {
  return new URL(
    `/mobile/ota/channels/${channel}/android/${encodeURIComponent(runtimeVersion)}.json`,
    cdnBaseUrl,
  )
}

async function fetchText(config: UpstreamConfig, url: URL, allowMissing = false) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.fetchTimeoutMs)
  try {
    const response = await config.fetcher(url, {
      headers: {
        accept: "application/json",
        "user-agent": "Anybox-Mobile-Update-Server/1",
      },
      redirect: "follow",
      signal: controller.signal,
    })
    if (allowMissing && response.status === 404) return null
    if (!response.ok) {
      throw new UpstreamUnavailableError(`Update CDN returned HTTP ${response.status}.`)
    }
    const finalUrl = new URL(response.url || url)
    if (
      finalUrl.protocol !== "https:" ||
      finalUrl.username ||
      finalUrl.password ||
      (finalUrl.port && finalUrl.port !== "443") ||
      finalUrl.host !== config.cdnBaseUrl.host
    ) {
      throw new ArtifactValidationError("Update CDN redirected metadata to an untrusted URL.")
    }
    const declaredLength = Number(response.headers.get("content-length"))
    if (Number.isFinite(declaredLength) && declaredLength > 2_000_000) {
      throw new ArtifactValidationError("Update metadata exceeds the 2 MB safety limit.")
    }
    const body = await response.text()
    if (body.length > 2_000_000) throw new ArtifactValidationError("Update metadata exceeds the 2 MB safety limit.")
    return body
  } catch (error) {
    if (error instanceof ArtifactValidationError || error instanceof UpstreamUnavailableError) throw error
    throw new UpstreamUnavailableError("Unable to reach the update CDN.")
  } finally {
    clearTimeout(timeout)
  }
}

export async function fetchVerifiedArtifact(
  config: UpstreamConfig,
  channel: MobileUpdateChannel,
  runtimeVersion: string,
): Promise<VerifiedArtifact | null> {
  const rawPointer = await fetchText(
    config,
    channelPointerUrl(config.cdnBaseUrl, channel, runtimeVersion),
    true,
  )
  if (rawPointer === null) return null

  let pointerValue: unknown
  try {
    pointerValue = JSON.parse(rawPointer)
  } catch {
    throw new ArtifactValidationError("Channel pointer is not valid JSON.")
  }
  const pointer = parsePointer(pointerValue, {
    channel,
    runtimeVersion,
    cdnBaseUrl: config.cdnBaseUrl,
  })
  const rawBody = await fetchText(config, new URL(pointer.manifestUrl))
  if (rawBody === null) throw new UpstreamUnavailableError("Signed update body is missing.")
  if (!verifySignedBody(rawBody, pointer.signature, config.publicKeyPem)) {
    throw new ArtifactValidationError("Signed update body failed RSA verification.")
  }

  let bodyValue: unknown
  try {
    bodyValue = JSON.parse(rawBody)
  } catch {
    throw new ArtifactValidationError("Signed update body is not valid JSON.")
  }

  if (pointer.type === "rollback") {
    return {
      kind: "rollback",
      pointer,
      rawBody,
      directive: parseRollbackDirective(bodyValue, pointer),
    }
  }
  return {
    kind: "update",
    pointer,
    rawBody,
    manifest: parseManifest(bodyValue, pointer, config.cdnBaseUrl),
  }
}
