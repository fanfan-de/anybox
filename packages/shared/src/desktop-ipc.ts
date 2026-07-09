import { z } from "zod"

const StorageUsageCategoryIDSchema = z.enum([
  "archivedSessions",
  "activeSessions",
  "otherDatabase",
  "sqliteOverhead",
])

const StorageUsageTableCategorySchema = z.enum([
  "archivedSessions",
  "activeSessions",
  "otherDatabase",
])

export const DesktopStorageUsageSnapshotSchema = z.object({
  generatedAt: z.number(),
  database: z.object({
    path: z.string(),
    totalBytes: z.number().nonnegative(),
    mainBytes: z.number().nonnegative(),
    walBytes: z.number().nonnegative(),
    shmBytes: z.number().nonnegative(),
    pageSize: z.number().positive().nullable(),
    pageCount: z.number().nonnegative().nullable(),
    freelistBytes: z.number().nonnegative().nullable(),
  }),
  categories: z.array(z.object({
    id: StorageUsageCategoryIDSchema,
    label: z.string(),
    bytes: z.number().nonnegative(),
    approximate: z.boolean(),
    count: z.number().nonnegative().optional(),
  })),
  archivedSessions: z.array(z.object({
    id: z.string(),
    title: z.string(),
    projectID: z.string(),
    projectName: z.string().nullable(),
    directory: z.string(),
    updated: z.number(),
    archivedAt: z.number(),
    messageCount: z.number().nonnegative(),
    eventCount: z.number().nonnegative(),
    estimatedBytes: z.number().nonnegative(),
  })),
  tables: z.array(z.object({
    name: z.string(),
    category: StorageUsageTableCategorySchema,
    rowCount: z.number().nonnegative(),
    estimatedBytes: z.number().nonnegative(),
  })),
})

export const DesktopIpcSchemas = {
  openPath: {
    input: z.object({
      targetPath: z.string().min(1),
    }),
    output: z.object({
      ok: z.literal(true),
      targetPath: z.string().min(1),
    }),
  },
  openCinemaProject: {
    input: z.object({
      projectID: z.string().min(1),
    }),
    output: z.object({
      ok: z.literal(true),
      projectID: z.string().min(1),
      url: z.string().url(),
    }),
  },
  getInfo: {
    output: z.object({
      platform: z.string(),
      electron: z.string(),
      chrome: z.string(),
      node: z.string(),
    }),
  },
  getStoragePaths: {
    output: z.object({
      appData: z.string().min(1),
      agentRoot: z.string().min(1),
      agentData: z.string().min(1),
      agentCache: z.string().min(1),
      installedPlugins: z.string().min(1),
      pluginRegistryCache: z.string().min(1),
      pluginInstallTemp: z.string().min(1),
    }),
  },
  getStorageUsage: {
    output: DesktopStorageUsageSnapshotSchema,
  },
} as const

export type DesktopOpenPathInput = z.infer<typeof DesktopIpcSchemas.openPath.input>
export type DesktopOpenPathResult = z.infer<typeof DesktopIpcSchemas.openPath.output>
export type DesktopOpenCinemaProjectInput = z.infer<typeof DesktopIpcSchemas.openCinemaProject.input>
export type DesktopOpenCinemaProjectResult = z.infer<typeof DesktopIpcSchemas.openCinemaProject.output>
export type DesktopStorageUsageSnapshot = z.infer<typeof DesktopStorageUsageSnapshotSchema>
