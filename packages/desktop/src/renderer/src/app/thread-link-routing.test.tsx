import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  ThreadExternalLink,
  ThreadLinkRoutingProvider,
} from "./thread-link-routing"

describe("thread link routing", () => {
  beforeEach(() => {
    window.desktop = {
      openExternalUrl: vi.fn().mockResolvedValue({ ok: true, url: "https://example.com/docs" }),
    } as unknown as typeof window.desktop
  })

  function renderLink(onOpenInAnybox = vi.fn()) {
    render(
      <ThreadLinkRoutingProvider openInAnybox={onOpenInAnybox}>
        <ThreadExternalLink className="thread-inline-link" href="https://example.com/docs">
          Docs
        </ThreadExternalLink>
      </ThreadLinkRoutingProvider>,
    )
    return onOpenInAnybox
  }

  it("opens links in the Anybox browser by default", () => {
    const onOpenInAnybox = renderLink()

    fireEvent.click(screen.getByRole("link", { name: "Docs" }))

    expect(onOpenInAnybox).toHaveBeenCalledWith("https://example.com/docs")
    expect(window.desktop?.openExternalUrl).not.toHaveBeenCalled()
  })

  it("offers Anybox and system browser actions from the link context menu", async () => {
    const onOpenInAnybox = renderLink()

    fireEvent.contextMenu(screen.getByRole("link", { name: "Docs" }), {
      clientX: 120,
      clientY: 80,
    })

    const menu = screen.getByRole("menu", { name: "链接打开方式" })
    expect(within(menu).getByRole("menuitem", { name: "在 Anybox 内置浏览器中打开" })).toBeInTheDocument()
    fireEvent.click(within(menu).getByRole("menuitem", { name: "在系统浏览器中打开" }))

    await waitFor(() => {
      expect(window.desktop?.openExternalUrl).toHaveBeenCalledWith({ url: "https://example.com/docs" })
    })
    expect(onOpenInAnybox).not.toHaveBeenCalled()
    expect(screen.queryByRole("menu", { name: "链接打开方式" })).not.toBeInTheDocument()
  })

  it("opens the context-menu link in Anybox and closes on Escape", () => {
    const onOpenInAnybox = renderLink()
    const link = screen.getByRole("link", { name: "Docs" })

    fireEvent.contextMenu(link, { clientX: 120, clientY: 80 })
    let menu = screen.getByRole("menu", { name: "链接打开方式" })
    fireEvent.click(within(menu).getByRole("menuitem", { name: "在 Anybox 内置浏览器中打开" }))
    expect(onOpenInAnybox).toHaveBeenCalledWith("https://example.com/docs")
    expect(screen.queryByRole("menu", { name: "链接打开方式" })).not.toBeInTheDocument()

    fireEvent.contextMenu(link, { clientX: 120, clientY: 80 })
    menu = screen.getByRole("menu", { name: "链接打开方式" })
    fireEvent.keyDown(menu, { key: "Escape" })
    expect(screen.queryByRole("menu", { name: "链接打开方式" })).not.toBeInTheDocument()
  })
})
