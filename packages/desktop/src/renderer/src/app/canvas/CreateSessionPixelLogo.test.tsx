import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  CreateSessionPixelLogo,
  composeMasks,
  maskToSvgPath,
  shiftMask,
} from "./CreateSessionPixelLogo"
import {
  boxBodyMask,
  catClosedEyesMask,
  catOpenEyesMask,
  closedFlapsMask,
  halfOpenFlapsMask,
  openFlapsMask,
  PIXEL_LOGO_SIZE,
  type PixelMask,
} from "./create-session-pixel-logo-masks"

const originalVisibilityState = Object.getOwnPropertyDescriptor(document, "visibilityState")
const completeRowMask = (1n << BigInt(PIXEL_LOGO_SIZE)) - 1n

const paths = {
  blink: maskToSvgPath(composeMasks(boxBodyMask, openFlapsMask, catClosedEyesMask)),
  catDown4: maskToSvgPath(composeMasks(boxBodyMask, openFlapsMask, shiftMask(catOpenEyesMask, 4))),
  catDown8: maskToSvgPath(composeMasks(boxBodyMask, openFlapsMask, shiftMask(catOpenEyesMask, 8))),
  catOvershoot: maskToSvgPath(composeMasks(boxBodyMask, openFlapsMask, shiftMask(catOpenEyesMask, -1))),
  closed: maskToSvgPath(composeMasks(boxBodyMask, closedFlapsMask)),
  halfOpen: maskToSvgPath(composeMasks(boxBodyMask, halfOpenFlapsMask)),
  idle: maskToSvgPath(composeMasks(boxBodyMask, openFlapsMask, catOpenEyesMask)),
  open: maskToSvgPath(composeMasks(boxBodyMask, openFlapsMask)),
}

function setVisibilityState(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  })
}

function installMatchMedia(matches: boolean) {
  const mediaQuery = {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList

  vi.stubGlobal("matchMedia", vi.fn(() => mediaQuery))
  return mediaQuery
}

function createEmptyMask(): bigint[] {
  return Array.from({ length: PIXEL_LOGO_SIZE }, () => 0n)
}

function currentPath() {
  const path = screen.getByRole("img", { name: "Anybox logo" }).querySelector("path")
  expect(path).not.toBeNull()
  return path as SVGPathElement
}

function expectCurrentPath(path: string) {
  expect(currentPath()).toHaveAttribute("d", path)
}

function advance(milliseconds: number) {
  act(() => {
    vi.advanceTimersByTime(milliseconds)
  })
}

function countPixels(mask: PixelMask) {
  let count = 0

  for (const row of mask) {
    let remaining = row
    while (remaining !== 0n) {
      remaining &= remaining - 1n
      count += 1
    }
  }

  return count
}

describe("create session pixel logo masks", () => {
  it("stores exactly 64 bounded rows for every layer", () => {
    const masks = {
      boxBodyMask,
      catClosedEyesMask,
      catOpenEyesMask,
      closedFlapsMask,
      halfOpenFlapsMask,
      openFlapsMask,
    }

    for (const [name, mask] of Object.entries(masks)) {
      expect(mask, name).toHaveLength(PIXEL_LOGO_SIZE)
      for (const row of mask) {
        expect(row, name).toBeGreaterThanOrEqual(0n)
        expect(row & ~completeRowMask, name).toBe(0n)
      }
    }

    expect(countPixels(composeMasks(boxBodyMask, openFlapsMask, catOpenEyesMask))).toBe(1_105)
  })

  it("converts horizontal runs into one compact SVG subpath per run", () => {
    const mask = createEmptyMask()
    mask[1] = (1n << 2n) | (1n << 3n) | (1n << 4n) | (1n << 7n)

    expect(maskToSvgPath(mask)).toBe("M2 1h3v1h-3ZM7 1h1v1h-1Z")
  })

  it("shifts rows by whole pixels and clips pixels outside the canvas", () => {
    const mask = createEmptyMask()
    mask[1] = 1n << 5n
    mask[63] = 1n << 7n

    const shiftedDown = shiftMask(mask, 2)
    expect(shiftedDown[3]).toBe(1n << 5n)
    expect(shiftedDown[63]).toBe(0n)

    const shiftedUp = shiftMask(mask, -1)
    expect(shiftedUp[0]).toBe(1n << 5n)
    expect(shiftedUp[62]).toBe(1n << 7n)
    expect(() => shiftMask(mask, 0.5)).toThrow(TypeError)
  })

  it("composes layers with a row-wise bitwise OR", () => {
    const first = createEmptyMask()
    const second = createEmptyMask()
    first[4] = 1n << 2n
    second[4] = (1n << 2n) | (1n << 8n)

    const composed = composeMasks(first, second)
    expect(composed).toHaveLength(PIXEL_LOGO_SIZE)
    expect(composed[4]).toBe((1n << 2n) | (1n << 8n))
  })
})

describe("CreateSessionPixelLogo", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setVisibilityState("visible")
    installMatchMedia(false)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()

    if (originalVisibilityState) {
      Object.defineProperty(document, "visibilityState", originalVisibilityState)
    } else {
      Reflect.deleteProperty(document, "visibilityState")
    }
  })

  it("renders one crisp 64 by 64 path with the existing accessible name", () => {
    render(<CreateSessionPixelLogo />)

    const image = screen.getByRole("img", { name: "Anybox logo" })
    const svg = image.querySelector("svg")

    expect(svg).toHaveAttribute("viewBox", "0 0 64 64")
    expect(svg).toHaveAttribute("shape-rendering", "crispEdges")
    expect(svg).toHaveAttribute("aria-hidden", "true")
    expect(svg?.querySelectorAll("path")).toHaveLength(1)
    expectCurrentPath(paths.closed)
  })

  it("plays the discrete opening, rise, overshoot, and blink sequence", () => {
    render(<CreateSessionPixelLogo />)
    expectCurrentPath(paths.closed)

    advance(220)
    expectCurrentPath(paths.halfOpen)
    advance(110)
    expectCurrentPath(paths.open)
    advance(110)
    expectCurrentPath(paths.catDown8)
    advance(100)
    expectCurrentPath(paths.catDown4)
    advance(100)
    expectCurrentPath(paths.idle)
    advance(90)
    expectCurrentPath(paths.catOvershoot)
    advance(80)
    expectCurrentPath(paths.idle)

    advance(4_199)
    expectCurrentPath(paths.idle)
    advance(1)
    expectCurrentPath(paths.blink)
    advance(120)
    expectCurrentPath(paths.idle)
    advance(4_200)
    expectCurrentPath(paths.blink)
  })

  it("stops while hidden and resumes from the idle blink loop", () => {
    render(<CreateSessionPixelLogo />)
    expect(vi.getTimerCount()).toBe(1)

    act(() => {
      setVisibilityState("hidden")
      document.dispatchEvent(new Event("visibilitychange"))
    })

    expectCurrentPath(paths.idle)
    expect(vi.getTimerCount()).toBe(0)

    act(() => {
      setVisibilityState("visible")
      document.dispatchEvent(new Event("visibilitychange"))
    })

    expectCurrentPath(paths.idle)
    expect(vi.getTimerCount()).toBe(1)
    advance(4_200)
    expectCurrentPath(paths.blink)
  })

  it("clears its timer when unmounted", () => {
    const { unmount } = render(<CreateSessionPixelLogo />)
    expect(vi.getTimerCount()).toBe(1)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })

  it("shows the final open-eye frame without timers for reduced motion", () => {
    installMatchMedia(true)
    render(<CreateSessionPixelLogo />)

    expectCurrentPath(paths.idle)
    expect(vi.getTimerCount()).toBe(0)
  })
})
