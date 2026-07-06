import { z } from "zod"

export const CinemaNodeTypeSchema = z.enum([
  "text",
  "prompt",
  "image",
  "local-image",
  "video",
  "audio",
  "shot",
  "agent",
  "generation-task",
  "output",
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
  id: z.string().min(1).optional(),
  actor: z.string().min(1).optional(),
})

export const CinemaCommandSchema = z.discriminatedUnion("type", [
  CinemaCommandBaseSchema.extend({
    type: z.literal("create-node"),
    node: CinemaCanvasNodeSchema,
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
  CinemaCommandBaseSchema.extend({
    type: z.literal("create-generation-task"),
    node: CinemaCanvasNodeSchema.extend({
      type: z.literal("generation-task"),
    }),
  }),
  CinemaCommandBaseSchema.extend({
    type: z.literal("complete-generation-task"),
    taskNodeID: z.string().min(1),
    outputNode: CinemaCanvasNodeSchema.optional(),
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

export const CinemaGenerationModeSchema = z.enum([
  "text-to-video",
  "image-to-video",
  "frames-to-video",
  "reference-to-video",
  "video-to-video",
  "edit",
  "extend",
  "motion-control",
])
export type CinemaGenerationMode = z.infer<typeof CinemaGenerationModeSchema>

export const CinemaProviderModelModeSchema = z.enum([
  ...CinemaGenerationModeSchema.options,
  "text-to-image",
  "image-to-image",
  "image-edit",
])
export type CinemaProviderModelMode = z.infer<typeof CinemaProviderModelModeSchema>

export const CinemaTaskModeSchema = CinemaProviderModelModeSchema
export type CinemaTaskMode = z.infer<typeof CinemaTaskModeSchema>

export const CinemaGenerationTaskStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
])
export type CinemaGenerationTaskStatus = z.infer<typeof CinemaGenerationTaskStatusSchema>

export const CinemaGenerationProgressPhaseSchema = z.enum([
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
})
export type CinemaGeneratedAsset = z.infer<typeof CinemaGeneratedAssetSchema>

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
    pricing: z.array(z.record(z.string(), z.unknown())).default([]),
    sourceURL: z.string().optional(),
    sourceCheckedAt: z.string().optional(),
    maxReferenceImages: z.number().int().nonnegative().optional(),
    supportsSeed: z.boolean().optional(),
    supportsNegativePrompt: z.boolean().optional(),
    supportsAudio: z.boolean().optional(),
    requiresPublicInputURL: z.boolean().optional(),
    supportsProviderUpload: z.boolean().optional(),
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
})
export type UpdateCinemaVideoProviderSettingsBody = z.infer<typeof UpdateCinemaVideoProviderSettingsBodySchema>

export const TestCinemaVideoProviderConnectionBodySchema = z.object({
  apiKey: z.string().nullable().optional(),
  baseURL: z.string().nullable().optional(),
})
export type TestCinemaVideoProviderConnectionBody = z.infer<typeof TestCinemaVideoProviderConnectionBodySchema>

export const CinemaGenerationTaskSchema = z.object({
  id: z.string().min(1),
  projectID: z.string().min(1),
  providerID: z.string().min(1),
  modelID: z.string().min(1),
  mode: CinemaTaskModeSchema,
  title: z.string().min(1),
  status: CinemaGenerationTaskStatusSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  taskNodeID: z.string().min(1).optional(),
  outputNodeID: z.string().min(1).optional(),
  providerTaskRef: z.record(z.string(), z.unknown()).optional(),
  progress: CinemaGenerationProgressSchema.optional(),
  input: z.object({
    prompt: z.string(),
    sourceNodeIDs: z.array(z.string().min(1)).default([]),
    parameters: z.record(z.string(), z.unknown()).default({}),
  }),
  outputAssets: z.array(CinemaGeneratedAssetSchema).default([]),
  error: z.string().nullable().optional(),
})
export type CinemaGenerationTask = z.infer<typeof CinemaGenerationTaskSchema>

export const CreateCinemaGenerationTaskBodySchema = z.object({
  providerID: z.string().min(1),
  modelID: z.string().min(1),
  mode: CinemaTaskModeSchema,
  title: z.string().min(1).optional(),
  prompt: z.string().default(""),
  sourceNodeIDs: z.array(z.string().min(1)).default([]),
  parameters: z.record(z.string(), z.unknown()).default({}),
  position: CinemaPositionSchema.optional(),
  taskNodeID: z.string().min(1).optional(),
})
export type CreateCinemaGenerationTaskBody = z.infer<typeof CreateCinemaGenerationTaskBodySchema>

export const CinemaTextModelSchema = z.object({
  value: z.string().min(1),
  providerID: z.string().min(1),
  modelID: z.string().min(1),
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

export const CinemaImageModelSchema = CinemaTextModelSchema
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
  prompt: z.string().trim().min(1),
  userPrompt: z.string().optional(),
  model: z.string().nullable().optional(),
  size: z.string().regex(/^\d+x\d+$/).optional(),
  count: z.number().int().min(1).max(4).optional(),
  style: z.string().trim().min(1).max(400).optional(),
  sourceNodeIDs: z.array(z.string().min(1)).optional(),
  sourceTextPrompts: z.array(z.string().trim().min(1)).optional(),
  sourceImageAssetID: z.string().min(1).optional(),
  sourceImageAssetIDs: z.array(z.string().min(1)).optional(),
  sourceImagePath: z.string().min(1).optional(),
  sourceImagePaths: z.array(z.string().min(1)).optional(),
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

export const CinemaProjectSummarySchema = z.object({
  projectID: z.string().min(1),
  name: z.string().min(1),
  root: z.string().min(1),
  initialized: z.boolean(),
  metadataPath: z.string().optional(),
  project: z.record(z.string(), z.unknown()).optional(),
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

export const CinemaOpenLinkSchema = z.object({
  url: z.string().url(),
})
export type CinemaOpenLink = z.infer<typeof CinemaOpenLinkSchema>
