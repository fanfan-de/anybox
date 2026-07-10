import { describe, expect, it } from "vitest"
import type { CinemaTimelineAudioClip } from "@anybox/shared/cinema-timeline"
import { timelineAudioFadeGain } from "../components/TimelinePreviewStage"

const clip: CinemaTimelineAudioClip = {
  id: "audio-1",
  trackID: "a1",
  kind: "audio",
  title: "Score",
  timelineStartUs: 1_000_000,
  durationUs: 4_000_000,
  playbackRate: 1,
  volume: 1,
  opacity: 1,
  fadeInUs: 1_000_000,
  fadeOutUs: 2_000_000,
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
  assetRef: {
    scope: { type: "project", projectID: "project-1" },
    assetID: "audio-asset",
    contentRevision: 0,
    snapshot: { kind: "audio", displayName: "score.wav", mimeType: "audio/wav", durationSeconds: 4 },
  },
  sourceInUs: 0,
  sourceDurationUs: 4_000_000,
}

describe("timelineAudioFadeGain", () => {
  it("applies fade-in, steady gain, and fade-out at timeline time", () => {
    expect(timelineAudioFadeGain(clip, 1_000_000)).toBe(0)
    expect(timelineAudioFadeGain(clip, 1_500_000)).toBeCloseTo(0.5)
    expect(timelineAudioFadeGain(clip, 3_000_000)).toBe(1)
    expect(timelineAudioFadeGain(clip, 4_000_000)).toBeCloseTo(0.5)
    expect(timelineAudioFadeGain(clip, 5_000_000)).toBe(0)
  })
})
