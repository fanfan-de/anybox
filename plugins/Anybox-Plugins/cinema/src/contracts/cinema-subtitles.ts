import {
  CINEMA_TIMELINE_MAX_SUBTITLE_CUES,
  CINEMA_TIMELINE_MAX_SUBTITLE_TEXT_LENGTH,
} from "./cinema-timeline"

export const CINEMA_SUBTITLE_MAX_FILE_BYTES = 2 * 1024 * 1024

export type CinemaSubtitleFormat = "srt" | "vtt"

export type CinemaSubtitleCueInput = {
  id?: string
  startUs: number
  durationUs: number
  text: string
  speaker?: string
}

export type CinemaSubtitleImportWarning = {
  code: "unsupported-vtt-block" | "unsupported-vtt-settings" | "markup-normalized"
  message: string
  line?: number
}

export type CinemaSubtitleParseResult = {
  cues: CinemaSubtitleCueInput[]
  warnings: CinemaSubtitleImportWarning[]
}

export class CinemaSubtitleParseError extends Error {
  readonly line?: number

  constructor(message: string, line?: number) {
    super(line === undefined ? message : `Line ${line}: ${message}`)
    this.name = "CinemaSubtitleParseError"
    this.line = line
  }
}

function assertInputSize(input: string) {
  const bytes = new TextEncoder().encode(input).byteLength
  if (bytes > CINEMA_SUBTITLE_MAX_FILE_BYTES) {
    throw new CinemaSubtitleParseError(`Subtitle file exceeds ${CINEMA_SUBTITLE_MAX_FILE_BYTES} bytes`)
  }
}

function timestampToUs(value: string, line: number) {
  const match = /^(?:(\d{1,3}):)?(\d{2}):(\d{2})[,.](\d{3})$/.exec(value.trim())
  if (!match) throw new CinemaSubtitleParseError(`Invalid subtitle timestamp '${value.trim()}'`, line)
  const hours = Number(match[1] ?? 0)
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  const milliseconds = Number(match[4])
  if (minutes > 59 || seconds > 59) throw new CinemaSubtitleParseError("Timestamp minutes and seconds must be below 60", line)
  const us = (((hours * 60 + minutes) * 60 + seconds) * 1_000 + milliseconds) * 1_000
  if (!Number.isSafeInteger(us)) throw new CinemaSubtitleParseError("Timestamp is outside the supported range", line)
  return us
}

function parseTimingLine(value: string, line: number) {
  const match = /^(.*?)\s+-->\s+(.*?)(?:\s+(.+))?$/.exec(value.trim())
  if (!match?.[1] || !match[2]) throw new CinemaSubtitleParseError("Expected a start and end timestamp separated by -->", line)
  const startUs = timestampToUs(match[1], line)
  const endUs = timestampToUs(match[2], line)
  if (endUs <= startUs) throw new CinemaSubtitleParseError("Cue end time must be after its start time", line)
  return { startUs, durationUs: endUs - startUs, settings: match[3]?.trim() }
}

function normalizeCueText(value: string, line: number, warnings: CinemaSubtitleImportWarning[]) {
  const normalized = value.replace(/\r/g, "").trim()
  if (!normalized) throw new CinemaSubtitleParseError("Cue text cannot be empty", line)
  if (normalized.length > CINEMA_TIMELINE_MAX_SUBTITLE_TEXT_LENGTH) {
    throw new CinemaSubtitleParseError(`Cue text exceeds ${CINEMA_TIMELINE_MAX_SUBTITLE_TEXT_LENGTH} characters`, line)
  }
  return normalized
}

function validateCueCount(cues: CinemaSubtitleCueInput[]) {
  if (cues.length === 0) throw new CinemaSubtitleParseError("Subtitle file contains no cues")
  if (cues.length > CINEMA_TIMELINE_MAX_SUBTITLE_CUES) {
    throw new CinemaSubtitleParseError(`Subtitle file exceeds ${CINEMA_TIMELINE_MAX_SUBTITLE_CUES} cues`)
  }
}

function numberedLines(input: string) {
  return input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n")
}

export function parseCinemaSrt(input: string): CinemaSubtitleParseResult {
  assertInputSize(input)
  const lines = numberedLines(input)
  const cues: CinemaSubtitleCueInput[] = []
  const warnings: CinemaSubtitleImportWarning[] = []
  const ids = new Set<string>()
  let index = 0
  while (index < lines.length) {
    while (index < lines.length && !lines[index]?.trim()) index += 1
    if (index >= lines.length) break
    const blockLine = index + 1
    if (/^\d+$/.test(lines[index]!.trim()) && !lines[index]!.includes("-->")) {
      const id = lines[index]!.trim()
      if (ids.has(id)) throw new CinemaSubtitleParseError(`Duplicate cue id '${id}'`, index + 1)
      ids.add(id)
      index += 1
    }
    const timing = lines[index]
    if (!timing) throw new CinemaSubtitleParseError("Missing cue timing", index + 1)
    const parsed = parseTimingLine(timing, index + 1)
    index += 1
    const text: string[] = []
    while (index < lines.length && lines[index]?.trim()) {
      text.push(lines[index]!)
      index += 1
    }
    cues.push({
      startUs: parsed.startUs,
      durationUs: parsed.durationUs,
      text: normalizeCueText(text.join("\n"), blockLine, warnings),
    })
  }
  validateCueCount(cues)
  return { cues, warnings }
}

function decodeVttEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, "\u00A0")
    .replace(/&lrm;/g, "\u200E")
    .replace(/&rlm;/g, "\u200F")
}

function normalizeVttPayload(value: string, line: number, warnings: CinemaSubtitleImportWarning[]) {
  const voice = /^<v(?:\.\S+)*\s+([^>]+)>([\s\S]*)$/i.exec(value.trim())
  const speaker = voice?.[1]?.trim()
  const payload = voice?.[2] ?? value
  const withoutMarkup = payload.replace(/<\/?(?:b|i|u|c(?:\.\S+)*|lang(?:\s+[^>]+)?|ruby|rt|v(?:\s+[^>]+)?)>/gi, "")
  if (withoutMarkup !== payload) {
    warnings.push({ code: "markup-normalized", message: "WebVTT inline markup was normalized to plain text", line })
  }
  return {
    text: decodeVttEntities(withoutMarkup),
    ...(speaker ? { speaker } : {}),
  }
}

export function parseCinemaWebVtt(input: string): CinemaSubtitleParseResult {
  assertInputSize(input)
  const lines = numberedLines(input)
  if (!/^WEBVTT(?:\s|$)/.test(lines[0]?.trim() ?? "")) {
    throw new CinemaSubtitleParseError("WebVTT files must start with WEBVTT", 1)
  }
  const cues: CinemaSubtitleCueInput[] = []
  const warnings: CinemaSubtitleImportWarning[] = []
  const ids = new Set<string>()
  let index = 1
  while (index < lines.length) {
    while (index < lines.length && !lines[index]?.trim()) index += 1
    if (index >= lines.length) break
    const blockLine = index + 1
    if (/^(NOTE|STYLE|REGION)(?:\s|$)/.test(lines[index]!.trim())) {
      warnings.push({
        code: "unsupported-vtt-block",
        message: `${lines[index]!.trim().split(/\s/, 1)[0]} blocks are not preserved by Cinema`,
        line: blockLine,
      })
      index += 1
      while (index < lines.length && lines[index]?.trim()) index += 1
      continue
    }
    let id: string | undefined
    if (!lines[index]!.includes("-->")) {
      id = lines[index]!.trim()
      if (ids.has(id)) throw new CinemaSubtitleParseError(`Duplicate cue id '${id}'`, blockLine)
      ids.add(id)
      index += 1
    }
    const timing = lines[index]
    if (!timing) throw new CinemaSubtitleParseError("Missing cue timing", index + 1)
    const parsed = parseTimingLine(timing, index + 1)
    if (parsed.settings) {
      warnings.push({
        code: "unsupported-vtt-settings",
        message: "Per-cue WebVTT positioning was normalized to the track style",
        line: index + 1,
      })
    }
    index += 1
    const payload: string[] = []
    while (index < lines.length && lines[index]?.trim()) {
      payload.push(lines[index]!)
      index += 1
    }
    const normalized = normalizeVttPayload(payload.join("\n"), blockLine, warnings)
    cues.push({
      ...(id ? { id } : {}),
      startUs: parsed.startUs,
      durationUs: parsed.durationUs,
      text: normalizeCueText(normalized.text, blockLine, warnings),
      ...(normalized.speaker ? { speaker: normalized.speaker } : {}),
    })
  }
  validateCueCount(cues)
  return { cues, warnings }
}

export function parseCinemaSubtitle(input: string, format: CinemaSubtitleFormat) {
  return format === "srt" ? parseCinemaSrt(input) : parseCinemaWebVtt(input)
}

function roundedCueMilliseconds(cue: CinemaSubtitleCueInput) {
  const startMs = Math.round(cue.startUs / 1_000)
  return { startMs, endMs: Math.max(startMs + 1, Math.round((cue.startUs + cue.durationUs) / 1_000)) }
}

function formatTimestamp(milliseconds: number, separator: "," | ".") {
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor(milliseconds / 60_000) % 60
  const seconds = Math.floor(milliseconds / 1_000) % 60
  const millis = milliseconds % 1_000
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${separator}${String(millis).padStart(3, "0")}`
}

export function serializeCinemaSrt(cues: readonly CinemaSubtitleCueInput[]) {
  const body = [...cues]
    .sort((left, right) => left.startUs - right.startUs)
    .map((cue, index) => {
      const time = roundedCueMilliseconds(cue)
      const text = cue.speaker ? `${cue.speaker}: ${cue.text}` : cue.text
      return `${index + 1}\r\n${formatTimestamp(time.startMs, ",")} --> ${formatTimestamp(time.endMs, ",")}\r\n${text.replace(/\r?\n/g, "\r\n")}`
    })
    .join("\r\n\r\n")
  return `\uFEFF${body}\r\n`
}

function escapeVttText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

export function serializeCinemaWebVtt(cues: readonly CinemaSubtitleCueInput[]) {
  const body = [...cues]
    .sort((left, right) => left.startUs - right.startUs)
    .map((cue, index) => {
      const time = roundedCueMilliseconds(cue)
      const text = escapeVttText(cue.text)
      const payload = cue.speaker ? `<v ${escapeVttText(cue.speaker)}>${text}` : text
      return `${cue.id ?? index + 1}\n${formatTimestamp(time.startMs, ".")} --> ${formatTimestamp(time.endMs, ".")}\n${payload}`
    })
    .join("\n\n")
  return `WEBVTT\n\n${body}\n`
}

export function serializeCinemaSubtitle(cues: readonly CinemaSubtitleCueInput[], format: CinemaSubtitleFormat) {
  return format === "srt" ? serializeCinemaSrt(cues) : serializeCinemaWebVtt(cues)
}
