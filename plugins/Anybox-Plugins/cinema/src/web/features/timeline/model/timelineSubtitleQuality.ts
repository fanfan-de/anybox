import type { CinemaTimelineDocument, CinemaTimelineSubtitleCue } from "@anybox/cinema-plugin/contracts/timeline"

export type TimelineSubtitleQualityIssue = {
  code: "overlap" | "too-short" | "too-long" | "tight-gap" | "unsupported-script"
  cueID: string
  message: string
}

function guaranteedSubtitleCharacters(value: string) {
  return /^[\u0000-\u024F\u2000-\u206F\u3000-\u30FF\u3400-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\s]*$/.test(value)
}

export function timelineSubtitleQualityIssues(document: CinemaTimelineDocument, trackID?: string) {
  const subtitleTrackIDs = new Set(document.tracks
    .filter((track) => track.kind === "subtitle" && (!trackID || track.id === trackID))
    .map((track) => track.id))
  const issues: TimelineSubtitleQualityIssue[] = []
  for (const targetTrackID of subtitleTrackIDs) {
    const cues = document.clips
      .filter((clip): clip is CinemaTimelineSubtitleCue => clip.kind === "subtitle" && clip.trackID === targetTrackID)
      .sort((left, right) => left.timelineStartUs - right.timelineStartUs || left.id.localeCompare(right.id))
    cues.forEach((cue, index) => {
      const previous = cues[index - 1]
      if (previous && cue.timelineStartUs < previous.timelineStartUs + previous.durationUs) {
        issues.push({ code: "overlap", cueID: cue.id, message: "This subtitle overlaps the previous cue." })
      } else if (previous && cue.timelineStartUs - (previous.timelineStartUs + previous.durationUs) < 80_000) {
        issues.push({ code: "tight-gap", cueID: cue.id, message: "The gap before this subtitle is under 80 ms." })
      }
      if (cue.durationUs < 500_000) issues.push({ code: "too-short", cueID: cue.id, message: "This subtitle is shorter than 500 ms." })
      const lines = cue.cueText.split(/\r?\n/)
      if (lines.length > 2 || lines.some((line) => line.length > 42)) {
        issues.push({ code: "too-long", cueID: cue.id, message: "This subtitle may wrap beyond two readable lines." })
      }
      if (!guaranteedSubtitleCharacters(cue.cueText)) {
        issues.push({ code: "unsupported-script", cueID: cue.id, message: "This subtitle contains characters outside the guaranteed CJK/Latin font coverage." })
      }
    })
  }
  return issues
}
