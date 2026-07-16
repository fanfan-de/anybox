import type { RegistryProviderError, RegistryProviderErrorCode } from "@anybox/shared/skill-registry"
import type { RegistryFetch } from "./types.ts"

const DEFAULT_TIMEOUT_MS = 12_000
const DEFAULT_USER_AGENT = "Anybox-Skill-Library/0.1"
const MAX_JSON_BYTES = 4 * 1024 * 1024
const MAX_TEXT_BYTES = 1024 * 1024

export class RegistryProviderRequestError extends Error {
  constructor(
    public readonly provider: string,
    public readonly code: RegistryProviderErrorCode,
    message: string,
    public readonly retryAfterMs?: number,
    public readonly status?: number,
  ) {
    super(message)
    this.name = "RegistryProviderRequestError"
  }
}

export function isRegistryProviderRequestError(error: unknown): error is RegistryProviderRequestError {
  return error instanceof RegistryProviderRequestError
}

export function toRegistryProviderError(error: unknown, provider: string): RegistryProviderError {
  if (isRegistryProviderRequestError(error)) {
    return {
      provider: error.provider,
      code: error.code,
      message: error.message,
      retryAfterMs: error.retryAfterMs,
    }
  }

  return {
    provider,
    code: "UNAVAILABLE",
    message: `${provider} is unavailable`,
  }
}

export interface RegistryHttpClientOptions {
  provider: string
  fetch?: RegistryFetch
  timeoutMs?: number
  userAgent?: string
  now?: () => number
}

function retryAfterMilliseconds(headers: Headers, now: number) {
  const retryAfter = headers.get("retry-after")?.trim()
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000)
    const timestamp = Date.parse(retryAfter)
    if (Number.isFinite(timestamp)) return Math.max(0, timestamp - now)
  }

  const standardReset = Number(headers.get("ratelimit-reset"))
  if (Number.isFinite(standardReset) && standardReset >= 0) return Math.ceil(standardReset * 1000)

  const legacyReset = Number(headers.get("x-ratelimit-reset"))
  if (Number.isFinite(legacyReset) && legacyReset > 0) return Math.max(0, legacyReset * 1000 - now)
  return undefined
}

function requestSignal(external: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error("Registry request timed out")), timeoutMs)
  const abort = () => controller.abort(external?.reason)
  if (external?.aborted) abort()
  else external?.addEventListener("abort", abort, { once: true })

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout)
      external?.removeEventListener("abort", abort)
    },
  }
}

function responseMessage(provider: string, response: Response) {
  return `${provider} request failed with HTTP ${response.status}`
}

async function readLimitedText(
  provider: string,
  response: Response,
  limitBytes: number,
  kind: "JSON" | "text",
) {
  const contentLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(contentLength) && contentLength > limitBytes) {
    throw new RegistryProviderRequestError(
      provider,
      "INVALID_RESPONSE",
      `${provider} returned an oversized ${kind} response`,
      undefined,
      response.status,
    )
  }

  if (!response.body) return ""
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limitBytes) {
        await reader.cancel().catch(() => undefined)
        throw new RegistryProviderRequestError(
          provider,
          "INVALID_RESPONSE",
          `${provider} returned an oversized ${kind} response`,
          undefined,
          response.status,
        )
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

export class RegistryHttpClient {
  private readonly fetchImpl: RegistryFetch
  private readonly timeoutMs: number
  private readonly userAgent: string
  private readonly now: () => number
  private rateLimitedUntil = 0

  constructor(private readonly options: RegistryHttpClientOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT
    this.now = options.now ?? Date.now
  }

  async request(
    url: string | URL,
    init: RequestInit = {},
    externalSignal?: AbortSignal,
    policy: { allowManualRedirect?: boolean } = {},
  ) {
    const now = this.now()
    if (this.rateLimitedUntil > now) {
      throw new RegistryProviderRequestError(
        this.options.provider,
        "RATE_LIMITED",
        `${this.options.provider} is temporarily rate limited`,
        this.rateLimitedUntil - now,
        429,
      )
    }

    const scopedSignal = requestSignal(externalSignal, this.timeoutMs)
    const headers = new Headers(init.headers)
    if (!headers.has("accept")) headers.set("accept", "application/json")
    if (!headers.has("user-agent")) headers.set("user-agent", this.userAgent)

    try {
      const response = await this.fetchImpl(url, {
        ...init,
        redirect: init.redirect ?? "manual",
        headers,
        signal: scopedSignal.signal,
      })

      if (response.status >= 300 && response.status < 400) {
        if (policy.allowManualRedirect) return response
        throw new RegistryProviderRequestError(
          this.options.provider,
          "UPSTREAM_ERROR",
          `${this.options.provider} returned an unexpected redirect`,
          undefined,
          response.status,
        )
      }

      if (response.status === 429) {
        const retryAfterMs = retryAfterMilliseconds(response.headers, this.now())
        if (retryAfterMs !== undefined) this.rateLimitedUntil = this.now() + retryAfterMs
        throw new RegistryProviderRequestError(
          this.options.provider,
          "RATE_LIMITED",
          `${this.options.provider} rate limit exceeded`,
          retryAfterMs,
          429,
        )
      }

      if (!response.ok) {
        const code = response.status === 404 ? "NOT_FOUND" : "UPSTREAM_ERROR"
        throw new RegistryProviderRequestError(
          this.options.provider,
          code,
          responseMessage(this.options.provider, response),
          undefined,
          response.status,
        )
      }

      return response
    } catch (error) {
      if (isRegistryProviderRequestError(error)) throw error
      if (scopedSignal.signal.aborted) {
        const code = externalSignal?.aborted ? "UNAVAILABLE" : "TIMEOUT"
        throw new RegistryProviderRequestError(
          this.options.provider,
          code,
          code === "TIMEOUT" ? `${this.options.provider} request timed out` : `${this.options.provider} request cancelled`,
        )
      }
      throw new RegistryProviderRequestError(
        this.options.provider,
        "UNAVAILABLE",
        `${this.options.provider} request failed`,
      )
    } finally {
      scopedSignal.dispose()
    }
  }

  async json(url: string | URL, init: RequestInit = {}, signal?: AbortSignal): Promise<unknown> {
    const response = await this.request(url, init, signal)
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
    if (!contentType.includes("json")) {
      throw new RegistryProviderRequestError(
        this.options.provider,
        "INVALID_RESPONSE",
        `${this.options.provider} returned a non-JSON response`,
        undefined,
        response.status,
      )
    }

    try {
      return JSON.parse(await readLimitedText(this.options.provider, response, MAX_JSON_BYTES, "JSON"))
    } catch (error) {
      if (isRegistryProviderRequestError(error)) throw error
      throw new RegistryProviderRequestError(
        this.options.provider,
        "INVALID_RESPONSE",
        `${this.options.provider} returned invalid JSON`,
        undefined,
        response.status,
      )
    }
  }

  async text(url: string | URL, init: RequestInit = {}, signal?: AbortSignal) {
    const response = await this.request(url, init, signal)
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
    if (contentType && !contentType.startsWith("text/") && !contentType.includes("markdown")) {
      throw new RegistryProviderRequestError(
        this.options.provider,
        "INVALID_RESPONSE",
        `${this.options.provider} returned a non-text file`,
        undefined,
        response.status,
      )
    }
    try {
      return {
        content: await readLimitedText(this.options.provider, response, MAX_TEXT_BYTES, "text"),
        contentType: contentType.split(";")[0] || undefined,
      }
    } catch (error) {
      if (isRegistryProviderRequestError(error)) throw error
      throw new RegistryProviderRequestError(
        this.options.provider,
        "INVALID_RESPONSE",
        `${this.options.provider} returned unreadable text content`,
        undefined,
        response.status,
      )
    }
  }
}

export function unsupported(provider: string, capability: string): never {
  throw new RegistryProviderRequestError(
    provider,
    "NOT_SUPPORTED",
    `${provider} does not support ${capability}`,
  )
}
