import { afterEach, describe, expect, it, vi } from "vitest"
import { createAssetLibraryApi } from "./assetLibraryApi"

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

describe("assetLibraryApi mutations", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("posts a full reconcile with revision and operation identity", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => jsonResponse({
      scope: { type: "project", projectID: "project-1" },
      operationID: "reconcile-1",
      revision: 8,
      affected: [],
      warnings: [],
    }))
    vi.stubGlobal("fetch", fetchMock)
    const api = createAssetLibraryApi(
      "http://127.0.0.1:4096",
      "project-1",
      { type: "project", projectID: "project-1" },
    )

    await expect(api.reconcile({
      full: true,
      operationID: "reconcile-1",
      baseRevision: 7,
    })).resolves.toMatchObject({ revision: 8, operationID: "reconcile-1" })

    const [requestURL, requestInit] = fetchMock.mock.calls[0]!
    expect(String(requestURL)).toBe("http://127.0.0.1:4096/api/cinema/projects/project-1/library/reconcile")
    expect(requestInit?.method).toBe("POST")
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      full: true,
      operationID: "reconcile-1",
      baseRevision: 7,
    })
  })

  it("renames an asset with baseName only", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => jsonResponse({
      revision: 4,
      asset: {
        id: "asset-1",
        folderID: "folder-1",
        relativePath: "角色/portrait-final.png",
        displayName: "portrait-final.png",
        kind: "image",
        source: "upload",
        status: "ready",
        mimeType: "image/png",
        sizeBytes: 42,
        checksum: "checksum",
        contentRevision: 1,
        createdAt: "2026-07-10T00:00:00.000Z",
        updatedAt: "2026-07-10T00:00:00.000Z",
      },
    }))
    vi.stubGlobal("fetch", fetchMock)
    const api = createAssetLibraryApi(
      "http://127.0.0.1:4096",
      "project-1",
      { type: "project", projectID: "project-1" },
    )

    await api.renameAsset({
      assetID: "asset-1",
      baseName: "portrait-final",
      operationID: "rename-1",
      baseRevision: 3,
    })

    const [, requestInit] = fetchMock.mock.calls[0]!
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      baseName: "portrait-final",
      operationID: "rename-1",
      baseRevision: 3,
    })
  })

  it("reads the current asset status for Canvas reference hydration", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => jsonResponse({
      revision: 5,
      asset: {
        id: "asset-trashed",
        folderID: "folder-1",
        relativePath: ".trash/op/asset-trashed-image.png",
        displayName: "image",
        kind: "image",
        source: "upload",
        status: "trashed",
        mimeType: "image/png",
        sizeBytes: 42,
        checksum: "checksum",
        contentRevision: 1,
        createdAt: "2026-07-10T00:00:00.000Z",
        updatedAt: "2026-07-10T00:00:00.000Z",
      },
    }))
    vi.stubGlobal("fetch", fetchMock)
    const api = createAssetLibraryApi(
      "http://127.0.0.1:4096",
      "project-1",
      { type: "project", projectID: "project-1" },
    )

    await expect(api.getAsset("asset-trashed")).resolves.toMatchObject({
      revision: 5,
      asset: { id: "asset-trashed", status: "trashed" },
    })
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://127.0.0.1:4096/api/cinema/projects/project-1/library/assets/asset-trashed",
    )
  })

  it("lists library entries without exposing a recycle-bin view parameter", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => jsonResponse({
      scope: { type: "project", projectID: "project-1" },
      revision: 6,
      folderID: "root",
      breadcrumbs: [],
      query: "",
      entries: [],
      total: 0,
    }))
    vi.stubGlobal("fetch", fetchMock)
    const api = createAssetLibraryApi(
      "http://127.0.0.1:4096",
      "project-1",
      { type: "project", projectID: "project-1" },
    )

    await api.listEntries({ folderID: "root", limit: 100 })

    const [requestURL] = fetchMock.mock.calls[0]!
    const url = new URL(String(requestURL))
    expect(url.pathname).toBe("/api/cinema/projects/project-1/library/entries")
    expect(Object.fromEntries(url.searchParams)).toEqual({ folderID: "root", limit: "100" })
  })

  it("begins a delete and normalizes the server-owned undo deadline", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => jsonResponse({
      scope: { type: "project", projectID: "project-1" },
      operationID: "delete-1",
      revision: 9,
      affected: [{ entryType: "asset", assetID: "asset-1" }],
      warnings: [],
      undoUntil: "2026-07-14T04:00:10.000Z",
    }))
    vi.stubGlobal("fetch", fetchMock)
    const api = createAssetLibraryApi(
      "http://127.0.0.1:4096",
      "project-1",
      { type: "project", projectID: "project-1" },
    )

    await expect(api.beginDelete({
      entries: [{ entryType: "asset", assetID: "asset-1" }],
      operationID: "delete-1",
      baseRevision: 8,
    })).resolves.toMatchObject({
      operationID: "delete-1",
      revision: 9,
      undoUntil: "2026-07-14T04:00:10.000Z",
    })

    const [requestURL, requestInit] = fetchMock.mock.calls[0]!
    expect(String(requestURL)).toBe("http://127.0.0.1:4096/api/cinema/projects/project-1/library/trash")
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      entries: [{ entryType: "asset", assetID: "asset-1" }],
      operationID: "delete-1",
      baseRevision: 8,
    })
  })

  it("rejects a delete response without a valid undo deadline", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => jsonResponse({
      scope: { type: "personal" },
      operationID: "delete-1",
      revision: 9,
      affected: [{ entryType: "asset", assetID: "asset-1" }],
      warnings: [],
    }))
    vi.stubGlobal("fetch", fetchMock)
    const api = createAssetLibraryApi(
      "http://127.0.0.1:4096",
      "project-1",
      { type: "personal" },
    )

    await expect(api.beginDelete({
      entries: [{ entryType: "asset", assetID: "asset-1" }],
      operationID: "delete-1",
      baseRevision: 8,
    })).rejects.toMatchObject({ status: 500 })
  })

  it("preserves the server error code for referenced-asset messaging", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({
      success: false,
      error: {
        code: "CINEMA_LIBRARY_ASSET_REFERENCED",
        message: "Asset is still referenced.",
        data: { latestRevision: 9 },
      },
    }), {
      status: 409,
      headers: { "content-type": "application/json" },
    }))
    vi.stubGlobal("fetch", fetchMock)
    const api = createAssetLibraryApi(
      "http://127.0.0.1:4096",
      "project-1",
      { type: "project", projectID: "project-1" },
    )

    await expect(api.beginDelete({
      entries: [{ entryType: "asset", assetID: "asset-1" }],
      operationID: "delete-1",
      baseRevision: 8,
    })).rejects.toMatchObject({
      status: 409,
      code: "CINEMA_LIBRARY_ASSET_REFERENCED",
      latestRevision: 9,
    })
  })

  it("undoes a pending delete through the restore route", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => jsonResponse({
      scope: { type: "personal" },
      operationID: "undo-delete-1",
      revision: 10,
      affected: [{ entryType: "folder", folderID: "folder-1" }],
      warnings: [],
    }))
    vi.stubGlobal("fetch", fetchMock)
    const api = createAssetLibraryApi(
      "http://127.0.0.1:4096",
      "project-1",
      { type: "personal" },
    )

    await api.undoDelete({
      entries: [{ entryType: "folder", folderID: "folder-1" }],
      operationID: "undo-delete-1",
      baseRevision: 9,
    })

    const [requestURL, requestInit] = fetchMock.mock.calls[0]!
    expect(String(requestURL)).toBe("http://127.0.0.1:4096/api/cinema/personal-library/restore")
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      entries: [{ entryType: "folder", folderID: "folder-1" }],
      operationID: "undo-delete-1",
      baseRevision: 9,
    })
  })

  it("finalizes a pending delete through the permanent-delete route", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => jsonResponse({
      scope: { type: "personal" },
      operationID: "finalize-delete-1",
      revision: 9,
      affected: [{ entryType: "asset", assetID: "asset-1" }],
      warnings: [],
    }))
    vi.stubGlobal("fetch", fetchMock)
    const api = createAssetLibraryApi(
      "http://127.0.0.1:4096",
      "project-1",
      { type: "personal" },
    )

    await api.finalizeDelete({
      entries: [{ entryType: "asset", assetID: "asset-1" }],
      operationID: "finalize-delete-1",
      baseRevision: 8,
    })

    const [requestURL, requestInit] = fetchMock.mock.calls[0]!
    expect(String(requestURL)).toBe("http://127.0.0.1:4096/api/cinema/personal-library/permanent-delete")
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      entries: [{ entryType: "asset", assetID: "asset-1" }],
      operationID: "finalize-delete-1",
      baseRevision: 8,
    })
  })
})
