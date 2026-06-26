import { BrowserWindow, app, type BrowserWindowConstructorOptions } from "electron"
import fs from "node:fs"
import path from "node:path"
import { resolveAppIconPath } from "./app-icon"
import { ensureRendererHttpServer } from "./renderer-http-server"
import { safeError, safeWarn } from "./safe-console"
import { recordShutdownDiagnostic } from "./shutdown-diagnostics"
import { sendWindowState } from "./window-state"
import type { WorkbenchWindowManager } from "./workbench-window-manager"

export interface CloseToTrayOptions {
  onCloseToTray: (win: BrowserWindow) => void
  shouldCloseToTray: () => boolean
}

export function resolvePreloadPath(mainDir: string) {
  const rootDir = app.getAppPath()
  const candidatePaths = [
    path.join(mainDir, "../preload/index.mjs"),
    path.join(mainDir, "../preload/index.js"),
    path.join(rootDir, "out/preload/index.mjs"),
    path.join(rootDir, "out/preload/index.js"),
    path.join(rootDir, "dist-electron/preload/index.mjs"),
    path.join(rootDir, "dist-electron/preload/index.js"),
    path.join(rootDir, ".electron-vite/preload/index.mjs"),
    path.join(rootDir, ".electron-vite/preload/index.js"),
    path.join(process.cwd(), "out/preload/index.mjs"),
    path.join(process.cwd(), "out/preload/index.js"),
  ]

  const resolved = candidatePaths.find((candidate) => fs.existsSync(candidate))
  if (resolved) return resolved

  // Keep Electron startup resilient and surface enough detail for diagnosis.
  safeError("[desktop] preload not found, fallback:", candidatePaths[0], "candidates:", candidatePaths)
  return candidatePaths[0]
}

export function resolveWindowIconPath(mainDir: string) {
  return resolveAppIconPath(mainDir)
}

export function installDockIcon(mainDir: string) {
  if (process.platform !== "darwin") return

  const iconPath = resolveWindowIconPath(mainDir)
  if (iconPath) app.dock?.setIcon(iconPath)
}

const MAC_NATIVE_WINDOW_CONTROLS_SLOT_WIDTH = 88
const MAC_NATIVE_TRAFFIC_LIGHT_LEFT_OFFSET = 12
const MAC_NATIVE_TRAFFIC_LIGHT_Y = 14
const WINDOW_ZOOM_FACTORS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const
const WINDOW_ZOOM_FACTOR_EPSILON = 0.001

type WindowChromeOptions = Pick<
  BrowserWindowConstructorOptions,
  "frame" | "maximizable" | "roundedCorners" | "thickFrame" | "titleBarStyle"
>
type WindowBackgroundOptions = Pick<BrowserWindowConstructorOptions, "backgroundColor" | "backgroundMaterial" | "transparent">
type WindowZoomShortcutAction = "in" | "out" | "reset"
type WindowZoomShortcutInput = {
  alt?: boolean
  code?: string
  control?: boolean
  key?: string
  meta?: boolean
  type?: string
}

export function resolveWindowChromeOptions(platform: NodeJS.Platform = process.platform): WindowChromeOptions {
  if (platform === "darwin") {
    return {
      frame: false,
      roundedCorners: true,
      titleBarStyle: "hidden",
    }
  }

  if (platform === "win32") {
    return {
      maximizable: true,
      roundedCorners: false,
      thickFrame: true,
      titleBarStyle: "hidden",
    }
  }

  return {
    frame: false,
    roundedCorners: false,
  }
}

export function resolveWindowBackgroundOptions(platform: NodeJS.Platform = process.platform): WindowBackgroundOptions {
  if (platform === "win32") {
    return {
      backgroundMaterial: "acrylic",
    }
  }

  return {
    backgroundColor: "#eff3f7",
  }
}

export function resolveNativeMacWindowButtonPosition(contentWidth: number) {
  return {
    x: Math.max(12, contentWidth - MAC_NATIVE_WINDOW_CONTROLS_SLOT_WIDTH + MAC_NATIVE_TRAFFIC_LIGHT_LEFT_OFFSET),
    y: MAC_NATIVE_TRAFFIC_LIGHT_Y,
  }
}

export function installNativeMacWindowControls(win: BrowserWindow, platform: NodeJS.Platform = process.platform) {
  if (platform !== "darwin") return

  const syncWindowButtonPosition = () => {
    if (win.isDestroyed()) return
    win.setWindowButtonVisibility(true)
    win.setWindowButtonPosition(resolveNativeMacWindowButtonPosition(win.getContentBounds().width))
  }
  const syncWindowButtonPositionSoon = () => {
    syncWindowButtonPosition()
    setTimeout(syncWindowButtonPosition, 0)
  }

  syncWindowButtonPosition()
  win.on("ready-to-show", syncWindowButtonPosition)
  win.on("resize", syncWindowButtonPosition)
  win.on("maximize", syncWindowButtonPositionSoon)
  win.on("unmaximize", syncWindowButtonPositionSoon)
  win.on("enter-full-screen", syncWindowButtonPositionSoon)
  win.on("leave-full-screen", syncWindowButtonPositionSoon)
}

export function resolveWindowZoomShortcutAction(input: WindowZoomShortcutInput): WindowZoomShortcutAction | null {
  if (input.type !== "keyDown") return null
  if (input.alt) return null
  if (!input.control && !input.meta) return null

  const key = input.key?.toLowerCase()
  const code = input.code
  if (key === "+" || key === "=" || code === "Equal" || code === "NumpadAdd") return "in"
  if (key === "-" || key === "_" || code === "Minus" || code === "NumpadSubtract") return "out"
  if (key === "0" || key === ")" || code === "Digit0" || code === "Numpad0") return "reset"
  return null
}

export function resolveNextWindowZoomFactor(currentZoomFactor: number, action: WindowZoomShortcutAction) {
  if (action === "reset") return 1
  if (!Number.isFinite(currentZoomFactor)) return 1

  if (action === "in") {
    return WINDOW_ZOOM_FACTORS.find((factor) => factor > currentZoomFactor + WINDOW_ZOOM_FACTOR_EPSILON)
      ?? WINDOW_ZOOM_FACTORS[WINDOW_ZOOM_FACTORS.length - 1]
  }

  for (let index = WINDOW_ZOOM_FACTORS.length - 1; index >= 0; index -= 1) {
    const factor = WINDOW_ZOOM_FACTORS[index]
    if (factor < currentZoomFactor - WINDOW_ZOOM_FACTOR_EPSILON) return factor
  }
  return WINDOW_ZOOM_FACTORS[0]
}

export function installWindowZoomShortcuts(win: BrowserWindow) {
  const webContents = win.webContents

  webContents.on("before-input-event", (event, input) => {
    const action = resolveWindowZoomShortcutAction(input)
    if (!action) return

    event.preventDefault()
    const nextZoomFactor = resolveNextWindowZoomFactor(webContents.getZoomFactor(), action)
    webContents.setZoomFactor(nextZoomFactor)
  })
}

export function installWindowStateHandlers(win: BrowserWindow) {
  win.on("maximize", () => {
    sendWindowState(win)
  })
  win.on("unmaximize", () => {
    sendWindowState(win)
  })
  win.on("enter-full-screen", () => {
    sendWindowState(win)
  })
  win.on("leave-full-screen", () => {
    sendWindowState(win)
  })
}

export function resolvePopoutWindowOptions(mainDir: string, options: { platform?: NodeJS.Platform } = {}) {
  return {
    width: 1120,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    ...resolveWindowChromeOptions(options.platform),
    autoHideMenuBar: true,
    ...resolveWindowBackgroundOptions(options.platform),
    icon: resolveWindowIconPath(mainDir),
    webPreferences: {
      preload: resolvePreloadPath(mainDir),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  }
}

export async function resolveRendererEntryUrl(mainDir: string) {
  if (process.env.ELECTRON_RENDERER_URL) {
    return process.env.ELECTRON_RENDERER_URL
  }

  const rendererBaseUrl = await ensureRendererHttpServer(mainDir)
  return `${rendererBaseUrl}/index.html`
}

function installWindowDiagnostics(win: BrowserWindow, input: { label: string; url: string }) {
  const prefix = `[desktop][window:${input.label}]`

  win.on("unresponsive", () => {
    const payload = { label: input.label, url: win.webContents.getURL() || input.url, webContentsID: win.webContents.id }
    recordShutdownDiagnostic("window-unresponsive", payload)
    safeWarn(prefix, "unresponsive", payload)
  })

  win.webContents.on("render-process-gone", (_event, details) => {
    const payload = {
      ...details,
      label: input.label,
      url: win.webContents.getURL() || input.url,
      webContentsID: win.webContents.id,
    }
    recordShutdownDiagnostic("render-process-gone", payload)
    safeError(prefix, "render-process-gone", payload)
  })

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    const payload = {
      errorCode,
      errorDescription,
      isMainFrame,
      label: input.label,
      validatedURL,
      webContentsID: win.webContents.id,
    }
    recordShutdownDiagnostic("did-fail-load", payload)
    safeError(prefix, "did-fail-load", payload)
  })

  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level < 2) return
    const log = level >= 3 ? safeError : safeWarn
    log(prefix, "console-message", {
      level,
      line,
      message,
      sourceId,
      url: win.webContents.getURL() || input.url,
      webContentsID: win.webContents.id,
    })
  })
}

function installCloseToTray(win: BrowserWindow, options?: CloseToTrayOptions) {
  if (!options) return

  win.on("close", (event) => {
    if (!options.shouldCloseToTray()) return

    event.preventDefault()
    options.onCloseToTray(win)
  })
}

export async function createWindow(mainDir: string, options: { closeToTray?: CloseToTrayOptions; workbenchWindowManager?: WorkbenchWindowManager } = {}) {
  const rendererEntryUrl = await resolveRendererEntryUrl(mainDir)
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1120,
    minHeight: 760,
    ...resolveWindowChromeOptions(),
    autoHideMenuBar: true,
    ...resolveWindowBackgroundOptions(),
    icon: resolveWindowIconPath(mainDir),
    show: false,
    webPreferences: {
      preload: resolvePreloadPath(mainDir),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  })
  installNativeMacWindowControls(win)
  installWindowZoomShortcuts(win)
  installWindowStateHandlers(win)
  installWindowDiagnostics(win, { label: "main", url: rendererEntryUrl })
  installCloseToTray(win, options.closeToTray)
  options.workbenchWindowManager?.registerMainWindow(win)

  win.once("ready-to-show", () => {
    sendWindowState(win)
    win.show()
  })

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }))

  void win.loadURL(rendererEntryUrl)

  return win
}
