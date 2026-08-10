/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { CinemaTimelineClip } from "@anybox/cinema-plugin/contracts/timeline"
import { I18nProvider } from "../../../i18n"
import { TimelineMultiInspector } from "./TimelineMultiInspector"

const timestamp = "2026-07-12T00:00:00.000Z"
const clip: CinemaTimelineClip = {
  id: "clip-1",
  trackID: "v1",
  kind: "video",
  title: "One",
  timelineStartUs: 0,
  durationUs: 2_000_000,
  playbackRate: 1,
  volume: 1,
  opacity: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
  assetRef: { scope: { type: "project", projectID: "p1" }, assetID: "a1", contentRevision: 0, snapshot: { kind: "video", displayName: "one.mp4", mimeType: "video/mp4", durationSeconds: 2 } },
  sourceInUs: 0,
  sourceDurationUs: 2_000_000,
}

describe("TimelineMultiInspector", () => {
  it("shows mixed values and submits only safe changed fields", () => {
    const onUpdate = vi.fn()
    render(
      <I18nProvider locale="en-US">
        <TimelineMultiInspector
          clips={[clip, { ...clip, id: "clip-2", volume: 0.5, timelineStartUs: 3_000_000 }]}
          onClose={vi.fn()}
          onUpdate={onUpdate}
        />
      </I18nProvider>,
    )
    expect(screen.getByText("2 Clips")).toBeVisible()
    expect(screen.getByLabelText("Volume")).toHaveValue(null)
    expect(screen.getByLabelText("Volume")).toHaveAttribute("placeholder", "Mixed")
    expect(screen.getByLabelText("Opacity")).toHaveValue(1)
    fireEvent.change(screen.getByLabelText("Volume"), { target: { value: "0.75" } })
    expect(screen.getByLabelText("Volume")).toHaveValue(0.75)
    fireEvent.click(screen.getByRole("button", { name: "Apply" }))
    expect(onUpdate).toHaveBeenCalledWith({ volume: 0.75 })
  })
})
