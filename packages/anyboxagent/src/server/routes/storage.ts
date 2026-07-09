import { Hono } from "hono"
import { ok } from "#server/http.ts"
import type { AppEnv } from "#server/types.ts"
import * as StorageUseCase from "#server/usecases/storage.ts"

export function StorageRoutes() {
  const app = new Hono<AppEnv>()

  app.get("/usage", (c) => ok(c, StorageUseCase.getStorageUsage()))

  return app
}
