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
  trace: z.object({
    count: z.number().int().nonnegative(),
    estimatedBytes: z.number().nonnegative(),
    earliestTimestamp: z.number().nonnegative().nullable(),
    retentionDays: z.literal(30),
  }),
  toolArtifacts: z.object({
    fileCount: z.number().int().nonnegative(),
    bytes: z.number().nonnegative(),
  }),
  maintenance: z.object({
    status: z.enum(["idle", "running", "succeeded", "failed", "pending"]),
    lastRunAt: z.number().nonnegative().optional(),
    lastError: z.string().optional(),
    reclaimableBytes: z.number().nonnegative(),
    lastResult: z.object({
      traceDeleted: z.number().int().nonnegative(),
      orphanArtifactsDeleted: z.number().int().nonnegative(),
      toolPartsMigrated: z.number().int().nonnegative(),
      archivedSnapshotsMigrated: z.number().int().nonnegative(),
      cleanedCount: z.number().int().nonnegative(),
      migratedCount: z.number().int().nonnegative(),
      beforeBytes: z.number().nonnegative(),
      afterBytes: z.number().nonnegative(),
      reclaimedBytes: z.number().nonnegative(),
      durationMs: z.number().nonnegative(),
      completedAt: z.number().nonnegative(),
    }).optional(),
  }),
})

export const DesktopStorageOptimizeResultSchema = z.object({
  traceDeleted: z.number().int().nonnegative(),
  orphanArtifactsDeleted: z.number().int().nonnegative(),
  toolPartsMigrated: z.number().int().nonnegative(),
  archivedSnapshotsMigrated: z.number().int().nonnegative(),
  cleanedCount: z.number().int().nonnegative(),
  migratedCount: z.number().int().nonnegative(),
  beforeBytes: z.number().nonnegative(),
  afterBytes: z.number().nonnegative(),
  reclaimedBytes: z.number().nonnegative(),
  durationMs: z.number().nonnegative(),
  completedAt: z.number().nonnegative(),
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
  optimizeStorage: {
    output: DesktopStorageOptimizeResultSchema,
  },
} as const

export type DesktopOpenPathInput = z.infer<typeof DesktopIpcSchemas.openPath.input>
export type DesktopOpenPathResult = z.infer<typeof DesktopIpcSchemas.openPath.output>
export type DesktopStorageUsageSnapshot = z.infer<typeof DesktopStorageUsageSnapshotSchema>
export type DesktopStorageOptimizeResult = z.infer<typeof DesktopStorageOptimizeResultSchema>
