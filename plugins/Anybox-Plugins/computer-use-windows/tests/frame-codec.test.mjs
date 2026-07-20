import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { MAX_FRAME_BYTES } = require("../scripts/lib/build-info")
const { FrameDecoder, encodeFrame } = require("../scripts/lib/frame-codec")

test("decodes a helper frame split across chunks", () => {
  const decoder = new FrameDecoder()
  const frame = encodeFrame({ jsonrpc: "2.0", id: "1", result: { ok: true } })
  assert.deepEqual(decoder.push(frame.subarray(0, 2)), [])
  assert.deepEqual(decoder.push(frame.subarray(2, 7)), [])
  assert.deepEqual(decoder.push(frame.subarray(7)), [
    { jsonrpc: "2.0", id: "1", result: { ok: true } },
  ])
})

test("decodes multiple helper frames from one chunk", () => {
  const decoder = new FrameDecoder()
  const chunk = Buffer.concat([
    encodeFrame({ jsonrpc: "2.0", id: "1", result: 1 }),
    encodeFrame({ jsonrpc: "2.0", id: "2", result: 2 }),
  ])
  assert.deepEqual(decoder.push(chunk), [
    { jsonrpc: "2.0", id: "1", result: 1 },
    { jsonrpc: "2.0", id: "2", result: 2 },
  ])
})

test("rejects oversized, empty, and malformed helper frames", () => {
  const oversized = Buffer.alloc(4)
  oversized.writeUInt32LE(MAX_FRAME_BYTES + 1)
  assert.throws(
    () => new FrameDecoder().push(oversized),
    (error) => error.code === "CU_PROTOCOL_MISMATCH",
  )

  const empty = Buffer.alloc(4)
  assert.throws(
    () => new FrameDecoder().push(empty),
    (error) => error.code === "CU_PROTOCOL_MISMATCH",
  )

  const invalidBody = Buffer.from("{not-json", "utf8")
  const invalidHeader = Buffer.alloc(4)
  invalidHeader.writeUInt32LE(invalidBody.length)
  assert.throws(
    () => new FrameDecoder().push(Buffer.concat([invalidHeader, invalidBody])),
    (error) => error.code === "CU_PROTOCOL_MISMATCH",
  )
})
