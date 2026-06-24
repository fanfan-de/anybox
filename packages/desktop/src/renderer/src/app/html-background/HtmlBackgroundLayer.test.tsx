import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { HtmlBackgroundLayer } from "./HtmlBackgroundLayer"
import type { HtmlBackgroundConfig } from "./html-background-config"

function createConfig(overrides: Partial<HtmlBackgroundConfig> = {}): HtmlBackgroundConfig {
  return {
    blurPx: 0,
    dim: 0.18,
    enabled: true,
    html: "<main>Background</main>",
    opacity: 0.78,
    paused: false,
    renderMode: "static",
    surfaceOpacity: 0.68,
    ...overrides,
  }
}

function getFrame(container: HTMLElement) {
  const frame = container.querySelector(".html-background-frame") as HTMLIFrameElement | null
  expect(frame).not.toBeNull()
  return frame!
}

function getFrameSrcDoc(frame: HTMLIFrameElement) {
  return frame.getAttribute("srcdoc") ?? frame.srcdoc
}

describe("HtmlBackgroundLayer", () => {
  it("does not render when disabled or empty", () => {
    const { container, rerender } = render(<HtmlBackgroundLayer config={createConfig({ enabled: false })} />)
    expect(container.querySelector(".html-background-layer")).toBeNull()

    rerender(<HtmlBackgroundLayer config={createConfig({ html: "   " })} />)
    expect(container.querySelector(".html-background-layer")).toBeNull()
  })

  it("renders static HTML in a strict sandboxed iframe", () => {
    const { container } = render(<HtmlBackgroundLayer config={createConfig()} />)
    const frame = getFrame(container)

    expect(container.querySelector(".html-background-layer")).toHaveAttribute("aria-hidden", "true")
    expect(frame).toHaveAttribute("sandbox", "")
    expect(frame).toHaveAttribute("tabindex", "-1")
    expect(getFrameSrcDoc(frame)).toContain("Background")
  })

  it("removes unsafe tags, event handlers, and external CSS fetches", () => {
    const { container } = render(
      <HtmlBackgroundLayer
        config={createConfig({
          html: [
            '<main class="hero" onclick="bad()">Safe</main>',
            "<style>@import 'https://example.com/a.css'; .hero{background:url(https://example.com/a.png)}</style>",
            "<script>window.evil = true</script>",
            '<iframe src="https://example.com"></iframe>',
            '<img src="file:///C:/Users/test/secret.png">',
          ].join(""),
        })}
      />,
    )

    const srcDoc = getFrameSrcDoc(getFrame(container))
    expect(srcDoc).toContain('class="hero"')
    expect(srcDoc).toContain("Safe")
    expect(srcDoc).not.toContain("onclick")
    expect(srcDoc).not.toContain("<script")
    expect(srcDoc).not.toContain("window.evil")
    expect(srcDoc).not.toContain("<iframe")
    expect(srcDoc).not.toContain("@import")
    expect(srcDoc).not.toContain("https://example.com")
    expect(srcDoc).not.toContain("file:///")
  })

  it("injects pause-motion CSS when requested", () => {
    const { container } = render(<HtmlBackgroundLayer config={createConfig({ paused: true })} />)
    expect(getFrameSrcDoc(getFrame(container))).toContain("animation-play-state:paused")
  })

  it("keeps scripts only in dynamic script mode", () => {
    const { container } = render(
      <HtmlBackgroundLayer
        config={createConfig({
          html: '<canvas></canvas><script type="module">window.dynamicBackground = true</script>',
          renderMode: "dynamic",
        })}
      />,
    )
    const frame = getFrame(container)
    const srcDoc = getFrameSrcDoc(frame)

    expect(frame).toHaveAttribute("sandbox", "allow-scripts")
    expect(srcDoc).toContain("<script")
    expect(srcDoc).toContain("window.dynamicBackground")
    expect(srcDoc).toContain("script-src 'unsafe-inline'")
    expect(srcDoc).toContain("frame-src 'none'")
    expect(srcDoc).not.toContain("allow-same-origin")
  })
})
