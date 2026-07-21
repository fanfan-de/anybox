import { Hono } from "hono"
import { ok } from "#server/http.ts"
import type { AppEnv } from "#server/types.ts"
import * as StorageUseCase from "#server/usecases/storage.ts"
import { ApiError } from "#server/error.ts"
import { StorageMaintenanceBusyError } from "#session/runtime/storage-maintenance.ts"

export function StorageRoutes() {
  const app = new Hono<AppEnv>()

  app.get("/usage", (c) => ok(c, StorageUseCase.getStorageUsage()))
  app.post("/optimize", async (c) => {
    try {
      return ok(c, await StorageUseCase.optimizeStorage())
    } catch (error) {
      if (error instanceof StorageMaintenanceBusyError) {
        throw new ApiError(409, "STORAGE_MAINTENANCE_BUSY", error.message)
      }
      throw error
    }
  })

  return app
}
