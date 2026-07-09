import { Hono } from "hono"
import type { Context } from "hono"
import { createBunWebSocket } from "hono/bun"
import { cors } from "hono/cors"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { AutomationEventRoutes } from "#server/routes/automation-events.ts"
import { AutomationRoutes, AutomationRunRoutes } from "#server/routes/automations.ts"
import { CalendarRoutes } from "#server/routes/calendar.ts"
import { ProjectRoutes } from "#server/routes/projects.ts"
import { PermissionsRoutes } from "#server/routes/permissions.ts"
import { PtyRoutes } from "#server/routes/pty.ts"
import { RemoteRoutes } from "#server/routes/remote.ts"
import { WorkspaceFilesRoutes } from "#server/routes/workspace-files.ts"
import { BrowserExtensionRoutes } from "#server/routes/browser-extension.ts"
import { CinemaRoutes } from "#server/routes/cinema.ts"
import { CinemaWebRoutes } from "#server/routes/cinema-web.ts"
import { DebugRoutes } from "#server/routes/debug.ts"
import { SettingsRoutes } from "#server/routes/settings.ts"
import { SessionRoutes } from "#server/routes/session.ts"
import { StorageRoutes } from "#server/routes/storage.ts"
import { isApiError } from "#server/error.ts"
import { isSessionLimitError } from "#session/runtime/session-limits.ts"
import type { AppEnv } from "#server/types.ts"
import { getPtyRegistry, type PtyRegistry } from "#pty/registry.ts"
import { isPtyRuntimeError } from "#pty/runtime.ts"
import * as Log from "#util/log.ts"
import { getProcessEnvValue } from "#env/compat.ts"
import { getServerBaseURL, setServerBaseURL } from "#server/base-url.ts"
import { startAutomationScheduler } from "#automation/scheduler.ts"

export interface ServerOptions {
  host?: string
  port?: number
  idleTimeout?: number
  corsWhitelist?: string[]
  ptyRegistry?: PtyRegistry
}

const log = Log.create({ service: "server" })
let activeServer: Bun.Server<unknown> | undefined

function getRequestId(c: Context<AppEnv>) {
  return c.get("requestId") ?? "unknown"
}

function jsonError(c: Context<AppEnv>, status: ContentfulStatusCode, code: string, message: string) {
  return c.json(
    {
      success: false,
      error: { code, message },
      requestId: getRequestId(c),
    },
    status,
  )
}

function parsePort(input: string | undefined, fallback: number) {
  if (!input) return fallback
  const parsed = Number(input)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return parsed
}

function parseIdleTimeout(input: string | undefined, fallback: number) {
  if (input === undefined) return fallback

  const parsed = Number(input)
  if (!Number.isInteger(parsed) || parsed < 0) return fallback

  return Math.min(parsed, 255)
}

export function createServerApp(options: Pick<ServerOptions, "corsWhitelist"> = {}) {
  return createServerRuntime(options).app
}

export function createServerRuntime(options: Pick<ServerOptions, "corsWhitelist" | "ptyRegistry"> = {}) {
  const app = new Hono<AppEnv>()
  const whitelist = (options.corsWhitelist ?? []).filter(Boolean)
  const { upgradeWebSocket, websocket } = createBunWebSocket()
  const ptyRegistry = options.ptyRegistry ?? getPtyRegistry()

  app.use("*", async (c, next) => {
    const requestId = crypto.randomUUID()
    c.set("requestId", requestId)
    c.header("x-request-id", requestId)
    await next()
  })

  if (whitelist.length > 0) app.use("/api/*", cors({ origin: whitelist }))
  else app.use("/api/*", cors())

  app.use("*", async (c, next) => {
    const started = Date.now()
    try {
      await next()
    } finally {
      const url = new URL(c.req.url)
      log.info("request", {
        method: c.req.method,
        path: url.pathname,
        status: c.res.status,
        duration: Date.now() - started,
        requestId: getRequestId(c),
      })
    }
  })

  app.get("/", (c) =>
    c.json({
      success: true,
      data: {
        service: "anyboxagent-api",
      },
      requestId: getRequestId(c),
    }),
  )

  app.get("/healthz", (c) =>
    c.json({
      success: true,
      data: { ok: true },
      requestId: getRequestId(c),
    }),
  )

  app.route("/api", SettingsRoutes())
  app.route("/api/debug", DebugRoutes())
  app.route("/api/permissions", PermissionsRoutes())
  app.route("/api/remote", RemoteRoutes())
  app.route("/api/workspace-files", WorkspaceFilesRoutes())
  app.route("/api/browser-extension", BrowserExtensionRoutes({ upgradeWebSocket }))
  app.route("/api/pty", PtyRoutes({ registry: ptyRegistry, upgradeWebSocket }))
  app.route("/api/automation-events", AutomationEventRoutes())
  app.route("/api/automations", AutomationRoutes())
  app.route("/api/automation-runs", AutomationRunRoutes())
  app.route("/api/calendar", CalendarRoutes())
  app.route("/api/cinema", CinemaRoutes())
  app.route("/api/projects", ProjectRoutes({ ptyRegistry }))
  app.route("/api/sessions", SessionRoutes({ ptyRegistry }))
  app.route("/api/storage", StorageRoutes())
  app.route("/", CinemaWebRoutes())

  app.notFound((c) => jsonError(c, 404, "NOT_FOUND", "Route not found"))

  app.onError((error, c) => {
    if (isApiError(error)) return jsonError(c, error.status, error.code, error.message)
    if (isPtyRuntimeError(error)) {
      const status = error.code === "PTY_RUNTIME_UNAVAILABLE" ? 503 : 500
      return jsonError(c, status, error.code, error.message)
    }
    if (isSessionLimitError(error)) return jsonError(c, 429, error.code, error.message)

    log.error("unhandled-error", {
      error,
      requestId: getRequestId(c),
      path: new URL(c.req.url).pathname,
    })
    return jsonError(c, 500, "INTERNAL_ERROR", "Internal server error")
  })

  return {
    app,
    websocket,
  }
}

export function url() {
  return getServerBaseURL()
}

export function startServer(options: ServerOptions = {}) {
  if (activeServer) return activeServer

  const host = options.host ?? getProcessEnvValue("ANYBOX_SERVER_HOST") ?? "127.0.0.1"
  const port = options.port ?? parsePort(getProcessEnvValue("ANYBOX_SERVER_PORT"), 4096)
  const idleTimeout = options.idleTimeout ?? parseIdleTimeout(getProcessEnvValue("ANYBOX_SERVER_IDLE_TIMEOUT"), 120)
  const runtime = createServerRuntime({
    corsWhitelist: options.corsWhitelist,
    ptyRegistry: options.ptyRegistry,
  })
  activeServer = Bun.serve({
    hostname: host,
    port,
    idleTimeout,
    fetch(request, server) {
      return runtime.app.fetch(request, server)
    },
    websocket: runtime.websocket,
  })
  setServerBaseURL(`http://${host}:${port}`)
  startAutomationScheduler()
  log.info("server-started", {
    host,
    port,
    idleTimeout,
    url: getServerBaseURL().toString(),
  })
  return activeServer
}

export function stopServer() {
  if (!activeServer) return
  activeServer.stop(true)
  activeServer = undefined
  log.info("server-stopped")
}
