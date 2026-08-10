import { describe, expect, it } from "vitest"
import {
  CINEMA_ASSET_DRAG_MIME,
  cinemaAssetLocatorFromDragPayload,
  cinemaAssetRefFromNodeData,
  cinemaAssetURL,
  serializeCinemaAssetDragPayload,
} from "./assetNodeData"

describe("asset node data", () => {
  const projectLocator = {
    scope: { type: "project" as const, projectID: "project / 中文" },
    assetID: "asset / 1",
  }

  it("round-trips the private drag payload without accepting arbitrary JSON", () => {
    expect(CINEMA_ASSET_DRAG_MIME).toBe("application/x-anybox-cinema-asset")
    expect(cinemaAssetLocatorFromDragPayload(serializeCinemaAssetDragPayload(projectLocator))).toEqual(projectLocator)
    expect(cinemaAssetLocatorFromDragPayload('{"path":"C:/secret.mov"}')).toBeNull()
    expect(cinemaAssetLocatorFromDragPayload("not json")).toBeNull()
  })

  it("builds encoded project and personal media URLs", () => {
    expect(cinemaAssetURL("http://127.0.0.1:4096", projectLocator)).toBe(
      "http://127.0.0.1:4096/api/cinema/projects/project%20%2F%20%E4%B8%AD%E6%96%87/library/assets/asset%20%2F%201/content",
    )
    expect(cinemaAssetURL("http://127.0.0.1:4096/", {
      scope: { type: "personal" },
      assetID: "personal-audio",
    }, "preview")).toBe("http://127.0.0.1:4096/api/cinema/personal-library/assets/personal-audio/preview")
  })

  it("accepts only canonical server-provided asset refs", () => {
    const assetRef = {
      ...projectLocator,
      contentRevision: 1,
      snapshot: {
        kind: "video" as const,
        displayName: "clip.mp4",
        mimeType: "video/mp4",
        width: 1920,
        height: 1080,
        durationSeconds: 12,
      },
    }
    expect(cinemaAssetRefFromNodeData({ assetRef })).toEqual(assetRef)
    expect(cinemaAssetURL("http://127.0.0.1:4096", assetRef, "preview")).toBe(
      "http://127.0.0.1:4096/api/cinema/projects/project%20%2F%20%E4%B8%AD%E6%96%87/library/assets/asset%20%2F%201/preview?v=1",
    )
    expect(cinemaAssetRefFromNodeData({ assetRef: projectLocator })).toBeNull()
  })
})
