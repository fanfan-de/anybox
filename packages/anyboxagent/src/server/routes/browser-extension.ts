import { Hono } from "hono"
import { ok } from "#server/http.ts"
import type { AppEnv } from "#server/types.ts"

export function BrowserExtensionRoutes() {
  const app = new Hono<AppEnv>()

  // Browser control is intentionally absent from HTTP. This endpoint exposes
  // no connection state, IPC locator, broker identity, or credential.
  app.get("/health", (c) => ok(c, { ok: true }))

  return app
}
