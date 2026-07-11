import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react"
import { Pause, Play, SkipBack, StepBack, StepForward, Volume2, VolumeX } from "lucide-react"
import type { CinemaAssetStatus } from "@anybox/shared"
import type {
  CinemaTimelineClip,
  CinemaTimelineDocument,
  CinemaTimelineImageClip,
  CinemaTimelineTextClip,
  CinemaTimelineVideoClip,
} from "@anybox/shared/cinema-timeline"
import { createAssetLibraryApi } from "../../assets/assetLibraryApi"
import { formatTimelineTime } from "../model/timelineTime"
import { timelineActiveClips, timelineNextVideoClip, timelinePreviousVideoClip } from "../playback/timelineActiveClips"
import { useI18n } from "../../../i18n"

function sourceURL(agentBaseURL: string, projectID: string, clip: CinemaTimelineClip | undefined) {
  if (!clip || clip.kind === "text") return undefined
  return createAssetLibraryApi(agentBaseURL, projectID, clip.assetRef.scope).assetPreviewURL(clip.assetRef.assetID)
}

function mediaKey(clip: CinemaTimelineClip | undefined) {
  return !clip || clip.kind === "text"
    ? null
    : `${clip.assetRef.assetID}:${clip.assetRef.contentRevision}`
}

function unavailableAssetStatus(status: CinemaAssetStatus | "unresolved" | undefined) {
  return status !== undefined && status !== "ready" && status !== "unresolved"
}

type CinemaTimelineVisualClip = CinemaTimelineVideoClip | CinemaTimelineImageClip | CinemaTimelineTextClip

export function timelinePreviewVisualStyle(
  clip: CinemaTimelineVisualClip,
  settings: CinemaTimelineDocument["settings"],
): CSSProperties {
  const transform = clip.transform ?? {
    x: 0,
    y: 0,
    scale: 1,
    rotationDegrees: 0,
    anchorX: 0.5,
    anchorY: 0.5,
  }
  return {
    opacity: clip.opacity,
    ...(clip.kind !== "text" ? { objectFit: clip.fit === "stretch" ? "fill" : clip.fit ?? "contain" } : {}),
    transformOrigin: `${transform.anchorX * 100}% ${transform.anchorY * 100}%`,
    transform: `translate(${transform.x / settings.width * 100}%, ${transform.y / settings.height * 100}%) scale(${transform.scale}) rotate(${transform.rotationDegrees}deg)`,
  }
}

function useCoalescedMediaSeek(
  mediaRef: RefObject<HTMLMediaElement | null>,
  desiredSeconds: number | null,
  playing: boolean,
) {
  const latestRef = useRef({ desiredSeconds, playing })
  const frameRef = useRef(0)
  latestRef.current = { desiredSeconds, playing }
  useEffect(() => {
    if (desiredSeconds === null || frameRef.current !== 0) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = 0
      const media = mediaRef.current
      const latest = latestRef.current
      if (!media || latest.desiredSeconds === null) return
      const tolerance = latest.playing ? 0.25 : 0.03
      if (Math.abs(media.currentTime - latest.desiredSeconds) <= tolerance) return
      try {
        media.currentTime = Math.max(0, latest.desiredSeconds)
      } catch {
        // A source can be between attachment and metadata readiness. The next frame retries latest state.
      }
    })
  }, [desiredSeconds, mediaRef, playing])
  useEffect(() => () => window.cancelAnimationFrame(frameRef.current), [])
}

function TimelineVideoOverlay({
  agentBaseURL,
  projectID,
  clip,
  playheadUs,
  playing,
  playbackDirection,
  onError,
  style,
}: {
  agentBaseURL: string
  projectID: string
  clip: CinemaTimelineVideoClip
  playheadUs: number
  playing: boolean
  playbackDirection: -1 | 1
  onError: () => void
  style: CSSProperties
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const desiredSeconds = (clip.sourceInUs + (playheadUs - clip.timelineStartUs) * clip.playbackRate) / 1_000_000
  useCoalescedMediaSeek(videoRef, desiredSeconds, playing)
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.playbackRate = clip.playbackRate
    if (playing && playbackDirection > 0) void video.play().catch(() => undefined)
    else video.pause()
  }, [clip.playbackRate, playbackDirection, playing])
  return (
    <video
      ref={videoRef}
      src={sourceURL(agentBaseURL, projectID, clip)}
      muted
      playsInline
      preload="auto"
      onError={onError}
      style={style}
    />
  )
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
  playbackDirection,
  muted,
  assetStatuses,
  onTogglePlaying,
  onToggleMuted,
  onSeek,
  onStepFrame,
  onBrowseAssets,
}: {
  agentBaseURL: string
  projectID: string
  timeline: CinemaTimelineDocument
  playheadUs: number
  playing: boolean
  playbackDirection: -1 | 1
  muted: boolean
  assetStatuses: ReadonlyMap<string, CinemaAssetStatus | "unresolved">
  onTogglePlaying: () => void
  onToggleMuted: () => void
  onSeek: (timeUs: number) => void
  onStepFrame: (direction: -1 | 1) => void
  onBrowseAssets: () => void
}) {
  const { t } = useI18n()
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [failedMediaKeys, setFailedMediaKeys] = useState<ReadonlySet<string>>(() => new Set())
  const active = useMemo(() => timelineActiveClips(timeline, playheadUs), [playheadUs, timeline])
  const nextVideo = useMemo(() => timelineNextVideoClip(timeline, playheadUs), [playheadUs, timeline])
  const previousVideo = useMemo(() => timelinePreviousVideoClip(timeline, playheadUs), [playheadUs, timeline])
  const availableClip = (clip: CinemaTimelineClip | undefined) => {
    if (!clip || clip.kind === "text") return clip
    const key = mediaKey(clip)
    return unavailableAssetStatus(assetStatuses.get(clip.assetRef.assetID)) || (key !== null && failedMediaKeys.has(key))
      ? undefined
      : clip
  }
  const videoClip = availableClip(active.video) as typeof active.video
  const videoURL = sourceURL(agentBaseURL, projectID, videoClip)
  const audioClip = availableClip(active.audio[0]) as typeof active.audio[0]
  const audioURL = sourceURL(agentBaseURL, projectID, audioClip)
  const nextVideoURL = sourceURL(agentBaseURL, projectID, availableClip(nextVideo))
  const previousVideoURL = sourceURL(agentBaseURL, projectID, availableClip(previousVideo))
  const availableOverlays = active.overlays.filter((clip) => availableClip(clip) !== undefined)
  const unavailableVisual = Boolean(active.video && !videoClip)
    || active.overlays.some((clip) => availableClip(clip) === undefined)
  const durationUs = timeline.clips.reduce((duration, clip) => Math.max(duration, clip.timelineStartUs + clip.durationUs), 0)
  const failMedia = (clip: CinemaTimelineClip | undefined) => {
    const key = mediaKey(clip)
    if (!key) return
    setFailedMediaKeys((current) => new Set(current).add(key))
  }

  const videoDesiredSeconds = videoClip
    ? (videoClip.sourceInUs + (playheadUs - videoClip.timelineStartUs) * videoClip.playbackRate) / 1_000_000
    : null
  const audioDesiredSeconds = audioClip
    ? (audioClip.sourceInUs + (playheadUs - audioClip.timelineStartUs) * audioClip.playbackRate) / 1_000_000
    : null
  useCoalescedMediaSeek(videoRef, videoDesiredSeconds, playing)
  useCoalescedMediaSeek(audioRef, audioDesiredSeconds, playing)

  useEffect(() => {
    const video = videoRef.current
    const clip = videoClip
    if (!video || !clip) return
    video.playbackRate = clip.playbackRate
    video.volume = Math.min(1, clip.volume)
    video.muted = muted || timeline.tracks.find((track) => track.id === clip.trackID)?.muted === true
    if (playing && playbackDirection > 0) void video.play().catch(() => undefined)
    else video.pause()
  }, [muted, playbackDirection, playing, timeline.tracks, videoClip])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !audioClip) return
    audio.playbackRate = audioClip.playbackRate
    audio.volume = Math.min(1, audioClip.volume * timelineAudioFadeGain(audioClip, playheadUs))
    audio.muted = muted || timeline.tracks.find((track) => track.id === audioClip.trackID)?.muted === true
    if (playing && playbackDirection > 0) void audio.play().catch(() => undefined)
    else audio.pause()
  }, [audioClip, muted, playbackDirection, playing, timeline.tracks])

  return (
    <section className="cinema-timeline-preview" aria-label={t("timeline.preview")}>
      <div className="cinema-timeline-preview-stage">
        {videoURL ? <video ref={videoRef} key={videoURL} src={videoURL} playsInline preload="auto" onError={() => failMedia(videoClip)} style={timelinePreviewVisualStyle(videoClip!, timeline.settings)} /> : null}
        {availableOverlays.map((clip) => clip.kind === "text" ? (
          <div key={clip.id} className="cinema-timeline-text-overlay" style={timelinePreviewVisualStyle(clip, timeline.settings)}><span>{clip.text.value}</span></div>
        ) : clip.kind === "video" ? (
          <TimelineVideoOverlay
            key={clip.id}
            agentBaseURL={agentBaseURL}
            projectID={projectID}
            clip={clip}
            playheadUs={playheadUs}
            playing={playing}
            playbackDirection={playbackDirection}
            onError={() => failMedia(clip)}
            style={timelinePreviewVisualStyle(clip, timeline.settings)}
          />
        ) : (
          <img key={clip.id} src={sourceURL(agentBaseURL, projectID, clip)} alt="" onError={() => failMedia(clip)} style={timelinePreviewVisualStyle(clip, timeline.settings)} />
        ))}
        {unavailableVisual ? <p className="cinema-timeline-preview-status" role="status">{t("timeline.previewUnavailable")}</p> : null}
        {!videoURL && availableOverlays.length === 0 && !unavailableVisual ? timeline.clips.length === 0 ? (
          <div className="cinema-timeline-preview-empty">
            <h2>{t("timeline.addMediaTitle")}</h2>
            <p>{t("timeline.addMediaDescription")}</p>
            <button type="button" className="cinema-edit-primary-button" onClick={onBrowseAssets}>{t("timeline.browseAssets")}</button>
          </div>
        ) : <p>{t("timeline.noActiveVisual")}</p> : null}
        {audioURL ? <audio ref={audioRef} key={audioURL} src={audioURL} preload="auto" onError={() => failMedia(audioClip)} /> : null}
        {previousVideoURL ? <video className="cinema-timeline-preload-video" src={previousVideoURL} muted preload="metadata" aria-hidden="true" /> : null}
        {nextVideoURL ? <video className="cinema-timeline-preload-video" src={nextVideoURL} muted preload="auto" aria-hidden="true" /> : null}
      </div>
      <div className="cinema-timeline-transport">
        <span className="cinema-timeline-timecode">{formatTimelineTime(playheadUs)} / {formatTimelineTime(durationUs)}</span>
        <div className="cinema-timeline-transport-controls" role="group" aria-label={t("timeline.playbackControls")}>
          <button type="button" aria-label={t("timeline.goToStart")} title={`${t("timeline.goToStart")} · Home`} onClick={() => onSeek(0)}><SkipBack aria-hidden="true" /></button>
          <button type="button" aria-label={t("timeline.previousFrame")} title={`${t("timeline.previousFrame")} · ←`} onClick={() => onStepFrame(-1)}><StepBack aria-hidden="true" /></button>
          <button type="button" aria-label={t(playing ? "timeline.pause" : "timeline.play")} title={`${t(playing ? "timeline.pause" : "timeline.play")} · Space`} onClick={onTogglePlaying}>{playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</button>
          <button type="button" aria-label={t("timeline.nextFrame")} title={`${t("timeline.nextFrame")} · →`} onClick={() => onStepFrame(1)}><StepForward aria-hidden="true" /></button>
        </div>
        <div className="cinema-timeline-transport-actions">
          <button type="button" aria-label={t(muted ? "timeline.unmute" : "timeline.mute")} title={t(muted ? "timeline.unmute" : "timeline.mute")} aria-pressed={muted} onClick={onToggleMuted}>{muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}</button>
        </div>
      </div>
    </section>
  )
}
