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
