import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SkillDocumentPreview } from "./SkillDocumentPreview"

describe("SkillDocumentPreview", () => {
  const openExternalUrl = vi.fn().mockResolvedValue({ ok: true, url: "https://example.com/docs" })

  beforeEach(() => {
    openExternalUrl.mockClear()
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: { openExternalUrl },
    })
  })

  it("blocks raw HTML and remote images", () => {
    const { container } = render(
      <SkillDocumentPreview content={'# Safe\n\n<script>window.evil()</script>\n\n![tracking pixel](https://tracker.example/pixel.png)'} />,
    )

    expect(screen.getByRole("heading", { name: "Safe" })).toBeInTheDocument()
    expect(screen.getByText("Remote image blocked: tracking pixel")).toBeInTheDocument()
    expect(container.querySelector("script")).not.toBeInTheDocument()
    expect(container.querySelector("img")).not.toBeInTheDocument()
  })

  it("opens only HTTP links through the desktop bridge", () => {
    render(
      <SkillDocumentPreview content={'[Docs](https://example.com/docs) and [unsafe](javascript:alert(1))'} />,
    )

    fireEvent.click(screen.getByRole("link", { name: "Docs" }))
    expect(openExternalUrl).toHaveBeenCalledWith({ url: "https://example.com/docs" })
    expect(screen.queryByRole("link", { name: "unsafe" })).not.toBeInTheDocument()
  })
})
