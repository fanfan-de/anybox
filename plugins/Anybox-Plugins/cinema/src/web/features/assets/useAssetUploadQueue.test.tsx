/** @vitest-environment jsdom */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { CinemaAssetScope } from "@anybox/cinema-plugin/contracts"
import type { AssetLibraryApi } from "./assetLibraryApi"
import { useAssetUploadQueue } from "./useAssetUploadQueue"

function queueApi(
  requestKey: string,
  scope: CinemaAssetScope,
  upload: AssetLibraryApi["upload"],
): AssetLibraryApi {
  return {
    requestKey,
    scopeKey: requestKey,
    scope,
    upload,
    getState: vi.fn(),
  } as unknown as AssetLibraryApi
}

afterEach(cleanup)

describe("useAssetUploadQueue", () => {
  it("never starts an old queued file with the newly selected library API", async () => {
    const oldUpload = vi.fn<AssetLibraryApi["upload"]>(() => new Promise(() => undefined))
    const newUpload = vi.fn<AssetLibraryApi["upload"]>(() => new Promise(() => undefined))
    const projectApi = queueApi(
      "http://runtime/api/cinema/projects/project-1/library",
      { type: "project", projectID: "project-1" },
      oldUpload,
    )
    const personalApi = queueApi(
      "http://runtime/api/cinema/personal-library",
      { type: "personal" },
      newUpload,
    )
    const { result, rerender } = renderHook(
      ({ api, revision }) => useAssetUploadQueue({
        api,
        revision,
        concurrency: 1,
        onRevision: vi.fn(),
      }),
      { initialProps: { api: projectApi, revision: 0 } },
    )

    act(() => result.current.enqueue([
      new File(["first"], "first.png", { type: "image/png" }),
      new File(["second"], "second.png", { type: "image/png" }),
    ], "root"))
    await waitFor(() => expect(oldUpload).toHaveBeenCalledTimes(1))
    expect(result.current.items.filter((item) => item.status === "queued")).toHaveLength(1)
    const oldSignal = oldUpload.mock.calls[0]![0].signal!

    rerender({ api: personalApi, revision: 0 })

    await waitFor(() => expect(result.current.items).toEqual([]))
    expect(oldSignal.aborted).toBe(true)
    expect(newUpload).not.toHaveBeenCalled()
  })
})
