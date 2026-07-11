import type { CinemaRenderSettings } from "@anybox/shared/cinema-render"
import type {
  CinemaTimelineDocument,
  CinemaTimelineSubtitleCue,
  CinemaTimelineSubtitleStyle,
  CinemaTimelineSubtitleTrack,
} from "@anybox/shared/cinema-timeline"

function assTime(microseconds: number) {
  const centiseconds = Math.max(0, Math.round(microseconds / 10_000))
  const hours = Math.floor(centiseconds / 360_000)
  const minutes = Math.floor(centiseconds / 6_000) % 60
  const seconds = Math.floor(centiseconds / 100) % 60
  const fraction = centiseconds % 100
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(fraction).padStart(2, "0")}`
}

function assColor(rgba: string) {
  const match = /^#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})$/.exec(rgba)
  if (!match) throw new Error(`Invalid subtitle RGBA color '${rgba}'`)
  const [, red, green, blue, alpha] = match
  const assAlpha = (255 - Number.parseInt(alpha!, 16)).toString(16).padStart(2, "0")
  return `&H${assAlpha}${blue}${green}${red}`.toUpperCase()
}

export function escapeCinemaAssText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r\n?|\n/g, "\\N")
}

function alignmentValue(alignment: CinemaTimelineSubtitleStyle["alignment"]) {
  return alignment === "bottom-left" ? 1 : alignment === "bottom-right" ? 3 : 2
}

function scaled(value: number, scale: number) {
  return Math.max(0, Math.round(value * scale * 100) / 100)
}

export function generateCinemaSubtitleAss(input: {
  timeline: CinemaTimelineDocument
  settings: CinemaRenderSettings
  trackID: string
}) {
  const track = input.timeline.tracks.find((candidate): candidate is CinemaTimelineSubtitleTrack => candidate.kind === "subtitle" && candidate.id === input.trackID)
  if (!track || track.hidden) throw new Error("The selected subtitle track is unavailable or hidden")
  const cues = input.timeline.clips
    .filter((clip): clip is CinemaTimelineSubtitleCue => clip.kind === "subtitle" && clip.trackID === track.id)
    .sort((left, right) => left.timelineStartUs - right.timelineStartUs || left.id.localeCompare(right.id))
  if (cues.length === 0) throw new Error("The selected subtitle track is empty")
  const scale = input.settings.height / input.timeline.settings.height
  const style = track.style
  const borderStyle = style.backgroundColor.toUpperCase() === "#00000000" ? 1 : 3
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    `PlayResX: ${input.settings.width}`,
    `PlayResY: ${input.settings.height}`,
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Cinema,Noto Sans CJK SC,${scaled(style.fontSizePx, scale)},${assColor(style.textColor)},${assColor(style.textColor)},${assColor(style.outlineColor)},${assColor(style.backgroundColor)},0,0,0,0,100,100,0,0,${borderStyle},${scaled(style.outlineWidthPx, scale)},0,${alignmentValue(style.alignment)},${scaled(64, scale)},${scaled(64, scale)},${scaled(style.marginBottomPx, scale)},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ]
  const events = cues.map((cue) => {
    const endUs = Math.max(cue.timelineStartUs + 10_000, cue.timelineStartUs + cue.durationUs)
    const text = escapeCinemaAssText(`${cue.speaker ? `${cue.speaker}: ` : ""}${cue.cueText}`)
    return `Dialogue: 0,${assTime(cue.timelineStartUs)},${assTime(endUs)},Cinema,,0,0,0,,${text}`
  })
  return `${[...header, ...events].join("\n")}\n`
}

export const cinemaSubtitleAssInternals = { assColor, assTime, alignmentValue }
