import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { LanguageProvider } from "../language"
import {
  DocsApp,
  extractHeadings,
  renderMarkdown,
} from "./DocsApp"

describe("documentation markdown", () => {
  it("ignores heading-like lines inside fenced code and keeps duplicate ids stable", () => {
    const markdown = [
      "# Guide",
      "",
      "## Configure",
      "",
      "```md",
      "# Example title",
      "## Not a document section",
      "```",
      "",
      "## Configure",
      "",
      "| Setting | Value |",
      "| --- | --- |",
      "| Model | Default |",
    ].join("\n")
    const headings = extractHeadings(markdown)
    const html = renderMarkdown(markdown, headings)
    const rendered = new DOMParser().parseFromString(html, "text/html")

    expect(headings).toEqual([
      { id: "guide", level: 1, text: "Guide" },
      { id: "configure", level: 2, text: "Configure" },
      { id: "configure-2", level: 2, text: "Configure" },
    ])
    expect(rendered.getElementById("guide")).not.toBeNull()
    expect(rendered.getElementById("configure")).not.toBeNull()
    expect(rendered.getElementById("configure-2")).not.toBeNull()
    expect(rendered.getElementById("example-title")).toBeNull()
    expect(rendered.querySelector("pre")?.getAttribute("tabindex")).toBe("0")
    expect(
      rendered.querySelector(".docs-table-scroll")?.getAttribute("tabindex"),
    ).toBe("0")
  })
})

describe("DocsApp", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/docs/?doc=skills&lang=en")
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    })
  })

  it("uses crawlable article links and marks the current page", () => {
    render(
      <LanguageProvider>
        <DocsApp />
      </LanguageProvider>,
    )

    const navigation = screen.getByRole("navigation", {
      name: "Documentation navigation",
    })
    const currentLink = within(navigation).getByRole("link", { name: "Skills" })

    expect(currentLink).toHaveAttribute("aria-current", "page")
    expect(currentLink).toHaveAttribute(
      "href",
      expect.stringContaining("doc=skills"),
    )
    expect(document.querySelector("#open-the-skills-workspace")).not.toBeNull()
    expect(document.querySelector("#release-check")).toBeNull()

    const tableOfContents = screen.getByRole("complementary", {
      name: "On this page",
    })
    for (const link of within(tableOfContents).getAllByRole("link")) {
      expect(document.querySelector(link.getAttribute("href")!)).not.toBeNull()
    }
  })

  it("filters the article index without losing real links", () => {
    render(
      <LanguageProvider>
        <DocsApp />
      </LanguageProvider>,
    )

    const navigation = screen.getByRole("navigation", {
      name: "Documentation navigation",
    })
    fireEvent.change(screen.getByRole("searchbox", { name: "Search documentation" }), {
      target: { value: "compactedToMessageID" },
    })

    expect(
      within(navigation).getByRole("link", { name: "Long Sessions & Context" }),
    ).toHaveAttribute("href", expect.stringContaining("doc=core-concept"))
    expect(
      within(navigation).queryByRole("link", { name: "Quick Start" }),
    ).not.toBeInTheDocument()
  })

  it("moves focus to the article title after client-side navigation", () => {
    render(
      <LanguageProvider>
        <DocsApp />
      </LanguageProvider>,
    )

    const navigation = screen.getByRole("navigation", {
      name: "Documentation navigation",
    })
    fireEvent.click(
      within(navigation).getByRole("link", { name: "Build Plugins" }),
    )

    const title = screen.getByRole("heading", {
      level: 1,
      name: "Build Plugins",
    })
    expect(title).toHaveFocus()
    expect(window.location.search).toContain("doc=plugin-development")
    expect(
      within(navigation).getByRole("link", { name: "Build Plugins" }),
    ).toHaveAttribute("aria-current", "page")
  })

  it("navigates the featured plugin guides through the documentation sidebar", () => {
    render(
      <LanguageProvider>
        <DocsApp />
      </LanguageProvider>,
    )

    const navigation = screen.getByRole("navigation", {
      name: "Documentation navigation",
    })
    const chromeLink = within(navigation).getByRole("link", { name: "Chrome" })

    expect(chromeLink).toHaveAttribute(
      "href",
      expect.stringContaining("doc=chrome"),
    )

    fireEvent.click(chromeLink)

    expect(
      screen.getByRole("heading", { level: 1, name: "Chrome" }),
    ).toHaveFocus()
    expect(
      screen.getByText("Plugin Guides", { selector: ".docs-article-meta span" }),
    ).toBeInTheDocument()
    expect(
      within(navigation).getByRole("link", { name: "Chrome" }),
    ).toHaveAttribute("aria-current", "page")

    fireEvent.click(
      within(navigation).getByRole("link", { name: "Computer Use Windows" }),
    )

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Computer Use Windows",
      }),
    ).toHaveFocus()
    expect(window.location.search).toContain("doc=computer-use-windows")
  })
})
