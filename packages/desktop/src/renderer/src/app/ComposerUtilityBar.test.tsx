import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ComposerUtilityBar } from "./ComposerUtilityBar"
import { I18nProvider } from "./i18n/I18nProvider"

describe("ComposerUtilityBar", () => {
  it("opens context details from the pressure indicator and closes from outside click or Escape", () => {
    render(
      <ComposerUtilityBar
        contextWindow={100000}
        gitDirectory={null}
        gitProjectID={null}
        showGitControls={false}
        usage={{
          inputTokens: 25000,
          outputTokens: 1200,
          totalTokens: 26200,
          reasoningTokens: 300,
          cacheReadTokens: 2000,
          cacheWriteTokens: 100,
          measuredAt: 100,
        }}
      />,
    )

    const contextButton = screen.getByRole("button", {
      name: "Context pressure 25% (25k / 100k input tokens)",
    })
    expect(contextButton).toHaveAttribute("aria-expanded", "false")

    fireEvent.click(contextButton)

    const dialog = screen.getByRole("dialog", { name: "Context details" })
    expect(contextButton).toHaveAttribute("aria-expanded", "true")
    expect(within(dialog).getByText("25%")).toBeInTheDocument()
    expect(within(dialog).getByText("25,000 tokens")).toBeInTheDocument()
    expect(within(dialog).getByText("75,000 tokens")).toBeInTheDocument()
    expect(within(dialog).getByText("2,000 read / 100 write")).toBeInTheDocument()

    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole("dialog", { name: "Context details" })).not.toBeInTheDocument()

    fireEvent.click(contextButton)
    expect(screen.getByRole("dialog", { name: "Context details" })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("dialog", { name: "Context details" })).not.toBeInTheDocument()
  })

  it("localizes context details in Chinese", () => {
    window.localStorage.removeItem("desktop.locale")

    render(
      <I18nProvider>
        <ComposerUtilityBar
          contextWindow={100000}
          gitDirectory={null}
          gitProjectID={null}
          showGitControls={false}
          usage={{
            inputTokens: 25000,
            outputTokens: 1200,
            totalTokens: 26200,
            reasoningTokens: 300,
            cacheReadTokens: 2000,
            cacheWriteTokens: 100,
            measuredAt: 100,
          }}
        />
      </I18nProvider>,
    )

    const contextButton = screen.getByRole("button", {
      name: "上下文压力 25%（25k / 100k 输入 tokens）",
    })

    fireEvent.click(contextButton)

    const dialog = screen.getByRole("dialog", { name: "上下文详情" })
    expect(within(dialog).getByText("上下文")).toBeInTheDocument()
    expect(within(dialog).getByText("低")).toBeInTheDocument()
    expect(within(dialog).getByText("输入")).toBeInTheDocument()
    expect(within(dialog).getByText("窗口")).toBeInTheDocument()
    expect(within(dialog).getByText("剩余")).toBeInTheDocument()
    expect(within(dialog).getByText("输出")).toBeInTheDocument()
    expect(within(dialog).getByText("推理")).toBeInTheDocument()
    expect(within(dialog).getByText("缓存")).toBeInTheDocument()
    expect(within(dialog).getByText("2,000 read / 100 write")).toBeInTheDocument()
  })
})
