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

export const CinemaProjectSummarySchema = z.object({
  projectID: z.string().min(1),
  name: z.string().min(1),
  root: z.string().min(1),
  initialized: z.boolean(),
  metadataPath: z.string().optional(),
  project: z.record(z.string(), z.unknown()).optional(),
})
export type CinemaProjectSummary = z.infer<typeof CinemaProjectSummarySchema>

export const CinemaOpenLinkSchema = z.object({
  url: z.string().url(),
})
export type CinemaOpenLink = z.infer<typeof CinemaOpenLinkSchema>
