import { useEffect, useRef } from "react"

type RoutePoint = readonly [number, number]

type PaperRoute = {
  accent: boolean
  offset: number
  points: readonly RoutePoint[]
}

type PointerField = {
  strength: number
  targetStrength: number
  targetX: number
  targetY: number
  x: number
  y: number
}

const reduceMotionQuery = "(prefers-reduced-motion: reduce)"
const precisePointerQuery = "(hover: hover) and (pointer: fine)"

const routes: readonly PaperRoute[] = [
  {
    accent: false,
    offset: 0.08,
    points: [[0.02, 0.18], [0.18, 0.18], [0.18, 0.31], [0.33, 0.31]],
  },
  {
    accent: true,
    offset: 0.56,
    points: [[0.06, 0.68], [0.23, 0.68], [0.23, 0.8], [0.39, 0.8]],
  },
  {
    accent: false,
    offset: 0.34,
    points: [[0.67, 0.22], [0.83, 0.22], [0.83, 0.37], [0.98, 0.37]],
  },
  {
    accent: true,
    offset: 0.8,
    points: [[0.72, 0.76], [0.88, 0.76], [0.88, 0.59], [0.98, 0.59]],
  },
]

function readPaperColors(element: HTMLElement) {
  const styles = window.getComputedStyle(element)

  return {
    accent: styles.getPropertyValue("--hero-paper-accent").trim() || "rgba(199, 110, 47, 0.78)",
    line: styles.getPropertyValue("--hero-paper-line").trim() || "rgba(47, 111, 104, 0.18)",
    node: styles.getPropertyValue("--hero-paper-node").trim() || "rgba(47, 111, 104, 0.72)",
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

function easeToward(current: number, target: number, delta: number, duration: number) {
  if (delta <= 0) return current
  return current + (target - current) * (1 - Math.exp(-delta / duration))
}

function routeLengths(points: readonly RoutePoint[], width: number, height: number) {
  const lengths: number[] = []
  let total = 0

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    const segment = Math.hypot(
      (current[0] - previous[0]) * width,
      (current[1] - previous[1]) * height,
    )

    lengths.push(segment)
    total += segment
  }

  return { lengths, total }
}

function pointOnRoute(
  points: readonly RoutePoint[],
  progress: number,
  width: number,
  height: number,
) {
  const { lengths, total } = routeLengths(points, width, height)
  let remaining = progress * total

  for (let index = 0; index < lengths.length; index += 1) {
    const segment = lengths[index]

    if (remaining <= segment || index === lengths.length - 1) {
      const start = points[index]
      const end = points[index + 1]
      const ratio = segment === 0 ? 0 : Math.min(1, remaining / segment)

      return {
        x: (start[0] + (end[0] - start[0]) * ratio) * width,
        y: (start[1] + (end[1] - start[1]) * ratio) * height,
      }
    }

    remaining -= segment
  }

  const fallback = points[points.length - 1]
  return { x: fallback[0] * width, y: fallback[1] * height }
}

export function PaperBackground() {
  const backgroundRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const backgroundElement = backgroundRef.current
    const canvasElement = canvasRef.current
    const containerElement = canvasElement?.closest<HTMLElement>(".home-hero")
    const canvasContext = canvasElement?.getContext("2d", { alpha: true })

    if (!backgroundElement || !canvasElement || !containerElement || !canvasContext) return

    const background = backgroundElement
    const canvas = canvasElement
    const container = containerElement
    const context = canvasContext
    const motionQuery = window.matchMedia(reduceMotionQuery)
    const pointerQuery = window.matchMedia(precisePointerQuery)
    let animationFrame = 0
    let colors = readPaperColors(container)
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
      colors = readPaperColors(container)

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
      pointer.x = easeToward(pointer.x, pointer.targetX, delta, 90)
      pointer.y = easeToward(pointer.y, pointer.targetY, delta, 90)
      pointer.strength = easeToward(pointer.strength, pointer.targetStrength, delta, 170)

      const offsetX = -(pointer.x / width - 0.5) * 16 * pointer.strength
      const offsetY = -(pointer.y / height - 0.5) * 12 * pointer.strength

      background.style.setProperty("--paper-pointer-x", `${pointer.x.toFixed(1)}px`)
      background.style.setProperty("--paper-pointer-y", `${pointer.y.toFixed(1)}px`)
      background.style.setProperty("--paper-hover-opacity", pointer.strength.toFixed(3))
      background.style.setProperty("--paper-grid-x", `${(offsetX * 0.32).toFixed(2)}px`)
      background.style.setProperty("--paper-grid-y", `${(offsetY * 0.32).toFixed(2)}px`)

      return { offsetX, offsetY }
    }

    function draw(time: number, delta: number) {
      const isReducedMotion = motionQuery.matches
      const { offsetX, offsetY } = isReducedMotion
        ? { offsetX: 0, offsetY: 0 }
        : updatePointer(delta)
      const hoverRadius = clamp(Math.min(width, height) * 0.28, 150, 260)

      context.clearRect(0, 0, width, height)
      context.lineCap = "square"
      context.lineJoin = "round"

      routes.forEach((route, routeIndex) => {
        const depth = 0.68 + routeIndex * 0.12
        const routeOffsetX = offsetX * depth
        const routeOffsetY = offsetY * depth

        context.save()
        context.translate(routeOffsetX, routeOffsetY)
        context.beginPath()
        route.points.forEach(([x, y], index) => {
          if (index === 0) context.moveTo(x * width, y * height)
          else context.lineTo(x * width, y * height)
        })
        context.globalAlpha = 1
        context.lineWidth = 1
        context.strokeStyle = colors.line
        context.stroke()

        route.points.forEach(([x, y], index) => {
          const isAccentNode = index === route.points.length - 1 && route.accent
          const nodeColor = isAccentNode
            ? colors.accent
            : colors.node
          const distanceFromPointer = Math.hypot(
            x * width + routeOffsetX - pointer.x,
            y * height + routeOffsetY - pointer.y,
          )
          const proximity = isReducedMotion
            ? 0
            : Math.max(0, 1 - distanceFromPointer / hoverRadius) * pointer.strength

          if (proximity > 0) {
            context.fillStyle = nodeColor
            context.globalAlpha = proximity * 0.12
            context.beginPath()
            context.arc(x * width, y * height, 8 + proximity * 12, 0, Math.PI * 2)
            context.fill()
          }

          context.fillStyle = nodeColor
          context.globalAlpha = index === 0 || index === route.points.length - 1 ? 0.78 : 0.42
          context.fillRect(x * width - 2, y * height - 2, 4, 4)
        })

        if (!isReducedMotion) {
          const travel = (time / 12000 + route.offset) % 1
          const point = pointOnRoute(route.points, travel, width, height)

          context.fillStyle = route.accent ? colors.accent : colors.node
          context.globalAlpha = 0.16
          context.beginPath()
          context.arc(point.x, point.y, 9, 0, Math.PI * 2)
          context.fill()
          context.globalAlpha = 0.86
          context.beginPath()
          context.arc(point.x, point.y, 2.4, 0, Math.PI * 2)
          context.fill()
        }

        context.restore()
      })

      context.globalAlpha = 1
    }

    function queueFrame() {
      if (animationFrame || motionQuery.matches || document.hidden) return
      animationFrame = window.requestAnimationFrame(tick)
    }

    function tick(time: number) {
      animationFrame = 0

      if (time - lastDraw >= 32) {
        draw(time, Math.min(time - lastDraw || 16, 80))
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
    }

    function handlePointerLeave(event: PointerEvent) {
      if (event.pointerType !== "mouse") return
      pointer.targetStrength = 0
    }

    function handleInteractionPreferenceChange() {
      pointer.targetStrength = 0

      if (motionQuery.matches || !pointerQuery.matches) {
        pointer.strength = 0
        background.style.setProperty("--paper-hover-opacity", "0")
        background.style.setProperty("--paper-grid-x", "0px")
        background.style.setProperty("--paper-grid-y", "0px")
      }

      renderCurrentState()
    }

    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas()
      renderCurrentState()
    })

    resizeObserver.observe(container)
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
      document.removeEventListener("visibilitychange", renderCurrentState)
      container.removeEventListener("pointerenter", handlePointerEnter)
      container.removeEventListener("pointermove", handlePointerMove)
      container.removeEventListener("pointerleave", handlePointerLeave)
      motionQuery.removeEventListener("change", handleInteractionPreferenceChange)
      pointerQuery.removeEventListener("change", handleInteractionPreferenceChange)
    }
  }, [])

  return (
    <div className="paper-background" aria-hidden="true" ref={backgroundRef}>
      <span className="paper-grid" />
      <span className="paper-hover" />
      <canvas className="paper-canvas" ref={canvasRef} />
      <span className="paper-frame" />
      <span className="paper-fibers" />
    </div>
  )
}
