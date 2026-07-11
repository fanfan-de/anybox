import { Menu, Tray, nativeImage, type BrowserWindow, type MenuItemConstructorOptions, type NativeImage } from "electron"
import type { AppLocale } from "../shared/locale"
import { resolveAppIconPath, resolveTrayIconPath } from "./app-icon"

const trayLabels = {
  "zh-CN": {
    checkForUpdates: "\u68c0\u67e5\u66f4\u65b0...",
    hide: "\u9690\u85cf\u7a97\u53e3",
    open: "\u6253\u5f00 Anybox",
    quit: "\u9000\u51fa Anybox",
  },
  "zh-TW": {
    checkForUpdates: "檢查更新...",
    hide: "隱藏視窗",
    open: "開啟 Anybox",
    quit: "結束 Anybox",
  },
  "en-US": {
    checkForUpdates: "Check for Updates...",
    hide: "Hide Window",
    open: "Open Anybox",
    quit: "Quit Anybox",
  },
  "ja-JP": {
    checkForUpdates: "アップデートを確認...",
    hide: "ウインドウを隠す",
    open: "Anybox を開く",
    quit: "Anybox を終了",
  },
  "ko-KR": {
    checkForUpdates: "업데이트 확인...",
    hide: "창 숨기기",
    open: "Anybox 열기",
    quit: "Anybox 종료",
  },
  "pt-BR": {
    checkForUpdates: "Verificar atualizações...",
    hide: "Ocultar janela",
    open: "Abrir Anybox",
    quit: "Sair do Anybox",
  },
  "es-419": {
    checkForUpdates: "Buscar actualizaciones...",
    hide: "Ocultar ventana",
    open: "Abrir Anybox",
    quit: "Salir de Anybox",
  },
  "de-DE": {
    checkForUpdates: "Nach Updates suchen...",
    hide: "Fenster ausblenden",
    open: "Anybox öffnen",
    quit: "Anybox beenden",
  },
  "fr-FR": {
    checkForUpdates: "Rechercher des mises à jour...",
    hide: "Masquer la fenêtre",
    open: "Ouvrir Anybox",
    quit: "Quitter Anybox",
  },
  "id-ID": {
    checkForUpdates: "Periksa pembaruan...",
    hide: "Sembunyikan jendela",
    open: "Buka Anybox",
    quit: "Keluar dari Anybox",
  },
  "it-IT": {
    checkForUpdates: "Controlla aggiornamenti...",
    hide: "Nascondi finestra",
    open: "Apri Anybox",
    quit: "Esci da Anybox",
  },
  "pl-PL": {
    checkForUpdates: "Sprawdź aktualizacje...",
    hide: "Ukryj okno",
    open: "Otwórz Anybox",
    quit: "Zakończ Anybox",
  },
  "tr-TR": {
    checkForUpdates: "Güncellemeleri denetle...",
    hide: "Pencereyi gizle",
    open: "Anybox'ı aç",
    quit: "Anybox'tan çık",
  },
  "vi-VN": {
    checkForUpdates: "Kiểm tra bản cập nhật...",
    hide: "Ẩn cửa sổ",
    open: "Mở Anybox",
    quit: "Thoát Anybox",
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
  const trayIconPath = process.platform === "darwin" ? resolveTrayIconPath(mainDir) : undefined
  const iconPath = trayIconPath ?? resolveAppIconPath(mainDir)
  if (!iconPath) return nativeImage.createEmpty()

  const image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) return nativeImage.createEmpty()

  if (process.platform === "darwin") {
    const templateImage = trayIconPath ? image : image.resize({ width: 18, height: 18 })
    if (templateImage.isEmpty()) return nativeImage.createEmpty()
    templateImage.setTemplateImage(true)
    return templateImage
  }

  return image
}
