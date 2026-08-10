import z from "zod"

export const ModelReference = z
  .object({
    providerID: z.string(),
    modelID: z.string(),
  })
  .meta({
    ref: "ModelReference",
  })
export type ModelReference = z.infer<typeof ModelReference>

export const ModelModalities = z.object({
  text: z.boolean(),
  audio: z.boolean(),
  image: z.boolean(),
  video: z.boolean(),
  pdf: z.boolean(),
})
export type ModelModalities = z.infer<typeof ModelModalities>

export const Model = z
  .object({
    id: z.string(),
    providerID: z.string(),
    api: z.object({
      id: z.string(),
      url: z.string(),
      npm: z.string(),
    }),
    name: z.string(),
    family: z.string().optional(),
    capabilities: z.object({
      temperature: z.boolean(),
      reasoning: z.boolean(),
      replayAssistantReasoning: z.boolean(),
      attachment: z.boolean(),
      toolcall: z.boolean(),
      input: ModelModalities,
      output: ModelModalities,
      interleaved: z.union([
        z.boolean(),
        z.object({
          field: z.enum(["reasoning_content", "reasoning_details"]),
        }),
      ]),
    }),
    cost: z.object({
      input: z.number(),
      output: z.number(),
      cache: z.object({
        read: z.number(),
        write: z.number(),
      }),
      experimentalOver200K: z
        .object({
          input: z.number(),
          output: z.number(),
          cache: z.object({
            read: z.number(),
            write: z.number(),
          }),
        })
        .optional(),
    }),
    limit: z.object({
      context: z.number(),
      input: z.number().optional(),
      output: z.number(),
    }),
    status: z.enum(["alpha", "beta", "deprecated", "active"]),
    options: z.record(z.string(), z.any()),
    headers: z.record(z.string(), z.string()),
    release_date: z.string(),
    variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
  })
  .meta({
    ref: "Model",
  })
export type Model = z.infer<typeof Model>

export const PublicModel = Model.omit({
  headers: true,
}).extend({
  available: z.boolean(),
  providerName: z.string().optional(),
})
export type PublicModel = z.infer<typeof PublicModel>

export const ModelCatalogRuntimeKind = z.enum(["ai-sdk"])
export type ModelCatalogRuntimeKind = z.infer<typeof ModelCatalogRuntimeKind>

export const ModelCatalogSource = z.enum(["provider"])
export type ModelCatalogSource = z.infer<typeof ModelCatalogSource>

export const ModelCatalogItemCapabilities = z.object({
  temperature: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  attachment: z.boolean().optional(),
  toolcall: z.boolean().optional(),
  input: ModelModalities,
  output: ModelModalities,
  taskModes: z.array(z.string()).default([]),
})
export type ModelCatalogItemCapabilities = z.infer<typeof ModelCatalogItemCapabilities>

export const ModelCatalogItem = z
  .object({
    registryID: z.string(),
    providerID: z.string(),
    modelID: z.string(),
    name: z.string(),
    providerName: z.string(),
    family: z.string().optional(),
    runtimeKind: ModelCatalogRuntimeKind,
    selectable: z.boolean(),
    available: z.boolean(),
    capabilities: ModelCatalogItemCapabilities,
    status: z.enum(["alpha", "beta", "deprecated", "active"]),
    source: ModelCatalogSource,
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({
    ref: "ModelCatalogItem",
  })
export type ModelCatalogItem = z.infer<typeof ModelCatalogItem>

