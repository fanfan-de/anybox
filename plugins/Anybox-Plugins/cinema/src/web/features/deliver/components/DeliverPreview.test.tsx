/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { CinemaRenderJob } from "@anybox/cinema-plugin/contracts/render"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DeliverPreview } from "./DeliverPreview"
import { I18nProvider } from "../../../i18n"

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
  it("presents an internally trashed output as deleted without revealing the hidden isolation entry", async () => {
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
    const onShowInAssets = vi.fn()
    const view = render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider locale="en-US">
          <DeliverPreview
            agentBaseURL="http://agent.test"
            timeline={null}
            job={succeededJob}
            onShowInAssets={onShowInAssets}
          />
        </I18nProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Output was deleted"))
    expect(screen.getByRole("alert")).toHaveTextContent("Render the Timeline again")
    expect(screen.getByRole("button", { name: "Check again" })).toBeEnabled()
    expect(screen.queryByRole("button", { name: "Show in Assets" })).not.toBeInTheDocument()
    expect(onShowInAssets).not.toHaveBeenCalled()
    expect(view.container.querySelector("video")).toBeNull()
  })
})
