/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { CinemaTimelineAudioClip } from "@anybox/shared/cinema-timeline"
import { TimelineWaveform } from "./TimelineWaveform"

const clip: CinemaTimelineAudioClip = {
  id: "clip-1",
  trackID: "a1",
  kind: "audio",
  title: "Dialogue",
  timelineStartUs: 0,
  durationUs: 2_000_000,
  playbackRate: 1,
  volume: 1,
  opacity: 1,
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
  assetRef: {
    scope: { type: "project", projectID: "p" },
    assetID: "audio-1",
    contentRevision: 2,
    snapshot: { kind: "audio", displayName: "dialogue.wav", mimeType: "audio/wav", durationSeconds: 4 },
  },
  sourceInUs: 1_000_000,
  sourceDurationUs: 2_000_000,
}

function renderWaveform() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TimelineWaveform agentBaseURL="http://localhost:4187" projectID="p" timelineID="timeline-1" clip={clip} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("TimelineWaveform", () => {
  it("keeps a placeholder while loading and renders only the clip source range when ready", async () => {
    let resolveResponse!: (response: Response) => void
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolveResponse = resolve })))
    const rendered = renderWaveform()
    expect(rendered.container.querySelector(".cinema-timeline-waveform-placeholder")).toBeInTheDocument()

    resolveResponse(new Response(JSON.stringify({
      success: true,
      data: {
        clipID: "clip-1",
        contentRevision: 2,
        sampleCount: 101,
        peaks: Array.from({ length: 101 }, (_, index) => index / 100),
        generatedAt: "2026-07-10T00:00:00.000Z",
      },
    }), { status: 200, headers: { "content-type": "application/json" } }))

    await waitFor(() => expect(rendered.container.querySelector(".cinema-timeline-waveform")).toBeInTheDocument())
    expect(rendered.container.querySelector("path")?.getAttribute("d")?.match(/M/g)).toHaveLength(51)
  })

  it("keeps a stable error placeholder when waveform generation fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      success: false,
      error: { code: "WAVEFORM_FAILED", message: "Unable to inspect media" },
    }), { status: 409, headers: { "content-type": "application/json" } })))
    const rendered = renderWaveform()
    await waitFor(() => expect(rendered.container.querySelector(".cinema-timeline-waveform-placeholder")).toHaveClass("is-error"))
    expect(rendered.container.querySelector(".cinema-timeline-waveform")).not.toBeInTheDocument()
  })
})
