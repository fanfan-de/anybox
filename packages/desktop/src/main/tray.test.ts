import { describe, expect, it, vi } from "vitest"
import type { BrowserWindow } from "electron"

const electronMock = vi.hoisted(() => {
  const { EventEmitter } = require("node:events") as typeof import("node:events")
  const createdTrays: any[] = []

  class FakeTray extends EventEmitter {
    contextMenu: { template: any[] } | null = null
    destroyed = false
    tooltip = ""

    constructor(readonly image: unknown) {
      super()
      createdTrays.push(this)
    }

    destroy() {
      this.destroyed = true
    }

    setContextMenu(contextMenu: { template: any[] }) {
      this.contextMenu = contextMenu
    }

    setToolTip(tooltip: string) {
      this.tooltip = tooltip
    }
  }

  return {
    app: {
      getAppPath: vi.fn(() => "C:\\app"),
    },
    createdTrays,
    Menu: {
      buildFromTemplate: vi.fn((template: any[]) => ({ template })),
    },
    nativeImage: {
      createEmpty: vi.fn(() => ({ isEmpty: () => true })),
      createFromPath: vi.fn(() => ({ isEmpty: () => false })),
    },
    Tray: FakeTray,
  }
})

vi.mock("electron", () => ({
  app: electronMock.app,
  Menu: electronMock.Menu,
  nativeImage: electronMock.nativeImage,
  Tray: electronMock.Tray,
}))

import { DesktopTrayController } from "./tray"

function createWindowDouble(input: { destroyed?: boolean; minimized?: boolean; visible?: boolean } = {}) {
  let destroyed = input.destroyed ?? false
  let minimized = input.minimized ?? false
  let visible = input.visible ?? true

  return {
    focus: vi.fn(),
    hide: vi.fn(() => {
      visible = false
    }),
    isDestroyed: vi.fn(() => destroyed),
    isMinimized: vi.fn(() => minimized),
    isVisible: vi.fn(() => visible),
    restore: vi.fn(() => {
      minimized = false
    }),
    setDestroyed(nextDestroyed: boolean) {
      destroyed = nextDestroyed
    },
    setSkipTaskbar: vi.fn(),
    show: vi.fn(() => {
      visible = true
    }),
  } as unknown as BrowserWindow & { setDestroyed(nextDestroyed: boolean): void }
}

describe("DesktopTrayController", () => {
  it("hides the main window and refreshes the tray menu", () => {
    electronMock.createdTrays.length = 0
    const win = createWindowDouble({ visible: true })
    const controller = new DesktopTrayController({
      createMainWindow: vi.fn(),
      getMainWindow: () => win,
      mainDir: "C:\\desktop\\out\\main",
      onQuit: vi.fn(),
    })

    controller.install("en-US")
    controller.hideMainWindow()

    expect(win.hide).toHaveBeenCalledTimes(1)
    if (process.platform === "win32") {
      expect(win.setSkipTaskbar).toHaveBeenCalledWith(true)
    }
    expect(electronMock.createdTrays[0]?.contextMenu?.template[1]).toEqual(expect.objectContaining({
      enabled: false,
      label: "Hide Window",
    }))
  })

  it("restores and focuses a hidden main window from the tray", async () => {
    electronMock.createdTrays.length = 0
    const win = createWindowDouble({ minimized: true, visible: false })
    const createMainWindow = vi.fn()
    const controller = new DesktopTrayController({
      createMainWindow,
      getMainWindow: () => win,
      mainDir: "C:\\desktop\\out\\main",
      onQuit: vi.fn(),
    })

    controller.install("en-US")
    await controller.showMainWindow()

    expect(createMainWindow).not.toHaveBeenCalled()
    if (process.platform === "win32") {
      expect(win.setSkipTaskbar).toHaveBeenCalledWith(false)
    }
    expect(win.restore).toHaveBeenCalledTimes(1)
    expect(win.show).toHaveBeenCalledTimes(1)
    expect(win.focus).toHaveBeenCalledTimes(1)
  })

  it("creates a new main window when the current one is gone", async () => {
    electronMock.createdTrays.length = 0
    const win = createWindowDouble({ visible: false })
    const createMainWindow = vi.fn().mockResolvedValue(win)
    const controller = new DesktopTrayController({
      createMainWindow,
      getMainWindow: () => null,
      mainDir: "C:\\desktop\\out\\main",
      onQuit: vi.fn(),
    })

    controller.install("en-US")
    await controller.showMainWindow()

    expect(createMainWindow).toHaveBeenCalledTimes(1)
    expect(win.show).toHaveBeenCalledTimes(1)
    expect(win.focus).toHaveBeenCalledTimes(1)
  })
})
