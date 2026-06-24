import { BrowserWindow } from "electron"
import {
  installNativeMacWindowControls,
  installWindowZoomShortcuts,
  resolvePopoutWindowOptions,
} from "./window"

const APPEARANCE_WINDOW_QUERY_PARAM = "appWindow"
const APPEARANCE_WINDOW_QUERY_VALUE = "appearance"

let appearanceWindow: BrowserWindow | null = null

function resolveAppearanceWindowUrl(rendererEntryUrl: string) {
  const nextUrl = new URL(rendererEntryUrl)
  nextUrl.searchParams.set(APPEARANCE_WINDOW_QUERY_PARAM, APPEARANCE_WINDOW_QUERY_VALUE)
  return nextUrl.toString()
}

export async function openAppearanceWindow(input: { mainDir: string; rendererEntryUrl: string }) {
  if (appearanceWindow && !appearanceWindow.isDestroyed()) {
    if (appearanceWindow.isMinimized()) appearanceWindow.restore()
    appearanceWindow.show()
    appearanceWindow.focus()

    return {
      ok: true as const,
      reused: true,
    }
  }

  const targetUrl = resolveAppearanceWindowUrl(input.rendererEntryUrl)
  const win = new BrowserWindow({
    ...resolvePopoutWindowOptions(input.mainDir),
    width: 1180,
    height: 820,
    minWidth: 860,
    minHeight: 580,
    title: "Anybox Appearance",
    show: false,
  })

  installNativeMacWindowControls(win)
  installWindowZoomShortcuts(win)
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) win.show()
  })
  win.on("closed", () => {
    if (appearanceWindow === win) {
      appearanceWindow = null
    }
  })

  appearanceWindow = win

  try {
    await win.loadURL(targetUrl)
  } catch (error) {
    if (appearanceWindow === win) {
      appearanceWindow = null
    }
    if (!win.isDestroyed()) {
      win.destroy()
    }
    throw error
  }

  return {
    ok: true as const,
    reused: false,
  }
}
