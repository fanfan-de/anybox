import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { LanguageProvider } from "./language"
import { SiteHeader } from "./SiteChrome"

describe("SiteHeader", () => {
  it("exposes an accessible mobile navigation disclosure", () => {
    render(
      <LanguageProvider>
        <SiteHeader currentPage="home" />
      </LanguageProvider>,
    )

    const trigger = screen.getByRole("button", { name: /菜单|Menu/ })
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("navigation", { name: /站点导航|Site navigation/ })).toBeInTheDocument()
  })

  it("marks the current shared page", () => {
    render(
      <LanguageProvider>
        <SiteHeader currentPage="docs" />
      </LanguageProvider>,
    )

    expect(screen.getByRole("link", { name: /文档|Docs/ })).toHaveAttribute("aria-current", "page")
  })
})
