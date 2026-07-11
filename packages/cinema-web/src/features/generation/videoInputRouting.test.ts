import type { CinemaNodeType } from "@anybox/shared/cinema"
import type { Edge } from "@xyflow/react"
import { describe, expect, it } from "vitest"
import {
  edgeTargetVideoInput,
  nextVideoImageInputIndex,
  normalizeVideoTargetEdgeHandle,
} from "./videoInputRouting"

const node = (id: string, cinemaType: CinemaNodeType) => ({ id, data: { cinemaType } })
const edge = (id: string, source: string, data?: Record<string, unknown>): Edge => ({
  id,
  source,
  target: "video",
  sourceHandle: "output",
  targetHandle: "input",
  ...(data ? { data } : {}),
})

describe("video input routing", () => {
  const nodes = [
    node("text", "text"),
    node("image-1", "image"),
    node("image-2", "image"),
    node("video", "video"),
  ]

  it("routes a text connection to the prompt input", () => {
    const textEdge = edge("text-edge", "text")
    expect(edgeTargetVideoInput(textEdge, nodes, [textEdge])).toEqual({ slot: "textParameter" })
  })

  it("routes the first and second image connections to first and last frame", () => {
    const firstImageEdge = edge("image-edge-1", "image-1")
    const secondImageEdge = edge("image-edge-2", "image-2")
    const edges = [firstImageEdge, secondImageEdge]

    expect(edgeTargetVideoInput(firstImageEdge, nodes, edges)).toEqual({ slot: "startFrame" })
    expect(edgeTargetVideoInput(secondImageEdge, nodes, edges)).toEqual({ slot: "endFrame" })
  })

  it("preserves explicit input metadata on existing edges", () => {
    const explicitEdge = edge("legacy-edge", "image-1", { targetSlot: "endFrame" })
    expect(edgeTargetVideoInput(explicitEdge, nodes, [explicitEdge])).toEqual({ slot: "endFrame" })
  })

  it("preserves an assigned tail frame after the first image is removed", () => {
    const tailEdge = edge("image-edge-2", "image-2", { targetImageIndex: 1 })
    expect(edgeTargetVideoInput(tailEdge, nodes, [tailEdge])).toEqual({ slot: "endFrame" })
    expect(nextVideoImageInputIndex("video", nodes, [tailEdge])).toBe(0)
  })

  it("normalizes an old provider-specific handle to the single visible input", () => {
    const legacyEdge = {
      ...edge("legacy-edge", "image-1"),
      targetHandle: "input:0:first_frame_image",
    }
    expect(normalizeVideoTargetEdgeHandle(legacyEdge)).toMatchObject({
      targetHandle: "input",
      data: {
        targetInputKey: "input:0:first_frame_image",
        targetRole: "first_frame_image",
        targetSlot: "startFrame",
      },
    })
  })
})
