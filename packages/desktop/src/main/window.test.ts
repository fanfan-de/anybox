import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  app: {
    getAppPath: vi.fn(() => ""),
  },
  BrowserWindow: vi.fn(),
}))

import {
  resolveNativeMacWindowButtonPosition,
  resolveNextWindowZoomFactor,
  resolvePopoutWindowOptions,
  resolveWindowBackgroundOptions,
  resolveWindowZoomShortcutAction,
} from "./window"

describe("session popout window options", () => {
  it("creates a native Windows window with a hidden title bar for system snap", () => {
    const options = resolvePopoutWindowOptions("C:\\desktop\\out\\main", { platform: "win32" })

    expect(options.frame).toBeUndefined()
    expect(options.maximizable).toBe(true)
    expect(options.roundedCorners).toBe(false)
    expect(options.thickFrame).toBe(true)
    expect(options.titleBarStyle).toBe("hidden")
    expect("titleBarOverlay" in options).toBe(false)
    expect("trafficLightPosition" in options).toBe(false)
    expect(options.backgroundMaterial).toBe("acrylic")
    expect(options.backgroundColor).toBeUndefined()
    expect(options.transparent).toBeUndefined()
    expect(options.webPreferences?.contextIsolation).toBe(true)
    expect(options.webPreferences?.nodeIntegration).toBe(false)
    expect(options.webPreferences?.preload).toContain("preload")
  })

  it("creates a frameless macOS Electron window with native traffic lights", () => {
    const options = resolvePopoutWindowOptions("/desktop/out/main", { platform: "darwin" })

    expect(options.frame).toBe(false)
    expect(options.maximizable).toBeUndefined()
    expect(options.roundedCorners).toBe(true)
    expect(options.titleBarStyle).toBe("hidden")
    expect("trafficLightPosition" in options).toBe(false)
    expect(options.backgroundMaterial).toBeUndefined()
    expect(options.backgroundColor).toBe("#eff3f7")
    expect(options.transparent).toBeUndefined()
    expect(options.webPreferences?.contextIsolation).toBe(true)
    expect(options.webPreferences?.nodeIntegration).toBe(false)
    expect(options.webPreferences?.preload).toContain("preload")
  })

  it("uses Windows Acrylic without an opaque fallback for native resize and snap", () => {
    expect(resolveWindowBackgroundOptions("win32")).toEqual({
      backgroundMaterial: "acrylic",
    })
    expect(resolveWindowBackgroundOptions("darwin")).toEqual({ backgroundColor: "#eff3f7" })
    expect(resolveWindowBackgroundOptions("linux")).toEqual({ backgroundColor: "#eff3f7" })
  })

  it("can disable Windows Acrylic for performance diagnostics", () => {
    expect(resolveWindowBackgroundOptions("win32", { env: { ANYBOX_DISABLE_WINDOWS_ACRYLIC: "1" } })).toEqual({
      backgroundColor: "#eff3f7",
    })
  })

  it("positions native macOS traffic lights inside the right window controls slot", () => {
    expect(resolveNativeMacWindowButtonPosition(1440)).toEqual({ x: 1364, y: 14 })
    expect(resolveNativeMacWindowButtonPosition(72)).toEqual({ x: 12, y: 14 })
  })

  it("recognizes desktop window zoom keyboard shortcuts", () => {
    expect(resolveWindowZoomShortcutAction({ type: "keyDown", control: true, key: "=", code: "Equal" })).toBe("in")
    expect(resolveWindowZoomShortcutAction({ type: "keyDown", control: true, key: "+", code: "Equal" })).toBe("in")
    expect(resolveWindowZoomShortcutAction({ type: "keyDown", meta: true, key: "-", code: "Minus" })).toBe("out")
    expect(resolveWindowZoomShortcutAction({ type: "keyDown", control: true, key: "0", code: "Digit0" })).toBe("reset")
    expect(resolveWindowZoomShortcutAction({ type: "keyUp", control: true, key: "=", code: "Equal" })).toBeNull()
    expect(resolveWindowZoomShortcutAction({ type: "keyDown", alt: true, control: true, key: "=", code: "Equal" })).toBeNull()
    expect(resolveWindowZoomShortcutAction({ type: "keyDown", key: "=", code: "Equal" })).toBeNull()
  })

  it("steps desktop window zoom through bounded factors", () => {
    expect(resolveNextWindowZoomFactor(1, "in")).toBe(1.1)
    expect(resolveNextWindowZoomFactor(1.1, "in")).toBe(1.25)
    expect(resolveNextWindowZoomFactor(1, "out")).toBe(0.9)
    expect(resolveNextWindowZoomFactor(0.9, "out")).toBe(0.8)
    expect(resolveNextWindowZoomFactor(3, "in")).toBe(3)
    expect(resolveNextWindowZoomFactor(0.5, "out")).toBe(0.5)
    expect(resolveNextWindowZoomFactor(1.25, "reset")).toBe(1)
    expect(resolveNextWindowZoomFactor(Number.NaN, "in")).toBe(1)
  })
})
