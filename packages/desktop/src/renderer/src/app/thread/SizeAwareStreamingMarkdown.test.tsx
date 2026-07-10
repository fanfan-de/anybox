import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import {
  SizeAwareStreamingMarkdown,
  THREAD_STREAMING_MARKDOWN_FULL_RENDER_CHARACTER_LIMIT,
  THREAD_STREAMING_MARKDOWN_PREVIEW_CHARACTER_LIMIT,
  THREAD_STREAMING_MARKDOWN_PREVIEW_OMISSION_MARKER,
  buildBoundedStreamingMarkdownPreview,
  shouldRenderFullStreamingMarkdown,
} from "./SizeAwareStreamingMarkdown"

describe("SizeAwareStreamingMarkdown", () => {
  it("renders the first streaming token as Markdown without delaying it", () => {
    render(
      <SizeAwareStreamingMarkdown
        className="trace-item-text thread-markdown"
        isStreaming
        text="# H"
      />,
    )

    expect(screen.getByRole("heading", { name: "H" })).toBeInTheDocument()
  })

  it("keeps streaming Markdown enabled through the full-render threshold", () => {
    expect(
      shouldRenderFullStreamingMarkdown(
        "x".repeat(THREAD_STREAMING_MARKDOWN_FULL_RENDER_CHARACTER_LIMIT),
        true,
      ),
    ).toBe(true)
    expect(
      shouldRenderFullStreamingMarkdown(
        "x".repeat(THREAD_STREAMING_MARKDOWN_FULL_RENDER_CHARACTER_LIMIT + 1),
        true,
      ),
    ).toBe(false)
  })

  it("uses a bounded plain-text head and live tail for a large streaming response", () => {
    const text = `# Stream heading\n\n${"middle ".repeat(4_000)}\n\nFinal live token`
    const { container } = render(
      <SizeAwareStreamingMarkdown
        className="trace-item-text thread-markdown"
        isStreaming
        text={text}
      />,
    )

    const preview = container.querySelector<HTMLElement>(
      '[data-thread-streaming-render-mode="plain-preview"]',
    )
    expect(preview).not.toBeNull()
    expect(preview).toHaveClass("trace-item-text", "thread-markdown")
    expect(preview).toHaveStyle({ whiteSpace: "pre-wrap" })
    expect(preview?.textContent?.length).toBeLessThanOrEqual(
      THREAD_STREAMING_MARKDOWN_PREVIEW_CHARACTER_LIMIT,
    )
    expect(preview).toHaveTextContent("# Stream heading")
    expect(preview).toHaveTextContent(THREAD_STREAMING_MARKDOWN_PREVIEW_OMISSION_MARKER.trim())
    expect(preview).toHaveTextContent("Final live token")
    expect(screen.queryByRole("heading", { name: "Stream heading" })).not.toBeInTheDocument()
  })

  it("restores complete Markdown when a large response finishes streaming", () => {
    const text = `# Completed response\n\n${"full response body ".repeat(1_200)}`
    const { rerender } = render(
      <SizeAwareStreamingMarkdown
        className="trace-item-text thread-markdown"
        isStreaming
        text={text}
      />,
    )

    expect(screen.queryByRole("heading", { name: "Completed response" })).not.toBeInTheDocument()

    rerender(
      <SizeAwareStreamingMarkdown
        className="trace-item-text thread-markdown"
        isStreaming={false}
        text={text}
      />,
    )

    expect(screen.getByRole("heading", { name: "Completed response" })).toBeInTheDocument()
    expect(
      document.querySelector('[data-thread-streaming-render-mode="plain-preview"]'),
    ).not.toBeInTheDocument()
  })

  it("forwards artifact and local-file handlers to full Markdown rendering", () => {
    const onArtifactLinkOpen = vi.fn()
    const onLocalFileLinkOpen = vi.fn()
    render(
      <SizeAwareStreamingMarkdown
        isStreaming
        onArtifactLinkOpen={onArtifactLinkOpen}
        onLocalFileLinkOpen={onLocalFileLinkOpen}
        text="[Artifact](agent://artifact/report) [File](C:/Projects/Anybox/README.md)"
      />,
    )

    fireEvent.click(screen.getByRole("link", { name: "Artifact" }))
    fireEvent.click(screen.getByRole("link", { name: "File" }))

    expect(onArtifactLinkOpen).toHaveBeenCalledWith({
      href: "agent://artifact/report",
      id: "report",
    })
    expect(onLocalFileLinkOpen).toHaveBeenCalledWith({
      lineRange: null,
      path: "C:/Projects/Anybox/README.md",
    })
  })
})

describe("buildBoundedStreamingMarkdownPreview", () => {
  it("keeps the preview within budget without emitting broken surrogate pairs", () => {
    const text = `${"a".repeat(4_000)}😀${"b".repeat(20_000)}🚀tail`
    const preview = buildBoundedStreamingMarkdownPreview(text)

    expect(preview.length).toBeLessThanOrEqual(THREAD_STREAMING_MARKDOWN_PREVIEW_CHARACTER_LIMIT)
    expect(preview).toContain(THREAD_STREAMING_MARKDOWN_PREVIEW_OMISSION_MARKER)
    expect(preview.endsWith("🚀tail")).toBe(true)
    expect(preview).not.toContain("�")
  })
})
