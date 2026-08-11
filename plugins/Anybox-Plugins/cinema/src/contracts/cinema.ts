import { z } from "zod"

export const CinemaNodeTypeSchema = z.enum([
  "text",
  "image",
  "video",
  "audio",
])
export type CinemaNodeType = z.infer<typeof CinemaNodeTypeSchema>

export const CinemaPositionSchema = z.object({
  x: z.number(),
  y: z.number(),
})
export type CinemaPosition = z.infer<typeof CinemaPositionSchema>

export const CinemaSizeSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
})
export type CinemaSize = z.infer<typeof CinemaSizeSchema>

export const CinemaViewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number().positive(),
})
export type CinemaViewport = z.infer<typeof CinemaViewportSchema>

export const CINEMA_ASSET_LIBRARY_SCHEMA_VERSION = 1 as const
export const CINEMA_ASSET_MAX_FOLDER_DEPTH = 8
export const CINEMA_ASSET_MAX_IMAGE_BYTES = 25 * 1024 * 1024
export const CINEMA_ASSET_MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024
export const CINEMA_ASSET_MAX_AUDIO_BYTES = 512 * 1024 * 1024

const WINDOWS_RESERVED_NAME_PATTERN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const INVALID_ASSET_NAME_CHARACTER_PATTERN = /[\u0000-\u001f<>:"/\\|?*]/

function isValidCinemaAssetName(value: string) {
  return (
    !INVALID_ASSET_NAME_CHARACTER_PATTERN.test(value)
    && !/[ .]$/.test(value)
    && !WINDOWS_RESERVED_NAME_PATTERN.test(value)
  )
}

function normalizedCinemaAssetNameSchema(maxLength: number, message: string) {
  return z.string()
    .min(1)
    .transform((value) => value.normalize("NFC"))
    .pipe(z.string().min(1).max(maxLength).refine(isValidCinemaAssetName, message))
}

export const CinemaAssetFolderNameSchema = normalizedCinemaAssetNameSchema(80, "Invalid asset folder name")
export type CinemaAssetFolderName = z.infer<typeof CinemaAssetFolderNameSchema>

export const CinemaAssetBaseNameSchema = normalizedCinemaAssetNameSchema(160, "Invalid asset name")
export type CinemaAssetBaseName = z.infer<typeof CinemaAssetBaseNameSchema>

export const CinemaAssetDisplayNameSchema = CinemaAssetBaseNameSchema
export type CinemaAssetDisplayName = z.infer<typeof CinemaAssetDisplayNameSchema>

export const CinemaAssetRelativePathSchema = z.string()
  .max(2048)
  .refine(
    (value) => !value.startsWith("/") && !value.startsWith("\\") && !/^[A-Za-z]:/.test(value),
    "Asset path must be relative",
  )
  .refine(
    (value) => value.split(/[\\/]/).every((segment) => segment !== ".."),
    "Asset path must not traverse outside the library",
  )
export type CinemaAssetRelativePath = z.infer<typeof CinemaAssetRelativePathSchema>

export const CinemaAssetKindSchema = z.enum(["image", "video", "audio"])
export type CinemaAssetKind = z.infer<typeof CinemaAssetKindSchema>

export const CinemaAssetScopeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("project"),
    projectID: z.string().min(1),
  }).strict(),
  z.object({
    type: z.literal("personal"),
  }).strict(),
])
export type CinemaAssetScope = z.infer<typeof CinemaAssetScopeSchema>

export const CinemaAssetLocatorSchema = z.object({
  scope: CinemaAssetScopeSchema,
  assetID: z.string().min(1),
})
export type CinemaAssetLocator = z.infer<typeof CinemaAssetLocatorSchema>

export const CinemaAssetSnapshotSchema = z.object({
  kind: CinemaAssetKindSchema,
  displayName: CinemaAssetDisplayNameSchema,
  mimeType: z.string().min(1),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSeconds: z.number().nonnegative().optional(),
})
export type CinemaAssetSnapshot = z.infer<typeof CinemaAssetSnapshotSchema>

export const CinemaAssetRefSchema = CinemaAssetLocatorSchema.extend({
  contentRevision: z.number().int().nonnegative(),
  snapshot: CinemaAssetSnapshotSchema,
})
export type CinemaAssetRef = z.infer<typeof CinemaAssetRefSchema>

export const CinemaAssetStatusSchema = z.enum([
  "uploading",
  "processing",
  "ready",
  "failed",
  "missing",
  "trashed",
])
export type CinemaAssetStatus = z.infer<typeof CinemaAssetStatusSchema>

export const CinemaAssetSourceSchema = z.enum([
  "upload",
  "generation",
  "crop",
  "render",
  "migration",
  "discovered",
])
export type CinemaAssetSource = z.infer<typeof CinemaAssetSourceSchema>

export const CinemaAssetFolderStatusSchema = z.enum(["active", "trashed", "missing"])
export type CinemaAssetFolderStatus = z.infer<typeof CinemaAssetFolderStatusSchema>

export const CinemaAssetTrashLocationSchema = z.object({
  operationID: z.string().min(1),
  originalFolderID: z.string().min(1),
  originalRelativePath: CinemaAssetRelativePathSchema,
  trashedRelativePath: CinemaAssetRelativePathSchema.refine((value) => value.length > 0),
  trashedAt: z.string().min(1),
  expiresAt: z.string().min(1).optional(),
  previousStatus: z.enum(["ready", "failed", "missing"]).optional(),
})
export type CinemaAssetTrashLocation = z.infer<typeof CinemaAssetTrashLocationSchema>

export const CinemaAssetFolderTrashLocationSchema = z.object({
  operationID: z.string().min(1),
  originalParentID: z.string().min(1),
  originalRelativePath: CinemaAssetRelativePathSchema,
  trashedRelativePath: CinemaAssetRelativePathSchema.refine((value) => value.length > 0),
  trashedAt: z.string().min(1),
  expiresAt: z.string().min(1).optional(),
})
export type CinemaAssetFolderTrashLocation = z.infer<typeof CinemaAssetFolderTrashLocationSchema>

export const CinemaAssetFolderSchema = z.object({
  id: z.string().min(1),
  parentID: z.string().min(1).nullable(),
  name: CinemaAssetFolderNameSchema,
  relativePath: CinemaAssetRelativePathSchema,
  depth: z.number().int().min(0).max(CINEMA_ASSET_MAX_FOLDER_DEPTH),
  system: z.boolean().default(false),
  status: CinemaAssetFolderStatusSchema.default("active"),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  trash: CinemaAssetFolderTrashLocationSchema.optional(),
})
export type CinemaAssetFolder = z.infer<typeof CinemaAssetFolderSchema>

export const CinemaAssetRecordSchema = z.object({
  id: z.string().min(1),
  folderID: z.string().min(1),
  relativePath: CinemaAssetRelativePathSchema.refine((value) => value.length > 0, "Asset path is required"),
  displayName: CinemaAssetDisplayNameSchema,
  kind: CinemaAssetKindSchema,
  source: CinemaAssetSourceSchema,
  status: CinemaAssetStatusSchema,
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  checksum: z.string().min(1),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  fps: z.number().positive().optional(),
  hasAudio: z.boolean().optional(),
  thumbnailPath: CinemaAssetRelativePathSchema.refine((value) => value.length > 0).optional(),
  previewPath: CinemaAssetRelativePathSchema.refine((value) => value.length > 0).optional(),
  contentRevision: z.number().int().nonnegative(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  failureReason: z.string().min(1).optional(),
  trash: CinemaAssetTrashLocationSchema.optional(),
})
export type CinemaAssetRecord = z.infer<typeof CinemaAssetRecordSchema>

export const CinemaAssetLibraryStatusSchema = z.enum(["ready", "recovery-required"])
export type CinemaAssetLibraryStatus = z.infer<typeof CinemaAssetLibraryStatusSchema>

export const CinemaAssetLibraryOperationSchema = z.object({
  operationID: z.string().min(1),
  type: z.string().min(1),
  revision: z.number().int().nonnegative(),
  completedAt: z.string().min(1),
  result: z.unknown().optional(),
})
export type CinemaAssetLibraryOperation = z.infer<typeof CinemaAssetLibraryOperationSchema>

export const CinemaAssetCatalogSchema = z.object({
  schemaVersion: z.literal(CINEMA_ASSET_LIBRARY_SCHEMA_VERSION),
  scope: CinemaAssetScopeSchema,
  revision: z.number().int().nonnegative().default(0),
  status: CinemaAssetLibraryStatusSchema.default("ready"),
  rootFolderID: z.string().min(1),
  folders: z.array(CinemaAssetFolderSchema).default([]),
  assets: z.array(CinemaAssetRecordSchema).default([]),
  completedOperationIDs: z.array(z.string().min(1)).default([]),
  operations: z.record(z.string(), CinemaAssetLibraryOperationSchema).default({}),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})
export type CinemaAssetCatalog = z.infer<typeof CinemaAssetCatalogSchema>

export const CinemaAssetFolderEntrySchema = z.object({
  entryType: z.literal("folder"),
  folder: CinemaAssetFolderSchema,
})
export type CinemaAssetFolderEntry = z.infer<typeof CinemaAssetFolderEntrySchema>

export const CinemaAssetEntrySchema = z.object({
  entryType: z.literal("asset"),
  asset: CinemaAssetRecordSchema,
})
export type CinemaAssetEntry = z.infer<typeof CinemaAssetEntrySchema>

export const CinemaAssetLibraryEntrySchema = z.discriminatedUnion("entryType", [
  CinemaAssetFolderEntrySchema,
  CinemaAssetEntrySchema,
])
export type CinemaAssetLibraryEntry = z.infer<typeof CinemaAssetLibraryEntrySchema>

export const CinemaAssetLibraryLimitsSchema = z.object({
  maxFolderDepth: z.number().int().positive().default(CINEMA_ASSET_MAX_FOLDER_DEPTH),
  maxImageBytes: z.number().int().positive().default(CINEMA_ASSET_MAX_IMAGE_BYTES),
  maxVideoBytes: z.number().int().positive().default(CINEMA_ASSET_MAX_VIDEO_BYTES),
  maxAudioBytes: z.number().int().positive().default(CINEMA_ASSET_MAX_AUDIO_BYTES),
})
export type CinemaAssetLibraryLimits = z.infer<typeof CinemaAssetLibraryLimitsSchema>

export const CinemaAssetLibraryCountsSchema = z.object({
  folders: z.number().int().nonnegative(),
  assets: z.number().int().nonnegative(),
  processing: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
  trashed: z.number().int().nonnegative(),
})
export type CinemaAssetLibraryCounts = z.infer<typeof CinemaAssetLibraryCountsSchema>

export const CinemaAssetLibraryStateSchema = z.object({
  scope: CinemaAssetScopeSchema,
  revision: z.number().int().nonnegative(),
  status: CinemaAssetLibraryStatusSchema,
  readOnly: z.boolean(),
  rootFolderID: z.string().min(1),
  defaultFolderIDs: z.record(z.string(), z.string().min(1)),
  limits: CinemaAssetLibraryLimitsSchema,
  counts: CinemaAssetLibraryCountsSchema,
  updatedAt: z.string().min(1),
})
export type CinemaAssetLibraryState = z.infer<typeof CinemaAssetLibraryStateSchema>

export const CinemaAssetLibraryEntriesViewSchema = z.enum(["library", "trash"])
export type CinemaAssetLibraryEntriesView = z.infer<typeof CinemaAssetLibraryEntriesViewSchema>

export const CinemaAssetLibraryEntriesQuerySchema = z.object({
  folderID: z.string().min(1).optional(),
  q: z.string().max(500).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  view: CinemaAssetLibraryEntriesViewSchema.default("library"),
})
export type CinemaAssetLibraryEntriesQuery = z.infer<typeof CinemaAssetLibraryEntriesQuerySchema>

export const CinemaAssetLibraryEntriesResultSchema = z.object({
  scope: CinemaAssetScopeSchema,
  revision: z.number().int().nonnegative(),
  view: CinemaAssetLibraryEntriesViewSchema.default("library"),
  folder: CinemaAssetFolderSchema.nullable(),
  breadcrumbs: z.array(CinemaAssetFolderSchema).default([]),
  query: z.string().default(""),
  entries: z.array(CinemaAssetLibraryEntrySchema),
  nextCursor: z.string().min(1).nullable().default(null),
  total: z.number().int().nonnegative().optional(),
})
export type CinemaAssetLibraryEntriesResult = z.infer<typeof CinemaAssetLibraryEntriesResultSchema>

export const CinemaAssetEntryTargetSchema = z.discriminatedUnion("entryType", [
  z.object({
    entryType: z.literal("folder"),
    folderID: z.string().min(1),
  }),
  z.object({
    entryType: z.literal("asset"),
    assetID: z.string().min(1),
  }),
])
export type CinemaAssetEntryTarget = z.infer<typeof CinemaAssetEntryTargetSchema>

export const CinemaAssetMutationBaseSchema = z.object({
  operationID: z.string().min(1),
  baseRevision: z.number().int().nonnegative(),
})
export type CinemaAssetMutationBase = z.infer<typeof CinemaAssetMutationBaseSchema>

export const CreateCinemaAssetFolderBodySchema = CinemaAssetMutationBaseSchema.extend({
  parentFolderID: z.string().min(1),
  name: CinemaAssetFolderNameSchema,
})
export type CreateCinemaAssetFolderBody = z.infer<typeof CreateCinemaAssetFolderBodySchema>

export const UpdateCinemaAssetFolderBodySchema = CinemaAssetMutationBaseSchema.extend({
  name: CinemaAssetFolderNameSchema,
})
export type UpdateCinemaAssetFolderBody = z.infer<typeof UpdateCinemaAssetFolderBodySchema>

export const MoveCinemaAssetEntriesBodySchema = CinemaAssetMutationBaseSchema.extend({
  entries: z.array(CinemaAssetEntryTargetSchema).min(1),
  destinationFolderID: z.string().min(1),
}).refine(
  (body) => !body.entries.some(
    (entry) => entry.entryType === "folder" && entry.folderID === body.destinationFolderID,
  ),
  {
    message: "A folder cannot be moved into itself",
    path: ["destinationFolderID"],
  },
)
export type MoveCinemaAssetEntriesBody = z.infer<typeof MoveCinemaAssetEntriesBodySchema>

export const TrashCinemaAssetEntriesBodySchema = CinemaAssetMutationBaseSchema.extend({
  entries: z.array(CinemaAssetEntryTargetSchema).min(1),
})
export type TrashCinemaAssetEntriesBody = z.infer<typeof TrashCinemaAssetEntriesBodySchema>

export const RestoreCinemaAssetEntriesBodySchema = CinemaAssetMutationBaseSchema.extend({
  entries: z.array(CinemaAssetEntryTargetSchema).min(1),
})
export type RestoreCinemaAssetEntriesBody = z.infer<typeof RestoreCinemaAssetEntriesBodySchema>

export const PermanentlyDeleteCinemaAssetEntriesBodySchema = CinemaAssetMutationBaseSchema.extend({
  entries: z.array(CinemaAssetEntryTargetSchema).min(1).optional(),
  all: z.literal(true).optional(),
}).refine(
  (body) => body.all === true ? body.entries === undefined : body.entries !== undefined,
  {
    message: "Provide either entries or all: true, but not both",
    path: ["entries"],
  },
)
export type PermanentlyDeleteCinemaAssetEntriesBody = z.infer<typeof PermanentlyDeleteCinemaAssetEntriesBodySchema>

export const UpdateCinemaAssetBodySchema = CinemaAssetMutationBaseSchema.extend({
  baseName: CinemaAssetBaseNameSchema,
})
export type UpdateCinemaAssetBody = z.infer<typeof UpdateCinemaAssetBodySchema>

export const RetryCinemaAssetProcessingBodySchema = CinemaAssetMutationBaseSchema
export type RetryCinemaAssetProcessingBody = z.infer<typeof RetryCinemaAssetProcessingBodySchema>

export const ReconcileCinemaAssetLibraryBodySchema = CinemaAssetMutationBaseSchema.extend({
  full: z.boolean().default(true),
})
export type ReconcileCinemaAssetLibraryBody = z.infer<typeof ReconcileCinemaAssetLibraryBodySchema>

export const CinemaAssetUploadRequestSchema = CinemaAssetMutationBaseSchema.extend({
  folderID: z.string().min(1),
  fileName: CinemaAssetDisplayNameSchema,
})
export type CinemaAssetUploadRequest = z.infer<typeof CinemaAssetUploadRequestSchema>

export const CinemaAssetMutationResultSchema = z.object({
  scope: CinemaAssetScopeSchema,
  operationID: z.string().min(1),
  revision: z.number().int().nonnegative(),
  affected: z.array(CinemaAssetEntryTargetSchema).default([]),
  warnings: z.array(z.string().min(1)).default([]),
  undoUntil: z.string().min(1).optional(),
})
export type CinemaAssetMutationResult = z.infer<typeof CinemaAssetMutationResultSchema>

export const CinemaAssetFolderMutationResultSchema = CinemaAssetMutationResultSchema.extend({
  folder: CinemaAssetFolderSchema,
})
export type CinemaAssetFolderMutationResult = z.infer<typeof CinemaAssetFolderMutationResultSchema>

export const CinemaAssetRecordMutationResultSchema = CinemaAssetMutationResultSchema.extend({
  asset: CinemaAssetRecordSchema,
})
export type CinemaAssetRecordMutationResult = z.infer<typeof CinemaAssetRecordMutationResultSchema>

export const CinemaAssetUploadErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
})
export type CinemaAssetUploadError = z.infer<typeof CinemaAssetUploadErrorSchema>

export const CinemaAssetUploadItemResultSchema = z.discriminatedUnion("success", [
  z.object({
    fileName: CinemaAssetDisplayNameSchema,
    success: z.literal(true),
    asset: CinemaAssetRecordSchema,
  }),
  z.object({
    fileName: CinemaAssetDisplayNameSchema,
    success: z.literal(false),
    error: CinemaAssetUploadErrorSchema,
  }),
])
export type CinemaAssetUploadItemResult = z.infer<typeof CinemaAssetUploadItemResultSchema>

export const CinemaAssetUploadResultSchema = z.object({
  scope: CinemaAssetScopeSchema,
  operationID: z.string().min(1),
  revision: z.number().int().nonnegative(),
  items: z.array(CinemaAssetUploadItemResultSchema).min(1),
})
export type CinemaAssetUploadResult = z.infer<typeof CinemaAssetUploadResultSchema>

export const CinemaAssetMigrationPhaseSchema = z.enum([
  "not-required",
  "required",
  "ready",
  "running",
  "rolling-back",
  "completed",
  "failed",
  "recovery-required",
])
export type CinemaAssetMigrationPhase = z.infer<typeof CinemaAssetMigrationPhaseSchema>

export const CinemaAssetMigrationCandidateSchema = z.object({
  id: z.string().min(1),
  sourcePath: CinemaAssetRelativePathSchema.refine((value) => value.length > 0),
  destinationFolderID: z.string().min(1),
  kind: CinemaAssetKindSchema,
  sizeBytes: z.number().int().nonnegative(),
  selected: z.boolean().default(true),
  issue: z.string().min(1).optional(),
})
export type CinemaAssetMigrationCandidate = z.infer<typeof CinemaAssetMigrationCandidateSchema>

export const CinemaAssetMigrationStatusResultSchema = z.object({
  projectID: z.string().min(1),
  phase: CinemaAssetMigrationPhaseSchema,
  readOnly: z.boolean(),
  candidateCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  unrecognizedCount: z.number().int().nonnegative(),
  candidates: z.array(CinemaAssetMigrationCandidateSchema).default([]),
  error: z.string().min(1).optional(),
})
export type CinemaAssetMigrationStatusResult = z.infer<typeof CinemaAssetMigrationStatusResultSchema>

export const StartCinemaAssetMigrationBodySchema = CinemaAssetMutationBaseSchema.extend({
  candidateIDs: z.array(z.string().min(1)).default([]),
})
export type StartCinemaAssetMigrationBody = z.infer<typeof StartCinemaAssetMigrationBodySchema>

export const CinemaAssetMigrationResultSchema = z.object({
  projectID: z.string().min(1),
  operationID: z.string().min(1),
  phase: CinemaAssetMigrationPhaseSchema,
  revision: z.number().int().nonnegative(),
  migratedAssetIDs: z.array(z.string().min(1)).default([]),
  warnings: z.array(z.string().min(1)).default([]),
  error: z.string().min(1).optional(),
})
export type CinemaAssetMigrationResult = z.infer<typeof CinemaAssetMigrationResultSchema>

export const CinemaCanvasNodeSchema = z.object({
  id: z.string().min(1),
  type: CinemaNodeTypeSchema,
  title: z.string().min(1),
  position: CinemaPositionSchema,
  size: CinemaSizeSchema.optional(),
  data: z.record(z.string(), z.unknown()).optional(),
})
export type CinemaCanvasNode = z.infer<typeof CinemaCanvasNodeSchema>

export const CinemaCanvasEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().min(1).optional(),
  targetHandle: z.string().min(1).optional(),
  label: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
})
export type CinemaCanvasEdge = z.infer<typeof CinemaCanvasEdgeSchema>

export const CinemaCanvasDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  // The outer optional preserves source compatibility for callers constructing legacy canvases,
  // while Zod 4 still applies the nested default when parsing an omitted revision.
  revision: z.number().int().nonnegative().default(0).optional(),
  canvasType: z.literal("node-canvas"),
  viewport: CinemaViewportSchema,
  nodes: z.array(CinemaCanvasNodeSchema),
  edges: z.array(CinemaCanvasEdgeSchema).default([]),
  nodeTypes: z.array(CinemaNodeTypeSchema).default([]),
})
export type CinemaCanvasDocument = z.infer<typeof CinemaCanvasDocumentSchema>

export const CinemaCanvasNodePatchSchema = z.object({
  type: CinemaNodeTypeSchema.optional(),
  title: z.string().min(1).optional(),
  position: CinemaPositionSchema.optional(),
  size: CinemaSizeSchema.optional(),
  data: z.record(z.string(), z.unknown()).optional(),
}).refine((patch) => Object.keys(patch).length > 0, "Patch must include at least one field")
export type CinemaCanvasNodePatch = z.infer<typeof CinemaCanvasNodePatchSchema>

const CinemaCommandBaseSchema = z.object({
  id: z.string().min(1),
  actor: z.string().min(1).optional(),
  baseRevision: z.number().int().nonnegative(),
})

export const CinemaCommandSchema = z.discriminatedUnion("type", [
  CinemaCommandBaseSchema.extend({
    type: z.literal("create-node"),
    node: CinemaCanvasNodeSchema,
  }),
  CinemaCommandBaseSchema.extend({
    type: z.literal("create-node-from-asset"),
    nodeID: z.string().min(1),
    assetRef: CinemaAssetLocatorSchema,
    position: CinemaPositionSchema,
  }),
  CinemaCommandBaseSchema.extend({
    type: z.literal("relink-node-asset"),
    nodeID: z.string().min(1),
    assetRef: CinemaAssetLocatorSchema,
  }),
  CinemaCommandBaseSchema.extend({
    type: z.literal("update-node"),
    nodeID: z.string().min(1),
    patch: CinemaCanvasNodePatchSchema,
  }),
  CinemaCommandBaseSchema.extend({
    type: z.literal("delete-node"),
    nodeID: z.string().min(1),
  }),
  CinemaCommandBaseSchema.extend({
    type: z.literal("connect-nodes"),
    edge: CinemaCanvasEdgeSchema,
  }),
  CinemaCommandBaseSchema.extend({
    type: z.literal("disconnect-edge"),
    edgeID: z.string().min(1),
  }),
  CinemaCommandBaseSchema.extend({
    type: z.literal("update-viewport"),
    viewport: CinemaViewportSchema,
  }),
])
export type CinemaCommand = z.infer<typeof CinemaCommandSchema>

export const CinemaProjectEventSchema = z.object({
  time: z.string().min(1),
  type: z.string().min(1),
  actor: z.string().min(1),
  message: z.string().min(1),
  commandID: z.string().min(1).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
})
export type CinemaProjectEvent = z.infer<typeof CinemaProjectEventSchema>

export const CinemaCommandResultSchema = z.object({
  canvas: CinemaCanvasDocumentSchema,
  event: CinemaProjectEventSchema,
})
export type CinemaCommandResult = z.infer<typeof CinemaCommandResultSchema>

export const CinemaEventsResultSchema = z.object({
  events: z.array(CinemaProjectEventSchema),
  nextCursor: z.number().int().nonnegative(),
})
export type CinemaEventsResult = z.infer<typeof CinemaEventsResultSchema>

export const KnownCinemaGenerationModeSchema = z.enum([
  "text-to-video",
  "image-to-video",
  "frames-to-video",
  "reference-to-video",
  "video-to-video",
  "edit",
  "extend",
  "motion-control",
])
export type KnownCinemaGenerationMode = z.infer<typeof KnownCinemaGenerationModeSchema>

export const CinemaGenerationModeSchema = z.string().min(1)
export type CinemaGenerationMode = z.infer<typeof CinemaGenerationModeSchema>

export const KnownCinemaProviderModelModeSchema = z.enum([
  ...KnownCinemaGenerationModeSchema.options,
  "text-to-image",
  "image-to-image",
  "image-edit",
  "omni-image",
])
export type KnownCinemaProviderModelMode = z.infer<typeof KnownCinemaProviderModelModeSchema>

export const CinemaProviderModelModeSchema = z.string().min(1)
export type CinemaProviderModelMode = z.infer<typeof CinemaProviderModelModeSchema>

export const CinemaTaskModeSchema = CinemaProviderModelModeSchema
export type CinemaTaskMode = z.infer<typeof CinemaTaskModeSchema>

export const CinemaProviderEndpointMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])
export type CinemaProviderEndpointMethod = z.infer<typeof CinemaProviderEndpointMethodSchema>

export const CinemaProviderTaskQueryEndpointSchema = z.object({
  method: CinemaProviderEndpointMethodSchema.optional(),
  path: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
}).passthrough()
export type CinemaProviderTaskQueryEndpoint = z.infer<typeof CinemaProviderTaskQueryEndpointSchema>

export const CinemaProviderEndpointSchema = z.object({
  method: CinemaProviderEndpointMethodSchema.optional(),
  path: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
  taskQuery: CinemaProviderTaskQueryEndpointSchema.optional(),
}).passthrough()
export type CinemaProviderEndpoint = z.infer<typeof CinemaProviderEndpointSchema>

export const GenerationControlOptionSchema = z.union([z.string(), z.number(), z.boolean()])
export type GenerationControlOption = z.infer<typeof GenerationControlOptionSchema>

export const GenerationControlVisibilitySchema = z.record(z.string(), z.unknown())
export type GenerationControlVisibility = z.infer<typeof GenerationControlVisibilitySchema>

export const ProviderInputUIControlSchema = z.enum([
  "text",
  "textarea",
  "select",
  "segmented",
  "number",
  "switch",
  "media",
  "image-list",
  "json",
])
export type ProviderInputUIControl = z.infer<typeof ProviderInputUIControlSchema>

const GenerationControlBaseSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  required: z.boolean(),
  description: z.string().optional(),
  visibleWhen: GenerationControlVisibilitySchema.optional(),
  disabledWhen: GenerationControlVisibilitySchema.optional(),
})

export const GenerationControlSchema = z.discriminatedUnion("type", [
  GenerationControlBaseSchema.extend({
    type: z.literal("text"),
    multiline: z.boolean().optional(),
    maxLength: z.number().int().positive().optional(),
    placeholder: z.string().optional(),
    defaultValue: z.string().optional(),
  }),
  GenerationControlBaseSchema.extend({
    type: z.literal("prompt"),
    multiline: z.boolean().optional(),
    maxLength: z.number().int().positive().optional(),
    placeholder: z.string().optional(),
    defaultValue: z.string().optional(),
  }),
  GenerationControlBaseSchema.extend({
    type: z.literal("media"),
    mediaKind: z.enum(["image", "video", "audio"]),
    multiple: z.boolean().optional(),
    minCount: z.number().int().nonnegative().optional(),
    maxCount: z.number().int().nonnegative().optional(),
    supportedMimeTypes: z.array(z.string().min(1)).optional(),
    maxFileSizeMB: z.number().positive().optional(),
    acceptsConnection: z.boolean().optional(),
  }),
  GenerationControlBaseSchema.extend({
    type: z.literal("image-list"),
    minCount: z.number().int().nonnegative().optional(),
    maxCount: z.number().int().nonnegative().optional(),
    supportedFormats: z.array(z.string().min(1)).optional(),
    maxFileSizeMB: z.number().positive().optional(),
  }),
  GenerationControlBaseSchema.extend({
    type: z.literal("select"),
    options: z.array(GenerationControlOptionSchema),
    labels: z.record(z.string(), z.string()).optional(),
    defaultValue: z.unknown().optional(),
  }),
  GenerationControlBaseSchema.extend({
    type: z.literal("number"),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
    integer: z.boolean().optional(),
    defaultValue: z.number().optional(),
  }),
  GenerationControlBaseSchema.extend({
    type: z.literal("boolean"),
    defaultValue: z.boolean().optional(),
  }),
  GenerationControlBaseSchema.extend({
    type: z.literal("json"),
    serializedObjectOnly: z.boolean().optional(),
    defaultValue: z.unknown().optional(),
  }),
])
export type GenerationControl = z.infer<typeof GenerationControlSchema>

export const CinemaGenerationTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("model"),
    modelID: z.string().min(1),
  }).strict(),
  z.object({
    kind: z.literal("workflow"),
    workflowID: z.string().min(1),
    revision: z.string().min(1),
    connectionID: z.string().min(1).optional(),
  }).strict(),
])
export type CinemaGenerationTarget = z.infer<typeof CinemaGenerationTargetSchema>

function validateLegacyGenerationTarget(
  value: { target?: CinemaGenerationTarget; modelID?: string },
  ctx: z.RefinementCtx,
) {
  if (value.target && value.modelID) {
    ctx.addIssue({
      code: "custom",
      message: "Use either 'target' or legacy 'modelID', not both.",
      path: ["target"],
    })
  }
  if (!value.target && !value.modelID) {
    ctx.addIssue({
      code: "custom",
      message: "A generation target is required.",
      path: ["target"],
    })
  }
}

const GenerationFormSpecInputSchema = z.object({
  providerID: z.string().min(1),
  target: CinemaGenerationTargetSchema.optional(),
  modelID: z.string().min(1).optional(),
  mode: z.string().min(1),
  output: z.enum(["image", "video"]),
  controls: z.array(GenerationControlSchema),
})
export const GenerationFormSpecSchema = GenerationFormSpecInputSchema
  .superRefine(validateLegacyGenerationTarget)
  .transform(({ modelID, ...value }) => ({
    ...value,
    target: value.target ?? { kind: "model" as const, modelID: modelID! },
  }))
export type GenerationFormSpec = z.infer<typeof GenerationFormSpecSchema>

export const CinemaProviderWorkflowStatusSchema = z.enum(["ready", "disabled"])
export type CinemaProviderWorkflowStatus = z.infer<typeof CinemaProviderWorkflowStatusSchema>

export const CinemaProviderWorkflowIssueSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(["error", "warning"]).default("error"),
  nodeID: z.string().min(1).optional(),
  nodeType: z.string().min(1).optional(),
  controlKey: z.string().min(1).optional(),
  dependency: z.string().min(1).optional(),
})
export type CinemaProviderWorkflowIssue = z.infer<typeof CinemaProviderWorkflowIssueSchema>

export const CinemaProviderWorkflowDependencySchema = z.object({
  kind: z.enum(["node", "model"]),
  name: z.string().min(1),
  available: z.boolean(),
  folder: z.string().min(1).optional(),
  nodeID: z.string().min(1).optional(),
})
export type CinemaProviderWorkflowDependency = z.infer<typeof CinemaProviderWorkflowDependencySchema>

export const CinemaProviderWorkflowOutputSchema = z.object({
  kind: z.enum(["image", "video", "audio", "3d", "file", "unknown"]),
  nodeIDs: z.array(z.string().min(1)).min(1),
})
export type CinemaProviderWorkflowOutput = z.infer<typeof CinemaProviderWorkflowOutputSchema>

export const CinemaProviderWorkflowSourceSchema = z.object({
  userID: z.string().min(1),
  path: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  modifiedAt: z.string().min(1).optional(),
  workflowFormat: z.enum(["0.4", "1.0", "unknown"]),
  converter: z.enum(["server", "builtin"]),
})
export type CinemaProviderWorkflowSource = z.infer<typeof CinemaProviderWorkflowSourceSchema>

export const CinemaProviderWorkflowSchema = z.object({
  workflowID: z.string().min(1),
  revision: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  status: CinemaProviderWorkflowStatusSchema,
  issues: z.array(CinemaProviderWorkflowIssueSchema).default([]),
  dependencies: z.array(CinemaProviderWorkflowDependencySchema).default([]),
  output: CinemaProviderWorkflowOutputSchema.optional(),
  formSpec: GenerationFormSpecSchema.optional(),
  source: CinemaProviderWorkflowSourceSchema,
  discoveredAt: z.string().min(1),
})
export type CinemaProviderWorkflow = z.infer<typeof CinemaProviderWorkflowSchema>

export const CinemaProviderWorkflowUserSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
})
export type CinemaProviderWorkflowUser = z.infer<typeof CinemaProviderWorkflowUserSchema>

export const CinemaProviderWorkflowCatalogSchema = z.object({
  providerID: z.string().min(1),
  status: z.enum(["ready", "stale", "offline"]),
  userID: z.string().min(1).nullable(),
  users: z.array(CinemaProviderWorkflowUserSchema).default([]),
  workflows: z.array(CinemaProviderWorkflowSchema).default([]),
  issues: z.array(CinemaProviderWorkflowIssueSchema).default([]),
  refreshedAt: z.string().min(1),
  lastSuccessfulRefreshAt: z.string().min(1).optional(),
  limits: z.object({
    maxWorkflows: z.number().int().positive(),
    maxFileBytes: z.number().int().positive(),
    maxTotalBytes: z.number().int().positive(),
    readConcurrency: z.number().int().positive(),
  }),
})
export type CinemaProviderWorkflowCatalog = z.infer<typeof CinemaProviderWorkflowCatalogSchema>

export const CinemaProviderInputSpecSchema = z.object({
  role: z.string().min(1),
  modality: z.string().min(1),
  required: z.boolean().default(false),
  minCount: z.number().int().nonnegative().default(0),
  maxCount: z.number().int().nonnegative().optional(),
  apiField: z.string().min(1).optional(),
  connectionKey: z.string().min(1).optional(),
  providerField: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  maxLength: z.number().int().positive().optional(),
  default: z.unknown().optional(),
  options: z.array(GenerationControlOptionSchema).optional(),
  labels: z.record(z.string(), z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
  integer: z.boolean().optional(),
  multiline: z.boolean().optional(),
  placeholder: z.string().optional(),
  supportedFormats: z.array(z.string().min(1)).optional(),
  maxFileSizeMB: z.number().positive().optional(),
  uiControl: ProviderInputUIControlSchema.optional(),
  uiGroup: z.string().min(1).optional(),
  uiOrder: z.number().optional(),
  visibleWhen: GenerationControlVisibilitySchema.optional(),
  disabledWhen: GenerationControlVisibilitySchema.optional(),
  note: z.string().min(1).optional(),
}).passthrough()
export type CinemaProviderInputSpec = z.infer<typeof CinemaProviderInputSpecSchema>

export const CinemaProviderInputRequirementSchema = z.object({
  roles: z.array(z.string().min(1)).default([]),
  minTotalCount: z.number().int().nonnegative().optional(),
  note: z.string().min(1).optional(),
}).passthrough()
export type CinemaProviderInputRequirement = z.infer<typeof CinemaProviderInputRequirementSchema>

export const CinemaProviderInputCombinationSchema = z.object({
  mode: z.string().min(1),
  label: z.string().min(1).optional(),
  requiredModalities: z.array(z.string().min(1)).default([]),
  optionalModalities: z.array(z.string().min(1)).default([]),
  inputs: z.array(CinemaProviderInputSpecSchema).default([]),
  requirements: z.array(CinemaProviderInputRequirementSchema).default([]),
  endpoint: CinemaProviderEndpointSchema.optional(),
  note: z.string().min(1).optional(),
})
export type CinemaProviderInputCombination = z.infer<typeof CinemaProviderInputCombinationSchema>

export const CinemaGenerationTaskStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
])
export type CinemaGenerationTaskStatus = z.infer<typeof CinemaGenerationTaskStatusSchema>

export const CinemaGenerationProgressPhaseSchema = z.enum([
  "preparing",
  "queued",
  "submitted",
  "processing",
  "downloading",
  "finalizing",
  "succeeded",
  "failed",
  "canceled",
])
export type CinemaGenerationProgressPhase = z.infer<typeof CinemaGenerationProgressPhaseSchema>

export const CinemaGenerationProgressSchema = z.object({
  phase: CinemaGenerationProgressPhaseSchema,
  percent: z.number().min(0).max(100).optional(),
  message: z.string().min(1).optional(),
  updatedAt: z.string().min(1).optional(),
})
export type CinemaGenerationProgress = z.infer<typeof CinemaGenerationProgressSchema>

export const CinemaGeneratedAssetSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["video", "image", "audio", "file"]),
  path: z.string().min(1),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  url: z.string().url().optional(),
  assetRef: CinemaAssetRefSchema.optional(),
})
export type CinemaGeneratedAsset = z.infer<typeof CinemaGeneratedAssetSchema>

export const CinemaImageNodeSourceKindSchema = z.enum(["upload", "generation", "crop"])
export type CinemaImageNodeSourceKind = z.infer<typeof CinemaImageNodeSourceKindSchema>

export const CinemaImageNodeAssetSchema = CinemaGeneratedAssetSchema.extend({
  kind: z.literal("image"),
})
export type CinemaImageNodeAsset = z.infer<typeof CinemaImageNodeAssetSchema>

export const CinemaImageNodeDataSchema = z.object({
  asset: CinemaImageNodeAssetSchema.optional(),
  candidateAssets: z.array(CinemaImageNodeAssetSchema).optional(),
  selectedCandidateAssetID: z.string().min(1).optional(),
  sourceKind: CinemaImageNodeSourceKindSchema.optional(),
  sourceFileName: z.string().min(1).optional(),
  importedAt: z.string().min(1).optional(),
  prompt: z.string().optional(),
  model: z.string().min(1).optional(),
  providerID: z.string().min(1).optional(),
  modelID: z.string().min(1).optional(),
  taskID: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  progress: CinemaGenerationProgressSchema.optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  generatedAt: z.string().min(1).optional(),
  error: z.string().nullable().optional(),
}).passthrough()
export type CinemaImageNodeData = z.infer<typeof CinemaImageNodeDataSchema>

export const CinemaVideoProviderManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  kind: z.string().optional(),
  baseURL: z.string().optional(),
  website: z.string().optional(),
  doc: z.string().optional(),
  regions: z.array(z.string().min(1)).default([]),
  authType: z.string().optional(),
  catalogSource: z.string().optional(),
  credentialProviderID: z.string().min(1).optional(),
  requiresCredential: z.boolean().default(false),
  capabilities: z.object({
    workflowDiscovery: z.boolean().default(false),
    appMode: z.boolean().default(false),
  }).optional(),
  connectionTest: z.object({
    method: z.enum(["GET", "POST", "HEAD"]).default("GET"),
    url: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    auth: z.enum(["bearer", "x-api-key", "query", "none"]).default("bearer"),
    apiKeyHeader: z.string().min(1).optional(),
    apiKeyQueryParam: z.string().min(1).optional(),
    headers: z.record(z.string(), z.string()).default({}),
    body: z.unknown().optional(),
    expectedStatus: z.array(z.number().int().min(100).max(599)).default([200]),
    timeoutMs: z.number().int().positive().max(30000).default(10000),
  }).optional(),
  models: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    offeringID: z.string().min(1).optional(),
    providerModelID: z.string().min(1).optional(),
    catalogID: z.string().optional(),
    family: z.string().optional(),
    lab: z.string().optional(),
    baseModel: z.string().optional(),
    endpointType: z.string().optional(),
    modalities: z.object({
      input: z.array(z.string().min(1)).default([]),
      output: z.array(z.string().min(1)).default([]),
    }).optional(),
    modes: z.array(CinemaProviderModelModeSchema).min(1),
    durations: z.array(z.number().positive()).default([]),
    aspectRatios: z.array(z.string().min(1)).default([]),
    resolutions: z.array(z.string().min(1)).default([]),
    maxDurationSeconds: z.number().positive().optional(),
    inputCombinations: z.array(CinemaProviderInputCombinationSchema).default([]),
    pricing: z.array(z.record(z.string(), z.unknown())).default([]),
    sourceURL: z.string().optional(),
    sourceCheckedAt: z.string().optional(),
    maxReferenceImages: z.number().int().nonnegative().optional(),
    supportsSeed: z.boolean().optional(),
    supportsNegativePrompt: z.boolean().optional(),
    supportsAudio: z.boolean().optional(),
    supportsFirstLastFrame: z.boolean().optional(),
    requiresPublicInputURL: z.boolean().optional(),
    supportsProviderUpload: z.boolean().optional(),
    taskQueryEndpoint: CinemaProviderTaskQueryEndpointSchema.optional(),
    formSpecs: z.array(GenerationFormSpecSchema).default([]),
    parameterSchema: z.record(z.string(), z.unknown()).default({}),
  })).default([]),
})
export type CinemaVideoProviderManifest = z.infer<typeof CinemaVideoProviderManifestSchema>

export const CinemaProviderAuthStateSchema = z.object({
  providerID: z.string().min(1),
  credentialProviderID: z.string().min(1),
  requiresCredential: z.boolean(),
  connected: z.boolean(),
  status: z.enum(["connected", "not_connected", "pending", "expired", "error"]),
  credentialKind: z.enum(["api_key", "oauth_session"]).optional(),
  credentialSource: z.string().optional(),
  connectionLabel: z.string().optional(),
  lastError: z.string().optional(),
})
export type CinemaProviderAuthState = z.infer<typeof CinemaProviderAuthStateSchema>

export const CinemaVideoProviderRuntimeSchema = z.object({
  baseURL: z.string().min(1).optional(),
  configuredBaseURL: z.string().min(1).optional(),
  userID: z.string().min(1).optional(),
  baseURLSource: z.enum(["settings", "environment", "default"]).optional(),
  adapterAvailable: z.boolean().default(false),
  adapterID: z.string().min(1).optional(),
  supportedModes: z.array(CinemaProviderModelModeSchema).optional(),
})
export type CinemaVideoProviderRuntime = z.infer<typeof CinemaVideoProviderRuntimeSchema>

export const CinemaVideoProviderSchema = z.object({
  manifest: CinemaVideoProviderManifestSchema,
  auth: CinemaProviderAuthStateSchema,
  runtime: CinemaVideoProviderRuntimeSchema.optional(),
})
export type CinemaVideoProvider = z.infer<typeof CinemaVideoProviderSchema>

export const UpdateCinemaVideoProviderSettingsBodySchema = z.object({
  baseURL: z.string().nullable().optional(),
  userID: z.string().nullable().optional(),
})
export type UpdateCinemaVideoProviderSettingsBody = z.infer<typeof UpdateCinemaVideoProviderSettingsBodySchema>

export const TestCinemaVideoProviderConnectionBodySchema = z.object({
  apiKey: z.string().nullable().optional(),
  baseURL: z.string().nullable().optional(),
  userID: z.string().nullable().optional(),
})
export type TestCinemaVideoProviderConnectionBody = z.infer<typeof TestCinemaVideoProviderConnectionBodySchema>

const CinemaGenerationTaskInputSchema = z.object({
  id: z.string().min(1),
  operationID: z.string().min(1).max(128).optional(),
  projectID: z.string().min(1),
  providerID: z.string().min(1),
  target: CinemaGenerationTargetSchema.optional(),
  modelID: z.string().min(1).optional(),
  mode: CinemaTaskModeSchema,
  title: z.string().min(1),
  status: CinemaGenerationTaskStatusSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  taskNodeID: z.string().min(1),
  providerTaskRef: z.record(z.string(), z.unknown()).optional(),
  progress: CinemaGenerationProgressSchema.optional(),
  input: z.object({
    prompt: z.string(),
    sourceNodeIDs: z.array(z.string().min(1)).default([]),
    parameters: z.record(z.string(), z.unknown()).default({}),
  }),
  outputAssets: z.array(CinemaGeneratedAssetSchema).default([]),
  errorCode: z.string().min(1).optional(),
  error: z.string().nullable().optional(),
})
export const CinemaGenerationTaskSchema = CinemaGenerationTaskInputSchema
  .superRefine(validateLegacyGenerationTarget)
  .transform(({ modelID, ...value }) => ({
    ...value,
    target: value.target ?? { kind: "model" as const, modelID: modelID! },
  }))
export type CinemaGenerationTask = z.infer<typeof CinemaGenerationTaskSchema>

const CreateCinemaGenerationTaskBodyInputSchema = z.object({
  operationID: z.string().min(1).max(128).optional(),
  providerID: z.string().min(1),
  target: CinemaGenerationTargetSchema.optional(),
  modelID: z.string().min(1).optional(),
  mode: CinemaTaskModeSchema,
  title: z.string().min(1).optional(),
  prompt: z.string().default(""),
  sourceNodeIDs: z.array(z.string().min(1)).default([]),
  parameters: z.record(z.string(), z.unknown()).default({}),
  taskNodeID: z.string().min(1),
})
export const CreateCinemaGenerationTaskBodySchema = CreateCinemaGenerationTaskBodyInputSchema
  .superRefine(validateLegacyGenerationTarget)
  .transform(({ modelID, ...value }) => ({
    ...value,
    target: value.target ?? { kind: "model" as const, modelID: modelID! },
  }))
export type CreateCinemaGenerationTaskBody = z.infer<typeof CreateCinemaGenerationTaskBodySchema>

export const CinemaTextModelSchema = z.object({
  value: z.string().min(1),
  providerID: z.string().min(1),
  modelID: z.string().min(1),
  offeringID: z.string().min(1).optional(),
  providerModelID: z.string().min(1).optional(),
  label: z.string().min(1),
  providerLabel: z.string().min(1),
  available: z.boolean(),
  supportsImageInput: z.boolean().default(false),
})
export type CinemaTextModel = z.infer<typeof CinemaTextModelSchema>

export const CinemaTextModelsResultSchema = z.object({
  items: z.array(CinemaTextModelSchema),
  selection: z.object({
    model: z.string().nullable().optional(),
  }).optional(),
  effectiveModel: CinemaTextModelSchema.nullable().optional(),
})
export type CinemaTextModelsResult = z.infer<typeof CinemaTextModelsResultSchema>

export const CreateCinemaTextGenerationBodySchema = z.object({
  nodeID: z.string().min(1),
  prompt: z.string().trim().min(1),
  model: z.string().nullable().optional(),
  sourceImageAssetID: z.string().min(1).optional(),
  sourceImageAssetIDs: z.array(z.string().min(1)).optional(),
  sourceImagePath: z.string().min(1).optional(),
  sourceImagePaths: z.array(z.string().min(1)).optional(),
  writeMode: z.literal("append"),
})
export type CreateCinemaTextGenerationBody = z.infer<typeof CreateCinemaTextGenerationBodySchema>

export const CinemaTextGenerationResultSchema = z.object({
  canvas: CinemaCanvasDocumentSchema,
  nodeID: z.string().min(1),
  text: z.string(),
  generatedText: z.string(),
  model: z.string().min(1),
})
export type CinemaTextGenerationResult = z.infer<typeof CinemaTextGenerationResultSchema>

export const CinemaImageModelSchema = CinemaTextModelSchema.extend({
  target: CinemaGenerationTargetSchema.optional(),
  formSpec: GenerationFormSpecSchema.optional(),
})
export type CinemaImageModel = z.infer<typeof CinemaImageModelSchema>

export const CinemaImageModelsResultSchema = z.object({
  items: z.array(CinemaImageModelSchema),
  selection: z.object({
    image_model: z.string().nullable().optional(),
  }).optional(),
  effectiveModel: CinemaImageModelSchema.nullable().optional(),
})
export type CinemaImageModelsResult = z.infer<typeof CinemaImageModelsResultSchema>

export const CreateCinemaImageGenerationBodySchema = z.object({
  nodeID: z.string().min(1),
  prompt: z.string().default(""),
  userPrompt: z.string().optional(),
  model: z.string().nullable().optional(),
  target: CinemaGenerationTargetSchema.optional(),
  size: z.string().regex(/^\d+x\d+$/).optional(),
  count: z.number().int().min(1).optional(),
  style: z.string().trim().min(1).max(400).optional(),
  parameters: z.record(z.string(), z.unknown()).default({}),
  sourceNodeIDs: z.array(z.string().min(1)).optional(),
  sourceTextPrompts: z.array(z.string().trim().min(1)).optional(),
  sourceImageAssetID: z.string().min(1).optional(),
  sourceImageAssetIDs: z.array(z.string().min(1)).optional(),
  sourceImagePath: z.string().min(1).optional(),
  sourceImagePaths: z.array(z.string().min(1)).optional(),
}).superRefine((value, context) => {
  if (value.target?.kind !== "workflow" && value.prompt.trim().length === 0) {
    context.addIssue({
      code: "custom",
      path: ["prompt"],
      message: "Prompt is required for model-based image generation",
    })
  }
})
export type CreateCinemaImageGenerationBody = z.infer<typeof CreateCinemaImageGenerationBodySchema>

export const CinemaImageGenerationResultSchema = z.object({
  canvas: CinemaCanvasDocumentSchema,
  nodeID: z.string().min(1),
  model: z.string().min(1),
  taskID: z.string().min(1).optional(),
  status: CinemaGenerationTaskStatusSchema.optional(),
  assets: z.array(CinemaGeneratedAssetSchema.extend({
    kind: z.literal("image"),
  })),
})
export type CinemaImageGenerationResult = z.infer<typeof CinemaImageGenerationResultSchema>

export const CreateCinemaImportedImageAssetBodySchema = z.object({
  fileName: z.string().trim().min(1).max(240),
  mimeType: z.string().trim().min(1).max(120).optional(),
  dataBase64: z.string().min(1),
})
export type CreateCinemaImportedImageAssetBody = z.infer<typeof CreateCinemaImportedImageAssetBodySchema>

export const CinemaImportedImageAssetResultSchema = z.object({
  asset: CinemaGeneratedAssetSchema.extend({
    kind: z.literal("image"),
  }),
})
export type CinemaImportedImageAssetResult = z.infer<typeof CinemaImportedImageAssetResultSchema>

export const CreateCinemaImportedMediaAssetBodySchema = CreateCinemaImportedImageAssetBodySchema
export type CreateCinemaImportedMediaAssetBody = z.infer<typeof CreateCinemaImportedMediaAssetBodySchema>

export const CinemaImportedMediaAssetResultSchema = z.object({
  asset: CinemaGeneratedAssetSchema,
})
export type CinemaImportedMediaAssetResult = z.infer<typeof CinemaImportedMediaAssetResultSchema>

export const CinemaProjectSummarySchema = z.object({
  projectID: z.string().min(1),
  name: z.string().min(1),
  root: z.string().min(1),
  initialized: z.boolean(),
  metadataPath: z.string().optional(),
  project: z.record(z.string(), z.unknown()).optional(),
  capabilities: z.object({
    assetLibrary: z.boolean(),
    personalAssetLibrary: z.boolean(),
    timelineEditing: z.boolean(),
    timelineDelivery: z.boolean(),
  }).optional(),
})
export type CinemaProjectSummary = z.infer<typeof CinemaProjectSummarySchema>

export const CinemaProjectDirectoryEntrySchema = z.object({
  name: z.string().min(1),
  path: z.string(),
  kind: z.enum(["file", "directory"]),
  sizeBytes: z.number().int().nonnegative().optional(),
  modifiedAt: z.string().min(1).optional(),
  mimeType: z.string().optional(),
  previewable: z.boolean().default(false),
})
export type CinemaProjectDirectoryEntry = z.infer<typeof CinemaProjectDirectoryEntrySchema>

export const CinemaProjectDirectoryListingSchema = z.object({
  projectID: z.string().min(1),
  root: z.string().min(1),
  path: z.string(),
  parentPath: z.string().nullable(),
  entries: z.array(CinemaProjectDirectoryEntrySchema),
  truncated: z.boolean().default(false),
})
export type CinemaProjectDirectoryListing = z.infer<typeof CinemaProjectDirectoryListingSchema>

export const CinemaNodeSummarySchema = z.object({
  id: z.string().min(1),
  type: CinemaNodeTypeSchema,
  title: z.string().min(1),
  text: z.string().optional(),
  status: z.string().optional(),
})
export type CinemaNodeSummary = z.infer<typeof CinemaNodeSummarySchema>

export const CinemaDirectorySummarySchema = z.object({
  path: z.string().min(1),
  exists: z.boolean(),
  fileCount: z.number().int().nonnegative(),
  sample: z.array(z.string()),
})
export type CinemaDirectorySummary = z.infer<typeof CinemaDirectorySummarySchema>

export const CinemaProjectStateSummarySchema = z.object({
  projectID: z.string().min(1),
  name: z.string().min(1),
  root: z.string().min(1),
  initialized: z.boolean(),
  project: z.record(z.string(), z.unknown()).optional(),
  nodeCount: z.number().int().nonnegative(),
  edgeCount: z.number().int().nonnegative(),
  nodeTypeCounts: z.record(z.string(), z.number().int().nonnegative()),
  nodes: z.array(CinemaNodeSummarySchema),
  recentEvents: z.array(CinemaProjectEventSchema),
  directories: z.array(CinemaDirectorySummarySchema),
  gaps: z.array(z.string()),
})
export type CinemaProjectStateSummary = z.infer<typeof CinemaProjectStateSummarySchema>
