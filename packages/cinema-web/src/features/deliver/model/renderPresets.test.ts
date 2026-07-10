import { describe, expect, it } from "vitest"
import type { CinemaRenderSettings } from "@anybox/shared/cinema-render"
import {
  createRenderOperationFingerprint,
  retainRenderOperation,
  retryRenderOperationFingerprint,
} from "./renderPresets"

const settings: CinemaRenderSettings = {
  format: "mp4",
  videoCodec: "h264",
  audioCodec: "aac",
  width: 1920,
  height: 1080,
  frameRate: { numerator: 24, denominator: 1 },
  quality: { mode: "balanced" },
  audioBitrateKbps: 192,
  range: { type: "full" },
  outputName: "Rough cut",
}

describe("render operation identity", () => {
  it("retains an ID only while the create payload fingerprint is identical", () => {
    const fingerprint = createRenderOperationFingerprint("timeline-1", 2, settings)
    const first = retainRenderOperation(null, fingerprint)

    expect(retainRenderOperation(first, fingerprint)).toBe(first)
    expect(retainRenderOperation(first, createRenderOperationFingerprint("timeline-1", 3, settings)).operationID)
      .not.toBe(first.operationID)
    expect(retainRenderOperation(first, createRenderOperationFingerprint("timeline-2", 2, settings)).operationID)
      .not.toBe(first.operationID)
    expect(retainRenderOperation(first, createRenderOperationFingerprint("timeline-1", 2, { ...settings, outputName: "Final" })).operationID)
      .not.toBe(first.operationID)
  })

  it("rotates retry IDs when the original job changes", () => {
    const first = retainRenderOperation(null, retryRenderOperationFingerprint("job-1"), "retry")
    expect(retainRenderOperation(first, retryRenderOperationFingerprint("job-1"), "retry")).toBe(first)
    expect(retainRenderOperation(first, retryRenderOperationFingerprint("job-2"), "retry").operationID)
      .not.toBe(first.operationID)
  })
})
