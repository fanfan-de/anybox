import { useEffect, useId, useRef } from "react"
import { createPortal } from "react-dom"
import type { CinemaTimelineTrack } from "@anybox/cinema-plugin/contracts/timeline"
import { useI18n } from "../../../i18n"

export type TimelineTrackDeleteRequest = {
  track: CinemaTimelineTrack
  clipCount: number
  returnFocus: HTMLElement
}

export function TimelineTrackDeleteDialog({
  request,
  onCancel,
  onConfirm,
}: {
  request: TimelineTrackDeleteRequest | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t } = useI18n()
  const descriptionID = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel

  useEffect(() => {
    if (!request) return
    const frame = window.requestAnimationFrame(() => cancelRef.current?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      onCancelRef.current()
    }
    document.addEventListener("keydown", onKeyDown, true)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener("keydown", onKeyDown, true)
      request.returnFocus.focus()
    }
  }, [request])

  if (!request) return null
  const hasClips = request.clipCount > 0
  return createPortal(
    <div
      className="cinema-dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <section
        ref={dialogRef}
        className="cinema-confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${descriptionID}-title`}
        aria-describedby={descriptionID}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return
          const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])]
          if (controls.length === 0) return
          const currentIndex = controls.indexOf(document.activeElement as HTMLElement)
          const nextIndex = event.shiftKey
            ? (currentIndex - 1 + controls.length) % controls.length
            : (currentIndex + 1 + controls.length) % controls.length
          event.preventDefault()
          controls[nextIndex]?.focus()
        }}
      >
        <h2 id={`${descriptionID}-title`}>{t("timeline.deleteTrackTitle", { name: request.track.title })}</h2>
        <p id={descriptionID}>
          {t(hasClips ? "timeline.deleteTrackWithClipsDescription" : "timeline.deleteEmptyTrackDescription", {
            count: request.clipCount,
          })}
        </p>
        <div className="cinema-confirm-dialog-actions">
          <button ref={cancelRef} type="button" className="cinema-edit-secondary-button" onClick={onCancel}>
            {t("timeline.cancel")}
          </button>
          <button type="button" className="cinema-edit-danger-button" onClick={onConfirm}>
            {t(hasClips ? "timeline.deleteTrackAndClips" : "timeline.deleteTrack")}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
