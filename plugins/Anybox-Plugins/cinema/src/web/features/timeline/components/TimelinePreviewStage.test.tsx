/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest"
import { cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CinemaTimelineAudioClip, CinemaTimelineDocument } from "@anybox/cinema-plugin/contracts/timeline"
import { I18nProvider } from "../../../i18n"
import { TimelinePreviewStage } from "./TimelinePreviewStage"

function audioClip(id: string, trackID: string, assetID: string, volume: number): CinemaTimelineAudioClip {
  return {
    id,
    trackID,
    kind: "audio",
    title: id,
    timelineStartUs: 0,
    durationUs: 4_000_000,
    playbackRate: 1,
    volume,
    opacity: 1,
    fadeInUs: 2_000_000,
    fadeOutUs: 0,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    assetRef: {
      scope: { type: "project", projectID: "project-1" },
      assetID,
      contentRevision: assetID === "asset-dialogue" ? 3 : 4,
      snapshot: { kind: "audio", displayName: `${assetID}.wav`, mimeType: "audio/wav", durationSeconds: 4 },
    },
    sourceInUs: 0,
    sourceDurationUs: 4_000_000,
  }
}

const timeline: CinemaTimelineDocument = {
  schemaVersion: 2,
  id: "timeline-1",
  projectID: "project-1",
  title: "Timeline 1",
  revision: 0,
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
  settings: {
    width: 1920,
    height: 1080,
    frameRate: { numerator: 24, denominator: 1 },
    sampleRate: 48_000,
    backgroundColor: "#000000",
  },
  tracks: [
    { id: "audio-dialogue", kind: "audio", title: "Dialogue", order: 0, locked: false, muted: false, hidden: false },
    { id: "audio-score", kind: "audio", title: "Score", order: 1, locked: false, muted: false, hidden: false },
  ],
  clips: [
    audioClip("dialogue", "audio-dialogue", "asset-dialogue", 1),
    audioClip("score", "audio-score", "asset-score", 0.6),
  ],
  markers: [],
}

function preview(playheadUs: number) {
  return <I18nProvider locale="en-US">
    <TimelinePreviewStage
      agentBaseURL="http://127.0.0.1:4096"
      projectID="project-1"
      timeline={timeline}
      playheadUs={playheadUs}
      playing={false}
      playbackDirection={1}
      muted={false}
      activeSubtitleTrackID={null}
      assetStatuses={new Map()}
      onTogglePlaying={vi.fn()}
      onToggleMuted={vi.fn()}
      onSeek={vi.fn()}
      onStepFrame={vi.fn()}
      onBrowseAssets={vi.fn()}
    />
  </I18nProvider>
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined)
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0)))
  vi.stubGlobal("cancelAnimationFrame", vi.fn((handle: number) => window.clearTimeout(handle)))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("TimelinePreviewStage audio", () => {
  it("renders every active audio clip and updates fades as the playhead advances", async () => {
    const rendered = render(preview(1_000_000))
    const audios = Array.from(rendered.container.querySelectorAll<HTMLAudioElement>("audio[data-cinema-audio-clip-id]"))

    expect(audios).toHaveLength(2)
    expect(new URL(audios[0]!.src).searchParams.get("v")).toBe("3")
    expect(new URL(audios[1]!.src).searchParams.get("v")).toBe("4")
    await waitFor(() => {
      expect(audios[0]!.volume).toBeCloseTo(0.5)
      expect(audios[1]!.volume).toBeCloseTo(0.3)
    })

    rendered.rerender(preview(2_000_000))
    await waitFor(() => {
      expect(audios[0]!.volume).toBeCloseTo(1)
      expect(audios[1]!.volume).toBeCloseTo(0.6)
    })
  })
})
