import { app, BrowserWindow, Menu, protocol, session } from "electron"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { registerIpcHandlers } from "./ipc"
import { registerLocalImageProtocolHandler } from "./local-image-protocol"
import { registerLocalPreviewProtocolHandler } from "./preview-targets"
import { registerDesktopProtocolSchemes } from "./protocol-schemes"
import { readLocaleConfigSnapshot } from "./locale-config"
import { ensureManagedAgentRunning, stopManagedAgent } from "./managed-agent"
import { createApplicationMenus, type ApplicationMenuOptions } from "./menu"
import { ensureMobileBridgeServerRunning, stopMobileBridgeServer } from "./mobile-bridge-server"
import { stopRendererHttpServer } from "./renderer-http-server"
import { safeError } from "./safe-console"
import { installProcessCrashDiagnostics, recordShutdownDiagnostic } from "./shutdown-diagnostics"
import { DesktopTrayController } from "./tray"
import { checkForAppUpdates, initializeAutoUpdater } from "./updater"
import {
  createWindow,
  installDockIcon,
  installNativeMacWindowControls,
  installWindowStateHandlers,
  installWindowZoomShortcuts,
  resolvePopoutWindowOptions,
  resolveRendererEntryUrl,
} from "./window"
import { WorkbenchWindowManager } from "./workbench-window-manager"
import { resolveWindowsAppUserModelId } from "./windows-app-identity"
import { DESKTOP_OPEN_SHELL_LAYOUT_SWITCHER_EVENT_CHANNEL } from "../shared/desktop-ipc-contract"
import { sendWebContentsSafely } from "./safe-web-contents-send"

const mainDir = path.dirname(fileURLToPath(import.meta.url))
const PREVIEW_WEBVIEW_PARTITION = "persist:preview"
const remoteDebuggingPort = process.env.ANYBOX_REMOTE_DEBUGGING_PORT?.trim()

if (!app.isPackaged && remoteDebuggingPort && /^\d+$/.test(remoteDebuggingPort)) {
  app.commandLine.appendSwitch("remote-debugging-port", remoteDebuggingPort)
}

registerDesktopProtocolSchemes(protocol)
const windowsAppUserModelId = resolveWindowsAppUserModelId(app.isPackaged)
if (windowsAppUserModelId) app.setAppUserModelId(windowsAppUserModelId)
installProcessCrashDiagnostics()

let isQuitting = false
let trayController: DesktopTrayController | null = null

function getAppLifecycleDiagnosticState() {
  return {
    isQuitting,
    trayInstalled: trayController?.isInstalled() ?? false,
    windowCount: BrowserWindow.getAllWindows().length,
  }
}

void app.whenReady().then(async () => {
  installDockIcon(mainDir)

  try {
    await ensureManagedAgentRunning()
  } catch (error) {
    safeError("[desktop] failed to start managed agent", error)
  }
  await ensureMobileBridgeServerRunning().catch((error) => {
    safeError("[desktop] failed to start mobile bridge", error)
  })

  let mainWindow: BrowserWindow | null = null
  const menuOptions: ApplicationMenuOptions = {
    onCheckForUpdates: () => {
      void checkForAppUpdates({ manual: true })
    },
    onOpenShellLayoutSwitcher: () => {
      const target = mainWindow
      if (!target || target.isDestroyed()) return
      if (!target.isVisible()) target.show()
      target.focus()
      sendWebContentsSafely(
        target.webContents,
        DESKTOP_OPEN_SHELL_LAYOUT_SWITCHER_EVENT_CHANNEL,
        { source: "application-menu" },
      )
    },
  }
  const localeSnapshot = await readLocaleConfigSnapshot().catch((error) => {
    safeError("[desktop] failed to read locale settings", error)
    return null
  })
  const menus = createApplicationMenus(localeSnapshot?.document.locale ?? "zh-CN", menuOptions)
  Menu.setApplicationMenu(menus.applicationMenu)
  const rendererEntryUrl = await resolveRendererEntryUrl(mainDir)
  const workbenchWindowManager = new WorkbenchWindowManager({
    rendererEntryUrl,
    configureWindow: (window) => {
      installNativeMacWindowControls(window)
      installWindowZoomShortcuts(window)
      installWindowStateHandlers(window)
    },
    createPopoutWindowOptions: () => resolvePopoutWindowOptions(mainDir),
  })
  const createMainWindow = async () => {
    const win = await createWindow(mainDir, {
      closeToTray: {
        onCloseToTray: (window) => {
          trayController?.hideMainWindow(window)
        },
        shouldCloseToTray: () => !isQuitting && trayController?.isInstalled() === true,
      },
      workbenchWindowManager,
    })
    mainWindow = win
    win.once("closed", () => {
      if (mainWindow === win) {
        mainWindow = null
      }
      trayController?.updateMenu()
    })
    return win
  }
  const nextTrayController = new DesktopTrayController({
    createMainWindow,
    getMainWindow: () => mainWindow,
    mainDir,
    onCheckForUpdates: menuOptions.onCheckForUpdates,
    onQuit: () => {
      isQuitting = true
      app.quit()
    },
  })
  try {
    nextTrayController.install(localeSnapshot?.document.locale ?? "zh-CN")
    trayController = nextTrayController
  } catch (error) {
    safeError("[desktop] failed to install tray", error)
  }
  registerIpcHandlers(menus, {
    mainDir,
    onLocaleChanged: (locale) => {
      const nextMenus = createApplicationMenus(locale, menuOptions)
      menus.applicationMenu = nextMenus.applicationMenu
      menus.popupMenus = nextMenus.popupMenus
      Menu.setApplicationMenu(menus.applicationMenu)
      trayController?.setLocale(locale)
    },
    rendererEntryUrl,
    workbenchWindowManager,
  })
  registerLocalImageProtocolHandler(protocol)
  registerLocalPreviewProtocolHandler(protocol)
  registerLocalPreviewProtocolHandler(session.fromPartition(PREVIEW_WEBVIEW_PARTITION).protocol)

  try {
    await createMainWindow()
  } catch (error) {
    safeError("[desktop] failed to create window", error)
  }
  initializeAutoUpdater()
  setTimeout(() => {
    void checkForAppUpdates()
  }, 3000)

  app.on("activate", () => {
    void trayController?.showMainWindow().catch((error) => {
      safeError("[desktop] failed to show main window", error)
    })
  })
})

app.on("before-quit", () => {
  recordShutdownDiagnostic("before-quit", getAppLifecycleDiagnosticState())
  isQuitting = true
  trayController?.destroy()
  void stopManagedAgent()
  void stopMobileBridgeServer()
  void stopRendererHttpServer()
})

app.on("window-all-closed", () => {
  recordShutdownDiagnostic("window-all-closed", getAppLifecycleDiagnosticState())
  if (isQuitting) return
  if (process.platform !== "darwin" && !trayController?.isInstalled()) app.quit()
})

app.on("will-quit", () => {
  recordShutdownDiagnostic("will-quit", getAppLifecycleDiagnosticState())
})

app.on("quit", (_event, exitCode) => {
  recordShutdownDiagnostic("quit", {
    ...getAppLifecycleDiagnosticState(),
    exitCode,
  })
})

app.on("child-process-gone", (_event, details) => {
  recordShutdownDiagnostic("child-process-gone", details)
})
