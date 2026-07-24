import { Hono } from "hono"
import { ArtifactValidationError, RequestValidationError, UpstreamUnavailableError } from "./errors.js"
import { VerifiedArtifactCache } from "./cache.js"
import { UpdateMetrics } from "./metrics.js"
import { parseChannel } from "./security.js"
import { fetchVerifiedArtifact } from "./upstream.js"
import type { MobileUpdateChannel, VerifiedArtifact } from "./types.js"

export interface AppConfig {
  cdnBaseUrl: string
  publicKeyPem: string
  fetcher?: typeof fetch
  now?: () => number
  logger?: (entry: Record<string, unknown>) => void
  freshCacheMs?: number
  staleCacheMs?: number
  fetchTimeoutMs?: number
  readyUrl?: string
}

interface ManifestRequest {
  channel: MobileUpdateChannel
  runtimeVersion: string
  currentUpdateId: string | null
  embeddedUpdateId: string | null
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function commonHeaders() {
  return {
    "cache-control": "private, max-age=0, no-store",
    "expo-protocol-version": "1",
    "expo-sfv-version": "0",
  }
}

function signatureHeader(signature: string) {
  return `sig="${signature}", keyid="anybox-mobile-2026", alg="rsa-v1_5-sha256"`
}

function parseManifestRequest(headers: Headers): ManifestRequest {
  if (headers.get("expo-protocol-version") !== "1") {
    throw new RequestValidationError("expo-protocol-version must be 1.")
  }
  if (headers.get("expo-platform") !== "android") {
    throw new RequestValidationError("expo-platform must be android.")
  }
  const runtimeVersion = headers.get("expo-runtime-version")?.trim() ?? ""
  if (!runtimeVersion || runtimeVersion.length > 100 || !/^[A-Za-z0-9._()+-]+$/.test(runtimeVersion)) {
    throw new RequestValidationError("expo-runtime-version is missing or invalid.")
  }
  const channel = parseChannel(headers.get("expo-channel-name")?.trim())
  if (!channel) throw new RequestValidationError("expo-channel-name must be preview or production.")
  const currentUpdateId = headers.get("expo-current-update-id")?.trim() || null
  const embeddedUpdateId = headers.get("expo-embedded-update-id")?.trim() || null
  if (currentUpdateId && !UUID_PATTERN.test(currentUpdateId)) {
    throw new RequestValidationError("expo-current-update-id must be a UUID.")
  }
  if (embeddedUpdateId && !UUID_PATTERN.test(embeddedUpdateId)) {
    throw new RequestValidationError("expo-embedded-update-id must be a UUID.")
  }
  return { channel, runtimeVersion, currentUpdateId, embeddedUpdateId }
}

function multipartDirective(rawBody: string, signature: string) {
  const boundary = `anybox-${crypto.randomUUID()}`
  const body = [
    `--${boundary}`,
    'content-disposition: form-data; name="directive"',
    "content-type: application/expo+json; charset=utf-8",
    `expo-signature: ${signatureHeader(signature)}`,
    "",
    rawBody,
    `--${boundary}--`,
    "",
  ].join("\r\n")
  return { body, contentType: `multipart/mixed; boundary=${boundary}` }
}

export function createUpdateApp(config: AppConfig) {
  const app = new Hono()
  const fetcher = config.fetcher ?? fetch
  const now = config.now ?? Date.now
  const logger = config.logger ?? ((entry) => console.info(JSON.stringify(entry)))
  const cdnBaseUrl = new URL(config.cdnBaseUrl)
  if (
    cdnBaseUrl.protocol !== "https:" ||
    cdnBaseUrl.username ||
    cdnBaseUrl.password ||
    (cdnBaseUrl.port && cdnBaseUrl.port !== "443")
  ) {
    throw new Error("MOBILE_UPDATE_CDN_BASE_URL must use trusted HTTPS on port 443.")
  }
  const cache = new VerifiedArtifactCache<VerifiedArtifact | null>(
    config.freshCacheMs ?? 60_000,
    config.staleCacheMs ?? 24 * 60 * 60 * 1000,
    now,
  )
  const metrics = new UpdateMetrics()

  app.get("/livez", (context) =>
    context.json(
      { ok: true, service: "anybox-mobile-update-server" },
      200,
      { "cache-control": "no-store" },
    ),
  )

  app.get("/readyz", async (context) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.fetchTimeoutMs ?? 5_000)
    try {
      const response = await fetcher(config.readyUrl ?? cdnBaseUrl, {
        method: "HEAD",
        redirect: "manual",
        signal: controller.signal,
      })
      const ready = response.status < 500
      return context.json(
        { ok: ready, certificate: "loaded", cdn: ready ? "reachable" : "unavailable" },
        ready ? 200 : 503,
        { "cache-control": "no-store" },
      )
    } catch {
      return context.json(
        { ok: false, certificate: "loaded", cdn: "unavailable" },
        503,
        { "cache-control": "no-store" },
      )
    } finally {
      clearTimeout(timeout)
    }
  })

  app.get("/metrics", (context) =>
    context.text(metrics.render(), 200, {
      "cache-control": "no-store",
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
    }),
  )

  app.get("/v1/manifest", async (context) => {
    const startedAt = now()
    let channel: MobileUpdateChannel | "invalid" = "invalid"
    let result: "update" | "no_update" | "rollback" | "invalid" | "unavailable" = "invalid"
    let runtimeVersion = "invalid"
    let updateId: string | null = null

    try {
      const request = parseManifestRequest(context.req.raw.headers)
      channel = request.channel
      runtimeVersion = request.runtimeVersion
      const cacheKey = `${request.channel}:${request.runtimeVersion}`
      let artifact = cache.getFresh(cacheKey)
      if (artifact === undefined) {
        try {
          artifact = await fetchVerifiedArtifact(
            {
              cdnBaseUrl,
              publicKeyPem: config.publicKeyPem,
              fetcher,
              fetchTimeoutMs: config.fetchTimeoutMs ?? 8_000,
            },
            request.channel,
            request.runtimeVersion,
          )
          cache.set(cacheKey, artifact)
        } catch (error) {
          if (!(error instanceof UpstreamUnavailableError)) throw error
          artifact = cache.getStale(cacheKey)
          if (artifact === undefined) throw error
        }
      }

      if (!artifact) {
        result = "no_update"
        return new Response(null, { status: 204, headers: commonHeaders() })
      }
      updateId = artifact.pointer.updateId
      if (artifact.kind === "update") {
        if (request.currentUpdateId?.toLowerCase() === artifact.pointer.updateId) {
          result = "no_update"
          return new Response(null, { status: 204, headers: commonHeaders() })
        }
        result = "update"
        return new Response(artifact.rawBody, {
          status: 200,
          headers: {
            ...commonHeaders(),
            "content-type": "application/expo+json; charset=utf-8",
            "expo-signature": signatureHeader(artifact.pointer.signature),
          },
        })
      }

      if (!request.embeddedUpdateId) {
        throw new RequestValidationError("expo-embedded-update-id is required for rollback.")
      }
      if (request.currentUpdateId?.toLowerCase() === request.embeddedUpdateId.toLowerCase()) {
        result = "no_update"
        return new Response(null, { status: 204, headers: commonHeaders() })
      }
      const multipart = multipartDirective(artifact.rawBody, artifact.pointer.signature)
      result = "rollback"
      return new Response(multipart.body, {
        status: 200,
        headers: {
          ...commonHeaders(),
          "content-type": multipart.contentType,
        },
      })
    } catch (error) {
      if (error instanceof RequestValidationError) {
        result = "invalid"
        return context.json({ error: error.message }, 400, commonHeaders())
      }
      result = "unavailable"
      const reason = error instanceof ArtifactValidationError ? "invalid_signed_artifact" : "cdn_unavailable"
      return context.json({ error: "Update service is temporarily unavailable.", reason }, 503, commonHeaders())
    } finally {
      const durationMs = Math.max(0, now() - startedAt)
      metrics.record(channel, result, durationMs)
      logger({
        event: "mobile_update_manifest",
        channel,
        runtimeVersion,
        updateId,
        result,
        durationMs,
      })
    }
  })

  app.notFound((context) => context.json({ error: "Not found." }, 404))
  return app
}
