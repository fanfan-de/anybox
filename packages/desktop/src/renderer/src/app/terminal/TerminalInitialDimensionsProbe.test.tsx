import { act, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { resolveCodeFontFamilyStack } from "../code-font"
import { TerminalInitialDimensionsProbe } from "./TerminalInitialDimensionsProbe"

function setMockDimensions(dimensions: { rows: number; cols: number } | null | undefined) {
  ;(globalThis as { __mockXtermFitDimensions?: { rows: number; cols: number } | null }).__mockXtermFitDimensions = dimensions
}

async function flushFrame() {
  await act(async () => {
    await new Promise((resolve) => window.requestAnimationFrame(resolve))
  })
}

describe("TerminalInitialDimensionsProbe", () => {
  afterEach(() => {
    setMockDimensions(undefined)
  })

  it("reports measured terminal dimensions once", async () => {
    const onDimensions = vi.fn()
    const onMeasurementError = vi.fn()
    setMockDimensions({
      rows: 31,
      cols: 101,
    })

    render(
      <TerminalInitialDimensionsProbe
        brandTheme="terra"
        codeFontFamily="consolas"
        colorMode="light"
        panelHeight={280}
        requestID={7}
        onDimensions={onDimensions}
        onMeasurementError={onMeasurementError}
      />,
    )

    await waitFor(() => {
      expect(onDimensions).toHaveBeenCalledWith(7, {
        rows: 31,
        cols: 101,
      })
    })
    await flushFrame()

    expect(onDimensions).toHaveBeenCalledTimes(1)
    expect(onMeasurementError).not.toHaveBeenCalled()
    expect((
      globalThis as { __mockXtermLastOptions?: Record<string, unknown> }
    ).__mockXtermLastOptions?.fontFamily).toBe(resolveCodeFontFamilyStack("consolas"))
  })

  it("reports a measurement error when dimensions stay unavailable", async () => {
    const onDimensions = vi.fn()
    const onMeasurementError = vi.fn()
    setMockDimensions(null)

    render(
      <TerminalInitialDimensionsProbe
        brandTheme="terra"
        colorMode="light"
        panelHeight={280}
        requestID={9}
        onDimensions={onDimensions}
        onMeasurementError={onMeasurementError}
      />,
    )

    await waitFor(
      () => {
        expect(onMeasurementError).toHaveBeenCalledWith(
          9,
          "Unable to measure terminal size. Resize the terminal panel and retry.",
        )
      },
      {
        timeout: 1_200,
      },
    )

    expect(onDimensions).not.toHaveBeenCalled()
  })
})
