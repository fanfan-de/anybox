import { describe, expect, it, vi } from "vitest"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { BrowserWindow } from "electron"
import { LOCAL_PREVIEW_PROTOCOL, toPluginViewPartition } from "../shared/local-preview-protocol"

vi.mock("electron", () => ({
  app: {
    getAppPath: vi.fn(() => ""),
  },
  BrowserWindow: vi.fn(),
  session: {
    fromPartition: vi.fn(),
  },
}))

import {
  installPluginViewWebviewSecurity,
  resolveNativeMacWindowButtonPosition,
  resolveNextWindowZoomFactor,
  resolvePopoutWindowOptions,
  resolveWindowBackgroundOptions,
  resolveWindowZoomShortcutAction,
} from "./window"
import { resolvePluginViewPreviewTarget, revokePluginViewPreviewRegistrations } from "./preview-targets"

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

describe("Plugin View WebView security", () => {
  it("registers the local preview handler on the isolated plugin session before loading", async () => {
    const packageRoot = await mkdtemp(path.join(os.tmpdir(), "anybox-plugin-webview-"))
    const pluginID = "react-sidebar-proof"
    try {
      await mkdir(path.join(packageRoot, "web"), { recursive: true })
      await writeFile(path.join(packageRoot, "web", "index.html"), "<!doctype html><title>Proof</title>", "utf8")
      const target = await resolvePluginViewPreviewTarget({
        entry: "./web/index.html",
        packageRoot,
        pluginID,
        viewID: "main",
      })
      const listeners = new Map<string, (...args: any[]) => void>()
      const win = {
        webContents: {
          on: vi.fn((eventName: string, listener: (...args: any[]) => void) => {
            listeners.set(eventName, listener)
          }),
        },
      } as unknown as BrowserWindow
      const protocolRegistrar = { handle: vi.fn() }
      const resolveSession = vi.fn(() => ({ protocol: protocolRegistrar }))

      installPluginViewWebviewSecurity(win, resolveSession)
      const willAttach = listeners.get("will-attach-webview")
      expect(willAttach).toBeTypeOf("function")

      const webPreferences = {
        allowRunningInsecureContent: true,
        contextIsolation: false,
        nodeIntegration: true,
        preload: "C:/unsafe-preload.js",
        sandbox: false,
        webSecurity: false,
      }
      const event = { preventDefault: vi.fn() }
      const partition = toPluginViewPartition(pluginID)
      const params = { partition, src: target.safePreviewUrl! }

      willAttach?.(event, webPreferences, params)
      willAttach?.(event, webPreferences, params)

      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(resolveSession).toHaveBeenCalledWith(partition)
      expect(protocolRegistrar.handle).toHaveBeenCalledTimes(1)
      expect(protocolRegistrar.handle).toHaveBeenCalledWith(LOCAL_PREVIEW_PROTOCOL, expect.any(Function))
      expect(webPreferences).toMatchObject({
        allowRunningInsecureContent: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      })
      expect(webPreferences).not.toHaveProperty("preload")
    } finally {
      revokePluginViewPreviewRegistrations(pluginID)
      await rm(packageRoot, { force: true, recursive: true })
    }
  })
})
