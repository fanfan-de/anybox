import { useEffect, useRef } from "react"

type DotColors = {
  active: string
  base: string
}

type PointerField = {
  strength: number
  targetStrength: number
  targetX: number
  targetY: number
  x: number
  y: number
}

type ReactiveDot = {
  distance: number
  influence: number
  x: number
  y: number
}

const reduceMotionQuery = "(prefers-reduced-motion: reduce)"
const precisePointerQuery = "(hover: hover) and (pointer: fine)"

function readDotColors(element: HTMLElement): DotColors {
  const styles = window.getComputedStyle(element)

  return {
    active: styles.getPropertyValue("--hero-paper-dot-active").trim(),
    base: styles.getPropertyValue("--hero-paper-dot").trim(),
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

function easeToward(current: number, target: number, delta: number, duration: number) {
  if (delta <= 0) return current
  return current + (target - current) * (1 - Math.exp(-delta / duration))
}

function smoothstep(value: number) {
  return value * value * (3 - 2 * value)
}

function drawDotMatrix(
  context: CanvasRenderingContext2D,
  colors: DotColors,
  pointer: PointerField,
  width: number,
  height: number,
  time: number,
  isReducedMotion: boolean,
) {
  const spacing = width <= 640 ? 28 : 34
  const baseRadius = width <= 640 ? 0.85 : 1
  const hoverRadius = clamp(Math.min(width, height) * 0.3, 140, 220)
  const startX = (width % spacing) / 2
  const startY = (height % spacing) / 2
  const reactiveDots: ReactiveDot[] = []

  context.globalAlpha = 1
  context.fillStyle = colors.base
  context.beginPath()

  for (let y = startY, row = 0; y <= height; y += spacing, row += 1) {
    for (let x = startX, column = 0; x <= width; x += spacing, column += 1) {
      let dotX = x
      let dotY = y
      let distance = Number.POSITIVE_INFINITY
      let influence = 0

      if (!isReducedMotion && pointer.strength > 0) {
        const deltaX = x - pointer.x
        const deltaY = y - pointer.y
        distance = Math.hypot(deltaX, deltaY)

        if (distance < hoverRadius) {
          influence = smoothstep(1 - distance / hoverRadius) * pointer.strength

          if (distance > 0.01) {
            const displacement = influence * 14
            dotX += (deltaX / distance) * displacement
            dotY += (deltaY / distance) * displacement
          } else {
            const angle = column * 1.7 + row * 2.3
            dotX += Math.cos(angle) * influence * 14
            dotY += Math.sin(angle) * influence * 14
          }
        }
      }

      context.moveTo(dotX + baseRadius, dotY)
      context.arc(dotX, dotY, baseRadius, 0, Math.PI * 2)

      if (influence > 0.001) {
        reactiveDots.push({ distance, influence, x: dotX, y: dotY })
      }
    }
  }

  context.fill()
  context.fillStyle = colors.active

  for (const dot of reactiveDots) {
    const wave = 0.72 + Math.sin(time * 0.006 - dot.distance * 0.07) * 0.28
    const response = clamp(dot.influence * wave, 0, 1)

    context.globalAlpha = response
    context.beginPath()
    context.arc(dot.x, dot.y, baseRadius + response * 1.8, 0, Math.PI * 2)
    context.fill()
  }

  context.globalAlpha = 1
}

export function PaperBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvasElement = canvasRef.current
    const containerElement = canvasElement?.closest<HTMLElement>(".home-hero")
    const canvasContext = canvasElement?.getContext("2d", { alpha: true })

    if (!canvasElement || !containerElement || !canvasContext) return

    const canvas = canvasElement
    const container = containerElement
    const context = canvasContext
    const motionQuery = window.matchMedia(reduceMotionQuery)
    const pointerQuery = window.matchMedia(precisePointerQuery)
    let animationFrame = 0
    let colors = readDotColors(container)
    let height = 1
    let lastDraw = 0
    const pointer: PointerField = {
      strength: 0,
      targetStrength: 0,
      targetX: 0,
      targetY: 0,
      x: 0,
      y: 0,
    }
    let width = 1

    function resizeCanvas() {
      const bounds = container.getBoundingClientRect()
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5)
      const previousWidth = width
      const previousHeight = height

      width = Math.max(1, bounds.width)
      height = Math.max(1, bounds.height)
      canvas.width = Math.floor(width * pixelRatio)
      canvas.height = Math.floor(height * pixelRatio)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      colors = readDotColors(container)

      if (previousWidth <= 1 && previousHeight <= 1) {
        pointer.x = width / 2
        pointer.y = height / 2
        pointer.targetX = pointer.x
        pointer.targetY = pointer.y
      } else {
        pointer.x = clamp((pointer.x / previousWidth) * width, 0, width)
        pointer.y = clamp((pointer.y / previousHeight) * height, 0, height)
        pointer.targetX = clamp((pointer.targetX / previousWidth) * width, 0, width)
        pointer.targetY = clamp((pointer.targetY / previousHeight) * height, 0, height)
      }
    }

    function updatePointer(delta: number) {
      pointer.x = easeToward(pointer.x, pointer.targetX, delta, 75)
      pointer.y = easeToward(pointer.y, pointer.targetY, delta, 75)
      pointer.strength = easeToward(pointer.strength, pointer.targetStrength, delta, 140)

      if (pointer.targetStrength === 0 && pointer.strength < 0.002) {
        pointer.strength = 0
      }
    }

    function draw(time: number, delta: number) {
      const isReducedMotion = motionQuery.matches

      if (!isReducedMotion) updatePointer(delta)

      context.clearRect(0, 0, width, height)
      drawDotMatrix(context, colors, pointer, width, height, time, isReducedMotion)
    }

    function queueFrame() {
      const isInteracting = pointer.targetStrength > 0 || pointer.strength > 0

      if (animationFrame || motionQuery.matches || document.hidden || !isInteracting) return
      animationFrame = window.requestAnimationFrame(tick)
    }

    function tick(time: number) {
      animationFrame = 0

      if (time - lastDraw >= 24) {
        draw(time, Math.min(time - lastDraw || 16, 64))
        lastDraw = time
      }

      queueFrame()
    }

    function renderCurrentState() {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame)
        animationFrame = 0
      }

      const time = performance.now()
      lastDraw = time
      draw(time, 0)
      queueFrame()
    }

    function canTrackPointer(event: PointerEvent) {
      return event.pointerType === "mouse" && pointerQuery.matches && !motionQuery.matches
    }

    function updatePointerTarget(event: PointerEvent) {
      const bounds = container.getBoundingClientRect()

      pointer.targetX = clamp(event.clientX - bounds.left, 0, width)
      pointer.targetY = clamp(event.clientY - bounds.top, 0, height)
    }

    function handlePointerEnter(event: PointerEvent) {
      if (!canTrackPointer(event)) return
      updatePointerTarget(event)
      pointer.targetStrength = 1
      queueFrame()
    }

    function handlePointerMove(event: PointerEvent) {
      if (!canTrackPointer(event)) return
      updatePointerTarget(event)
      pointer.targetStrength = 1
      queueFrame()
    }

    function handlePointerLeave(event: PointerEvent) {
      if (event.pointerType !== "mouse") return
      pointer.targetStrength = 0
      queueFrame()
    }

    function handleInteractionPreferenceChange() {
      pointer.strength = 0
      pointer.targetStrength = 0
      renderCurrentState()
    }

    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas()
      renderCurrentState()
    })
    const themeObserver = new MutationObserver(() => {
      colors = readDotColors(container)
      renderCurrentState()
    })

    resizeObserver.observe(container)
    themeObserver.observe(document.documentElement, {
      attributeFilter: ["data-theme"],
      attributes: true,
    })
    document.addEventListener("visibilitychange", renderCurrentState)
    container.addEventListener("pointerenter", handlePointerEnter)
    container.addEventListener("pointermove", handlePointerMove)
    container.addEventListener("pointerleave", handlePointerLeave)
    motionQuery.addEventListener("change", handleInteractionPreferenceChange)
    pointerQuery.addEventListener("change", handleInteractionPreferenceChange)
    resizeCanvas()
    renderCurrentState()

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      themeObserver.disconnect()
      document.removeEventListener("visibilitychange", renderCurrentState)
      container.removeEventListener("pointerenter", handlePointerEnter)
      container.removeEventListener("pointermove", handlePointerMove)
      container.removeEventListener("pointerleave", handlePointerLeave)
      motionQuery.removeEventListener("change", handleInteractionPreferenceChange)
      pointerQuery.removeEventListener("change", handleInteractionPreferenceChange)
    }
  }, [])

  return (
    <div className="paper-background" aria-hidden="true">
      <canvas className="paper-dot-canvas" ref={canvasRef} />
      <span className="paper-frame" />
      <span className="paper-fibers" />
    </div>
  )
}
