import { createHash, createPublicKey, verify as verifySignature } from "node:crypto"
import { basename, extname } from "node:path"
import { z } from "zod"
import {
  RegistryDownloadDescriptorSchema,
  RegistryFileContentSchema,
  RegistryFileRefSchema,
  RegistryFileSchema,
  RegistryProviderDescriptorSchema,
  RegistrySecuritySnapshotSchema,
  RegistrySkillDetailSchema,
  RegistrySkillSummarySchema,
  RegistryVersionSchema,
} from "@anybox/shared/skill-registry"
import type {
  RegistryCapabilities,
  RegistryDownloadDescriptor,
  RegistryFile,
  RegistryFileContent,
  RegistryFileRef,
  RegistryProviderDescriptor,
  RegistryProviderError,
  RegistrySecuritySignal,
  RegistrySecuritySnapshot,
  RegistrySecurityStatus,
  RegistrySkillDetail,
  RegistrySkillRef,
  RegistrySkillSummary,
  RegistryVersion,
  RegistryVersionRef,
} from "@anybox/shared/skill-registry"
import { RegistryHttpClient, RegistryProviderRequestError, unsupported } from "./provider.ts"
import { clearLegacySkillHubStateOnce } from "./skillhub-migration.ts"
import type {
  RegistryFetch,
  RegistryProviderSearchInput,
  RegistryProviderSearchPage,
  SkillRegistryProvider,
} from "./types.ts"

const SKILLHUB_ID = "skillhub"
const DEFAULT_BASE_URL = "https://api.skillhub.cn"
const DEFAULT_SITE_URL = "https://skillhub.cn"
const SKILLHUB_COS_HOST = "skillhub-1388575217.cos.accelerate.myqcloud.com"
const MAX_FILE_BYTES = 1024 * 1024

const NonEmptyStringSchema = z.string().trim().min(1)
const TimestampSchema = z.number().int().nonnegative()
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i)
const HttpsUrlSchema = z.string().url().refine((value) => {
  const url = new URL(value)
  return url.protocol === "https:" && !url.username && !url.password
})
const SkillHubSlugSchema = NonEmptyStringSchema.max(200).refine(
  (value) => !/[\\/?#\u0000-\u001f\u007f]/.test(value),
  "SkillHub slug contains an unsafe character",
)

const RawSubCategorySchema = z.object({
  key: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
})

const RawTagsSchema = z.union([
  z.array(NonEmptyStringSchema),
  z.record(z.string(), NonEmptyStringSchema),
]).nullish()

const RawLabelsSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
).nullish()

const RawSearchSkillSchema = z.object({
  category: NonEmptyStringSchema.nullish(),
  created_at: TimestampSchema.nullish(),
  description: z.string().nullish(),
  description_zh: z.string().nullish(),
  downloads: z.number().nonnegative().nullish(),
  iconUrl: z.string().nullish(),
  installs: z.number().nonnegative().nullish(),
  labels: RawLabelsSchema,
  name: NonEmptyStringSchema,
  ownerName: NonEmptyStringSchema,
  score: z.number().nullish(),
  slug: SkillHubSlugSchema,
  source: NonEmptyStringSchema.nullish(),
  stars: z.number().nonnegative().nullish(),
  subCategories: z.array(RawSubCategorySchema).nullish(),
  tags: RawTagsSchema,
  updated_at: TimestampSchema.nullish(),
  upstream_url: z.string().nullish(),
  verified: z.boolean().nullish(),
  version: NonEmptyStringSchema,
})

const RawSearchResponseSchema = z.object({
  code: z.literal(0),
  data: z.object({
    skills: z.array(z.unknown()),
    total: z.number().int().nonnegative(),
  }),
  message: z.string(),
})

const RawSecurityReportSchema = z.object({
  reportUrl: HttpsUrlSchema.nullish(),
  status: NonEmptyStringSchema,
  statusText: z.string().nullish(),
})

const RawSecurityReportsSchema = z.object({
  keen: z.unknown().nullish(),
  sanbu: z.unknown().nullish(),
})

const RawLatestVersionSchema = z.object({
  changelog: z.string().nullish(),
  createdAt: TimestampSchema,
  version: NonEmptyStringSchema,
})

const RawDetailSkillSchema = z.object({
  category: NonEmptyStringSchema.nullish(),
  createdAt: TimestampSchema,
  displayName: NonEmptyStringSchema,
  iconUrl: z.string().nullish(),
  isAuthorVerified: z.boolean().nullish(),
  labels: RawLabelsSchema,
  slug: SkillHubSlugSchema,
  source: NonEmptyStringSchema.nullish(),
  sourceUrl: z.string().nullish(),
  stats: z.object({
    comments: z.number().nonnegative().nullish(),
    downloads: z.number().nonnegative().nullish(),
    installs: z.number().nonnegative().nullish(),
    stars: z.number().nonnegative().nullish(),
    versions: z.number().nonnegative().nullish(),
  }),
  subCategories: z.array(RawSubCategorySchema).nullish(),
  summary: z.string(),
  summary_zh: z.string().nullish(),
  tags: RawTagsSchema,
  updatedAt: TimestampSchema,
  upstream_url: z.string().nullish(),
  verified: z.boolean().nullish(),
})

const RawDetailResponseSchema = z.object({
  contentZhAvailable: z.boolean(),
  latestVersion: RawLatestVersionSchema.nullish(),
  owner: z.object({
    displayName: z.string().nullish(),
    handle: NonEmptyStringSchema,
    image: z.string().nullish(),
  }),
  securityReports: RawSecurityReportsSchema,
  skill: RawDetailSkillSchema,
})

const RawVersionSchema = z.object({
  changelog: z.string().nullish(),
  createdAt: TimestampSchema,
  securityReports: RawSecurityReportsSchema,
  version: NonEmptyStringSchema,
  versionId: z.number().int().positive().nullish(),
})

const RawVersionsResponseSchema = z.object({
  slug: SkillHubSlugSchema,
  source: NonEmptyStringSchema.nullish(),
  versions: z.array(z.unknown()),
})

const RawFileSchema = z.object({
  path: z.string(),
  sha256: Sha256Schema,
  size: z.number().int().nonnegative(),
})

const RawFilesResponseSchema = z.object({
  count: z.number().int().nonnegative(),
  files: z.array(z.unknown()),
  version: NonEmptyStringSchema,
})

const RawSignatureSchema = z.object({
  content_hash: Sha256Schema.nullish(),
  hash_version: z.literal(1).nullish(),
  key_id: NonEmptyStringSchema.nullish(),
  payload: z.string().nullish(),
  signature: NonEmptyStringSchema.nullish(),
  signed: z.boolean(),
  signed_at: TimestampSchema.nullish(),
}).superRefine((value, context) => {
  if (!value.signed) return
  for (const [field, fieldValue] of [
    ["content_hash", value.content_hash],
    ["hash_version", value.hash_version],
    ["key_id", value.key_id],
    ["payload", value.payload],
    ["signature", value.signature],
    ["signed_at", value.signed_at],
  ] as const) {
    if (!fieldValue) context.addIssue({ code: "custom", path: [field], message: `Signed response is missing ${field}` })
  }
})

const RawSignaturePayloadSchema = z.object({
  content_hash: Sha256Schema,
  file_count: z.number().int().nonnegative(),
  issued_at: TimestampSchema,
  issuer: z.literal("skillhub.cn"),
  package_md5: z.string().regex(/^[a-f0-9]{32}$/i),
  skill_slug: SkillHubSlugSchema,
  skill_version: NonEmptyStringSchema,
  v: z.literal(1),
})

const RawPlatformKeySchema = z.object({
  algorithm: z.literal("Ed25519"),
  issuer: z.literal("skillhub.cn"),
  key_id: NonEmptyStringSchema,
  public_key_raw_b64: NonEmptyStringSchema,
  status: z.enum(["active", "retired"]),
})

const RawPlatformKeysResponseSchema = z.object({
  keys: z.array(RawPlatformKeySchema),
})

type RawSecurityReports = z.infer<typeof RawSecurityReportsSchema>
type RawSignature = z.infer<typeof RawSignatureSchema>
type VerifiedSignature = RawSignature & {
  verified: boolean
  packageMd5?: string
  fileCount?: number
  publicKeyRawBase64?: string
}

function normalizedBaseUrl(input: string) {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new RegistryProviderRequestError(SKILLHUB_ID, "INVALID_REQUEST", "SkillHub API URL must be a valid HTTPS origin")
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new RegistryProviderRequestError(
      SKILLHUB_ID,
      "INVALID_REQUEST",
      "SkillHub API URL must be an HTTPS origin without credentials, path, query, or fragment",
    )
  }
  return url.origin
}

function skillSlug(remoteId: string) {
  const parsed = SkillHubSlugSchema.safeParse(remoteId)
  if (!parsed.success) {
    throw new RegistryProviderRequestError(SKILLHUB_ID, "INVALID_REQUEST", "SkillHub skill ID is not a valid slug")
  }
  return parsed.data
}

function optionalHttpsUrl(input: string | null | undefined) {
  const parsed = HttpsUrlSchema.safeParse(input)
  return parsed.success ? parsed.data : undefined
}

function requiresApiKey(labels: z.infer<typeof RawLabelsSchema>) {
  const value = labels?.requires_api_key
  if (typeof value === "boolean") return value
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === "true") return true
  if (normalized === "false") return false
  return undefined
}

function githubRepository(input: string | null | undefined) {
  const safe = optionalHttpsUrl(input)
  if (!safe) return undefined
  const url = new URL(safe)
  if (!new Set(["github.com", "www.github.com"]).has(url.hostname.toLowerCase())) return undefined
  const segments = url.pathname.split("/").filter(Boolean)
  if (segments.length < 2) return undefined
  const owner = segments[0]!
  const repository = segments[1]!.replace(/\.git$/i, "")
  if (!owner || !repository) return undefined
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`
}

function tagValues(tags: z.infer<typeof RawTagsSchema>) {
  return Array.isArray(tags) ? tags : []
}

function topics(
  category: string | null | undefined,
  subCategories: Array<z.infer<typeof RawSubCategorySchema>> | null | undefined,
  tags: z.infer<typeof RawTagsSchema>,
) {
  return [...new Set([
    ...(category ? [category] : []),
    ...(subCategories ?? []).flatMap((entry) => [entry.key, entry.name]),
    ...tagValues(tags),
  ])]
}

function normalizeSecurityStatus(input: string): RegistrySecurityStatus {
  const value = input.trim().toLowerCase().replace(/[\s_-]+/g, "")
  if (["benign", "clean", "safe", "pass", "passed", "norisk"].includes(value)) return "clean"
  if (["suspicious", "warning", "warn", "risk", "review"].includes(value)) return "suspicious"
  if (["malicious", "blocked", "dangerous", "fail", "failed"].includes(value)) return "malicious"
  if (["pending", "queued", "running", "scanning"].includes(value)) return "pending"
  return "unknown"
}

function securitySnapshot(
  remoteId: string,
  version: string | undefined,
  reports: RawSecurityReports,
  signature?: VerifiedSignature,
): RegistrySecuritySnapshot {
  const reasons: string[] = []
  const labSignals: RegistrySecuritySignal[] = []
  for (const [scanner, raw] of [
    ["keen", reports.keen],
    ["sanbu", reports.sanbu],
  ] as const) {
    if (raw === null || raw === undefined) continue
    const parsed = RawSecurityReportSchema.safeParse(raw)
    if (!parsed.success) {
      reasons.push(`SkillHub returned malformed ${scanner} security metadata`)
      labSignals.push({ scanner, status: "unknown", summary: "Malformed upstream security metadata" })
      continue
    }
    const status = normalizeSecurityStatus(parsed.data.status)
    if (status !== "clean") reasons.push(parsed.data.statusText || `${scanner} status: ${parsed.data.status}`)
    labSignals.push({
      scanner,
      status,
      summary: parsed.data.statusText ?? undefined,
      url: parsed.data.reportUrl ?? undefined,
    })
  }

  const labStatuses = labSignals.map((signal) => signal.status)
  const status: RegistrySecurityStatus = labStatuses.includes("malicious")
    ? "malicious"
    : labStatuses.includes("suspicious")
      ? "suspicious"
      : labStatuses.includes("pending")
        ? "pending"
        : labStatuses.length > 0 && labStatuses.every((value) => value === "clean")
          ? "clean"
          : "unknown"

  const signatureSignal = signature
    ? [{
        scanner: "skillhub-signature",
        status: signature.verified ? "clean" as const : "unknown" as const,
        summary: signature.verified
          ? `Anybox verified SkillHub's Ed25519 signature for content fingerprint ${signature.content_hash} using key ${signature.key_id}`
          : "This SkillHub version does not have a platform content signature",
        checkedAt: signature.signed_at ?? undefined,
      }]
    : []
  if (signature && !signature.signed) reasons.push("SkillHub reports that this version is not signed")

  const parsed = RegistrySecuritySnapshotSchema.safeParse({
    provider: SKILLHUB_ID,
    remoteId,
    version,
    status,
    blocked: status === "malicious",
    hasWarnings: status === "suspicious" || status === "malicious" || reasons.length > 0,
    reasons: [...new Set(reasons)],
    summary: labSignals.length > 0
      ? "Tencent Keen and Sanbu upstream security reports are shown separately"
      : "SkillHub did not return lab security reports for this version",
    signals: [...labSignals, ...signatureSignal],
  })
  if (!parsed.success) {
    throw new RegistryProviderRequestError(SKILLHUB_ID, "INVALID_RESPONSE", "SkillHub returned invalid security metadata")
  }
  return parsed.data
}

function sourceFor(input: string | null | undefined) {
  const repository = githubRepository(input)
  return repository ? { repository } : undefined
}

function mapSearchItem(raw: unknown): RegistrySkillSummary | undefined {
  const parsed = RawSearchSkillSchema.safeParse(raw)
  if (!parsed.success) return undefined
  const item = parsed.data
  const normalized = RegistrySkillSummarySchema.safeParse({
    id: `registry:${SKILLHUB_ID}:${item.slug}`,
    provider: SKILLHUB_ID,
    remoteId: item.slug,
    slug: item.slug,
    displayName: item.name,
    summary: item.description_zh || item.description || "",
    iconUrl: optionalHttpsUrl(item.iconUrl),
    verified: item.verified ?? undefined,
    requiresApiKey: requiresApiKey(item.labels),
    author: { handle: item.ownerName },
    version: item.version,
    canonicalUrl: `${DEFAULT_SITE_URL}/skills/${encodeURIComponent(item.slug)}`,
    topics: topics(item.category, item.subCategories, item.tags),
    stats: {
      downloads: item.downloads ?? undefined,
      installs: item.installs ?? undefined,
      stars: item.stars ?? undefined,
    },
    score: item.score ?? undefined,
    createdAt: item.created_at ?? undefined,
    updatedAt: item.updated_at ?? undefined,
    source: sourceFor(item.upstream_url),
  })
  return normalized.success ? normalized.data : undefined
}

function mapFile(remoteId: string, version: string, raw: unknown): RegistryFile | undefined {
  const parsed = RawFileSchema.safeParse(raw)
  if (!parsed.success) return undefined
  const normalized = RegistryFileSchema.safeParse({
    provider: SKILLHUB_ID,
    remoteId,
    version,
    path: parsed.data.path,
    name: basename(parsed.data.path.replaceAll("\\", "/")),
    size: parsed.data.size,
    sha256: parsed.data.sha256.toLowerCase(),
  })
  return normalized.success ? normalized.data : undefined
}

function mapVersion(remoteId: string, raw: unknown): RegistryVersion | undefined {
  const parsed = RawVersionSchema.safeParse(raw)
  if (!parsed.success) return undefined
  const normalized = RegistryVersionSchema.safeParse({
    provider: SKILLHUB_ID,
    remoteId,
    version: parsed.data.version,
    createdAt: parsed.data.createdAt,
    changelog: parsed.data.changelog ?? undefined,
    security: securitySnapshot(remoteId, parsed.data.version, parsed.data.securityReports),
  })
  return normalized.success ? normalized.data : undefined
}

function searchSort(sort: RegistryProviderSearchInput["sort"]) {
  switch (sort) {
    case "downloads": return "downloads"
    case "stars": return "stars"
    case "updated":
    case "newest": return "updated_at"
    case "trending": return "downloads"
    case "recommended":
    case "relevance":
    default: return "score"
  }
}

function contentTypeForPath(path: string, responseContentType: string) {
  const contentType = responseContentType.toLowerCase().split(";", 1)[0]?.trim()
  if (contentType?.startsWith("text/")) return contentType
  if (contentType && [
    "application/json",
    "application/ld+json",
    "application/javascript",
    "application/xml",
    "application/x-yaml",
    "application/yaml",
  ].includes(contentType)) return contentType

  const extension = extname(path).toLowerCase()
  if (new Set([
    ".md", ".mdx", ".txt", ".json", ".jsonl", ".yaml", ".yml", ".toml", ".xml", ".csv", ".tsv",
    ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".rb", ".go", ".rs", ".java", ".kt",
    ".c", ".h", ".cc", ".cpp", ".cs", ".php", ".swift", ".sh", ".bash", ".zsh", ".fish", ".ps1",
    ".bat", ".cmd", ".html", ".css", ".scss", ".less", ".sql", ".graphql", ".ini", ".cfg", ".conf",
  ]).has(extension)) return contentType || "text/plain"
  return undefined
}

function validatedFileRedirect(location: string | null, slug: string, version: string, path: string) {
  if (!location || !URL.canParse(location)) {
    throw new RegistryProviderRequestError(SKILLHUB_ID, "INVALID_RESPONSE", "SkillHub file redirect is missing or invalid")
  }
  const url = new URL(location)
  const expectedPath = `/skills/${encodeURIComponent(slug)}/${encodeURIComponent(version)}/files/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== SKILLHUB_COS_HOST ||
    (url.port && url.port !== "443") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== expectedPath
  ) {
    throw new RegistryProviderRequestError(
      SKILLHUB_ID,
      "INVALID_RESPONSE",
      "SkillHub file redirect does not match the requested immutable Tencent COS object",
    )
  }
  return url
}

async function readLimitedUtf8(response: Response) {
  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) {
    throw new RegistryProviderRequestError(SKILLHUB_ID, "INVALID_RESPONSE", "SkillHub returned an oversized text file")
  }
  if (!response.body) return { bytes: new Uint8Array(), content: "" }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_FILE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new RegistryProviderRequestError(SKILLHUB_ID, "INVALID_RESPONSE", "SkillHub returned an oversized text file")
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
  try {
    return { bytes, content: new TextDecoder("utf-8", { fatal: true }).decode(bytes) }
  } catch {
    throw new RegistryProviderRequestError(SKILLHUB_ID, "INVALID_RESPONSE", "SkillHub file is not valid UTF-8 text")
  }
}

export interface SkillHubProviderOptions {
  /** Test-only endpoint injection. Production always uses https://api.skillhub.cn. */
  baseUrl?: string
  fetch?: RegistryFetch
  timeoutMs?: number
  now?: () => number
}

export class SkillHubProvider implements SkillRegistryProvider {
  readonly id = SKILLHUB_ID
  readonly capabilities: RegistryCapabilities = {
    search: true,
    browse: true,
    detail: true,
    versions: true,
    files: true,
    download: true,
    security: true,
  }

  private readonly baseUrl: string
  private readonly http: RegistryHttpClient

  constructor(options: SkillHubProviderOptions = {}) {
    this.baseUrl = normalizedBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL)
    this.http = new RegistryHttpClient({
      provider: this.id,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs,
      now: options.now,
    })
  }

  async invalidateCache() {}

  async getDescriptor(): Promise<RegistryProviderDescriptor> {
    await clearLegacySkillHubStateOnce()
    const parsed = RegistryProviderDescriptorSchema.safeParse({
      id: this.id,
      name: "腾讯 SkillHub",
      description: "腾讯 SkillHub 官方公开技能库",
      canonicalUrl: DEFAULT_SITE_URL,
      beta: false,
      enabled: true,
      configured: true,
      capabilities: this.capabilities,
    })
    if (!parsed.success) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "SkillHub provider descriptor is invalid")
    }
    return parsed.data
  }

  async search(input: RegistryProviderSearchInput, signal?: AbortSignal): Promise<RegistryProviderSearchPage> {
    const page = input.cursor === undefined ? 1 : Number(input.cursor)
    if (!Number.isInteger(page) || page < 1) {
      throw new RegistryProviderRequestError(this.id, "INVALID_REQUEST", "SkillHub search cursor is invalid")
    }
    const url = new URL("/api/skills", this.baseUrl)
    url.searchParams.set("page", String(page))
    url.searchParams.set("pageSize", String(input.limit))
    if (input.query) url.searchParams.set("keyword", input.query)
    if (input.category) url.searchParams.set("category", input.category)
    url.searchParams.set("sortBy", searchSort(input.sort))
    url.searchParams.set("order", "desc")

    const parsed = RawSearchResponseSchema.safeParse(await this.http.json(url, {}, signal))
    if (!parsed.success) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "SkillHub returned an invalid search response")
    }

    let invalidCount = 0
    const items = parsed.data.data.skills.flatMap((raw): RegistrySkillSummary[] => {
      const item = mapSearchItem(raw)
      if (!item) {
        invalidCount += 1
        return []
      }
      return [item]
    })
    const errors: RegistryProviderError[] = invalidCount > 0
      ? [{
          provider: this.id,
          code: "INVALID_RESPONSE",
          message: `SkillHub returned ${invalidCount} invalid ${invalidCount === 1 ? "item" : "items"}; valid results are still shown`,
        }]
      : []
    return {
      items: items.filter((item) => !input.safeOnly || !item.security || (
        item.security.status !== "suspicious" && item.security.status !== "malicious"
      )),
      nextCursor: page * input.limit < parsed.data.data.total ? String(page + 1) : undefined,
      errors,
    }
  }

  private async rawDetail(remoteId: string, signal?: AbortSignal) {
    const slug = skillSlug(remoteId)
    const url = new URL(`/api/v1/skills/${encodeURIComponent(slug)}`, this.baseUrl)
    const parsed = RawDetailResponseSchema.safeParse(await this.http.json(url, {}, signal))
    if (!parsed.success) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "SkillHub returned an invalid skill detail")
    }
    if (parsed.data.skill.slug !== slug) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "SkillHub detail identity does not match the requested skill")
    }
    return parsed.data
  }

  private async resolveVersion(input: RegistryVersionRef, signal?: AbortSignal) {
    if (input.version) return input.version
    const detail = await this.rawDetail(input.remoteId, signal)
    if (!detail.latestVersion?.version) {
      throw new RegistryProviderRequestError(this.id, "NOT_FOUND", "SkillHub skill has no published version")
    }
    return detail.latestVersion.version
  }

  private async signature(remoteId: string, version: string, signal?: AbortSignal): Promise<VerifiedSignature> {
    const slug = skillSlug(remoteId)
    const url = new URL(
      `/api/v1/open/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}/signature`,
      this.baseUrl,
    )
    const parsed = RawSignatureSchema.safeParse(await this.http.json(url, {}, signal))
    if (!parsed.success) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "SkillHub returned invalid signature metadata")
    }
    const signature = parsed.data
    if (!signature.signed) return { ...signature, verified: false }

    let payload: unknown
    try {
      payload = JSON.parse(signature.payload!)
    } catch {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "SkillHub signature payload is invalid JSON")
    }
    const parsedPayload = RawSignaturePayloadSchema.safeParse(payload)
    if (
      !parsedPayload.success ||
      parsedPayload.data.skill_slug !== slug ||
      parsedPayload.data.skill_version !== version ||
      parsedPayload.data.content_hash.toLowerCase() !== signature.content_hash!.toLowerCase() ||
      parsedPayload.data.v !== signature.hash_version ||
      parsedPayload.data.issued_at !== signature.signed_at
    ) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "SkillHub signature payload does not match the requested skill version")
    }

    const keysUrl = new URL("/api/v1/open/platform/keys", this.baseUrl)
    const parsedKeys = RawPlatformKeysResponseSchema.safeParse(await this.http.json(keysUrl, {}, signal))
    if (!parsedKeys.success) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "SkillHub returned invalid platform signing keys")
    }
    const platformKey = parsedKeys.data.keys.find((key) => key.key_id === signature.key_id)
    if (!platformKey) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "SkillHub signature references an unknown platform key")
    }

    let rawPublicKey: Buffer
    let signatureBytes: Buffer
    try {
      rawPublicKey = Buffer.from(platformKey.public_key_raw_b64, "base64")
      signatureBytes = Buffer.from(signature.signature!, "base64")
    } catch {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "SkillHub signature uses invalid base64 data")
    }
    if (rawPublicKey.byteLength !== 32 || signatureBytes.byteLength !== 64) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "SkillHub signature uses an invalid Ed25519 key or signature length")
    }
    const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex")
    let verified = false
    try {
      const publicKey = createPublicKey({
        key: Buffer.concat([spkiPrefix, rawPublicKey]),
        format: "der",
        type: "spki",
      })
      verified = verifySignature(null, Buffer.from(signature.payload!, "utf8"), publicKey, signatureBytes)
    } catch {}
    if (!verified) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "SkillHub content signature verification failed")
    }
    return {
      ...signature,
      verified: true,
      packageMd5: parsedPayload.data.package_md5.toLowerCase(),
      fileCount: parsedPayload.data.file_count,
      publicKeyRawBase64: platformKey.public_key_raw_b64,
    }
  }

  async getDetail(input: RegistrySkillRef, signal?: AbortSignal): Promise<RegistrySkillDetail> {
    const detail = await this.rawDetail(input.remoteId, signal)
    const { skill, owner } = detail
    const version = detail.latestVersion?.version
    let signature: VerifiedSignature | undefined
    if (version) {
      try {
        signature = await this.signature(input.remoteId, version, signal)
      } catch (error) {
        if (signal?.aborted) throw error
        if (error instanceof RegistryProviderRequestError && error.code === "INVALID_RESPONSE") throw error
      }
    }
    const security = securitySnapshot(input.remoteId, version, detail.securityReports, signature)
    let description: string | undefined
    if (version) {
      try {
        description = (await this.readFile({ ...input, version, path: "SKILL.md" }, signal)).content
      } catch (error) {
        if (signal?.aborted) throw error
      }
    }
    const source = sourceFor(skill.upstream_url ?? skill.sourceUrl)
    const normalized = RegistrySkillDetailSchema.safeParse({
      id: `registry:${this.id}:${skill.slug}`,
      provider: this.id,
      remoteId: skill.slug,
      slug: skill.slug,
      displayName: skill.displayName,
      summary: skill.summary_zh || skill.summary,
      description,
      iconUrl: optionalHttpsUrl(skill.iconUrl),
      verified: skill.verified ?? undefined,
      requiresApiKey: requiresApiKey(skill.labels),
      author: {
        handle: owner.handle,
        displayName: owner.displayName || undefined,
        avatarUrl: optionalHttpsUrl(owner.image),
      },
      version,
      latestVersion: detail.latestVersion
        ? {
            provider: this.id,
            remoteId: skill.slug,
            version: detail.latestVersion.version,
            createdAt: detail.latestVersion.createdAt,
            changelog: detail.latestVersion.changelog ?? undefined,
            security,
          }
        : undefined,
      canonicalUrl: `${DEFAULT_SITE_URL}/skills/${encodeURIComponent(skill.slug)}`,
      topics: topics(skill.category, skill.subCategories, skill.tags),
      stats: {
        downloads: skill.stats.downloads ?? undefined,
        installs: skill.stats.installs ?? undefined,
        stars: skill.stats.stars ?? undefined,
        comments: skill.stats.comments ?? undefined,
        versions: skill.stats.versions ?? undefined,
      },
      createdAt: skill.createdAt,
      updatedAt: skill.updatedAt,
      source,
      security,
      metadata: {
        contentZhAvailable: detail.contentZhAvailable,
        source: skill.source ?? undefined,
        sourceUrl: optionalHttpsUrl(skill.sourceUrl) ?? undefined,
        verified: skill.verified ?? false,
        authorVerified: skill.isAuthorVerified ?? false,
        requiresApiKey: requiresApiKey(skill.labels) ?? false,
      },
    })
    if (!normalized.success) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "SkillHub returned an invalid normalized skill detail")
    }
    return normalized.data
  }

  async listVersions(input: RegistrySkillRef, signal?: AbortSignal): Promise<RegistryVersion[]> {
    const response = await this.rawVersions(input.remoteId, signal)
    return response.versions.flatMap((raw) => {
      const version = mapVersion(response.slug, raw)
      return version ? [version] : []
    })
  }

  async listFiles(input: RegistryVersionRef, signal?: AbortSignal): Promise<RegistryFile[]> {
    const slug = skillSlug(input.remoteId)
    const version = await this.resolveVersion(input, signal)
    const url = new URL(`/api/v1/skills/${encodeURIComponent(slug)}/files`, this.baseUrl)
    url.searchParams.set("version", version)
    const parsed = RawFilesResponseSchema.safeParse(await this.http.json(url, {}, signal))
    if (!parsed.success) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "SkillHub returned invalid file metadata")
    }
    if (parsed.data.version !== version || parsed.data.count !== parsed.data.files.length) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "SkillHub file manifest does not match the requested version")
    }
    const files = parsed.data.files.flatMap((raw) => {
      const file = mapFile(slug, version, raw)
      return file ? [file] : []
    })
    if (new Set(files.map((file) => file.path)).size !== files.length) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "SkillHub file manifest contains duplicate paths")
    }
    return files
  }

  async readFile(input: RegistryFileRef, signal?: AbortSignal): Promise<RegistryFileContent> {
    if (!RegistryFileRefSchema.safeParse(input).success) {
      throw new RegistryProviderRequestError(this.id, "INVALID_REQUEST", "SkillHub file path must be a safe relative path")
    }
    const slug = skillSlug(input.remoteId)
    const version = await this.resolveVersion(input, signal)
    const metadata = (await this.listFiles({ ...input, version }, signal)).find((file) => file.path === input.path)
    if (!metadata) {
      throw new RegistryProviderRequestError(this.id, "NOT_FOUND", "SkillHub file is not present in the version manifest")
    }
    if (!metadata.sha256) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "SkillHub file manifest does not provide an immutable SHA-256")
    }
    if (metadata.size !== undefined && metadata.size > MAX_FILE_BYTES) {
      return unsupported(this.id, "reading files larger than 1 MiB")
    }
    const url = new URL(`/api/v1/skills/${encodeURIComponent(slug)}/file`, this.baseUrl)
    url.searchParams.set("path", input.path)
    url.searchParams.set("version", version)
    const headers = { accept: "text/plain, text/markdown, application/json" }
    let response = await this.http.request(
      url,
      { headers, redirect: "manual" },
      signal,
      { allowManualRedirect: true },
    )
    if (response.status >= 300 && response.status < 400) {
      const redirectSha256 = response.headers.get("x-content-sha256")
      const redirectSize = response.headers.get("x-content-size")
      if (
        redirectSha256?.toLowerCase() !== metadata.sha256.toLowerCase() ||
        redirectSize === null ||
        !/^\d+$/.test(redirectSize) ||
        Number(redirectSize) !== metadata.size
      ) {
        throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "SkillHub file redirect metadata does not match its version manifest")
      }
      const redirect = validatedFileRedirect(response.headers.get("location"), slug, version, input.path)
      response = await this.http.request(redirect, { headers, redirect: "manual" }, signal)
    }
    const contentType = contentTypeForPath(input.path, response.headers.get("content-type") ?? "")
    if (!contentType) return unsupported(this.id, "binary file reads")
    const { bytes, content } = await readLimitedUtf8(response)
    const actualSha256 = createHash("sha256").update(bytes).digest("hex")
    if (metadata.sha256.toLowerCase() !== actualSha256) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "SkillHub file content does not match its version manifest")
    }
    if (metadata.size !== undefined && metadata.size !== bytes.byteLength) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "SkillHub file content size does not match its version manifest")
    }
    const normalized = RegistryFileContentSchema.safeParse({
      ...metadata,
      contentType,
      content,
      encoding: "utf8",
    })
    if (!normalized.success) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "SkillHub returned invalid file content")
    }
    return normalized.data
  }

  async getSecurity(input: RegistryVersionRef, signal?: AbortSignal): Promise<RegistrySecuritySnapshot> {
    const version = await this.resolveVersion(input, signal)
    const raw = await this.rawVersions(input.remoteId, signal)
    const rawVersion = raw.versions
      .map((entry) => RawVersionSchema.safeParse(entry))
      .find((entry) => entry.success && entry.data.version === version)
    if (!rawVersion?.success) {
      throw new RegistryProviderRequestError(this.id, "NOT_FOUND", "SkillHub security metadata was not found for this version")
    }
    const signature = await this.signature(input.remoteId, version, signal)
    return securitySnapshot(input.remoteId, version, rawVersion.data.securityReports, signature)
  }

  private async rawVersions(remoteId: string, signal?: AbortSignal) {
    const slug = skillSlug(remoteId)
    const url = new URL(`/api/v1/skills/${encodeURIComponent(slug)}/versions`, this.baseUrl)
    const parsed = RawVersionsResponseSchema.safeParse(await this.http.json(url, {}, signal))
    if (!parsed.success || parsed.data.slug !== slug) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "SkillHub returned invalid version history")
    }
    return parsed.data
  }

  async resolveDownload(input: RegistryVersionRef, signal?: AbortSignal): Promise<RegistryDownloadDescriptor> {
    const slug = skillSlug(input.remoteId)
    const version = await this.resolveVersion(input, signal)
    const url = new URL("/api/v1/download", this.baseUrl)
    url.searchParams.set("slug", slug)
    url.searchParams.set("version", version)
    const signature = await this.signature(slug, version, signal)
    const parsed = RegistryDownloadDescriptorSchema.safeParse({
      kind: "archive",
      provider: this.id,
      remoteId: slug,
      version,
      url: url.toString(),
      contentType: "application/zip",
      ...(signature.signed && signature.verified && signature.content_hash && signature.key_id &&
        signature.payload && signature.signature && signature.publicKeyRawBase64
        ? {
            contentHash: signature.content_hash.toLowerCase(),
            contentHashAlgorithm: "skillhub-v1" as const,
            integrity: {
              kind: "skillhub-ed25519-v1" as const,
              keyId: signature.key_id,
              publicKeyRawBase64: signature.publicKeyRawBase64,
              payload: signature.payload,
              signatureBase64: signature.signature,
            },
          }
        : {}),
    })
    if (!parsed.success) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "SkillHub returned an invalid download descriptor")
    }
    return parsed.data
  }
}
