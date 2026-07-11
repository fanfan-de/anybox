/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, type RenderResult } from "@testing-library/react"
import type { ReactElement } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CINEMA_LOCALE_STORAGE_KEY, I18nProvider } from "../../i18n"
import { CinemaWorkbenchShell } from "./CinemaWorkbenchShell"

function renderShell(element: ReactElement): RenderResult {
  return render(<I18nProvider>{element}</I18nProvider>)
}

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute("data-theme")
  document.documentElement.lang = ""
  window.localStorage.removeItem("cinema-theme")
  window.localStorage.removeItem(CINEMA_LOCALE_STORAGE_KEY)
})

describe("CinemaWorkbenchShell", () => {
  it("keeps Create active while Edit and Deliver remain visible but unavailable", () => {
    renderShell(
      <CinemaWorkbenchShell
        projectName="Test Film"
        activeWorkspace="create"
        onWorkspaceChange={() => undefined}
      >
        <div>Canvas content</div>
      </CinemaWorkbenchShell>,
    )

    expect(screen.queryByText("Cinema")).not.toBeInTheDocument()
    expect(screen.queryByText("Test Film")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open settings" })).toHaveAttribute("aria-expanded", "false")
    expect(document.documentElement).toHaveAttribute("data-theme", "dark")
    expect(screen.getByRole("tab", { name: "Create" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tab", { name: /Edit/ })).toBeDisabled()
    expect(screen.getByRole("tab", { name: /Deliver/ })).toBeDisabled()
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Create")
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Canvas content")
  })

  it("opens settings and switches the independent Cinema theme", () => {
    renderShell(
      <CinemaWorkbenchShell
        projectName="Test Film"
        activeWorkspace="create"
        onWorkspaceChange={() => undefined}
      >
        <div>Canvas content</div>
      </CinemaWorkbenchShell>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }))
    expect(screen.getByRole("dialog", { name: "Cinema settings" })).toBeVisible()

    fireEvent.click(screen.getByRole("radio", { name: "Light" }))
    expect(document.documentElement).toHaveAttribute("data-theme", "light")
    expect(window.localStorage.getItem("cinema-theme")).toBe("light")

    fireEvent.click(screen.getByRole("radio", { name: "Dark" }))
    expect(document.documentElement).toHaveAttribute("data-theme", "dark")
    expect(window.localStorage.getItem("cinema-theme")).toBe("dark")
  })

  it("switches the interface language and persists the preference", () => {
    renderShell(
      <CinemaWorkbenchShell
        projectName="Test Film"
        activeWorkspace="create"
        onWorkspaceChange={() => undefined}
      >
        <div>Canvas content</div>
      </CinemaWorkbenchShell>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }))
    fireEvent.click(screen.getByRole("radio", { name: "简体中文" }))

    expect(screen.getByRole("dialog", { name: "Cinema 设置" })).toBeVisible()
    expect(screen.getByRole("tab", { name: "创作" })).toHaveAttribute("aria-selected", "true")
    expect(document.documentElement).toHaveAttribute("lang", "zh-CN")
    expect(window.localStorage.getItem(CINEMA_LOCALE_STORAGE_KEY)).toBe("zh-CN")

    fireEvent.click(screen.getByRole("radio", { name: "English" }))
    expect(screen.getByRole("dialog", { name: "Cinema settings" })).toBeVisible()
    expect(document.documentElement).toHaveAttribute("lang", "en-US")
    expect(window.localStorage.getItem(CINEMA_LOCALE_STORAGE_KEY)).toBe("en-US")
  })

  it("closes settings with Escape and returns focus to the trigger", () => {
    renderShell(
      <CinemaWorkbenchShell
        projectName="Test Film"
        activeWorkspace="create"
        onWorkspaceChange={() => undefined}
      >
        <div>Canvas content</div>
      </CinemaWorkbenchShell>,
    )

    const trigger = screen.getByRole("button", { name: "Open settings" })
    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("dialog", { name: "Cinema settings" })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it("does not emit workspace changes from the active or unavailable tabs", () => {
    const onWorkspaceChange = vi.fn()
    renderShell(
      <CinemaWorkbenchShell
        projectName="Test Film"
        activeWorkspace="create"
        onWorkspaceChange={onWorkspaceChange}
      >
        <div>Canvas content</div>
      </CinemaWorkbenchShell>,
    )

    fireEvent.click(screen.getByRole("tab", { name: "Create" }))
    fireEvent.click(screen.getByRole("tab", { name: /Edit/ }))
    fireEvent.click(screen.getByRole("tab", { name: /Deliver/ }))
    expect(onWorkspaceChange).not.toHaveBeenCalled()
  })

  it("enables Edit only when the project or development flag allows it", () => {
    const onWorkspaceChange = vi.fn()
    renderShell(
      <CinemaWorkbenchShell
        projectName="Test Film"
        activeWorkspace="create"
        availableWorkspaces={{ edit: true }}
        onWorkspaceChange={onWorkspaceChange}
      >
        <div>Canvas content</div>
      </CinemaWorkbenchShell>,
    )

    fireEvent.click(screen.getByRole("tab", { name: "Edit" }))
    expect(onWorkspaceChange).toHaveBeenCalledWith("edit")
    expect(screen.getByRole("tab", { name: /Deliver/ })).toBeDisabled()
  })

  it("enables Deliver only when the project or development flag allows it", () => {
    const onWorkspaceChange = vi.fn()
    renderShell(
      <CinemaWorkbenchShell
        projectName="Test Film"
        activeWorkspace="create"
        availableWorkspaces={{ edit: true, deliver: true }}
        onWorkspaceChange={onWorkspaceChange}
      >
        <div>Canvas content</div>
      </CinemaWorkbenchShell>,
    )

    fireEvent.click(screen.getByRole("tab", { name: "Deliver" }))
    expect(onWorkspaceChange).toHaveBeenCalledWith("deliver")
  })
})
