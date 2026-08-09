import { useEffect, useRef } from "react"

type RoutePoint = readonly [number, number]

type PaperRoute = {
  accent: boolean
  offset: number
  points: readonly RoutePoint[]
}

const reduceMotionQuery = "(prefers-reduced-motion: reduce)"

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
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvasElement = canvasRef.current
    const containerElement = canvasElement?.closest<HTMLElement>(".home-hero")
    const canvasContext = canvasElement?.getContext("2d", { alpha: true })

    if (!canvasElement || !containerElement || !canvasContext) return

    const canvas = canvasElement
    const container = containerElement
    const context = canvasContext
    const mediaQuery = window.matchMedia(reduceMotionQuery)
    let animationFrame = 0
    let colors = readPaperColors(container)
    let height = 1
    let lastDraw = 0
    let width = 1

    function resizeCanvas() {
      const bounds = container.getBoundingClientRect()
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5)

      width = Math.max(1, bounds.width)
      height = Math.max(1, bounds.height)
      canvas.width = Math.floor(width * pixelRatio)
      canvas.height = Math.floor(height * pixelRatio)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      colors = readPaperColors(container)
    }

    function draw(time: number) {
      context.clearRect(0, 0, width, height)
      context.lineCap = "square"
      context.lineJoin = "round"

      for (const route of routes) {
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
          context.fillStyle = index === route.points.length - 1 && route.accent
            ? colors.accent
            : colors.node
          context.globalAlpha = index === 0 || index === route.points.length - 1 ? 0.78 : 0.42
          context.fillRect(x * width - 2, y * height - 2, 4, 4)
        })

        if (!mediaQuery.matches) {
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
      }

      context.globalAlpha = 1
    }

    function queueFrame() {
      if (animationFrame || mediaQuery.matches || document.hidden) return
      animationFrame = window.requestAnimationFrame(tick)
    }

    function tick(time: number) {
      animationFrame = 0

      if (time - lastDraw >= 48) {
        draw(time)
        lastDraw = time
      }

      queueFrame()
    }

    function renderCurrentState() {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame)
        animationFrame = 0
      }

      draw(performance.now())
      queueFrame()
    }

    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas()
      renderCurrentState()
    })

    resizeObserver.observe(container)
    document.addEventListener("visibilitychange", renderCurrentState)
    mediaQuery.addEventListener("change", renderCurrentState)
    resizeCanvas()
    renderCurrentState()

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      document.removeEventListener("visibilitychange", renderCurrentState)
      mediaQuery.removeEventListener("change", renderCurrentState)
    }
  }, [])

  return (
    <div className="paper-background" aria-hidden="true">
      <span className="paper-grid" />
      <canvas className="paper-canvas" ref={canvasRef} />
      <span className="paper-frame" />
      <span className="paper-fibers" />
    </div>
  )
}
