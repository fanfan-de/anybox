import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ThreadRichText, parseThreadRichText } from "./thread-rich-text"

describe("parseThreadRichText", () => {
  it("supports markdown links and bare URLs in the same string", () => {
    expect(
      parseThreadRichText("Docs: [OpenAI](https://openai.com/docs(test)) and https://example.com/plan."),
    ).toEqual([
      {
        type: "text",
        text: "Docs: ",
      },
      {
        type: "link",
        text: "OpenAI",
        href: "https://openai.com/docs(test)",
      },
      {
        type: "text",
        text: " and ",
      },
      {
        type: "link",
        text: "https://example.com/plan",
        href: "https://example.com/plan",
      },
      {
        type: "text",
        text: ".",
      },
    ])
  })

  it("stops bare URLs before adjacent Chinese punctuation and text", () => {
    expect(
      parseThreadRichText("Visit http://localhost:8000/snake.html\u3002Next"),
    ).toEqual([
      {
        type: "text",
        text: "Visit ",
      },
      {
        type: "link",
        text: "http://localhost:8000/snake.html",
        href: "http://localhost:8000/snake.html",
      },
      {
        type: "text",
        text: "\u3002Next",
      },
    ])
  })

  it("supports local markdown links in loose Windows path format", () => {
    expect(parseThreadRichText(String.raw`Open [index.html](C:\新建文件夹 (4)\index.html).`)).toEqual([
      {
        type: "text",
        text: "Open ",
      },
      {
        type: "link",
        text: "index.html",
        href: String.raw`C:\新建文件夹 (4)\index.html`,
        localFileTarget: {
          lineRange: null,
          path: String.raw`C:\新建文件夹 (4)\index.html`,
        },
      },
      {
        type: "text",
        text: ".",
      },
    ])
  })

  it("supports relative local markdown links", () => {
    expect(parseThreadRichText("Open [Game](snake.html) and [Source](src/app.tsx:12).")).toEqual([
      {
        type: "text",
        text: "Open ",
      },
      {
        type: "link",
        text: "Game",
        href: "snake.html",
        localFileTarget: {
          lineRange: null,
          path: "snake.html",
        },
      },
      {
        type: "text",
        text: " and ",
      },
      {
        type: "link",
        text: "Source",
        href: "src/app.tsx:12",
        localFileTarget: {
          lineRange: {
            startLineNumber: 12,
            endLineNumber: 12,
          },
          path: "src/app.tsx",
        },
      },
      {
        type: "text",
        text: ".",
      },
    ])
  })

  it("supports artifact markdown links", () => {
    expect(parseThreadRichText("Open [Artifact](agent://artifact/report-1).")).toEqual([
      {
        type: "text",
        text: "Open ",
      },
      {
        type: "link",
        text: "Artifact",
        href: "agent://artifact/report-1",
        artifactTarget: {
          href: "agent://artifact/report-1",
          id: "report-1",
        },
      },
      {
        type: "text",
        text: ".",
      },
    ])
  })

  it("promotes matching user references into inline tag segments", () => {
    expect(
      parseThreadRichText("Check @src/angry-birds.js and https://example.com/plan.", [
        {
          id: "file:C:\\Projects\\Atlas\\frontend\\src\\angry-birds.js",
          kind: "file",
          label: "src/angry-birds.js",
          title: "C:\\Projects\\Atlas\\frontend\\src\\angry-birds.js",
        },
      ]),
    ).toEqual([
      {
        type: "text",
        text: "Check ",
      },
      {
        type: "reference",
        text: "@src/angry-birds.js",
        reference: {
          id: "file:C:\\Projects\\Atlas\\frontend\\src\\angry-birds.js",
          kind: "file",
          label: "src/angry-birds.js",
          title: "C:\\Projects\\Atlas\\frontend\\src\\angry-birds.js",
        },
      },
      {
        type: "text",
        text: " and ",
      },
      {
        type: "link",
        text: "https://example.com/plan",
        href: "https://example.com/plan",
      },
      {
        type: "text",
        text: ".",
      },
    ])
  })
})

describe("ThreadRichText", () => {
  beforeEach(() => {
    window.desktop = {
      openExternalUrl: vi.fn().mockResolvedValue({
        ok: true,
        url: "https://openai.com/",
      }),
    } as unknown as Window["desktop"]
  })

  it("renders clickable links and routes clicks through the desktop bridge", () => {
    render(
      <ThreadRichText
        className="trace-item-text"
        text="Visit [OpenAI](https://openai.com) or https://example.com/plan."
      />,
    )

    const markdownLink = screen.getByRole("link", { name: "OpenAI" })
    const bareUrlLink = screen.getByRole("link", { name: "https://example.com/plan" })

    expect(markdownLink).toHaveAttribute("href", "https://openai.com/")
    expect(bareUrlLink).toHaveAttribute("href", "https://example.com/plan")

    fireEvent.click(markdownLink)
    fireEvent.click(bareUrlLink)

    expect(window.desktop?.openExternalUrl).toHaveBeenNthCalledWith(1, {
      url: "https://openai.com/",
    })
    expect(window.desktop?.openExternalUrl).toHaveBeenNthCalledWith(2, {
      url: "https://example.com/plan",
    })
  })

  it("routes local file link clicks through the local file callback", () => {
    const onLocalFileLinkOpen = vi.fn()
    render(
      <ThreadRichText
        className="trace-item-text"
        text={String.raw`Open [index.html](C:\新建文件夹 (4)\index.html).`}
        onLocalFileLinkOpen={onLocalFileLinkOpen}
      />,
    )

    fireEvent.click(screen.getByRole("link", { name: "index.html" }))

    expect(onLocalFileLinkOpen).toHaveBeenCalledWith({
      lineRange: null,
      path: String.raw`C:\新建文件夹 (4)\index.html`,
    })
    expect(window.desktop?.openExternalUrl).not.toHaveBeenCalled()
  })

  it("routes artifact link clicks through the artifact callback", () => {
    const onArtifactLinkOpen = vi.fn()
    render(
      <ThreadRichText
        className="trace-item-text"
        text="Open [Artifact](agent://artifact/report-1)."
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

  it("renders user references as inline pills using composer tag styling", () => {
    render(
      <ThreadRichText
        className="user-bubble-text"
        references={[
          {
            id: "comment-1",
            kind: "comment",
            label: "focus-files.tsx:L2-L3",
            title: "src/focus-files.tsx (lines 2-3)",
          },
        ]}
        text="Review @focus-files.tsx:L2-L3 next."
      />,
    )

    const inlineReference = screen.getByText("@focus-files.tsx:L2-L3")

    expect(inlineReference).toHaveClass("composer-inline-tag", "thread-inline-reference", "is-comment")
    expect(inlineReference).toHaveAttribute("title", "src/focus-files.tsx (lines 2-3)")
  })
})
