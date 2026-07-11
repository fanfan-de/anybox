/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CinemaWorkbenchShell } from "./CinemaWorkbenchShell"

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute("data-theme")
  window.localStorage.removeItem("cinema-theme")
})

describe("CinemaWorkbenchShell", () => {
  it("keeps Create active while Edit and Deliver remain visible but unavailable", () => {
    render(
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
    render(
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

  it("closes settings with Escape and returns focus to the trigger", () => {
    render(
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
    render(
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
    render(
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
    render(
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
