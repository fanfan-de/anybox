/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { CinemaTimelineVideoClip } from "@anybox/shared/cinema-timeline"
import { TimelineFilmstrip } from "./TimelineFilmstrip"

afterEach(cleanup)

const clip: CinemaTimelineVideoClip = {
  id: "clip-1",
  trackID: "v1",
  kind: "video",
  title: "Shot",
  timelineStartUs: 0,
  durationUs: 20_000_000,
  playbackRate: 1,
  volume: 1,
  opacity: 1,
  fit: "contain",
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
  assetRef: {
    scope: { type: "project", projectID: "p" },
    assetID: "video-1",
    contentRevision: 2,
    snapshot: { kind: "video", displayName: "shot.mp4", mimeType: "video/mp4", durationSeconds: 20 },
  },
  sourceInUs: 0,
  sourceDurationUs: 20_000_000,
}

describe("TimelineFilmstrip", () => {
  it("reuses one thumbnail URL for a bounded number of visible cells", () => {
    const rendered = render(<TimelineFilmstrip
      agentBaseURL="http://localhost:4187"
      projectID="p"
      clip={clip}
      clipLeftPx={0}
      clipWidthPx={10_000}
      visibleStartPx={4_000}
      visibleEndPx={4_720}
      ready
    />)
    const strip = rendered.container.querySelector(".cinema-timeline-filmstrip")!
    const images = [...rendered.container.querySelectorAll("img")]
    expect(Number(strip.getAttribute("data-filmstrip-cell-count"))).toBeLessThanOrEqual(13)
    expect(new Set(images.map((image) => image.src)).size).toBe(1)
  })

  it("shows a stable placeholder while unavailable or after image failure", () => {
    const rendered = render(<TimelineFilmstrip
      agentBaseURL="http://localhost:4187"
      projectID="p"
      clip={clip}
      clipLeftPx={0}
      clipWidthPx={300}
      visibleStartPx={0}
      visibleEndPx={300}
      ready={false}
    />)
    expect(rendered.container.querySelector(".cinema-timeline-filmstrip")).toHaveClass("is-unavailable")
    expect(rendered.container.querySelectorAll("img")).toHaveLength(0)

    rendered.rerender(<TimelineFilmstrip
      agentBaseURL="http://localhost:4187"
      projectID="p"
      clip={clip}
      clipLeftPx={0}
      clipWidthPx={300}
      visibleStartPx={0}
      visibleEndPx={300}
      ready
    />)
    const image = rendered.container.querySelector("img")!
    fireEvent.error(image)
    expect(rendered.container.querySelector(".cinema-timeline-filmstrip")).toHaveClass("is-unavailable")
    expect(rendered.container.querySelectorAll("img")).toHaveLength(0)
  })
})
