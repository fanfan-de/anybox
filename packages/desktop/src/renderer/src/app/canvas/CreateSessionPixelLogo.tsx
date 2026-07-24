import { useEffect, useState } from "react"
import {
  boxBodyMask,
  catClosedEyesMask,
  catHeadTiltHalfMask,
  catHeadTiltMask,
  catOpenEyesMask,
  catTailWagLeftMask,
  catTailWagRightMask,
  closedFlapsMask,
  halfOpenFlapsMask,
  openFlapsMask,
  PIXEL_LOGO_SIZE,
  type PixelMask,
} from "./create-session-pixel-logo-masks"

const PIXEL_ROW_MASK = (1n << BigInt(PIXEL_LOGO_SIZE)) - 1n
const DOT_MATRIX_VIEWBOX_SIZE = 128
const DOT_MATRIX_PITCH = DOT_MATRIX_VIEWBOX_SIZE / PIXEL_LOGO_SIZE
const DOT_MATRIX_DOT_CENTER_OFFSET = 0.5
const DOT_MATRIX_DOT_DIAMETER = 1.6
const PIXEL_LOGO_IDLE_MS = 4_200
const PIXEL_LOGO_BLINK_MS = 120

export interface PixelLogoFrame {
  name: string
  path: string
  durationMs: number
}

export function shiftMask(mask: PixelMask, offsetY: number): PixelMask {
  if (!Number.isInteger(offsetY)) {
    throw new TypeError("Pixel mask offsets must be whole pixels.")
  }

  return Array.from({ length: PIXEL_LOGO_SIZE }, (_, y) => {
    const sourceY = y - offsetY
    return sourceY >= 0 && sourceY < PIXEL_LOGO_SIZE
      ? (mask[sourceY] ?? 0n) & PIXEL_ROW_MASK
      : 0n
  })
}

export function composeMasks(...masks: PixelMask[]): PixelMask {
  return Array.from({ length: PIXEL_LOGO_SIZE }, (_, y) => (
    masks.reduce((row, mask) => row | (mask[y] ?? 0n), 0n) & PIXEL_ROW_MASK
  ))
}

export function maskToSvgPath(mask: PixelMask): string {
  const path: string[] = []

  for (let y = 0; y < PIXEL_LOGO_SIZE; y += 1) {
    const row = (mask[y] ?? 0n) & PIXEL_ROW_MASK
    let x = 0

    while (x < PIXEL_LOGO_SIZE) {
      if ((row & (1n << BigInt(x))) === 0n) {
        x += 1
        continue
      }

      const startX = x
      while (x < PIXEL_LOGO_SIZE && (row & (1n << BigInt(x))) !== 0n) {
        x += 1
      }

      const width = x - startX
      path.push(`M${startX} ${y}h${width}v1h-${width}Z`)
    }
  }

  return path.join("")
}

export function maskToDotSvgPath(mask: PixelMask): string {
  const path: string[] = []

  for (let y = 0; y < PIXEL_LOGO_SIZE; y += 1) {
    const row = (mask[y] ?? 0n) & PIXEL_ROW_MASK

    for (let x = 0; x < PIXEL_LOGO_SIZE; x += 1) {
      if ((row & (1n << BigInt(x))) === 0n) continue

      const centerX = x * DOT_MATRIX_PITCH + DOT_MATRIX_DOT_CENTER_OFFSET
      const centerY = y * DOT_MATRIX_PITCH + DOT_MATRIX_DOT_CENTER_OFFSET
      path.push(`M${centerX} ${centerY}h.01`)
    }
  }

  return path.join("")
}

function createFrame(name: string, durationMs: number, ...masks: PixelMask[]): PixelLogoFrame {
  return {
    name,
    durationMs,
    path: maskToDotSvgPath(composeMasks(...masks)),
  }
}

const introFrames: readonly PixelLogoFrame[] = [
  createFrame("closed", 220, boxBodyMask, closedFlapsMask),
  createFrame("half-open", 110, boxBodyMask, halfOpenFlapsMask),
  createFrame("open", 110, boxBodyMask, openFlapsMask),
  createFrame("cat-rise-8", 100, boxBodyMask, openFlapsMask, shiftMask(catOpenEyesMask, 8)),
  createFrame("cat-rise-4", 100, boxBodyMask, openFlapsMask, shiftMask(catOpenEyesMask, 4)),
  createFrame("cat-rise-0", 90, boxBodyMask, openFlapsMask, catOpenEyesMask),
  createFrame("cat-overshoot", 80, boxBodyMask, openFlapsMask, shiftMask(catOpenEyesMask, -1)),
]

const idleFrame = createFrame("idle", PIXEL_LOGO_IDLE_MS, boxBodyMask, openFlapsMask, catOpenEyesMask)
const blinkFrame = createFrame("blink", PIXEL_LOGO_BLINK_MS, boxBodyMask, openFlapsMask, catClosedEyesMask)
const headTiltHalfFrame = createFrame("head-tilt-half", 90, boxBodyMask, openFlapsMask, catHeadTiltHalfMask)
const headTiltFrame = createFrame("head-tilt", 240, boxBodyMask, openFlapsMask, catHeadTiltMask)
const tailWagLeftFrame = createFrame("tail-wag-left", 100, boxBodyMask, openFlapsMask, catTailWagLeftMask)
const tailWagRightFrame = createFrame("tail-wag-right", 100, boxBodyMask, openFlapsMask, catTailWagRightMask)

const idleAnimationSequences: readonly (readonly PixelLogoFrame[])[] = [
  [blinkFrame],
  [headTiltHalfFrame, headTiltFrame, headTiltHalfFrame],
  [tailWagLeftFrame, tailWagRightFrame, tailWagLeftFrame, tailWagRightFrame],
]

function readPrefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(readPrefersReducedMotion)

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches)
    }

    mediaQuery.addEventListener("change", handleChange)
    return () => {
      mediaQuery.removeEventListener("change", handleChange)
    }
  }, [])

  return prefersReducedMotion
}

export function CreateSessionPixelLogo() {
  const prefersReducedMotion = usePrefersReducedMotion()
  const [frame, setFrame] = useState<PixelLogoFrame>(() => (
    prefersReducedMotion ? idleFrame : introFrames[0]
  ))

  useEffect(() => {
    if (prefersReducedMotion) {
      setFrame(idleFrame)
      return
    }

    let timer: number | null = null
    let isDisposed = false

    const clearTimer = () => {
      if (timer === null) return
      window.clearTimeout(timer)
      timer = null
    }

    const schedule = (callback: () => void, delayMs: number) => {
      clearTimer()
      timer = window.setTimeout(() => {
        timer = null
        if (!isDisposed && document.visibilityState === "visible") {
          callback()
        }
      }, delayMs)
    }

    function playFrameSequence(
      frames: readonly PixelLogoFrame[],
      index: number,
      onComplete: () => void,
    ) {
      const nextFrame = frames[index]
      if (!nextFrame) {
        onComplete()
        return
      }

      setFrame(nextFrame)
      schedule(() => playFrameSequence(frames, index + 1, onComplete), nextFrame.durationMs)
    }

    function showIdle() {
      setFrame(idleFrame)
      schedule(() => {
        const animationIndex = Math.floor(Math.random() * idleAnimationSequences.length)
        const animationFrames = idleAnimationSequences[animationIndex] ?? idleAnimationSequences[0]
        playFrameSequence(animationFrames, 0, showIdle)
      }, idleFrame.durationMs)
    }

    const handleVisibilityChange = () => {
      clearTimer()

      if (document.visibilityState === "visible") {
        showIdle()
      } else {
        setFrame(idleFrame)
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)

    if (document.visibilityState === "visible") {
      playFrameSequence(introFrames, 0, showIdle)
    } else {
      setFrame(idleFrame)
    }

    return () => {
      isDisposed = true
      clearTimer()
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [prefersReducedMotion])

  return (
    <span className="create-session-logo" role="img" aria-label="Anybox logo">
      <svg
        className="create-session-logo-svg"
        viewBox={`0 0 ${DOT_MATRIX_VIEWBOX_SIZE} ${DOT_MATRIX_VIEWBOX_SIZE}`}
        shapeRendering="geometricPrecision"
        aria-hidden="true"
      >
        <path
          d={frame.path}
          fill="none"
          stroke="currentColor"
          strokeWidth={DOT_MATRIX_DOT_DIAMETER}
          strokeLinecap="round"
        />
      </svg>
    </span>
  )
}
