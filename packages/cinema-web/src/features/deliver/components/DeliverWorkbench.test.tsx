/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DeliverWorkbench } from "./DeliverWorkbench"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderWorkbench() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <DeliverWorkbench agentBaseURL="http://agent.test" projectID="project-1" />
    </QueryClientProvider>,
  )
}

describe("DeliverWorkbench", () => {
  it("loads timelines and keeps render disabled when preflight is blocked", async () => {
    const timeline = {
      schemaVersion: 1,
      id: "timeline-1",
      projectID: "project-1",
      title: "Rough cut",
      revision: 2,
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
      settings: { width: 1920, height: 1080, frameRate: { numerator: 24, denominator: 1 }, sampleRate: 48000, backgroundColor: "#000000" },
      tracks: [],
      clips: [],
      markers: [],
    }
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      let data: unknown
      if (url.endsWith("/timelines")) data = { timelines: [timeline] }
      else if (url.endsWith("/render-runtime")) data = { available: true, version: "1", platform: "win32", ffprobeAvailable: true, videoEncoders: ["h264_mf"], audioEncoders: ["aac"] }
      else if (url.includes("delivery-preflight")) data = { timelineID: timeline.id, timelineRevision: 2, checkedAt: "2026-07-10T00:00:00.000Z", ready: false, durationUs: 0, estimatedFrameCount: 0, estimatedInputBytes: 0, issues: [{ code: "timeline-empty", severity: "error", message: "Timeline is empty." }], support: { videoClips: 0, audioClips: 0, imageClips: 0, textClips: 0 } }
      else if (url.includes("render-jobs")) data = { items: [] }
      else data = {}
      return { ok: true, status: 200, json: async () => ({ success: true, data }) } as Response
    }))

    renderWorkbench()
    await waitFor(() => expect(screen.getByText("Timeline is empty.")).toBeVisible())
    expect(screen.getByRole("heading", { name: "Rough cut" })).toBeVisible()
    expect(screen.getByRole("option", { name: /Rough cut/ })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("button", { name: /Start render/ })).toBeDisabled()
    expect(screen.getByText("Timeline is empty.")).toBeVisible()
  })
})
