import { describe, expect, it } from "vitest"

import {
  CinemaSubtitleParseError,
  parseCinemaSrt,
  parseCinemaWebVtt,
  serializeCinemaSrt,
  serializeCinemaWebVtt,
} from "../../src/contracts/cinema-subtitles"

describe("Cinema subtitle exchange", () => {
  it("parses SRT with BOM, CRLF and decimal commas", () => {
    const parsed = parseCinemaSrt("\uFEFF1\r\n00:00:01,250 --> 00:00:03,000\r\n第一行\r\nSecond line\r\n")
    expect(parsed.cues).toEqual([{ startUs: 1_250_000, durationUs: 1_750_000, text: "第一行\nSecond line" }])
  })

  it("parses WebVTT voice spans and warns about settings", () => {
    const parsed = parseCinemaWebVtt("WEBVTT\n\nhello\n00:01.000 --> 00:02.500 align:right\n<v Roger>Hello &amp; welcome\n")
    expect(parsed.cues[0]).toMatchObject({ id: "hello", startUs: 1_000_000, durationUs: 1_500_000, text: "Hello & welcome", speaker: "Roger" })
    expect(parsed.warnings.map((warning) => warning.code)).toEqual(["unsupported-vtt-settings"])
  })

  it("rejects duplicate WebVTT cue ids without partial output", () => {
    expect(() => parseCinemaWebVtt("WEBVTT\n\na\n00:01.000 --> 00:02.000\nOne\n\na\n00:03.000 --> 00:04.000\nTwo\n"))
      .toThrow(CinemaSubtitleParseError)
  })

  it("rejects duplicate SRT sequence ids", () => {
    expect(() => parseCinemaSrt("1\n00:00:01,000 --> 00:00:02,000\nOne\n\n1\n00:00:03,000 --> 00:00:04,000\nTwo\n"))
      .toThrow(CinemaSubtitleParseError)
  })

  it("serializes deterministic SRT and WebVTT", () => {
    const cues = [{ id: "cue-1", startUs: 1_000_400, durationUs: 999_200, text: "Hello", speaker: "Sam" }]
    expect(serializeCinemaSrt(cues)).toContain("00:00:01,000 --> 00:00:02,000\r\nSam: Hello")
    expect(serializeCinemaWebVtt(cues)).toContain("cue-1\n00:00:01.000 --> 00:00:02.000\n<v Sam>Hello")
  })
})
