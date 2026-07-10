import { Hono } from "hono"
import { z } from "zod"
import { ApiError } from "#server/error.ts"
import { ok, parseJsonBody, parseQuery } from "#server/http.ts"
import type { AppEnv } from "#server/types.ts"
import * as CinemaUseCase from "#server/usecases/cinema.ts"
import {
  CinemaCanvasDocumentSchema,
  CinemaCommandSchema,
  CreateCinemaCustomApiNodeApiKeyBodySchema,
  CreateCinemaCustomApiRunBodySchema,
  CreateCinemaImageGenerationBodySchema,
  CreateCinemaImportedImageAssetBodySchema,
  CreateCinemaTextGenerationBodySchema,
  CreateCinemaGenerationTaskBodySchema,
  TestCinemaVideoProviderConnectionBodySchema,
  UpdateCinemaVideoProviderSettingsBodySchema,
} from "@anybox/shared/cinema"

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

  app.get("/video-providers", async (c) =>
    ok(c, await CinemaUseCase.listCinemaVideoProviders())
  )

  app.post("/video-providers/catalog/refresh", async (c) =>
    ok(c, await CinemaUseCase.refreshCinemaVideoProviderCatalog())
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

  app.get("/projects/:projectID", async (c) =>
    ok(c, await CinemaUseCase.getCinemaProject(c.req.param("projectID")))
  )

  app.get("/projects/:projectID/canvas", async (c) =>
    ok(c, await CinemaUseCase.getCinemaCanvas(c.req.param("projectID")))
  )

  app.get("/projects/:projectID/summary", async (c) =>
    ok(c, await CinemaUseCase.getCinemaProjectStateSummary(c.req.param("projectID")))
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

  app.post("/projects/:projectID/custom-api-runs", async (c) => {
    const payload = await parseJsonBody(
      c,
      CreateCinemaCustomApiRunBodySchema,
      "Body must be a valid Cinema Custom API run request",
    )
    return ok(c, await CinemaUseCase.createCinemaCustomApiRun(c.req.param("projectID"), payload))
  })

  app.put("/projects/:projectID/custom-api-nodes/:nodeID/auth/api-key", async (c) => {
    const payload = await parseJsonBody(
      c,
      CreateCinemaCustomApiNodeApiKeyBodySchema,
      "Body must contain an optional nullable 'apiKey' field.",
    )
    return ok(
      c,
      await CinemaUseCase.saveCinemaCustomApiNodeApiKey(c.req.param("projectID"), c.req.param("nodeID"), payload.apiKey),
    )
  })

  app.post("/projects/:projectID/assets/imports", async (c) => {
    const payload = await parseJsonBody(
      c,
      CreateCinemaImportedImageAssetBodySchema,
      "Body must be a valid Cinema image import request",
    )
    return ok(c, await CinemaUseCase.importCinemaProjectImageAsset(c.req.param("projectID"), payload))
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

  app.post("/projects/:projectID/open-link", (c) =>
    ok(c, CinemaUseCase.getCinemaOpenLink(c.req.param("projectID")))
  )

  return app
}
