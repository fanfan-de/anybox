import { describe, expect, it } from "vitest"
import {
  CINEMA_ASSET_LIBRARY_DRAG_TYPE,
  CINEMA_ASSET_LIBRARY_ENTRY_DRAG_TYPE,
  applyAssetLibrarySelection,
  assetLibraryEntryPath,
  assetLibraryGridRowCount,
  assetLibraryScrollPositionKey,
  assetRenameParts,
  formatAssetLibraryDuration,
  formatAssetLibrarySize,
  parseAssetLibraryDragPayload,
  parseAssetLibraryEntryDragPayload,
  serializeAssetLibraryDragPayload,
  serializeAssetLibraryEntryDragPayload,
  shouldVirtualizeAssetLibraryGrid,
  summarizeAssetLibrarySelection,
} from "./assetLibraryModel"

describe("assetLibraryModel", () => {
  it("uses the stable canvas drag MIME type", () => {
    expect(CINEMA_ASSET_LIBRARY_DRAG_TYPE).toBe("application/x-anybox-cinema-asset")
    expect(CINEMA_ASSET_LIBRARY_ENTRY_DRAG_TYPE).toBe("application/x-anybox-cinema-library-entries")
  })

  it("validates and deduplicates internal same-library drag targets", () => {
    const serialized = serializeAssetLibraryEntryDragPayload({
      version: 1,
      scope: { type: "personal" },
      entries: [
        { entryType: "folder", folderID: "folder-1" },
        { entryType: "asset", assetID: "asset-1" },
        { entryType: "asset", assetID: "asset-1" },
      ],
    })
    expect(parseAssetLibraryEntryDragPayload(serialized)).toEqual({
      version: 1,
      scope: { type: "personal" },
      entries: [
        { entryType: "folder", folderID: "folder-1" },
        { entryType: "asset", assetID: "asset-1" },
      ],
    })
    expect(parseAssetLibraryEntryDragPayload(JSON.stringify({
      version: 1,
      scope: { type: "project", projectID: "project-1" },
      entries: [{ entryType: "folder" }],
    }))).toBeNull()
  })

  it("serializes and validates project and personal drag payloads", () => {
    const serialized = serializeAssetLibraryDragPayload({
      version: 1,
      scope: { type: "project", projectID: "project-1" },
      assetID: "asset-1",
    })
    expect(parseAssetLibraryDragPayload(serialized)).toEqual({
      version: 1,
      scope: { type: "project", projectID: "project-1" },
      assetID: "asset-1",
    })
    expect(parseAssetLibraryDragPayload(JSON.stringify({
      version: 1,
      scope: { type: "personal" },
      assetID: "asset-2",
    }))).toEqual({
      version: 1,
      scope: { type: "personal" },
      assetID: "asset-2",
    })
    expect(parseAssetLibraryDragPayload("not-json")).toBeNull()
    expect(parseAssetLibraryDragPayload(JSON.stringify({ version: 1, scope: { type: "project" }, assetID: "a" }))).toBeNull()
  })

  it("supports single, toggle, and anchored range selection", () => {
    const keys = ["asset:1", "asset:2", "asset:3", "asset:4"]
    const first = applyAssetLibrarySelection(new Set(), keys, "asset:2", null, { toggle: false, range: false })
    expect([...first.selectedKeys]).toEqual(["asset:2"])

    const toggled = applyAssetLibrarySelection(first.selectedKeys, keys, "asset:4", first.anchorKey, { toggle: true, range: false })
    expect([...toggled.selectedKeys]).toEqual(["asset:2", "asset:4"])

    const ranged = applyAssetLibrarySelection(toggled.selectedKeys, keys, "asset:2", toggled.anchorKey, { toggle: false, range: true })
    expect([...ranged.selectedKeys]).toEqual(["asset:2", "asset:3", "asset:4"])
    expect(ranged.anchorKey).toBe("asset:4")
  })

  it("keeps directory and normalized search scroll positions in separate session slots", () => {
    expect(assetLibraryScrollPositionKey({ folderID: "folder-1", query: "" })).toBe("folder:folder-1")
    expect(assetLibraryScrollPositionKey({ folderID: "folder-1", query: "  角色  " })).toBe("search:角色")
  })

  it("formats compact media metadata", () => {
    expect(formatAssetLibrarySize(0)).toBe("0 B")
    expect(formatAssetLibrarySize(1536)).toBe("1.5 KB")
    expect(formatAssetLibrarySize(12 * 1024 * 1024)).toBe("12 MB")
    expect(formatAssetLibraryDuration(65)).toBe("1:05")
    expect(formatAssetLibraryDuration(3661)).toBe("1:01:01")
  })

  it("virtualizes only above the 200-asset boundary and keeps two-column row math", () => {
    expect(shouldVirtualizeAssetLibraryGrid(200)).toBe(false)
    expect(shouldVirtualizeAssetLibraryGrid(201)).toBe(true)
    expect(assetLibraryGridRowCount(200)).toBe(100)
    expect(assetLibraryGridRowCount(201)).toBe(101)
  })

  it("keeps dotted catalog display names intact and derives the physical extension from relativePath", () => {
    const asset = {
      id: "asset-1",
      folderID: "folder-1",
      relativePath: "角色/my.asset.png",
      displayName: "my.asset",
      kind: "image",
      source: "upload",
      status: "ready",
      mimeType: "image/png",
      sizeBytes: 12,
      checksum: "checksum",
      contentRevision: 1,
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
    } as const

    expect(assetRenameParts(asset)).toEqual({ baseName: "my.asset", extension: ".png" })
  })

  it("uses catalog paths and summarizes mixed selections", () => {
    const entries = [{
      entryType: "asset" as const,
      asset: {
        id: "asset-1",
        folderID: "folder-1",
        relativePath: "角色/image.png",
        displayName: "image",
        kind: "image" as const,
        source: "upload" as const,
        status: "ready" as const,
        mimeType: "image/png",
        sizeBytes: 2048,
        checksum: "checksum",
        contentRevision: 1,
        createdAt: "2026-07-10T00:00:00.000Z",
        updatedAt: "2026-07-10T00:00:00.000Z",
      },
    }, {
      entryType: "folder" as const,
      folder: {
        id: "folder-2",
        parentID: "root",
        name: "场景",
        relativePath: "场景",
        depth: 1,
        system: false,
        status: "active" as const,
        createdAt: "2026-07-10T00:00:00.000Z",
        updatedAt: "2026-07-10T00:00:00.000Z",
      },
    }]

    expect(assetLibraryEntryPath(entries[0])).toBe("角色/image.png")
    expect(summarizeAssetLibrarySelection(entries)).toEqual({
      count: 2,
      assetCount: 1,
      folderCount: 1,
      knownSizeBytes: 2048,
    })
  })
})
