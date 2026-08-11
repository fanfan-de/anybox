/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Locale } from "../../i18n"
import { I18nProvider } from "../../i18n"
import { AssetLibraryPanel } from "./AssetLibraryPanel"

function envelope(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("AssetLibraryPanel locale", () => {
  it("updates its visible controls and accessible names when the locale changes", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/state")) return envelope({
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
        counts: { folders: 0, assets: 0, processing: 0, failed: 0, missing: 0, trashed: 0 },
        updatedAt: "2026-07-10T00:00:00.000Z",
      })
      if (url.pathname.endsWith("/entries")) return envelope({
        scope: { type: "personal" },
        revision: 0,
        folder: null,
        breadcrumbs: [],
        query: "",
        entries: [],
        nextCursor: null,
        total: 0,
      })
      throw new Error(`Unexpected request: ${url}`)
    }))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const tree = (locale: Locale) => (
      <QueryClientProvider client={queryClient}>
        <I18nProvider locale={locale}>
          <AssetLibraryPanel
            agentBaseURL="http://127.0.0.1:4096"
            projectID="project-i18n"
            initialScope="personal"
            onClose={vi.fn()}
            onAddToCanvas={vi.fn()}
          />
        </I18nProvider>
      </QueryClientProvider>
    )
    const view = render(tree("en-US"))

    expect(await screen.findByRole("complementary", { name: "Asset Library" })).toBeVisible()
    expect(screen.getByRole("tab", { name: "Personal", selected: true })).toBeVisible()
    expect(screen.getByRole("searchbox", { name: "Search the current Asset Library" })).toBeVisible()

    view.rerender(tree("zh-CN"))
    expect(await screen.findByRole("complementary", { name: "素材库" })).toBeVisible()
    expect(screen.getByRole("tab", { name: "个人", selected: true })).toBeVisible()
    expect(screen.getByRole("searchbox", { name: "搜索当前素材库" })).toBeVisible()
  })
})
