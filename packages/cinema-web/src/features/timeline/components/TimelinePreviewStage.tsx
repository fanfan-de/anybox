import { useEffect, useMemo, useRef } from "react"
import { Maximize2, Pause, Play, SkipBack, StepBack, StepForward, Volume2, VolumeX } from "lucide-react"
import type { CinemaTimelineClip, CinemaTimelineDocument } from "@anybox/shared/cinema-timeline"
import { createAssetLibraryApi } from "../../assets/assetLibraryApi"
import { formatTimelineTime } from "../model/timelineTime"
import { timelineActiveClips, timelineNextVideoClip } from "../playback/timelineActiveClips"

function sourceURL(agentBaseURL: string, projectID: string, clip: CinemaTimelineClip | undefined) {
  if (!clip || clip.kind === "text") return undefined
  return createAssetLibraryApi(agentBaseURL, projectID, clip.assetRef.scope).assetPreviewURL(clip.assetRef.assetID)
}

export function timelineAudioFadeGain(clip: Extract<CinemaTimelineClip, { kind: "audio" }>, playheadUs: number) {
  const localTimeUs = Math.max(0, Math.min(clip.durationUs, playheadUs - clip.timelineStartUs))
  const fadeInGain = (clip.fadeInUs ?? 0) > 0 ? Math.min(1, localTimeUs / (clip.fadeInUs ?? 1)) : 1
  const remainingUs = clip.durationUs - localTimeUs
  const fadeOutGain = (clip.fadeOutUs ?? 0) > 0 ? Math.min(1, remainingUs / (clip.fadeOutUs ?? 1)) : 1
  return Math.max(0, Math.min(fadeInGain, fadeOutGain))
}

export function TimelinePreviewStage({
  agentBaseURL,
  projectID,
  timeline,
  playheadUs,
  playing,
  muted,
  onTogglePlaying,
  onToggleMuted,
  onSeek,
  onStepFrame,
}: {
  agentBaseURL: string
  projectID: string
  timeline: CinemaTimelineDocument
  playheadUs: number
  playing: boolean
  muted: boolean
  onTogglePlaying: () => void
  onToggleMuted: () => void
  onSeek: (timeUs: number) => void
  onStepFrame: (direction: -1 | 1) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const active = useMemo(() => timelineActiveClips(timeline, playheadUs), [playheadUs, timeline])
  const nextVideo = useMemo(() => timelineNextVideoClip(timeline, playheadUs), [playheadUs, timeline])
  const videoURL = sourceURL(agentBaseURL, projectID, active.video)
  const audioClip = active.audio[0]
  const audioURL = sourceURL(agentBaseURL, projectID, audioClip)
  const nextVideoURL = sourceURL(agentBaseURL, projectID, nextVideo)
  const durationUs = timeline.clips.reduce((duration, clip) => Math.max(duration, clip.timelineStartUs + clip.durationUs), 0)

  useEffect(() => {
    const video = videoRef.current
    const clip = active.video
    if (!video || !clip) return
    const desired = (clip.sourceInUs + (playheadUs - clip.timelineStartUs) * clip.playbackRate) / 1_000_000
    if (Math.abs(video.currentTime - desired) > 0.12) video.currentTime = Math.max(0, desired)
    video.playbackRate = clip.playbackRate
    video.volume = Math.min(1, clip.volume)
    video.muted = muted || timeline.tracks.find((track) => track.id === clip.trackID)?.muted === true
    if (playing) void video.play().catch(() => undefined)
    else video.pause()
  }, [active.video, muted, playheadUs, playing, timeline.tracks])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !audioClip) return
    const desired = (audioClip.sourceInUs + (playheadUs - audioClip.timelineStartUs) * audioClip.playbackRate) / 1_000_000
    if (Math.abs(audio.currentTime - desired) > 0.12) audio.currentTime = Math.max(0, desired)
    audio.playbackRate = audioClip.playbackRate
    audio.volume = Math.min(1, audioClip.volume * timelineAudioFadeGain(audioClip, playheadUs))
    audio.muted = muted || timeline.tracks.find((track) => track.id === audioClip.trackID)?.muted === true
    if (playing) void audio.play().catch(() => undefined)
    else audio.pause()
  }, [audioClip, muted, playheadUs, playing, timeline.tracks])

  return (
    <section className="cinema-timeline-preview" aria-label="Timeline preview">
      <div className="cinema-timeline-preview-stage">
        {videoURL ? <video ref={videoRef} key={videoURL} src={videoURL} playsInline preload="auto" /> : null}
        {active.overlays.map((clip) => clip.kind === "text" ? (
          <div key={clip.id} className="cinema-timeline-text-overlay" style={{ opacity: clip.opacity }}>{clip.text.value}</div>
        ) : clip.kind === "video" ? (
          <video key={clip.id} src={sourceURL(agentBaseURL, projectID, clip)} muted playsInline style={{ objectFit: clip.fit ?? "contain", opacity: clip.opacity }} />
        ) : (
          <img key={clip.id} src={sourceURL(agentBaseURL, projectID, clip)} alt="" style={{ objectFit: clip.fit ?? "contain", opacity: clip.opacity }} />
        ))}
        {!videoURL && active.overlays.length === 0 ? <p>{timeline.clips.length === 0 ? "Add the first asset to the Timeline" : "No active visual clip"}</p> : null}
        {audioURL ? <audio ref={audioRef} key={audioURL} src={audioURL} preload="auto" /> : null}
        {nextVideoURL ? <video className="cinema-timeline-preload-video" src={nextVideoURL} muted preload="auto" aria-hidden="true" /> : null}
      </div>
      <div className="cinema-timeline-transport">
        <span className="cinema-timeline-timecode">{formatTimelineTime(playheadUs)} / {formatTimelineTime(durationUs)}</span>
        <div className="cinema-timeline-transport-controls" role="group" aria-label="Playback controls">
          <button type="button" aria-label="Go to start" title="Go to start" onClick={() => onSeek(0)}><SkipBack aria-hidden="true" /></button>
          <button type="button" aria-label="Previous frame" title="Previous frame" onClick={() => onStepFrame(-1)}><StepBack aria-hidden="true" /></button>
          <button type="button" aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause" : "Play"} onClick={onTogglePlaying}>{playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</button>
          <button type="button" aria-label="Next frame" title="Next frame" onClick={() => onStepFrame(1)}><StepForward aria-hidden="true" /></button>
        </div>
        <div className="cinema-timeline-transport-actions">
          <button type="button" aria-label={muted ? "Unmute preview" : "Mute preview"} title={muted ? "Unmute preview" : "Mute preview"} aria-pressed={muted} onClick={onToggleMuted}>{muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}</button>
          <button type="button" aria-label="Fit preview" title="Fit preview"><Maximize2 aria-hidden="true" /></button>
        </div>
      </div>
    </section>
  )
}
