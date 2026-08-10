import { lookup as systemLookup } from "node:dns/promises"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { isIP } from "node:net"
import { Readable } from "node:stream"
import { ApiError } from "#server/error.ts"

type ResolvedAddress = { address: string; family: number }
type Lookup = (hostname: string, options: { all: true; verbatim: true }) => Promise<ResolvedAddress[]>

let lookupHost: Lookup = systemLookup as Lookup

function normalizedHost(value: string) {
  return value.replace(/^\[|\]$/g, "").toLowerCase()
}

function isLoopbackHost(hostname: string) {
  const normalized = normalizedHost(hostname)
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1"
}

function ipv4Octets(address: string) {
  if (isIP(address) !== 4) return undefined
  return address.split(".").map(Number)
}

function mappedIPv4(address: string) {
  const normalized = normalizedHost(address)
  const match = /^(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/i.exec(normalized)
  return match?.[1]
}

export function isBlockedProviderAddress(address: string, allowLoopback = false) {
  const mapped = mappedIPv4(address)
  if (mapped) return isBlockedProviderAddress(mapped, allowLoopback)
  const ipv4 = ipv4Octets(address)
  if (ipv4) {
    const [a, b, c] = ipv4
    if (a === 127) return !allowLoopback
    if (a === 0 || a === 10 || a >= 224) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 198 && (b === 18 || b === 19)) return true
    if (
      (a === 192 && b === 0 && (c === 0 || c === 2))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113)
    ) return true
    return false
  }
  if (isIP(address) !== 6) return true
  const normalized = normalizedHost(address)
  if (normalized === "::1") return !allowLoopback
  if (normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd")) return true
  if (/^fe[89ab]/.test(normalized) || normalized.startsWith("ff") || normalized.startsWith("2001:db8")) return true
  return false
}

export function normalizeProviderBaseURL(value: string) {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new ApiError(400, "PROVIDER_CONFIGURATION_INVALID", "Provider base URL is invalid.")
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ApiError(400, "PROVIDER_CONFIGURATION_INVALID", "Provider base URL cannot contain credentials, query, or fragment data.")
  }
  const loopbackHTTP = url.protocol === "http:" && isLoopbackHost(url.hostname)
  if (url.protocol !== "https:" && !loopbackHTTP) {
    throw new ApiError(400, "PROVIDER_CONFIGURATION_INVALID", "Provider base URL must use HTTPS, except for explicit loopback HTTP.")
  }
  if (url.port === "0") {
    throw new ApiError(400, "PROVIDER_CONFIGURATION_INVALID", "Provider base URL must use a valid TCP port.")
  }
  return url.toString().replace(/\/$/, "")
}

async function resolveSafeTarget(url: URL) {
  const hostname = normalizedHost(url.hostname)
  const allowLoopback = isLoopbackHost(hostname)
  const literalFamily = isIP(hostname)
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await lookupHost(hostname, { all: true, verbatim: true }).catch(() => [])
  if (
    addresses.length === 0
    || addresses.some((entry) => isBlockedProviderAddress(entry.address, allowLoopback))
    || (allowLoopback && addresses.some((entry) => !isBlockedProviderAddress(entry.address) === true))
  ) {
    throw new ApiError(400, "PROVIDER_CONFIGURATION_INVALID", "Provider base URL resolves to a private, link-local, metadata, or unavailable address.")
  }
  return addresses[0]
}

export async function assertSafeProviderURL(input: string) {
  const url = new URL(normalizeProviderBaseURL(input))
  await resolveSafeTarget(url)
  return url
}

async function requestBody(url: URL, init: RequestInit) {
  if (init.body === undefined || init.body === null) {
    return { headers: new Headers(init.headers), body: undefined }
  }
  const request = new Request(url, {
    method: init.method ?? "POST",
    headers: init.headers,
    body: init.body,
  })
  const body = new Uint8Array(await request.arrayBuffer())
  const headers = new Headers(request.headers)
  if (!headers.has("content-length")) headers.set("content-length", String(body.byteLength))
  return { headers, body }
}

async function pinnedFetch(url: URL, init: RequestInit): Promise<Response> {
  const target = await resolveSafeTarget(url)
  const method = (init.method ?? "GET").toUpperCase()
  const prepared = await requestBody(url, init)
  const headers = Object.fromEntries(prepared.headers.entries())
  headers.host = url.host
  return await new Promise<Response>((resolve, reject) => {
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest
    const request = transport({
      protocol: url.protocol,
      hostname: target.address,
      family: target.family,
      port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
      method,
      path: `${url.pathname}${url.search}`,
      headers,
      ...(url.protocol === "https:" ? { servername: normalizedHost(url.hostname) } : {}),
      lookup: (_hostname, _options, callback) => callback(null, target.address, target.family),
    }, (incoming) => {
      const responseHeaders = new Headers()
      for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
        responseHeaders.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1])
      }
      const bodyForbidden = method === "HEAD" || [101, 204, 205, 304].includes(incoming.statusCode ?? 0)
      const stream = bodyForbidden
        ? null
        : Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>
      resolve(new Response(stream, {
        status: incoming.statusCode ?? 502,
        statusText: incoming.statusMessage,
        headers: responseHeaders,
      }))
    })
    const abort = () => request.destroy(init.signal?.reason instanceof Error
      ? init.signal.reason
      : new DOMException("The request was aborted.", "AbortError"))
    if (init.signal?.aborted) abort()
    else init.signal?.addEventListener("abort", abort, { once: true })
    request.once("error", reject)
    request.once("close", () => init.signal?.removeEventListener("abort", abort))
    request.end(prepared.body)
  })
}

export async function sameOriginFetch(url: URL | string, init: RequestInit = {}, maxRedirects = 3): Promise<Response> {
  const initial = new URL(url)
  const trusted = await assertSafeProviderURL(initial.origin)
  let current = initial
  let currentInit = { ...init, redirect: "manual" as const }
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const response = await pinnedFetch(current, currentInit)
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get("location")
    await response.body?.cancel().catch(() => undefined)
    if (!location || redirect === maxRedirects) throw new ApiError(502, "PROVIDER_REDIRECT_REJECTED", "Provider returned an invalid redirect.")
    const next = new URL(location, current)
    if (next.origin !== trusted.origin) throw new ApiError(502, "PROVIDER_REDIRECT_REJECTED", "Provider attempted a cross-origin redirect.")
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && currentInit.method?.toUpperCase() === "POST")) {
      const headers = new Headers(currentInit.headers)
      headers.delete("content-length")
      headers.delete("content-type")
      currentInit = { ...currentInit, method: "GET", headers, body: undefined }
    }
    current = next
  }
  throw new ApiError(502, "PROVIDER_REDIRECT_REJECTED", "Provider returned too many redirects.")
}

export function setProviderNetworkLookupForTest(value: Lookup | undefined) {
  lookupHost = value ?? systemLookup as Lookup
}
