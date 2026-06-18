import { Menu, Tray, nativeImage, type BrowserWindow, type MenuItemConstructorOptions, type NativeImage } from "electron"
import type { AppLocale } from "../shared/locale"
import { resolveAppIconPath } from "./app-icon"

const trayLabels = {
  "zh-CN": {
    checkForUpdates: "\u68c0\u67e5\u66f4\u65b0...",
    hide: "\u9690\u85cf\u7a97\u53e3",
    open: "\u6253\u5f00 Anybox",
    quit: "\u9000\u51fa Anybox",
  },
  "en-US": {
    checkForUpdates: "Check for Updates...",
    hide: "Hide Window",
    open: "Open Anybox",
    quit: "Quit Anybox",
  },
} as const satisfies Record<AppLocale, Record<string, string>>

export interface DesktopTrayControllerOptions {
  createMainWindow: () => Promise<BrowserWindow>
  getMainWindow: () => BrowserWindow | null
  mainDir: string
  onCheckForUpdates?: () => void
  onQuit: () => void
}

export class DesktopTrayController {
  private readonly createMainWindow: () => Promise<BrowserWindow>
  private readonly getMainWindow: () => BrowserWindow | null
  private readonly mainDir: string
  private readonly onCheckForUpdates?: () => void
  private readonly onQuit: () => void
  private locale: AppLocale = "zh-CN"
  private pendingMainWindow: Promise<BrowserWindow> | null = null
  private tray: Tray | null = null

  constructor(options: DesktopTrayControllerOptions) {
    this.createMainWindow = options.createMainWindow
    this.getMainWindow = options.getMainWindow
    this.mainDir = options.mainDir
    this.onCheckForUpdates = options.onCheckForUpdates
    this.onQuit = options.onQuit
  }

  install(locale: AppLocale) {
    this.locale = locale
    if (this.tray) {
      this.updateMenu()
      return
    }

    this.tray = new Tray(resolveTrayImage(this.mainDir))
    this.tray.setToolTip("Anybox")
    this.tray.on("click", () => {
      void this.showMainWindow()
    })
    this.tray.on("double-click", () => {
      void this.showMainWindow()
    })
    this.updateMenu()
  }

  destroy() {
    this.tray?.destroy()
    this.tray = null
  }

  hideMainWindow(win = this.getMainWindow()) {
    if (!win || win.isDestroyed()) return
    if (process.platform === "win32") {
      win.setSkipTaskbar(true)
    }
    win.hide()
    this.updateMenu()
  }

  isInstalled() {
    return Boolean(this.tray)
  }

  setLocale(locale: AppLocale) {
    this.locale = locale
    this.updateMenu()
  }

  async showMainWindow() {
    const win = await this.ensureMainWindow()
    if (!win || win.isDestroyed()) return

    if (process.platform === "win32") {
      win.setSkipTaskbar(false)
    }
    if (win.isMinimized()) {
      win.restore()
    }
    if (!win.isVisible()) {
      win.show()
    }
    win.focus()
    this.updateMenu()
  }

  updateMenu() {
    if (!this.tray) return
    this.tray.setContextMenu(Menu.buildFromTemplate(this.buildMenuTemplate()))
  }

  private buildMenuTemplate(): MenuItemConstructorOptions[] {
    const labels = trayLabels[this.locale]
    const mainWindow = this.getMainWindow()
    const hasVisibleMainWindow = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible())

    return [
      {
        label: labels.open,
        click: () => {
          void this.showMainWindow()
        },
      },
      {
        enabled: hasVisibleMainWindow,
        label: labels.hide,
        click: () => {
          this.hideMainWindow()
        },
      },
      { type: "separator" },
      {
        enabled: Boolean(this.onCheckForUpdates),
        label: labels.checkForUpdates,
        click: () => {
          this.onCheckForUpdates?.()
        },
      },
      { type: "separator" },
      {
        label: labels.quit,
        click: () => {
          this.onQuit()
        },
      },
    ]
  }

  private async ensureMainWindow() {
    const existingWindow = this.getMainWindow()
    if (existingWindow && !existingWindow.isDestroyed()) {
      return existingWindow
    }

    if (!this.pendingMainWindow) {
      this.pendingMainWindow = this.createMainWindow().finally(() => {
        this.pendingMainWindow = null
      })
    }

    return this.pendingMainWindow
  }
}

function resolveTrayImage(mainDir: string): NativeImage {
  const iconPath = resolveAppIconPath(mainDir)
  if (!iconPath) return nativeImage.createEmpty()

  const image = nativeImage.createFromPath(iconPath)
  return image.isEmpty() ? nativeImage.createEmpty() : image
}
