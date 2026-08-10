import type {
  CinemaTimelineAudioClip,
  CinemaTimelineClip,
  CinemaTimelineDocument,
  CinemaTimelineImageClip,
  CinemaTimelineSubtitleCue,
  CinemaTimelineTextClip,
  CinemaTimelineVideoClip,
} from "@anybox/cinema-plugin/contracts/timeline"

export function isTimelineClipActive(clip: CinemaTimelineClip, timeUs: number) {
  return timeUs >= clip.timelineStartUs && timeUs < clip.timelineStartUs + clip.durationUs
}

export function timelineActiveClips(document: CinemaTimelineDocument, timeUs: number) {
  const visibleTrackIDs = new Set(document.tracks.filter((track) => !track.hidden).map((track) => track.id))
  const active = document.clips.filter((clip) => visibleTrackIDs.has(clip.trackID) && isTimelineClipActive(clip, timeUs))
  const trackOrder = new Map(document.tracks.map((track) => [track.id, track.order]))
  const topFirst = [...active].sort((left, right) => (
    (trackOrder.get(left.trackID) ?? Number.MAX_SAFE_INTEGER)
    - (trackOrder.get(right.trackID) ?? Number.MAX_SAFE_INTEGER)
  ))
  return {
    video: topFirst.find((clip): clip is CinemaTimelineVideoClip => clip.kind === "video" && document.tracks.find((track) => track.id === clip.trackID)?.kind === "video"),
    audio: topFirst.filter((clip): clip is CinemaTimelineAudioClip => clip.kind === "audio"),
    overlays: topFirst.filter((clip): clip is CinemaTimelineImageClip | CinemaTimelineTextClip | CinemaTimelineVideoClip => clip.kind === "image" || clip.kind === "text" || (
      clip.kind === "video" && document.tracks.find((track) => track.id === clip.trackID)?.kind === "overlay"
    )).reverse(),
    subtitles: topFirst.filter((clip): clip is CinemaTimelineSubtitleCue => clip.kind === "subtitle"),
  }
}

export function timelineNextVideoClip(document: CinemaTimelineDocument, timeUs: number) {
  const visibleTrackIDs = new Set(document.tracks.filter((track) => !track.hidden).map((track) => track.id))
  return document.clips
    .filter((clip) => clip.kind === "video" && visibleTrackIDs.has(clip.trackID) && clip.timelineStartUs > timeUs)
    .sort((left, right) => left.timelineStartUs - right.timelineStartUs)[0]
}

export function timelinePreviousVideoClip(document: CinemaTimelineDocument, timeUs: number) {
  const visibleTrackIDs = new Set(document.tracks.filter((track) => !track.hidden).map((track) => track.id))
  return document.clips
    .filter((clip) => clip.kind === "video" && visibleTrackIDs.has(clip.trackID) && clip.timelineStartUs + clip.durationUs <= timeUs)
    .sort((left, right) => (
      right.timelineStartUs + right.durationUs
      - (left.timelineStartUs + left.durationUs)
    ))[0]
}
