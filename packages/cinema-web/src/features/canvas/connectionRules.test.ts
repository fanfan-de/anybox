import { describe, expect, it } from "vitest"
import type { CinemaNodeType } from "@anybox/shared/cinema"
import { validateCinemaConnection } from "./connectionRules"

const node = (id: string, cinemaType: CinemaNodeType) => ({ id, data: { cinemaType } })
const connection = (source: string, target: string) => ({ source, target, sourceHandle: "output", targetHandle: "input" })

describe("cinema connection rules", () => {
  const nodes = [node("text", "text"), node("image", "image"), node("video", "video"), node("audio", "audio")]

  it("accepts image references and one-to-many text consumers", () => {
    expect(validateCinemaConnection(connection("image", "text"), nodes, [])).toEqual({ valid: true })
    expect(validateCinemaConnection(connection("text", "image"), nodes, [])).toEqual({ valid: true })
    expect(validateCinemaConnection(connection("text", "video"), nodes, [])).toEqual({ valid: true })
  })

  it("rejects self, duplicate, and incompatible text connections", () => {
    expect(validateCinemaConnection(connection("text", "text"), nodes, [])).toMatchObject({ valid: false, reason: "connection.self" })
    expect(validateCinemaConnection(connection("audio", "text"), nodes, [])).toMatchObject({ valid: false, reason: "connection.textInput" })
    expect(validateCinemaConnection(connection("text", "audio"), nodes, [])).toMatchObject({ valid: false, reason: "connection.textOutput" })
    expect(validateCinemaConnection(connection("text", "image"), nodes, [{ id: "edge", ...connection("text", "image") }])).toMatchObject({ valid: false, reason: "connection.duplicate" })
  })

  it("allows only the four-node media graph", () => {
    const videoNodes = [...nodes, node("video-2", "video")]
    expect(validateCinemaConnection(connection("video", "video-2"), videoNodes, [])).toEqual({ valid: true })
    expect(validateCinemaConnection(connection("image", "image"), nodes, [])).toMatchObject({ valid: false })
    expect(validateCinemaConnection(connection("video", "image"), nodes, [])).toEqual({ valid: false, reason: "connection.invalid" })
    expect(validateCinemaConnection(connection("audio", "video"), nodes, [])).toEqual({ valid: false, reason: "connection.invalid" })
    expect(validateCinemaConnection(connection("video", "audio"), nodes, [])).toEqual({ valid: false, reason: "connection.invalid" })
  })

  it("accepts two video image inputs and rejects a third", () => {
    const secondImageNode = node("image-2", "image")
    const thirdImageNode = node("image-3", "image")
    const videoNodes = [...nodes, secondImageNode, thirdImageNode]
    const existingEdges = [
      { id: "edge-1", ...connection("image", "video") },
      { id: "edge-2", ...connection("image-2", "video") },
    ]

    expect(validateCinemaConnection(connection("image-2", "video"), videoNodes, [
      { id: "text-edge", ...connection("text", "video") },
      existingEdges[0]!,
    ])).toEqual({ valid: true })
    expect(validateCinemaConnection(connection("image-2", "video"), videoNodes, existingEdges.slice(0, 1))).toEqual({ valid: true })
    expect(validateCinemaConnection(connection("image-3", "video"), videoNodes, existingEdges)).toEqual({
      valid: false,
      reason: "connection.videoImageLimit",
    })
  })

  it("routes discovered workflow media through independent typed handles", () => {
    const videoNodes = [
      ...nodes,
      node("image-2", "image"),
      node("image-3", "image"),
      node("video-2", "video"),
    ]
    const referenceHandle = "input:3:referenceImage"
    const sourceVideoHandle = "input:4:sourceVideo"
    const referenceEdges = [
      { id: "reference-1", ...connection("image", "video"), targetHandle: referenceHandle },
      { id: "reference-2", ...connection("image-2", "video"), targetHandle: referenceHandle },
    ]

    expect(validateCinemaConnection({
      ...connection("image-3", "video"),
      targetHandle: referenceHandle,
    }, videoNodes, referenceEdges)).toEqual({ valid: true })
    expect(validateCinemaConnection({
      ...connection("video-2", "video"),
      targetHandle: sourceVideoHandle,
    }, videoNodes, [])).toEqual({ valid: true })
    expect(validateCinemaConnection({
      ...connection("image", "video"),
      targetHandle: sourceVideoHandle,
    }, videoNodes, [])).toEqual({ valid: false, reason: "connection.invalid" })
    expect(validateCinemaConnection({
      ...connection("text", "video"),
      targetHandle: referenceHandle,
    }, videoNodes, [])).toEqual({ valid: false, reason: "connection.invalid" })
  })
})
