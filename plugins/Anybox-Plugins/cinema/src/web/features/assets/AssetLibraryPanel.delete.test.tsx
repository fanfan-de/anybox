/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AssetLibraryPanel } from "./AssetLibraryPanel"

type TestEntry =
  | { entryType: "asset"; asset: ReturnType<typeof audioAsset> }
  | { entryType: "folder"; folder: ReturnType<typeof libraryFolder> }

type RecordedRequest = {
  url: URL
  method: string
  body: Record<string, unknown> | null
}

function envelope(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function audioAsset(id: string, displayName: string) {
  return {
    id,
    folderID: "root",
    relativePath: `${displayName}.mp3`,
    displayName,
    kind: "audio" as const,
    source: "upload" as const,
    status: "ready" as const,
    mimeType: "audio/mpeg",
    sizeBytes: 2048,
    checksum: `checksum-${id}`,
    contentRevision: 1,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
  }
}

function libraryFolder(id: string, name: string) {
  return {
    id,
    parentID: "root",
    name,
    relativePath: name,
    depth: 1,
    system: false,
    status: "active" as const,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
  }
}

function requestBody(init?: RequestInit): Record<string, unknown> | null {
  if (typeof init?.body !== "string") return null
  return JSON.parse(init.body) as Record<string, unknown>
}

function createFetchHarness(options: {
  personalEntries?: TestEntry[]
  projectEntries?: TestEntry[]
  referencedConflict?: boolean
} = {}) {
  const requests: RecordedRequest[] = []
  let trashCount = 0
  let restoreCount = 0
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
    const url = new URL(String(input))
    const method = init?.method ?? "GET"
    const body = requestBody(init)
    requests.push({ url, method, body })
    const personal = url.pathname.includes("/personal-library/")
    const scope = personal
      ? { type: "personal" as const }
      : { type: "project" as const, projectID: "project-delete" }

    if (url.pathname.endsWith("/state")) {
      const entries = personal ? options.personalEntries ?? [] : options.projectEntries ?? []
      return envelope({
        scope,
        revision: trashCount + restoreCount,
        status: "ready",
        readOnly: false,
        rootFolderID: "root",
        defaultFolderIDs: { inbox: "inbox" },
        limits: {
          maxFolderDepth: 8,
          maxImageBytes: 25 * 1024 * 1024,
          maxVideoBytes: 2 * 1024 * 1024 * 1024,
          maxAudioBytes: 512 * 1024 * 1024,
        },
        counts: {
          folders: entries.filter((entry) => entry.entryType === "folder").length,
          assets: entries.filter((entry) => entry.entryType === "asset").length,
          processing: 0,
          failed: 0,
          missing: 0,
          trashed: 0,
        },
        updatedAt: "2026-07-10T00:00:00.000Z",
      })
    }

    if (url.pathname.endsWith("/migration")) {
      return envelope({
        projectID: "project-delete",
        phase: "completed",
        readOnly: false,
        candidateCount: 0,
        totalBytes: 0,
        unrecognizedCount: 0,
        candidates: [],
      })
    }

    if (url.pathname.endsWith("/entries")) {
      const entries = personal ? options.personalEntries ?? [] : options.projectEntries ?? []
      return envelope({
        scope,
        revision: trashCount + restoreCount,
        folderID: url.searchParams.get("folderID") ?? "root",
        folder: null,
        breadcrumbs: [],
        query: url.searchParams.get("query") ?? "",
        entries,
        nextCursor: null,
        total: entries.length,
      })
    }

    if (url.pathname.endsWith("/trash")) {
      if (options.referencedConflict) {
        return new Response(JSON.stringify({
          success: false,
          error: {
            code: "CINEMA_LIBRARY_ASSET_REFERENCED",
            message: "Asset is still referenced.",
            data: { latestRevision: trashCount + restoreCount },
          },
        }), {
          status: 409,
          headers: { "content-type": "application/json" },
        })
      }
      trashCount += 1
      return envelope({
        scope,
        operationID: `delete-operation-${trashCount}`,
        revision: trashCount + restoreCount,
        affected: body?.entries ?? [],
        warnings: [],
        undoUntil: new Date(Date.now() + 60_000).toISOString(),
      })
    }

    if (url.pathname.endsWith("/restore")) {
      restoreCount += 1
      return envelope({
        scope,
        operationID: body?.operationID ?? `restore-operation-${restoreCount}`,
        revision: trashCount + restoreCount,
        affected: body?.entries ?? [],
        warnings: [],
      })
    }

    if (url.pathname.endsWith("/permanent-delete")) {
      return envelope({
        scope,
        operationID: body?.operationID ?? "finalize-operation",
        revision: trashCount + restoreCount + 1,
        affected: body?.entries ?? [],
        warnings: [],
      })
    }

    throw new Error(`Unexpected request: ${method} ${url}`)
  })

  return {
    fetchMock,
    requests,
    trashRequests: () => requests.filter((request) => request.url.pathname.endsWith("/trash")),
    restoreRequests: () => requests.filter((request) => request.url.pathname.endsWith("/restore")),
  }
}

function renderPanel(fetchMock: ReturnType<typeof createFetchHarness>["fetchMock"], initialScope: "personal" | "project" = "personal") {
  vi.stubGlobal("fetch", fetchMock)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <AssetLibraryPanel
        agentBaseURL="http://127.0.0.1:4096"
        projectID="project-delete"
        initialScope={initialScope}
        onClose={() => undefined}
        onAddToCanvas={() => undefined}
      />
    </QueryClientProvider>,
  )
}

async function deleteAssetFromContextMenu(displayName: string) {
  const asset = await screen.findByRole("gridcell", { name: new RegExp(displayName) })
  fireEvent.contextMenu(asset, { clientX: 40, clientY: 40 })
  const menu = await screen.findByRole("menu")
  fireEvent.click(within(menu).getByRole("menuitem", { name: "删除" }))
}

describe("AssetLibraryPanel delete interactions", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("deletes one asset without confirmation and restores it from the undo toast", async () => {
    const asset = audioAsset("asset-one", "音效一")
    const harness = createFetchHarness({ personalEntries: [{ entryType: "asset", asset }] })
    renderPanel(harness.fetchMock)

    await deleteAssetFromContextMenu(asset.displayName)

    expect(screen.queryByRole("alertdialog", { name: "删除所选内容" })).not.toBeInTheDocument()
    const toast = await screen.findByRole("status")
    expect(toast).toHaveTextContent("已删除 1 项")
    expect(harness.trashRequests()).toHaveLength(1)
    expect(harness.trashRequests()[0]?.body?.entries).toEqual([
      { entryType: "asset", assetID: asset.id },
    ])

    fireEvent.click(within(toast).getByRole("button", { name: "撤销" }))
    await waitFor(() => expect(harness.restoreRequests()).toHaveLength(1))
    expect(harness.restoreRequests()[0]?.url.pathname).toBe("/api/cinema/personal-library/restore")
    expect(harness.restoreRequests()[0]?.body?.entries).toEqual([
      { entryType: "asset", assetID: asset.id },
    ])
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument())
  })

  it("asks for one confirmation before deleting a folder", async () => {
    const folder = libraryFolder("folder-scenes", "场景")
    const harness = createFetchHarness({ personalEntries: [{ entryType: "folder", folder }] })
    renderPanel(harness.fetchMock)

    const folderLabel = await screen.findByText(folder.name)
    fireEvent.contextMenu(folderLabel.closest("button")!, { clientX: 48, clientY: 48 })
    const menu = await screen.findByRole("menu")
    fireEvent.click(within(menu).getByRole("menuitem", { name: "删除" }))

    const dialog = await screen.findByRole("alertdialog", { name: "删除所选内容" })
    expect(harness.trashRequests()).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }))

    await waitFor(() => expect(harness.trashRequests()).toHaveLength(1))
    await waitFor(() => expect(screen.queryByRole("alertdialog", { name: "删除所选内容" })).not.toBeInTheDocument())
    expect(harness.trashRequests()[0]?.body?.entries).toEqual([
      { entryType: "folder", folderID: folder.id },
    ])
  })

  it("keeps two delete operations in independent undo toasts", async () => {
    const first = audioAsset("asset-one", "音效一")
    const second = audioAsset("asset-two", "音效二")
    const harness = createFetchHarness({
      personalEntries: [
        { entryType: "asset", asset: first },
        { entryType: "asset", asset: second },
      ],
    })
    renderPanel(harness.fetchMock)

    await deleteAssetFromContextMenu(first.displayName)
    expect(await screen.findByRole("status")).toHaveTextContent("已删除 1 项")
    await deleteAssetFromContextMenu(second.displayName)
    await waitFor(() => expect(screen.getAllByRole("status")).toHaveLength(2))
    expect(harness.trashRequests()).toHaveLength(2)

    const toasts = screen.getAllByRole("status")
    fireEvent.click(within(toasts[1]!).getByRole("button", { name: "撤销" }))
    await waitFor(() => expect(harness.restoreRequests()).toHaveLength(1))
    expect(harness.restoreRequests()[0]?.body?.entries).toEqual([
      { entryType: "asset", assetID: second.id },
    ])
    await waitFor(() => expect(screen.getAllByRole("status")).toHaveLength(1))
  })

  it("shows the localized referenced-asset conflict and does not create an undo toast", async () => {
    const asset = audioAsset("asset-referenced", "被引用音效")
    const harness = createFetchHarness({
      personalEntries: [{ entryType: "asset", asset }],
      referencedConflict: true,
    })
    renderPanel(harness.fetchMock)

    await deleteAssetFromContextMenu(asset.displayName)

    expect(await screen.findByText("仍被画布、时间线或任务引用，无法删除")).toBeInTheDocument()
    expect(harness.trashRequests()).toHaveLength(1)
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  it("restores through the original scope after switching tabs", async () => {
    const asset = audioAsset("asset-personal", "个人音效")
    const harness = createFetchHarness({
      personalEntries: [{ entryType: "asset", asset }],
      projectEntries: [],
    })
    renderPanel(harness.fetchMock)

    await deleteAssetFromContextMenu(asset.displayName)
    const toast = await screen.findByRole("status")

    fireEvent.click(screen.getByRole("tab", { name: "项目" }))
    await waitFor(() => expect(screen.getByRole("tab", { name: "项目" })).toHaveAttribute("aria-selected", "true"))
    fireEvent.click(within(toast).getByRole("button", { name: "撤销" }))

    await waitFor(() => expect(harness.restoreRequests()).toHaveLength(1))
    expect(harness.restoreRequests()[0]?.url.pathname).toBe("/api/cinema/personal-library/restore")
    expect(harness.restoreRequests()[0]?.body?.entries).toEqual([
      { entryType: "asset", assetID: asset.id },
    ])
  })
})
