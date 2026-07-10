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

  it("requests the top-level recycle-bin view without a search query", async () => {
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

    await api.listEntries({ folderID: "root", view: "trash", limit: 100 })

    const [requestURL] = fetchMock.mock.calls[0]!
    const url = new URL(String(requestURL))
    expect(url.pathname).toBe("/api/cinema/projects/project-1/library/entries")
    expect(Object.fromEntries(url.searchParams)).toEqual({ folderID: "root", limit: "100", view: "trash" })
  })

  it("requests an atomic full recycle-bin deletion without paged entry ids", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => jsonResponse({
      scope: { type: "personal" },
      operationID: "empty-trash-1",
      revision: 9,
      affected: [],
      warnings: [],
    }))
    vi.stubGlobal("fetch", fetchMock)
    const api = createAssetLibraryApi(
      "http://127.0.0.1:4096",
      "project-1",
      { type: "personal" },
    )

    await api.permanentlyDelete({ all: true, operationID: "empty-trash-1", baseRevision: 8 })

    const [requestURL, requestInit] = fetchMock.mock.calls[0]!
    expect(String(requestURL)).toBe("http://127.0.0.1:4096/api/cinema/personal-library/permanent-delete")
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      all: true,
      operationID: "empty-trash-1",
      baseRevision: 8,
    })
  })
})
