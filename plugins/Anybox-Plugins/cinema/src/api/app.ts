import { Hono, type Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { CinemaAssetLibraryRoutes } from "./cinema-assets.ts"
import { CinemaRoutes } from "./cinema-routes.ts"
import { CinemaManagementRoutes } from "./management-routes.ts"
import { isApiError } from "./error.ts"
import type { AppEnv } from "./types.ts"
import cinemaVersion from "../version.json"

type Authorize = (context: Context<AppEnv>) => Promise<Response | void> | Response | void

function jsonError(
  c: Context<AppEnv>,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  data?: unknown,
) {
  return c.json({
    success: false,
    error: { code, message, ...(data === undefined ? {} : { data }) },
    requestId: c.get("requestId") ?? "unknown",
  }, status)
}

export function createServerApp(options: {
  mode?: "anybox" | "standalone" | "test"
  authorize?: Authorize
} = {}) {
  const app = new Hono<AppEnv>()
  const mode = options.mode ?? "test"

  app.use("*", async (c, next) => {
    const id = crypto.randomUUID()
    c.set("requestId", id)
    c.set("runtimeMode", mode)
    c.header("x-request-id", id)
    const denied = await options.authorize?.(c)
    if (denied) return denied
    await next()
  })

  app.get("/health", (c) => c.json({
    ready: true,
    appID: process.env.ANYBOX_APP_ID?.trim() || "cinema",
    version: process.env.ANYBOX_APP_VERSION?.trim() || cinemaVersion.version,
    mode,
  }))

  app.route("/api/cinema", CinemaManagementRoutes())
  app.route("/api/cinema", CinemaRoutes())
  app.route("/api/cinema", CinemaAssetLibraryRoutes())

  app.notFound((c) => jsonError(c, 404, "NOT_FOUND", "Route not found"))
  app.onError((error, c) => {
    if (isApiError(error)) return jsonError(c, error.status, error.code, error.message, error.data)
    console.error("[cinema-runtime] unhandled request error", error)
    return jsonError(c, 500, "INTERNAL_ERROR", "Internal server error")
  })
  return app
}
