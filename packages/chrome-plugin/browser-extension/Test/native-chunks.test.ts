import { expect, test } from "bun:test"
import {
  MAX_BROWSER_IPC_CHUNK_BYTES,
  MAX_BROWSER_IPC_MESSAGE_BYTES,
} from "@anybox/chrome-shared/browser-ipc"
import {
  NativeHostChunkReassembler,
} from "../src/background/native-chunks.ts"

function chunksFor(value: unknown, transferID = "transfer-1") {
  const payload = Buffer.from(JSON.stringify(value), "utf8")
  const total = Math.ceil(payload.byteLength / MAX_BROWSER_IPC_CHUNK_BYTES)
  return Array.from({ length: total }, (_, index) => {
    const start = index * MAX_BROWSER_IPC_CHUNK_BYTES
    const end = Math.min(start + MAX_BROWSER_IPC_CHUNK_BYTES, payload.byteLength)
    return {
      type: "native.chunk",
      transferID,
      index,
      total,
      totalBytes: payload.byteLength,
      data: payload.subarray(start, end).toString("base64"),
    }
  })
}

test("reassembles bounded Host-to-Extension native chunks", () => {
  const expected = {
    type: "command",
    payload: "x".repeat(MAX_BROWSER_IPC_CHUNK_BYTES + 1_024),
  }
  const chunks = chunksFor(expected)
  const reassembler = new NativeHostChunkReassembler()

  expect(chunks.length).toBe(2)
  expect(reassembler.push(chunks[1])).toBeUndefined()
  expect(reassembler.push(chunks[0])).toEqual(expected)
  expect(() => reassembler.push(chunks[0])).toThrow(
    "already completed",
  )
  reassembler.reset()
})

test("rejects transfers beyond the 64 MiB total limit", () => {
  const reassembler = new NativeHostChunkReassembler()
  expect(() => reassembler.push({
    type: "native.chunk",
    transferID: "oversized",
    index: 0,
    total: 1,
    totalBytes: MAX_BROWSER_IPC_MESSAGE_BYTES + 1,
    data: Buffer.from("x").toString("base64"),
  })).toThrow()
  reassembler.reset()
})
