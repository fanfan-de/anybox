import { Hono } from "hono"
import { z } from "zod"
import { ApiError } from "#server/error.ts"
import { ok, parseJsonBody, parseQuery } from "#server/http.ts"
import type { AppEnv } from "#server/types.ts"
import * as CinemaUseCase from "#server/usecases/cinema.ts"
import { getServerBaseURL } from "#server/base-url.ts"
import { getCinemaRenderRuntimeStatus } from "#cinema/render-runtime.ts"
import {
  CinemaCanvasDocumentSchema,
  CinemaCommandSchema,
  CreateCinemaImageGenerationBodySchema,
  CreateCinemaImportedImageAssetBodySchema,
  CreateCinemaImportedMediaAssetBodySchema,
  CreateCinemaTextGenerationBodySchema,
  CreateCinemaGenerationTaskBodySchema,
  TestCinemaVideoProviderConnectionBodySchema,
  UpdateCinemaVideoProviderSettingsBodySchema,
} from "@anybox/cinema-plugin/contracts"
import {
  CinemaTimelineCommandSchema,
  CinemaTimelineIDSchema,
  CreateCinemaTimelineBodySchema,
} from "@anybox/cinema-plugin/contracts/timeline"
import {
  CinemaRenderJobIDSchema,
  CinemaRenderSettingsSchema,
  CreateCinemaRenderJobBodySchema,
  RetryCinemaRenderJobBodySchema,
} from "@anybox/cinema-plugin/contracts/render"

const CinemaEventsQuerySchema = z.object({
  after: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

const CinemaDirectoryQuerySchema = z.object({
  path: z.string().optional(),
})

const CinemaProviderApiKeyBodySchema = z.object({
  apiKey: z.string().nullable().optional(),
})

const CinemaTimelineEventsQuerySchema = z.object({
  after: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

const CinemaDeliveryPreflightQuerySchema = z.object({
  settings: z.string().optional(),
}).strict()

const CINEMA_RENDER_RETENTION_CONFIRMATION = "DELETE_REBUILDABLE_RENDER_FILES"
const CinemaRenderRetentionBodySchema = z.object({
  operationID: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
  retentionDurationMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  dryRun: z.boolean().default(true),
  confirm: z.literal(CINEMA_RENDER_RETENTION_CONFIRMATION).optional(),
}).strict().superRefine((value, context) => {
  if (!value.dryRun && value.confirm !== CINEMA_RENDER_RETENTION_CONFIRMATION) {
    context.addIssue({
      code: "custom",
      path: ["confirm"],
      message: `Execute mode requires confirm='${CINEMA_RENDER_RETENTION_CONFIRMATION}'.`,
    })
  }
})

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase()
  return normalized === "127.0.0.1"
    || normalized === "localhost"
    || normalized === "::1"
    || normalized === "[::1]"
}

function cinemaRetentionTrustedBrowserOrigins() {
  return new Set([getServerBaseURL().origin])
}

function assertCinemaRetentionExecutionAuthorized(request: {
  header(name: string): string | undefined
}) {
  const serverURL = getServerBaseURL()
  if (!isLoopbackHostname(serverURL.hostname)) {
    throw new ApiError(
      403,
      "CINEMA_RENDER_RETENTION_EXECUTION_FORBIDDEN",
      "Render retention execution is available only on a loopback Agent.",
    )
  }

  const origin = request.header("origin")?.trim()
  const fetchSite = request.header("sec-fetch-site")?.trim().toLowerCase()
  const browserRequest = Boolean(origin || fetchSite)
  if (!browserRequest) return

  let normalizedOrigin: string | undefined
  try {
    normalizedOrigin = origin ? new URL(origin).origin : undefined
  } catch {
    normalizedOrigin = undefined
  }
  if (!normalizedOrigin || !cinemaRetentionTrustedBrowserOrigins().has(normalizedOrigin)) {
    throw new ApiError(
      403,
      "CINEMA_RENDER_RETENTION_EXECUTION_FORBIDDEN",
      "Render retention execution requires the trusted local Cinema origin.",
    )
  }
}

function parseCinemaRenderSettings(value: string | undefined) {
  if (value === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new ApiError(400, "CINEMA_RENDER_SETTINGS_INVALID", "Render settings must be valid JSON.")
  }
  const result = CinemaRenderSettingsSchema.safeParse(parsed)
  if (!result.success) {
    throw new ApiError(400, "CINEMA_RENDER_SETTINGS_INVALID", "Render settings are invalid.")
  }
  return result.data
}

function parseTimelineID(value: string) {
  const result = CinemaTimelineIDSchema.safeParse(value)
  if (!result.success) {
    throw new ApiError(400, "CINEMA_TIMELINE_ID_INVALID", "Timeline id is invalid.")
  }
  return result.data
}

function parseRenderJobID(value: string) {
  const result = CinemaRenderJobIDSchema.safeParse(value)
  if (!result.success) {
    throw new ApiError(400, "CINEMA_RENDER_JOB_ID_INVALID", "Render job id is invalid.")
  }
  return result.data
}

function decodeCinemaAssetPath(url: string) {
  const pathname = new URL(url).pathname
  const marker = "/assets/"
  const markerIndex = pathname.indexOf(marker)
  if (markerIndex < 0) return ""

  let assetPath = pathname.slice(markerIndex + marker.length)
  try {
    for (let index = 0; index < 3; index += 1) {
      const decoded = assetPath.split("/").map((segment) => decodeURIComponent(segment)).join("/")
      if (decoded === assetPath) break
      assetPath = decoded
    }
  } catch {
    throw new ApiError(400, "CINEMA_ASSET_PATH_INVALID", "Asset path is not valid URL encoding.")
  }
  return assetPath
}

export function CinemaRoutes() {
  const app = new Hono<AppEnv>()

  app.get("/render-runtime", async (c) =>
    ok(c, await getCinemaRenderRuntimeStatus())
  )

  app.post("/projects/:projectID/render-retention/cleanup", async (c) => {
    const payload = await parseJsonBody(
      c,
      CinemaRenderRetentionBodySchema,
      "Body must include a valid operationID, explicit retentionDurationMs, and execute confirmation when dryRun is false.",
    )
    if (!payload.dryRun) assertCinemaRetentionExecutionAuthorized(c.req)
    return ok(c, await CinemaUseCase.runCinemaRenderRetention(
      c.req.param("projectID"),
      {
        operationID: payload.operationID,
        retentionDurationMs: payload.retentionDurationMs,
        dryRun: payload.dryRun,
      },
      payload.dryRun ? c.req.raw.signal : undefined,
    ))
  })

  app.get("/video-providers", async (c) =>
    ok(c, await CinemaUseCase.listCinemaVideoProviders())
  )

  app.post("/video-providers/catalog/refresh", async (c) =>
    ok(c, await CinemaUseCase.refreshCinemaVideoProviderCatalog())
  )

  app.get("/video-providers/:providerID/workflows", async (c) =>
    ok(c, await CinemaUseCase.getCinemaProviderWorkflows(c.req.param("providerID")))
  )

  app.post("/video-providers/:providerID/workflows/refresh", async (c) =>
    ok(c, await CinemaUseCase.refreshCinemaProviderWorkflows(c.req.param("providerID")))
  )

  app.get("/video-providers/:providerID/auth/api-key", async (c) =>
    ok(c, await CinemaUseCase.getCinemaVideoProviderAuth(c.req.param("providerID")))
  )

  app.put("/video-providers/:providerID/auth/api-key", async (c) => {
    const payload = await parseJsonBody(
      c,
      CinemaProviderApiKeyBodySchema,
      "Body must contain an optional nullable 'apiKey' field.",
    )
    return ok(c, await CinemaUseCase.saveCinemaVideoProviderApiKey(c.req.param("providerID"), payload.apiKey))
  })

  app.put("/video-providers/:providerID/settings", async (c) => {
    const payload = await parseJsonBody(
      c,
      UpdateCinemaVideoProviderSettingsBodySchema,
      "Body must contain an optional nullable 'baseURL' field.",
    )
    return ok(c, await CinemaUseCase.saveCinemaVideoProviderSettings(c.req.param("providerID"), payload))
  })

  app.post("/video-providers/:providerID/test-connection", async (c) => {
    const payload = await parseJsonBody(
      c,
      TestCinemaVideoProviderConnectionBodySchema,
      "Body must contain optional connection test fields.",
    )
    return ok(c, await CinemaUseCase.testCinemaVideoProviderConnection(c.req.param("providerID"), payload))
  })

  app.post("/video-providers/:providerID/connect", async (c) => {
    const payload = await parseJsonBody(
      c,
      UpdateCinemaVideoProviderSettingsBodySchema,
      "Body must contain optional nullable connection settings.",
    )
    return ok(c, await CinemaUseCase.connectCinemaVideoProvider(c.req.param("providerID"), payload))
  })

  app.get("/projects/:projectID", async (c) =>
    ok(c, await CinemaUseCase.getCinemaProject(c.req.param("projectID")))
  )

  app.get("/projects/:projectID/canvas", async (c) =>
    ok(c, await CinemaUseCase.getCinemaCanvas(c.req.param("projectID")))
  )

  app.get("/projects/:projectID/summary", async (c) =>
    ok(c, await CinemaUseCase.getCinemaProjectStateSummary(c.req.param("projectID")))
  )

  app.get("/projects/:projectID/timelines", async (c) =>
    ok(c, await CinemaUseCase.listCinemaTimelines(c.req.param("projectID")))
  )

  app.post("/projects/:projectID/timelines", async (c) => {
    const payload = await parseJsonBody(
      c,
      CreateCinemaTimelineBodySchema,
      "Body must be a valid Cinema timeline creation request",
    )
    return ok(c, await CinemaUseCase.createCinemaTimeline(c.req.param("projectID"), payload))
  })

  app.get("/projects/:projectID/timelines/:timelineID", async (c) =>
    ok(c, await CinemaUseCase.getCinemaTimeline(
      c.req.param("projectID"),
      parseTimelineID(c.req.param("timelineID")),
    ))
  )

  app.get("/projects/:projectID/timelines/:timelineID/delivery-preflight", async (c) => {
    const query = parseQuery(
      c.req.query(),
      CinemaDeliveryPreflightQuerySchema,
      "INVALID_QUERY",
      "Query must include optional JSON render settings",
    )
    return ok(c, await CinemaUseCase.preflightCinemaTimelineDelivery(
      c.req.param("projectID"),
      parseTimelineID(c.req.param("timelineID")),
      parseCinemaRenderSettings(query.settings),
    ))
  })

  app.post("/projects/:projectID/timelines/:timelineID/render-jobs", async (c) => {
    const payload = await parseJsonBody(
      c,
      CreateCinemaRenderJobBodySchema,
      "Body must be a valid Cinema render job request",
    )
    return ok(c, await CinemaUseCase.createCinemaRenderJob(
      c.req.param("projectID"),
      parseTimelineID(c.req.param("timelineID")),
      payload,
    ), 202)
  })

  app.get("/projects/:projectID/timelines/:timelineID/render-jobs", async (c) =>
    ok(c, await CinemaUseCase.listCinemaRenderJobs(
      c.req.param("projectID"),
      parseTimelineID(c.req.param("timelineID")),
    ))
  )

  app.get("/projects/:projectID/render-jobs/:jobID", async (c) =>
    ok(c, await CinemaUseCase.getCinemaRenderJob(
      c.req.param("projectID"),
      parseRenderJobID(c.req.param("jobID")),
    ))
  )

  app.get("/projects/:projectID/render-jobs/:jobID/events", async (c) =>
    ok(c, await CinemaUseCase.getCinemaRenderJobEvents(
      c.req.param("projectID"),
      parseRenderJobID(c.req.param("jobID")),
    ))
  )

  app.post("/projects/:projectID/render-jobs/:jobID/cancel", async (c) =>
    ok(c, await CinemaUseCase.cancelCinemaRenderJob(
      c.req.param("projectID"),
      parseRenderJobID(c.req.param("jobID")),
    ))
  )

  app.post("/projects/:projectID/render-jobs/:jobID/retry", async (c) => {
    const payload = await parseJsonBody(
      c,
      RetryCinemaRenderJobBodySchema,
      "Body must be a valid Cinema render retry request",
    )
    return ok(c, await CinemaUseCase.retryCinemaRenderJob(
      c.req.param("projectID"),
      parseRenderJobID(c.req.param("jobID")),
      payload,
    ), 202)
  })

  app.post("/projects/:projectID/timelines/:timelineID/commands", async (c) => {
    const timelineID = parseTimelineID(c.req.param("timelineID"))
    const payload = await parseJsonBody(
      c,
      CinemaTimelineCommandSchema,
      "Body must be a valid Cinema timeline command",
    )
    return ok(c, await CinemaUseCase.applyCinemaTimelineCommand(
      c.req.param("projectID"),
      timelineID,
      payload,
    ))
  })

  app.get("/projects/:projectID/timelines/:timelineID/events", async (c) => {
    const query = parseQuery(
      c.req.query(),
      CinemaTimelineEventsQuerySchema,
      "INVALID_QUERY",
      "Query must include a valid optional event cursor and limit",
    )
    return ok(c, await CinemaUseCase.getCinemaTimelineEvents(
      c.req.param("projectID"),
      parseTimelineID(c.req.param("timelineID")),
      query,
    ))
  })

  app.get("/projects/:projectID/timelines/:timelineID/clips/:clipID/waveform", async (c) =>
    ok(c, await CinemaUseCase.getCinemaTimelineWaveform(
      c.req.param("projectID"),
      parseTimelineID(c.req.param("timelineID")),
      c.req.param("clipID"),
    ))
  )

  app.delete("/projects/:projectID/timelines/:timelineID", async (c) =>
    ok(c, await CinemaUseCase.deleteCinemaTimeline(
      c.req.param("projectID"),
      parseTimelineID(c.req.param("timelineID")),
    ))
  )

  app.get("/projects/:projectID/files", async (c) => {
    const query = parseQuery(
      c.req.query(),
      CinemaDirectoryQuerySchema,
      "INVALID_QUERY",
      "Query must include a valid optional project-relative path",
    )
    return ok(c, await CinemaUseCase.listCinemaProjectDirectory(c.req.param("projectID"), query.path))
  })

  app.get("/projects/:projectID/events", async (c) => {
    const query = parseQuery(
      c.req.query(),
      CinemaEventsQuerySchema,
      "INVALID_QUERY",
      "Query must include a valid optional event cursor and limit",
    )
    return ok(c, await CinemaUseCase.getCinemaEvents(c.req.param("projectID"), query))
  })

  app.get("/projects/:projectID/video-providers", async (_c) =>
    ok(_c, await CinemaUseCase.listCinemaVideoProviders())
  )

  app.get("/projects/:projectID/video-providers/:providerID", async (c) =>
    ok(c, await CinemaUseCase.getCinemaVideoProvider(c.req.param("providerID")))
  )

  app.get("/projects/:projectID/text-models", async (c) =>
    ok(c, await CinemaUseCase.listCinemaTextModels(c.req.param("projectID")))
  )

  app.get("/projects/:projectID/image-models", async (c) =>
    ok(c, await CinemaUseCase.listCinemaImageModels(c.req.param("projectID")))
  )

  app.post("/projects/:projectID/text-generations", async (c) => {
    const payload = await parseJsonBody(
      c,
      CreateCinemaTextGenerationBodySchema,
      "Body must be a valid Cinema text generation request",
    )
    return ok(c, await CinemaUseCase.createCinemaTextGeneration(c.req.param("projectID"), payload))
  })

  app.post("/projects/:projectID/image-generations", async (c) => {
    const payload = await parseJsonBody(
      c,
      CreateCinemaImageGenerationBodySchema,
      "Body must be a valid Cinema image generation request",
    )
    return ok(c, await CinemaUseCase.createCinemaImageGeneration(c.req.param("projectID"), payload))
  })

  app.post("/projects/:projectID/assets/imports", async (c) => {
    const payload = await parseJsonBody(
      c,
      CreateCinemaImportedImageAssetBodySchema,
      "Body must be a valid Cinema image import request",
    )
    return ok(c, await CinemaUseCase.importCinemaProjectImageAsset(c.req.param("projectID"), payload))
  })

  app.post("/projects/:projectID/assets/media-imports", async (c) => {
    const payload = await parseJsonBody(
      c,
      CreateCinemaImportedMediaAssetBodySchema,
      "Body must be a valid Cinema media import request",
    )
    return ok(c, await CinemaUseCase.importCinemaProjectMediaAsset(c.req.param("projectID"), payload))
  })

  app.get("/projects/:projectID/assets/*", async (c) => {
    const asset = await CinemaUseCase.readCinemaProjectAsset(
      c.req.param("projectID"),
      decodeCinemaAssetPath(c.req.url),
      { rangeHeader: c.req.header("range") },
    )
    const headers: Record<string, string> = {
      "accept-ranges": "bytes",
      "content-type": asset.mimeType,
      "content-length": String(asset.contentLength),
      "cache-control": "private, max-age=31536000, immutable",
    }
    if (asset.range) {
      headers["content-range"] = `bytes ${asset.range.start}-${asset.range.end}/${asset.range.total}`
    }
    return new Response(asset.body, {
      status: asset.range ? 206 : 200,
      headers,
    })
  })

  app.get("/projects/:projectID/generation-tasks", async (c) =>
    ok(c, await CinemaUseCase.listCinemaGenerationTasks(c.req.param("projectID")))
  )

  app.post("/projects/:projectID/generation-tasks", async (c) => {
    const payload = await parseJsonBody(
      c,
      CreateCinemaGenerationTaskBodySchema,
      "Body must be a valid Cinema generation task request",
    )
    return ok(c, await CinemaUseCase.createCinemaGenerationTask(c.req.param("projectID"), payload))
  })

  app.get("/projects/:projectID/generation-tasks/:taskID", async (c) =>
    ok(c, await CinemaUseCase.getCinemaGenerationTask(c.req.param("projectID"), c.req.param("taskID")))
  )

  app.post("/projects/:projectID/generation-tasks/:taskID/refresh", async (c) =>
    ok(c, await CinemaUseCase.refreshCinemaGenerationTask(c.req.param("projectID"), c.req.param("taskID")))
  )

  app.post("/projects/:projectID/generation-tasks/:taskID/cancel", async (c) =>
    ok(c, await CinemaUseCase.cancelCinemaGenerationTask(c.req.param("projectID"), c.req.param("taskID")))
  )

  app.put("/projects/:projectID/canvas", async (c) => {
    const payload = await parseJsonBody(
      c,
      CinemaCanvasDocumentSchema,
      "Body must be a valid Cinema canvas document",
    )
    return ok(c, await CinemaUseCase.updateCinemaCanvas(c.req.param("projectID"), payload))
  })

  app.post("/projects/:projectID/commands", async (c) => {
    const payload = await parseJsonBody(
      c,
      CinemaCommandSchema,
      "Body must be a valid Cinema command",
    )
    return ok(c, await CinemaUseCase.applyCinemaCommand(c.req.param("projectID"), payload))
  })

  return app
}
