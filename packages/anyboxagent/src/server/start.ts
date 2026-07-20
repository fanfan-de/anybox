import { startServer, stopServer, url } from "#server/server.ts"
import { cinemaRenderQueue } from "#cinema/render-queue.ts"
import * as Log from "#util/log.ts"
import { getProcessEnvValue } from "#env/compat.ts"
import * as Connector from "#connector/connector.ts"
import * as BuiltinMcp from "#mcp/builtin.ts"
import * as Plugin from "#plugin/plugin.ts"

const log = Log.create({ service: "server-bootstrap" })

function truthy(value: string | undefined) {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === "1" || normalized === "true"
}

function resolveLogLevel(): Log.Level {
  const candidate = getProcessEnvValue("ANYBOX_LOG_LEVEL")?.trim().toUpperCase()
  const parsed = candidate ? Log.Level.safeParse(candidate) : undefined
  if (parsed?.success) return parsed.data
  return process.env["NODE_ENV"] === "production" ? "INFO" : "DEBUG"
}

await Log.init({
  print: getProcessEnvValue("ANYBOX_LOG_PRINT") ? truthy(getProcessEnvValue("ANYBOX_LOG_PRINT")) : true,
  file: getProcessEnvValue("ANYBOX_LOG_FILE") ? truthy(getProcessEnvValue("ANYBOX_LOG_FILE")) : true,
  dev: process.env["NODE_ENV"] !== "production",
  level: resolveLogLevel(),
})

log.info("server-logging-ready", Log.status())

try {
  await BuiltinMcp.syncBuiltinMcpRuntimeBindings()
} catch (error) {
  log.error("built-in-mcp-runtime-reconcile-failed", { error })
}

try {
  await Plugin.reconcileInstalledRuntimeBindings()
} catch (error) {
  log.error("plugin-runtime-reconcile-failed", { error })
}

try {
  await Connector.syncConnectorRuntimeBindings()
} catch (error) {
  log.error("connector-runtime-reconcile-failed", { error })
}

startServer()
log.info("server-ready", { url: url().toString() })

let shutdownStarted = false

const shutdown = async (signal: "SIGINT" | "SIGTERM") => {
  if (shutdownStarted) return
  shutdownStarted = true
  log.info("server-shutdown", { signal })
  stopServer()
  await cinemaRenderQueue.shutdown()
  process.exit(0)
}

process.on("SIGINT", () => void shutdown("SIGINT"))
process.on("SIGTERM", () => void shutdown("SIGTERM"))

await new Promise(() => undefined)
