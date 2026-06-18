import { act, fireEvent, render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SIDEBAR_RESIZE_END_EVENT } from "./sidebar-resize-events"
import { ThreadHtml } from "./thread-html"

function getFrame(container: HTMLElement) {
  const frame = container.querySelector(".thread-html-frame") as HTMLIFrameElement | null
  expect(frame).not.toBeNull()
  return frame!
}

function getFrameSrcDoc(frame: HTMLIFrameElement) {
  return frame.getAttribute("srcdoc") ?? frame.srcdoc
}

function loadFrameDocument(frame: HTMLIFrameElement) {
  const document = frame.contentDocument
  expect(document).not.toBeNull()
  document!.open()
  document!.write(getFrameSrcDoc(frame))
  document!.close()
  fireEvent.load(frame)
  return document!
}

describe("ThreadHtml", () => {
  beforeEach(() => {
    window.desktop = {
      openExternalUrl: vi.fn().mockResolvedValue({
        ok: true,
        url: "https://example.com/",
      }),
    } as unknown as Window["desktop"]
  })

  it("renders full HTML documents in a sandboxed iframe", () => {
    const { container } = render(
      <ThreadHtml
        text={[
          "<!doctype html>",
          "<html>",
          "<head><style>.hero{display:grid;color:rgb(10, 20, 30);}</style></head>",
          '<body><main class="hero"><h1>Release notes</h1><p>Ready to ship.</p></main></body>',
          "</html>",
        ].join("")}
      />,
    )

    const frame = getFrame(container)
    const srcDoc = getFrameSrcDoc(frame)

    expect(frame).toHaveAttribute("sandbox", "allow-same-origin")
    expect(srcDoc).toContain("<style>.hero{display:grid;color:rgb(10, 20, 30);}</style>")
    expect(srcDoc).toContain('class="hero"')
    expect(srcDoc).toContain("Release notes")
  })

  it("removes unsafe tags and attributes while preserving page-level CSS", () => {
    const { container } = render(
      <ThreadHtml
        text={[
          '<main class="custom" style="color:red" onclick="alert(1)">Safe text</main>',
          "<style>.custom{padding:24px}</style>",
          "<script>window.evil = true</script>",
          '<iframe src="https://example.com"></iframe>',
        ].join("")}
      />,
    )

    const srcDoc = getFrameSrcDoc(getFrame(container))

    expect(srcDoc).toContain('class="custom"')
    expect(srcDoc).toContain("<style>.custom{padding:24px}</style>")
    expect(srcDoc).not.toContain('style="color:red"')
    expect(srcDoc).not.toContain("onclick")
    expect(srcDoc).not.toContain("<script")
    expect(srcDoc).not.toContain("window.evil")
    expect(srcDoc).not.toContain("<iframe")
  })

  it("removes external CSS fetches from style blocks", () => {
    const { container } = render(
      <ThreadHtml text="<style>@import 'https://example.com/a.css'; .hero{background:url(https://example.com/a.png)}</style><p>Safe</p>" />,
    )

    const srcDoc = getFrameSrcDoc(getFrame(container))

    expect(srcDoc).not.toContain("@import")
    expect(srcDoc).not.toContain("url(")
    expect(srcDoc).toContain(".hero{background:none}")
  })

  it("blocks unsupported link targets", () => {
    const { container } = render(
      <ThreadHtml
        text={[
          '<a href="javascript:alert(1)">Bad</a>',
          '<a href="data:text/html;base64,PGgxPkJhZDwvaDE+">Data</a>',
          '<a href="#section">Anchor</a>',
        ].join(" ")}
      />,
    )

    const srcDoc = getFrameSrcDoc(getFrame(container))

    expect(srcDoc).not.toContain("javascript:")
    expect(srcDoc).not.toContain("data:text")
    expect(srcDoc).not.toContain('href="#section"')
    expect(srcDoc).toContain(">Bad</a>")
    expect(srcDoc).toContain(">Data</a>")
    expect(srcDoc).toContain(">Anchor</a>")
  })

  it("opens safe external links through the desktop bridge", () => {
    const { container } = render(<ThreadHtml text='<a href="https://example.com/docs">Docs</a>' />)
    const document = loadFrameDocument(getFrame(container))

    fireEvent.click(document.querySelector("a")!)

    expect(window.desktop?.openExternalUrl).toHaveBeenCalledWith({
      url: "https://example.com/docs",
    })
  })

  it("opens artifact links through the artifact callback", () => {
    const onArtifactLinkOpen = vi.fn()
    const { container } = render(
      <ThreadHtml
        text='<a href="agent://artifact/report-1">Artifact</a>'
        onArtifactLinkOpen={onArtifactLinkOpen}
      />,
    )
    const document = loadFrameDocument(getFrame(container))

    fireEvent.click(document.querySelector("a")!)

    expect(onArtifactLinkOpen).toHaveBeenCalledWith({
      href: "agent://artifact/report-1",
      id: "report-1",
    })
    expect(window.desktop?.openExternalUrl).not.toHaveBeenCalled()
  })

  it("opens local file links through the local file callback", () => {
    const onLocalFileLinkOpen = vi.fn()
    const { container } = render(
      <ThreadHtml
        text='<a href="C:/Projects/anybox/packages/desktop/src/renderer/src/app/thread/ThreadView.tsx:42">ThreadView.tsx</a>'
        onLocalFileLinkOpen={onLocalFileLinkOpen}
      />,
    )
    const document = loadFrameDocument(getFrame(container))

    fireEvent.click(document.querySelector("a")!)

    expect(onLocalFileLinkOpen).toHaveBeenCalledWith({
      lineRange: {
        startLineNumber: 42,
        endLineNumber: 42,
      },
      path: "C:/Projects/anybox/packages/desktop/src/renderer/src/app/thread/ThreadView.tsx",
    })
    expect(window.desktop?.openExternalUrl).not.toHaveBeenCalled()
  })

  it("opens relative local file links through the local file callback", () => {
    const onLocalFileLinkOpen = vi.fn()
    const { container } = render(
      <ThreadHtml
        text='<a href="snake.html">Game</a> <a href="src/app.tsx:12">Source</a>'
        onLocalFileLinkOpen={onLocalFileLinkOpen}
      />,
    )
    const document = loadFrameDocument(getFrame(container))
    const links = document.querySelectorAll("a")

    fireEvent.click(links[0]!)
    fireEvent.click(links[1]!)

    expect(onLocalFileLinkOpen).toHaveBeenNthCalledWith(1, {
      lineRange: null,
      path: "snake.html",
    })
    expect(onLocalFileLinkOpen).toHaveBeenNthCalledWith(2, {
      lineRange: {
        startLineNumber: 12,
        endLineNumber: 12,
      },
      path: "src/app.tsx",
    })
    expect(window.desktop?.openExternalUrl).not.toHaveBeenCalled()
  })

  it("defers iframe height updates while sidebar resize is active", () => {
    const originalResizeObserver = globalThis.ResizeObserver
    let triggerResize: (() => void) | null = null

    class ManualResizeObserver implements ResizeObserver {
      readonly callback: ResizeObserverCallback

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
        triggerResize = () => callback([], this)
      }

      observe() {}

      unobserve() {}

      disconnect() {}
    }

    globalThis.ResizeObserver = ManualResizeObserver

    try {
      const { container } = render(<ThreadHtml text="<main>Resizable frame</main>" />)
      const frame = getFrame(container)
      const frameDocument = loadFrameDocument(frame)

      Object.defineProperty(frameDocument.documentElement, "scrollHeight", {
        configurable: true,
        value: 640,
      })
      Object.defineProperty(frameDocument.body, "scrollHeight", {
        configurable: true,
        value: 640,
      })

      document.body.classList.add("is-resizing-sidebar")
      act(() => {
        triggerResize?.()
      })

      expect(frame.style.height).toBe("320px")

      document.body.classList.remove("is-resizing-sidebar")
      act(() => {
        window.dispatchEvent(new Event(SIDEBAR_RESIZE_END_EVENT))
      })

      expect(frame.style.height).toBe("640px")
    } finally {
      document.body.classList.remove("is-resizing-sidebar")
      globalThis.ResizeObserver = originalResizeObserver
    }
  })
})
