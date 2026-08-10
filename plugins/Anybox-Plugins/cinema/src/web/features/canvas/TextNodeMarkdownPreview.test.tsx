/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { TextNodeMarkdownPreview } from "./TextNodeMarkdownPreview"

afterEach(cleanup)

describe("TextNodeMarkdownPreview", () => {
  it("renders compact screenplay structure without exposing Markdown markers", () => {
    const view = render(
      <TextNodeMarkdownPreview text={"**分镜脚本**\n\n---\n\n## 镜头 1\n第一行\n第二行"} />,
    )

    expect(screen.getByText("分镜脚本").tagName).toBe("STRONG")
    expect(screen.getByRole("heading", { name: "镜头 1" }).tagName).toBe("H2")
    expect(view.container.querySelector("hr")).toBeInTheDocument()
    expect(view.container.querySelectorAll("br")).toHaveLength(1)
    expect(view.container).not.toHaveTextContent("**")
  })

  it("does not create active links or load Markdown and HTML images", () => {
    const view = render(
      <TextNodeMarkdownPreview
        text={"[参考](https://example.com) ![分镜参考](https://example.com/frame.png)\n<img src=\"https://example.com/raw.png\">"}
      />,
    )

    expect(view.container.querySelector("a")).not.toBeInTheDocument()
    expect(view.container.querySelector("img")).not.toBeInTheDocument()
    expect(screen.getByText("参考")).toHaveClass("cinema-text-markdown-link")
    expect(screen.getByText("分镜参考")).toHaveClass("cinema-text-markdown-image-alt")
  })

  it("skips raw HTML instead of rendering it", () => {
    const view = render(
      <TextNodeMarkdownPreview text={"正文\n\n<script>window.__unsafe = true</script>"} />,
    )

    expect(view.container.querySelector("script")).not.toBeInTheDocument()
    expect(view.container).not.toHaveTextContent("window.__unsafe")
  })
})
