import { Hono } from "hono"
import { ok, parseJsonBody } from "#server/http.ts"
import type { AppEnv } from "#server/types.ts"
import * as CinemaUseCase from "#server/usecases/cinema.ts"
import { CinemaCanvasDocumentSchema } from "@anybox/shared/cinema"

export function CinemaRoutes() {
  const app = new Hono<AppEnv>()

  app.get("/projects/:projectID", async (c) =>
    ok(c, await CinemaUseCase.getCinemaProject(c.req.param("projectID")))
  )

  app.get("/projects/:projectID/canvas", async (c) =>
    ok(c, await CinemaUseCase.getCinemaCanvas(c.req.param("projectID")))
  )

  app.put("/projects/:projectID/canvas", async (c) => {
    const payload = await parseJsonBody(
      c,
      CinemaCanvasDocumentSchema,
      "Body must be a valid Cinema canvas document",
    )
    return ok(c, await CinemaUseCase.updateCinemaCanvas(c.req.param("projectID"), payload))
  })

  app.post("/projects/:projectID/open-link", (c) =>
    ok(c, CinemaUseCase.getCinemaOpenLink(c.req.param("projectID")))
  )

  return app
}
