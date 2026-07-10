import { Hono, type Context } from "hono"
import { z } from "zod"
import {
  CreateCinemaAssetFolderBodySchema,
  CinemaAssetLibraryEntriesQuerySchema,
  MoveCinemaAssetEntriesBodySchema,
  PermanentlyDeleteCinemaAssetEntriesBodySchema,
  ReconcileCinemaAssetLibraryBodySchema,
  RestoreCinemaAssetEntriesBodySchema,
  RetryCinemaAssetProcessingBodySchema,
  StartCinemaAssetMigrationBodySchema,
  TrashCinemaAssetEntriesBodySchema,
  UpdateCinemaAssetBodySchema,
  UpdateCinemaAssetFolderBodySchema,
  type CinemaAssetScope,
} from "@anybox/shared/cinema"
import * as AssetLibrary from "#cinema/asset-library.ts"
import * as AssetLibraryMigration from "#cinema/asset-library-migration.ts"
import { getProcessEnvValue } from "#env/compat.ts"
import { ApiError } from "#server/error.ts"
import { ok, parseJsonBody, parseQuery } from "#server/http.ts"
import type { AppEnv } from "#server/types.ts"

const UploadQuerySchema = z.object({
  operationID: z.string().min(1).optional(),
  baseRevision: z.coerce.number().int().nonnegative().optional(),
  folderID: z.string().min(1).optional(),
  fileName: z.string().min(1).max(240).optional(),
})

type ScopeResolver = (context: Context<AppEnv>) => CinemaAssetScope

function ScopeAssetLibraryRoutes(
  resolveScope: ScopeResolver,
  migrationProjectID?: (context: Context<AppEnv>) => string,
) {
  const app = new Hono<AppEnv>()

  app.use("*", async (c, next) => {
    if (c.req.method !== "GET" && migrationProjectID) {
      const migration = await AssetLibraryMigration.getCinemaAssetMigrationStatus(migrationProjectID(c))
      if (migration.readOnly) {
        throw new ApiError(
          409,
          "CINEMA_LIBRARY_MIGRATION_REQUIRED",
          migration.error ?? "Complete or recover the legacy asset migration before modifying this library.",
        )
      }
    }
    await next()
  })

  app.get("/state", async (c) => {
    const state = await AssetLibrary.getCinemaAssetLibraryState(resolveScope(c))
    if (!migrationProjectID) return ok(c, state)
    const migration = await AssetLibraryMigration.getCinemaAssetMigrationStatus(migrationProjectID(c))
    return ok(c, { ...state, readOnly: state.readOnly || migration.readOnly })
  })

  app.get("/entries", async (c) => {
    const query = parseQuery(
      c.req.query(),
      CinemaAssetLibraryEntriesQuerySchema,
      "CINEMA_LIBRARY_QUERY_INVALID",
      "Asset library query is invalid.",
    )
    return ok(c, await AssetLibrary.listCinemaAssetLibraryEntries(resolveScope(c), query))
  })

  app.post("/folders", async (c) => {
    const input = await parseJsonBody(c, CreateCinemaAssetFolderBodySchema, "Folder request is invalid.")
    return ok(c, await AssetLibrary.createCinemaAssetFolder(resolveScope(c), input), 201)
  })

  app.patch("/folders/:folderID", async (c) => {
    const input = await parseJsonBody(c, UpdateCinemaAssetFolderBodySchema, "Folder update is invalid.")
    return ok(c, await AssetLibrary.updateCinemaAssetFolder(resolveScope(c), c.req.param("folderID"), input))
  })

  app.post("/moves", async (c) => {
    const input = await parseJsonBody(c, MoveCinemaAssetEntriesBodySchema, "Move request is invalid.")
    return ok(c, await AssetLibrary.moveCinemaAssetEntries(resolveScope(c), input))
  })

  app.post("/trash", async (c) => {
    const input = await parseJsonBody(c, TrashCinemaAssetEntriesBodySchema, "Trash request is invalid.")
    return ok(c, await AssetLibrary.trashCinemaAssetEntries(resolveScope(c), input))
  })

  app.post("/restore", async (c) => {
    const input = await parseJsonBody(c, RestoreCinemaAssetEntriesBodySchema, "Restore request is invalid.")
    return ok(c, await AssetLibrary.restoreCinemaAssetEntries(resolveScope(c), input))
  })

  app.post("/permanent-delete", async (c) => {
    const input = await parseJsonBody(c, PermanentlyDeleteCinemaAssetEntriesBodySchema, "Permanent delete request is invalid.")
    return ok(c, await AssetLibrary.permanentlyDeleteCinemaAssetEntries(resolveScope(c), input))
  })

  app.post("/uploads", async (c) => {
    const query = parseQuery(
      c.req.query(),
      UploadQuerySchema,
      "CINEMA_LIBRARY_UPLOAD_QUERY_INVALID",
      "Upload query is invalid.",
    )
    return ok(c, await AssetLibrary.uploadCinemaAsset(resolveScope(c), c.req.raw, query), 201)
  })

  app.get("/assets/:assetID", async (c) =>
    ok(c, await AssetLibrary.getCinemaAsset(resolveScope(c), c.req.param("assetID")))
  )

  app.patch("/assets/:assetID", async (c) => {
    const input = await parseJsonBody(c, UpdateCinemaAssetBodySchema, "Asset update is invalid.")
    return ok(c, await AssetLibrary.updateCinemaAsset(resolveScope(c), c.req.param("assetID"), input))
  })

  async function binaryResponse(c: Context<AppEnv>, variant: "content" | "preview" | "thumbnail") {
    const binary = await AssetLibrary.readCinemaAssetBinary(
      resolveScope(c),
      c.req.param("assetID")!,
      variant,
      variant === "thumbnail" ? undefined : c.req.header("range"),
    )
    const headers: Record<string, string> = {
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=3600",
      "content-length": String(binary.contentLength),
      "content-type": binary.mimeType,
      "etag": `"asset-${binary.contentRevision}"`,
      "x-content-type-options": "nosniff",
    }
    if (binary.range) {
      headers["content-range"] = `bytes ${binary.range.start}-${binary.range.end}/${binary.range.total}`
    }
    if (binary.mimeType.startsWith("image/svg+xml")) headers["content-security-policy"] = "sandbox"
    return new Response(binary.body, { status: binary.range ? 206 : 200, headers })
  }

  app.get("/assets/:assetID/content", async (c) => await binaryResponse(c, "content"))
  app.get("/assets/:assetID/preview", async (c) => await binaryResponse(c, "preview"))
  app.get("/assets/:assetID/thumbnail", async (c) => await binaryResponse(c, "thumbnail"))

  app.post("/assets/:assetID/retry-processing", async (c) => {
    const input = await parseJsonBody(c, RetryCinemaAssetProcessingBodySchema, "Retry request is invalid.")
    return ok(c, await AssetLibrary.retryCinemaAssetProcessing(resolveScope(c), c.req.param("assetID"), input))
  })

  app.post("/reconcile", async (c) => {
    const input = await parseJsonBody(c, ReconcileCinemaAssetLibraryBodySchema, "Reconcile request is invalid.")
    return ok(c, await AssetLibrary.reconcileCinemaAssetLibrary(resolveScope(c), input))
  })

  return app
}

export function CinemaAssetLibraryRoutes() {
  const app = new Hono<AppEnv>()
  app.use("*", async (_c, next) => {
    const flag = getProcessEnvValue("ANYBOX_CINEMA_ASSET_LIBRARY")?.trim().toLowerCase()
    if (["0", "false", "off"].includes(flag ?? "")) {
      // The flag hides authoring and management surfaces, but existing Canvas
      // assetRef nodes must keep resolving and playing their media.
      const compatibilityRead = _c.req.method === "GET" && _c.req.path.includes("/assets/")
      if (!compatibilityRead) {
        throw new ApiError(404, "CINEMA_ASSET_LIBRARY_DISABLED", "Cinema asset library is disabled.")
      }
    }
    await next()
  })
  app.get("/projects/:projectID/library/migration", async (c) =>
    ok(c, await AssetLibraryMigration.getCinemaAssetMigrationStatus(c.req.param("projectID"))))
  app.post("/projects/:projectID/library/migration", async (c) => {
    const input = await parseJsonBody(c, StartCinemaAssetMigrationBodySchema, "Asset migration request is invalid.")
    return ok(c, await AssetLibraryMigration.startCinemaAssetMigration(c.req.param("projectID"), input))
  })
  app.route(
    "/projects/:projectID/library",
    ScopeAssetLibraryRoutes(
      (c) => ({ type: "project", projectID: c.req.param("projectID")! }),
      (c) => c.req.param("projectID")!,
    ),
  )
  app.route("/personal-library", ScopeAssetLibraryRoutes(() => ({ type: "personal" })))
  app.get("/projects/:projectID/library/personal-dependencies", async (c) =>
    ok(c, await AssetLibrary.listCinemaPersonalAssetDependencies(c.req.param("projectID")))
  )
  return app
}
