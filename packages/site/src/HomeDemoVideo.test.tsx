import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { HomeDemoShowcases } from "./HomeDemoVideo"

describe("HomeDemoShowcases", () => {
  it("renders static showcase images without video controls", () => {
    const { container } = render(<HomeDemoShowcases language="zh" />)

    const images = screen.getAllByRole("img")
    expect(images).toHaveLength(2)
    expect(images[0]).toHaveAttribute("src", "/media/anybox-streaming-ui-poster.webp")
    expect(images[1]).toHaveAttribute("src", "/media/anybox-playable-games-poster.webp")
    expect(container.querySelector("video")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /播放|暂停/ })).not.toBeInTheDocument()
  })
})
