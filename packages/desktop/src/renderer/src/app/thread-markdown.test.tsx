import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { normalizeMarkdownLinkTarget, ThreadMarkdown, type MarkdownLinkTarget } from "./thread-markdown"

describe("ThreadMarkdown", () => {
  beforeEach(() => {
    window.desktop = {
      openExternalUrl: vi.fn().mockResolvedValue({
        ok: true,
        url: "https://example.com/",
      }),
    } as unknown as Window["desktop"]
  })

  it("renders GFM markdown blocks and inline formatting", () => {
    const { container } = render(
      <ThreadMarkdown
        text={[
          "## Release notes",
          "",
          "**Ready** to ship.",
          "",
          "- [x] Markdown",
          "- Tables",
          "",
          "> Reviewed",
          "",
          "| File | Status |",
          "| --- | --- |",
          "| `ThreadView.tsx` | done |",
          "",
          "```ts",
          "const enabled = true",
          "```",
        ].join("\n")}
      />,
    )

    expect(screen.getByRole("heading", { name: "Release notes" })).toBeInTheDocument()
    expect(screen.getByText("Ready")).toBeInTheDocument()
    expect(screen.getByRole("checkbox")).toBeChecked()
    expect(screen.getByText("Reviewed")).toBeInTheDocument()
    expect(screen.getByRole("table")).toBeInTheDocument()
    expect(container.querySelector(".thread-markdown-table-scroll table")).toBe(screen.getByRole("table"))
    expect(screen.getByText("ThreadView.tsx")).toBeInTheDocument()
    expect(screen.getByText("const enabled = true")).toBeInTheDocument()
    expect(container.querySelector('code[data-language="ts"]')).toHaveTextContent("const enabled = true")
  })

  it("skips raw HTML and blocks unsafe links", () => {
    render(
      <ThreadMarkdown
        text={'Before <span data-testid="raw-html">raw</span> [bad](javascript:alert(1)) [ftp](ftp://example.com) [anchor](#section).'}
        onLocalFileLinkOpen={vi.fn()}
      />,
    )

    expect(screen.queryByTestId("raw-html")).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "bad" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "ftp" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "anchor" })).not.toBeInTheDocument()
    expect(screen.getByText(/bad/)).toBeInTheDocument()
    expect(screen.getByText(/ftp/)).toBeInTheDocument()
    expect(screen.getByText(/anchor/)).toBeInTheDocument()
  })

  it("opens safe links through the desktop bridge", () => {
    render(<ThreadMarkdown text="[Docs](https://example.com/docs)" />)

    fireEvent.click(screen.getByRole("link", { name: "Docs" }))

    expect(window.desktop?.openExternalUrl).toHaveBeenCalledWith({
      url: "https://example.com/docs",
    })
  })

  it("recognizes and opens artifact links through the artifact callback", () => {
    const onArtifactLinkOpen = vi.fn()

    expect(normalizeMarkdownLinkTarget("agent://artifact/report-1")).toMatchObject({
      href: "agent://artifact/report-1",
      kind: "artifact",
      target: {
        href: "agent://artifact/report-1",
        id: "report-1",
      },
    })

    render(
      <ThreadMarkdown
        text="[Artifact](agent://artifact/report-1)"
        onArtifactLinkOpen={onArtifactLinkOpen}
      />,
    )

    fireEvent.click(screen.getByRole("link", { name: "Artifact" }))

    expect(onArtifactLinkOpen).toHaveBeenCalledWith({
      href: "agent://artifact/report-1",
      id: "report-1",
    })
    expect(window.desktop?.openExternalUrl).not.toHaveBeenCalled()
  })

  it("opens local absolute file links through the local file callback", () => {
    const onLocalFileLinkOpen = vi.fn()
    render(
      <ThreadMarkdown
        text="[ThreadView.tsx](C:/Projects/anybox/packages/desktop/src/renderer/src/app/thread/ThreadView.tsx)"
        onLocalFileLinkOpen={onLocalFileLinkOpen}
      />,
    )

    fireEvent.click(screen.getByRole("link", { name: "ThreadView.tsx" }))

    expect(onLocalFileLinkOpen).toHaveBeenCalledWith({
      lineRange: null,
      path: "C:/Projects/anybox/packages/desktop/src/renderer/src/app/thread/ThreadView.tsx",
    })
    expect(window.desktop?.openExternalUrl).not.toHaveBeenCalled()
  })

  it("opens relative file links through the local file callback", () => {
    const onLocalFileLinkOpen = vi.fn()
    render(
      <ThreadMarkdown
        text="[Source](src/app.tsx:12) [Game](snake.html)"
        onLocalFileLinkOpen={onLocalFileLinkOpen}
      />,
    )

    fireEvent.click(screen.getByRole("link", { name: "Source" }))
    fireEvent.click(screen.getByRole("link", { name: "Game" }))

    expect(onLocalFileLinkOpen).toHaveBeenNthCalledWith(1, {
      lineRange: {
        startLineNumber: 12,
        endLineNumber: 12,
      },
      path: "src/app.tsx",
    })
    expect(onLocalFileLinkOpen).toHaveBeenNthCalledWith(2, {
      lineRange: null,
      path: "snake.html",
    })
    expect(window.desktop?.openExternalUrl).not.toHaveBeenCalled()
  })

  it("opens loose Windows file links with backslashes, spaces, and parentheses", () => {
    const onLocalFileLinkOpen = vi.fn()
    render(
      <ThreadMarkdown
        text={String.raw`[index.html](C:\新建文件夹 (4)\index.html)`}
        onLocalFileLinkOpen={onLocalFileLinkOpen}
      />,
    )

    fireEvent.click(screen.getByRole("link", { name: "index.html" }))

    expect(onLocalFileLinkOpen).toHaveBeenCalledWith({
      lineRange: null,
      path: String.raw`C:\新建文件夹 (4)\index.html`,
    })
  })

  it("parses local file link line range suffixes", () => {
    const onLocalFileLinkOpen = vi.fn()
    render(
      <ThreadMarkdown
        text={[
          "[Colon](C:/Projects/app.tsx:12-20)",
          "[Hash](file:///C:/Projects/app.tsx#L30-L34)",
        ].join(" ")}
        onLocalFileLinkOpen={onLocalFileLinkOpen}
      />,
    )

    fireEvent.click(screen.getByRole("link", { name: "Colon" }))
    fireEvent.click(screen.getByRole("link", { name: "Hash" }))

    expect(onLocalFileLinkOpen).toHaveBeenNthCalledWith(1, {
      lineRange: {
        startLineNumber: 12,
        endLineNumber: 20,
      },
      path: "C:/Projects/app.tsx",
    })
    expect(onLocalFileLinkOpen).toHaveBeenNthCalledWith(2, {
      lineRange: {
        startLineNumber: 30,
        endLineNumber: 34,
      },
      path: "C:/Projects/app.tsx",
    })
  })

  it("renders local file links as plain text when no local file callback is provided", () => {
    render(<ThreadMarkdown text="[Local](C:/Projects/app.tsx)" />)

    expect(screen.queryByRole("link", { name: "Local" })).not.toBeInTheDocument()
    expect(screen.getByText("Local")).toBeInTheDocument()
  })

  it("renders http markdown images directly", () => {
    render(<ThreadMarkdown text="![Diagram](https://example.com/diagram.png)" />)

    const image = screen.getByRole("img", { name: "Diagram" })
    expect(image).toHaveClass("thread-markdown-image")
    expect(image).toHaveAttribute("src", "https://example.com/diagram.png")
  })

  it("rewrites local absolute image paths to the internal image protocol", () => {
    render(<ThreadMarkdown text={String.raw`![Local](C:\Users\19128\AppData\Local\Temp\a.png)`} />)

    const image = screen.getByRole("img", { name: "Local" })
    expect(image).toHaveAttribute(
      "src",
      `anybox-local-image://image?source=${encodeURIComponent(String.raw`C:\Users\19128\AppData\Local\Temp\a.png`)}`,
    )
  })

  it("rewrites file URL images to the internal image protocol", () => {
    render(<ThreadMarkdown text="![Local](file:///C:/Users/19128/AppData/Local/Temp/a.png)" />)

    const image = screen.getByRole("img", { name: "Local" })
    expect(image).toHaveAttribute(
      "src",
      `anybox-local-image://image?source=${encodeURIComponent("file:///C:/Users/19128/AppData/Local/Temp/a.png")}`,
    )
  })

  it("renders unsafe and relative image sources as alt text", () => {
    const { container } = render(
      <ThreadMarkdown text="![Bad](javascript:alert(1)) ![Ftp](ftp://example.com/a.png) ![Relative](images/a.png)" />,
    )

    expect(container.querySelector("img")).toBeNull()
    expect(screen.getByText("Bad")).toHaveClass("thread-markdown-image-alt")
    expect(screen.getByText("Ftp")).toHaveClass("thread-markdown-image-alt")
    expect(screen.getByText("Relative")).toHaveClass("thread-markdown-image-alt")
  })

  it("uses optional resolvers for scoped relative links and images", () => {
    const onLocalFileLinkOpen = vi.fn()
    const resolveLinkTarget = vi.fn((href: string): MarkdownLinkTarget | null => {
      if (href !== "../setup.md#L4-L6") return null
      return {
        href,
        kind: "local-file",
        target: {
          lineRange: {
            startLineNumber: 4,
            endLineNumber: 6,
          },
          path: "docs/setup.md",
        },
      }
    })
    const resolveImageSrc = vi.fn((src: string) =>
      src === "./assets/logo.png" ? "anybox-local-image://image?source=logo" : null,
    )

    render(
      <ThreadMarkdown
        text="![Logo](./assets/logo.png) [Setup](../setup.md#L4-L6)"
        onLocalFileLinkOpen={onLocalFileLinkOpen}
        resolveImageSrc={resolveImageSrc}
        resolveLinkTarget={resolveLinkTarget}
      />,
    )

    expect(screen.getByRole("img", { name: "Logo" })).toHaveAttribute(
      "src",
      "anybox-local-image://image?source=logo",
    )

    fireEvent.click(screen.getByRole("link", { name: "Setup" }))

    expect(onLocalFileLinkOpen).toHaveBeenCalledWith({
      lineRange: {
        startLineNumber: 4,
        endLineNumber: 6,
      },
      path: "docs/setup.md",
    })
  })
})
