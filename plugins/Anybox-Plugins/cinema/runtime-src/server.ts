import { timingSafeEqual } from "node:crypto"
import { Hono } from "../../../../packages/anyboxagent/node_modules/hono/dist/index.js"
import type { Context } from "../../../../packages/anyboxagent/node_modules/hono/dist/types/context.d.ts"
import type { ContentfulStatusCode } from "../../../../packages/anyboxagent/node_modules/hono/dist/types/utils/http-status.d.ts"
import { cinemaRenderQueue } from "../../../../packages/anyboxagent/src/cinema/render-queue.ts"
import { isApiError } from "../../../../packages/anyboxagent/src/server/error.ts"
import { setServerBaseURL } from "../../../../packages/anyboxagent/src/server/base-url.ts"
import { CinemaAssetLibraryRoutes } from "../../../../packages/anyboxagent/src/server/routes/cinema-assets.ts"
import { CinemaRoutes } from "../../../../packages/anyboxagent/src/server/routes/cinema.ts"
import type { AppEnv } from "../../../../packages/anyboxagent/src/server/types.ts"

const appID = process.env.ANYBOX_APP_ID?.trim() || "cinema"
const appVersion = process.env.ANYBOX_APP_VERSION?.trim() || "0.0.0"
const host = "127.0.0.1"
const port = Number.parseInt(process.env.ANYBOX_APP_PORT?.trim() || "", 10)
const runtimeToken = process.env.ANYBOX_APP_TOKEN?.trim() || ""

if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
  throw new Error("ANYBOX_APP_PORT must contain a valid loopback port.")
}
if (!runtimeToken) {
  throw new Error("ANYBOX_APP_TOKEN is required.")
}

setServerBaseURL(`http://${host}:${port}`)

function tokenMatches(value: string | undefined) {
  if (!value) return false
  const expected = Buffer.from(runtimeToken)
  const received = Buffer.from(value)
  return expected.length === received.length && timingSafeEqual(expected, received)
}

function requestID(c: { get(name: "requestId"): string | undefined }) {
  return c.get("requestId") ?? "unknown"
}

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
    requestId: requestID(c),
  }, status)
}

const app = new Hono<AppEnv>()

app.use("*", async (c, next) => {
  const id = crypto.randomUUID()
  c.set("requestId", id)
  c.header("x-request-id", id)
  if (!tokenMatches(c.req.header("x-anybox-app-runtime-token"))) {
    return jsonError(c, 401, "APP_RUNTIME_UNAUTHORIZED", "App Runtime request was not authorized.")
  }
  await next()
})

app.get("/health", (c) => c.json({
  ready: true,
  appID,
  version: appVersion,
}))

app.route("/api/cinema", CinemaRoutes())
app.route("/api/cinema", CinemaAssetLibraryRoutes())

app.notFound((c) => jsonError(c, 404, "NOT_FOUND", "Route not found"))
app.onError((error, c) => {
  if (isApiError(error)) return jsonError(c, error.status, error.code, error.message, error.data)
  console.error("[cinema-runtime] unhandled request error", error)
  return jsonError(c, 500, "INTERNAL_ERROR", "Internal server error")
})

const server = Bun.serve({
  hostname: host,
  port,
  idleTimeout: 255,
  fetch: app.fetch,
})

console.log(`[cinema-runtime] ready ${server.url}`)

let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[cinema-runtime] stopping (${signal})`)
  server.stop(true)
  await cinemaRenderQueue.shutdown()
  process.exit(0)
}

process.on("SIGINT", () => void shutdown("SIGINT"))
process.on("SIGTERM", () => void shutdown("SIGTERM"))

await new Promise(() => undefined)
