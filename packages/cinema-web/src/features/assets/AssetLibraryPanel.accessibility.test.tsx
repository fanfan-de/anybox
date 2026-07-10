/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import axe from "axe-core"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AssetLibraryPanel } from "./AssetLibraryPanel"

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
          view: "library",
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
        <AssetLibraryPanel
          agentBaseURL="http://127.0.0.1:4096"
          projectID="project-a11y"
          initialScope="personal"
          onClose={() => undefined}
          onAddToCanvas={() => undefined}
        />
      </QueryClientProvider>,
    )

    expect(await screen.findByRole("complementary", { name: "素材库" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "个人", selected: true })).toBeInTheDocument()
    expect(screen.getByRole("searchbox", { name: "搜索当前素材库" })).toBeEnabled()
    await waitFor(() => expect(screen.getByRole("button", { name: "上传素材" })).toBeEnabled())

    // jsdom has no canvas implementation; real color contrast remains covered
    // by the Playwright + Axe smoke test against Chromium.
    const result = await axe.run(view.container, {
      rules: { "color-contrast": { enabled: false } },
    })
    expect(result.violations).toEqual([])
  })
})
