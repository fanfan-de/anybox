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

    expect(screen.getByText("开源桌面端永久免费开源 · MIT License")).toBeInTheDocument()
    expect(screen.queryByText(
      "开源的本地 AI Agent 工作台，把代码、能力与工作流握在自己手中。",
    )).not.toBeInTheDocument()
    expect(screen.queryByText(
      "源码、Issue、发行版本与更新记录公开可查。把本地项目、模型、工具和插件放进同一个可检查的工作空间，从第一次请求一直做到结果交付。",
    )).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "在 GitHub 查看源码" })).toHaveAttribute(
      "href",
      "https://github.com/fanfan-de/anybox",
    )
    expect(screen.getByText("MIT", { selector: "dd" })).toBeInTheDocument()
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
