import { createHash, createPublicKey, randomUUID, verify as verifySignature } from "node:crypto"
import { lookup } from "node:dns/promises"
import { cp, lstat, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises"
import { isIP } from "node:net"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"
import type {
  RegistryDownloadDescriptor,
  RegistrySecuritySnapshot,
  RegistrySkillDetail,
} from "@anybox/shared/skill-registry"
import {
  RegistryDownloadDescriptorSchema,
  RegistrySecuritySnapshotSchema,
  RegistrySkillDetailSchema,
} from "@anybox/shared/skill-registry"
import matter from "gray-matter"
import z from "zod"
import { extractRegistryZipArchive } from "#skill/registry/archive.ts"
import {
  findVerifiedManagedRegistryPackageRootByTreeHash,
  getManagedRegistrySkill,
  managedRegistryCacheRoot,
  managedRegistryVersionDirectory,
  ManagedRegistryError,
  registerManagedRegistryVersion,
  type ManagedRegistrySkill,
} from "#skill/registry/managed-store.ts"
import {
  computeClawHubGitHubContentHash,
  computeTencentSkillHubContentHash,
  digestRegistrySkillTree,
  scanRegistrySkillTree,
} from "#skill/registry/scanner.ts"

const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024
const MAX_ICON_BYTES = 256 * 1024
const MAX_HANDOFF_BYTES = 1024 * 1024
const MAX_REDIRECTS = 5
const DEFAULT_TIMEOUT_MS = 20_000
const GITHUB_COMMIT_PATTERN = /^[a-f0-9]{40}$/i
const GITHUB_REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

const GitHubHandoffSchema = z.object({
  sourceRef: z.literal("public-github"),
  repo: z.string().regex(GITHUB_REPO_PATTERN),
  commit: z.string().regex(GITHUB_COMMIT_PATTERN),
  path: z.string(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  archiveUrl: z.string().url(),
}).passthrough()

const SkillHubSignedPayloadSchema = z.object({
  v: z.literal(1),
  issuer: z.literal("skillhub.cn"),
  skill_slug: z.string().min(1),
  skill_version: z.string().min(1),
  content_hash: z.string().regex(/^[a-f0-9]{64}$/i),
  file_count: z.number().int().nonnegative(),
  package_md5: z.string().regex(/^[a-f0-9]{32}$/i),
}).passthrough()

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")

export interface RegistryDownloadNetworkOptions {
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  resolveHost?: (hostname: string) => Promise<Array<{ address: string; family: number }>>
  additionalAllowedHosts?: string[]
  /** Test-only policy hook; production downloads are restricted to HTTPS port 443. */
  additionalAllowedPorts?: number[]
  timeoutMs?: number
  signal?: AbortSignal
}

export interface DownloadManagedRegistrySkillInput {
  detail: RegistrySkillDetail
  descriptor: RegistryDownloadDescriptor
  security?: RegistrySecuritySnapshot
}

export const DownloadManagedRegistrySkillInputSchema = z.object({
  detail: RegistrySkillDetailSchema,
  descriptor: RegistryDownloadDescriptorSchema,
  security: RegistrySecuritySnapshotSchema.optional(),
}).strict()

export class RegistryDownloadError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = "RegistryDownloadError"
  }
}

type DownloadedArchive = {
  descriptor: Exclude<RegistryDownloadDescriptor, { kind: "registry" }>
  bytes: Buffer
  artifactSha256: string
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

function decodeBase64(input: string, expectedBytes: number) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input)) return undefined
  const bytes = Buffer.from(input, "base64")
  return bytes.length === expectedBytes ? bytes : undefined
}

function verifyTencentSkillHubIntegrity(
  descriptor: Extract<RegistryDownloadDescriptor, { kind: "archive" }>,
  archiveBytes: Buffer,
) {
  if (!descriptor.integrity) {
    if (descriptor.provider === "skillhub") {
      throw new RegistryDownloadError(
        "INVALID_SIGNATURE",
        "Tencent SkillHub archive is missing its platform integrity proof.",
      )
    }
    return undefined
  }
  if (
    descriptor.provider !== "skillhub" ||
    descriptor.contentHashAlgorithm !== "skillhub-v1" ||
    !descriptor.contentHash ||
    descriptor.integrity.kind !== "skillhub-ed25519-v1"
  ) {
    throw new RegistryDownloadError("INVALID_SIGNATURE", "Tencent SkillHub integrity proof is inconsistent with the archive descriptor.")
  }

  const rawPublicKey = decodeBase64(descriptor.integrity.publicKeyRawBase64, 32)
  const signature = decodeBase64(descriptor.integrity.signatureBase64, 64)
  if (!rawPublicKey || !signature) {
    throw new RegistryDownloadError("INVALID_SIGNATURE", "Tencent SkillHub returned malformed Ed25519 signature material.")
  }

  let verified = false
  try {
    const publicKey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, rawPublicKey]),
      format: "der",
      type: "spki",
    })
    verified = verifySignature(
      null,
      Buffer.from(descriptor.integrity.payload, "utf8"),
      publicKey,
      signature,
    )
  } catch {
    verified = false
  }
  if (!verified) {
    throw new RegistryDownloadError("INVALID_SIGNATURE", "Tencent SkillHub package signature verification failed.")
  }

  let rawPayload: unknown
  try {
    rawPayload = JSON.parse(descriptor.integrity.payload)
  } catch {
    throw new RegistryDownloadError("INVALID_SIGNATURE", "Tencent SkillHub signed payload is not valid JSON.")
  }
  const parsedPayload = SkillHubSignedPayloadSchema.safeParse(rawPayload)
  if (!parsedPayload.success) {
    throw new RegistryDownloadError("INVALID_SIGNATURE", "Tencent SkillHub signed payload has an invalid schema.")
  }
  const payload = parsedPayload.data
  if (
    payload.skill_slug !== descriptor.remoteId ||
    payload.skill_version !== descriptor.version ||
    payload.content_hash.toLowerCase() !== descriptor.contentHash.toLowerCase()
  ) {
    throw new RegistryDownloadError("INVALID_SIGNATURE", "Tencent SkillHub signature does not identify the requested skill version.")
  }
  const packageMD5 = createHash("md5").update(archiveBytes).digest("hex")
  if (packageMD5 !== payload.package_md5.toLowerCase()) {
    throw new RegistryDownloadError("HASH_MISMATCH", "Tencent SkillHub archive does not match its signed package digest.")
  }
  return payload
}

function normalizeHostname(hostname: string) {
  return hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase()
}

function defaultAllowedHosts(provider: string) {
  const hosts = new Set(["github.com", "api.github.com", "codeload.github.com", "raw.githubusercontent.com"])
  const normalized = provider.toLowerCase()
  if (normalized === "clawhub" || normalized.includes("claw")) {
    hosts.add("clawhub.ai")
    hosts.add("www.clawhub.ai")
  }
  if (normalized === "skillhub" || normalized.includes("skillhub")) {
    hosts.add("api.skillhub.cn")
    hosts.add("api.skillhub.tencent.com")
    hosts.add("cloudcache.tencent-cloud.com")
    hosts.add("skillhub-1388575217.cos.accelerate.myqcloud.com")
  }
  return hosts
}

function parseIPv4(address: string) {
  const parts = address.split(".")
  if (parts.length !== 4) return undefined
  const values = parts.map((part) => Number(part))
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return undefined
  return values as [number, number, number, number]
}

function isPrivateIPv4(address: string) {
  const parsed = parseIPv4(address)
  if (!parsed) return true
  const [a, b, c] = parsed
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  )
}

function parseIPv6Groups(input: string) {
  const address = input.toLowerCase().split("%", 1)[0]!
  const halves = address.split("::")
  if (halves.length > 2) return undefined
  const parseSide = (value: string) => {
    if (!value) return [] as number[]
    const raw = value.split(":")
    const groups: number[] = []
    for (const part of raw) {
      if (part.includes(".")) {
        const ipv4 = parseIPv4(part)
        if (!ipv4) return undefined
        groups.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3])
        continue
      }
      if (!/^[a-f0-9]{1,4}$/.test(part)) return undefined
      groups.push(Number.parseInt(part, 16))
    }
    return groups
  }
  const left = parseSide(halves[0]!)
  const right = parseSide(halves[1] ?? "")
  if (!left || !right) return undefined
  if (halves.length === 1) return left.length === 8 ? left : undefined
  const missing = 8 - left.length - right.length
  if (missing < 1) return undefined
  return [...left, ...new Array<number>(missing).fill(0), ...right]
}

function isPrivateIPv6(address: string) {
  const groups = parseIPv6Groups(address)
  if (!groups) return true
  if (groups.every((value) => value === 0)) return true
  if (groups.slice(0, 7).every((value) => value === 0) && groups[7] === 1) return true
  if ((groups[0]! & 0xfe00) === 0xfc00) return true
  if ((groups[0]! & 0xffc0) === 0xfe80) return true
  if ((groups[0]! & 0xffc0) === 0xfec0) return true
  if ((groups[0]! & 0xff00) === 0xff00) return true
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true

  const mapped = groups.slice(0, 5).every((value) => value === 0) && groups[5] === 0xffff
  const compatible = groups.slice(0, 6).every((value) => value === 0)
  if (mapped || compatible) {
    const embedded = `${groups[6]! >>> 8}.${groups[6]! & 0xff}.${groups[7]! >>> 8}.${groups[7]! & 0xff}`
    return isPrivateIPv4(embedded)
  }
  return false
}

export function isPrivateRegistryAddress(address: string) {
  const family = isIP(normalizeHostname(address))
  if (family === 4) return isPrivateIPv4(address)
  if (family === 6) return isPrivateIPv6(address)
  return true
}

async function defaultResolveHost(hostname: string) {
  return await lookup(hostname, { all: true, verbatim: true })
}

async function resolveRegistryHost(hostname: string, options: RegistryDownloadNetworkOptions) {
  if (options.signal?.aborted) {
    throw new RegistryDownloadError("CANCELLED", "Registry skill download was cancelled during DNS resolution.")
  }
  const resolveHost = options.resolveHost ?? defaultResolveHost
  return await new Promise<Array<{ address: string; family: number }>>((resolvePromise, rejectPromise) => {
    let settled = false
    const finish = (
      callback: typeof resolvePromise | typeof rejectPromise,
      value: Array<{ address: string; family: number }> | RegistryDownloadError | unknown,
    ) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", cancel)
      callback(value as never)
    }
    const cancel = () => finish(
      rejectPromise,
      new RegistryDownloadError("CANCELLED", "Registry skill download was cancelled during DNS resolution."),
    )
    const timer = setTimeout(() => finish(
      rejectPromise,
      new RegistryDownloadError("TIMEOUT", "Registry skill DNS resolution timed out."),
    ), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    options.signal?.addEventListener("abort", cancel, { once: true })
    resolveHost(hostname).then(
      (addresses) => finish(resolvePromise, addresses),
      (error) => finish(rejectPromise, error),
    )
  })
}

export async function assertSafeRegistryDownloadURL(
  rawURL: string,
  provider: string,
  options: RegistryDownloadNetworkOptions = {},
) {
  let url: URL
  try {
    url = new URL(rawURL)
  } catch {
    throw new RegistryDownloadError("UNSAFE_URL", "Registry skill download URL is invalid.")
  }
  if (url.protocol !== "https:") {
    throw new RegistryDownloadError("UNSAFE_URL", "Registry skills must be downloaded over HTTPS.")
  }
  if (url.username || url.password) {
    throw new RegistryDownloadError("UNSAFE_URL", "Registry skill download URLs must not contain credentials.")
  }
  const port = url.port ? Number.parseInt(url.port, 10) : 443
  const allowedAdditionalPorts = new Set(
    (options.additionalAllowedPorts ?? []).filter((value) => Number.isInteger(value) && value >= 1 && value <= 65_535),
  )
  if (port !== 443 && !allowedAdditionalPorts.has(port)) {
    throw new RegistryDownloadError("UNSAFE_PORT", "Registry skills must be downloaded over the default HTTPS port.")
  }

  const hostname = normalizeHostname(url.hostname)
  const allowed = defaultAllowedHosts(provider)
  for (const host of options.additionalAllowedHosts ?? []) allowed.add(normalizeHostname(host))
  if (!allowed.has(hostname)) {
    throw new RegistryDownloadError("UNSAFE_HOST", `Registry skill download host '${hostname}' is not allowed.`)
  }

  const literalFamily = isIP(hostname)
  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = literalFamily
      ? [{ address: hostname, family: literalFamily }]
      : await resolveRegistryHost(hostname, options)
  } catch (error) {
    if (error instanceof RegistryDownloadError) throw error
    throw new RegistryDownloadError("DNS_FAILED", `Registry skill download host '${hostname}' could not be resolved.`)
  }
  if (addresses.length === 0 || addresses.some((entry) => isPrivateRegistryAddress(entry.address))) {
    throw new RegistryDownloadError("PRIVATE_ADDRESS", "Registry skill downloads must resolve only to globally routable network addresses.")
  }
  return url
}

function timeoutSignal(options: RegistryDownloadNetworkOptions) {
  const controller = new AbortController()
  let cause: "timeout" | "external" | undefined
  const timeout = setTimeout(() => {
    if (cause) return
    cause = "timeout"
    controller.abort()
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const abort = () => {
    if (cause) return
    cause = "external"
    controller.abort(options.signal?.reason)
  }
  if (options.signal?.aborted) abort()
  else options.signal?.addEventListener("abort", abort, { once: true })
  return {
    signal: controller.signal,
    get cause() {
      return cause
    },
    dispose() {
      clearTimeout(timeout)
      options.signal?.removeEventListener("abort", abort)
    },
  }
}

function parseRetryAfterMs(value: string | null) {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  const seconds = Number(trimmed)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000)
  const timestamp = Date.parse(trimmed)
  if (!Number.isFinite(timestamp)) return undefined
  return Math.max(0, timestamp - Date.now())
}

async function readLimitedBody(response: Response, limit: number) {
  const declared = Number(response.headers.get("content-length") ?? "0")
  if (Number.isFinite(declared) && declared > limit) {
    throw new RegistryDownloadError("DOWNLOAD_TOO_LARGE", "Registry skill download is larger than the allowed size.")
  }
  if (!response.body) return Buffer.alloc(0)

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    total += result.value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => undefined)
      throw new RegistryDownloadError("DOWNLOAD_TOO_LARGE", "Registry skill download is larger than the allowed size.")
    }
    chunks.push(result.value)
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total)
}

async function fetchDownload(
  rawURL: string,
  provider: string,
  limit: number,
  options: RegistryDownloadNetworkOptions,
  accept = "application/zip, application/json;q=0.9, application/octet-stream;q=0.8",
) {
  if (options.signal?.aborted) {
    throw new RegistryDownloadError("CANCELLED", "Registry skill download was cancelled.")
  }
  let url = await assertSafeRegistryDownloadURL(rawURL, provider, options)
  const fetchImpl = options.fetchImpl ?? fetch
  const timeout = timeoutSignal(options)

  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        headers: {
          accept,
          "user-agent": "Anybox-Skill-Registry/1",
        },
        signal: timeout.signal,
      })

      if (response.status >= 300 && response.status < 400) {
        if (redirects === MAX_REDIRECTS) {
          throw new RegistryDownloadError("TOO_MANY_REDIRECTS", "Registry skill download redirected too many times.")
        }
        const location = response.headers.get("location")
        if (!location) throw new RegistryDownloadError("INVALID_REDIRECT", "Registry skill download returned an empty redirect.")
        url = await assertSafeRegistryDownloadURL(new URL(location, url).toString(), provider, options)
        continue
      }
      if (!response.ok) {
        const retryAfterMs = response.status === 429 ? parseRetryAfterMs(response.headers.get("retry-after")) : undefined
        throw new RegistryDownloadError(
          response.status === 429 ? "RATE_LIMITED" : "DOWNLOAD_FAILED",
          `Registry skill download returned HTTP ${response.status}.`,
          retryAfterMs,
        )
      }

      return {
        bytes: await readLimitedBody(response, limit),
        contentType: response.headers.get("content-type")?.toLowerCase() ?? "",
        url: url.toString(),
      }
    }
    throw new RegistryDownloadError("TOO_MANY_REDIRECTS", "Registry skill download redirected too many times.")
  } catch (error) {
    if (error instanceof RegistryDownloadError) throw error
    if (timeout.cause === "timeout") {
      throw new RegistryDownloadError("TIMEOUT", "Registry skill download timed out.")
    }
    if (timeout.cause === "external" || options.signal?.aborted) {
      throw new RegistryDownloadError("CANCELLED", "Registry skill download was cancelled.")
    }
    throw new RegistryDownloadError(
      "DOWNLOAD_FAILED",
      error instanceof Error ? `Registry skill download failed: ${error.message}` : "Registry skill download failed.",
    )
  } finally {
    timeout.dispose()
  }
}

function registryIconMime(bytes: Buffer) {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png"
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg"
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp"
  }
  return undefined
}

async function cacheRegistrySkillIcon(
  detail: RegistrySkillDetail,
  options: RegistryDownloadNetworkOptions,
) {
  if (!detail.iconUrl) return undefined
  try {
    const iconOptions = {
      ...options,
      timeoutMs: Math.min(options.timeoutMs ?? 5_000, 5_000),
    }
    const result = await fetchDownload(
      detail.iconUrl,
      detail.provider,
      MAX_ICON_BYTES,
      iconOptions,
      "image/png, image/jpeg, image/webp",
    )
    const mime = registryIconMime(result.bytes)
    if (!mime) return undefined
    const declaredMime = result.contentType.split(";", 1)[0]?.trim()
    if (declaredMime && declaredMime !== "application/octet-stream" && declaredMime !== mime) return undefined
    return `data:${mime};base64,${result.bytes.toString("base64")}`
  } catch (error) {
    if (error instanceof RegistryDownloadError && error.code === "CANCELLED") throw error
    // The icon is presentation metadata. A missing, oversized, or unsafe icon
    // must never make an otherwise verified Skill download fail.
    return undefined
  }
}

function assertHash(expected: string | undefined, actual: string) {
  if (expected && expected.toLowerCase() !== actual.toLowerCase()) {
    throw new RegistryDownloadError("HASH_MISMATCH", "Registry skill archive checksum does not match the registry metadata.")
  }
}

function isZip(bytes: Buffer, contentType: string) {
  return contentType.includes("zip") || (bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50)
}

function validateGitHubDescriptor(descriptor: Extract<RegistryDownloadDescriptor, { kind: "github" }>) {
  if (!GITHUB_REPO_PATTERN.test(descriptor.repo) || !GITHUB_COMMIT_PATTERN.test(descriptor.commit)) {
    throw new RegistryDownloadError("INVALID_GITHUB_HANDOFF", "Registry GitHub handoff is not pinned to a valid repository commit.")
  }
  if (!/^[a-f0-9]{64}$/i.test(descriptor.contentHash)) {
    throw new RegistryDownloadError("INVALID_GITHUB_HANDOFF", "Registry GitHub handoff is missing a valid content hash.")
  }

  const archiveURL = new URL(descriptor.archiveUrl)
  const path = decodeURIComponent(archiveURL.pathname).replace(/\/+$/, "")
  const [owner, repo] = descriptor.repo.split("/") as [string, string]
  const expectedAPIPath = `/repos/${owner}/${repo}/zipball/${descriptor.commit}`.toLowerCase()
  const expectedCodeloadPath = `/${owner}/${repo}/zip/${descriptor.commit}`.toLowerCase()
  if (
    (archiveURL.hostname.toLowerCase() === "api.github.com" && path.toLowerCase() !== expectedAPIPath) ||
    (archiveURL.hostname.toLowerCase() === "codeload.github.com" && path.toLowerCase() !== expectedCodeloadPath) ||
    !["api.github.com", "codeload.github.com"].includes(archiveURL.hostname.toLowerCase())
  ) {
    throw new RegistryDownloadError("INVALID_GITHUB_HANDOFF", "Registry GitHub archive URL does not match its pinned repository commit.")
  }
}

async function resolveArchive(
  descriptor: RegistryDownloadDescriptor,
  security: RegistrySecuritySnapshot | undefined,
  options: RegistryDownloadNetworkOptions,
): Promise<DownloadedArchive> {
  if (descriptor.kind === "github") {
    validateGitHubDescriptor(descriptor)
    const result = await fetchDownload(descriptor.archiveUrl, descriptor.provider, MAX_ARCHIVE_BYTES, options)
    if (!isZip(result.bytes, result.contentType)) {
      throw new RegistryDownloadError("INVALID_ARCHIVE", "Registry GitHub handoff did not return a ZIP archive.")
    }
    const artifactSha256 = sha256(result.bytes)
    assertHash(security?.artifactSha256, artifactSha256)
    return { descriptor, bytes: result.bytes, artifactSha256 }
  }

  const url = descriptor.url
  const result = await fetchDownload(url, descriptor.provider, MAX_ARCHIVE_BYTES, options)
  const artifactSha256 = sha256(result.bytes)
  const expected = descriptor.kind === "archive"
    ? descriptor.sha256 ?? security?.artifactSha256
    : descriptor.expectedSha256 ?? security?.artifactSha256

  if (isZip(result.bytes, result.contentType)) {
    assertHash(descriptor.kind === "archive" ? descriptor.sha256 : descriptor.expectedSha256, artifactSha256)
    assertHash(security?.artifactSha256, artifactSha256)
    return {
      descriptor: descriptor.kind === "archive" ? descriptor : {
        kind: "archive",
        provider: descriptor.provider,
        remoteId: descriptor.remoteId,
        version: descriptor.version,
        url: result.url,
        sha256: expected,
        contentType: result.contentType,
      },
      bytes: result.bytes,
      artifactSha256,
    }
  }
  if (descriptor.kind !== "registry") {
    throw new RegistryDownloadError("INVALID_ARCHIVE", "Registry skill download did not return a ZIP archive.")
  }
  if (result.bytes.length > MAX_HANDOFF_BYTES || !result.contentType.includes("json")) {
    throw new RegistryDownloadError("INVALID_HANDOFF", "Registry skill download returned an unsupported response.")
  }

  let payload: unknown
  try {
    payload = JSON.parse(result.bytes.toString("utf8"))
  } catch {
    throw new RegistryDownloadError("INVALID_HANDOFF", "Registry skill download returned invalid handoff JSON.")
  }
  const handoff = GitHubHandoffSchema.safeParse(payload)
  if (!handoff.success) {
    throw new RegistryDownloadError("INVALID_HANDOFF", "Registry skill download returned an invalid GitHub handoff.")
  }
  const githubDescriptor: Extract<RegistryDownloadDescriptor, { kind: "github" }> = {
    kind: "github",
    provider: descriptor.provider,
    remoteId: descriptor.remoteId,
    version: descriptor.version,
    repo: handoff.data.repo,
    commit: handoff.data.commit,
    path: handoff.data.path,
    contentHash: handoff.data.contentHash,
    archiveUrl: handoff.data.archiveUrl,
  }
  return resolveArchive(githubDescriptor, security, options)
}

function safeGitHubSubpath(input: string) {
  const normalized = input.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+|\/+$/g, "")
  if (!normalized || normalized === ".") return ""
  const segments = normalized.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new RegistryDownloadError("INVALID_GITHUB_HANDOFF", "Registry GitHub handoff contains an unsafe skill path.")
  }
  return segments.join("/")
}

async function hasSkillDocument(directory: string) {
  const info = await stat(join(directory, "SKILL.md")).catch(() => undefined)
  return Boolean(info?.isFile())
}

async function packageRootForGitHub(extractRoot: string, path: string) {
  const subpath = safeGitHubSubpath(path)
  const candidates = [resolve(extractRoot, subpath)]
  const topLevel = await readdir(extractRoot, { withFileTypes: true })
  for (const entry of topLevel) {
    if (entry.isDirectory()) candidates.push(resolve(extractRoot, entry.name, subpath))
  }

  const matches: string[] = []
  for (const candidate of candidates) {
    const relativePath = relative(extractRoot, candidate)
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) continue
    if (await hasSkillDocument(candidate)) matches.push(candidate)
  }
  if (matches.length !== 1) {
    throw new RegistryDownloadError("INVALID_PACKAGE", "Registry GitHub archive does not contain exactly one skill at its declared path.")
  }
  return matches[0]!
}

async function discoverPackageRoots(root: string, depth = 0): Promise<string[]> {
  if (await hasSkillDocument(root)) return [root]
  if (depth >= 5) return []
  const entries = await readdir(root, { withFileTypes: true })
  const matches = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => discoverPackageRoots(join(root, entry.name), depth + 1)))
  return matches.flat()
}

async function packageRootForArchive(extractRoot: string) {
  const roots = await discoverPackageRoots(extractRoot)
  if (roots.length !== 1) {
    throw new RegistryDownloadError("INVALID_PACKAGE", "Registry archive must contain exactly one SKILL.md package.")
  }
  return roots[0]!
}

async function validateSkillDocument(packageRoot: string) {
  const skillPath = join(packageRoot, "SKILL.md")
  const raw = await readFile(skillPath, "utf8").catch(() => {
    throw new RegistryDownloadError("INVALID_PACKAGE", "Registry skill package is missing SKILL.md.")
  })
  if (Buffer.byteLength(raw, "utf8") > 1024 * 1024) {
    throw new RegistryDownloadError("INVALID_PACKAGE", "Registry skill SKILL.md is larger than the allowed size.")
  }

  try {
    if (!/^---[\t ]*(?:\r?\n)/.test(raw)) throw new Error("missing frontmatter")
    const parsed = matter(raw)
    if (!parsed.content.trim()) throw new Error("empty body")
    if (!parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) throw new Error("invalid frontmatter")
    const name = parsed.data.name
    const description = parsed.data.description
    if (typeof name !== "string" || !name.trim() || name.trim().length > 128) throw new Error("invalid name")
    if (typeof description !== "string" || !description.trim() || description.trim().length > 2_000) {
      throw new Error("invalid description")
    }
  } catch {
    throw new RegistryDownloadError(
      "INVALID_PACKAGE",
      "Registry skill SKILL.md must have non-empty name and description frontmatter and a non-empty body.",
    )
  }
}

async function copyPackageAtomically(packageRoot: string, finalRoot: string, treeHash: string) {
  const parent = dirname(finalRoot)
  const staging = join(parent, `.${basename(finalRoot)}.stage-${randomUUID()}`)
  await mkdir(parent, { recursive: true })
  const existing = await stat(finalRoot).catch(() => undefined)
  if (existing) {
    if (!existing.isDirectory()) {
      throw new RegistryDownloadError("PACKAGE_CONFLICT", "Managed registry skill version path is not a directory.")
    }
    const existingDigest = await digestRegistrySkillTree(finalRoot)
    if (existingDigest.treeHash !== treeHash) {
      throw new RegistryDownloadError("VERSION_IMMUTABILITY_VIOLATION", "This registry skill version already exists with different content.")
    }
    return false
  }

  try {
    await cp(packageRoot, staging, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true })
    await rename(staging, finalRoot)
    return true
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function downloadManagedRegistrySkill(
  input: DownloadManagedRegistrySkillInput,
  networkOptions: RegistryDownloadNetworkOptions = {},
): Promise<ManagedRegistrySkill> {
  const parsedInput = DownloadManagedRegistrySkillInputSchema.parse(input)
  const { detail, descriptor } = parsedInput
  if (detail.provider !== descriptor.provider || detail.remoteId !== descriptor.remoteId) {
    throw new RegistryDownloadError("IDENTITY_MISMATCH", "Registry detail and download descriptor identify different skills.")
  }
  if (descriptor.provider === "skillhub" && (descriptor.kind !== "archive" || !descriptor.integrity)) {
    throw new RegistryDownloadError(
      "INVALID_SIGNATURE",
      "Tencent SkillHub downloads require a signed platform integrity proof.",
    )
  }
  const security = parsedInput.security ?? detail.security
  if (
    security &&
    (security.provider !== descriptor.provider ||
      security.remoteId !== descriptor.remoteId ||
      (security.version !== undefined && security.version !== descriptor.version))
  ) {
    throw new RegistryDownloadError("IDENTITY_MISMATCH", "Security snapshot identifies a different registry skill version.")
  }
  if (security?.blocked || security?.status === "malicious") {
    throw new RegistryDownloadError("UPSTREAM_BLOCKED", "The upstream registry has blocked this skill version.")
  }

  const tempRoot = join(managedRegistryCacheRoot(), `download-${randomUUID()}`)
  const extractRoot = join(tempRoot, "extract")
  await mkdir(extractRoot, { recursive: true })
  let createdFinalRoot = false
  let finalRoot = ""

  try {
    const archive = await resolveArchive(descriptor, security, networkOptions)
    const skillHubSignedPayload = archive.descriptor.kind === "archive"
      ? verifyTencentSkillHubIntegrity(archive.descriptor, archive.bytes)
      : undefined
    await extractRegistryZipArchive(archive.bytes, extractRoot)
    const packageRoot = archive.descriptor.kind === "github"
      ? await packageRootForGitHub(extractRoot, archive.descriptor.path)
      : await packageRootForArchive(extractRoot)
    await validateSkillDocument(packageRoot)

    if (archive.descriptor.kind === "github") {
      const actualContentHash = await computeClawHubGitHubContentHash(packageRoot)
      if (actualContentHash.toLowerCase() !== archive.descriptor.contentHash.toLowerCase()) {
        throw new RegistryDownloadError("HASH_MISMATCH", "Registry GitHub skill content does not match its pinned content hash.")
      }
    }
    if (
      archive.descriptor.kind === "archive" &&
      archive.descriptor.contentHashAlgorithm === "skillhub-v1" &&
      archive.descriptor.contentHash
    ) {
      const actual = await computeTencentSkillHubContentHash(packageRoot)
      if (actual.contentHash.toLowerCase() !== archive.descriptor.contentHash.toLowerCase()) {
        throw new RegistryDownloadError(
          "HASH_MISMATCH",
          "Tencent SkillHub package content does not match its signed content hash.",
        )
      }
      if (skillHubSignedPayload && actual.fileCount !== skillHubSignedPayload.file_count) {
        throw new RegistryDownloadError(
          "HASH_MISMATCH",
          "Tencent SkillHub package file count does not match its signed manifest.",
        )
      }
    }

    const digest = await digestRegistrySkillTree(packageRoot)
    const localScan = await scanRegistrySkillTree(packageRoot)
    const cachedIconUrl = await cacheRegistrySkillIcon(detail, networkOptions)
    finalRoot = managedRegistryVersionDirectory({
      provider: detail.provider,
      remoteId: detail.remoteId,
      slug: detail.slug,
      version: descriptor.version,
    })
    const reusedPackageRoot = await findVerifiedManagedRegistryPackageRootByTreeHash(digest.treeHash)
    let storedPackageRoot = reusedPackageRoot ?? finalRoot
    if (!reusedPackageRoot) {
      createdFinalRoot = await copyPackageAtomically(packageRoot, finalRoot, digest.treeHash)
    }

    const registration = {
      detail,
      descriptor: archive.descriptor,
      artifactSha256: archive.artifactSha256,
      treeHash: digest.treeHash,
      localScan,
      security,
      cachedIconUrl,
      integrityVerified: Boolean(skillHubSignedPayload),
    }
    try {
      return await registerManagedRegistryVersion({ ...registration, packageRoot: storedPackageRoot })
    } catch (error) {
      // A shared package may have lost its last prior reference between lookup and
      // registration. Registration verifies the tree while holding the store
      // mutation lock, so falling back here cannot persist a dangling reference.
      if (!(reusedPackageRoot && error instanceof ManagedRegistryError && error.code === "PACKAGE_TAMPERED")) {
        throw error
      }
      createdFinalRoot = await copyPackageAtomically(packageRoot, finalRoot, digest.treeHash)
      storedPackageRoot = finalRoot
      return await registerManagedRegistryVersion({ ...registration, packageRoot: storedPackageRoot })
    }
  } catch (error) {
    if (createdFinalRoot && finalRoot) {
      await rm(finalRoot, { recursive: true, force: true }).catch(() => undefined)
    }
    throw error
  } finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function updateManagedRegistrySkill(
  id: string,
  input: DownloadManagedRegistrySkillInput,
  networkOptions: RegistryDownloadNetworkOptions = {},
) {
  const existing = await getManagedRegistrySkill(id)
  if (!existing) throw new RegistryDownloadError("NOT_FOUND", `Managed registry skill '${id}' was not found.`)
  if (existing.provider !== input.descriptor.provider || existing.remoteId !== input.descriptor.remoteId) {
    throw new RegistryDownloadError("IDENTITY_MISMATCH", "Update descriptor identifies a different registry skill.")
  }
  return downloadManagedRegistrySkill(input, networkOptions)
}
