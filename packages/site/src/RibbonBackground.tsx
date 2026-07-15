import { useEffect, useRef } from "react"

type RibbonStrand = {
  color: string
  offset: number
  phase: number
  speed: number
  width: number
}

const reduceMotionQuery = "(prefers-reduced-motion: reduce)"

function readRibbonStyles(element: HTMLElement) {
  const styles = window.getComputedStyle(element)

  return {
    defaultColor: styles.getPropertyValue("--hero-stage-text").trim(),
    glowStops: [
      styles.getPropertyValue("--hero-ribbon-glow-cyan").trim(),
      styles.getPropertyValue("--hero-ribbon-glow-blue").trim(),
      styles.getPropertyValue("--hero-ribbon-glow-clear").trim(),
      styles.getPropertyValue("--hero-ribbon-glow-clear").trim(),
    ],
    palette: [
      styles.getPropertyValue("--hero-ribbon-cyan").trim(),
      styles.getPropertyValue("--hero-ribbon-blue").trim(),
    ].filter(Boolean),
  }
}

export function RibbonBackground() {
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
    let glowStops = ["transparent", "transparent", "transparent", "transparent"]
    let animationFrame = 0
    let height = 1
    let strands: RibbonStrand[] = []
    let width = 1

    function createStrands() {
      const ribbonStyles = readRibbonStyles(container)
      const { defaultColor, palette } = ribbonStyles
      const count = Math.max(14, Math.min(24, Math.floor(width / 58)))

      glowStops = ribbonStyles.glowStops
      strands = Array.from({ length: count }, (_, index) => ({
        color: palette[index % palette.length] ?? defaultColor,
        offset: (index / Math.max(1, count - 1) - 0.5) * Math.min(height * 0.68, 520),
        phase: index * 0.56,
        speed: 0.0003 + (index % 5) * 0.000025,
        width: 0.65 + (index % 4) * 0.22,
      }))
    }

    function resizeCanvas() {
      const bounds = container.getBoundingClientRect()
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)

      width = Math.max(1, bounds.width)
      height = Math.max(1, bounds.height)
      canvas.width = Math.floor(width * pixelRatio)
      canvas.height = Math.floor(height * pixelRatio)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      createStrands()
    }

    function ribbonPoint(strand: RibbonStrand, step: number, time: number) {
      const progress = step / 90
      const x = -width * 0.08 + progress * width * 1.16
      const centerX = width * 0.5
      const centerY = height * 0.48
      const pull = 1 - Math.min(1, Math.abs(progress - 0.5) * 2)
      const wave = Math.sin(progress * Math.PI * 3 + time * strand.speed + strand.phase) * (24 + pull * 24)
      const orbit = Math.sin(progress * Math.PI + strand.phase) * 38 * pull
      const y = centerY + strand.offset * (0.28 + Math.abs(progress - 0.5) * 1.35) + wave + orbit
      const bendX = centerX + (x - centerX) * (0.84 + 0.16 * Math.cos(pull * Math.PI))

      return { x: bendX, y, pull }
    }

    function drawBackground() {
      const glow = context.createRadialGradient(
        width * 0.5,
        height * 0.5,
        0,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.62,
      )

      glow.addColorStop(0, glowStops[0])
      glow.addColorStop(0.22, glowStops[1])
      glow.addColorStop(0.54, glowStops[2])
      glow.addColorStop(1, glowStops[3])
      context.fillStyle = glow
      context.fillRect(0, 0, width, height)
    }

    function draw(time: number) {
      context.clearRect(0, 0, width, height)
      drawBackground()
      context.globalCompositeOperation = "lighter"

      for (const strand of strands) {
        context.beginPath()
        for (let step = 0; step <= 90; step += 1) {
          const point = ribbonPoint(strand, step, time)
          if (step === 0) context.moveTo(point.x, point.y)
          else context.lineTo(point.x, point.y)
        }

        context.globalAlpha = 0.09
        context.strokeStyle = strand.color
        context.lineWidth = strand.width * 3.8
        context.shadowColor = strand.color
        context.shadowBlur = 14
        context.stroke()

        context.globalAlpha = 0.44
        context.lineWidth = strand.width
        context.shadowBlur = 6
        context.stroke()
      }

      for (const strand of strands) {
        for (let particleIndex = 0; particleIndex < 1; particleIndex += 1) {
          const travel = (time * strand.speed * 0.14 + strand.phase + particleIndex * 0.33) % 1
          const point = ribbonPoint(strand, travel * 90, time)
          const size = 0.8 + point.pull * 2.2

          context.fillStyle = strand.color
          context.globalAlpha = 0.12 + point.pull * 0.3
          context.beginPath()
          context.arc(point.x, point.y, size, 0, Math.PI * 2)
          context.fill()
          context.globalAlpha = 0.06 + point.pull * 0.12
          context.fillRect(point.x - size * 5, point.y - 0.5, size * 10, 1)
        }
      }

      context.globalAlpha = 1
      context.shadowBlur = 0
      context.globalCompositeOperation = "source-over"
    }

    function queueFrame() {
      if (animationFrame || mediaQuery.matches || document.hidden) return
      animationFrame = window.requestAnimationFrame(tick)
    }

    function tick(time: number) {
      animationFrame = 0
      draw(time)
      queueFrame()
    }

    function handleVisibilityChange() {
      if (document.hidden && animationFrame) {
        window.cancelAnimationFrame(animationFrame)
        animationFrame = 0
        return
      }

      draw(performance.now())
      queueFrame()
    }

    function handleMotionPreferenceChange() {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame)
        animationFrame = 0
      }
      draw(performance.now())
      queueFrame()
    }

    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas()
      draw(performance.now())
      queueFrame()
    })

    resizeObserver.observe(container)
    document.addEventListener("visibilitychange", handleVisibilityChange)
    mediaQuery.addEventListener("change", handleMotionPreferenceChange)
    resizeCanvas()
    handleMotionPreferenceChange()

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      mediaQuery.removeEventListener("change", handleMotionPreferenceChange)
    }
  }, [])

  return (
    <div className="ribbon-background" aria-hidden="true">
      <canvas className="ribbon-canvas" ref={canvasRef} />
      <span className="ribbon-glass-ring" />
      <span className="ribbon-vignette" />
      <span className="ribbon-grain" />
      <span className="ribbon-scanlines" />
    </div>
  )
}
