import { z } from "zod"

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
} as const

export type DesktopOpenPathInput = z.infer<typeof DesktopIpcSchemas.openPath.input>
export type DesktopOpenPathResult = z.infer<typeof DesktopIpcSchemas.openPath.output>
export type DesktopOpenCinemaProjectInput = z.infer<typeof DesktopIpcSchemas.openCinemaProject.input>
export type DesktopOpenCinemaProjectResult = z.infer<typeof DesktopIpcSchemas.openCinemaProject.output>
