import { z } from "zod"

const NonEmptyStringSchema = z.string().trim().min(1).refine((value) => !value.includes("\0"), "String must not contain NUL")
const OptionalVersionSchema = z.string().refine((value) => !value.includes("\0"), "Version must not contain NUL").optional()
const OptionalTimestampSchema = z.number().int().nonnegative().optional()
const HttpUrlSchema = z.string().url().refine((value) => {
  const url = new URL(value)
  return url.protocol === "https:" && !url.username && !url.password
}, "URL must use HTTPS and must not contain credentials")
export const DownloadedRegistrySkillIconUrlSchema = z.string()
  .max(2_800_000)
  .regex(
    /^data:image\/(?:png|jpeg|webp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/i,
    "Downloaded skill icons must be base64-encoded PNG, JPEG, or WebP data URLs",
  )
export const RegistryRelativePathSchema = z.string().min(1).refine((value) => {
  if (value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value) || value.includes("\\")) return false
  if (/%(?:2e|2f|5c)/i.test(value)) return false
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false
  const segments = value.split("/")
  return segments.every((segment) => Boolean(segment) && segment !== "." && segment !== "..")
}, "Path must be a safe relative POSIX path")

export const RegistryCapabilitiesSchema = z.object({
  search: z.boolean(),
  browse: z.boolean(),
  detail: z.boolean(),
  versions: z.boolean(),
  files: z.boolean(),
  download: z.boolean(),
  security: z.boolean(),
})

export const RegistryProviderDescriptorSchema = z.object({
  id: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  description: z.string(),
  canonicalUrl: HttpUrlSchema,
  beta: z.boolean(),
  enabled: z.boolean(),
  configured: z.boolean(),
  capabilities: RegistryCapabilitiesSchema,
})

export const RegistrySkillAuthorSchema = z.object({
  handle: NonEmptyStringSchema,
  displayName: z.string().optional(),
  avatarUrl: HttpUrlSchema.optional(),
})

export const RegistrySkillStatsSchema = z.object({
  downloads: z.number().nonnegative().optional(),
  installs: z.number().nonnegative().optional(),
  stars: z.number().nonnegative().optional(),
  comments: z.number().nonnegative().optional(),
  versions: z.number().nonnegative().optional(),
})

export const RegistrySkillSourceSchema = z.object({
  repository: HttpUrlSchema.optional(),
  commit: NonEmptyStringSchema.optional(),
  path: RegistryRelativePathSchema.optional(),
})

export const RegistrySecurityStatusSchema = z.enum([
  "unknown",
  "pending",
  "clean",
  "suspicious",
  "malicious",
])

export const RegistrySecuritySignalSchema = z.object({
  scanner: NonEmptyStringSchema,
  status: RegistrySecurityStatusSchema,
  summary: z.string().optional(),
  url: HttpUrlSchema.optional(),
  checkedAt: OptionalTimestampSchema,
})

export const RegistrySecuritySnapshotSchema = z.object({
  provider: NonEmptyStringSchema,
  remoteId: NonEmptyStringSchema,
  version: OptionalVersionSchema,
  status: RegistrySecurityStatusSchema,
  blocked: z.boolean(),
  hasWarnings: z.boolean().optional(),
  reasons: z.array(z.string()),
  summary: z.string().optional(),
  checkedAt: OptionalTimestampSchema,
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  signals: z.array(RegistrySecuritySignalSchema).optional(),
})

export const RegistrySkillSummarySchema = z.object({
  id: NonEmptyStringSchema,
  provider: NonEmptyStringSchema,
  remoteId: NonEmptyStringSchema,
  slug: NonEmptyStringSchema,
  displayName: NonEmptyStringSchema,
  summary: z.string(),
  iconUrl: HttpUrlSchema.optional(),
  verified: z.boolean().optional(),
  requiresApiKey: z.boolean().optional(),
  author: RegistrySkillAuthorSchema,
  version: OptionalVersionSchema,
  canonicalUrl: HttpUrlSchema,
  topics: z.array(z.string()),
  os: z.array(z.string()).optional(),
  systems: z.array(z.string()).optional(),
  stats: RegistrySkillStatsSchema.optional(),
  score: z.number().optional(),
  createdAt: OptionalTimestampSchema,
  updatedAt: OptionalTimestampSchema,
  source: RegistrySkillSourceSchema.optional(),
  security: RegistrySecuritySnapshotSchema.optional(),
})

export const RegistryFileSchema = z.object({
  provider: NonEmptyStringSchema,
  remoteId: NonEmptyStringSchema,
  version: OptionalVersionSchema,
  path: RegistryRelativePathSchema,
  name: NonEmptyStringSchema,
  size: z.number().int().nonnegative().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  contentType: z.string().optional(),
})

export const RegistryFileContentSchema = RegistryFileSchema.extend({
  content: z.string(),
  encoding: z.literal("utf8"),
})

export const RegistryVersionSchema = z.object({
  provider: NonEmptyStringSchema,
  remoteId: NonEmptyStringSchema,
  version: NonEmptyStringSchema,
  createdAt: OptionalTimestampSchema,
  changelog: z.string().optional(),
  license: z.string().optional(),
  files: z.array(RegistryFileSchema).optional(),
  security: RegistrySecuritySnapshotSchema.optional(),
})

export const RegistrySkillDetailSchema = RegistrySkillSummarySchema.extend({
  description: z.string().optional(),
  latestVersion: RegistryVersionSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const RegistryProviderErrorCodeSchema = z.enum([
  "NOT_CONFIGURED",
  "INVALID_REQUEST",
  "NOT_SUPPORTED",
  "NOT_FOUND",
  "TIMEOUT",
  "RATE_LIMITED",
  "UPSTREAM_ERROR",
  "INVALID_RESPONSE",
  "UNAVAILABLE",
])

export const RegistryProviderErrorSchema = z.object({
  provider: NonEmptyStringSchema,
  code: RegistryProviderErrorCodeSchema,
  message: z.string(),
  retryAfterMs: z.number().int().nonnegative().optional(),
})

export const RegistrySearchSortSchema = z.enum([
  "relevance",
  "recommended",
  "updated",
  "newest",
  "downloads",
  "stars",
  "trending",
])

export const RegistrySearchInputSchema = z.object({
  query: z.string().trim().default(""),
  providers: z.array(NonEmptyStringSchema).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.record(z.string(), z.string()).optional(),
  sort: RegistrySearchSortSchema.default("relevance"),
  category: z.string().trim().min(1).optional(),
  safeOnly: z.boolean().default(true),
})

export const RegistrySearchPageSchema = z.object({
  items: z.array(RegistrySkillSummarySchema),
  nextCursor: z.record(z.string(), z.string()).optional(),
  errors: z.array(RegistryProviderErrorSchema),
})

export const RegistrySkillRefSchema = z.object({
  provider: NonEmptyStringSchema,
  remoteId: NonEmptyStringSchema,
})

export const RegistryVersionRefSchema = RegistrySkillRefSchema.extend({
  version: NonEmptyStringSchema.optional(),
})

export const RegistryFileRefSchema = RegistryVersionRefSchema.extend({
  path: RegistryRelativePathSchema,
})

const RegistryDownloadDescriptorBaseSchema = z.object({
  provider: NonEmptyStringSchema,
  remoteId: NonEmptyStringSchema,
  version: NonEmptyStringSchema,
})

export const RegistrySkillHubIntegrityProofSchema = z.object({
  kind: z.literal("skillhub-ed25519-v1"),
  keyId: NonEmptyStringSchema,
  publicKeyRawBase64: NonEmptyStringSchema,
  payload: NonEmptyStringSchema,
  signatureBase64: NonEmptyStringSchema,
})

export const RegistryDownloadDescriptorSchema = z.discriminatedUnion("kind", [
  RegistryDownloadDescriptorBaseSchema.extend({
    kind: z.literal("registry"),
    url: HttpUrlSchema,
    expectedSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  }),
  RegistryDownloadDescriptorBaseSchema.extend({
    kind: z.literal("archive"),
    url: HttpUrlSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    contentHashAlgorithm: z.literal("skillhub-v1").optional(),
    integrity: RegistrySkillHubIntegrityProofSchema.optional(),
    contentType: z.string().optional(),
  }).refine(
    (value) => {
      const hasContentHash = Boolean(value.contentHash)
      const hasAlgorithm = Boolean(value.contentHashAlgorithm)
      const hasIntegrity = Boolean(value.integrity)
      return hasContentHash === hasAlgorithm && hasAlgorithm === hasIntegrity
    },
    { message: "Signed archive content hash, algorithm, and integrity proof must be provided together" },
  ),
  RegistryDownloadDescriptorBaseSchema.extend({
    kind: z.literal("github"),
    repo: NonEmptyStringSchema,
    commit: NonEmptyStringSchema,
    path: z.string(),
    contentHash: NonEmptyStringSchema,
    archiveUrl: HttpUrlSchema,
  }),
])

export const RegistryLocalScanRiskSchema = z.enum(["none", "low", "medium", "high", "critical"])

export const RegistryLocalScanFindingSchema = z.object({
  code: NonEmptyStringSchema,
  risk: RegistryLocalScanRiskSchema,
  message: NonEmptyStringSchema,
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
})

export const RegistryLocalScanReportSchema = z.object({
  scannerVersion: NonEmptyStringSchema,
  risk: RegistryLocalScanRiskSchema,
  blocked: z.boolean(),
  findings: z.array(RegistryLocalScanFindingSchema),
  counts: z.object({
    low: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    critical: z.number().int().nonnegative(),
  }),
  scannedAt: z.number().int().nonnegative(),
})

export const DownloadedRegistryVersionSchema = z.object({
  version: NonEmptyStringSchema,
  packageRoot: NonEmptyStringSchema,
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  treeHash: z.string().regex(/^[a-f0-9]{64}$/i),
  installedAt: z.number().int().nonnegative(),
  source: z.object({
    kind: z.enum(["registry", "archive", "github"]),
    repo: z.string().optional(),
    commit: z.string().optional(),
    path: z.string().optional(),
    contentHash: z.string().optional(),
    contentHashAlgorithm: z.literal("skillhub-v1").optional(),
    signatureKeyId: z.string().optional(),
    signatureVerified: z.boolean().optional(),
  }),
  security: RegistrySecuritySnapshotSchema.optional(),
  localScan: RegistryLocalScanReportSchema,
})

export const DownloadedRegistrySkillSchema = z.object({
  id: NonEmptyStringSchema,
  provider: NonEmptyStringSchema,
  remoteId: NonEmptyStringSchema,
  slug: NonEmptyStringSchema,
  displayName: NonEmptyStringSchema,
  description: z.string(),
  iconUrl: DownloadedRegistrySkillIconUrlSchema.optional(),
  author: RegistrySkillAuthorSchema,
  os: z.array(z.string()).optional(),
  systems: z.array(z.string()).optional(),
  canonicalUrl: HttpUrlSchema,
  activeVersion: NonEmptyStringSchema,
  enabled: z.boolean(),
  packageRoot: NonEmptyStringSchema,
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  treeHash: z.string().regex(/^[a-f0-9]{64}$/i),
  downloadedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  upstreamSecurity: RegistrySecuritySnapshotSchema.optional(),
  localScan: RegistryLocalScanReportSchema.optional(),
  versions: z.array(DownloadedRegistryVersionSchema),
  /** @deprecated Use upstreamSecurity. */
  security: RegistrySecuritySnapshotSchema.optional(),
})

export const RegistryUpdateFileChangeStatusSchema = z.enum(["added", "removed", "changed"])

export const RegistryUpdateFileChangeSchema = z.object({
  path: RegistryRelativePathSchema,
  status: RegistryUpdateFileChangeStatusSchema,
  currentSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  targetSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  currentSize: z.number().int().nonnegative().optional(),
  targetSize: z.number().int().nonnegative().optional(),
})

export const RegistryUpdatePreviewSchema = z.object({
  id: NonEmptyStringSchema,
  currentVersion: NonEmptyStringSchema,
  targetVersion: NonEmptyStringSchema,
  updateAvailable: z.boolean(),
  alreadyDownloaded: z.boolean(),
  currentTreeHash: z.string().regex(/^[a-f0-9]{64}$/i),
  targetTreeHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  blocked: z.boolean(),
  fileChanges: z.array(RegistryUpdateFileChangeSchema).optional(),
  upstreamSecurity: RegistrySecuritySnapshotSchema.optional(),
})

export const RegistrySelectionImpactSchema = z.object({
  affectedProjectIDs: z.array(NonEmptyStringSchema),
  affectedProjectCount: z.number().int().nonnegative(),
})

export const DownloadedRegistrySkillSelectionResultSchema = DownloadedRegistrySkillSchema.extend({
  affectedProjectIDs: RegistrySelectionImpactSchema.shape.affectedProjectIDs,
  affectedProjectCount: RegistrySelectionImpactSchema.shape.affectedProjectCount,
})

export const DeletedRegistrySkillResultSchema = RegistrySelectionImpactSchema.extend({
  id: NonEmptyStringSchema,
  deleted: z.literal(true),
})

export type RegistryCapabilities = z.infer<typeof RegistryCapabilitiesSchema>
export type RegistryProviderDescriptor = z.infer<typeof RegistryProviderDescriptorSchema>
export type RegistrySkillAuthor = z.infer<typeof RegistrySkillAuthorSchema>
export type RegistrySkillStats = z.infer<typeof RegistrySkillStatsSchema>
export type RegistrySkillSource = z.infer<typeof RegistrySkillSourceSchema>
export type RegistrySecurityStatus = z.infer<typeof RegistrySecurityStatusSchema>
export type RegistrySecuritySignal = z.infer<typeof RegistrySecuritySignalSchema>
export type RegistrySecuritySnapshot = z.infer<typeof RegistrySecuritySnapshotSchema>
export type RegistrySkillSummary = z.infer<typeof RegistrySkillSummarySchema>
export type RegistrySkillDetail = z.infer<typeof RegistrySkillDetailSchema>
export type RegistryVersion = z.infer<typeof RegistryVersionSchema>
export type RegistryFile = z.infer<typeof RegistryFileSchema>
export type RegistryFileContent = z.infer<typeof RegistryFileContentSchema>
export type RegistryProviderErrorCode = z.infer<typeof RegistryProviderErrorCodeSchema>
export type RegistryProviderError = z.infer<typeof RegistryProviderErrorSchema>
export type RegistrySearchSort = z.infer<typeof RegistrySearchSortSchema>
export type RegistrySearchInput = z.infer<typeof RegistrySearchInputSchema>
export type RegistrySearchPage = z.infer<typeof RegistrySearchPageSchema>
export type RegistrySkillRef = z.infer<typeof RegistrySkillRefSchema>
export type RegistryVersionRef = z.infer<typeof RegistryVersionRefSchema>
export type RegistryFileRef = z.infer<typeof RegistryFileRefSchema>
export type RegistryDownloadDescriptor = z.infer<typeof RegistryDownloadDescriptorSchema>
export type RegistrySkillHubIntegrityProof = z.infer<typeof RegistrySkillHubIntegrityProofSchema>
export type RegistryLocalScanRisk = z.infer<typeof RegistryLocalScanRiskSchema>
export type RegistryLocalScanFinding = z.infer<typeof RegistryLocalScanFindingSchema>
export type RegistryLocalScanReport = z.infer<typeof RegistryLocalScanReportSchema>
export type DownloadedRegistryVersion = z.infer<typeof DownloadedRegistryVersionSchema>
export type DownloadedRegistrySkill = z.infer<typeof DownloadedRegistrySkillSchema>
export type RegistryUpdateFileChangeStatus = z.infer<typeof RegistryUpdateFileChangeStatusSchema>
export type RegistryUpdateFileChange = z.infer<typeof RegistryUpdateFileChangeSchema>
export type RegistryUpdatePreview = z.infer<typeof RegistryUpdatePreviewSchema>
export type RegistrySelectionImpact = z.infer<typeof RegistrySelectionImpactSchema>
export type DownloadedRegistrySkillSelectionResult = z.infer<typeof DownloadedRegistrySkillSelectionResultSchema>
export type DeletedRegistrySkillResult = z.infer<typeof DeletedRegistrySkillResultSchema>
