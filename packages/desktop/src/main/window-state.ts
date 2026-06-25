import type { BrowserWindow } from "electron"
import { DESKTOP_WINDOW_STATE_EVENT_CHANNEL } from "../shared/desktop-ipc-contract"
import {
  getWebContentsForWindowSafely,
  isDisposedElectronTargetError,
  sendWebContentsSafely,
} from "./safe-web-contents-send"

export const WINDOW_STATE_CHANNEL = DESKTOP_WINDOW_STATE_EVENT_CHANNEL

export function isWindowMaximized(win: BrowserWindow) {
  return win.isMaximized()
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
