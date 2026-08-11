/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { CinemaTimelineTextClip } from "@anybox/cinema-plugin/contracts/timeline"
import { I18nProvider } from "../../../i18n"
import { TimelineInspector } from "./TimelineInspector"

const textClip: CinemaTimelineTextClip = {
  id: "text-1",
  trackID: "overlay-1",
  kind: "text",
  title: "Title card",
  timelineStartUs: 1_000_000,
  durationUs: 2_000_000,
  playbackRate: 1,
  volume: 1,
  opacity: 1,
  text: { value: "Opening title", stylePresetID: "title-default" },
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
}

afterEach(cleanup)

describe("TimelineInspector", () => {
  it("submits text position and duration as one timed-clip trim", () => {
    const onTrim = vi.fn()
    const onUpdate = vi.fn()
    render(
      <I18nProvider locale="en-US">
        <TimelineInspector
          clip={textClip}
          onClose={vi.fn()}
          onUpdate={onUpdate}
          onTrim={onTrim}
          onRequestReplacement={vi.fn()}
        />
      </I18nProvider>,
    )

    fireEvent.change(screen.getByLabelText("Position (seconds)"), { target: { value: "1.5" } })
    fireEvent.change(screen.getByLabelText("Duration (seconds)"), { target: { value: "3" } })
    fireEvent.click(screen.getByRole("button", { name: "Apply" }))

    expect(onTrim).toHaveBeenCalledTimes(1)
    expect(onTrim).toHaveBeenCalledWith({
      timelineStartUs: 1_500_000,
      durationUs: 3_000_000,
      sourceInUs: 0,
      sourceDurationUs: 3_000_000,
    })
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
