/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { CinemaTimelineDocument } from "@anybox/cinema-plugin/contracts/timeline"
import { I18nProvider } from "../../../i18n"
import { TimelineSubtitlesPanel } from "./TimelineSubtitlesPanel"

const timeline: CinemaTimelineDocument = {
  schemaVersion: 2,
  id: "timeline-subtitles",
  projectID: "project-1",
  title: "Export test",
  revision: 0,
  createdAt: "2026-07-12T00:00:00.000Z",
  updatedAt: "2026-07-12T00:00:00.000Z",
  settings: {
    width: 1920,
    height: 1080,
    frameRate: { numerator: 24, denominator: 1 },
    sampleRate: 48_000,
    backgroundColor: "#000000",
  },
  tracks: [{
    id: "track-s1",
    kind: "subtitle",
    title: "S1",
    order: 0,
    locked: false,
    hidden: false,
    language: "en-US",
    role: "subtitle",
    style: {
      fontFamilyID: "anybox-subtitle-sans-v1",
      fontSizePx: 52,
      textColor: "#FFFFFFFF",
      outlineColor: "#000000FF",
      outlineWidthPx: 2,
      backgroundColor: "#00000000",
      alignment: "bottom-center",
      marginBottomPx: 64,
    },
  }],
  clips: [
    { id: "cue-1", kind: "subtitle", trackID: "track-s1", timelineStartUs: 0, durationUs: 1_000_000, cueText: "First cue", createdAt: "2026-07-12T00:00:00.000Z", updatedAt: "2026-07-12T00:00:00.000Z" },
    { id: "cue-2", kind: "subtitle", trackID: "track-s1", timelineStartUs: 2_000_000, durationUs: 1_000_000, cueText: "Second cue", createdAt: "2026-07-12T00:00:00.000Z", updatedAt: "2026-07-12T00:00:00.000Z" },
  ],
  markers: [],
}

function readBlob(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(String(reader.result))
    reader.readAsText(blob)
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("TimelineSubtitlesPanel", () => {
  it("exports the complete active track when the cue list is filtered", async () => {
    let exportedBlob: Blob | null = null
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      exportedBlob = blob as Blob
      return "blob:subtitle-export"
    })
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)

    render(
      <I18nProvider locale="en-US">
        <TimelineSubtitlesPanel
          timeline={timeline}
          activeTrackID="track-s1"
          selectedCueID={null}
          composerOpen={false}
          qualityIssues={[]}
          onSetActiveTrack={vi.fn()}
          onAddTrack={vi.fn()}
          onOpenComposer={vi.fn()}
          onCloseComposer={vi.fn()}
          onCreateCue={vi.fn()}
          onImport={vi.fn()}
          onSelectCue={vi.fn()}
          onEditTrack={vi.fn()}
        />
      </I18nProvider>,
    )

    fireEvent.change(screen.getByLabelText("Search subtitles"), { target: { value: "Second" } })
    expect(screen.queryByText("First cue")).not.toBeInTheDocument()
    expect(screen.getByText("Second cue")).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "SRT" }))

    expect(exportedBlob).not.toBeNull()
    const exported = await readBlob(exportedBlob!)
    expect(exported).toContain("First cue")
    expect(exported).toContain("Second cue")
  })
})
