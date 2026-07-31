import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import { memo, useEffect, useEffectEvent, useRef } from "react"
import type { AppearanceCodeFontFamily } from "../../../../shared/appearance"
import type { BrandTheme, ColorMode } from "../types"
import { createTerminalOptions } from "./TerminalView"

const MAX_MEASURE_ATTEMPTS = 8
const MEASURE_RETRY_DELAY_MS = 40

interface TerminalInitialDimensionsProbeProps {
  brandTheme: BrandTheme
  codeFontFamily?: AppearanceCodeFontFamily
  colorMode: ColorMode
  panelHeight: number
  requestID: number
  onDimensions: (requestID: number, dimensions: { rows: number; cols: number }) => void | Promise<void>
  onMeasurementError: (requestID: number, message: string) => void
}

function isUsableDimensions(
  dimensions: { rows?: number; cols?: number } | undefined | null,
): dimensions is { rows: number; cols: number } {
  return Boolean(dimensions && dimensions.rows && dimensions.cols && dimensions.rows > 0 && dimensions.cols > 0)
}

export const TerminalInitialDimensionsProbe = memo(function TerminalInitialDimensionsProbe({
  brandTheme,
  codeFontFamily = "default",
  colorMode,
  panelHeight,
  requestID,
  onDimensions,
  onMeasurementError,
}: TerminalInitialDimensionsProbeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const themeSignature = `${brandTheme}:${colorMode}:${codeFontFamily}`
  const handleDimensions = useEffectEvent(onDimensions)
  const handleMeasurementError = useEffectEvent(onMeasurementError)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const terminal = new Terminal(createTerminalOptions(codeFontFamily))
    const fitAddon = new FitAddon()
    let frame: number | null = null
    let timer: number | null = null
    let completed = false
    let attempts = 0
    let measure: () => void

    const cleanupPendingMeasure = () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame)
        frame = null
      }
      if (timer !== null) {
        window.clearTimeout(timer)
        timer = null
      }
    }

    const failMeasurement = () => {
      if (completed) return
      completed = true
      cleanupPendingMeasure()
      handleMeasurementError(requestID, "Unable to measure terminal size. Resize the terminal panel and retry.")
    }

    const scheduleMeasure = () => {
      cleanupPendingMeasure()
      timer = window.setTimeout(() => {
        timer = null
        frame = window.requestAnimationFrame(measure)
      }, MEASURE_RETRY_DELAY_MS)
    }

    measure = () => {
      frame = null
      if (completed) return

      attempts += 1
      let dimensions: { rows?: number; cols?: number } | undefined

      try {
        fitAddon.fit()
        dimensions = fitAddon.proposeDimensions() ?? undefined
      } catch {
        dimensions = undefined
      }

      if (isUsableDimensions(dimensions)) {
        completed = true
        cleanupPendingMeasure()
        void handleDimensions(requestID, {
          rows: dimensions.rows,
          cols: dimensions.cols,
        })
        return
      }

      if (attempts >= MAX_MEASURE_ATTEMPTS) {
        failMeasurement()
        return
      }

      scheduleMeasure()
    }

    terminal.loadAddon(fitAddon)
    terminal.open(container)
    frame = window.requestAnimationFrame(measure)

    return () => {
      completed = true
      cleanupPendingMeasure()
      fitAddon.dispose()
      terminal.dispose()
    }
  }, [handleDimensions, handleMeasurementError, panelHeight, requestID, themeSignature])

  return (
    <div className="terminal-view-shell terminal-measurement-shell">
      <div
        id={`terminal-bootstrap-${String(requestID)}`}
        aria-label="Preparing terminal"
        className="terminal-surface"
        role="status"
      >
        <div ref={containerRef} className="terminal-xterm" />
      </div>
    </div>
  )
})
