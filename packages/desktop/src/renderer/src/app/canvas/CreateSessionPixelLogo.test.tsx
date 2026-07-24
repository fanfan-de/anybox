import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  CreateSessionPixelLogo,
  composeMasks,
  maskToDotSvgPath,
  maskToSvgPath,
  shiftMask,
} from "./CreateSessionPixelLogo"
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

const originalVisibilityState = Object.getOwnPropertyDescriptor(document, "visibilityState")
const completeRowMask = (1n << BigInt(PIXEL_LOGO_SIZE)) - 1n

const paths = {
  blink: maskToDotSvgPath(composeMasks(boxBodyMask, openFlapsMask, catClosedEyesMask)),
  catDown4: maskToDotSvgPath(composeMasks(boxBodyMask, openFlapsMask, shiftMask(catOpenEyesMask, 4))),
  catDown8: maskToDotSvgPath(composeMasks(boxBodyMask, openFlapsMask, shiftMask(catOpenEyesMask, 8))),
  catOvershoot: maskToDotSvgPath(composeMasks(boxBodyMask, openFlapsMask, shiftMask(catOpenEyesMask, -1))),
  closed: maskToDotSvgPath(composeMasks(boxBodyMask, closedFlapsMask)),
  halfOpen: maskToDotSvgPath(composeMasks(boxBodyMask, halfOpenFlapsMask)),
  headTilt: maskToDotSvgPath(composeMasks(boxBodyMask, openFlapsMask, catHeadTiltMask)),
  headTiltHalf: maskToDotSvgPath(composeMasks(boxBodyMask, openFlapsMask, catHeadTiltHalfMask)),
  idle: maskToDotSvgPath(composeMasks(boxBodyMask, openFlapsMask, catOpenEyesMask)),
  open: maskToDotSvgPath(composeMasks(boxBodyMask, openFlapsMask)),
  tailWagLeft: maskToDotSvgPath(composeMasks(boxBodyMask, openFlapsMask, catTailWagLeftMask)),
  tailWagRight: maskToDotSvgPath(composeMasks(boxBodyMask, openFlapsMask, catTailWagRightMask)),
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
  it("stores exactly 64 bounded rows for every source-derived layer", () => {
    const masks = {
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

  it("maps every active source grid cell to one centered dot", () => {
    const mask = createEmptyMask()
    mask[0] = (1n << 0n) | (1n << 2n)
    mask[1] = 1n << 1n

    expect(maskToDotSvgPath(mask)).toBe("M0.5 0.5h.01M4.5 0.5h.01M2.5 2.5h.01")
  })

  it("shifts rows by whole pixels and clips pixels outside the canvas", () => {
    const mask = createEmptyMask()
    mask[1] = 1n << 5n
    mask[PIXEL_LOGO_SIZE - 1] = 1n << 7n

    const shiftedDown = shiftMask(mask, 2)
    expect(shiftedDown[3]).toBe(1n << 5n)
    expect(shiftedDown[PIXEL_LOGO_SIZE - 1]).toBe(0n)

    const shiftedUp = shiftMask(mask, -1)
    expect(shiftedUp[0]).toBe(1n << 5n)
    expect(shiftedUp[PIXEL_LOGO_SIZE - 2]).toBe(1n << 7n)
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
    vi.spyOn(Math, "random").mockReturnValue(0)
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

  it("renders one round-dot 128 by 128 path with the existing accessible name", () => {
    render(<CreateSessionPixelLogo />)

    const image = screen.getByRole("img", { name: "Anybox logo" })
    const svg = image.querySelector("svg")

    expect(svg).toHaveAttribute("viewBox", "0 0 128 128")
    expect(svg).toHaveAttribute("shape-rendering", "geometricPrecision")
    expect(svg).toHaveAttribute("aria-hidden", "true")
    expect(svg?.querySelectorAll("path")).toHaveLength(1)
    expect(currentPath()).toHaveAttribute("fill", "none")
    expect(currentPath()).toHaveAttribute("stroke", "currentColor")
    expect(currentPath()).toHaveAttribute("stroke-width", "1.6")
    expect(currentPath()).toHaveAttribute("stroke-linecap", "round")
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

  it("randomly plays a two-step head tilt and returns to idle", () => {
    vi.mocked(Math.random).mockReturnValue(0.5)
    render(<CreateSessionPixelLogo />)

    advance(810)
    expectCurrentPath(paths.idle)
    advance(4_200)
    expectCurrentPath(paths.headTiltHalf)
    advance(90)
    expectCurrentPath(paths.headTilt)
    advance(240)
    expectCurrentPath(paths.headTiltHalf)
    advance(90)
    expectCurrentPath(paths.idle)
  })

  it("randomly wags the tail twice and returns to idle", () => {
    vi.mocked(Math.random).mockReturnValue(0.9)
    render(<CreateSessionPixelLogo />)

    advance(810)
    expectCurrentPath(paths.idle)
    advance(4_200)
    expectCurrentPath(paths.tailWagLeft)
    advance(100)
    expectCurrentPath(paths.tailWagRight)
    advance(100)
    expectCurrentPath(paths.tailWagLeft)
    advance(100)
    expectCurrentPath(paths.tailWagRight)
    advance(100)
    expectCurrentPath(paths.idle)
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
