import { Hono } from "hono"
import { ok, parseJsonBody } from "#server/http.ts"
import type { AppEnv } from "#server/types.ts"
import * as SkillRegistryUseCase from "#server/usecases/skill-registry.ts"
import type { SkillRegistryCatalog } from "#skill/registry/catalog.ts"

export interface SkillRegistryRoutesOptions {
  catalog?: SkillRegistryCatalog
}

export function SkillRegistryRoutes(options: SkillRegistryRoutesOptions = {}) {
  const app = new Hono<AppEnv>()

  app.get("/providers", async (c) => ok(c, await SkillRegistryUseCase.listProviders(options.catalog)))

  app.post("/search", async (c) => {
    const payload = await parseJsonBody(
      c,
      SkillRegistryUseCase.SearchRegistryBody,
      "Body must contain a valid registry search request",
      {},
    )
    return ok(c, await SkillRegistryUseCase.searchRegistry(payload, options.catalog, c.req.raw.signal))
  })

  app.post("/detail", async (c) => {
    const payload = await parseJsonBody(
      c,
      SkillRegistryUseCase.RegistrySkillBody,
      "Body must identify a registry provider and skill",
    )
    return ok(c, await SkillRegistryUseCase.getRegistrySkillDetail(payload, options.catalog, c.req.raw.signal))
  })

  app.post("/versions", async (c) => {
    const payload = await parseJsonBody(
      c,
      SkillRegistryUseCase.RegistrySkillBody,
      "Body must identify a registry provider and skill",
    )
    return ok(c, await SkillRegistryUseCase.listRegistrySkillVersions(payload, options.catalog, c.req.raw.signal))
  })

  app.post("/files", async (c) => {
    const payload = await parseJsonBody(
      c,
      SkillRegistryUseCase.RegistryVersionBody,
      "Body must identify a registry skill version",
    )
    return ok(c, await SkillRegistryUseCase.listRegistrySkillFiles(payload, options.catalog, c.req.raw.signal))
  })

  app.post("/file", async (c) => {
    const payload = await parseJsonBody(
      c,
      SkillRegistryUseCase.ReadRegistryFileBody,
      "Body must identify a registry skill file",
    )
    return ok(c, await SkillRegistryUseCase.readRegistrySkillFile(payload, options.catalog, c.req.raw.signal))
  })

  app.post("/security", async (c) => {
    const payload = await parseJsonBody(
      c,
      SkillRegistryUseCase.RegistryVersionBody,
      "Body must identify a registry skill version",
    )
    return ok(c, await SkillRegistryUseCase.getRegistrySkillSecurity(payload, options.catalog, c.req.raw.signal))
  })

  app.post("/download-descriptor", async (c) => {
    const payload = await parseJsonBody(
      c,
      SkillRegistryUseCase.RegistryVersionBody,
      "Body must identify a registry skill version",
    )
    return ok(c, await SkillRegistryUseCase.resolveRegistrySkillDownload(payload, options.catalog, c.req.raw.signal))
  })

  app.post("/download", async (c) => {
    const payload = await parseJsonBody(
      c,
      SkillRegistryUseCase.DownloadRegistrySkillBody,
      "Body must identify a registry skill; version is optional and resolves to latest",
    )
    return ok(c, await SkillRegistryUseCase.downloadRegistrySkill(payload, options.catalog, c.req.raw.signal), 201)
  })

  app.get("/downloads", async (c) =>
    ok(c, await SkillRegistryUseCase.listDownloadedRegistrySkills()))

  app.get("/downloads/:id", async (c) =>
    ok(c, await SkillRegistryUseCase.getDownloadedRegistrySkill(c.req.param("id"))))

  app.patch("/downloads/:id", async (c) => {
    const payload = await parseJsonBody(
      c,
      SkillRegistryUseCase.UpdateDownloadedRegistrySkillBody,
      "Body must contain the downloaded skill enabled state",
    )
    return ok(c, await SkillRegistryUseCase.updateDownloadedRegistrySkillEnabled(c.req.param("id"), payload))
  })

  app.delete("/downloads/:id", async (c) =>
    ok(c, await SkillRegistryUseCase.removeDownloadedRegistrySkill(c.req.param("id"))))

  app.post("/downloads/:id/files", async (c) => {
    const payload = await parseJsonBody(
      c,
      SkillRegistryUseCase.DownloadedRegistrySkillVersionBody,
      "Body must contain a valid downloaded skill version",
      {},
    )
    return ok(c, await SkillRegistryUseCase.listDownloadedRegistrySkillFiles(c.req.param("id"), payload.version))
  })

  app.post("/downloads/:id/file", async (c) => {
    const payload = await parseJsonBody(
      c,
      SkillRegistryUseCase.ReadDownloadedRegistrySkillFileBody,
      "Body must contain a valid downloaded skill file path",
      {},
    )
    return ok(c, await SkillRegistryUseCase.readDownloadedRegistrySkillFile(c.req.param("id"), payload))
  })

  app.post("/downloads/:id/update-preview", async (c) => {
    const payload = await parseJsonBody(
      c,
      SkillRegistryUseCase.DownloadedRegistrySkillVersionBody,
      "Body must contain a valid target version",
      {},
    )
    return ok(c, await SkillRegistryUseCase.previewDownloadedRegistrySkillUpdate(
      c.req.param("id"),
      payload.version,
      options.catalog,
      c.req.raw.signal,
    ))
  })

  app.post("/downloads/:id/update", async (c) => {
    const payload = await parseJsonBody(
      c,
      SkillRegistryUseCase.DownloadedRegistrySkillVersionBody,
      "Body must contain a valid target version",
      {},
    )
    return ok(c, await SkillRegistryUseCase.updateDownloadedRegistrySkill(
      c.req.param("id"),
      payload.version,
      options.catalog,
      c.req.raw.signal,
    ))
  })

  app.post("/downloads/:id/rollback", async (c) => {
    const payload = await parseJsonBody(
      c,
      SkillRegistryUseCase.DownloadedRegistrySkillVersionBody,
      "Body must contain a valid rollback version",
      {},
    )
    return ok(c, await SkillRegistryUseCase.rollbackDownloadedRegistrySkill(c.req.param("id"), payload.version))
  })

  app.post("/downloads/:id/fork", async (c) => {
    const payload = await parseJsonBody(
      c,
      SkillRegistryUseCase.ForkDownloadedRegistrySkillBody,
      "Body must contain a valid fork name",
      {},
    )
    return ok(c, await SkillRegistryUseCase.forkDownloadedRegistrySkill(c.req.param("id"), payload.name), 201)
  })

  return app
}
