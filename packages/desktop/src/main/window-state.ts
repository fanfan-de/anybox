import { screen, type BrowserWindow, type Rectangle } from "electron"
import { DESKTOP_WINDOW_STATE_EVENT_CHANNEL } from "../shared/desktop-ipc-contract"
import {
  getWebContentsForWindowSafely,
  isDisposedElectronTargetError,
  sendWebContentsSafely,
} from "./safe-web-contents-send"

export const WINDOW_STATE_CHANNEL = DESKTOP_WINDOW_STATE_EVENT_CHANNEL

const manualMaximizedBounds = new WeakMap<BrowserWindow, Rectangle>()
const manualMaximizedWindows = new WeakSet<BrowserWindow>()
const normalWindowBounds = new WeakMap<BrowserWindow, Rectangle>()
const WINDOWS_TRANSPARENT_MAXIMIZE_GAP = 1

function cloneBounds(bounds: Rectangle): Rectangle {
  return {
    height: bounds.height,
    width: bounds.width,
    x: bounds.x,
    y: bounds.y,
  }
}

function resolveAcrylicSafeWorkAreaBounds(workArea: Rectangle, platform: NodeJS.Platform): Rectangle {
  if (platform !== "win32") return cloneBounds(workArea)

  return {
    height: Math.max(1, workArea.height - WINDOWS_TRANSPARENT_MAXIMIZE_GAP * 2),
    width: Math.max(1, workArea.width - WINDOWS_TRANSPARENT_MAXIMIZE_GAP * 2),
    x: workArea.x + WINDOWS_TRANSPARENT_MAXIMIZE_GAP,
    y: workArea.y + WINDOWS_TRANSPARENT_MAXIMIZE_GAP,
  }
}

function isWorkAreaBounds(bounds: Rectangle, platform: NodeJS.Platform) {
  if (platform !== "win32") return false

  const workArea = screen.getDisplayMatching(bounds).workArea
  return (
    Math.abs(bounds.x - workArea.x) <= WINDOWS_TRANSPARENT_MAXIMIZE_GAP &&
    Math.abs(bounds.y - workArea.y) <= WINDOWS_TRANSPARENT_MAXIMIZE_GAP &&
    Math.abs(bounds.width - workArea.width) <= WINDOWS_TRANSPARENT_MAXIMIZE_GAP * 2 &&
    Math.abs(bounds.height - workArea.height) <= WINDOWS_TRANSPARENT_MAXIMIZE_GAP * 2
  )
}

export function clearManualMaximize(win: BrowserWindow) {
  manualMaximizedBounds.delete(win)
  manualMaximizedWindows.delete(win)
}

export function isManualMaximizedWindow(win: BrowserWindow) {
  return manualMaximizedWindows.has(win)
}

export function isWindowMaximized(win: BrowserWindow) {
  return win.isMaximized() || manualMaximizedWindows.has(win)
}

export function sendWindowState(win: BrowserWindow) {
  try {
    const webContents = getWebContentsForWindowSafely(win)
    if (!webContents) return false

    return sendWebContentsSafely(webContents, WINDOW_STATE_CHANNEL, {
      isMaximized: isWindowMaximized(win),
    })
  } catch (error) {
    if (isDisposedElectronTargetError(error)) return false
    throw error
  }
}

export function maximizeFramelessWindow(win: BrowserWindow, platform: NodeJS.Platform = process.platform) {
  const currentBounds = win.getBounds()
  const restoreBounds = manualMaximizedBounds.get(win) ?? normalWindowBounds.get(win) ?? currentBounds
  const workArea = screen.getDisplayMatching(currentBounds).workArea

  manualMaximizedBounds.set(win, cloneBounds(restoreBounds))
  manualMaximizedWindows.add(win)
  if (win.isMaximized()) win.unmaximize()
  win.setBounds(resolveAcrylicSafeWorkAreaBounds(workArea, platform))
}

export function restoreFramelessWindow(win: BrowserWindow) {
  const restoreBounds = manualMaximizedBounds.get(win) ?? normalWindowBounds.get(win)

  clearManualMaximize(win)

  if (win.isMaximized()) {
    win.unmaximize()
  }

  if (restoreBounds) {
    win.setBounds(restoreBounds)
  }
}

export function rememberNormalWindowBounds(win: BrowserWindow, platform: NodeJS.Platform = process.platform) {
  if (manualMaximizedWindows.has(win) || win.isMaximized()) return

  const bounds = win.getBounds()
  if (isWorkAreaBounds(bounds, platform)) return

  normalWindowBounds.set(win, cloneBounds(bounds))
}

export function convertNativeMaximizeToManualMaximize(
  win: BrowserWindow,
  platform: NodeJS.Platform = process.platform,
) {
  if (platform !== "win32") return false

  const restoreBounds = manualMaximizedBounds.get(win) ?? normalWindowBounds.get(win)
  const displayBounds = restoreBounds ?? win.getBounds()
  const workArea = screen.getDisplayMatching(displayBounds).workArea

  if (restoreBounds) {
    manualMaximizedBounds.set(win, cloneBounds(restoreBounds))
  }
  manualMaximizedWindows.add(win)
  if (win.isMaximized()) win.unmaximize()
  win.setBounds(resolveAcrylicSafeWorkAreaBounds(workArea, platform))

  return true
}

export function installNormalWindowBoundsTracking(
  win: BrowserWindow,
  platform: NodeJS.Platform = process.platform,
) {
  if (platform !== "win32") return

  const rememberBounds = () => rememberNormalWindowBounds(win, platform)
  rememberBounds()
  win.on("move", rememberBounds)
  win.on("resize", rememberBounds)
  win.on("restore", rememberBounds)
}
