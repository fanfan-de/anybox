import type {
  CinemaTimelineAudioClip,
  CinemaTimelineClip,
  CinemaTimelineDocument,
  CinemaTimelineVideoClip,
} from "@anybox/shared/cinema-timeline"

export function isTimelineClipActive(clip: CinemaTimelineClip, timeUs: number) {
  return timeUs >= clip.timelineStartUs && timeUs < clip.timelineStartUs + clip.durationUs
}

export function timelineActiveClips(document: CinemaTimelineDocument, timeUs: number) {
  const visibleTrackIDs = new Set(document.tracks.filter((track) => !track.hidden).map((track) => track.id))
  const active = document.clips.filter((clip) => visibleTrackIDs.has(clip.trackID) && isTimelineClipActive(clip, timeUs))
  return {
    video: active.find((clip): clip is CinemaTimelineVideoClip => clip.kind === "video" && document.tracks.find((track) => track.id === clip.trackID)?.kind === "video"),
    audio: active.filter((clip): clip is CinemaTimelineAudioClip => clip.kind === "audio"),
    overlays: active.filter((clip) => clip.kind === "image" || clip.kind === "text" || (
      clip.kind === "video" && document.tracks.find((track) => track.id === clip.trackID)?.kind === "overlay"
    )),
  }
}

export function timelineNextVideoClip(document: CinemaTimelineDocument, timeUs: number) {
  return document.clips
    .filter((clip) => clip.kind === "video" && clip.timelineStartUs > timeUs)
    .sort((left, right) => left.timelineStartUs - right.timelineStartUs)[0]
}
