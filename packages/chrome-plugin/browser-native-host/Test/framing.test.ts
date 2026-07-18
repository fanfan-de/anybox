import { describe, expect, test } from "bun:test"
import { encodeNativeMessage, NativeMessageDecoder } from "../src/framing"

describe("native messaging framing", () => {
  test("decodes partial frames", () => {
    const decoder = new NativeMessageDecoder()
    const frame = encodeNativeMessage({ type: "hello", value: 1 })

    expect(decoder.push(frame.subarray(0, 2))).toEqual([])
    expect(decoder.push(frame.subarray(2))).toEqual([{ type: "hello", value: 1 }])
  })

  test("decodes multiple frames from one chunk", () => {
    const decoder = new NativeMessageDecoder()
    const chunk = Buffer.concat([
      encodeNativeMessage({ one: true }),
      encodeNativeMessage({ two: true }),
    ])

    expect(decoder.push(chunk)).toEqual([{ one: true }, { two: true }])
  })

  test("rejects oversized frames", () => {
    const decoder = new NativeMessageDecoder({ maxMessageBytes: 8 })
    const frame = Buffer.alloc(4)
    frame.writeUInt32LE(9, 0)

    expect(() => decoder.push(frame)).toThrow("exceeds 8 bytes")
  })

  test("rejects invalid json payloads", () => {
    const decoder = new NativeMessageDecoder()
    const payload = Buffer.from("{", "utf8")
    const frame = Buffer.alloc(4 + payload.length)
    frame.writeUInt32LE(payload.length, 0)
    payload.copy(frame, 4)

    expect(() => decoder.push(frame)).toThrow()
  })
})
