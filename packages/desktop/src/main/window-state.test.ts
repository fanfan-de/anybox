import { EventEmitter } from "node:events"
import { beforeEach, describe, expect, it, vi } from "vitest"

const electronMock = vi.hoisted(() => ({
  getDisplayMatching: vi.fn(() => ({
    workArea: {
      height: 1040,
      width: 1920,
      x: 0,
      y: 0,
    },
  })),
}))

vi.mock("electron", () => ({
  screen: {
    getDisplayMatching: electronMock.getDisplayMatching,
  },
}))

import {
  convertNativeMaximizeToManualMaximize,
  installNormalWindowBoundsTracking,
  isWindowMaximized,
  maximizeFramelessWindow,
  rememberNormalWindowBounds,
  restoreFramelessWindow,
} from "./window-state"

type Bounds = {
  height: number
  width: number
  x: number
  y: number
}

class FakeBrowserWindow extends EventEmitter {
  bounds: Bounds = {
    height: 600,
    width: 800,
    x: 80,
    y: 70,
  }
  maximized = false
  setBoundsCalls: Bounds[] = []
  unmaximizeCalls = 0

  getBounds() {
    return { ...this.bounds }
  }

  isMaximized() {
    return this.maximized
  }

  setBounds(bounds: Bounds) {
    this.bounds = { ...bounds }
    this.setBoundsCalls.push({ ...bounds })
  }

  unmaximize() {
    this.maximized = false
    this.unmaximizeCalls += 1
    this.emit("unmaximize")
  }
}

describe("window state", () => {
  beforeEach(() => {
    electronMock.getDisplayMatching.mockClear()
  })

  it("manual maximizes Windows transparent windows without entering exact work-area bounds", () => {
    const win = new FakeBrowserWindow()
    const restoreBounds = win.getBounds()

    maximizeFramelessWindow(win as never, "win32")

    expect(isWindowMaximized(win as never)).toBe(true)
    expect(win.setBoundsCalls.at(-1)).toEqual({
      height: 1038,
      width: 1918,
      x: 1,
      y: 1,
    })

    restoreFramelessWindow(win as never)

    expect(isWindowMaximized(win as never)).toBe(false)
    expect(win.setBoundsCalls.at(-1)).toEqual(restoreBounds)
  })

  it("converts a native Windows maximize back to manual maximize before restoring", () => {
    const win = new FakeBrowserWindow()
    const restoreBounds = win.getBounds()

    rememberNormalWindowBounds(win as never, "win32")
    win.maximized = true
    win.bounds = {
      height: 1040,
      width: 1920,
      x: 0,
      y: 0,
    }

    expect(convertNativeMaximizeToManualMaximize(win as never, "win32")).toBe(true)

    expect(win.unmaximizeCalls).toBe(1)
    expect(isWindowMaximized(win as never)).toBe(true)
    expect(win.setBoundsCalls.at(-1)).toEqual({
      height: 1038,
      width: 1918,
      x: 1,
      y: 1,
    })

    restoreFramelessWindow(win as never)

    expect(win.setBoundsCalls.at(-1)).toEqual(restoreBounds)
  })

  it("tracks normal bounds but ignores acrylic-safe maximized bounds", () => {
    const win = new FakeBrowserWindow()

    installNormalWindowBoundsTracking(win as never, "win32")
    win.bounds = {
      height: 720,
      width: 960,
      x: 120,
      y: 96,
    }
    win.emit("resize")
    win.bounds = {
      height: 1038,
      width: 1918,
      x: 1,
      y: 1,
    }
    win.emit("resize")

    maximizeFramelessWindow(win as never, "win32")
    restoreFramelessWindow(win as never)

    expect(win.setBoundsCalls.at(-1)).toEqual({
      height: 720,
      width: 960,
      x: 120,
      y: 96,
    })
  })
})
