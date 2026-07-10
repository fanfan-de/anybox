import { describe, expect, test } from "bun:test"
import { normalizeWaveformPeaks, parseFFprobeDocument, parseFrameRate } from "../src/cinema/media-runtime"

describe("cinema media runtime", () => {
  test("normalizes PCM waveform samples into bounded peaks", () => {
    expect(normalizeWaveformPeaks([0, -0.5, 1, -0.25], 2)).toEqual([0.5, 1])
    expect(normalizeWaveformPeaks([], 3)).toEqual([0, 0, 0])
  })
  test("parses rational frame rates", () => {
    expect(parseFrameRate("30000/1001")).toBeCloseTo(29.97, 2)
    expect(parseFrameRate("0/0")).toBeUndefined()
    expect(parseFrameRate("invalid")).toBeUndefined()
  })

  test("recognizes a Chromium-playable H.264/AAC video", () => {
    expect(parseFFprobeDocument({
      streams: [
        { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "24/1" },
        { codec_type: "audio", codec_name: "aac" },
      ],
      format: { duration: "12.5", format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
    }, "video")).toEqual({
      durationSeconds: 12.5,
      width: 1920,
      height: 1080,
      fps: 24,
      videoCodec: "h264",
      audioCodec: "aac",
      hasAudio: true,
      formatNames: ["mov", "mp4", "m4a", "3gp", "3g2", "mj2"],
      chromiumPlayable: true,
    })
  })

  test("requests a proxy for unsupported video or audio codecs", () => {
    const result = parseFFprobeDocument({
      streams: [
        { codec_type: "video", codec_name: "hevc", width: 3840, height: 2160 },
        { codec_type: "audio", codec_name: "dts" },
      ],
      format: { duration: "3", format_name: "matroska,webm" },
    }, "video")
    expect(result.chromiumPlayable).toBe(false)
    expect(result.videoCodec).toBe("hevc")
    expect(result.audioCodec).toBe("dts")
  })

  test("requests a proxy for an MKV even when its codecs are playable", () => {
    const result = parseFFprobeDocument({
      streams: [
        { codec_type: "video", codec_name: "h264", width: 1920, height: 1080 },
        { codec_type: "audio", codec_name: "aac" },
      ],
      format: { duration: "3", format_name: "matroska,webm" },
    }, "video", "input.mkv")
    expect(result.chromiumPlayable).toBe(false)
  })

  test("rejects a container without the expected stream", () => {
    expect(() => parseFFprobeDocument({ streams: [{ codec_type: "audio", codec_name: "aac" }] }, "video"))
      .toThrow("video stream")
  })
})
