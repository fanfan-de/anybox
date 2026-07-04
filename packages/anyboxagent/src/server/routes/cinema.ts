import { Hono } from "hono"
import { z } from "zod"
import { ok, parseJsonBody, parseQuery } from "#server/http.ts"
import type { AppEnv } from "#server/types.ts"
import * as CinemaUseCase from "#server/usecases/cinema.ts"
import { CinemaCanvasDocumentSchema, CinemaCommandSchema, CreateCinemaGenerationTaskBodySchema } from "@anybox/shared/cinema"

const CinemaEventsQuerySchema = z.object({
  after: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

const CinemaProviderApiKeyBodySchema = z.object({
  apiKey: z.string().nullable().optional(),
})

export function CinemaRoutes() {
  const app = new Hono<AppEnv>()

  app.get("/video-providers", async (c) =>
    ok(c, await CinemaUseCase.listCinemaVideoProviders())
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

  app.get("/projects/:projectID", async (c) =>
    ok(c, await CinemaUseCase.getCinemaProject(c.req.param("projectID")))
  )

  app.get("/projects/:projectID/canvas", async (c) =>
    ok(c, await CinemaUseCase.getCinemaCanvas(c.req.param("projectID")))
  )

  app.get("/projects/:projectID/summary", async (c) =>
    ok(c, await CinemaUseCase.getCinemaProjectStateSummary(c.req.param("projectID")))
  )

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
