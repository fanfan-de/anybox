/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const uploadQueueMock = vi.hoisted(() => ({
  enqueue: vi.fn(),
  cancel: vi.fn(),
  retry: vi.fn(),
  clearSettled: vi.fn(),
}))

vi.mock("./useAssetUploadQueue", () => ({
  useAssetUploadQueue: () => ({
    items: [],
    enqueue: uploadQueueMock.enqueue,
    cancel: uploadQueueMock.cancel,
    retry: uploadQueueMock.retry,
    clearSettled: uploadQueueMock.clearSettled,
  }),
}))

import { AssetLibraryPanel } from "./AssetLibraryPanel"

const targetFolder = {
  id: "folder-scenes",
  parentID: "root",
  name: "场景",
  relativePath: "场景",
  depth: 1,
  system: false,
  status: "active" as const,
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
}

function envelope(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function createFetchMock() {
  return vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith("/state")) {
      return envelope({
        scope: { type: "personal" },
        revision: 0,
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
        counts: { folders: 1, assets: 0, processing: 0, failed: 0, missing: 0, trashed: 0 },
        updatedAt: "2026-07-10T00:00:00.000Z",
      })
    }
    if (url.pathname.endsWith("/entries")) {
      const folderID = url.searchParams.get("folderID") ?? "root"
      const insideTarget = folderID === targetFolder.id
      return envelope({
        scope: { type: "personal" },
        revision: 0,
        folderID,
        folder: insideTarget ? targetFolder : null,
        breadcrumbs: insideTarget
          ? [{ id: "root", name: "素材库" }, { id: targetFolder.id, name: targetFolder.name }]
          : [],
        query: url.searchParams.get("query") ?? "",
        entries: insideTarget ? [] : [{ entryType: "folder", folder: targetFolder }],
        nextCursor: null,
        total: insideTarget ? 0 : 1,
      })
    }
    throw new Error(`Unexpected request: ${url}`)
  })
}

let renderSequence = 0

function renderPanel() {
  const fetchMock = createFetchMock()
  vi.stubGlobal("fetch", fetchMock)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AssetLibraryPanel
        agentBaseURL="http://127.0.0.1:4096"
        projectID={`project-upload-${renderSequence += 1}`}
        initialScope="personal"
        onClose={() => undefined}
        onAddToCanvas={() => undefined}
      />
    </QueryClientProvider>,
  )
  const uploadButton = view.container.querySelector<HTMLButtonElement>(
    '.cinema-asset-library-header-actions button[aria-label="上传素材"]',
  )
  const fileInput = view.container.querySelector<HTMLInputElement>('input[type="file"]')
  if (!uploadButton || !fileInput) throw new Error("Upload controls were not rendered")
  return { ...view, fetchMock, uploadButton, fileInput }
}

function fileTransfer(files: File[]) {
  return {
    types: ["Files"],
    files,
    items: files.map(() => ({
      kind: "file",
      webkitGetAsEntry: () => ({ isDirectory: false }),
    })),
    getData: vi.fn(() => ""),
    setData: vi.fn(),
  }
}

async function chooseFolderInPicker() {
  const picker = await screen.findByRole("dialog", { name: "选择上传位置" })
  fireEvent.click(await within(picker).findByRole("button", { name: targetFolder.name }))
  fireEvent.click(within(picker).getByRole("button", { name: "上传到这里" }))
  return picker
}

describe("AssetLibraryPanel upload destinations", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("enqueues selected files directly into the current concrete folder", async () => {
    const { container, fetchMock, uploadButton, fileInput } = renderPanel()
    const folderLabel = await screen.findByText(targetFolder.name)
    fireEvent.click(folderLabel.closest("button")!)
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => {
      const url = new URL(String(input))
      return url.pathname.endsWith("/entries") && url.searchParams.get("folderID") === targetFolder.id
    })).toBe(true))

    const inputClick = vi.spyOn(fileInput, "click").mockImplementation(() => undefined)
    await waitFor(() => expect(uploadButton).toBeEnabled())
    fireEvent.click(uploadButton)

    expect(inputClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("dialog", { name: "选择上传位置" })).not.toBeInTheDocument()
    const file = new File(["audio"], "scene.mp3", { type: "audio/mpeg" })
    fireEvent.change(container.querySelector<HTMLInputElement>('input[type="file"]')!, {
      target: { files: [file] },
    })
    expect(uploadQueueMock.enqueue).toHaveBeenCalledTimes(1)
    expect(uploadQueueMock.enqueue).toHaveBeenCalledWith([file], targetFolder.id)
  })

  it("requires a target at the root, does nothing when canceled, and enqueues after choosing a folder", async () => {
    const { uploadButton, fileInput } = renderPanel()
    await screen.findByText(targetFolder.name)
    await waitFor(() => expect(uploadButton).toBeEnabled())
    const inputClick = vi.spyOn(fileInput, "click").mockImplementation(() => undefined)

    fireEvent.click(uploadButton)
    let picker = await screen.findByRole("dialog", { name: "选择上传位置" })
    expect(inputClick).not.toHaveBeenCalled()
    fireEvent.click(within(picker).getByRole("button", { name: "取消" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "选择上传位置" })).not.toBeInTheDocument())
    expect(uploadQueueMock.enqueue).not.toHaveBeenCalled()

    fireEvent.click(uploadButton)
    picker = await screen.findByRole("dialog", { name: "选择上传位置" })
    await chooseFolderInPicker()
    await waitFor(() => expect(picker).not.toBeInTheDocument())
    expect(inputClick).toHaveBeenCalledTimes(1)

    const file = new File(["image"], "scene.png", { type: "image/png" })
    fireEvent.change(fileInput, { target: { files: [file] } })
    expect(uploadQueueMock.enqueue).toHaveBeenCalledTimes(1)
    expect(uploadQueueMock.enqueue).toHaveBeenCalledWith([file], targetFolder.id)
  })

  it("holds a search-page drop until a folder is chosen and ignores a canceled picker", async () => {
    renderPanel()
    await screen.findByText(targetFolder.name)
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索当前素材库" }), {
      target: { value: "场景" },
    })
    const panel = screen.getByRole("complementary", { name: "素材库" })
    const canceledFile = new File(["first"], "first.wav", { type: "audio/wav" })
    fireEvent.drop(panel, { dataTransfer: fileTransfer([canceledFile]) })

    let picker = await screen.findByRole("dialog", { name: "选择上传位置" })
    expect(uploadQueueMock.enqueue).not.toHaveBeenCalled()
    fireEvent.click(within(picker).getByRole("button", { name: "取消" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "选择上传位置" })).not.toBeInTheDocument())
    expect(uploadQueueMock.enqueue).not.toHaveBeenCalled()

    const chosenFile = new File(["second"], "second.wav", { type: "audio/wav" })
    fireEvent.drop(panel, { dataTransfer: fileTransfer([chosenFile]) })
    picker = await screen.findByRole("dialog", { name: "选择上传位置" })
    await chooseFolderInPicker()
    await waitFor(() => expect(picker).not.toBeInTheDocument())
    expect(uploadQueueMock.enqueue).toHaveBeenCalledTimes(1)
    expect(uploadQueueMock.enqueue).toHaveBeenCalledWith([chosenFile], targetFolder.id)
  })

  it("enqueues files dropped on a folder row directly into that folder", async () => {
    renderPanel()
    const folderLabel = await screen.findByText(targetFolder.name)
    const folderRow = folderLabel.closest("button")
    expect(folderRow).not.toBeNull()
    const file = new File(["video"], "scene.mp4", { type: "video/mp4" })

    fireEvent.drop(folderRow!, { dataTransfer: fileTransfer([file]) })

    expect(uploadQueueMock.enqueue).toHaveBeenCalledTimes(1)
    expect(uploadQueueMock.enqueue).toHaveBeenCalledWith([file], targetFolder.id)
    expect(screen.queryByRole("dialog", { name: "选择上传位置" })).not.toBeInTheDocument()
  })
})
