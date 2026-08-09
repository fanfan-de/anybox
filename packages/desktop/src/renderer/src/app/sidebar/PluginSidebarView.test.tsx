import { act, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { InstalledPluginView } from "../types"
import { PluginSidebarView } from "./PluginSidebarView"

function createView(overrides: Partial<InstalledPluginView> = {}): InstalledPluginView {
  return {
    pluginID: "react-sidebar-proof",
    pluginVersion: "0.1.0",
    viewID: "main",
    title: "React Sidebar Proof",
    location: "right-sidebar",
    entry: "./web/index.html",
    packageRoot: "C:/plugins/react-sidebar-proof/0.1.0",
    safePreviewUrl: "anybox-preview://preview/token/web/index.html",
    ...overrides,
  }
}

describe("PluginSidebarView", () => {
  it("loads the safe local URL without a preload or Node integration", () => {
    const { container } = render(<PluginSidebarView view={createView()} />)
    const webview = container.querySelector("webview")

    expect(webview).toHaveAttribute("src", "anybox-preview://preview/token/web/index.html")
    expect(webview).not.toHaveAttribute("preload")
    expect(webview).toHaveAttribute(
      "webpreferences",
      "contextIsolation=yes,nodeIntegration=no,sandbox=yes,webSecurity=yes",
    )
    expect(webview?.getAttribute("partition")).not.toMatch(/^persist:/)
    expect(screen.getByRole("status")).toHaveTextContent("Loading React Sidebar Proof")

    act(() => {
      webview?.dispatchEvent(new Event("dom-ready"))
    })
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("reports load failures and blocks navigation away from the entry", () => {
    const { container } = render(<PluginSidebarView view={createView()} />)
    const webview = container.querySelector("webview")!
    const failure = new Event("did-fail-load") as Event & {
      errorCode?: number
      errorDescription?: string
      isMainFrame?: boolean
    }
    failure.errorCode = -105
    failure.errorDescription = "Name not resolved"
    failure.isMainFrame = true

    act(() => webview.dispatchEvent(failure))
    expect(screen.getByRole("alert")).toHaveTextContent("Name not resolved")

    const navigation = new Event("will-navigate", { cancelable: true })
    act(() => webview.dispatchEvent(navigation))
    expect(navigation.defaultPrevented).toBe(true)
    expect(screen.getByRole("alert")).toHaveTextContent("navigate away")
  })

  it("shows an unavailable state when no prepared URL is present", () => {
    render(<PluginSidebarView view={createView({ safePreviewUrl: undefined })} />)
    expect(screen.getByRole("alert")).toHaveTextContent("does not have a valid local entry URL")
    expect(document.querySelector("webview")).toBeNull()
  })
})
