import { z } from "zod"

export const CinemaNodeTypeSchema = z.enum([
  "text",
  "prompt",
  "image",
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
])
export type CinemaGenerationMode = z.infer<typeof CinemaGenerationModeSchema>

export const CinemaGenerationTaskStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
])
export type CinemaGenerationTaskStatus = z.infer<typeof CinemaGenerationTaskStatusSchema>

export const CinemaGeneratedAssetSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["video", "image", "audio", "file"]),
  path: z.string().min(1),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  url: z.string().url().optional(),
})
export type CinemaGeneratedAsset = z.infer<typeof CinemaGeneratedAssetSchema>

export const CinemaVideoProviderManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  credentialProviderID: z.string().min(1).optional(),
  requiresCredential: z.boolean().default(false),
  models: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    modes: z.array(CinemaGenerationModeSchema).min(1),
    durations: z.array(z.number().positive()).default([]),
    aspectRatios: z.array(z.string().min(1)).default([]),
    resolutions: z.array(z.string().min(1)).default([]),
    maxReferenceImages: z.number().int().nonnegative().optional(),
    supportsSeed: z.boolean().optional(),
    supportsNegativePrompt: z.boolean().optional(),
    supportsAudio: z.boolean().optional(),
    requiresPublicInputURL: z.boolean().optional(),
    supportsProviderUpload: z.boolean().optional(),
    parameterSchema: z.record(z.string(), z.unknown()).default({}),
  })).min(1),
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

export const CinemaVideoProviderSchema = z.object({
  manifest: CinemaVideoProviderManifestSchema,
  auth: CinemaProviderAuthStateSchema,
})
export type CinemaVideoProvider = z.infer<typeof CinemaVideoProviderSchema>

export const CinemaGenerationTaskSchema = z.object({
  id: z.string().min(1),
  projectID: z.string().min(1),
  providerID: z.string().min(1),
  modelID: z.string().min(1),
  mode: CinemaGenerationModeSchema,
  title: z.string().min(1),
  status: CinemaGenerationTaskStatusSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  taskNodeID: z.string().min(1).optional(),
  outputNodeID: z.string().min(1).optional(),
  providerTaskRef: z.record(z.string(), z.unknown()).optional(),
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
  mode: CinemaGenerationModeSchema,
  title: z.string().min(1).optional(),
  prompt: z.string().default(""),
  sourceNodeIDs: z.array(z.string().min(1)).default([]),
  parameters: z.record(z.string(), z.unknown()).default({}),
  position: CinemaPositionSchema.optional(),
})
export type CreateCinemaGenerationTaskBody = z.infer<typeof CreateCinemaGenerationTaskBodySchema>

export const CinemaProjectSummarySchema = z.object({
  projectID: z.string().min(1),
  name: z.string().min(1),
  root: z.string().min(1),
  initialized: z.boolean(),
  metadataPath: z.string().optional(),
  project: z.record(z.string(), z.unknown()).optional(),
})
export type CinemaProjectSummary = z.infer<typeof CinemaProjectSummarySchema>

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
