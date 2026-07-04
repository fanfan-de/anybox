import { Hono } from "hono"
import { z } from "zod"
import { ok, parseJsonBody, parseQuery } from "#server/http.ts"
import type { AppEnv } from "#server/types.ts"
import * as CinemaUseCase from "#server/usecases/cinema.ts"
import { CinemaCanvasDocumentSchema, CinemaCommandSchema } from "@anybox/shared/cinema"

const CinemaEventsQuerySchema = z.object({
  after: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

export function CinemaRoutes() {
  const app = new Hono<AppEnv>()

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
