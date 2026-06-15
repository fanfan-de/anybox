import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { I18nProvider, useI18n } from "./I18nProvider"
import { translateLiteral } from "./translations"

function Fixture() {
  const { error, locale, setLocale, t } = useI18n()

  return (
    <div>
      <span>Open settings</span>
      <input aria-label="Search files" placeholder="Search files" />
      <button type="button" onClick={() => void setLocale(locale === "zh-CN" ? "en-US" : "zh-CN")}>
        {t("settings.appearance.languageTitle")}
      </button>
      <span data-testid="locale">{locale}</span>
      {error ? <span role="alert">{error}</span> : null}
    </div>
  )
}

function EditableFixture() {
  return (
    <div contentEditable data-testid="editable" suppressContentEditableWarning>
      abc
    </div>
  )
}

function NonLocalizableFixture() {
  return (
    <div>
      <code>Open settings</code>
      <pre>Search files</pre>
      <span data-i18n-skip>Open settings</span>
      <span className="xterm">Search files</span>
    </div>
  )
}

function waitForLocalizationFrame() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 50)
  })
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  window.desktop = undefined
})

describe("I18nProvider", () => {
  it("defaults to Chinese and localizes text and attributes", async () => {
    render(
      <I18nProvider>
        <Fixture />
      </I18nProvider>,
    )

    expect(await screen.findByText("打开设置")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "显示语言" })).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "搜索文件" })).toHaveAttribute("placeholder", "搜索文件")
  })

  it("loads and saves English through the desktop locale API", async () => {
    const saveLocaleConfig = vi.fn().mockResolvedValue({
      path: "locale-settings.json",
      exists: true,
      document: {
        version: 1,
        locale: "zh-CN",
        updatedAt: 2,
      },
    })
    window.desktop = {
      platform: "win32",
      versions: {},
      getLocaleConfig: vi.fn().mockResolvedValue({
        path: "locale-settings.json",
        exists: true,
        document: {
          version: 1,
          locale: "en-US",
          updatedAt: 1,
        },
      }),
      saveLocaleConfig,
    } as unknown as typeof window.desktop

    render(
      <I18nProvider>
        <Fixture />
      </I18nProvider>,
    )

    expect(await screen.findByText("en-US")).toBeInTheDocument()
    expect(await screen.findByText("Open settings")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Display Language" }))

    await waitFor(() => {
      expect(saveLocaleConfig).toHaveBeenCalledWith({
        document: expect.objectContaining({
          locale: "zh-CN",
          version: 1,
        }),
      })
    })
    expect(await screen.findByText("zh-CN")).toBeInTheDocument()
    expect(await screen.findByText("打开设置")).toBeInTheDocument()
  })

  it("does not localize user-editable text nodes", async () => {
    render(
      <I18nProvider>
        <EditableFixture />
      </I18nProvider>,
    )

    const editable = screen.getByTestId("editable")
    await waitFor(() => expect(editable.textContent).toBe("abc"))

    editable.firstChild!.nodeValue = "abc "
    await waitForLocalizationFrame()

    expect(editable.textContent).toBe("abc ")
  })

  it("does not localize code, preformatted, skipped, or terminal text", async () => {
    render(
      <I18nProvider>
        <NonLocalizableFixture />
      </I18nProvider>,
    )

    await waitForLocalizationFrame()

    expect(screen.getByText("Open settings", { selector: "code" })).toBeInTheDocument()
    expect(screen.getByText("Search files", { selector: "pre" })).toBeInTheDocument()
    expect(screen.getByText("Open settings", { selector: "[data-i18n-skip]" })).toBeInTheDocument()
    expect(screen.getByText("Search files", { selector: ".xterm" })).toBeInTheDocument()
  })

  it("localizes MCP import action text", () => {
    expect(translateLiteral("zh-CN", "Import JSON")).toBe("\u5bfc\u5165 JSON")
    expect(translateLiteral("en-US", "Import JSON")).toBe("Import JSON")
  })
})
