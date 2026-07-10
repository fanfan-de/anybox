import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  getCinemaAssetLibraryState,
  reconcileCinemaAssetLibrary,
  setCinemaAssetLibraryPersonalRootForTest,
} from "#cinema/asset-library.ts"

type CatalogAsset = {
  id: string
  relativePath: string
  source: string
  status: string
  checksum: string
  fileIdentity?: string
}

type Catalog = {
  revision: number
  assets: CatalogAsset[]
}

const scope = { type: "personal" } as const
const cleanup: string[] = []
const restores: Array<() => void> = []

afterEach(async () => {
  while (restores.length) restores.pop()?.()
  while (cleanup.length) await rm(cleanup.pop()!, { recursive: true, force: true })
})

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

async function setupPersonalLibrary() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "anybox-library-reconcile-")))
  cleanup.push(root)
  restores.push(setCinemaAssetLibraryPersonalRootForTest(root))
  await getCinemaAssetLibraryState(scope)
  return {
    root,
    filesRoot: join(root, "files"),
    catalogPath: join(root, "catalog.json"),
  }
}

async function readCatalog(catalogPath: string) {
  return JSON.parse(await readFile(catalogPath, "utf8")) as Catalog
}

async function waitUntilProcessed(catalogPath: string, expectedReady: number) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const catalog = await readCatalog(catalogPath)
    if (catalog.assets.filter((asset) => asset.status === "ready").length >= expectedReady) return catalog
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Timed out waiting for ${expectedReady} discovered assets to finish processing.`)
}

describe("cinema asset library external reconciliation", () => {
  test("discovers media, preserves its id across an external move, and reprocesses a restored path", async () => {
    const { root, filesRoot, catalogPath } = await setupPersonalLibrary()
    const incoming = join(filesRoot, "External")
    await mkdir(incoming)
    await writeFile(join(incoming, "frame.png"), pngBytes())

    const discovered = await reconcileCinemaAssetLibrary(scope, {
      operationID: "discover-external-frame",
      baseRevision: 0,
      full: true,
    })
    expect(discovered.discovered).toBe(1)
    let catalog = await waitUntilProcessed(catalogPath, 1)
    const assetID = catalog.assets[0]!.id
    expect(catalog.assets[0]).toMatchObject({
      source: "discovered",
      relativePath: "External/frame.png",
      status: "ready",
    })
    expect(catalog.assets[0]!.fileIdentity).toBeString()

    const movedFolder = join(filesRoot, "Moved")
    await mkdir(movedFolder)
    await rename(join(incoming, "frame.png"), join(movedFolder, "renamed.png"))
    const beforeMove = await getCinemaAssetLibraryState(scope)
    const moved = await reconcileCinemaAssetLibrary(scope, {
      operationID: "reconcile-external-move",
      baseRevision: beforeMove.revision,
      full: true,
    })
    expect(moved).toMatchObject({ discovered: 0, moved: 1, missing: 0 })
    catalog = await waitUntilProcessed(catalogPath, 1)
    expect(catalog.assets).toHaveLength(1)
    expect(catalog.assets[0]).toMatchObject({ id: assetID, relativePath: "Moved/renamed.png", status: "ready" })

    const parked = join(root, "parked.png")
    await rename(join(movedFolder, "renamed.png"), parked)
    const beforeMissing = await getCinemaAssetLibraryState(scope)
    const missing = await reconcileCinemaAssetLibrary(scope, {
      operationID: "mark-external-missing",
      baseRevision: beforeMissing.revision,
      full: true,
    })
    expect(missing.missing).toBe(1)
    expect((await readCatalog(catalogPath)).assets[0]).toMatchObject({ id: assetID, status: "missing" })

    await rename(parked, join(movedFolder, "renamed.png"))
    const beforeRestore = await getCinemaAssetLibraryState(scope)
    const restored = await reconcileCinemaAssetLibrary(scope, {
      operationID: "restore-external-path",
      baseRevision: beforeRestore.revision,
      full: true,
    })
    expect(restored.discovered).toBe(0)
    catalog = await waitUntilProcessed(catalogPath, 1)
    expect(catalog.assets[0]).toMatchObject({ id: assetID, relativePath: "Moved/renamed.png", status: "ready" })
  }, 20_000)

  test("does not silently relink duplicate checksum groups", async () => {
    const { filesRoot, catalogPath } = await setupPersonalLibrary()
    const originals = join(filesRoot, "Originals")
    await mkdir(originals)
    await writeFile(join(originals, "one.png"), pngBytes())
    await writeFile(join(originals, "two.png"), pngBytes())
    await reconcileCinemaAssetLibrary(scope, {
      operationID: "discover-duplicates",
      baseRevision: 0,
      full: true,
    })
    let catalog = await waitUntilProcessed(catalogPath, 2)
    const originalIDs = new Set(catalog.assets.map((asset) => asset.id))

    // Simulate an older catalog, created before filesystem identities were
    // persisted. With two identical old records and two identical moved files,
    // checksum matching is intentionally ambiguous.
    for (const asset of catalog.assets) delete asset.fileIdentity
    await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8")
    const relocated = join(filesRoot, "Relocated")
    await mkdir(relocated)
    await rename(join(originals, "one.png"), join(relocated, "alpha.png"))
    await rename(join(originals, "two.png"), join(relocated, "beta.png"))

    const state = await getCinemaAssetLibraryState(scope)
    const result = await reconcileCinemaAssetLibrary(scope, {
      operationID: "ambiguous-checksum-move",
      baseRevision: state.revision,
      full: true,
    })
    expect(result).toMatchObject({ discovered: 2, moved: 0, missing: 2 })
    expect(result.warnings.some((warning) => warning.includes("ambiguous external move"))).toBe(true)
    catalog = await waitUntilProcessed(catalogPath, 2)
    expect(catalog.assets).toHaveLength(4)
    expect(catalog.assets.filter((asset) => originalIDs.has(asset.id)).every((asset) => asset.status === "missing")).toBe(true)
    expect(catalog.assets.filter((asset) => !originalIDs.has(asset.id)).map((asset) => asset.relativePath).sort()).toEqual([
      "Relocated/alpha.png",
      "Relocated/beta.png",
    ])
  }, 20_000)

  test("does not reuse an asset id when an external replacement changes media kind", async () => {
    const { filesRoot, catalogPath } = await setupPersonalLibrary()
    const external = join(filesRoot, "External")
    await mkdir(external)
    const imagePath = join(external, "replace.png")
    const audioPath = join(external, "replace.wav")
    await writeFile(imagePath, pngBytes())
    await reconcileCinemaAssetLibrary(scope, {
      operationID: "discover-kind-replacement-source",
      baseRevision: 0,
      full: true,
    })
    let catalog = await waitUntilProcessed(catalogPath, 1)
    const imageAssetID = catalog.assets[0]!.id

    // rename preserves filesystem identity on ordinary local filesystems;
    // rewriting the file then simulates an external app changing media kind.
    await rename(imagePath, audioPath)
    await writeFile(audioPath, wavBytes())
    const state = await getCinemaAssetLibraryState(scope)
    const result = await reconcileCinemaAssetLibrary(scope, {
      operationID: "reconcile-kind-replacement",
      baseRevision: state.revision,
      full: true,
    })
    expect(result).toMatchObject({ discovered: 1, moved: 0, missing: 1 })
    catalog = await waitUntilProcessed(catalogPath, 1)
    expect(catalog.assets).toHaveLength(2)
    expect(catalog.assets.find((asset) => asset.id === imageAssetID)).toMatchObject({
      status: "missing",
      relativePath: "External/replace.png",
    })
    expect(catalog.assets.find((asset) => asset.id !== imageAssetID)).toMatchObject({
      source: "discovered",
      relativePath: "External/replace.wav",
    })
  }, 20_000)

  test("rejects a symlink or junction without committing a partial scan", async () => {
    const { root, filesRoot, catalogPath } = await setupPersonalLibrary()
    const target = join(root, "outside")
    await mkdir(target)
    await writeFile(join(target, "outside.png"), pngBytes())
    try {
      await symlink(target, join(filesRoot, "linked"), process.platform === "win32" ? "junction" : "dir")
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && (error.code === "EPERM" || error.code === "EACCES")) return
      throw error
    }

    await expect(reconcileCinemaAssetLibrary(scope, {
      operationID: "reject-external-junction",
      baseRevision: 0,
      full: true,
    })).rejects.toMatchObject({ code: "CINEMA_LIBRARY_SYMLINK_REJECTED" })
    expect((await readCatalog(catalogPath)).revision).toBe(0)
  })
})
