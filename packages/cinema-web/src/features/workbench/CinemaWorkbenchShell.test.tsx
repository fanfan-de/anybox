/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CinemaWorkbenchShell } from "./CinemaWorkbenchShell"

afterEach(cleanup)

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

    expect(screen.getByText("Test Film")).toBeVisible()
    expect(screen.getByRole("tab", { name: "Create" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tab", { name: /Edit/ })).toBeDisabled()
    expect(screen.getByRole("tab", { name: /Deliver/ })).toBeDisabled()
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Create")
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Canvas content")
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
})
