import type {
  CinemaTimelineClip,
  CinemaTimelineSubtitleCue,
  CinemaTimelineTextClip,
} from "@anybox/shared/cinema-timeline"

export type CinemaTimelineAssetClip = Exclude<CinemaTimelineClip, CinemaTimelineTextClip | CinemaTimelineSubtitleCue>
export type CinemaTimelineMediaClip = Exclude<CinemaTimelineClip, CinemaTimelineSubtitleCue>

export function isTimelineAssetClip(clip: CinemaTimelineClip): clip is CinemaTimelineAssetClip {
  return clip.kind !== "text" && clip.kind !== "subtitle"
}

export function isTimelineMediaClip(clip: CinemaTimelineClip): clip is CinemaTimelineMediaClip {
  return clip.kind !== "subtitle"
}

export function timelineClipDisplayName(clip: CinemaTimelineClip) {
  return clip.kind === "subtitle"
    ? clip.cueText.split(/\r?\n/, 1)[0]!.slice(0, 80)
    : clip.title
}
