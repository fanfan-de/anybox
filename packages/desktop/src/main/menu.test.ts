import type { MenuItemConstructorOptions } from "electron"
import { beforeEach, describe, expect, it, vi } from "vitest"

const electronMock = vi.hoisted(() => ({
  buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => ({ template })),
  showAboutPanel: vi.fn(),
}))

vi.mock("electron", () => ({
  app: {
    name: "Anybox Desktop",
    showAboutPanel: electronMock.showAboutPanel,
  },
  Menu: {
    buildFromTemplate: electronMock.buildFromTemplate,
  },
}))

import { createApplicationMenus } from "./menu"

describe("application menu", () => {
  beforeEach(() => {
    electronMock.buildFromTemplate.mockClear()
    electronMock.showAboutPanel.mockClear()
  })

  it("registers the native workspace layout accelerator", () => {
    const onOpenShellLayoutSwitcher = vi.fn()
    const menus = createApplicationMenus("en-US", { onOpenShellLayoutSwitcher })
    const applicationMenu = menus.applicationMenu as unknown as {
      template: MenuItemConstructorOptions[]
    }
    const viewMenu = applicationMenu.template.find((item) => item.label === "View")
    const viewItems = viewMenu?.submenu as MenuItemConstructorOptions[]
    const layoutItem = viewItems.find((item) => item.accelerator === "CommandOrControl+Shift+L")

    expect(layoutItem).toMatchObject({
      label: "Switch Workspace Layout",
      accelerator: "CommandOrControl+Shift+L",
    })
    layoutItem?.click?.({} as never, undefined, {} as never)
    expect(onOpenShellLayoutSwitcher).toHaveBeenCalledTimes(1)
  })
})
