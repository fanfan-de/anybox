import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { I18nProvider } from "../i18n/I18nProvider"
import { ConnectionsPage } from "./ConnectionsPage"
import type { ConnectionsTab } from "../types"

function ConnectionsPageHarness() {
  const [activeTab, setActiveTab] = useState<ConnectionsTab>("plugins")
  const [searchQueries, setSearchQueries] = useState<Record<ConnectionsTab, string>>({
    plugins: "",
    connectors: "",
    mcp: "",
    ssh: "",
  })

  return (
    <ConnectionsPage
      activeTab={activeTab}
      connectorCount={2}
      mcpCount={1}
      pluginCount={14}
      searchQuery={searchQueries[activeTab]}
      onSearchQueryChange={(value) =>
        setSearchQueries((current) => ({
          ...current,
          [activeTab]: value,
        }))
      }
      onTabChange={setActiveTab}
    >
      <div>{activeTab} content</div>
    </ConnectionsPage>
  )
}

function renderHarness(locale: "zh-CN" | "en-US" = "zh-CN") {
  window.localStorage.setItem("desktop.locale", locale)

  return render(
    <I18nProvider>
      <ConnectionsPageHarness />
    </I18nProvider>,
  )
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe("ConnectionsPage", () => {
  it("renders counted tabs and switches the active panel", () => {
    renderHarness("zh-CN")

    expect(screen.getByRole("tab", { name: "插件 14" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tab", { name: "连接器 2" })).toHaveAttribute("aria-selected", "false")
    expect(screen.getByRole("tab", { name: "MCP 1" })).toHaveAttribute("aria-selected", "false")
    expect(screen.getByRole("tab", { name: "SSH 0" })).toHaveAttribute("aria-selected", "false")
    expect(screen.queryByRole("tab", { name: "手机 1" })).not.toBeInTheDocument()
    expect(screen.getByRole("searchbox", { name: "搜索插件" }).closest(".connections-page-search-row")).toBeInTheDocument()
    expect(screen.getByRole("searchbox", { name: "搜索插件" }).closest(".connections-top-menu")).toBeNull()
    expect(screen.getByText("plugins content")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("tab", { name: "连接器 2" }))

    expect(screen.getByRole("tab", { name: "连接器 2" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("connectors content")).toBeInTheDocument()
  })

  it("localizes counted tabs and search controls in English", () => {
    renderHarness("en-US")

    expect(screen.getByRole("tab", { name: "Plugins 14" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tab", { name: "Connectors 2" })).toHaveAttribute("aria-selected", "false")
    expect(screen.getByRole("tab", { name: "MCP 1" })).toHaveAttribute("aria-selected", "false")
    expect(screen.getByRole("tab", { name: "SSH 0" })).toHaveAttribute("aria-selected", "false")
    expect(screen.queryByRole("tab", { name: "Mobile 1" })).not.toBeInTheDocument()
    expect(screen.getByRole("searchbox", { name: "Search plugins" })).toHaveAttribute(
      "placeholder",
      "Search plugins",
    )

    fireEvent.click(screen.getByRole("tab", { name: "Connectors 2" }))

    expect(screen.getByRole("searchbox", { name: "Search connectors" })).toHaveAttribute(
      "placeholder",
      "Search connectors",
    )
  })

  it("keeps independent search text for each tab", () => {
    renderHarness("zh-CN")

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索插件" }), {
      target: {
        value: "browser",
      },
    })

    fireEvent.click(screen.getByRole("tab", { name: "连接器 2" }))
    expect(screen.getByRole("searchbox", { name: "搜索连接器" })).toHaveValue("")

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索连接器" }), {
      target: {
        value: "gmail",
      },
    })

    fireEvent.click(screen.getByRole("tab", { name: "插件 14" }))
    expect(screen.getByRole("searchbox", { name: "搜索插件" })).toHaveValue("browser")

    fireEvent.click(screen.getByRole("tab", { name: "连接器 2" }))
    expect(screen.getByRole("searchbox", { name: "搜索连接器" })).toHaveValue("gmail")
  })
})
