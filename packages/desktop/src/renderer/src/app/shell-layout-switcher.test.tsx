import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { I18nProvider } from "./i18n/I18nProvider"
import { ShellLayoutSwitcher } from "./shell-layout-switcher"

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  window.desktop = undefined
})

describe("ShellLayoutSwitcher", () => {
  it("shows the current mode and supports roving keyboard focus", () => {
    const onModeChange = vi.fn()

    render(
      <I18nProvider>
        <ShellLayoutSwitcher
          isOpen
          mode="workbench-primary"
          onClose={vi.fn()}
          onModeChange={onModeChange}
        />
      </I18nProvider>,
    )

    const workbenchOption = screen.getByRole("radio", { name: "对话工作台居中" })
    const toolsOption = screen.getByRole("radio", { name: "工具工作台居中" })
    expect(workbenchOption).toBeChecked()
    expect(toolsOption).not.toBeChecked()

    workbenchOption.focus()
    fireEvent.keyDown(document, { key: "ArrowDown" })
    expect(toolsOption).toHaveFocus()

    fireEvent.click(toolsOption)
    expect(onModeChange).toHaveBeenCalledWith("tools-primary")
  })

  it("closes with Escape", () => {
    const onClose = vi.fn()
    render(
      <I18nProvider>
        <ShellLayoutSwitcher
          isOpen
          mode="tools-primary"
          onClose={onClose}
          onModeChange={vi.fn()}
        />
      </I18nProvider>,
    )

    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
