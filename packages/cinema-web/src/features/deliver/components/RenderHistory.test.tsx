/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { CinemaRenderJob } from "@anybox/shared/cinema-render"
import {
  RENDER_HISTORY_VIRTUALIZATION_THRESHOLD,
  RenderHistory,
  shouldVirtualizeRenderHistory,
} from "./RenderHistory"
import { I18nProvider } from "../../../i18n"

afterEach(cleanup)

function job(index: number): CinemaRenderJob {
  return {
    schemaVersion: 1,
    id: `job-${index}`,
    projectID: "project-1",
    timelineID: "timeline-1",
    timelineRevision: index + 1,
    operationID: `operation-${index}`,
    status: "succeeded",
    settings: {
      format: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      width: 320,
      height: 180,
      frameRate: { numerator: 25, denominator: 1 },
      quality: { mode: "balanced" },
      audioBitrateKbps: 192,
      range: { type: "full" },
      outputName: `output-${index}`,
    },
    progress: { phase: "succeeded", message: "Done" },
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:01.000Z",
    finishedAt: "2026-07-10T00:00:01.000Z",
  }
}

describe("RenderHistory", () => {
  it("only virtualizes histories above the threshold", () => {
    expect(shouldVirtualizeRenderHistory(RENDER_HISTORY_VIRTUALIZATION_THRESHOLD)).toBe(false)
    expect(shouldVirtualizeRenderHistory(RENDER_HISTORY_VIRTUALIZATION_THRESHOLD + 1)).toBe(true)
    expect(shouldVirtualizeRenderHistory(1_000)).toBe(true)
  })

  it("supports Arrow, Home, and End navigation for a non-virtualized history", () => {
    const jobs = [job(0), job(1), job(2)]
    const onSelect = vi.fn()
    render(<I18nProvider locale="en-US"><RenderHistory jobs={jobs} selectedJobID={jobs[0]!.id} onSelect={onSelect} /></I18nProvider>)

    const first = screen.getByRole("option", { name: /output-0/ })
    expect(screen.getAllByRole("option").filter((option) => option.tabIndex === 0)).toEqual([first])
    first.focus()
    fireEvent.keyDown(first, { key: "End" })

    expect(onSelect).toHaveBeenLastCalledWith(jobs[2])
    expect(screen.getByRole("option", { name: /output-2/ })).toHaveFocus()

    fireEvent.keyDown(document.activeElement!, { key: "Home" })
    expect(onSelect).toHaveBeenLastCalledWith(jobs[0])
    expect(first).toHaveFocus()
  })
})
