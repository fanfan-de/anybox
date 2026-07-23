import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  initializeCinemaAssetLibrary,
  registerCinemaGeneratedAsset,
  resetCinemaAssetLibraryInitializationForTest,
  setCinemaAssetLibraryCatalogWriteFailureForTest,
  setCinemaAssetLibraryNowForTest,
  setCinemaAssetLibraryPersonalRootForTest,
} from "#cinema/asset-library.ts"
import { createServerApp } from "#server/server.ts"
import { CinemaAssetCatalogSchema } from "@anybox/shared/cinema"

type Envelope<T> = { success: boolean; data?: T; error?: { code: string; message: string; data?: unknown } }

const cleanup: string[] = []
const restores: Array<() => void> = []

afterEach(async () => {
  while (restores.length) restores.pop()?.()
  resetCinemaAssetLibraryInitializationForTest()
  while (cleanup.length) await rm(cleanup.pop()!, { recursive: true, force: true })
})

async function json<T>(response: Response) {
  return await response.json() as Envelope<T>
}

function pngBytes() {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ])
}

function wavBytes() {
  const buffer = new ArrayBuffer(44 + 800)
  const view = new DataView(buffer)
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index))
  }
  text(0, "RIFF")
  view.setUint32(4, 36 + 800, true)
  text(8, "WAVE")
  text(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 8_000, true)
  view.setUint32(28, 16_000, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, "data")
  view.setUint32(40, 800, true)
  return new Uint8Array(buffer)
}

async function createCinemaProject() {
  const app = createServerApp()
  const root = await realpath(await mkdtemp(join(tmpdir(), "anybox-asset-library-")))
  cleanup.push(root)
  const createResponse = await app.request("http://localhost/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ directory: root }),
  })
  const project = await json<{ id: string }>(createResponse)
  expect(createResponse.status).toBe(201)
  const cinemaRoot = join(root, ".anybox-cinema")
  await mkdir(cinemaRoot, { recursive: true })
  await writeFile(join(cinemaRoot, "project.json"), JSON.stringify({ schemaVersion: 1, name: "Assets" }), "utf8")
  await writeFile(join(cinemaRoot, "canvas.json"), JSON.stringify({
    schemaVersion: 1,
    canvasType: "node-canvas",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
    nodeTypes: [],
  }), "utf8")
  return { app, root, projectID: project.data!.id }
}

function projectLibraryURL(projectID: string, suffix = "") {
  return `http://localhost/api/cinema/projects/${encodeURIComponent(projectID)}/library${suffix}`
}

function personalLibraryURL(suffix = "") {
  return `http://localhost/api/cinema/personal-library${suffix}`
}

async function uploadPersonalAsset(input: {
  app: ReturnType<typeof createServerApp>
  operationID: string
  baseRevision: number
  folderID: string
  name: string
  mimeType: string
  bytes: Uint8Array
}) {
  const form = new FormData()
  form.append("operationID", input.operationID)
  form.append("baseRevision", String(input.baseRevision))
  form.append("folderID", input.folderID)
  form.append("file", new File([input.bytes], input.name, { type: input.mimeType }))
  const response = await input.app.request(personalLibraryURL("/uploads"), {
    method: "POST",
    body: form,
  })
  const result = await json<{
    revision: number
    items: Array<{ success: true; asset: { id: string; kind: string; status: string } }>
  }>(response)
  expect(response.status).toBe(201)
  expect(result.data?.items[0]?.success).toBe(true)
  return {
    revision: result.data!.revision,
    asset: result.data!.items[0]!.asset,
  }
}

async function uploadProjectAsset(input: {
  app: ReturnType<typeof createServerApp>
  projectID: string
  operationID: string
  baseRevision: number
  folderID: string
  name: string
}) {
  const form = new FormData()
  form.append("operationID", input.operationID)
  form.append("baseRevision", String(input.baseRevision))
  form.append("folderID", input.folderID)
  form.append("file", new File([pngBytes()], input.name, { type: "image/png" }))
  const response = await input.app.request(projectLibraryURL(input.projectID, "/uploads"), {
    method: "POST",
    body: form,
  })
  const result = await json<{
    revision: number
    items: Array<{ success: true; asset: { id: string; status: string } }>
  }>(response)
  expect(response.status).toBe(201)
  return {
    revision: result.data!.revision,
    asset: result.data!.items[0]!.asset,
  }
}

describe("cinema asset library api", () => {
  test("initializes defaults and applies revisioned idempotent folder mutations", async () => {
    const { app, root, projectID } = await createCinemaProject()
    const stateResponse = await app.request(projectLibraryURL(projectID, "/state"))
    const state = await json<{
      revision: number
      status: string
      counts: { folders: number }
      defaultFolderIDs: Record<string, string>
    }>(stateResponse)
    expect(stateResponse.status).toBe(200)
    expect(state.data).toMatchObject({ revision: 0, status: "ready" })
    expect(state.data!.counts.folders).toBe(5)
    expect(Object.keys(state.data!.defaultFolderIDs).sort()).toEqual([
      "generated",
      "generated-audio",
      "generated-images",
      "generated-videos",
      "inbox",
    ])

    const entriesResponse = await app.request(projectLibraryURL(projectID, "/entries?folderID=root"))
    const entries = await json<{ entries: Array<{ entryType: string; folder?: { name: string } }> }>(entriesResponse)
    expect(entries.data!.entries.filter((entry) => entry.entryType === "folder").map((entry) => entry.folder?.name))
      .toEqual(["产出", "素材"])

    const request = {
      operationID: "create-reference-folder",
      baseRevision: 0,
      parentFolderID: "root",
      name: "参考图",
    }
    const createResponse = await app.request(projectLibraryURL(projectID, "/folders"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    })
    const created = await json<{ revision: number; folder: { id: string; depth: number } }>(createResponse)
    expect(createResponse.status).toBe(201)
    expect(created.data).toMatchObject({ revision: 1, folder: { depth: 1 } })

    const replayResponse = await app.request(projectLibraryURL(projectID, "/folders"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    })
    const replayed = await json<{ revision: number; folder: { id: string } }>(replayResponse)
    expect(replayed.data).toEqual(created.data)

    const conflictResponse = await app.request(projectLibraryURL(projectID, "/folders"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...request, operationID: "stale-create", name: "过期", baseRevision: 0 }),
    })
    expect(conflictResponse.status).toBe(409)
    const conflict = await json(conflictResponse)
    expect(conflict.error?.code).toBe("CINEMA_LIBRARY_REVISION_CONFLICT")
    expect(conflict.error?.data).toEqual({ latestRevision: 1 })

    const concurrent = await Promise.all(["并发 A", "并发 B"].map((name, index) =>
      app.request(projectLibraryURL(projectID, "/folders"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operationID: `concurrent-create-${index}`,
          baseRevision: 1,
          parentFolderID: "root",
          name,
        }),
      })
    ))
    expect(concurrent.map((response) => response.status).sort()).toEqual([201, 409])
    const generatedSource = join(root, "generated", "generated-frame.png")
    await mkdir(join(root, "generated"), { recursive: true })
    await writeFile(generatedSource, pngBytes())
    const registered = await registerCinemaGeneratedAsset(projectID, {
      operationID: "register-generated-frame",
      baseRevision: 2,
      sourcePath: generatedSource,
      kind: "image",
    })
    expect(registered.asset).toMatchObject({
      source: "generation",
      status: "ready",
      relativePath: "产出/图片/generated-frame.png",
    })
    expect(new Uint8Array(await readFile(
      join(root, "assets", "library", "产出", "图片", "generated-frame.png"),
    ))).toEqual(pngBytes())
    const persistedCatalog = JSON.parse(await readFile(join(root, ".anybox-cinema", "asset-library.json"), "utf8"))
    expect(CinemaAssetCatalogSchema.parse(persistedCatalog).completedOperationIDs).toContain("create-reference-folder")
  }, 20_000)

  test("streams uploads and preserves stable ids through rename, move, trash and restore", async () => {
    const { app, root, projectID } = await createCinemaProject()
    const initialState = await json<{ defaultFolderIDs: Record<string, string> }>(
      await app.request(projectLibraryURL(projectID, "/state")),
    )
    const inboxFolderID = initialState.data!.defaultFolderIDs.inbox!
    expect(inboxFolderID).toBeString()
    const createFolderResponse = await app.request(projectLibraryURL(projectID, "/folders"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "create-upload-folder",
        baseRevision: 0,
        parentFolderID: "root",
        name: "上传",
      }),
    })
    const folder = (await json<{ folder: { id: string } }>(createFolderResponse)).data!.folder

    const form = new FormData()
    form.append("file", new File([pngBytes()], "frame.png", { type: "image/png" }))
    form.append("operationID", "upload-frame")
    form.append("baseRevision", "1")
    form.append("folderID", folder.id)
    const uploadResponse = await app.request(projectLibraryURL(projectID, "/uploads"), {
      method: "POST",
      body: form,
    })
    const upload = await json<{
      revision: number
      items: Array<{ success: true; asset: { id: string; status: string; relativePath: string } }>
    }>(uploadResponse)
    expect(uploadResponse.status).toBe(201)
    expect(upload.data!.revision).toBe(2)
    const asset = upload.data!.items[0]!.asset
    expect(asset.status).toBe("ready")

    const rangeResponse = await app.request(projectLibraryURL(projectID, `/assets/${asset.id}/content`), {
      headers: { range: "bytes=0-7" },
    })
    expect(rangeResponse.status).toBe(206)
    expect(rangeResponse.headers.get("content-range")).toBe(`bytes 0-7/${pngBytes().byteLength}`)
    expect(new Uint8Array(await rangeResponse.arrayBuffer())).toEqual(pngBytes().slice(0, 8))

    const renameResponse = await app.request(projectLibraryURL(projectID, `/assets/${asset.id}`), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operationID: "rename-frame", baseRevision: 2, baseName: "主画面" }),
    })
    const renamed = await json<{ revision: number; asset: { id: string; relativePath: string } }>(renameResponse)
    expect(renamed.data!.asset.id).toBe(asset.id)
    expect(renamed.data!.asset.relativePath).toEndWith("主画面.png")

    const moveResponse = await app.request(projectLibraryURL(projectID, "/moves"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "move-frame",
        baseRevision: 3,
        entries: [{ entryType: "asset", assetID: asset.id }],
        destinationFolderID: inboxFolderID,
      }),
    })
    expect(moveResponse.status).toBe(200)

    const catalogPath = join(root, ".anybox-cinema", "asset-library.json")
    const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as {
      assets: Array<{ id: string; displayName: string }>
    }
    catalog.assets.find((item) => item.id === asset.id)!.displayName = "Fixture image 1"
    await writeFile(catalogPath, JSON.stringify(catalog, null, 2), "utf8")

    const trashResponse = await app.request(projectLibraryURL(projectID, "/trash"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "trash-frame",
        baseRevision: 4,
        entries: [{ entryType: "asset", assetID: asset.id }],
      }),
    })
    expect(trashResponse.status).toBe(200)
    expect((await app.request(projectLibraryURL(projectID, `/assets/${asset.id}/content`))).status).toBe(200)

    const restoreResponse = await app.request(projectLibraryURL(projectID, "/restore"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "restore-frame",
        baseRevision: 5,
        entries: [{ entryType: "asset", assetID: asset.id }],
      }),
    })
    expect(restoreResponse.status).toBe(200)
    const metadata = await json<{ asset: { id: string; displayName: string; status: string } }>(
      await app.request(projectLibraryURL(projectID, `/assets/${asset.id}`)),
    )
    expect(metadata.data!.asset).toMatchObject({ id: asset.id, displayName: "Fixture image 1", status: "ready" })
    expect(await readFile(join(root, "assets", "library", "素材", "主画面.png"))).toBeTruthy()

    const command = {
      id: "place-library-frame",
      type: "create-node-from-asset",
      baseRevision: 0,
      nodeID: "library-frame-node",
      assetRef: { scope: { type: "project", projectID }, assetID: asset.id },
      position: { x: 320, y: 180 },
    }
    const commandURL = `http://localhost/api/cinema/projects/${encodeURIComponent(projectID)}/commands`
    const commandResponse = await app.request(commandURL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
    })
    const commandResult = await json<{ canvas: { revision: number; nodes: Array<{ id: string; data?: Record<string, unknown> }> } }>(commandResponse)
    expect(commandResponse.status).toBe(200)
    const node = commandResult.data!.canvas.nodes.find((item) => item.id === command.nodeID)!
    expect(node.data?.assetRef).toMatchObject({ assetID: asset.id })
    expect(node.data).not.toHaveProperty("path")
    expect(commandResult.data!.canvas.revision).toBe(1)

    const replayCommand = await json<{ canvas: { nodes: Array<{ id: string }> } }>(await app.request(commandURL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
    }))
    expect(replayCommand.data!.canvas.nodes.filter((item) => item.id === command.nodeID)).toHaveLength(1)

    const staleResponse = await app.request(commandURL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...command, id: "stale-place", nodeID: "stale-node" }),
    })
    expect(staleResponse.status).toBe(409)
    expect((await json(staleResponse)).error?.code).toBe("CINEMA_CANVAS_REVISION_CONFLICT")

    const trashReferenced = await app.request(projectLibraryURL(projectID, "/trash"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "trash-referenced-frame",
        baseRevision: 6,
        entries: [{ entryType: "asset", assetID: asset.id }],
      }),
    })
    expect(trashReferenced.status).toBe(409)
    const trashReferencedError = await json(trashReferenced)
    expect(trashReferencedError.error?.code).toBe("CINEMA_LIBRARY_ASSET_REFERENCED")
    expect(trashReferencedError.error?.message).toContain("Deletion is blocked")
    expect(trashReferencedError.error?.data).toEqual({
      referencedCount: 1,
      referencedAssetIDs: [asset.id],
    })

    const unreferenced = await uploadProjectAsset({
      app,
      projectID,
      operationID: "upload-unreferenced-for-clear",
      baseRevision: 6,
      folderID: inboxFolderID,
      name: "unreferenced.png",
    })
    expect((await app.request(projectLibraryURL(projectID, "/trash"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "trash-unreferenced-for-clear",
        baseRevision: unreferenced.revision,
        entries: [{ entryType: "asset", assetID: unreferenced.asset.id }],
      }),
    })).status).toBe(200)
    const untouchedUnreferenced = await json<{ asset: { status: string } }>(
      await app.request(projectLibraryURL(projectID, `/assets/${unreferenced.asset.id}`)),
    )
    expect(untouchedUnreferenced.data?.asset.status).toBe("trashed")
    const healthyAfterRejectedTrash = await json<{ revision: number; status: string }>(
      await app.request(projectLibraryURL(projectID, "/state")),
    )
    expect(healthyAfterRejectedTrash.data).toMatchObject({ revision: 8, status: "ready" })
  }, 20_000)

  test("lists only top-level recycle-bin entries and exposes restore and permanent-delete operations", async () => {
    let clock = Date.now()
    restores.push(setCinemaAssetLibraryNowForTest(() => clock))
    const { app, projectID } = await createCinemaProject()
    const state = await json<{ defaultFolderIDs: Record<string, string> }>(
      await app.request(projectLibraryURL(projectID, "/state")),
    )
    const inboxFolderID = state.data!.defaultFolderIDs.inbox!

    const parentResponse = await app.request(projectLibraryURL(projectID, "/folders"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "create-trash-parent",
        baseRevision: 0,
        parentFolderID: "root",
        name: "Trash parent",
      }),
    })
    const parent = (await json<{ folder: { id: string } }>(parentResponse)).data!.folder
    const childResponse = await app.request(projectLibraryURL(projectID, "/folders"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "create-trash-child",
        baseRevision: 1,
        parentFolderID: parent.id,
        name: "Nested child",
      }),
    })
    const child = (await json<{ folder: { id: string } }>(childResponse)).data!.folder
    const nested = await uploadProjectAsset({
      app,
      projectID,
      operationID: "upload-nested-trash-asset",
      baseRevision: 2,
      folderID: child.id,
      name: "nested.png",
    })
    const direct = await uploadProjectAsset({
      app,
      projectID,
      operationID: "upload-direct-trash-asset",
      baseRevision: nested.revision,
      folderID: inboxFolderID,
      name: "direct.png",
    })

    const trashResponse = await app.request(projectLibraryURL(projectID, "/trash"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "trash-parent-and-direct",
        baseRevision: direct.revision,
        entries: [
          { entryType: "folder", folderID: parent.id },
          { entryType: "asset", assetID: direct.asset.id },
        ],
      }),
    })
    expect(trashResponse.status).toBe(200)

    const activePage = await json<{ nextCursor: string | null }>(
      await app.request(projectLibraryURL(projectID, "/entries?folderID=root&limit=1")),
    )
    expect(activePage.data!.nextCursor).toBeString()

    const firstPageResponse = await app.request(projectLibraryURL(projectID, "/entries?view=trash&limit=1"))
    const firstPage = await json<{
      view: string
      folder: null
      breadcrumbs: unknown[]
      total: number
      nextCursor: string | null
      entries: Array<{ entryType: string; folder?: { id: string }; asset?: { id: string } }>
    }>(firstPageResponse)
    expect(firstPageResponse.status).toBe(200)
    expect(firstPage.data).toMatchObject({ view: "trash", folder: null, breadcrumbs: [], total: 2 })
    expect(firstPage.data!.entries).toEqual([{ entryType: "folder", folder: expect.objectContaining({ id: parent.id }) }])
    expect(firstPage.data!.nextCursor).toBeString()

    const secondPage = await json<{
      entries: Array<{ entryType: string; folder?: { id: string }; asset?: { id: string } }>
      nextCursor: string | null
    }>(await app.request(projectLibraryURL(
      projectID,
      `/entries?view=trash&limit=1&cursor=${encodeURIComponent(firstPage.data!.nextCursor!)}`,
    )))
    expect(secondPage.data!.entries).toEqual([{
      entryType: "asset",
      asset: expect.objectContaining({ id: direct.asset.id }),
    }])
    expect(secondPage.data!.nextCursor).toBeNull()
    expect(secondPage.data!.entries).not.toContainEqual(expect.objectContaining({ folder: { id: child.id } }))
    expect(secondPage.data!.entries).not.toContainEqual(expect.objectContaining({ asset: { id: nested.asset.id } }))

    const crossViewCursorResponse = await app.request(projectLibraryURL(
      projectID,
      `/entries?view=trash&cursor=${encodeURIComponent(activePage.data!.nextCursor!)}`,
    ))
    expect(crossViewCursorResponse.status).toBe(400)
    expect((await json(crossViewCursorResponse)).error?.code).toBe("CINEMA_LIBRARY_CURSOR_INVALID")

    const restoreResponse = await app.request(projectLibraryURL(projectID, "/restore"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "restore-parent-and-direct",
        baseRevision: 5,
        entries: [
          { entryType: "folder", folderID: parent.id },
          { entryType: "asset", assetID: direct.asset.id },
        ],
      }),
    })
    expect(restoreResponse.status).toBe(200)
    const restored = await json<{ entries: Array<{ entryType: string; folder?: { id: string } }> }>(
      await app.request(projectLibraryURL(projectID, "/entries?folderID=root")),
    )
    expect(restored.data!.entries).toContainEqual({
      entryType: "folder",
      folder: expect.objectContaining({ id: parent.id, status: "active" }),
    })

    expect((await app.request(projectLibraryURL(projectID, "/trash"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "trash-direct-for-delete",
        baseRevision: 6,
        entries: [{ entryType: "asset", assetID: direct.asset.id }],
      }),
    })).status).toBe(200)
    expect((await app.request(projectLibraryURL(projectID, "/trash"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "trash-parent-for-clear",
        baseRevision: 7,
        entries: [{ entryType: "folder", folderID: parent.id }],
      }),
    })).status).toBe(200)
    const singleTrashPage = await json<{ total: number; entries: unknown[] }>(
      await app.request(projectLibraryURL(projectID, "/entries?view=trash&limit=1")),
    )
    expect(singleTrashPage.data).toMatchObject({ total: 2 })
    expect(singleTrashPage.data?.entries).toHaveLength(1)

    clock += 10_000
    const permanentDeleteResponse = await app.request(projectLibraryURL(projectID, "/permanent-delete"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "clear-entire-trash",
        baseRevision: 8,
        all: true,
      }),
    })
    const permanentDelete = await json<{ revision: number; deletedIDs: string[] }>(permanentDeleteResponse)
    expect(permanentDeleteResponse.status).toBe(200)
    expect(permanentDelete.data?.revision).toBe(9)
    expect(permanentDelete.data?.deletedIDs).toEqual(expect.arrayContaining([
      parent.id,
      child.id,
      nested.asset.id,
      direct.asset.id,
    ]))
    expect((await json<{ total: number }>(
      await app.request(projectLibraryURL(projectID, "/entries?view=trash")),
    )).data?.total).toBe(0)
    expect((await app.request(projectLibraryURL(projectID, `/assets/${direct.asset.id}`))).status).toBe(404)
  }, 30_000)

  test("returns a ten-second undo deadline and restores a batch if it becomes referenced before finalization", async () => {
    let clock = Date.now()
    restores.push(setCinemaAssetLibraryNowForTest(() => clock))
    const { app, root, projectID } = await createCinemaProject()
    const uploaded = await uploadProjectAsset({
      app,
      projectID,
      operationID: "upload-pending-delete",
      baseRevision: 0,
      folderID: "inbox",
      name: "pending-delete.png",
    })
    const expectedUndoUntil = new Date(clock + 10_000).toISOString()
    const trashResponse = await app.request(projectLibraryURL(projectID, "/trash"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "start-pending-delete",
        baseRevision: uploaded.revision,
        entries: [{ entryType: "asset", assetID: uploaded.asset.id }],
      }),
    })
    const trashed = await json<{ undoUntil: string }>(trashResponse)
    expect(trashResponse.status).toBe(200)
    expect(trashed.data?.undoUntil).toBe(expectedUndoUntil)
    const metadata = await json<{ asset: { trash?: { expiresAt?: string } } }>(
      await app.request(projectLibraryURL(projectID, `/assets/${uploaded.asset.id}`)),
    )
    expect(metadata.data?.asset.trash?.expiresAt).toBe(expectedUndoUntil)

    const premature = await app.request(projectLibraryURL(projectID, "/permanent-delete"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "premature-pending-delete",
        baseRevision: 2,
        entries: [{ entryType: "asset", assetID: uploaded.asset.id }],
      }),
    })
    expect(premature.status).toBe(409)
    expect((await json(premature)).error).toMatchObject({
      code: "CINEMA_LIBRARY_DELETE_UNDO_ACTIVE",
      data: { undoUntil: expectedUndoUntil },
    })

    await writeFile(
      join(root, ".anybox-cinema", "canvas.json"),
      JSON.stringify({ assetID: uploaded.asset.id }),
      "utf8",
    )
    clock += 10_000
    const finalize = await app.request(projectLibraryURL(projectID, "/permanent-delete"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "finalize-referenced-pending-delete",
        baseRevision: 2,
        entries: [{ entryType: "asset", assetID: uploaded.asset.id }],
      }),
    })
    const finalized = await json<{
      deletedIDs: string[]
      restored: Array<{ entryType: string; assetID: string }>
      referencedAssetIDs: string[]
      warnings: string[]
    }>(finalize)
    expect(finalize.status).toBe(200)
    expect(finalized.data).toMatchObject({
      deletedIDs: [],
      restored: [{ entryType: "asset", assetID: uploaded.asset.id }],
      referencedAssetIDs: [uploaded.asset.id],
    })
    expect(finalized.data?.warnings[0]).toContain("restored")
    const restored = await json<{ asset: { status: string; relativePath: string; trash?: unknown } }>(
      await app.request(projectLibraryURL(projectID, `/assets/${uploaded.asset.id}`)),
    )
    expect(restored.data?.asset).toMatchObject({ status: "ready", relativePath: "素材/pending-delete.png" })
    expect(restored.data?.asset).not.toHaveProperty("trash")
  }, 30_000)

  test("blocks a referenced descendant before atomically deleting a folder", async () => {
    const { app, root, projectID } = await createCinemaProject()
    const parentResponse = await app.request(projectLibraryURL(projectID, "/folders"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "create-reference-parent",
        baseRevision: 0,
        parentFolderID: "root",
        name: "Referenced folder",
      }),
    })
    const parent = (await json<{ folder: { id: string } }>(parentResponse)).data!.folder
    const first = await uploadProjectAsset({
      app,
      projectID,
      operationID: "upload-reference-descendant",
      baseRevision: 1,
      folderID: parent.id,
      name: "referenced.png",
    })
    const second = await uploadProjectAsset({
      app,
      projectID,
      operationID: "upload-unreferenced-descendant",
      baseRevision: first.revision,
      folderID: parent.id,
      name: "unreferenced.png",
    })
    const timelinesDirectory = join(root, ".anybox-cinema", "timelines")
    await mkdir(timelinesDirectory, { recursive: true })
    await writeFile(
      join(timelinesDirectory, "timeline_reference-test.json"),
      JSON.stringify({ assetRef: { assetID: first.asset.id } }),
      "utf8",
    )

    const response = await app.request(projectLibraryURL(projectID, "/trash"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "reject-referenced-folder-delete",
        baseRevision: second.revision,
        entries: [{ entryType: "folder", folderID: parent.id }],
      }),
    })
    expect(response.status).toBe(409)
    expect((await json(response)).error).toMatchObject({
      code: "CINEMA_LIBRARY_ASSET_REFERENCED",
      data: { referencedCount: 1, referencedAssetIDs: [first.asset.id] },
    })
    const state = await json<{ revision: number; counts: { trashed: number } }>(
      await app.request(projectLibraryURL(projectID, "/state")),
    )
    expect(state.data).toMatchObject({ revision: second.revision, counts: { trashed: 0 } })
    expect((await app.request(projectLibraryURL(projectID, `/assets/${first.asset.id}/content`))).status).toBe(200)
    expect((await app.request(projectLibraryURL(projectID, `/assets/${second.asset.id}/content`))).status).toBe(200)
  }, 30_000)

  test("finalizes expired deletes on initialization and restores expired batches that gained references", async () => {
    let clock = Date.now()
    restores.push(setCinemaAssetLibraryNowForTest(() => clock))
    const { app, root, projectID } = await createCinemaProject()
    const deleted = await uploadProjectAsset({
      app,
      projectID,
      operationID: "upload-expired-delete",
      baseRevision: 0,
      folderID: "inbox",
      name: "expired-delete.png",
    })
    const restored = await uploadProjectAsset({
      app,
      projectID,
      operationID: "upload-expired-restore",
      baseRevision: deleted.revision,
      folderID: "inbox",
      name: "expired-restore.png",
    })
    expect((await app.request(projectLibraryURL(projectID, "/trash"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "trash-expired-delete",
        baseRevision: restored.revision,
        entries: [{ entryType: "asset", assetID: deleted.asset.id }],
      }),
    })).status).toBe(200)
    expect((await app.request(projectLibraryURL(projectID, "/trash"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "trash-expired-restore",
        baseRevision: 3,
        entries: [{ entryType: "asset", assetID: restored.asset.id }],
      }),
    })).status).toBe(200)
    await writeFile(
      join(root, ".anybox-cinema", "canvas.json"),
      JSON.stringify({ assetID: restored.asset.id }),
      "utf8",
    )

    resetCinemaAssetLibraryInitializationForTest({ type: "project", projectID })
    const withinGrace = await json<{ revision: number; counts: { trashed: number } }>(
      await app.request(projectLibraryURL(projectID, "/state")),
    )
    expect(withinGrace.data).toMatchObject({ revision: 4, counts: { trashed: 2 } })
    clock += 10_000
    const state = await json<{ revision: number; counts: { trashed: number } }>(
      await app.request(projectLibraryURL(projectID, "/state")),
    )
    expect(state.data).toMatchObject({ revision: 5, counts: { trashed: 0 } })
    expect((await app.request(projectLibraryURL(projectID, `/assets/${deleted.asset.id}`))).status).toBe(404)
    const restoredMetadata = await json<{ asset: { status: string; trash?: unknown } }>(
      await app.request(projectLibraryURL(projectID, `/assets/${restored.asset.id}`)),
    )
    expect(restoredMetadata.data?.asset.status).toBe("ready")
    expect(restoredMetadata.data?.asset).not.toHaveProperty("trash")
  }, 30_000)

  test("invalidates the initialized maintenance cache when a pending delete is created", async () => {
    let clock = Date.now()
    restores.push(setCinemaAssetLibraryNowForTest(() => clock))
    const { app, projectID } = await createCinemaProject()
    const scope = { type: "project" as const, projectID }

    const initial = await initializeCinemaAssetLibrary(scope)
    expect(initial.catalog.revision).toBe(0)

    const uploaded = await uploadProjectAsset({
      app,
      projectID,
      operationID: "upload-after-initialization-cache",
      baseRevision: initial.catalog.revision,
      folderID: "inbox",
      name: "cache-invalidation.png",
    })
    const trashResponse = await app.request(projectLibraryURL(projectID, "/trash"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "trash-after-initialization-cache",
        baseRevision: uploaded.revision,
        entries: [{ entryType: "asset", assetID: uploaded.asset.id }],
      }),
    })
    expect(trashResponse.status).toBe(200)

    clock += 10_000
    const maintained = await initializeCinemaAssetLibrary(scope)
    expect(maintained.catalog.revision).toBe(3)
    expect(maintained.catalog.assets.some((asset) => asset.id === uploaded.asset.id)).toBe(false)
    expect((await app.request(projectLibraryURL(projectID, `/assets/${uploaded.asset.id}`))).status).toBe(404)
  }, 30_000)

  test("restores legacy recycle-bin records on initialization with collision-safe naming", async () => {
    const { app, root, projectID } = await createCinemaProject()
    const uploaded = await uploadProjectAsset({
      app,
      projectID,
      operationID: "upload-legacy-trash",
      baseRevision: 0,
      folderID: "inbox",
      name: "legacy.png",
    })
    expect((await app.request(projectLibraryURL(projectID, "/trash"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "trash-legacy-record",
        baseRevision: uploaded.revision,
        entries: [{ entryType: "asset", assetID: uploaded.asset.id }],
      }),
    })).status).toBe(200)

    const catalogPath = join(root, ".anybox-cinema", "asset-library.json")
    const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as {
      assets: Array<{ id: string; trash?: { expiresAt?: string } }>
    }
    delete catalog.assets.find((asset) => asset.id === uploaded.asset.id)!.trash!.expiresAt
    await writeFile(catalogPath, JSON.stringify(catalog, null, 2), "utf8")
    await writeFile(join(root, "assets", "library", "素材", "legacy.png"), "collision", "utf8")

    resetCinemaAssetLibraryInitializationForTest({ type: "project", projectID })
    const state = await json<{ revision: number; counts: { trashed: number } }>(
      await app.request(projectLibraryURL(projectID, "/state")),
    )
    expect(state.data).toMatchObject({ revision: 3, counts: { trashed: 0 } })
    const restoredMetadata = await json<{ asset: { status: string; relativePath: string; trash?: unknown } }>(
      await app.request(projectLibraryURL(projectID, `/assets/${uploaded.asset.id}`)),
    )
    expect(restoredMetadata.data?.asset).toMatchObject({ status: "ready", relativePath: "素材/legacy (2).png" })
    expect(restoredMetadata.data?.asset).not.toHaveProperty("trash")
    expect(await readFile(join(root, "assets", "library", "素材", "legacy.png"), "utf8")).toBe("collision")
  }, 30_000)

  test("restores failed and missing assets to their pre-trash status", async () => {
    const { app, root, projectID } = await createCinemaProject()
    const folderResponse = await app.request(projectLibraryURL(projectID, "/folders"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "create-status-restore-folder",
        baseRevision: 0,
        parentFolderID: "root",
        name: "Status restore",
      }),
    })
    const folder = (await json<{ folder: { id: string } }>(folderResponse)).data!.folder
    const failedUpload = await uploadProjectAsset({
      app,
      projectID,
      operationID: "upload-eventually-failed",
      baseRevision: 1,
      folderID: folder.id,
      name: "failed.png",
    })
    const missingUpload = await uploadProjectAsset({
      app,
      projectID,
      operationID: "upload-eventually-missing",
      baseRevision: failedUpload.revision,
      folderID: folder.id,
      name: "missing.png",
    })

    const catalogPath = join(root, ".anybox-cinema", "asset-library.json")
    const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as {
      assets: Array<{ id: string; status: string; relativePath: string; failureReason?: string }>
    }
    const failedRecord = catalog.assets.find((asset) => asset.id === failedUpload.asset.id)!
    const missingRecord = catalog.assets.find((asset) => asset.id === missingUpload.asset.id)!
    failedRecord.status = "processing"
    await writeFile(catalogPath, JSON.stringify(catalog, null, 2), "utf8")

    const processingTrashResponse = await app.request(projectLibraryURL(projectID, "/trash"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "reject-processing-trash",
        baseRevision: 3,
        entries: [{ entryType: "folder", folderID: folder.id }],
      }),
    })
    expect(processingTrashResponse.status).toBe(409)
    expect((await json(processingTrashResponse)).error?.code).toBe("CINEMA_LIBRARY_ASSET_PROCESSING")

    failedRecord.status = "failed"
    failedRecord.failureReason = "Synthetic processing failure for restore coverage."
    missingRecord.status = "missing"
    await writeFile(catalogPath, JSON.stringify(catalog, null, 2), "utf8")
    await rm(join(root, "assets", "library", ...missingRecord.relativePath.split("/")), { force: true })

    const trashResponse = await app.request(projectLibraryURL(projectID, "/trash"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "trash-failed-and-missing",
        baseRevision: 3,
        entries: [{ entryType: "folder", folderID: folder.id }],
      }),
    })
    expect(trashResponse.status).toBe(200)
    const trashedFailed = await json<{ asset: { status: string; trash?: { previousStatus?: string } } }>(
      await app.request(projectLibraryURL(projectID, `/assets/${failedRecord.id}`)),
    )
    const trashedMissing = await json<{ asset: { status: string; trash?: { previousStatus?: string } } }>(
      await app.request(projectLibraryURL(projectID, `/assets/${missingRecord.id}`)),
    )
    expect(trashedFailed.data?.asset).toMatchObject({ status: "trashed", trash: { previousStatus: "failed" } })
    expect(trashedMissing.data?.asset).toMatchObject({ status: "trashed", trash: { previousStatus: "missing" } })

    const restoreResponse = await app.request(projectLibraryURL(projectID, "/restore"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "restore-failed-and-missing",
        baseRevision: 4,
        entries: [{ entryType: "folder", folderID: folder.id }],
      }),
    })
    expect(restoreResponse.status).toBe(200)
    const restoredFailed = await json<{ asset: { status: string; trash?: unknown } }>(
      await app.request(projectLibraryURL(projectID, `/assets/${failedRecord.id}`)),
    )
    const restoredMissing = await json<{ asset: { status: string; trash?: unknown } }>(
      await app.request(projectLibraryURL(projectID, `/assets/${missingRecord.id}`)),
    )
    expect(restoredFailed.data?.asset).toMatchObject({ status: "failed" })
    expect(restoredFailed.data?.asset).not.toHaveProperty("trash")
    expect(restoredMissing.data?.asset).toMatchObject({ status: "missing" })
    expect(restoredMissing.data?.asset).not.toHaveProperty("trash")
  }, 30_000)

  test("rolls purged files back when the catalog commit fails", async () => {
    let clock = Date.now()
    restores.push(setCinemaAssetLibraryNowForTest(() => clock))
    const { app, root, projectID } = await createCinemaProject()
    const state = await json<{ defaultFolderIDs: Record<string, string> }>(
      await app.request(projectLibraryURL(projectID, "/state")),
    )
    const upload = await uploadProjectAsset({
      app,
      projectID,
      operationID: "upload-purge-rollback",
      baseRevision: 0,
      folderID: state.data!.defaultFolderIDs.inbox!,
      name: "purge-rollback.png",
    })
    expect((await app.request(projectLibraryURL(projectID, "/trash"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "trash-before-purge-rollback",
        baseRevision: upload.revision,
        entries: [{ entryType: "asset", assetID: upload.asset.id }],
      }),
    })).status).toBe(200)
    const trashed = await json<{ asset: { relativePath: string; status: string } }>(
      await app.request(projectLibraryURL(projectID, `/assets/${upload.asset.id}`)),
    )
    const trashedPath = join(root, "assets", "library", ...trashed.data!.asset.relativePath.split("/"))
    expect(new Uint8Array(await readFile(trashedPath))).toEqual(pngBytes())

    clock += 10_000
    restores.push(setCinemaAssetLibraryCatalogWriteFailureForTest())
    const deleteResponse = await app.request(projectLibraryURL(projectID, "/permanent-delete"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "purge-with-failed-catalog-commit",
        baseRevision: 2,
        entries: [{ entryType: "asset", assetID: upload.asset.id }],
      }),
    })
    expect(deleteResponse.status).toBe(500)

    const afterFailure = JSON.parse(
      await readFile(join(root, ".anybox-cinema", "asset-library.json"), "utf8"),
    ) as { revision: number; assets: Array<{ id: string; status: string; relativePath: string }> }
    expect({
      revision: afterFailure.revision,
      asset: afterFailure.assets.find((asset) => asset.id === upload.asset.id),
    }).toMatchObject({
      revision: 2,
      asset: { status: "trashed", relativePath: trashed.data!.asset.relativePath },
    })
    expect(new Uint8Array(await readFile(trashedPath))).toEqual(pngBytes())
    const stateAfterFailure = await json<{ revision: number; status: string }>(
      await app.request(projectLibraryURL(projectID, "/state")),
    )
    expect(stateAfterFailure.data).toMatchObject({ revision: 3, status: "ready" })
    expect((await app.request(projectLibraryURL(projectID, `/assets/${upload.asset.id}`))).status).toBe(404)
  }, 30_000)

  test("rejects junctions before move or trash filesystem operations", async () => {
    const { app, root, projectID } = await createCinemaProject()
    const createResponse = await app.request(projectLibraryURL(projectID, "/folders"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "create-junction-victim",
        baseRevision: 0,
        parentFolderID: "root",
        name: "Junction victim",
      }),
    })
    const folder = (await json<{ folder: { id: string } }>(createResponse)).data!.folder
    const external = await realpath(await mkdtemp(join(tmpdir(), "anybox-junction-target-")))
    cleanup.push(external)
    await writeFile(join(external, "must-survive.txt"), "outside", "utf8")
    const folderPath = join(root, "assets", "library", "Junction victim")
    await rm(folderPath, { recursive: true, force: true })
    await symlink(external, folderPath, process.platform === "win32" ? "junction" : "dir")

    const trashResponse = await app.request(projectLibraryURL(projectID, "/trash"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "reject-junction-trash",
        baseRevision: 1,
        entries: [{ entryType: "folder", folderID: folder.id }],
      }),
    })
    expect(trashResponse.status).toBe(400)
    expect((await json(trashResponse)).error?.code).toBe("CINEMA_LIBRARY_SYMLINK_REJECTED")

    const moveResponse = await app.request(projectLibraryURL(projectID, "/moves"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "reject-junction-move",
        baseRevision: 1,
        destinationFolderID: "inbox",
        entries: [{ entryType: "folder", folderID: folder.id }],
      }),
    })
    expect(moveResponse.status).toBe(400)
    expect((await json(moveResponse)).error?.code).toBe("CINEMA_LIBRARY_SYMLINK_REJECTED")
    expect(await readFile(join(external, "must-survive.txt"), "utf8")).toBe("outside")
    const stateAfterRejection = await json<{ revision: number }>(
      await app.request(projectLibraryURL(projectID, "/state")),
    )
    expect(stateAfterRejection.data?.revision).toBe(1)
  }, 30_000)

  test("initializes an isolated personal library", async () => {
    const app = createServerApp()
    const personalRoot = await mkdtemp(join(tmpdir(), "anybox-personal-library-"))
    cleanup.push(personalRoot)
    restores.push(setCinemaAssetLibraryPersonalRootForTest(personalRoot))
    const response = await app.request("http://localhost/api/cinema/personal-library/state")
    const state = await json<{
      scope: { type: string }
      counts: { folders: number }
      defaultFolderIDs: Record<string, string>
    }>(response)
    expect(response.status).toBe(200)
    expect(state.data).toMatchObject({
      scope: { type: "personal" },
      counts: { folders: 1 },
      defaultFolderIDs: { inbox: "inbox" },
    })
    expect(await readFile(join(personalRoot, "catalog.json"), "utf8")).toContain('"type": "personal"')
  }, 20_000)

  test("rejects a managed staging directory replaced by a junction", async () => {
    const app = createServerApp()
    const personalRoot = await realpath(await mkdtemp(join(tmpdir(), "anybox-personal-library-junction-")))
    const external = await realpath(await mkdtemp(join(tmpdir(), "anybox-personal-staging-target-")))
    cleanup.push(personalRoot, external)
    restores.push(setCinemaAssetLibraryPersonalRootForTest(personalRoot))
    expect((await app.request("http://localhost/api/cinema/personal-library/state")).status).toBe(200)

    await writeFile(join(external, "must-survive.txt"), "outside", "utf8")
    const stagingPath = join(personalRoot, "files", ".staging")
    await rm(stagingPath, { recursive: true, force: true })
    await symlink(external, stagingPath, process.platform === "win32" ? "junction" : "dir")

    const response = await app.request("http://localhost/api/cinema/personal-library/state")
    expect(response.status).toBe(400)
    expect((await json(response)).error?.code).toBe("CINEMA_LIBRARY_SYMLINK_REJECTED")
    expect(await readFile(join(external, "must-survive.txt"), "utf8")).toBe("outside")
  }, 20_000)

  test("relinks a node to a same-kind personal asset and keeps the reference index consistent", async () => {
    const personalRoot = await realpath(await mkdtemp(join(tmpdir(), "anybox-personal-relink-")))
    cleanup.push(personalRoot)
    restores.push(setCinemaAssetLibraryPersonalRootForTest(personalRoot))
    const { app, projectID } = await createCinemaProject()

    const initialState = await json<{ revision: number; defaultFolderIDs: Record<string, string> }>(
      await app.request(personalLibraryURL("/state")),
    )
    const inboxFolderID = initialState.data!.defaultFolderIDs.inbox!
    const originalImage = await uploadPersonalAsset({
      app,
      operationID: "upload-personal-original",
      baseRevision: initialState.data!.revision,
      folderID: inboxFolderID,
      name: "original.png",
      mimeType: "image/png",
      bytes: pngBytes(),
    })
    const replacementImage = await uploadPersonalAsset({
      app,
      operationID: "upload-personal-replacement",
      baseRevision: originalImage.revision,
      folderID: inboxFolderID,
      name: "replacement.png",
      mimeType: "image/png",
      bytes: pngBytes(),
    })
    const audio = await uploadPersonalAsset({
      app,
      operationID: "upload-personal-audio",
      baseRevision: replacementImage.revision,
      folderID: inboxFolderID,
      name: "silence.wav",
      mimeType: "audio/wav",
      bytes: wavBytes(),
    })

    let audioStatus = audio.asset.status
    for (let attempt = 0; attempt < 80 && audioStatus === "processing"; attempt += 1) {
      await Bun.sleep(50)
      const current = await json<{ asset: { status: string } }>(
        await app.request(personalLibraryURL(`/assets/${audio.asset.id}`)),
      )
      audioStatus = current.data!.asset.status
    }
    expect(originalImage.asset).toMatchObject({ kind: "image", status: "ready" })
    expect(replacementImage.asset).toMatchObject({ kind: "image", status: "ready" })
    expect(audioStatus).toBe("ready")

    const commandURL = `http://localhost/api/cinema/projects/${encodeURIComponent(projectID)}/commands`
    const nodeID = "personal-relink-node"
    const createResponse = await app.request(commandURL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "create-personal-relink-node",
        type: "create-node-from-asset",
        baseRevision: 0,
        nodeID,
        assetRef: { scope: { type: "personal" }, assetID: originalImage.asset.id },
        position: { x: 100, y: 120 },
      }),
    })
    const created = await json<{ canvas: { revision: number } }>(createResponse)
    expect(createResponse.status).toBe(200)
    expect(created.data!.canvas.revision).toBe(1)

    const relinkResponse = await app.request(commandURL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "relink-personal-image",
        type: "relink-node-asset",
        baseRevision: 1,
        nodeID,
        assetRef: { scope: { type: "personal" }, assetID: replacementImage.asset.id },
      }),
    })
    const relinked = await json<{
      canvas: { revision: number; nodes: Array<{ id: string; type: string; data?: Record<string, unknown> }> }
    }>(relinkResponse)
    expect(relinkResponse.status).toBe(200)
    expect(relinked.data!.canvas.revision).toBe(2)
    const relinkedNode = relinked.data!.canvas.nodes.find((node) => node.id === nodeID)!
    expect(relinkedNode.type).toBe("image")
    expect(relinkedNode.data?.assetRef).toMatchObject({
      scope: { type: "personal" },
      assetID: replacementImage.asset.id,
      snapshot: { kind: "image" },
    })

    const dependencies = await json<Array<{ assetID: string; nodeIDs: string[] }>>(
      await app.request(projectLibraryURL(projectID, "/personal-dependencies")),
    )
    expect(dependencies.data).toEqual([{ assetID: replacementImage.asset.id, nodeIDs: [nodeID] }])
    const referenceIndex = JSON.parse(await readFile(join(personalRoot, "references.json"), "utf8")) as {
      assets: Record<string, Array<{ projectID: string; nodeID: string }>>
    }
    expect(referenceIndex.assets[originalImage.asset.id]).toBeUndefined()
    expect(referenceIndex.assets[replacementImage.asset.id]).toEqual([
      expect.objectContaining({ projectID, nodeID }),
    ])

    const mismatchResponse = await app.request(commandURL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "relink-personal-kind-mismatch",
        type: "relink-node-asset",
        baseRevision: 2,
        nodeID,
        assetRef: { scope: { type: "personal" }, assetID: audio.asset.id },
      }),
    })
    expect(mismatchResponse.status).toBe(409)
    expect((await json(mismatchResponse)).error?.code).toBe("CINEMA_ASSET_KIND_MISMATCH")

    const canvas = await json<{
      revision: number
      nodes: Array<{ id: string; data?: { assetRef?: { assetID?: string } } }>
    }>(await app.request(`http://localhost/api/cinema/projects/${encodeURIComponent(projectID)}/canvas`))
    expect(canvas.data!.revision).toBe(2)
    expect(canvas.data!.nodes.find((node) => node.id === nodeID)?.data?.assetRef?.assetID)
      .toBe(replacementImage.asset.id)
    const dependenciesAfterMismatch = await json<Array<{ assetID: string; nodeIDs: string[] }>>(
      await app.request(projectLibraryURL(projectID, "/personal-dependencies")),
    )
    expect(dependenciesAfterMismatch.data).toEqual([
      { assetID: replacementImage.asset.id, nodeIDs: [nodeID] },
    ])

    const personalState = await json<{ revision: number }>(await app.request(personalLibraryURL("/state")))
    const deleteReferencedPersonalAsset = await app.request(personalLibraryURL("/trash"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "reject-referenced-personal-delete",
        baseRevision: personalState.data!.revision,
        entries: [{ entryType: "asset", assetID: replacementImage.asset.id }],
      }),
    })
    expect(deleteReferencedPersonalAsset.status).toBe(409)
    expect((await json(deleteReferencedPersonalAsset)).error).toMatchObject({
      code: "CINEMA_LIBRARY_ASSET_REFERENCED",
      data: { referencedCount: 1, referencedAssetIDs: [replacementImage.asset.id] },
    })
  }, 20_000)

  test("keeps crop derivatives in their source folder and processes media in the background", async () => {
    const { app, projectID } = await createCinemaProject()
    const state = await json<{ revision: number; defaultFolderIDs: Record<string, string> }>(
      await app.request(projectLibraryURL(projectID, "/state")),
    )
    const cropForm = new FormData()
    cropForm.append("operationID", "upload-crop-derivative")
    cropForm.append("baseRevision", String(state.data!.revision))
    cropForm.append("folderID", "generated-images")
    cropForm.append("source", "crop")
    cropForm.append("file", new File([pngBytes()], "crop.png", { type: "image/png" }))
    const cropResponse = await app.request(projectLibraryURL(projectID, "/uploads"), {
      method: "POST",
      body: cropForm,
    })
    const crop = await json<{
      revision: number
      items: Array<{ success: true; asset: { folderID: string; source: string; status: string } }>
    }>(cropResponse)
    expect(cropResponse.status).toBe(201)
    expect(crop.data!.items[0]!.asset).toMatchObject({
      folderID: "generated-images",
      source: "crop",
      status: "ready",
    })

    const form = new FormData()
    form.append("operationID", "upload-background-audio")
    form.append("baseRevision", String(crop.data!.revision))
    form.append("folderID", state.data!.defaultFolderIDs.inbox!)
    form.append("file", new File([wavBytes()], "silence.wav", { type: "audio/wav" }))
    const uploadResponse = await app.request(projectLibraryURL(projectID, "/uploads"), {
      method: "POST",
      body: form,
    })
    const upload = await json<{
      items: Array<{ success: true; asset: { id: string; status: string } }>
    }>(uploadResponse)
    expect(uploadResponse.status).toBe(201)
    expect(upload.data!.items[0]!.asset.status).toBe("processing")

    const assetID = upload.data!.items[0]!.asset.id
    let status = "processing"
    let durationSeconds: number | undefined
    for (let attempt = 0; attempt < 80 && status === "processing"; attempt += 1) {
      await Bun.sleep(50)
      const current = await json<{ asset: { status: string; durationSeconds?: number } }>(
        await app.request(projectLibraryURL(projectID, `/assets/${assetID}`)),
      )
      status = current.data!.asset.status
      durationSeconds = current.data!.asset.durationSeconds
    }
    expect(status).toBe("ready")
    expect(durationSeconds).toBeGreaterThan(0)

    const previousFlag = process.env.ANYBOX_CINEMA_ASSET_LIBRARY
    restores.push(() => {
      if (previousFlag === undefined) delete process.env.ANYBOX_CINEMA_ASSET_LIBRARY
      else process.env.ANYBOX_CINEMA_ASSET_LIBRARY = previousFlag
    })
    process.env.ANYBOX_CINEMA_ASSET_LIBRARY = "false"
    expect((await app.request(projectLibraryURL(projectID, "/state"))).status).toBe(404)
    expect((await app.request(projectLibraryURL(projectID, `/assets/${assetID}`))).status).toBe(200)
    expect((await app.request(projectLibraryURL(projectID, `/assets/${assetID}/content`))).status).toBe(200)
  }, 20_000)
})
