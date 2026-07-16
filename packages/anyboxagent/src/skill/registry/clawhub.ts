import { basename } from "node:path"
import { createHash } from "node:crypto"
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
  RegistryDownloadDescriptor,
  RegistryCapabilities,
  RegistryFile,
  RegistryFileContent,
  RegistryProviderDescriptor,
  RegistryProviderError,
  RegistrySecuritySnapshot,
  RegistrySecurityStatus,
  RegistrySkillDetail,
  RegistrySkillRef,
  RegistrySkillSummary,
  RegistryVersion,
  RegistryVersionRef,
  RegistryFileRef,
} from "@anybox/shared/skill-registry"
import { RegistryHttpClient, RegistryProviderRequestError } from "./provider.ts"
import type {
  RegistryFetch,
  RegistryProviderSearchInput,
  RegistryProviderSearchPage,
  SkillRegistryProvider,
} from "./types.ts"

const CLAWHUB_ID = "clawhub"
const DEFAULT_BASE_URL = "https://clawhub.ai"

const RawOwnerSchema = z.object({
  handle: z.string().min(1),
  displayName: z.string().nullish(),
  image: z.string().nullish(),
}).passthrough()

const RawStatsSchema = z.object({
  downloads: z.number().nonnegative().optional(),
  installs: z.number().nonnegative().optional(),
  stars: z.number().nonnegative().optional(),
  comments: z.number().nonnegative().optional(),
  versions: z.number().nonnegative().optional(),
}).passthrough()

const RawMetadataSchema = z.object({
  os: z.array(z.string()).nullish(),
  systems: z.array(z.string()).nullish(),
}).passthrough()

const RawSkillSchema = z.object({
  slug: z.string().min(1),
  displayName: z.string().min(1),
  summary: z.string().optional().default(""),
  description: z.string().optional(),
  topics: z.array(z.string()).optional().default([]),
  tags: z.record(z.string(), z.string()).optional(),
  stats: RawStatsSchema.optional(),
  createdAt: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative().optional(),
  canonicalUrl: z.string().optional(),
  skillUrl: z.string().optional(),
}).passthrough()

const RawSearchItemSchema = z.object({
  score: z.number().optional(),
  slug: z.string().min(1),
  displayName: z.string().min(1),
  summary: z.string().optional().default(""),
  version: z.string().nullish(),
  downloads: z.number().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative().optional(),
  ownerHandle: z.string().min(1).optional(),
  owner: RawOwnerSchema.optional(),
  canonicalUrl: z.string().optional(),
  skillUrl: z.string().optional(),
}).passthrough()

const RawFileSchema = z.object({
  path: z.string().min(1),
  size: z.number().int().nonnegative().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  contentType: z.string().optional(),
}).passthrough()

const RawVersionSchema = z.object({
  version: z.string().min(1),
  createdAt: z.number().int().nonnegative().optional(),
  changelog: z.string().nullish(),
  license: z.string().nullish(),
  files: z.array(z.unknown()).optional(),
  security: z.unknown().optional(),
}).passthrough()

const RawModerationSchema = z.object({
  isSuspicious: z.boolean().optional(),
  isMalwareBlocked: z.boolean().optional(),
  verdict: z.string().nullish(),
  reasonCodes: z.array(z.string()).optional(),
  summary: z.string().nullish(),
  updatedAt: z.number().int().nonnegative().optional(),
  matchesRequestedVersion: z.boolean().optional(),
  sourceVersion: z.string().nullish(),
}).passthrough()

const RawSearchResponseSchema = z.object({ results: z.array(z.unknown()) }).passthrough()
const RawBrowseResponseSchema = z.object({
  items: z.array(z.unknown()),
  nextCursor: z.string().nullish(),
}).passthrough()
const RawPackageBrowseItemSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().min(1),
  summary: z.string().optional().default(""),
  ownerHandle: z.string().min(1),
  latestVersion: z.string().nullish(),
  topics: z.array(z.string()).optional().default([]),
  categories: z.array(z.string()).optional().default([]),
  stats: RawStatsSchema.optional(),
  createdAt: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative().optional(),
}).passthrough()
const RawDetailResponseSchema = z.object({
  skill: RawSkillSchema,
  latestVersion: RawVersionSchema.nullish(),
  metadata: RawMetadataSchema.nullish(),
  owner: RawOwnerSchema,
  moderation: RawModerationSchema.nullish(),
}).passthrough()
const RawVersionsResponseSchema = z.object({
  items: z.array(z.unknown()),
  nextCursor: z.string().nullish(),
}).passthrough()
const RawVersionDetailResponseSchema = z.object({
  version: RawVersionSchema,
}).passthrough()
const RawScanResponseSchema = z.object({
  version: RawVersionSchema.optional(),
  moderation: RawModerationSchema.nullish(),
  security: z.unknown().optional(),
}).passthrough()

function normalizeStatus(input: unknown): RegistrySecurityStatus {
  if (typeof input !== "string") return "unknown"
  const value = input.toLowerCase()
  if (value === "clean" || value === "safe" || value === "benign" || value === "pass") return "clean"
  if (value === "suspicious" || value === "review" || value === "warn" || value === "warning") return "suspicious"
  if (value === "malicious" || value === "blocked" || value === "fail") return "malicious"
  if (value === "pending" || value === "queued" || value === "running") return "pending"
  return "unknown"
}

function objectValue(input: unknown) {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : undefined
}

function stringValue(input: unknown) {
  return typeof input === "string" && input.trim() ? input.trim() : undefined
}

function numberValue(input: unknown) {
  return typeof input === "number" && Number.isFinite(input) && input >= 0 ? input : undefined
}

function httpUrl(input: unknown) {
  if (typeof input !== "string" || !URL.canParse(input)) return undefined
  const protocol = new URL(input).protocol
  return protocol === "https:" ? input : undefined
}

function canonicalUrl(baseUrl: string, slug: string, ownerHandle?: string, explicit?: string) {
  const safeExplicit = httpUrl(explicit)
  if (safeExplicit) return safeExplicit
  if (ownerHandle) {
    return `${baseUrl}/${encodeURIComponent(ownerHandle)}/skills/${encodeURIComponent(slug)}`
  }
  // Browse responses currently omit the owner. This public resolver redirects to the owner canonical route.
  return `${baseUrl}/skills/${encodeURIComponent(slug)}`
}

function makeRemoteId(ownerHandle: string, slug: string) {
  return `${ownerHandle.replace(/^@/, "")}/${slug}`
}

function parseRemoteId(remoteId: string) {
  const separator = remoteId.indexOf("/")
  if (separator <= 0 || separator === remoteId.length - 1) {
    return { slug: remoteId }
  }
  return {
    ownerHandle: remoteId.slice(0, separator).replace(/^@/, ""),
    slug: remoteId.slice(separator + 1),
  }
}

function addOwnerHandle(url: URL, ownerHandle: string | undefined) {
  if (ownerHandle) url.searchParams.set("ownerHandle", ownerHandle)
  return url
}

function author(owner: z.infer<typeof RawOwnerSchema> | undefined, fallbackHandle = "unknown") {
  return {
    handle: owner?.handle ?? fallbackHandle,
    displayName: owner?.displayName ?? undefined,
    avatarUrl: httpUrl(owner?.image),
  }
}

function securitySnapshot(
  remoteId: string,
  version: string | undefined,
  rawSecurity: unknown,
  moderation?: z.infer<typeof RawModerationSchema> | null,
): RegistrySecuritySnapshot {
  const security = objectValue(rawSecurity)
  const moderationApplies = Boolean(moderation) && moderation?.matchesRequestedVersion !== false && (
    !moderation?.sourceVersion || !version || moderation.sourceVersion === version
  )
  const status = moderationApplies && moderation?.isMalwareBlocked
    ? "malicious"
    : moderationApplies && moderation?.isSuspicious
      ? "suspicious"
      : normalizeStatus(security?.status ?? (moderationApplies ? moderation?.verdict : undefined))
  const mismatchReason = moderation && !moderationApplies
    ? `ClawHub moderation applies to ${moderation.sourceVersion ?? "another version"}, not requested version ${version ?? "unknown"}`
    : undefined
  const reasons = [
    ...(moderationApplies ? moderation?.reasonCodes ?? [] : []),
    ...((Array.isArray(security?.reasons) ? security.reasons : []).filter((item): item is string => typeof item === "string")),
    ...(mismatchReason ? [mismatchReason] : []),
  ]
  const scanners = objectValue(security?.scanners)
  const scannerSignals = scanners
    ? Object.entries(scanners).flatMap(([scanner, value]) => {
        const record = objectValue(value)
        if (!record || !scanner.trim()) return []
        const signalStatus = normalizeStatus(record.normalizedStatus ?? record.status ?? record.verdict)
        return [{
          scanner,
          status: signalStatus,
          summary: stringValue(record.summary ?? record.analysis ?? record.guidance),
          checkedAt: numberValue(record.checkedAt),
        }]
      })
    : undefined
  const signals = [
    ...(scannerSignals ?? []),
    ...(mismatchReason ? [{
      scanner: "clawhub-moderation",
      status: "unknown" as const,
      summary: mismatchReason,
      checkedAt: moderation?.updatedAt,
    }] : []),
  ]

  const normalized = {
    provider: CLAWHUB_ID,
    remoteId,
    version,
    status,
    blocked: Boolean((moderationApplies && moderation?.isMalwareBlocked) || status === "malicious"),
    hasWarnings: typeof security?.hasWarnings === "boolean" ? security.hasWarnings : undefined,
    reasons: [...new Set(reasons)],
    summary: stringValue((moderationApplies ? moderation?.summary : undefined) ?? security?.summary),
    checkedAt: numberValue(security?.checkedAt ?? moderation?.updatedAt),
    signals: signals.length > 0 ? signals : undefined,
  }
  const parsed = RegistrySecuritySnapshotSchema.safeParse(normalized)
  if (!parsed.success) {
    throw new RegistryProviderRequestError(CLAWHUB_ID, "INVALID_RESPONSE", "ClawHub returned invalid security metadata")
  }
  return parsed.data
}

function fileFromRaw(remoteId: string, version: string | undefined, raw: unknown): RegistryFile | undefined {
  const parsed = RawFileSchema.safeParse(raw)
  if (!parsed.success) return undefined
  const normalized: RegistryFile = {
    provider: CLAWHUB_ID,
    remoteId,
    version,
    path: parsed.data.path,
    name: basename(parsed.data.path.replaceAll("\\", "/")),
    size: parsed.data.size,
    sha256: parsed.data.sha256,
    contentType: parsed.data.contentType,
  }
  const validated = RegistryFileSchema.safeParse(normalized)
  return validated.success ? validated.data : undefined
}

function versionFromRaw(remoteId: string, raw: unknown): RegistryVersion | undefined {
  const parsed = RawVersionSchema.safeParse(raw)
  if (!parsed.success) return undefined
  const files = parsed.data.files
    ?.map((file) => fileFromRaw(remoteId, parsed.data.version, file))
    .filter((file): file is RegistryFile => Boolean(file))
  const normalized = {
    provider: CLAWHUB_ID,
    remoteId,
    version: parsed.data.version,
    createdAt: parsed.data.createdAt,
    changelog: parsed.data.changelog ?? undefined,
    license: parsed.data.license ?? undefined,
    files,
    security: parsed.data.security
      ? securitySnapshot(remoteId, parsed.data.version, parsed.data.security)
      : undefined,
  }
  const validated = RegistryVersionSchema.safeParse(normalized)
  return validated.success ? validated.data : undefined
}

function invalidItemsError(count: number): RegistryProviderError | undefined {
  if (count <= 0) return undefined
  return {
    provider: CLAWHUB_ID,
    code: "INVALID_RESPONSE",
    message: `ClawHub returned ${count} invalid ${count === 1 ? "item" : "items"}; valid results are still shown`,
  }
}

export interface ClawHubProviderOptions {
  baseUrl?: string
  fetch?: RegistryFetch
  timeoutMs?: number
  now?: () => number
}

export class ClawHubProvider implements SkillRegistryProvider {
  readonly id = CLAWHUB_ID
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

  constructor(options: ClawHubProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
    this.http = new RegistryHttpClient({
      provider: this.id,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs,
      now: options.now,
    })
  }

  async getDescriptor(): Promise<RegistryProviderDescriptor> {
    const parsed = RegistryProviderDescriptorSchema.safeParse({
      id: this.id,
      name: "ClawHub",
      description: "Public OpenClaw skill registry",
      canonicalUrl: this.baseUrl,
      beta: false,
      enabled: true,
      configured: true,
      capabilities: this.capabilities,
    })
    if (!parsed.success) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "ClawHub provider configuration is invalid")
    }
    return parsed.data
  }

  async search(input: RegistryProviderSearchInput, signal?: AbortSignal): Promise<RegistryProviderSearchPage> {
    if (input.query) return await this.searchQuery(input, signal)
    return await this.browse(input, signal)
  }

  private async searchQuery(input: RegistryProviderSearchInput, signal?: AbortSignal) {
    const url = new URL("/api/v1/search", this.baseUrl)
    url.searchParams.set("q", input.query)
    url.searchParams.set("limit", String(input.limit))
    if (input.safeOnly) url.searchParams.set("nonSuspiciousOnly", "true")
    const raw = RawSearchResponseSchema.safeParse(await this.http.json(url, {}, signal))
    if (!raw.success) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "ClawHub returned an invalid search response")
    }

    let invalidCount = 0
    const items = raw.data.results.flatMap((item): RegistrySkillSummary[] => {
      const parsed = RawSearchItemSchema.safeParse(item)
      if (!parsed.success) {
        invalidCount += 1
        return []
      }
      const owner = parsed.data.owner
      const ownerHandle = owner?.handle ?? parsed.data.ownerHandle
      if (!ownerHandle) {
        invalidCount += 1
        return []
      }
      const slug = parsed.data.slug
      const remoteId = makeRemoteId(ownerHandle, slug)
      const normalized = RegistrySkillSummarySchema.safeParse({
        id: `registry:${this.id}:${remoteId}`,
        provider: this.id,
        remoteId,
        slug,
        displayName: parsed.data.displayName,
        summary: parsed.data.summary,
        iconUrl: httpUrl(owner?.image),
        author: author(owner, ownerHandle),
        version: parsed.data.version ?? undefined,
        canonicalUrl: canonicalUrl(this.baseUrl, slug, ownerHandle, parsed.data.canonicalUrl ?? parsed.data.skillUrl),
        topics: [],
        stats: parsed.data.downloads === undefined ? undefined : { downloads: parsed.data.downloads },
        score: parsed.data.score,
        updatedAt: parsed.data.updatedAt,
      })
      if (!normalized.success) {
        invalidCount += 1
        return []
      }
      return [normalized.data]
    })
    const error = invalidItemsError(invalidCount)
    return { items, errors: error ? [error] : [] }
  }

  private async browse(input: RegistryProviderSearchInput, signal?: AbortSignal) {
    const url = new URL("/api/v1/packages", this.baseUrl)
    url.searchParams.set("limit", String(input.limit))
    url.searchParams.set("family", "skill")
    const sort = input.sort === "relevance" || input.sort === "stars" || input.sort === "newest"
      ? "recommended"
      : input.sort === "updated"
        ? "updated"
        : input.sort
    url.searchParams.set("sort", sort)
    if (input.cursor) url.searchParams.set("cursor", input.cursor)
    if (input.safeOnly) url.searchParams.set("nonSuspiciousOnly", "true")
    const raw = RawBrowseResponseSchema.safeParse(await this.http.json(url, {}, signal))
    if (!raw.success) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "ClawHub returned an invalid catalog response")
    }

    let invalidCount = 0
    const items = raw.data.items.flatMap((item): RegistrySkillSummary[] => {
      const parsed = RawPackageBrowseItemSchema.safeParse(item)
      if (!parsed.success) {
        invalidCount += 1
        return []
      }
      const skill = parsed.data
      const remoteId = makeRemoteId(skill.ownerHandle, skill.name)
      const normalized = RegistrySkillSummarySchema.safeParse({
        id: `registry:${this.id}:${remoteId}`,
        provider: this.id,
        remoteId,
        slug: skill.name,
        displayName: skill.displayName,
        summary: skill.summary,
        author: { handle: skill.ownerHandle },
        version: skill.latestVersion ?? undefined,
        canonicalUrl: canonicalUrl(this.baseUrl, skill.name, skill.ownerHandle),
        topics: [...new Set([...skill.topics, ...skill.categories])],
        stats: skill.stats,
        createdAt: skill.createdAt,
        updatedAt: skill.updatedAt,
      })
      if (!normalized.success) {
        invalidCount += 1
        return []
      }
      return [normalized.data]
    })
    const error = invalidItemsError(invalidCount)
    return {
      items,
      nextCursor: raw.data.nextCursor ?? undefined,
      errors: error ? [error] : [],
    }
  }

  async getDetail(input: RegistrySkillRef, signal?: AbortSignal): Promise<RegistrySkillDetail> {
    const ref = parseRemoteId(input.remoteId)
    const url = addOwnerHandle(
      new URL(`/api/v1/skills/${encodeURIComponent(ref.slug)}`, this.baseUrl),
      ref.ownerHandle,
    )
    const parsed = RawDetailResponseSchema.safeParse(await this.http.json(url, {}, signal))
    if (!parsed.success) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "ClawHub returned an invalid skill detail")
    }

    const { skill, owner, metadata, moderation } = parsed.data
    const responseOwner = owner.handle.replace(/^@/, "")
    if (skill.slug !== ref.slug || (ref.ownerHandle && responseOwner !== ref.ownerHandle)) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "ClawHub detail identity does not match the requested skill")
    }
    const remoteId = makeRemoteId(owner.handle, skill.slug)
    const latestVersion = parsed.data.latestVersion
      ? versionFromRaw(remoteId, parsed.data.latestVersion)
      : undefined
    const security = latestVersion?.version
      ? await this.getSecurity({ provider: this.id, remoteId, version: latestVersion.version }, signal).catch((error) => {
          if (signal?.aborted) throw error
          return moderation ? securitySnapshot(remoteId, latestVersion.version, undefined, moderation) : undefined
        })
      : moderation
        ? securitySnapshot(remoteId, undefined, undefined, moderation)
        : undefined

    const normalized = RegistrySkillDetailSchema.safeParse({
      id: `registry:${this.id}:${remoteId}`,
      provider: this.id,
      remoteId,
      slug: skill.slug,
      displayName: skill.displayName,
      summary: skill.summary,
      description: skill.description,
      iconUrl: httpUrl(owner.image),
      author: author(owner),
      version: latestVersion?.version ?? skill.tags?.latest,
      latestVersion,
      canonicalUrl: canonicalUrl(this.baseUrl, skill.slug, owner.handle, skill.canonicalUrl ?? skill.skillUrl),
      topics: skill.topics,
      os: metadata?.os ?? undefined,
      systems: metadata?.systems ?? undefined,
      stats: skill.stats,
      createdAt: skill.createdAt,
      updatedAt: skill.updatedAt,
      metadata: metadata ?? undefined,
      security,
    })
    if (!normalized.success) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "ClawHub returned an invalid skill detail")
    }
    return normalized.data
  }

  async listVersions(input: RegistrySkillRef, signal?: AbortSignal): Promise<RegistryVersion[]> {
    const ref = parseRemoteId(input.remoteId)
    const versions: RegistryVersion[] = []
    let cursor: string | undefined
    for (let page = 0; page < 10; page += 1) {
      const url = addOwnerHandle(
        new URL(`/api/v1/skills/${encodeURIComponent(ref.slug)}/versions`, this.baseUrl),
        ref.ownerHandle,
      )
      url.searchParams.set("limit", "100")
      if (cursor) url.searchParams.set("cursor", cursor)
      const parsed = RawVersionsResponseSchema.safeParse(await this.http.json(url, {}, signal))
      if (!parsed.success) {
        throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "ClawHub returned invalid version history")
      }
      versions.push(...parsed.data.items.flatMap((item) => {
        const version = versionFromRaw(input.remoteId, item)
        return version ? [version] : []
      }))
      cursor = parsed.data.nextCursor ?? undefined
      if (!cursor) break
    }
    return versions
  }

  private async resolveVersion(input: RegistryVersionRef, signal?: AbortSignal) {
    if (input.version) return input.version
    const detail = await this.getDetail(input, signal)
    if (!detail.version) {
      throw new RegistryProviderRequestError(this.id, "NOT_FOUND", "ClawHub skill has no published version")
    }
    return detail.version
  }

  async listFiles(input: RegistryVersionRef, signal?: AbortSignal): Promise<RegistryFile[]> {
    const ref = parseRemoteId(input.remoteId)
    const version = await this.resolveVersion(input, signal)
    const url = addOwnerHandle(
      new URL(
        `/api/v1/skills/${encodeURIComponent(ref.slug)}/versions/${encodeURIComponent(version)}`,
        this.baseUrl,
      ),
      ref.ownerHandle,
    )
    const parsed = RawVersionDetailResponseSchema.safeParse(await this.http.json(url, {}, signal))
    if (!parsed.success) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "ClawHub returned invalid file metadata")
    }
    return (parsed.data.version.files ?? []).flatMap((file) => {
      const normalized = fileFromRaw(input.remoteId, version, file)
      return normalized ? [normalized] : []
    })
  }

  async readFile(input: RegistryFileRef, signal?: AbortSignal): Promise<RegistryFileContent> {
    if (!RegistryFileRefSchema.safeParse(input).success) {
      throw new RegistryProviderRequestError(this.id, "INVALID_REQUEST", "ClawHub file path must be a safe relative path")
    }
    const ref = parseRemoteId(input.remoteId)
    const version = await this.resolveVersion(input, signal)
    const url = addOwnerHandle(
      new URL(`/api/v1/skills/${encodeURIComponent(ref.slug)}/file`, this.baseUrl),
      ref.ownerHandle,
    )
    url.searchParams.set("path", input.path)
    url.searchParams.set("version", version)
    const metadata = (await this.listFiles({ ...input, version }, signal)).find((file) => file.path === input.path)
    if (!metadata) {
      throw new RegistryProviderRequestError(this.id, "NOT_FOUND", "ClawHub file is not present in the version manifest")
    }
    if (!metadata.sha256) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "ClawHub file manifest does not provide an immutable SHA-256")
    }
    const result = await this.http.text(url, { headers: { accept: "text/plain" } }, signal)
    const actualSha256 = createHash("sha256").update(Buffer.from(result.content, "utf8")).digest("hex")
    if (metadata.sha256.toLowerCase() !== actualSha256) {
      throw new RegistryProviderRequestError(
        this.id,
        "INVALID_RESPONSE",
        "ClawHub file content does not match its version metadata",
      )
    }
    const actualSize = Buffer.byteLength(result.content, "utf8")
    if (metadata.size !== undefined && metadata.size !== actualSize) {
      throw new RegistryProviderRequestError(
        this.id,
        "INVALID_RESPONSE",
        "ClawHub file content size does not match its version manifest",
      )
    }
    const normalized = RegistryFileContentSchema.safeParse({
      provider: this.id,
      remoteId: input.remoteId,
      version,
      path: input.path,
      name: basename(input.path.replaceAll("\\", "/")),
      size: actualSize,
      sha256: actualSha256,
      contentType: metadata.contentType ?? result.contentType,
      content: result.content,
      encoding: "utf8",
    })
    if (!normalized.success) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "ClawHub returned invalid file content")
    }
    return normalized.data
  }

  async getSecurity(input: RegistryVersionRef, signal?: AbortSignal): Promise<RegistrySecuritySnapshot> {
    const ref = parseRemoteId(input.remoteId)
    const version = await this.resolveVersion(input, signal)
    const url = addOwnerHandle(
      new URL(`/api/v1/skills/${encodeURIComponent(ref.slug)}/scan`, this.baseUrl),
      ref.ownerHandle,
    )
    url.searchParams.set("version", version)
    const parsed = RawScanResponseSchema.safeParse(await this.http.json(url, {}, signal))
    if (!parsed.success) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "ClawHub returned invalid security metadata")
    }
    return securitySnapshot(input.remoteId, version, parsed.data.security, parsed.data.moderation)
  }

  async resolveDownload(input: RegistryVersionRef, signal?: AbortSignal): Promise<RegistryDownloadDescriptor> {
    const ref = parseRemoteId(input.remoteId)
    const version = await this.resolveVersion(input, signal)
    const url = new URL("/api/v1/download", this.baseUrl)
    url.searchParams.set("slug", ref.slug)
    if (ref.ownerHandle) url.searchParams.set("ownerHandle", ref.ownerHandle)
    url.searchParams.set("version", version)

    try {
      const response = await this.http.request(url, {
        method: "HEAD",
        headers: { accept: "*/*" },
        redirect: "manual",
      }, signal, { allowManualRedirect: true })
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
      const sha256 = response.headers.get("x-clawhub-artifact-sha256")?.match(/^[a-f0-9]{64}$/i)?.[0]
      if (contentType.includes("zip")) {
        const descriptor = RegistryDownloadDescriptorSchema.safeParse({
          kind: "archive",
          provider: this.id,
          remoteId: input.remoteId,
          version,
          url: url.toString(),
          sha256,
          contentType: contentType.split(";")[0] || "application/zip",
        })
        if (!descriptor.success) {
          throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "ClawHub returned an invalid download descriptor")
        }
        return descriptor.data
      }
    } catch (error) {
      if (!(error instanceof RegistryProviderRequestError) || error.status !== 405) throw error
    }

    // GitHub-backed skills return a JSON handoff only from GET. The managed downloader
    // performs that GET once and validates its repo/commit/path/contentHash fields.
    const descriptor = RegistryDownloadDescriptorSchema.safeParse({
      kind: "registry",
      provider: this.id,
      remoteId: input.remoteId,
      version,
      url: url.toString(),
    })
    if (!descriptor.success) {
      throw new RegistryProviderRequestError(this.id, "INVALID_RESPONSE", "ClawHub returned an invalid download descriptor")
    }
    return descriptor.data
  }
}
