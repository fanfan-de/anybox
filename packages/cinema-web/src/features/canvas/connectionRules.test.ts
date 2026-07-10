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
})
