import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { App } from "./App"
import { LanguageProvider } from "./language"

vi.mock("./PaperBackground", () => ({
  PaperBackground: () => <div aria-hidden="true" data-testid="paper-background" />,
}))

describe("App", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/?lang=zh")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("renders the expanded product story and keeps its core disclosures interactive", () => {
    const { container } = render(
      <LanguageProvider>
        <App />
      </LanguageProvider>,
    )

    expect(screen.getByRole("heading", { name: "你的智能本地 Agent 工作台" })).toBeInTheDocument()
    expect(container.querySelector("#product")).toBeInTheDocument()
    expect(container.querySelector("#plugins")).toBeInTheDocument()
    expect(container.querySelector("#scenarios")).toBeInTheDocument()
    expect(container.querySelectorAll(".scenario-story-media img")).toHaveLength(3)

    const faqItems = Array.from(container.querySelectorAll<HTMLDetailsElement>(".faq-item"))
    expect(faqItems).toHaveLength(6)
    expect(faqItems[0].open).toBe(true)
    fireEvent.click(faqItems[1].querySelector("summary")!)
    expect(faqItems[1].open).toBe(true)

    const platformTrigger = screen.getAllByRole("button", { name: "其他平台" })[0]
    fireEvent.click(platformTrigger)
    expect(platformTrigger).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("menu")).toBeInTheDocument()
    fireEvent.keyDown(platformTrigger, { key: "Escape" })
    expect(platformTrigger).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
  })
})
