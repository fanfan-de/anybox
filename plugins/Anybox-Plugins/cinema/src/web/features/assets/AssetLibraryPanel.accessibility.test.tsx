/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import axe from "axe-core"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AssetLibraryPanel } from "./AssetLibraryPanel"
import { I18nProvider } from "../../i18n"

function envelope(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

describe("AssetLibraryPanel accessibility", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("renders the personal-library keyboard surface without axe violations", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
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
          counts: { folders: 7, assets: 0, processing: 0, failed: 0, missing: 0, trashed: 0 },
          updatedAt: "2026-07-10T00:00:00.000Z",
        })
      }
      if (url.pathname.endsWith("/entries")) {
        return envelope({
          scope: { type: "personal" },
          revision: 0,
          folder: null,
          breadcrumbs: [],
          query: "",
          entries: [],
          nextCursor: null,
          total: 0,
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })

    const view = render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider locale="zh-CN">
          <AssetLibraryPanel
            agentBaseURL="http://127.0.0.1:4096"
            projectID="project-a11y"
            initialScope="personal"
            onClose={() => undefined}
            onAddToCanvas={() => undefined}
          />
        </I18nProvider>
      </QueryClientProvider>,
    )

    expect(await screen.findByRole("complementary", { name: "素材库" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "个人", selected: true })).toBeInTheDocument()
    expect(screen.getByRole("searchbox", { name: "搜索当前素材库" })).toBeEnabled()
    await waitFor(() => expect(screen.getByRole("button", { name: "上传素材" })).toBeEnabled())
    expect(screen.queryByRole("button", { name: "新建文件夹" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /回收站/ })).not.toBeInTheDocument()

    const entriesRequest = fetchMock.mock.calls.find(([input]) => new URL(String(input)).pathname.endsWith("/entries"))
    expect(entriesRequest).toBeDefined()
    expect(new URL(String(entriesRequest?.[0])).searchParams.has("view")).toBe(false)

    const content = screen.getByRole("tabpanel")
    fireEvent.contextMenu(content, { clientX: 24, clientY: 24 })
    const menu = await screen.findByRole("menu")
    expect(screen.getByRole("menuitem", { name: "上传到这里" })).toBeEnabled()
    expect(screen.getByRole("menuitem", { name: "新建文件夹" })).toBeEnabled()
    fireEvent.keyDown(menu, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())
    await waitFor(() => expect(content).toHaveFocus())

    fireEvent.keyDown(content, { key: "F10", shiftKey: true })
    const keyboardMenu = await screen.findByRole("menu")
    const keyboardItems = within(keyboardMenu).getAllByRole("menuitem")
    await waitFor(() => expect(keyboardItems[0]).toHaveFocus())
    fireEvent.keyDown(keyboardMenu, { key: "ArrowDown" })
    expect(keyboardItems[1]).toHaveFocus()
    fireEvent.keyDown(keyboardMenu, { key: "Escape" })
    await waitFor(() => expect(content).toHaveFocus())

    // jsdom has no canvas implementation; real color contrast remains covered
    // by the Playwright + Axe smoke test against Chromium.
    const result = await axe.run(view.container, {
      rules: { "color-contrast": { enabled: false } },
    })
    expect(result.violations).toEqual([])
  })

  it("chooses an upload folder at the root and uploads directly inside a concrete folder", async () => {
    const folder = {
      id: "folder-scenes",
      parentID: "root",
      name: "场景",
      relativePath: "场景",
      depth: 1,
      system: false,
      status: "active",
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
    }
    const systemFolder = {
      ...folder,
      id: "folder-inbox",
      name: "素材",
      relativePath: "素材",
      system: true,
    }
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
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
          counts: { folders: 2, assets: 0, processing: 0, failed: 0, missing: 0, trashed: 0 },
          updatedAt: "2026-07-10T00:00:00.000Z",
        })
      }
      if (url.pathname.endsWith("/entries")) {
        const folderID = url.searchParams.get("folderID")
        return envelope({
          scope: { type: "personal" },
          revision: 0,
          folderID,
          folder: folderID === folder.id ? folder : null,
          breadcrumbs: folderID === folder.id
            ? [{ id: "root", name: "素材库" }, { id: folder.id, name: folder.name }]
            : [],
          query: "",
          entries: folderID === folder.id
            ? []
            : [{ entryType: "folder", folder: systemFolder }, { entryType: "folder", folder }],
          nextCursor: null,
          total: folderID === folder.id ? 0 : 2,
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })
    const view = render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider locale="zh-CN">
          <AssetLibraryPanel
            agentBaseURL="http://127.0.0.1:4096"
            projectID="project-upload"
            initialScope="personal"
            onClose={() => undefined}
            onAddToCanvas={() => undefined}
          />
        </I18nProvider>
      </QueryClientProvider>,
    )

    const uploadButton = view.container.querySelector<HTMLButtonElement>(
      '.cinema-asset-library-header-actions button[aria-label="上传素材"]',
    )
    const fileInput = view.container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(uploadButton).not.toBeNull()
    expect(fileInput).not.toBeNull()
    await waitFor(() => expect(uploadButton).toBeEnabled())
    const inputClick = vi.spyOn(fileInput!, "click").mockImplementation(() => undefined)

    const systemFolderLabel = await screen.findByText(systemFolder.name)
    const systemFolderRow = systemFolderLabel.closest("button")
    expect(systemFolderRow).not.toBeNull()
    fireEvent.contextMenu(systemFolderRow!, { clientX: 32, clientY: 32 })
    const systemFolderMenu = await screen.findByRole("menu")
    expect(within(systemFolderMenu).getByRole("menuitem", { name: "打开" })).toBeEnabled()
    expect(within(systemFolderMenu).getByRole("menuitem", { name: "上传到这里" })).toBeEnabled()
    expect(within(systemFolderMenu).getByRole("menuitem", { name: "新建子文件夹" })).toBeEnabled()
    expect(within(systemFolderMenu).queryByRole("menuitem", { name: "重命名" })).not.toBeInTheDocument()
    expect(within(systemFolderMenu).queryByRole("menuitem", { name: "移动" })).not.toBeInTheDocument()
    expect(within(systemFolderMenu).queryByRole("menuitem", { name: "删除" })).not.toBeInTheDocument()
    fireEvent.keyDown(systemFolderMenu, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())

    fireEvent.click(uploadButton!)
    let picker = await screen.findByRole("dialog", { name: "选择上传位置" })
    fireEvent.click(within(picker).getByRole("button", { name: "取消" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "选择上传位置" })).not.toBeInTheDocument())
    expect(inputClick).not.toHaveBeenCalled()

    fireEvent.click(uploadButton!)
    picker = await screen.findByRole("dialog", { name: "选择上传位置" })
    fireEvent.click(await within(picker).findByRole("button", { name: folder.name }))
    await waitFor(() => expect(within(picker).getByText("没有子文件夹")).toBeInTheDocument())
    fireEvent.click(within(picker).getByRole("button", { name: "上传到这里" }))
    expect(inputClick).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "选择上传位置" })).not.toBeInTheDocument())

    fireEvent.click(await screen.findByRole("button", { name: folder.name }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => {
      const url = new URL(String(input))
      return url.pathname.endsWith("/entries") && url.searchParams.get("folderID") === folder.id
    })).toBe(true))
    fireEvent.click(uploadButton!)
    expect(inputClick).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole("dialog", { name: "选择上传位置" })).not.toBeInTheDocument()
  })
})
