import { randomBytes, timingSafeEqual } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Context } from "hono"
import { createServerApp } from "./api/app.ts"
import { setServerBaseURL } from "./api/base-url.ts"
import { ApiError } from "./api/error.ts"
import type { AppEnv } from "./api/types.ts"
import { cinemaRenderQueue } from "./domain/render-queue.ts"
import * as Global from "./platform/global.ts"
import { clearSessionCredentials } from "./platform/provider-auth.ts"
import { initializeProjectRegistry } from "./storage/projects.ts"

type RuntimeMode = "anybox" | "standalone"

function tokenMatches(expected: string, received: string | undefined) {
  if (!received) return false
  const left = Buffer.from(expected)
  const right = Buffer.from(received)
  return left.length === right.length && timingSafeEqual(left, right)
}

function cookieValue(request: Request, name: string) {
  const raw = request.headers.get("cookie") ?? ""
  for (const item of raw.split(";")) {
    const [key, ...rest] = item.trim().split("=")
    if (key === name) return decodeURIComponent(rest.join("="))
  }
  return undefined
}

function standaloneDefaultData() {
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "AnyboxCinema")
  }
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "AnyboxCinema")
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "anybox-cinema")
}

function argument(name: string) {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function runtimeConfiguration() {
  const standalone = process.argv.includes("--standalone")
  if (!standalone) {
    const port = Number.parseInt(process.env.ANYBOX_APP_PORT?.trim() || "", 10)
    const token = process.env.ANYBOX_APP_TOKEN?.trim() || ""
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) throw new Error("ANYBOX_APP_PORT must contain a valid loopback port.")
    if (!token) throw new Error("ANYBOX_APP_TOKEN is required.")
    return {
      mode: "anybox" as const,
      port,
      token,
      data: process.env.ANYBOX_APP_DATA_DIR?.trim() || Global.Path.data,
      cache: process.env.ANYBOX_APP_CACHE_DIR?.trim() || Global.Path.cache,
      log: process.env.ANYBOX_APP_LOG_DIR?.trim() || Global.Path.log,
    }
  }

  const data = path.resolve(argument("--data-dir") || standaloneDefaultData())
  const requestedPort = Number.parseInt(argument("--port") || "0", 10)
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65_535) throw new Error("--port must be between 0 and 65535.")
  return {
    mode: "standalone" as const,
    port: requestedPort,
    token: randomBytes(32).toString("base64url"),
    data,
    cache: path.resolve(argument("--cache-dir") || path.join(data, "cache")),
    log: path.resolve(argument("--log-dir") || path.join(data, "logs")),
  }
}

const config = runtimeConfiguration()
Global.configureRuntimePaths(config)
await initializeProjectRegistry()

const sessionToken = randomBytes(32).toString("base64url")
const csrfToken = randomBytes(24).toString("base64url")
let standaloneOrigin = ""
let bootstrapConsumed = false

async function authorize(c: Context<AppEnv>) {
  if (config.mode === "anybox") {
    if (!tokenMatches(config.token, c.req.header("x-anybox-app-runtime-token"))) {
      throw new ApiError(401, "APP_RUNTIME_UNAUTHORIZED", "App Runtime request was not authorized.")
    }
    return
  }

  const url = new URL(c.req.url)
  if (url.pathname === "/bootstrap") {
    if (bootstrapConsumed || !tokenMatches(config.token, url.searchParams.get("token") ?? undefined)) {
      throw new ApiError(401, "APP_RUNTIME_UNAUTHORIZED", "Standalone bootstrap token is invalid.")
    }
    bootstrapConsumed = true
    const headers = new Headers({
      location: "/",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    })
    headers.append("set-cookie", `cinema_session=${encodeURIComponent(sessionToken)}; HttpOnly; SameSite=Strict; Path=/`)
    headers.append("set-cookie", `cinema_csrf=${encodeURIComponent(csrfToken)}; SameSite=Strict; Path=/`)
    return new Response(null, { status: 302, headers })
  }

  if (!tokenMatches(sessionToken, cookieValue(c.req.raw, "cinema_session"))) {
    throw new ApiError(401, "APP_RUNTIME_UNAUTHORIZED", "Standalone Cinema session is not authorized.")
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("origin")
    if (origin !== standaloneOrigin || !tokenMatches(csrfToken, c.req.header("x-cinema-csrf"))) {
      throw new ApiError(403, "APP_RUNTIME_CSRF_REJECTED", "Standalone Cinema request failed origin or CSRF validation.")
    }
  }
}

const app = createServerApp({ mode: config.mode, authorize })
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const webRoot = path.join(pluginRoot, "web")
const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
}

async function standaloneStaticResponse(request: Request) {
  if (config.mode !== "standalone" || request.method !== "GET") return undefined
  const url = new URL(request.url)
  if (url.pathname.startsWith("/api/") || url.pathname === "/health" || url.pathname === "/bootstrap") return undefined
  const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.replace(/^\/+/, ""))
  if (relative.split(/[\\/]/).some((segment) => segment === "..")) return undefined
  let candidate = path.resolve(webRoot, relative)
  if (!candidate.startsWith(`${path.resolve(webRoot)}${path.sep}`) && candidate !== path.join(path.resolve(webRoot), "index.html")) return undefined
  const info = await stat(candidate).catch(() => undefined)
  if (!info?.isFile()) candidate = path.join(webRoot, "index.html")
  const body = await readFile(candidate)
  return new Response(body, {
    headers: {
      "content-type": CONTENT_TYPES[path.extname(candidate).toLowerCase()] || "application/octet-stream",
      "cache-control": path.basename(candidate) === "index.html" ? "no-store" : "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    },
  })
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: config.port,
  idleTimeout: 255,
  async fetch(request) {
    const response = await app.fetch(request)
    if (response.status !== 404) return response
    return await standaloneStaticResponse(request) ?? response
  },
})

standaloneOrigin = server.url.origin
setServerBaseURL(server.url)
console.log(`[cinema-runtime] ready ${server.url}`)
if (config.mode === "standalone") console.log(`[cinema-runtime] open ${new URL(`/bootstrap?token=${encodeURIComponent(config.token)}`, server.url)}`)

let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[cinema-runtime] stopping (${signal})`)
  server.stop(true)
  clearSessionCredentials()
  await cinemaRenderQueue.shutdown()
  process.exit(0)
}

process.on("SIGINT", () => void shutdown("SIGINT"))
process.on("SIGTERM", () => void shutdown("SIGTERM"))

await new Promise(() => undefined)
