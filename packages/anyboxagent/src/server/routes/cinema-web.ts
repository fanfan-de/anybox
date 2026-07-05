import path from "node:path"
import { existsSync } from "node:fs"
import { stat } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { Hono } from "hono"
import { getProcessEnvValue } from "#env/compat.ts"
import type { AppEnv } from "#server/types.ts"

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
}

async function fileExists(filePath: string) {
  return await stat(filePath)
    .then((stats) => stats.isFile())
    .catch(() => false)
}

function resolveCinemaWebDist() {
  const explicit = getProcessEnvValue("ANYBOX_CINEMA_WEB_DIST")?.trim()
  if (explicit) return explicit

  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const bundledDist = path.join(moduleDir, "cinema-web")
  const candidates = [
    bundledDist,
    path.resolve(moduleDir, "..", "..", "..", "..", "cinema-web", "dist"),
    path.resolve(process.cwd(), "packages", "cinema-web", "dist"),
  ]

  return candidates.find((candidate) => existsSync(path.join(candidate, "index.html"))) ?? bundledDist
}

function resolveRequestPath(distRoot: string, rawPath: string) {
  const pathname = rawPath.replace(/^\/cinema\/?/, "")
  const relativePath = pathname ? decodeURIComponent(pathname) : "index.html"
  const resolved = path.resolve(distRoot, relativePath)
  const root = path.resolve(distRoot)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null
  return resolved
}

async function serveFile(filePath: string) {
  return new Response(Bun.file(filePath), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
    },
  })
}

export function CinemaWebRoutes() {
  const app = new Hono<AppEnv>()

  app.get("/cinema", (c) => c.redirect("/cinema/"))
  app.get("/cinema/*", async (c) => {
    const distRoot = resolveCinemaWebDist()
    const pathname = new URL(c.req.url).pathname
    const requestPathname = pathname.replace(/^\/cinema\/?/, "")
    const requestHasExtension = requestPathname.length > 0 && path.extname(requestPathname).length > 0
    const requested = resolveRequestPath(distRoot, pathname)
    if (!requested) return c.text("Forbidden", 403)

    if (await fileExists(requested)) return serveFile(requested)

    if (requestHasExtension) return c.text("Not found", 404)

    const indexPath = path.join(distRoot, "index.html")
    if (await fileExists(indexPath)) return serveFile(indexPath)
    return c.text("Cinema Web UI has not been built.", 404)
  })

  return app
}
