import { describe, expect, it } from "vitest"
import type { CinemaTimelineVideoClip } from "@anybox/cinema-plugin/contracts/timeline"
import { timelinePreviewVisualStyle } from "../components/TimelinePreviewStage"

const clip: CinemaTimelineVideoClip = {
  id: "video-1",
  trackID: "v1",
  kind: "video",
  title: "Shot",
  timelineStartUs: 0,
  durationUs: 2_000_000,
  playbackRate: 1,
  volume: 1,
  opacity: 0.7,
  fit: "stretch",
  transform: { x: 100, y: -50, scale: 1.25, rotationDegrees: 15, anchorX: 0.25, anchorY: 0.75 },
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
  assetRef: {
    scope: { type: "project", projectID: "p" },
    assetID: "video",
    contentRevision: 0,
    snapshot: { kind: "video", displayName: "video.mp4", mimeType: "video/mp4", durationSeconds: 2 },
  },
  sourceInUs: 0,
  sourceDurationUs: 2_000_000,
}

describe("Timeline preview visual style", () => {
  it("maps output-space transform and stretch fit to CSS", () => {
    expect(timelinePreviewVisualStyle(clip, {
      width: 2_000,
      height: 1_000,
      frameRate: { numerator: 24, denominator: 1 },
      sampleRate: 48_000,
      backgroundColor: "black",
    })).toMatchObject({
      opacity: 0.7,
      objectFit: "fill",
      transformOrigin: "25% 75%",
      transform: "translate(5%, -5%) scale(1.25) rotate(15deg)",
    })
  })
})
