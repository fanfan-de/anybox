/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, waitFor, type RenderResult } from "@testing-library/react"
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
  vi.unstubAllGlobals()
})

describe("CinemaWorkbenchShell", () => {
  it("keeps Create active while Edit and Deliver remain visible but unavailable", () => {
    renderShell(
      <CinemaWorkbenchShell
        projectName="Test Film"
        agentBaseURL="http://runtime.example:8765"
        activeWorkspace="create"
        onWorkspaceChange={() => undefined}
      >
        <div>Canvas content</div>
      </CinemaWorkbenchShell>,
    )

    expect(screen.getByText("Test Film")).toBeVisible()
    expect(document.querySelector(".cinema-workbench-identity")).toHaveTextContent("Test Film")
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
        agentBaseURL="http://runtime.example:8765"
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
        agentBaseURL="http://runtime.example:8765"
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

  it("moves between settings tabs with Arrow, Home, and End keys", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, data: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })))
    renderShell(
      <CinemaWorkbenchShell
        projectName="Test Film"
        agentBaseURL="http://runtime.example:8765"
        activeWorkspace="create"
        onWorkspaceChange={() => undefined}
      >
        <div>Canvas content</div>
      </CinemaWorkbenchShell>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }))
    const general = screen.getByRole("tab", { name: "General" })
    general.focus()
    fireEvent.keyDown(general, { key: "ArrowRight" })
    const providers = screen.getByRole("tab", { name: "Providers" })
    expect(providers).toHaveFocus()
    expect(providers).toHaveAttribute("aria-selected", "true")
    await screen.findByRole("heading", { name: "Local ComfyUI" })

    fireEvent.keyDown(providers, { key: "Home" })
    expect(general).toHaveFocus()
    expect(general).toHaveAttribute("aria-selected", "true")
  })

  it("closes settings with Escape and returns focus to the trigger", () => {
    renderShell(
      <CinemaWorkbenchShell
        projectName="Test Film"
        agentBaseURL="http://runtime.example:8765"
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

  it("opens the requested provider from a Cinema provider-settings message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {},
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })))
    renderShell(
      <CinemaWorkbenchShell
        projectName="Test Film"
        agentBaseURL="http://runtime.example:8765"
        activeWorkspace="create"
        onWorkspaceChange={() => undefined}
      >
        <div>Canvas content</div>
      </CinemaWorkbenchShell>,
    )

    fireEvent(window, new MessageEvent("message", {
      data: {
        type: "anybox:open-cinema-provider-settings",
        providerID: "comfyui-local",
      },
    }))

    expect(screen.getByRole("dialog", { name: "Cinema settings" })).toBeVisible()
    expect(screen.getByRole("tab", { name: "Providers" })).toHaveAttribute("aria-selected", "true")
    await waitFor(() => expect(screen.getByRole("heading", { name: "Local ComfyUI" })).toBeVisible())
  })

  it("does not emit workspace changes from the active or unavailable tabs", () => {
    const onWorkspaceChange = vi.fn()
    renderShell(
      <CinemaWorkbenchShell
        projectName="Test Film"
        agentBaseURL="http://runtime.example:8765"
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
        agentBaseURL="http://runtime.example:8765"
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
        agentBaseURL="http://runtime.example:8765"
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

  it("moves workspace focus with arrow keys while skipping unavailable tabs", () => {
    const onWorkspaceChange = vi.fn()
    renderShell(
      <CinemaWorkbenchShell
        projectName="Test Film"
        agentBaseURL="http://runtime.example:8765"
        activeWorkspace="create"
        availableWorkspaces={{ deliver: true }}
        onWorkspaceChange={onWorkspaceChange}
      >
        <div>Canvas content</div>
      </CinemaWorkbenchShell>,
    )

    const create = screen.getByRole("tab", { name: "Create" })
    create.focus()
    fireEvent.keyDown(create, { key: "ArrowRight" })
    const deliver = screen.getByRole("tab", { name: "Deliver" })
    expect(deliver).toHaveFocus()
    expect(onWorkspaceChange).toHaveBeenLastCalledWith("deliver")

    fireEvent.keyDown(deliver, { key: "Home" })
    expect(create).toHaveFocus()
    expect(onWorkspaceChange).toHaveBeenLastCalledWith("create")
  })
})
