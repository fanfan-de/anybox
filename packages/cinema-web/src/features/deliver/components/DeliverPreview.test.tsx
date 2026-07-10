/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { CinemaRenderJob } from "@anybox/shared/cinema-render"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DeliverPreview } from "./DeliverPreview"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const succeededJob: CinemaRenderJob = {
  schemaVersion: 1,
  id: "render-job-output-status",
  projectID: "project-1",
  timelineID: "timeline-1",
  timelineRevision: 3,
  operationID: "render-output-status",
  status: "succeeded",
  settings: {
    format: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    width: 1920,
    height: 1080,
    frameRate: { numerator: 24, denominator: 1 },
    quality: { mode: "balanced" },
    audioBitrateKbps: 192,
    range: { type: "full" },
    outputName: "Review output",
  },
  progress: { phase: "succeeded", percent: 100 },
  outputAssetRef: {
    scope: { type: "project", projectID: "project-1" },
    assetID: "render-output-1",
    contentRevision: 0,
    snapshot: {
      kind: "video",
      displayName: "Review output.mp4",
      mimeType: "video/mp4",
      durationSeconds: 5,
    },
  },
  createdAt: "2026-07-10T00:00:00.000Z",
  startedAt: "2026-07-10T00:00:01.000Z",
  finishedAt: "2026-07-10T00:00:06.000Z",
  updatedAt: "2026-07-10T00:00:06.000Z",
}

describe("DeliverPreview output availability", () => {
  it("replaces a succeeded preview with an actionable state when its asset is trashed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          revision: 8,
          asset: {
            id: "render-output-1",
            displayName: "Review output.mp4",
            kind: "video",
            status: "trashed",
          },
        },
      }),
    } as Response)))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = render(
      <QueryClientProvider client={queryClient}>
        <DeliverPreview agentBaseURL="http://agent.test" timeline={null} job={succeededJob} />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Output is in Trash"))
    expect(screen.getByRole("button", { name: "Check again" })).toBeEnabled()
    expect(view.container.querySelector("video")).toBeNull()
  })
})
